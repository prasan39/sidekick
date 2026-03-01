/**
 * Hybrid Search - Combines BM25 (keyword) + Vector (semantic) search
 * Based on OpenClaw's approach: weighted score fusion
 *
 * Why hybrid?
 * - Pure vector search fails on exact matches ("commit ab3f2c1" returns similar descriptions, not the exact hash)
 * - Pure keyword search fails on semantic queries ("what did we decide about architecture?" won't match "we chose microservices")
 * - Hybrid combines both for best results
 */

import { VectorStore, SearchResult as VectorResult } from './vector-store.js';
import { BM25Index, BM25Result } from './bm25.js';

export interface HybridSearchResult {
  id: string;
  content: string;
  category: string;
  score: number;
  vectorScore: number;
  bm25Score: number;
}

export interface HybridSearchConfig {
  // Weight for vector similarity (0-1), BM25 weight = 1 - vectorWeight
  vectorWeight: number;
  // Minimum score threshold to include in results
  minScore: number;
  // Maximum results to return
  limit: number;
}

const DEFAULT_CONFIG: HybridSearchConfig = {
  vectorWeight: 0.6,  // Slightly favor semantic search
  minScore: 0.1,
  limit: 10,
};

/**
 * Hybrid Search Engine combining BM25 and Vector search
 */
export class HybridSearch {
  private vectorStore: VectorStore;
  private bm25Index: BM25Index;
  private config: HybridSearchConfig;

  constructor(vectorStore: VectorStore, config: Partial<HybridSearchConfig> = {}) {
    this.vectorStore = vectorStore;
    this.bm25Index = new BM25Index();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Index a document for both vector and BM25 search
   */
  async indexDocument(id: string, content: string, category: string): Promise<void> {
    const now = new Date().toISOString();

    // Add to vector store
    await this.vectorStore.upsertChunk({
      id,
      content,
      category,
      createdAt: now,
      updatedAt: now,
    });

    // Add to BM25 index
    this.bm25Index.addDocument(id, content);
  }

  /**
   * Remove a document from both indexes
   */
  removeDocument(id: string): void {
    this.vectorStore.deleteChunk(id);
    this.bm25Index.removeDocument(id);
  }

  /**
   * Perform hybrid search combining vector and BM25 results
   */
  async search(query: string, config?: Partial<HybridSearchConfig>): Promise<HybridSearchResult[]> {
    const cfg = { ...this.config, ...config };

    // Get results from both search methods
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorStore.searchSimilar(query, cfg.limit * 2),
      Promise.resolve(this.bm25Index.search(query, cfg.limit * 2)),
    ]);

    // Build a map of all results
    const resultMap = new Map<string, HybridSearchResult>();

    // Normalize and add vector results
    const maxVectorScore = Math.max(...vectorResults.map(r => r.score), 0.001);
    for (const result of vectorResults) {
      const normalizedScore = result.score / maxVectorScore;
      resultMap.set(result.id, {
        id: result.id,
        content: result.content,
        category: result.category,
        vectorScore: normalizedScore,
        bm25Score: 0,
        score: normalizedScore * cfg.vectorWeight,
      });
    }

    // Normalize and merge BM25 results
    const maxBm25Score = Math.max(...bm25Results.map(r => r.score), 0.001);
    for (const result of bm25Results) {
      const normalizedScore = result.score / maxBm25Score;
      const existing = resultMap.get(result.id);

      if (existing) {
        existing.bm25Score = normalizedScore;
        existing.score += normalizedScore * (1 - cfg.vectorWeight);
      } else {
        // Get content from vector store
        const chunks = this.vectorStore.getAllChunks();
        const chunk = chunks.find(c => c.id === result.id);

        if (chunk) {
          resultMap.set(result.id, {
            id: result.id,
            content: chunk.content,
            category: chunk.category,
            vectorScore: 0,
            bm25Score: normalizedScore,
            score: normalizedScore * (1 - cfg.vectorWeight),
          });
        }
      }
    }

    // Convert to array, filter by min score, sort by combined score
    const results = Array.from(resultMap.values())
      .filter(r => r.score >= cfg.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.limit);

    return results;
  }

  /**
   * Rebuild BM25 index from vector store
   * Useful when starting up or after bulk operations
   */
  rebuildBm25Index(): void {
    this.bm25Index.clear();
    const chunks = this.vectorStore.getAllChunks();
    for (const chunk of chunks) {
      this.bm25Index.addDocument(chunk.id, chunk.content);
    }
    console.log(`[HybridSearch] Rebuilt BM25 index with ${chunks.length} documents`);
  }

  /**
   * Get statistics about the indexes
   */
  getStats(): { vectorCount: number; bm25Count: number } {
    return {
      vectorCount: this.vectorStore.getCount(),
      bm25Count: this.bm25Index.size,
    };
  }

  /**
   * Update search config
   */
  setConfig(config: Partial<HybridSearchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get BM25 index for direct access
   */
  getBm25Index(): BM25Index {
    return this.bm25Index;
  }
}
