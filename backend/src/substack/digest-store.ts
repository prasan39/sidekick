/**
 * Substack Digest Store — SQLite persistence for processed emails, digests, and sync state
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessedEmail, DigestReport, SyncState } from './types.js';

export class DigestStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dataDir = dbPath ? path.dirname(dbPath) : path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const resolvedPath = dbPath || path.join(dataDir, 'substack.sqlite');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_emails (
        gmail_id TEXT PRIMARY KEY,
        subject TEXT,
        from_addr TEXT,
        publication TEXT,
        received_at TEXT,
        processed_at TEXT NOT NULL,
        digest_id TEXT,
        body_text TEXT
      );

      CREATE TABLE IF NOT EXISTS digests (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        newsletter_count INTEGER NOT NULL,
        content TEXT NOT NULL,
        notion_block_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_emails_digest ON processed_emails(digest_id);
      CREATE INDEX IF NOT EXISTS idx_emails_publication ON processed_emails(publication);
      CREATE INDEX IF NOT EXISTS idx_digests_date ON digests(date);
    `);
  }

  // ── Processed Emails ──

  isEmailProcessed(gmailId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM processed_emails WHERE gmail_id = ?').get(gmailId);
    return !!row;
  }

  markEmailProcessed(email: ProcessedEmail): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO processed_emails (gmail_id, subject, from_addr, publication, received_at, processed_at, digest_id, body_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email.gmailId, email.subject, email.fromAddr, email.publication,
      email.receivedAt, email.processedAt, email.digestId, email.bodyText
    );
  }

  searchEmails(keyword: string, limit = 20): ProcessedEmail[] {
    const rows = this.db.prepare(`
      SELECT * FROM processed_emails
      WHERE body_text LIKE ? OR subject LIKE ? OR publication LIKE ?
      ORDER BY received_at DESC LIMIT ?
    `).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit) as any[];

    return rows.map(r => ({
      gmailId: r.gmail_id,
      subject: r.subject,
      fromAddr: r.from_addr,
      publication: r.publication,
      receivedAt: r.received_at,
      processedAt: r.processed_at,
      digestId: r.digest_id,
      bodyText: r.body_text,
    }));
  }

  getEmailsByPublication(publication: string, limit = 20): ProcessedEmail[] {
    const rows = this.db.prepare(`
      SELECT * FROM processed_emails
      WHERE publication LIKE ? ORDER BY received_at DESC LIMIT ?
    `).all(`%${publication}%`, limit) as any[];

    return rows.map(r => ({
      gmailId: r.gmail_id,
      subject: r.subject,
      fromAddr: r.from_addr,
      publication: r.publication,
      receivedAt: r.received_at,
      processedAt: r.processed_at,
      digestId: r.digest_id,
      bodyText: r.body_text,
    }));
  }

  getTotalProcessed(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM processed_emails').get() as any;
    return row.count;
  }

  // ── Digests ──

  saveDigest(digest: DigestReport): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO digests (id, date, newsletter_count, content, notion_block_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(digest.id, digest.date, digest.newsletterCount, digest.content, null, digest.createdAt);
  }

  updateDigestNotionBlockId(digestId: string, notionBlockId: string): void {
    this.db.prepare('UPDATE digests SET notion_block_id = ? WHERE id = ?').run(notionBlockId, digestId);
  }

  getLatestDigest(): DigestReport | null {
    const row = this.db.prepare('SELECT * FROM digests ORDER BY created_at DESC LIMIT 1').get() as any;
    return row ? this.rowToDigest(row) : null;
  }

  getDigestByDate(date: string): DigestReport | null {
    const row = this.db.prepare('SELECT * FROM digests WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(date) as any;
    return row ? this.rowToDigest(row) : null;
  }

  getDigestsByDateRange(startDate: string, endDate: string): DigestReport[] {
    const rows = this.db.prepare(
      'SELECT * FROM digests WHERE date >= ? AND date <= ? ORDER BY date DESC'
    ).all(startDate, endDate) as any[];
    return rows.map(r => this.rowToDigest(r));
  }

  getDigestHistory(limit = 30): Array<{ id: string; date: string; newsletterCount: number; createdAt: string }> {
    return this.db.prepare(
      'SELECT id, date, newsletter_count, created_at FROM digests ORDER BY date DESC LIMIT ?'
    ).all(limit) as any[];
  }

  getTotalDigests(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM digests').get() as any;
    return row.count;
  }

  private rowToDigest(row: any): DigestReport {
    return {
      id: row.id,
      date: row.date,
      newsletterCount: row.newsletter_count,
      content: row.content,
      sections: { tldr: [], keyInsights: [], ahaMoments: [], actionItems: [], connections: '' },
      newsletters: [],
      createdAt: row.created_at,
    };
  }

  // ── Sync State ──

  getSyncState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as any;
    return row ? row.value : null;
  }

  setSyncState(key: string, value: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sync_state (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, value, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}

export const digestStore = new DigestStore();
