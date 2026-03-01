/**
 * Local Embeddings using @xenova/transformers
 * Runs entirely locally - no API costs, no external calls
 * Uses the all-MiniLM-L6-v2 model (384 dimensions, fast, good quality)
 */

// Type-only import: erased at runtime. Runtime is loaded dynamically in initEmbedder().
import type { FeatureExtractionPipeline } from '@xenova/transformers';

// Singleton embedder instance
let embedder: FeatureExtractionPipeline | null = null;
let isInitializing = false;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSION = 384;

/**
 * Initialize the embedding model (downloads on first use, ~23MB)
 * Subsequent calls return cached instance
 */
export async function initEmbedder(): Promise<FeatureExtractionPipeline> {
  // Skip embedding model on low-memory environments (free tier ~512MB)
  if (process.env.DISABLE_EMBEDDINGS === '1' || process.env.DISABLE_EMBEDDINGS === 'true') {
    throw new Error('Embeddings disabled via DISABLE_EMBEDDINGS env var');
  }

  if (embedder) return embedder;

  if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;
  console.log('[Embeddings] Initializing local embedding model...');
  console.log('[Embeddings] First run will download model (~23MB), subsequent runs use cache');

  const { pipeline } = await import('@xenova/transformers');
  initPromise = pipeline('feature-extraction', MODEL_NAME, {
    // Use quantized model for faster inference
    quantized: true,
  });

  embedder = await initPromise;
  isInitializing = false;
  console.log('[Embeddings] Model ready');

  return embedder;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = await initEmbedder();

  // Clean and truncate text (model has 256 token limit)
  const cleanText = text.trim().substring(0, 1000);

  if (!cleanText) {
    // Return zero vector for empty text
    return new Array(EMBEDDING_DIMENSION).fill(0);
  }

  const output = await model(cleanText, {
    pooling: 'mean',
    normalize: true,
  });

  // Convert to regular array
  return Array.from(output.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts (batched for efficiency)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const model = await initEmbedder();

  const results: number[][] = [];

  // Process in batches of 32 for memory efficiency
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const cleanBatch = batch.map(t => t.trim().substring(0, 1000));

    for (const text of cleanBatch) {
      if (!text) {
        results.push(new Array(EMBEDDING_DIMENSION).fill(0));
        continue;
      }

      const output = await model(text, {
        pooling: 'mean',
        normalize: true,
      });

      results.push(Array.from(output.data as Float32Array));
    }
  }

  return results;
}

/**
 * Compute cosine similarity between two vectors
 * Vectors should already be normalized (which they are from the model)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  return dotProduct;
}
