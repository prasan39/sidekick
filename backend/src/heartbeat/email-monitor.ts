/**
 * Email Monitor
 * Polls for new emails via Work IQ and uses Copilot SDK to parse + draft responses.
 * No fragile regex - uses LLM to extract structured data and generate drafts.
 */

import type { EmailInfo, DraftResponse } from './types.js';
import { notifier } from './notifier.js';
import { taskManager } from './task-manager.js';

export interface EmailMonitorConfig {
  checkInterval: number;          // ms between checks
  autoDraftEnabled: boolean;      // Auto-generate draft responses
  importantSendersOnly: boolean;  // Only notify for important senders
  importantSenders: string[];     // List of important sender emails/domains
}

const DEFAULT_CONFIG: EmailMonitorConfig = {
  checkInterval: 3600000,         // 1 hour
  autoDraftEnabled: true,
  importantSendersOnly: false,
  importantSenders: [],
};

// Callback type for querying emails via Work IQ (has MCP access)
export type EmailQueryCallback = (query: string) => Promise<string>;

// Callback type for LLM calls without MCP (for parsing / drafting)
export type LLMCallback = (prompt: string) => Promise<string>;

// Callback type for generating draft responses via Copilot
export type DraftGeneratorCallback = (email: EmailInfo) => Promise<DraftResponse>;

// Callback when an email check cycle completes
export type CheckCompleteCallback = (result: { found: number; timestamp: string }) => void;

/**
 * Monitors emails and generates draft responses
 */
export class EmailMonitor {
  private config: EmailMonitorConfig;
  private seenEmailIds: Set<string> = new Set();
  private intervalId?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private isChecking = false;

  // External callbacks (set by the main app)
  private emailQueryCallback?: EmailQueryCallback;
  private llmCallback?: LLMCallback;
  private draftGeneratorCallback?: DraftGeneratorCallback;
  private checkCompleteCallback?: CheckCompleteCallback;

  // Draft storage
  private drafts: Map<string, DraftResponse> = new Map();

  constructor(config: Partial<EmailMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setEmailQueryCallback(callback: EmailQueryCallback): void {
    this.emailQueryCallback = callback;
  }

  setLLMCallback(callback: LLMCallback): void {
    this.llmCallback = callback;
  }

  setDraftGeneratorCallback(callback: DraftGeneratorCallback): void {
    this.draftGeneratorCallback = callback;
  }

  setCheckCompleteCallback(callback: CheckCompleteCallback): void {
    this.checkCompleteCallback = callback;
  }

  start(): void {
    if (this.isRunning) return;

    console.log(`[EmailMonitor] Starting email monitoring (interval: ${this.config.checkInterval}ms)`);
    this.isRunning = true;

    // Check immediately on start
    this.checkEmails();

    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkEmails();
    }, this.config.checkInterval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log('[EmailMonitor] Stopped');
  }

