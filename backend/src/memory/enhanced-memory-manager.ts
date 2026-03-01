/**
 * Enhanced Memory Manager - OpenClaw-style persistent memory
 *
 * Features:
 * - Two-layer memory: MEMORY.md (durable facts) + daily logs (conversation context)
 * - Hybrid search: BM25 (keyword) + Vector (semantic) combined
 * - Pre-compaction flush: Auto-save important facts before context limit
 * - File-based canonical storage with derived SQLite index
 *
 * Philosophy (from OpenClaw):
 * "Files are the source of truth. The database serves the files, not the other way around."
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { VectorStore } from './vector-store.js';
import { HybridSearch, HybridSearchResult } from './hybrid-search.js';
import { parseMemoryFile, parseDailyLog, FileWatcher, ParsedChunk } from './chunker.js';
import { CompactionGuard, extractImportantFacts } from './compaction-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MemoryEntry {
  ts: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type?: 'tool';
  name?: string;
  args?: Record<string, unknown>;
}

export interface RecallResult {
  content: string;
  category: string;
  score: number;
  source: 'memory' | 'conversation';
}

/**
 * Enhanced Memory Manager with OpenClaw-style features
 */
export class EnhancedMemoryManager {
  private dataDir: string;
  private memoryPath: string;
  private dailyLogPath: string;

  // Enhanced search components
  private vectorStore: VectorStore;
  private hybridSearch: HybridSearch;
  private memoryWatcher: FileWatcher;
  private compactionGuard: CompactionGuard;

