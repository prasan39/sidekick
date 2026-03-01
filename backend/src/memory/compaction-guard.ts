/**
 * Compaction Guard - Pre-compaction memory flush
 * Based on OpenClaw's approach: automatically save important context before context window fills up
 *
 * When context approaches limit:
 * 1. Detect we're close to compaction
 * 2. Extract important facts from recent conversation
 * 3. Save to MEMORY.md before context is lost
 *
 * This prevents losing valuable information during long conversations.
 */

export interface CompactionConfig {
  // Maximum tokens before triggering pre-compaction flush
  maxTokens: number;
  // Trigger flush when reaching this percentage of max
  flushThreshold: number;
  // Minimum tokens in conversation before considering flush
  minTokensForFlush: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
  maxTokens: 200000,      // Claude Opus 4.5 has ~200K context
  flushThreshold: 0.75,   // Flush at 75% capacity
  minTokensForFlush: 10000,
};

/**
 * Estimate token count for text (rough approximation)
 * ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract important facts from conversation that should be saved
 */
export function extractImportantFacts(conversation: string[]): string[] {
  const facts: string[] = [];
  const patterns = [
    // User preferences
    /(?:I prefer|I like|I want|I need|I always|I never|my favorite)\s+([^.!?]+)/gi,
    // Decisions made
    /(?:let's go with|we decided|the decision is|I chose|we'll use)\s+([^.!?]+)/gi,
    // Important information
    /(?:my name is|I work at|my email is|my phone is|I'm responsible for)\s+([^.!?]+)/gi,
    // Project details
    /(?:the project|this feature|the deadline|the goal is|we're building)\s+([^.!?]+)/gi,
    // Key contacts
    /(?:contact|reach out to|email|call|message)\s+(\w+(?:\s+\w+)?)\s+(?:about|for|regarding)/gi,
  ];

  const fullText = conversation.join(' ');

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const fact = match[0].trim();
      if (fact.length > 10 && fact.length < 200) {
        facts.push(fact);
      }
    }
  }

  // Deduplicate
  return [...new Set(facts)];
}

/**
 * Compaction Guard monitors conversation length and triggers memory flush
 */
export class CompactionGuard {
  private config: CompactionConfig;
  private conversationTokens: number = 0;
  private lastFlushTokens: number = 0;
  private onFlushCallback?: (facts: string[]) => Promise<void>;

  constructor(config: Partial<CompactionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callback for when flush is triggered
   */
  onFlush(callback: (facts: string[]) => Promise<void>): void {
    this.onFlushCallback = callback;
  }

  /**
   * Update token count with new message
   */
  addMessage(content: string): void {
    this.conversationTokens += estimateTokens(content);
  }

  /**
   * Check if we should trigger pre-compaction flush
   */
  shouldFlush(): boolean {
    const threshold = this.config.maxTokens * this.config.flushThreshold;
    return (
      this.conversationTokens >= threshold &&
      this.conversationTokens >= this.config.minTokensForFlush &&
      this.conversationTokens - this.lastFlushTokens >= this.config.minTokensForFlush
    );
  }

  /**
   * Get current usage percentage
   */
  getUsagePercent(): number {
    return (this.conversationTokens / this.config.maxTokens) * 100;
  }

  /**
   * Get status info
   */
  getStatus(): {
    tokens: number;
    maxTokens: number;
    usagePercent: number;
    shouldFlush: boolean;
  } {
    return {
      tokens: this.conversationTokens,
      maxTokens: this.config.maxTokens,
      usagePercent: this.getUsagePercent(),
      shouldFlush: this.shouldFlush(),
    };
  }

  /**
   * Trigger pre-compaction flush
   */
  async flush(recentMessages: string[]): Promise<string[]> {
    const facts = extractImportantFacts(recentMessages);

    if (facts.length > 0 && this.onFlushCallback) {
      await this.onFlushCallback(facts);
    }

    this.lastFlushTokens = this.conversationTokens;

    return facts;
  }

  /**
   * Reset after session clear
   */
  reset(): void {
    this.conversationTokens = 0;
    this.lastFlushTokens = 0;
  }
}

/**
 * Singleton compaction guard instance
 */
export const compactionGuard = new CompactionGuard();
