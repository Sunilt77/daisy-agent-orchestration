import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getPrisma } from '../platform/prisma';

export interface EmbeddingConfig {
  provider: 'google' | 'openai' | 'anthropic';
  model: string;
  dimensions?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  provider: string;
  model: string;
}

export async function generateEmbedding(text: string, config: EmbeddingConfig): Promise<EmbeddingResult> {
  const { provider, model } = config;

  switch (provider) {
    case 'google':
      return await generateGoogleEmbedding(text, model);
    case 'openai':
      return await generateOpenAIEmbedding(text, model);
    case 'anthropic':
      return await generateAnthropicEmbedding(text, model);
    default:
      throw new Error(`Unsupported embedding provider: ${provider}`);
  }
}

async function generateGoogleEmbedding(text: string, model: string): Promise<EmbeddingResult> {
  // For now, use OpenAI's API as Google Gemini doesn't have direct embedding API
  // TODO: Implement proper Google embedding API when available
  return await generateOpenAIEmbedding(text, 'text-embedding-3-small');
}

async function generateOpenAIEmbedding(text: string, model: string): Promise<EmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const openai = new OpenAI({ apiKey });
  const response = await openai.embeddings.create({
    model,
    input: text,
    encoding_format: 'float',
  });

  return {
    embedding: response.data[0].embedding,
    provider: 'openai',
    model
  };
}

async function generateAnthropicEmbedding(text: string, model: string): Promise<EmbeddingResult> {
  // Anthropic doesn't have embeddings yet, but when they do, implement here
  throw new Error('Anthropic embeddings not yet supported');
}

export async function searchSimilarChunks(
  queryEmbedding: number[],
  indexId: string,
  topK: number = 5,
  scoreThreshold: number = 0.0
): Promise<Array<{
  chunk: any;
  document: any;
  score: number;
}>> {
  const prisma = getPrisma();

  // For now, get all vectors and compute similarity in JS
  // TODO: Use pgvector extension for proper vector search
  const vectors = await prisma.documentVector.findMany({
    where: {
      chunk: {
        document: {
          project: {
            knowledgebaseIndexes: {
              some: { id: indexId }
            }
          }
        }
      }
    },
    include: {
      chunk: {
        include: {
          document: true
        }
      }
    }
  });

  // Calculate cosine similarity for each vector
  const similarities = vectors.map(v => {
    const storedEmbedding = JSON.parse(String(v.embedding || '[]'));
    const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
    return {
      chunk: {
        id: v.chunk.id,
        content: v.chunk.content
      },
      document: {
        id: v.chunk.document.id,
        name: v.chunk.document.name,
        description: v.chunk.document.description
      },
      score: similarity
    };
  });

  // Filter by threshold and sort by similarity
  return similarities
    .filter(s => s.score >= scoreThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
