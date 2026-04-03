import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getPrisma } from '../platform/prisma';
import db from '../db';

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
  const apiKey = resolveProviderApiKey('google');
  if (!apiKey) throw new Error('GOOGLE_API_KEY (or GEMINI_API_KEY) not set');

  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.embedContent({
    model,
    contents: [{ role: 'user', parts: [{ text }] }],
  });

  const embedding = extractGoogleEmbedding(response);
  if (!embedding.length) {
    throw new Error('Google embedding response did not include vector values');
  }

  return {
    embedding,
    provider: 'google',
    model,
  };
}

async function generateOpenAIEmbedding(text: string, model: string): Promise<EmbeddingResult> {
  const apiKey = resolveProviderApiKey('openai');
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

function resolveProviderApiKey(provider: 'google' | 'openai'): string | null {
  if (provider === 'google') {
    const envKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
    if (envKey) return envKey;
  }
  if (provider === 'openai') {
    const envKey = (process.env.OPENAI_API_KEY || '').trim();
    if (envKey) return envKey;
  }

  try {
    const row = db
      .prepare('SELECT api_key FROM llm_providers WHERE provider = ? AND COALESCE(TRIM(api_key), \'\') <> \'\' ORDER BY is_default DESC, id ASC LIMIT 1')
      .get(provider) as any;
    const key = String(row?.api_key || '').trim();
    return key || null;
  } catch {
    return null;
  }
}

async function generateAnthropicEmbedding(text: string, model: string): Promise<EmbeddingResult> {
  // Anthropic doesn't have embeddings yet, but when they do, implement here
  throw new Error('Anthropic embeddings not yet supported');
}

function extractGoogleEmbedding(response: any): number[] {
  // SDK shape can vary by version; support common layouts defensively.
  const directValues = response?.embedding?.values;
  if (Array.isArray(directValues)) return directValues.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v));

  const firstEmb = Array.isArray(response?.embeddings) ? response.embeddings[0] : null;
  const listValues = firstEmb?.values;
  if (Array.isArray(listValues)) return listValues.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v));

  return [];
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

  // Until pgvector is enabled, compute cosine similarity in memory.
  // Fetch only minimal fields to reduce memory pressure.
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
    select: {
      embedding: true,
      chunk: {
        select: {
          id: true,
          content: true,
          document: {
            select: {
              id: true,
              name: true,
              description: true,
            }
          }
        }
      }
    }
  });

  // Calculate cosine similarity for each vector
  const similarities = vectors.map(v => {
    let storedEmbedding: number[] = [];
    try {
      const raw = JSON.parse(String(v.embedding || '[]'));
      if (Array.isArray(raw)) {
        storedEmbedding = raw.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
      }
    } catch {
      storedEmbedding = [];
    }
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
