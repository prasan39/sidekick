/**
 * Memory Chunker - Parses MEMORY.md into searchable chunks
 * Based on OpenClaw's approach: files are canonical, chunks are derived
 *
 * Chunking strategy:
 * - Split by category headers (# Header)
 * - Each bullet point becomes a chunk
 * - Preserve category context for better search
 */

import * as fs from 'fs';
import * as crypto from 'crypto';

export interface ParsedChunk {
  id: string;
  content: string;
  category: string;
  lineNumber: number;
  rawLine: string;
}

/**
 * Generate a stable ID for a chunk based on content and category
 */
function generateChunkId(category: string, content: string): string {
  const hash = crypto.createHash('md5')
    .update(`${category}:${content}`)
    .digest('hex')
    .substring(0, 12);
  return `chunk_${hash}`;
}

/**
 * Parse MEMORY.md file into searchable chunks
 */
export function parseMemoryFile(content: string): ParsedChunk[] {
  const lines = content.split('\n');
  const chunks: ParsedChunk[] = [];

  let currentCategory = 'Notes';
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check for category header
    if (trimmed.startsWith('# ')) {
      currentCategory = trimmed.substring(2).trim();
      continue;
    }

    // Check for bullet point (memory item)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.substring(2).trim();

      // Skip placeholder items
      if (content.startsWith('(') && content.includes('Not set') || content.includes('No ')) {
        continue;
      }

      // Skip empty or very short items
      if (content.length < 3) continue;

      // Clean up the content - remove date stamps for cleaner search
      const cleanContent = content.replace(/\s*\[Added:.*?\]/, '').trim();

      if (cleanContent.length < 3) continue;

      chunks.push({
        id: generateChunkId(currentCategory, cleanContent),
        content: cleanContent,
        category: currentCategory,
        lineNumber,
        rawLine: trimmed,
      });
    }
  }

  return chunks;
}

/**
 * Parse daily log files (JSONL format) into chunks
 */
export function parseDailyLog(content: string): ParsedChunk[] {
  const lines = content.split('\n').filter(Boolean);
  const chunks: ParsedChunk[] = [];

  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    try {
      const entry = JSON.parse(line);

      // Only include user and assistant messages
      if (entry.role === 'user' || entry.role === 'assistant') {
        const content = entry.content?.substring(0, 500) || '';
        if (content.length < 10) continue;

        chunks.push({
          id: generateChunkId('conversation', `${entry.ts}:${content}`),
          content,
          category: `conversation_${entry.role}`,
          lineNumber,
          rawLine: line,
        });
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return chunks;
}

/**
 * Diff two chunk lists to find changes
 */
export function diffChunks(
  oldChunks: ParsedChunk[],
  newChunks: ParsedChunk[]
): {
  added: ParsedChunk[];
  removed: ParsedChunk[];
  unchanged: ParsedChunk[];
} {
  const oldIds = new Set(oldChunks.map(c => c.id));
  const newIds = new Set(newChunks.map(c => c.id));

  return {
    added: newChunks.filter(c => !oldIds.has(c.id)),
    removed: oldChunks.filter(c => !newIds.has(c.id)),
    unchanged: newChunks.filter(c => oldIds.has(c.id)),
  };
}

/**
 * Watch a file for changes and return new chunks
 */
export class FileWatcher {
  private lastContent: string = '';
  private lastChunks: ParsedChunk[] = [];
  private filePath: string;
  private parseFunction: (content: string) => ParsedChunk[];

  constructor(filePath: string, parseFunction: (content: string) => ParsedChunk[]) {
    this.filePath = filePath;
    this.parseFunction = parseFunction;
  }

  /**
   * Check for changes and return diff
   */
  checkForChanges(): {
    hasChanges: boolean;
    added: ParsedChunk[];
    removed: ParsedChunk[];
    allChunks: ParsedChunk[];
  } {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');

      if (content === this.lastContent) {
        return {
          hasChanges: false,
          added: [],
          removed: [],
          allChunks: this.lastChunks,
        };
      }

      const newChunks = this.parseFunction(content);
      const diff = diffChunks(this.lastChunks, newChunks);

      this.lastContent = content;
      this.lastChunks = newChunks;

      return {
        hasChanges: diff.added.length > 0 || diff.removed.length > 0,
        added: diff.added,
        removed: diff.removed,
        allChunks: newChunks,
      };
    } catch {
      return {
        hasChanges: false,
        added: [],
        removed: [],
        allChunks: this.lastChunks,
      };
    }
  }

  /**
   * Force re-parse of file
   */
  forceReparse(): ParsedChunk[] {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const chunks = this.parseFunction(content);
      this.lastContent = content;
      this.lastChunks = chunks;
      return chunks;
    } catch {
      return [];
    }
  }
}
