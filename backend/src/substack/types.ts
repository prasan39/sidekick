/**
 * Substack Newsletter Digest Pipeline — Type Definitions
 */

export interface RawEmail {
  id: string;               // Gmail message ID
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;             // ISO 8601
  headers: Record<string, string>;
  bodyHtml: string;
  bodyText: string;
}

export interface ExtractedNewsletter {
  gmailId: string;
  subject: string;
  from: string;
  publication: string;      // e.g. "Lenny's Newsletter"
  receivedAt: string;
  bodyText: string;          // cleaned text (HTML stripped)
}

export interface DigestSection {
  tldr: string[];            // one bullet per newsletter
  keyInsights: string[];     // 3-5 important ideas with citations
  ahaMoments: string[];      // 1-3 surprising points
  actionItems: string[];     // concrete recommendations
  connections: string;       // cross-newsletter themes
}

export interface DigestReport {
  id: string;
  date: string;              // YYYY-MM-DD
  newsletterCount: number;
  content: string;           // full markdown digest
  sections: DigestSection;
  newsletters: Array<{ publication: string; subject: string }>;
  createdAt: string;
}

export interface ProcessedEmail {
  gmailId: string;
  subject: string;
  fromAddr: string;
  publication: string;
  receivedAt: string;
  processedAt: string;
  digestId: string | null;
  bodyText: string;
}

export interface SyncState {
  key: string;
  value: string;
  updatedAt: string;
}

export interface PipelineStatus {
  enabled: boolean;
  isRunning: boolean;
  lastRunAt: string | null;
  lastRunNewsletterCount: number;
  nextScheduledRun: string | null;
  cronExpression: string;
  gmailConnected: boolean;
  notionConnected: boolean;
  totalProcessed: number;
  totalDigests: number;
}

export interface PipelineRunResult {
  success: boolean;
  newsletterCount: number;
  digestId: string | null;
  notionBlockId: string | null;
  error?: string;
}

export interface SubstackPipelineConfig {
  enabled: boolean;
  cronExpression: string;
  gmailClientId: string;
  gmailClientSecret: string;
  gmailRefreshToken: string;
  notionApiKey: string;
  notionPageId: string;
  emailAddress: string;
}
