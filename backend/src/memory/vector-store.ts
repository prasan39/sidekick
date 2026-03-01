/**
 * Vector Store using better-sqlite3
 * Stores embeddings for semantic search
 * File-based, no external services required
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { generateEmbedding, cosineSimilarity, EMBEDDING_DIMENSION } from './embeddings.js';

export interface MemoryChunk {
  id: string;
  content: string;
  category: string;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  content: string;
  category: string;
  score: number;
}

/**
 * SQLite-based vector store for memory embeddings
 */
export class VectorStore {
  private db: Database.Database;
  private dbPath: string;

  constructor(dataDir: string) {
    this.dbPath = path.join(dataDir, 'memory.sqlite');
    this.ensureDir(dataDir);
    this.db = new Database(this.dbPath);
    this.initialize();
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');

    // Create chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        embedding BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Create index on category for filtered searches
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_category ON chunks(category)
    `);

    console.log('[VectorStore] Database initialized at', this.dbPath);
  }

  /**
   * Add or update a chunk with its embedding
   */
  async upsertChunk(chunk: Omit<MemoryChunk, 'embedding'>): Promise<void> {
    const embedding = await generateEmbedding(chunk.content);
    const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

    const stmt = this.db.prepare(`
      INSERT INTO chunks (id, content, category, embedding, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        category = excluded.category,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      chunk.id,
      chunk.content,
      chunk.category,
      embeddingBuffer,
      chunk.createdAt,
      chunk.updatedAt
    );
  }

  /**
   * Add multiple chunks efficiently
   */
  async upsertChunks(chunks: Omit<MemoryChunk, 'embedding'>[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (id, content, category, embedding, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        category = excluded.category,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at
    `);

    const insertMany = this.db.transaction(async (chunks: Omit<MemoryChunk, 'embedding'>[]) => {
      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk.content);
        const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
        stmt.run(
          chunk.id,
          chunk.content,
          chunk.category,
          embeddingBuffer,
          chunk.createdAt,
          chunk.updatedAt
        );
      }
    });

    await insertMany(chunks);
  }

  /**
   * Remove a chunk by ID
   */
  deleteChunk(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM chunks WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Remove chunks by category
   */
  deleteByCategory(category: string): number {
    const stmt = this.db.prepare('DELETE FROM chunks WHERE category = ?');
    const result = stmt.run(category);
    return result.changes;
  }

  /**
   * Search for similar chunks using vector similarity
   */
  async searchSimilar(query: string, limit: number = 10, category?: string): Promise<SearchResult[]> {
    const queryEmbedding = await generateEmbedding(query);

    // Get all chunks (or filtered by category)
    let chunks: { id: string; content: string; category: string; embedding: Buffer }[];

    if (category) {
      const stmt = this.db.prepare('SELECT id, content, category, embedding FROM chunks WHERE category = ?');
      chunks = stmt.all(category) as typeof chunks;
    } else {
      const stmt = this.db.prepare('SELECT id, content, category, embedding FROM chunks');
      chunks = stmt.all() as typeof chunks;
    }

    // Calculate similarity scores
    const results: SearchResult[] = [];

    for (const chunk of chunks) {
      if (!chunk.embedding) continue;

      // Convert buffer back to float array
      const embedding = Array.from(new Float32Array(chunk.embedding.buffer.slice(
        chunk.embedding.byteOffset,
        chunk.embedding.byteOffset + chunk.embedding.byteLength
      )));

      const score = cosineSimilarity(queryEmbedding, embedding);

      results.push({
        id: chunk.id,
        content: chunk.content,
        category: chunk.category,
        score,
      });
    }

    // Sort by similarity score (descending) and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get all chunks
   */
  getAllChunks(): MemoryChunk[] {
    const stmt = this.db.prepare('SELECT id, content, category, created_at, updated_at FROM chunks');
    const rows = stmt.all() as { id: string; content: string; category: string; created_at: string; updated_at: string }[];

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get chunks by category
   */
  getChunksByCategory(category: string): MemoryChunk[] {
    const stmt = this.db.prepare('SELECT id, content, category, created_at, updated_at FROM chunks WHERE category = ?');
    const rows = stmt.all(category) as { id: string; content: string; category: string; created_at: string; updated_at: string }[];

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get chunk count
   */
  getCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Clear all chunks
   */
  clear(): void {
    this.db.exec('DELETE FROM chunks');
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
