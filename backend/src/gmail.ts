import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export class GmailClient {
  private dataDir: string;
  private tokenPath: string;
  private oAuth2Client: any;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.tokenPath = path.join(this.dataDir, 'gmail-token.json');

    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const redirectUri = process.env.GMAIL_REDIRECT_URI || `http://localhost:${process.env.PORT || 3001}/api/gmail/oauth/callback`;

    if (clientId && clientSecret) {
      this.oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      // Load existing token if available
      try {
        if (fs.existsSync(this.tokenPath)) {
          const t = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
          this.oAuth2Client.setCredentials(t);
        }
      } catch (err) {
        // ignore
      }
    }
  }

  isConfigured(): boolean {
    return !!(this.oAuth2Client && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
  }

  getAuthUrl(): string {
    if (!this.isConfigured()) throw new Error('Gmail client not configured (set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET)');
    return this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
  }

  async handleCallback(code: string): Promise<void> {
    if (!this.isConfigured()) throw new Error('Gmail client not configured');
    const { tokens } = await this.oAuth2Client.getToken(code);
    this.oAuth2Client.setCredentials(tokens);
    // persist
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.tokenPath, JSON.stringify(tokens), 'utf-8');
    } catch (err) {
      console.warn('[Gmail] Failed to save token:', err);
    }
  }

  async ensureAuth(): Promise<void> {
    if (!this.isConfigured()) throw new Error('Gmail client not configured');
    if (!this.oAuth2Client.credentials || !this.oAuth2Client.credentials.access_token) {
      if (fs.existsSync(this.tokenPath)) {
        const t = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
        this.oAuth2Client.setCredentials(t);
      } else {
        throw new Error('No Gmail credentials — authorize first');
      }
    }
  }

  // List latest messages (with optional query)
  async listLatest(q: string = '', maxResults = 5): Promise<any[]> {
    await this.ensureAuth();
    const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });
    const res = await gmail.users.messages.list({ userId: 'me', q, maxResults });
    const ids = (res.data.messages || [])
      .map(m => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, maxResults);
    const out: any[] = [];
    for (const id of ids) {
      try {
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        const headers = msg.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        out.push({
          id,
          threadId: msg.data.threadId,
          snippet: msg.data.snippet,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: getHeader('Date'),
        });
      } catch (err) {
        console.warn('[Gmail] failed to fetch message', id, err);
      }
    }
    return out;
  }
}

export const gmailClient = new GmailClient(path.join(process.cwd(), 'data'));
