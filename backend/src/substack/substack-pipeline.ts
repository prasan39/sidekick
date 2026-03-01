/**
 * Substack Pipeline — Orchestrator using Gmail MCP via agentChat
 *
 * Both cron and on-demand: the LLM uses Gmail MCP tools to search/read emails,
 * then synthesizes the digest. No direct Gmail API calls needed.
 */
import { NotionPublisher } from './notion-publisher.js';
import { digestStore } from './digest-store.js';
import { Scheduler } from './scheduler.js';
import { v4 as uuid } from 'uuid';
import type {
  PipelineRunResult,
  DigestReport,
} from './types.js';

type AgentChatFn = (message: string) => Promise<string>;
type NudgeFn = (title: string, message: string) => void;
type BroadcastFn = (event: { type: string; timestamp: string; data: Record<string, unknown> }) => void;

export class SubstackPipeline {
  private notion: NotionPublisher | null = null;
  private scheduler: Scheduler;
  private agentChat: AgentChatFn | null = null;
  private isRunning = false;
  private lastRunAt: string | null = null;
  private lastRunCount = 0;
  private nudgeFn: NudgeFn | null = null;
  private broadcastFn: BroadcastFn | null = null;
  private enabled: boolean;
  private cronExpression: string;

  constructor() {
    this.enabled = process.env.SUBSTACK_DIGEST_ENABLED === 'true';
    this.cronExpression = process.env.SUBSTACK_DIGEST_CRON || '0 8 * * *';
    this.scheduler = new Scheduler(this.cronExpression);
  }

  setNudge(fn: NudgeFn): void { this.nudgeFn = fn; }
  setBroadcast(fn: BroadcastFn): void { this.broadcastFn = fn; }
  setAgentChat(fn: AgentChatFn): void { this.agentChat = fn; }

  /**
   * Initialize Notion client and start the cron scheduler
   */
  start(): void {
    if (!this.enabled) {
      console.log('[SubstackPipeline] Disabled (SUBSTACK_DIGEST_ENABLED != true)');
      return;
    }

    const notionApiKey = process.env.NOTION_API_KEY || '';
    const notionPageId = process.env.NOTION_PAGE_ID || '';
    const notionPageTitle = process.env.NOTION_PAGE_TITLE || '';

    if (notionApiKey && (notionPageId || notionPageTitle)) {
      this.notion = new NotionPublisher(notionApiKey, notionPageId, notionPageTitle);
      console.log('[SubstackPipeline] Notion client initialized');
    } else {
      console.warn('[SubstackPipeline] Notion credentials missing — will skip publishing');
    }

    this.scheduler.start(async () => {
      await this.run();
    });

    console.log('[SubstackPipeline] Started with cron:', this.cronExpression);
  }

  stop(): void {
    this.scheduler.stop();
    digestStore.close();
    console.log('[SubstackPipeline] Stopped');
  }

  /**
   * Execute the full pipeline run using Gmail MCP via agentChat
   */
  async run(): Promise<PipelineRunResult> {
    if (this.isRunning) {
      console.log('[SubstackPipeline] Already running, skipping');
      return { success: false, newsletterCount: 0, digestId: null, notionBlockId: null, error: 'Already running' };
    }
    if (!this.agentChat) {
      console.error('[SubstackPipeline] agentChat not set — cannot run');
      return { success: false, newsletterCount: 0, digestId: null, notionBlockId: null, error: 'agentChat not configured' };
    }

    this.isRunning = true;
    console.log('[SubstackPipeline] ===== Pipeline run started =====');

    try {
      const substackQuery =
        process.env.SUBSTACK_GMAIL_QUERY ||
        'newer_than:1d (from:substack.com OR subject:Substack)';

      // Step 1: Ask the LLM to search Gmail for Substack emails via MCP
      const searchPrompt = `This is an automated background task. Use the Gmail MCP tools to search for Substack newsletter emails from the last 24 hours.

Search for emails matching Gmail query: ${substackQuery}.

For each Substack newsletter email found, extract:
- Subject line
- Sender/publication name
- The main article content (skip headers, footers, unsubscribe links)

If you find newsletters, respond with a JSON block like this:
\`\`\`json
{
  "newsletters": [
    {
      "subject": "...",
      "publication": "...",
      "from": "...",
      "content": "... (the main article text, max 3000 chars each)"
    }
  ]
}
\`\`\`

If no Substack newsletters found in the last 24 hours, respond with:
\`\`\`json
{"newsletters": []}
\`\`\`

IMPORTANT: Only output the JSON block, nothing else.`;

      console.log('[SubstackPipeline] Searching Gmail via MCP...');
      const searchResponse = await this.agentChat(searchPrompt);

      // Parse the JSON response
      const jsonMatch = searchResponse.match(/```json\s*([\s\S]*?)```/) ||
                         searchResponse.match(/\{[\s\S]*"newsletters"[\s\S]*\}/);

      let newsletters: Array<{ subject: string; publication: string; from: string; content: string }> = [];

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
          newsletters = parsed.newsletters || [];
        } catch {
          console.warn('[SubstackPipeline] Failed to parse search response JSON');
        }
      }