  // Initialization state
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(dataDir: string = path.join(__dirname, '..', '..', 'data')) {
    this.dataDir = dataDir;
    this.memoryPath = path.join(dataDir, 'MEMORY.md');
    this.dailyLogPath = path.join(dataDir, `daily-${this.getDateString()}.jsonl`);

    // Ensure directories exist
    this.ensureDataDir();
    this.ensureMemoryFile();

    // Initialize components
    this.vectorStore = new VectorStore(dataDir);
    this.hybridSearch = new HybridSearch(this.vectorStore);
    this.memoryWatcher = new FileWatcher(this.memoryPath, parseMemoryFile);
    this.compactionGuard = new CompactionGuard();

    // Set up compaction guard flush callback
    this.compactionGuard.onFlush(async (facts) => {
      console.log(`[Memory] Pre-compaction flush: saving ${facts.length} facts`);
      for (const fact of facts) {
        this.remember(fact, 'Notes');
      }
    });
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private ensureMemoryFile(): void {
    if (!fs.existsSync(this.memoryPath)) {
      const initialMemory = `# User Profile
- Name: (Not set)
- Role: (Not set)

# Preferences
- (No preferences recorded yet)

# Current Projects
- (No projects recorded yet)

# Key Contacts
- (No contacts recorded yet)

# Important Dates
- (No dates recorded yet)

# Notes
- Memory initialized on ${new Date().toISOString()}
`;
      fs.writeFileSync(this.memoryPath, initialMemory, 'utf-8');
    }
  }

  /**
   * Initialize vector store and build search index
   * Call this before using semantic search features
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    console.log('[Memory] Initializing enhanced memory system...');

    try {
      // Parse and index MEMORY.md
      const chunks = this.memoryWatcher.forceReparse();
      console.log(`[Memory] Found ${chunks.length} memory chunks`);

      // Index all chunks
      for (const chunk of chunks) {
        await this.hybridSearch.indexDocument(chunk.id, chunk.content, chunk.category);
      }

      // Rebuild BM25 index
      this.hybridSearch.rebuildBm25Index();

      this.isInitialized = true;
      console.log('[Memory] Enhanced memory system ready');
      console.log(`[Memory] Stats: ${JSON.stringify(this.hybridSearch.getStats())}`);
    } catch (error) {
      console.error('[Memory] Initialization error:', error);
      // Fall back to basic mode without semantic search
      this.isInitialized = true;
    }
  }

  // ==================== BASIC MEMORY OPERATIONS ====================

  /**
   * Get full memory content for system prompt
   */
  getMemory(): string {
    try {
      return fs.readFileSync(this.memoryPath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Add a fact to memory (and index it)
   */
  remember(fact: string, category?: string): { success: boolean; message: string } {
    try {
      let memory = this.getMemory();
      const timestamp = new Date().toISOString();
      const entry = `- ${fact} [Added: ${timestamp.split('T')[0]}]`;
      const targetCategory = category || 'Notes';

      // Try to find the category section
      const categoryRegex = new RegExp(`(# ${targetCategory}[^\n]*\n)`, 'i');
      const match = memory.match(categoryRegex);

      if (match) {
        // Insert after the category header
        memory = memory.replace(categoryRegex, `$1${entry}\n`);
      } else {
        // Add new category at the end
        memory += `\n# ${targetCategory}\n${entry}\n`;
      }

      fs.writeFileSync(this.memoryPath, memory, 'utf-8');
      this.logMessage({ role: 'system', content: `Remembered: ${fact}` });

      // Index the new fact (async, don't block)
      this.indexNewFact(fact, targetCategory).catch(err => {
        console.error('[Memory] Failed to index fact:', err);
      });

      return { success: true, message: `Remembered: "${fact}" in ${targetCategory}` };
    } catch (error) {
      return { success: false, message: `Failed to remember: ${error}` };
    }
  }

  /**
   * Index a new fact in the search system
   */
  private async indexNewFact(fact: string, category: string): Promise<void> {
    if (!this.isInitialized) return;

    const id = `fact_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await this.hybridSearch.indexDocument(id, fact, category);
  }

  /**
   * Remove a fact from memory (and index)
   */
  forget(fact: string): { success: boolean; message: string } {
    try {
      let memory = this.getMemory();
      const lines = memory.split('\n');
      const factLower = fact.toLowerCase();

      const filteredLines = lines.filter(line => {
        const lineLower = line.toLowerCase();
        return !lineLower.includes(factLower);
      });

      if (filteredLines.length === lines.length) {
        return { success: false, message: `Could not find "${fact}" in memory` };
      }

      fs.writeFileSync(this.memoryPath, filteredLines.join('\n'), 'utf-8');
      this.logMessage({ role: 'system', content: `Forgot: ${fact}` });

      // Re-index memory (simple approach - full rebuild)
      this.rebuildIndex().catch(err => {
        console.error('[Memory] Failed to rebuild index:', err);
      });

      return { success: true, message: `Forgot information about: "${fact}"` };
    } catch (error) {
      return { success: false, message: `Failed to forget: ${error}` };
    }
  }

  // ==================== ENHANCED SEARCH ====================

  /**
   * Search memory using hybrid search (semantic + keyword)
   * This is the OpenClaw-style recall that handles both exact matches and semantic queries
   */
  async recall(query: string, limit: number = 10): Promise<RecallResult[]> {
    // Ensure initialized
    await this.initialize();

    // Use hybrid search
    const results = await this.hybridSearch.search(query, { limit });

    return results.map(r => ({
      content: r.content,
      category: r.category,
      score: r.score,
      source: r.category.startsWith('conversation_') ? 'conversation' as const : 'memory' as const,
    }));
  }

  /**
   * Simple keyword search (fallback, always available)
   */
  recallKeyword(query: string): string[] {
    const memory = this.getMemory();
    const lines = memory.split('\n');
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    return lines.filter(line => {
      const lineLower = line.toLowerCase();
      return queryWords.some(word => lineLower.includes(word));
    });
  }

  // ==================== DAILY LOG OPERATIONS ====================

  /**
   * Log a message to daily transcript
   */
  logMessage(entry: Partial<MemoryEntry>): void {
    try {
      // Update daily log path in case date changed
      this.dailyLogPath = path.join(this.dataDir, `daily-${this.getDateString()}.jsonl`);

      const fullEntry: MemoryEntry = {
        ts: new Date().toISOString(),
        role: entry.role || 'system',
        content: entry.content || '',
        ...entry,
      };

      fs.appendFileSync(this.dailyLogPath, JSON.stringify(fullEntry) + '\n', 'utf-8');

      // Track tokens for compaction guard
      this.compactionGuard.addMessage(fullEntry.content);
    } catch (error) {
      console.error('Failed to log message:', error);
    }
  }

  /**
   * Log a tool call
   */
  logToolCall(name: string, args: Record<string, unknown>): void {
    this.logMessage({
      role: 'system',
      content: `Tool call: ${name}`,
      type: 'tool',
      name,
      args,
    });
  }

  /**
   * Write a session-clear marker to the JSONL log.
   * getRecentContext will only return entries after the last clear marker.
   */
  clearConversationLog(): void {
    this.logMessage({
      role: 'system',
      content: '__session_clear__',
    });
  }

  /**
   * Get recent conversation context (only entries after the last clear marker)
   */
  getRecentContext(lines: number = 50): MemoryEntry[] {
    try {
      if (!fs.existsSync(this.dailyLogPath)) {
        return [];
      }

      const content = fs.readFileSync(this.dailyLogPath, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);

      // Parse all entries
      const allEntries = allLines.map(line => {
        try {
          return JSON.parse(line) as MemoryEntry;
        } catch {
          return null;
        }
      }).filter((entry): entry is MemoryEntry => entry !== null);

      // Find the last clear marker and only return entries after it
      let lastClearIndex = -1;
      for (let i = allEntries.length - 1; i >= 0; i--) {
        if (allEntries[i].content === '__session_clear__') {
          lastClearIndex = i;
          break;
        }
      }
      const entries = lastClearIndex >= 0
        ? allEntries.slice(lastClearIndex + 1)
        : allEntries;

      return entries.slice(-lines);
    } catch {
      return [];
    }
  }

  // ==================== COMPACTION GUARD ====================

  /**
   * Check if pre-compaction flush is needed
   */
  shouldFlush(): boolean {
    return this.compactionGuard.shouldFlush();
  }

  /**
   * Get compaction status
   */
  getCompactionStatus(): {
    tokens: number;
    maxTokens: number;
    usagePercent: number;
    shouldFlush: boolean;
  } {
    return this.compactionGuard.getStatus();
  }

  /**
   * Trigger pre-compaction memory flush
   * Extracts important facts from recent conversation and saves them
   */
  async triggerPreCompactionFlush(): Promise<string[]> {
    const recentMessages = this.getRecentContext(100)
      .filter(e => e.role === 'user' || e.role === 'assistant')
      .map(e => e.content);

    const facts = extractImportantFacts(recentMessages);

    for (const fact of facts) {
      this.remember(fact, 'Notes');
    }

    console.log(`[Memory] Pre-compaction flush saved ${facts.length} facts`);
    return facts;
  }

  // ==================== INDEX MANAGEMENT ====================

  /**
   * Rebuild the entire search index from MEMORY.md
   */
  async rebuildIndex(): Promise<void> {
    console.log('[Memory] Rebuilding search index...');

    // Clear and rebuild
    this.vectorStore.clear();

    const chunks = this.memoryWatcher.forceReparse();

    for (const chunk of chunks) {
      await this.hybridSearch.indexDocument(chunk.id, chunk.content, chunk.category);
    }

    this.hybridSearch.rebuildBm25Index();

    console.log(`[Memory] Index rebuilt with ${chunks.length} chunks`);
  }

  /**
   * Sync index with current MEMORY.md (incremental update)
   */
  async syncIndex(): Promise<{ added: number; removed: number }> {
    const changes = this.memoryWatcher.checkForChanges();

    if (!changes.hasChanges) {
      return { added: 0, removed: 0 };
    }

    // Remove deleted chunks
    for (const chunk of changes.removed) {
      this.hybridSearch.removeDocument(chunk.id);
    }

    // Add new chunks
    for (const chunk of changes.added) {
      await this.hybridSearch.indexDocument(chunk.id, chunk.content, chunk.category);
    }

    return {
      added: changes.added.length,
      removed: changes.removed.length,
    };
  }

  // ==================== CONTEXT & STATS ====================

  /**
   * Get full context for session initialization
   */
  getFullContext(): { memory: string; recentConversation: MemoryEntry[] } {
    return {
      memory: this.getMemory(),
      recentConversation: this.getRecentContext(),
    };
  }

  /**
   * Update memory file directly
   */
  updateMemory(content: string): { success: boolean; message: string } {
    try {
      fs.writeFileSync(this.memoryPath, content, 'utf-8');

      // Trigger index rebuild
      this.rebuildIndex().catch(err => {
        console.error('[Memory] Failed to rebuild index after update:', err);
      });

      return { success: true, message: 'Memory updated successfully' };
    } catch (error) {
      return { success: false, message: `Failed to update memory: ${error}` };
    }
  }

  /**
   * Get daily log stats
   */
  getDailyStats(): { messageCount: number; toolCalls: number; date: string } {
    const entries = this.getRecentContext(10000);
    return {
      messageCount: entries.filter(e => e.role !== 'system').length,
      toolCalls: entries.filter(e => e.type === 'tool').length,
      date: this.getDateString(),
    };
  }

  /**
   * Get search index stats
   */
  getIndexStats(): { vectorCount: number; bm25Count: number; initialized: boolean } {
    return {
      ...this.hybridSearch.getStats(),
      initialized: this.isInitialized,
    };
  }

  /**
   * Close database connections
   */
  close(): void {
    this.vectorStore.close();
  }
}

// Singleton instance
export const enhancedMemoryManager = new EnhancedMemoryManager();
