import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { generateEmbedding, EmbeddingConfig } from './embeddings.js';
import { getPrisma } from '../platform/prisma.js';
import db from '../db.js';

export interface DocumentMetadata {
  name: string;
  description?: string;
  mimeType: string;
  fileSize?: number;
  tags?: string[];
}

export interface ChunkConfig {
  chunkSize: number; // characters
  overlap: number; // characters
}

export async function processDocument(
  projectId: string,
  filePath: string,
  metadata: DocumentMetadata,
  embeddingConfig: EmbeddingConfig,
  chunkConfig: ChunkConfig = { chunkSize: 1000, overlap: 200 }
): Promise<string> {
  const prisma = getPrisma();

  // Extract text from file
  const content = await extractTextFromFile(filePath, metadata.mimeType);

  // Create document record
  const document = await prisma.document.create({
    data: {
      projectId,
      name: metadata.name,
      description: metadata.description,
      filePath,
      content,
      mimeType: metadata.mimeType,
      fileSize: metadata.fileSize,
      tags: metadata.tags ? JSON.stringify(metadata.tags) : null
    }
  });

  // Chunk the content
  const chunks = chunkText(content, chunkConfig);

  // Process chunks and generate embeddings
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Create chunk record
    const chunkRecord = await prisma.documentChunk.create({
      data: {
        documentId: document.id,
        chunkIndex: i,
        content: chunk,
        charCount: chunk.length
      }
    });

    // Generate embedding
    const { embedding, provider, model } = await generateEmbedding(chunk, embeddingConfig);

    // Create vector record
    await prisma.documentVector.create({
      data: {
        chunkId: chunkRecord.id,
        // Persist embeddings as JSON text until pgvector is enabled end-to-end.
        embedding: JSON.stringify(embedding),
        provider,
        model
      }
    });
  }

  return document.id;
}

async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  if (mimeType === 'text/plain' || mimeType.startsWith('text/')) {
    return buffer.toString('utf-8');
  }

  if (mimeType === 'application/pdf') {
    // For now, return a placeholder. In a real implementation, you'd use pdf-parse or similar
    return `[PDF Content Placeholder] This would extract text from PDF: ${path.basename(filePath)}`;
  }

  // For other types, try to read as text
  try {
    return buffer.toString('utf-8');
  } catch {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
}

function chunkText(text: string, config: ChunkConfig): string[] {
  const { chunkSize, overlap } = config;
  const chunks: string[] = [];

  let start = 0;
  while (start < text.length) {
    let end = start + chunkSize;

    // If we're not at the end, try to find a good break point
    if (end < text.length) {
      // Look for sentence endings within the last 100 characters
      const searchStart = Math.max(start, end - 100);
      const sentenceEnd = text.lastIndexOf('.', end);
      const newlineEnd = text.lastIndexOf('\n', end);

      if (sentenceEnd > searchStart) {
        end = sentenceEnd + 1;
      } else if (newlineEnd > searchStart) {
        end = newlineEnd + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    // Move start position with overlap
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

export async function createKnowledgebaseIndex(
  projectId: string,
  name: string,
  description: string | null,
  embeddingConfig: EmbeddingConfig
): Promise<string> {
  const prisma = getPrisma();

  const index = await prisma.knowledgebaseIndex.create({
    data: {
      projectId,
      name,
      slug: generateSlug(name),
      description,
      embeddingConfig: embeddingConfig as unknown as Prisma.InputJsonValue
    }
  });

  return index.id;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export async function deleteDocument(documentId: string): Promise<void> {
  const prisma = getPrisma();

  // This will cascade delete chunks and vectors due to foreign key constraints
  await prisma.document.delete({
    where: { id: documentId }
  });
}

export async function getKnowledgebaseStats(indexId: string): Promise<{
  documentCount: number;
  chunkCount: number;
  totalSize: number;
}> {
  const prisma = getPrisma();

  const documents = await prisma.document.findMany({
    where: {
      projectId: await getProjectIdFromIndex(indexId)
    },
    select: {
      fileSize: true,
      _count: {
        select: { chunks: true }
      }
    }
  });

  const documentCount = documents.length;
  const chunkCount = documents.reduce((sum, doc) => sum + doc._count.chunks, 0);
  const totalSize = documents.reduce((sum, doc) => sum + (doc.fileSize || 0), 0);

  return { documentCount, chunkCount, totalSize };
}

async function getProjectIdFromIndex(indexId: string): Promise<string> {
  const prisma = getPrisma();
  const index = await prisma.knowledgebaseIndex.findUnique({
    where: { id: indexId },
    select: { projectId: true }
  });

  if (!index) {
    throw new Error(`Knowledgebase index not found: ${indexId}`);
  }

  return index.projectId;
}
