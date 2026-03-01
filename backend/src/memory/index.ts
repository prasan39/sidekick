/**
 * Memory Module Exports
 * OpenClaw-style persistent memory with hybrid search
 */

// Core enhanced memory manager (use this as the main interface)
export { EnhancedMemoryManager, enhancedMemoryManager } from './enhanced-memory-manager.js';
export type { MemoryEntry, RecallResult } from './enhanced-memory-manager.js';

// Individual components (for advanced usage)
export { VectorStore } from './vector-store.js';
export type { MemoryChunk, SearchResult } from './vector-store.js';

export { HybridSearch } from './hybrid-search.js';
export type { HybridSearchResult, HybridSearchConfig } from './hybrid-search.js';

export { BM25Index, tokenize } from './bm25.js';
export type { BM25Document, BM25Result } from './bm25.js';

export { generateEmbedding, generateEmbeddings, cosineSimilarity, initEmbedder, EMBEDDING_DIMENSION } from './embeddings.js';

export { parseMemoryFile, parseDailyLog, diffChunks, FileWatcher } from './chunker.js';
export type { ParsedChunk } from './chunker.js';

export { CompactionGuard, compactionGuard, estimateTokens, extractImportantFacts } from './compaction-guard.js';
export type { CompactionConfig } from './compaction-guard.js';