  /**
   * Check for new emails - uses two LLM calls:
   * 1. Work IQ query to fetch emails (has M365 access)
   * 2. LLM call to parse the response into structured JSON
   */
  async checkEmails(): Promise<void> {
    if (!this.emailQueryCallback) {
      console.warn('[EmailMonitor] No email query callback set');
      return;
    }

    // Prevent overlapping checks
    if (this.isChecking) {
      console.log('[EmailMonitor] Already checking, skipping...');
      return;
    }

    this.isChecking = true;

    try {
      // Step 1: Query Work IQ for emails where I'm in the To field
      console.log('[EmailMonitor] Checking for new emails...');
      const rawResponse = await this.emailQueryCallback(
        'Show me all emails I received in the last 2 hours, both read and unread. For each email show the sender name, email address, subject, received date/time, and a brief preview of the body. Include everything — internal, external, notifications, all of them.\n\nIMPORTANT: This is an automated background check. Just report the facts. Do NOT ask follow-up questions, do NOT suggest next steps, do NOT offer to do anything else. Just list the emails or say "No matching emails found".'
      );

      console.log('[EmailMonitor] Got Work IQ response, parsing with LLM...');
      console.log('[EmailMonitor] Raw response preview:', rawResponse.substring(0, 300));

      // Step 2: Use LLM to parse into structured JSON (no fragile regex!)
      const emails = await this.parseWithLLM(rawResponse);

      if (emails.length === 0) {
        console.log('[EmailMonitor] No actionable emails found');
        this.checkCompleteCallback?.({ found: 0, timestamp: new Date().toISOString() });
        this.isChecking = false;
        return;
      }

      // Filter for new emails we haven't seen
      const newEmails = emails.filter(email => !this.seenEmailIds.has(email.id));

      if (newEmails.length === 0) {
        console.log('[EmailMonitor] All emails already seen');
        this.checkCompleteCallback?.({ found: 0, timestamp: new Date().toISOString() });
        this.isChecking = false;
        return;
      }

      console.log(`[EmailMonitor] Found ${newEmails.length} new personal emails`);

      let processedCount = 0;
      for (const email of newEmails) {
        this.seenEmailIds.add(email.id);

        // Final safety check: skip automated senders
        if (this.isIgnoredSender(email.from)) {
          console.log(`[EmailMonitor] Skipping ignored sender: ${email.from}`);
          continue;
        }

        processedCount++;

        // Notify about new email
        notifier.notifyNewEmail(email.from, email.subject, email.preview, email.id);

        // Add email as a pending task (user decides whether to draft)
        taskManager.submit(
          'email_draft',
          `New email: "${email.subject}" from ${email.from}`,
          async () => email,  // no-op executor, just stores the email info
          { emailId: email.id, emailFrom: email.from, emailSubject: email.subject, emailPreview: email.preview },
          { requiresReview: true }
        );
      }

      this.checkCompleteCallback?.({ found: processedCount, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('[EmailMonitor] Error checking emails:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Use the LLM to parse the Work IQ response into structured EmailInfo[]
   * Much more reliable than regex - the LLM understands natural language responses.
   */
  private async parseWithLLM(rawResponse: string): Promise<EmailInfo[]> {
    if (!this.llmCallback) {
      console.warn('[EmailMonitor] No LLM callback set, falling back to basic parse');
      return this.basicParse(rawResponse);
    }

    try {
      const parsePrompt = `You are a JSON extractor. Given this email listing response, extract ALL emails into a JSON array.

RESPONSE TO PARSE:
${rawResponse}

RULES:
- Include ALL emails — from people, services, notifications, everything
- Only exclude noreply/mailer-daemon addresses
- If the response says "no emails", "no unread", "no matching", or similar, return an empty array []
- Each email object should have: "from" (sender name + email), "subject", "preview" (body summary)

Return ONLY a valid JSON array, nothing else. Example:
[{"from": "John Smith <john@company.com>", "subject": "Project update", "preview": "Hi, wanted to share the latest..."}]

If no emails, return: []`;

      const result = await this.llmCallback(parsePrompt);
      console.log('[EmailMonitor] LLM parse result:', result.substring(0, 300));

      // Extract JSON from the response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.log('[EmailMonitor] LLM returned no JSON array, raw:', result.substring(0, 200));
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{ from: string; subject: string; preview: string }>;

      return parsed.map(e => ({
        id: this.generateEmailId(e.from, e.subject),
        from: e.from,
        subject: e.subject,
        preview: e.preview || e.subject.substring(0, 100),
        receivedAt: new Date().toISOString(),
        isRead: false,
        importance: this.isImportantSender(e.from) ? 'high' : 'normal',
      }));
    } catch (error) {
      console.error('[EmailMonitor] LLM parse failed, falling back to basic parse:', error);
      return this.basicParse(rawResponse);
    }
  }

  /**
   * Basic fallback parser (From:/Subject: pattern only)
   */
  private basicParse(response: string): EmailInfo[] {
    const lower = response.toLowerCase();
    if (lower.includes('no emails') || lower.includes('no unread') || lower.includes('no matching') || lower.includes('no new')) {
      return [];
    }

    const emails: EmailInfo[] = [];
    const pattern = /From:\s*([^\n]+?)\s*(?:\n\s*)?Subject:\s*([^\n]+)/gi;
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const from = match[1].trim();
      const subject = match[2].trim();
      if (from.length < 2 || subject.length < 2) continue;
      if (/^(no|none|empty|n\/a)/i.test(from)) continue;

      const id = this.generateEmailId(from, subject);
      if (!emails.find(e => e.id === id)) {
        emails.push({
          id, from, subject,
          preview: subject.substring(0, 100),
          receivedAt: new Date().toISOString(),
          isRead: false,
          importance: this.isImportantSender(from) ? 'high' : 'normal',
        });
      }
    }
    return emails;
  }

  private generateEmailId(from: string, subject: string): string {
    const content = `${from}:${subject}`.toLowerCase();
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `email_${Math.abs(hash).toString(36)}`;
  }

  private isImportantSender(from: string): boolean {
    const fromLower = from.toLowerCase();
    return this.config.importantSenders.some(sender =>
      fromLower.includes(sender.toLowerCase())
    );
  }

  /**
   * Filter out only truly automated no-reply senders
   */
  private isIgnoredSender(from: string): boolean {
    const fromLower = from.toLowerCase();

    const noReplyPatterns = [
      'noreply', 'no-reply', 'no_reply',
      'donotreply', 'do-not-reply', 'do_not_reply',
      'mailer-daemon', 'postmaster',
    ];
    return noReplyPatterns.some(p => fromLower.includes(p));
  }

  async generateDraftResponse(email: EmailInfo): Promise<void> {
    if (!this.draftGeneratorCallback) {
      console.warn('[EmailMonitor] No draft generator callback set');
      return;
    }

    taskManager.submit(
      'email_draft',
      `Drafting response to "${email.subject}" from ${email.from}`,
      async (_task, updateProgress) => {
        updateProgress(20);

        const draft = await this.draftGeneratorCallback!(email);
        updateProgress(80);

        this.drafts.set(email.id, draft);

        notifier.notifyDraftReady(
          email.id,
          email.from,
          email.subject,
          draft.body.substring(0, 150)
        );

        updateProgress(100);
        return draft;
      },
      { emailId: email.id, emailSubject: email.subject },
      { requiresReview: true }
    );
  }

  getDraft(emailId: string): DraftResponse | undefined {
    return this.drafts.get(emailId);
  }

  getAllDrafts(): Map<string, DraftResponse> {
    return new Map(this.drafts);
  }

  deleteDraft(emailId: string): boolean {
    return this.drafts.delete(emailId);
  }

  addImportantSender(sender: string): void {
    if (!this.config.importantSenders.includes(sender)) {
      this.config.importantSenders.push(sender);
    }
  }

  removeImportantSender(sender: string): void {
    const index = this.config.importantSenders.indexOf(sender);
    if (index >= 0) {
      this.config.importantSenders.splice(index, 1);
    }
  }

  setConfig(config: Partial<EmailMonitorConfig>): void {
    const wasRunning = this.isRunning;
    if (wasRunning) this.stop();
    this.config = { ...this.config, ...config };
    if (wasRunning) this.start();
  }

  getConfig(): EmailMonitorConfig {
    return { ...this.config };
  }

  isMonitoring(): boolean {
    return this.isRunning;
  }

  clearSeenEmails(): void {
    this.seenEmailIds.clear();
  }

  async forceCheck(): Promise<void> {
    await this.checkEmails();
  }
}

// Singleton instance
export const emailMonitor = new EmailMonitor();
