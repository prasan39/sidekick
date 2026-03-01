import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

export class MemoryManager {
  private dataDir: string;
  private memoryPath: string;
  private dailyLogPath: string;

  constructor(dataDir: string = path.join(__dirname, '..', 'data')) {
    this.dataDir = dataDir;
    this.memoryPath = path.join(dataDir, 'MEMORY.md');
    this.dailyLogPath = path.join(dataDir, `daily-${this.getDateString()}.jsonl`);

    this.ensureDataDir();
    this.ensureMemoryFile();
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

  // Get full memory content for system prompt
  getMemory(): string {
    try {
      return fs.readFileSync(this.memoryPath, 'utf-8');
    } catch {
      return '';
    }
  }

  // Add a fact to memory
  remember(fact: string, category?: string): { success: boolean; message: string } {
    try {
      let memory = this.getMemory();
      const timestamp = new Date().toISOString();
      const entry = `- ${fact} [Added: ${timestamp.split('T')[0]}]`;

      if (category) {
        // Try to find the category section
        const categoryRegex = new RegExp(`(# ${category}[^\n]*\n)`, 'i');
        const match = memory.match(categoryRegex);

        if (match) {
          // Insert after the category header
          memory = memory.replace(categoryRegex, `$1${entry}\n`);
        } else {
          // Add new category at the end
          memory += `\n# ${category}\n${entry}\n`;
        }
      } else {
        // Add to Notes section
        const notesRegex = /(# Notes[^\n]*\n)/i;
        if (memory.match(notesRegex)) {
          memory = memory.replace(notesRegex, `$1${entry}\n`);
        } else {
          memory += `\n# Notes\n${entry}\n`;
        }
      }

      fs.writeFileSync(this.memoryPath, memory, 'utf-8');
      this.logMessage({ role: 'system', content: `Remembered: ${fact}` });

      return { success: true, message: `Remembered: "${fact}"` };
    } catch (error) {
      return { success: false, message: `Failed to remember: ${error}` };
    }
  }

  // Remove a fact from memory
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

      return { success: true, message: `Forgot information about: "${fact}"` };
    } catch (error) {
      return { success: false, message: `Failed to forget: ${error}` };
    }
  }

  // Search memory for relevant context
  recall(query: string): string[] {
    const memory = this.getMemory();
    const lines = memory.split('\n');
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    return lines.filter(line => {
      const lineLower = line.toLowerCase();
      return queryWords.some(word => lineLower.includes(word));
    });
  }

  // Log a message to daily transcript
  logMessage(entry: Partial<MemoryEntry>): void {
    try {
      const fullEntry: MemoryEntry = {
        ts: new Date().toISOString(),
        role: entry.role || 'system',
        content: entry.content || '',
        ...entry,
      };

      fs.appendFileSync(this.dailyLogPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
    } catch (error) {
      console.error('Failed to log message:', error);
    }
  }

  // Log a tool call
  logToolCall(name: string, args: Record<string, unknown>): void {
    this.logMessage({
      role: 'system',
      content: `Tool call: ${name}`,
      type: 'tool',
      name,
      args,
    });
  }

  // Get recent conversation context
  getRecentContext(lines: number = 50): MemoryEntry[] {
    try {
      if (!fs.existsSync(this.dailyLogPath)) {
        return [];
      }

      const content = fs.readFileSync(this.dailyLogPath, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const recentLines = allLines.slice(-lines);

      return recentLines.map(line => {
        try {
          return JSON.parse(line) as MemoryEntry;
        } catch {
          return null;
        }
      }).filter((entry): entry is MemoryEntry => entry !== null);
    } catch {
      return [];
    }
  }

  // Get full context for session initialization
  getFullContext(): { memory: string; recentConversation: MemoryEntry[] } {
    return {
      memory: this.getMemory(),
      recentConversation: this.getRecentContext(),
    };
  }

  // Update memory file directly
  updateMemory(content: string): { success: boolean; message: string } {
    try {
      fs.writeFileSync(this.memoryPath, content, 'utf-8');
      return { success: true, message: 'Memory updated successfully' };
    } catch (error) {
      return { success: false, message: `Failed to update memory: ${error}` };
    }
  }

  // Get daily log stats
  getDailyStats(): { messageCount: number; toolCalls: number; date: string } {
    const entries = this.getRecentContext(10000);
    return {
      messageCount: entries.filter(e => e.role !== 'system').length,
      toolCalls: entries.filter(e => e.type === 'tool').length,
      date: this.getDateString(),
    };
  }
}

// Singleton instance
export const memoryManager = new MemoryManager();