      console.log(`[SubstackPipeline] Found ${newsletters.length} newsletter(s)`);

      if (newsletters.length === 0) {
        this.lastRunAt = new Date().toISOString();
        this.lastRunCount = 0;
        return { success: true, newsletterCount: 0, digestId: null, notionBlockId: null };
      }

      // Step 2: Ask the LLM to synthesize a digest from the newsletters
      const newsletterList = newsletters.map((nl, i) =>
        `### Newsletter ${i + 1}: "${nl.subject}" by ${nl.publication}\n${nl.content.substring(0, 3000)}`
      ).join('\n\n---\n\n');

      const synthesizePrompt = `This is an automated background task. Synthesize the following ${newsletters.length} Substack newsletter(s) into a structured digest.

${newsletterList}

Format your response as a well-structured markdown digest with these sections:

## TL;DR
- One bullet per newsletter (max 2 sentences each)

## Key Insights
- 3-5 most important ideas across all newsletters, cite the source publication

## Aha Moments
- 1-3 surprising or counterintuitive points

## Action Items
- Concrete recommendations, tools to try, things to do

## Connections
Cross-newsletter themes, complementary or contradictory views between publications.

Output ONLY the markdown digest, no preamble.`;

      console.log('[SubstackPipeline] Synthesizing digest...');
      const digestContent = await this.agentChat(synthesizePrompt);

      // Step 3: Save digest
      const digestId = uuid();
      const now = new Date();
      const digest: DigestReport = {
        id: digestId,
        date: now.toISOString().split('T')[0],
        newsletterCount: newsletters.length,
        content: digestContent,
        sections: { tldr: [], keyInsights: [], ahaMoments: [], actionItems: [], connections: '' },
        newsletters: newsletters.map(nl => ({ publication: nl.publication, subject: nl.subject })),
        createdAt: now.toISOString(),
      };

      digestStore.saveDigest(digest);

      // Mark emails as processed
      for (const nl of newsletters) {
        digestStore.markEmailProcessed({
          gmailId: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          subject: nl.subject,
          fromAddr: nl.from,
          publication: nl.publication,
          receivedAt: now.toISOString(),
          processedAt: now.toISOString(),
          digestId,
          bodyText: nl.content,
        });
      }

      // Step 4: Publish to Notion
      let notionBlockId: string | null = null;
      if (this.notion) {
        try {
          notionBlockId = await this.notion.publishDigest(digest);
          if (notionBlockId) {
            digestStore.updateDigestNotionBlockId(digestId, notionBlockId);
          }
        } catch (err) {
          console.error('[SubstackPipeline] Notion publish failed (non-fatal):', err);
        }
      }

      // Step 5: Nudge + Broadcast
      if (this.nudgeFn) {
        this.nudgeFn(
          'Newsletter Digest Ready',
          `${newsletters.length} newsletter${newsletters.length > 1 ? 's' : ''} synthesized into today's digest.`,
        );
      }
      if (this.broadcastFn) {
        this.broadcastFn({
          type: 'substack_digest_ready',
          timestamp: now.toISOString(),
          data: {
            digestId,
            date: digest.date,
            newsletterCount: newsletters.length,
            newsletters: digest.newsletters,
          },
        });
      }

      this.lastRunAt = now.toISOString();
      this.lastRunCount = newsletters.length;
      console.log(`[SubstackPipeline] ===== Pipeline complete: ${newsletters.length} newsletters =====`);

      return { success: true, newsletterCount: newsletters.length, digestId, notionBlockId };
    } catch (err) {
      const error = String(err);
      console.error('[SubstackPipeline] Pipeline error:', error);
      return { success: false, newsletterCount: 0, digestId: null, notionBlockId: null, error };
    } finally {
      this.isRunning = false;
    }
  }

  getStore() { return digestStore; }
}

export const substackPipeline = new SubstackPipeline();
