import { CopilotClient, defineTool, approveAll, type SessionConfig, type Tool } from "@github/copilot-sdk";
import type { CopilotSession } from "@github/copilot-sdk";
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '../skills');
import type { EnhancedMemoryManager } from './memory/index.js';
import { generatePreview, executeWriteTool } from './tools/write-tools.js';
import { createPresentation, type Slide } from './tools/pptx-tool.js';
import { getStockHistory, getStockQuote } from './tools/stock-tool.js';
import {
  WORKIQ_ENABLED,
  SUBSTACK_ENABLED,
  GMAIL_ENABLED,
  FINANCE_ENABLED,
  VERCEL_DEPLOY_ENABLED,
  SIDEKICK_NAME,
  PLAYWRIGHT_MCP_ENABLED,
  PLAYWRIGHT_MCP_HEADLESS,
  PLAYWRIGHT_MCP_EXTRA_ARGS,
  LIVE_NEWS_MODEL,
} from './config.js';
import { digestStore } from './substack/index.js';
import { gmailClient } from './gmail.js';

const COPILOT_SEND_AND_WAIT_TIMEOUT_MS =
  Number(process.env.COPILOT_SEND_AND_WAIT_TIMEOUT_MS) || 900000; // 15 minutes

const LIVE_WEB_QUERY_PATTERN = /\b(live|latest|today|breaking|news|current update|right now)\b/i;
const LIVE_WEB_BLOCKED_TOOLS = new Set(['web_fetch', 'task']);
const GREETING_QUERY_PATTERN = /^\s*(hi|hello|hey|yo|good (morning|afternoon|evening))\b/i;
const IDENTITY_QUERY_PATTERN = /\b(who are you|what are you|introduce yourself|your name)\b/i;
const ACTION_QUERY_PATTERN = /\b(build|fix|implement|add|remove|create|deploy|run|debug|update|refactor|generate|write|ship)\b/i;
const EXPLANATION_QUERY_PATTERN = /\b(why|how|explain|difference|compare|pros|cons|tradeoff|when should|what is)\b/i;
const OPTIONS_QUERY_PATTERN = /\b(list|top|ideas|options|recommend|suggest|plan|roadmap|prioritize)\b/i;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  }) as Promise<T>;
}

// Event types for real-time streaming to frontend
export type AgentEventType =
  | 'session_start'
  | 'thinking'
  | 'text_delta'
  | 'text_complete'
  | 'reasoning_delta'
  | 'reasoning_complete'
  | 'usage'
  | 'tool_call_start'
  | 'tool_call_progress'
  | 'tool_call_end'
  | 'approval_required'
  | 'approval_resolved'
  | 'memory_updated'
  | 'session_idle'
  | 'session_truncated'
  | 'session_compacting'
  | 'session_compacted'
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type EventCallback = (event: AgentEvent) => void;

// File attachment type for the Copilot SDK
export interface FileAttachment {
  type: 'file';
  path: string;
  displayName?: string;
}

// Type definitions for tool parameters
interface RememberArgs {
  fact: string;
  category?: string;
}

interface ForgetArgs {
  fact: string;
}

interface RecallArgs {
  query: string;
}

interface SendEmailArgs {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}

interface CreateEventArgs {
  title: string;
  start: string;
  end: string;
  attendees?: string;
  location?: string;
  description?: string;
}

interface SendTeamsMessageArgs {
  message: string;
  channel?: string;
  user?: string;
}

interface SearchNewslettersArgs {
  query: string;
  publication?: string;
  limit?: number;
}

interface GetDigestArgs {
  date?: string;
  latest?: boolean;
}

interface ReadGmailArgs {
  query?: string;
  maxResults?: number;
}

interface GmailAuthStatusArgs {
  // no args needed
}

interface CreatePresentationArgs {
  title: string;
  subtitle?: string;
  author?: string;
  slides: Array<{
    title: string;
    template?: string;
    leftTitle?: string;
    rightTitle?: string;
    source?: string;
    bullets?: string[];
    content?: string;
  }>;
}

interface GetStockQuoteArgs {
  symbol: string;
  provider?: 'twelvedata' | 'fmp' | 'alphavantage' | 'stooq';
}

interface GetStockHistoryArgs {
  symbol: string;
  days?: number;
  provider?: 'twelvedata' | 'fmp' | 'alphavantage' | 'stooq';
}

export class CopilotAgent {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private eventCallback?: EventCallback;
  private isInitialized = false;
  private silentModeCount = 0;
  // Default model — kept in sync with frontend default (gpt-5-mini)
  private currentModel = 'gpt-5-mini';
  private lastUsage: Record<string, unknown> | null = null;
  // Mutex: prevents chat() from using a session that is mid-recreation
  private sessionBusy = false;
  private sessionBusyQueue: Array<() => void> = [];
  // Enforce "Playwright-only" live web policy while a request is processing.
  private liveWebEnforcementDepth = 0;
  // sendStreaming() returns before idle; this counter is decremented on session.idle.
  private pendingStreamingLiveWebEnforcement = 0;

  // Per-user: each agent gets its own GitHub token and memory manager
  private githubToken: string | undefined;
  private memoryManager: EnhancedMemoryManager | null = null;

  constructor(githubToken?: string, memoryManager?: EnhancedMemoryManager) {
    this.githubToken = githubToken;
    this.memoryManager = memoryManager || null;
  }

  setEventCallback(callback: EventCallback): void {
    this.eventCallback = callback;
  }

  /** Suppress streaming events (used during background/heartbeat calls).
   *  Uses a reference counter so concurrent background calls don't interfere. */
  setSilentMode(silent: boolean): void {
    if (silent) {
      this.silentModeCount++;
    } else {
      this.silentModeCount = Math.max(0, this.silentModeCount - 1);
    }
  }

  private emit(type: AgentEventType, data: Record<string, unknown> = {}): void {
    if (this.silentModeCount > 0) return;
    if (this.eventCallback) {
      this.eventCallback({
        type,
        timestamp: new Date().toISOString(),
        data,
      });
    }
  }

  private buildSystemPrompt(): string {
    const { memory, recentConversation } = this.memoryManager!.getFullContext();

    const personaIntro = `You are ${SIDEKICK_NAME}, the user's personal pulsar-inspired AI sidekick for builders.
Persona:
- Pulsar energy: fast, agile, precise, and always moving work forward
- Sharp, upbeat, and playful comic flavor, but never childish
- Action-first: help users ship outcomes, not just ideas
- Use occasional short sidekick-style lines, but keep answers clear and structured
- Never let persona reduce factual accuracy or safety
Identity guardrails:
- Your identity is ${SIDEKICK_NAME}
- Do NOT present yourself as GitHub Copilot CLI, an SDK, or a generic terminal assistant
- Do NOT reveal model IDs or provider internals unless the user explicitly asks for system details`;

    const workIqIntro = WORKIQ_ENABLED
      ? 'You are a helpful work assistant with access to the user\'s Microsoft 365 data through Work IQ.'
      : 'You are a helpful work assistant focused on local files, reasoning, and app building.';

    const workIqRouting = WORKIQ_ENABLED ? `
### 2. Work IQ (MCP tools) — Microsoft 365 cloud only
Use for: emails, calendar, Teams, OneDrive, SharePoint, contacts
- "Show my emails" → Work IQ
- "What meetings do I have?" → Work IQ
- "Check my Teams messages" → Work IQ
- "Find files in OneDrive" → Work IQ
- "Send an email" → Work IQ
- ANY request about email, calendar, Teams chat, OneDrive, SharePoint

### Decision rule
Ask yourself: "Is this about files/folders on the LOCAL machine, or about Microsoft 365 cloud data?"
- Local machine → PowerShell shell tool
- M365 cloud data → Work IQ MCP tool
- NEVER use Work IQ for local folders — it cannot see them
- NEVER use PowerShell to query emails/calendar/Teams — it cannot access them
` : `
### Decision rule
Ask yourself: "Is this about files/folders on the LOCAL machine?"
- Local machine → PowerShell shell tool
- Otherwise, respond normally without using Work IQ (it is disabled)
`;

    const workIqCapabilities = WORKIQ_ENABLED
      ? '- Send emails, create events, send Teams messages (require user approval)'
      : '- Work IQ is disabled; do not reference M365 capabilities';

    const financeCapabilities = FINANCE_ENABLED
      ? '- **Stock data** (`get_stock_quote`, `get_stock_history`): use tools for ticker prices and recent history before answering'
      : '- Stock tools are disabled';

    const browserRouting = PLAYWRIGHT_MCP_ENABLED ? `
### 3. Browser automation (Playwright MCP) — WEB only
Use for: current events, latest prices/specs, or anything requiring fresh web lookup.
- For prompts containing "live", "latest", "today", "breaking", "news", or "current update", trigger Playwright web lookup before answering.
- If the answer might have changed recently, use Playwright MCP to verify on the live web before answering.
- When Playwright MCP is enabled, prefer Playwright over generic web_fetch for live/news requests.
- Open and read primary sources (official docs/sites) when possible.
- Return concise results and include source links.
- Browser mode: Use direct source-site browsing/search in Playwright.
` : `
### 3. Browser automation
Playwright MCP is disabled. Do not claim to have browsed the web in this mode.
`;

    const browserCapabilities = PLAYWRIGHT_MCP_ENABLED
      ? '- **Web search and browsing** (Playwright MCP): enabled (direct mode)'
      : '- Web browsing is disabled unless PLAYWRIGHT_MCP_ENABLED=true';
    const vercelCapabilities = VERCEL_DEPLOY_ENABLED
      ? '- **Vercel preview deploys**: for "deploy/share/go live/preview URL" requests, deploy with `bash skills/vercel-deploy/scripts/deploy.sh <project-path>` and return both Preview URL and Claim URL'
      : '- Vercel preview deploy skill is disabled';
    const artifactSkillsRouting = `
### 4. Artifact Skills Routing
Use local skills under backend/skills when relevant:
- **theme-factory**: when user asks to restyle, re-theme, improve aesthetics, color palette, font pairing, or visual vibe of an artifact/deck/page.
- **web-artifacts-builder**: when user asks to build advanced web artifacts/prototypes with multiple components, React/Tailwind/shadcn, stateful UI, or bundled single-file deliverables.
- If a request clearly matches one of these, invoke that skill workflow first before ad-hoc coding.
`;

    const routingHeader = WORKIQ_ENABLED
      ? 'You have TWO separate systems. Pick the RIGHT one every time:'
      : 'You have ONE local system. Do not use Work IQ:';

    return `${personaIntro}

${workIqIntro}

## Your Memory
You have persistent memory that survives across sessions. Here's what you remember:

<memory>
${memory}
</memory>

## Recent Conversation Context
${recentConversation.length > 0
      ? recentConversation.slice(-10).map(e => `[${e.role}]: ${e.content}`).join('\n')
      : '(New conversation)'
    }

## Guidelines
1. Use your memory to personalize responses
2. When the user asks you to remember something, use the 'remember' tool
3. When information is outdated, use the 'forget' tool
4. For write actions (sending emails, creating events, etc.), always explain what you're about to do
5. Be concise but helpful
6. Reference information from your memory when relevant
7. If you learn something important about the user (name, preferences, projects), proactively remember it

## Formatting Rules (IMPORTANT)
- Use clean, well-structured markdown
- Prefer GitHub-flavored markdown tables for tabular data (so the UI can render them)
- For diagrams, use fenced blocks: \`\`\`mermaid ... \`\`\`
  * IMPORTANT: Only use simple sequence diagrams or simple flowcharts
  * Flowcharts should be VERY simple - maximum 5-6 nodes
  * CRITICAL RULES for flowchart syntax:
    - Use only: A --> B (simple arrows between nodes)
    - Node format: A[Node Label], B[Another Node]
    - Decisions: C{Question?}
    - NEVER use pipes for labels in inline connections
    - NEVER use brackets [ ] within connection syntax
    - NEVER use -- dashes for labels
  * For more complex flows, use a bullet list instead
  * Example of CORRECT simple flowchart:
    \`\`\`mermaid
    flowchart TD
      A["Start"]
      B["Process A"]
      C["Process B"]
      A --> B
      B --> C
    \`\`\`
- For charts, use fenced blocks: \`\`\`vega-lite ... \`\`\` with valid JSON and inline data.values (do not use data.url)
- For lists of items (emails, meetings, files), use bullet points with clear hierarchy:
  • **Bold** for titles/subjects
  • Regular text for details
  • Use line breaks between items for readability
- For tables, ensure proper alignment and keep them simple (max 3-4 columns)
- For email summaries, format as:
  **Subject:** [subject]
  **From:** [sender] | **Date:** [date]
  [brief summary in 1-2 lines]
- Avoid cramped formatting - add whitespace between sections
- Use headers (##, ###) to organize longer responses
- For action items, use checkboxes: - [ ] Item
- Never return a single large paragraph for informational answers; use section headers + bullet points.
- Keep paragraph blocks to 2-3 sentences max, then switch to bullets.
- For source-backed answers, include a Sources section with markdown links.

## Tool Routing — FOLLOW THIS STRICTLY

${routingHeader}

### 1. PowerShell (shell tool) — LOCAL machine only
Use for: local files, folders, system commands, installed apps
- "Show my Downloads folder" → Get-ChildItem ~\\Downloads
- "Open file on Desktop" → Get-Content ~\\Desktop\\file.txt
- "Find all PDFs on my machine" → Get-ChildItem -Recurse -Filter *.pdf
- "What's in C:\\Users\\..." → Get-ChildItem C:\\Users\\...
- ANY path starting with C:\\, ~\\, Desktop, Downloads, Documents (local)
- Running scripts, installing software, system info
${workIqRouting}
${browserRouting}
${artifactSkillsRouting}

## Other Capabilities
- Remember and recall information (memory tools)
- **Create PowerPoint presentations** (\`create_presentation\` tool): Use whenever the user asks for a slide deck, presentation, or PPT. Design slides with meaningful bullet points. Always include 4-10 content slides.
${financeCapabilities}
${workIqCapabilities}
${browserCapabilities}
${vercelCapabilities}
${GMAIL_ENABLED ? `
### Gmail (read_gmail tool)
- "Show my latest emails" → read_gmail
- "Any unread messages?" → read_gmail with query "is:unread"
- "Emails from john@example.com" → read_gmail with query "from:john@example.com"
- If Gmail is not authorized, use gmail_auth_status to get the authorization link
- ALWAYS use the read_gmail tool for Gmail requests, never suggest Python scripts
` : ''}
`;
  }

  // Define custom tools for memory and write actions using JSON schema
  private createTools(): Tool<unknown>[] {
    const self = this;

    // Memory tools
    const rememberTool = defineTool<RememberArgs>("remember", {
      description: "Save an important fact to long-term memory. Use this when the user asks you to remember something or when you learn important information about the user.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The fact to remember" },
          category: {
            type: "string",
            description: "Category for the fact",
            enum: ["User Profile", "Preferences", "Current Projects", "Key Contacts", "Important Dates", "Notes"],
          },
        },
        required: ["fact"],
      },
      handler: async (args) => {
        const result = this.memoryManager!.remember(args.fact, args.category);
        self.emit('memory_updated', { action: 'remember', fact: args.fact, category: args.category });
        return result.message;
      },
    });

    const forgetTool = defineTool<ForgetArgs>("forget", {
      description: "Remove outdated or incorrect information from memory.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The fact or keyword to forget" },
        },
        required: ["fact"],
      },
      handler: async (args) => {
        const result = this.memoryManager!.forget(args.fact);
        self.emit('memory_updated', { action: 'forget', fact: args.fact });
        return result.message;
      },
    });

    const recallTool = defineTool<RecallArgs>("recall", {
      description: "Search memory for relevant information using semantic and keyword search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for memory" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        // Use enhanced hybrid search (semantic + keyword)
        const results = await this.memoryManager!.recall(args.query, 10);

        if (results.length === 0) {
          // Fall back to simple keyword search if hybrid fails
          const keywordResults = this.memoryManager!.recallKeyword(args.query);
          return keywordResults.length > 0
            ? `Found in memory (keyword match):\n${keywordResults.join('\n')}`
            : 'Nothing found in memory matching that query.';
        }

        // Format results with scores and categories
        const formatted = results.map(r =>
          `[${r.category}] (${Math.round(r.score * 100)}% match): ${r.content}`
        ).join('\n');

        return `Found in memory:\n${formatted}`;
      },
    });

    // Write tools with approval
    const sendEmailTool = defineTool<SendEmailArgs>("send_email", {
      description: "Send an email to a recipient. Requires user approval before sending.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Email recipient address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body content" },
          cc: { type: "string", description: "CC recipients (comma-separated)" },
        },
        required: ["to", "subject", "body"],
      },
      handler: async (args) => {
        const argsRecord: Record<string, unknown> = { ...args };
        self.emit('approval_required', {
          tool: 'send_email',
          args: argsRecord,
          preview: generatePreview('send_email', argsRecord),
        });

        const result = await executeWriteTool('send_email', argsRecord);
        if ('pending' in result) {
          return `Waiting for approval. Preview: ${result.preview}`;
        }
        return result.result;
      },
    });

    const createEventTool = defineTool<CreateEventArgs>("create_event", {
      description: "Create a calendar event. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          start: { type: "string", description: "Start time (ISO 8601)" },
          end: { type: "string", description: "End time (ISO 8601)" },
          attendees: { type: "string", description: "Attendee emails (comma-separated)" },
          location: { type: "string", description: "Event location" },
          description: { type: "string", description: "Event description" },
        },
        required: ["title", "start", "end"],
      },
      handler: async (args) => {
        const argsRecord: Record<string, unknown> = { ...args };
        self.emit('approval_required', {
          tool: 'create_event',
          args: argsRecord,
          preview: generatePreview('create_event', argsRecord),
        });

        const result = await executeWriteTool('create_event', argsRecord);
        if ('pending' in result) {
          return `Waiting for approval. Preview: ${result.preview}`;
        }
        return result.result;
      },
    });

    const sendTeamsMessageTool = defineTool<SendTeamsMessageArgs>("send_teams_message", {
      description: "Send a message in Microsoft Teams. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message content" },
          channel: { type: "string", description: "Teams channel name" },
          user: { type: "string", description: "User to message directly" },
        },
        required: ["message"],
      },
      handler: async (args) => {
        const argsRecord: Record<string, unknown> = { ...args };
        self.emit('approval_required', {
          tool: 'send_teams_message',
          args: argsRecord,
          preview: generatePreview('send_teams_message', argsRecord),
        });

        const result = await executeWriteTool('send_teams_message', argsRecord);
        if ('pending' in result) {
          return `Waiting for approval. Preview: ${result.preview}`;
        }
        return result.result;
      },
    });

    // Substack newsletter tools
    const searchNewslettersTool = defineTool<SearchNewslettersArgs>("search_newsletters", {
      description: "Search through previously processed Substack newsletter emails. Use when the user asks about newsletter content, e.g. 'What did Lenny say about growth?' or 'Any newsletters about AI this week?'",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword or phrase to look for in newsletter content" },
          publication: { type: "string", description: "Filter by publication name (e.g. 'Lenny's Newsletter')" },
          limit: { type: "number", description: "Max results to return (default 10)" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const results = digestStore.searchEmails(args.query, args.limit || 10);
        if (results.length === 0) {
          return 'No newsletters found matching that query. The pipeline may not have run yet, or no matching content was processed.';
        }
        const formatted = results.map(r =>
          `**${r.subject}** (${r.publication || r.fromAddr})\nReceived: ${r.receivedAt}\n${r.bodyText?.substring(0, 500) || '(no content cached)'}...`
        ).join('\n\n---\n\n');
        return `Found ${results.length} newsletter(s):\n\n${formatted}`;
      },
    });

    const getDigestTool = defineTool<GetDigestArgs>("get_digest", {
      description: "Get a synthesized Substack newsletter digest. Use when the user asks for a digest summary, e.g. 'Show me today's digest' or 'What were the key insights this week?'",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format. If omitted, returns the latest digest." },
          latest: { type: "boolean", description: "If true, return the most recent digest regardless of date" },
        },
        required: [],
      },
      handler: async (args) => {
        let digest;
        if (args.date) {
          digest = digestStore.getDigestByDate(args.date);
        } else {
          digest = digestStore.getLatestDigest();
        }
        if (!digest) {
          return 'No digest found. The Substack pipeline may not have run yet. You can trigger it manually via the API.';
        }
        return `## Newsletter Digest — ${digest.date} (${digest.newsletterCount} newsletters)\n\n${digest.content}`;
      },
    });

    // Gmail tools
    const readGmailTool = defineTool<ReadGmailArgs>("read_gmail", {
      description: "Read the user's latest Gmail messages. Can optionally filter by a Gmail search query (e.g. 'from:boss@company.com', 'is:unread', 'subject:invoice'). Returns subject, sender, date, and snippet for each message.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional Gmail search query to filter messages (e.g. 'is:unread', 'from:someone@gmail.com', 'subject:meeting')" },
          maxResults: { type: "number", description: "Number of messages to return (default 5, max 20)" },
        },
        required: [],
      },
      handler: async (args) => {
        if (!gmailClient.isConfigured()) {
          return 'Gmail is not configured. The GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables need to be set.';
        }
        try {
          await gmailClient.ensureAuth();
        } catch {
          // Not authorized yet — return the auth URL so the user can click it
          const url = gmailClient.getAuthUrl();
          return `Gmail is not authorized yet. Please open this link to grant access, then try again:\n\n${url}`;
        }
        const max = Math.min(args.maxResults || 5, 20);
        const messages = await gmailClient.listLatest(args.query || '', max);
        if (messages.length === 0) {
          return 'No messages found' + (args.query ? ` matching "${args.query}"` : '') + '.';
        }
        const formatted = messages.map((m, i) =>
          `**${i + 1}. ${m.subject}**\n**From:** ${m.from} | **Date:** ${m.date}\n${m.snippet}`
        ).join('\n\n---\n\n');
        return `Found ${messages.length} message(s):\n\n${formatted}`;
      },
    });

    const gmailAuthStatusTool = defineTool<GmailAuthStatusArgs>("gmail_auth_status", {
      description: "Check Gmail authorization status. If not authorized, returns an OAuth link the user can click to grant access.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: async () => {
        if (!gmailClient.isConfigured()) {
          return 'Gmail is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in the .env file.';
        }
        try {
          await gmailClient.ensureAuth();
          return 'Gmail is authorized and ready to use.';
        } catch {
          const url = gmailClient.getAuthUrl();
          return `Gmail is not authorized yet. Please open this link to grant access:\n\n${url}`;
        }
      },
    });

    // PowerPoint creation tool
    const createPresentationTool = defineTool<CreatePresentationArgs>("create_presentation", {
      description: "Create a PowerPoint presentation (.pptx) file with a branded CoWork theme. Use this when the user asks to create a presentation, slideshow, or deck. Returns a download URL.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Presentation title" },
          subtitle: { type: "string", description: "Optional subtitle shown on the cover slide" },
          author: { type: "string", description: "Author name shown on the cover slide" },
          slides: {
            type: "array",
            description: "Array of content slides (do NOT include a title/cover slide — it is auto-generated)",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Slide title" },
                template: {
                  type: "string",
                  description: "Layout template for the slide",
                  enum: ["insight", "comparison", "timeline", "metrics", "process", "quote", "two-column"],
                },
                leftTitle: { type: "string", description: "Optional heading for the left column in comparison slides" },
                rightTitle: { type: "string", description: "Optional heading for the right column in comparison slides" },
                source: { type: "string", description: "Optional attribution/source for quote slides" },
                bullets: {
                  type: "array",
                  description: "Bullet points for the slide (preferred over content for lists)",
                  items: { type: "string" },
                },
                content: { type: "string", description: "Free-form text content if not using bullets" },
              },
              required: ["title"],
            },
          },
        },
        required: ["title", "slides"],
      },
      handler: async (args) => {
        self.emit('tool_call_progress', { tool: 'create_presentation', message: 'Generating presentation...' });
        try {
          const filename = await createPresentation({
            title: args.title,
            subtitle: args.subtitle,
            author: args.author,
            slides: args.slides as Slide[],
          });
          const downloadUrl = `/api/presentations/${encodeURIComponent(filename)}`;
          return `Presentation created successfully!\n\n**[📥 Download: ${args.title}.pptx](${downloadUrl})**\n\nThe file has ${args.slides.length} content slides plus a title and closing slide.`;
        } catch (err) {
          return `Failed to create presentation: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    });

    const getStockQuoteTool = defineTool<GetStockQuoteArgs>("get_stock_quote", {
      description: "Get a stock's latest quote by ticker symbol (example: AAPL, MSFT, TSLA). Uses provider fallback and returns source details.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Ticker symbol, e.g. AAPL" },
          provider: {
            type: "string",
            description: "Optional provider override",
            enum: ["twelvedata", "fmp", "alphavantage", "stooq"],
          },
        },
        required: ["symbol"],
      },
      handler: async (args) => {
        try {
          const quote = await getStockQuote(args.symbol, args.provider);
          const lines = [
            `## ${quote.symbol} Quote`,
            `- **Price:** ${quote.price}`,
            `- **Change:** ${quote.change ?? 'N/A'}`,
            `- **Change %:** ${quote.changePercent != null ? `${quote.changePercent.toFixed(2)}%` : 'N/A'}`,
            `- **Provider:** ${quote.provider}`,
            quote.timestamp ? `- **Timestamp:** ${quote.timestamp}` : null,
            quote.sourceNote ? `- **Note:** ${quote.sourceNote}` : null,
          ].filter(Boolean);
          return lines.join('\n');
        } catch (err) {
          return `Failed to fetch stock quote: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    });

    const getStockHistoryTool = defineTool<GetStockHistoryArgs>("get_stock_history", {
      description: "Get recent daily historical stock prices by ticker. Returns close prices in a markdown table.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Ticker symbol, e.g. AAPL" },
          days: { type: "number", description: "How many days to return (5-120, default 30)" },
          provider: {
            type: "string",
            description: "Optional provider override",
            enum: ["twelvedata", "fmp", "alphavantage", "stooq"],
          },
        },
        required: ["symbol"],
      },
      handler: async (args) => {
        try {
          const history = await getStockHistory(args.symbol, args.days, args.provider);
          const sample = history.points.slice(0, 20);
          const tableRows = sample
            .map((p) => `| ${p.date} | ${p.close} |`)
            .join('\n');
          return [
            `## ${history.symbol} History (${sample.length} points)`,
            `- **Provider:** ${history.provider}`,
            history.sourceNote ? `- **Note:** ${history.sourceNote}` : null,
            '',
            '| Date | Close |',
            '| --- | ---: |',
            tableRows,
          ].filter(Boolean).join('\n');
        } catch (err) {
          return `Failed to fetch stock history: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    });

    const tools: Tool<unknown>[] = [
      rememberTool as Tool<unknown>,
      forgetTool as Tool<unknown>,
      recallTool as Tool<unknown>,
      createPresentationTool as Tool<unknown>,
    ];
    if (FINANCE_ENABLED) {
      tools.push(
        getStockQuoteTool as Tool<unknown>,
        getStockHistoryTool as Tool<unknown>,
      );
    }
    if (WORKIQ_ENABLED) {
      tools.push(
        sendEmailTool as Tool<unknown>,
        createEventTool as Tool<unknown>,
        sendTeamsMessageTool as Tool<unknown>,
      );
    }
    if (SUBSTACK_ENABLED) {
      tools.push(
        searchNewslettersTool as Tool<unknown>,
        getDigestTool as Tool<unknown>,
      );
    }
    if (GMAIL_ENABLED) {
      tools.push(
        readGmailTool as Tool<unknown>,
        gmailAuthStatusTool as Tool<unknown>,
      );
    }
    return tools;
  }

  private getSessionConfig(): SessionConfig {
    const self = this;

    const config: SessionConfig = {
      model: this.currentModel,
      streaming: true,           // Enable streaming for real-time events
      onPermissionRequest: approveAll,  // Required by SDK 0.1.29+
      hooks: {
        onPreToolUse: (input) => {
          if (self.liveWebEnforcementDepth <= 0) return;
          if (!LIVE_WEB_BLOCKED_TOOLS.has(input.toolName)) return;
          return {
            permissionDecision: 'deny',
            permissionDecisionReason: 'Live web policy: web_fetch is blocked; use Playwright MCP browser tools.',
            additionalContext: 'For this request, use Playwright MCP browser tools with direct source-site browsing instead of web_fetch.',
          };
        },
      },

      mcpServers: {
        ...(WORKIQ_ENABLED ? {
          workiq: {
            command: "npx",
            args: ["-y", "@microsoft/workiq", "mcp"],
            tools: ["*"],
            timeout: 120000,
          },
        } : {}),
        ...(PLAYWRIGHT_MCP_ENABLED ? {
          playwright: {
            command: "npx",
            args: [
              "-y",
              "@playwright/mcp@latest",
              ...(PLAYWRIGHT_MCP_HEADLESS ? ["--headless"] : []),
              ...PLAYWRIGHT_MCP_EXTRA_ARGS,
            ],
            tools: ["*"],
            timeout: 120000,
          },
        } : {}),

      },

      // Infinite sessions for long conversations
      infiniteSessions: {
        enabled: true,
      },

      // Skills — SDK lazily loads SKILL.md files into context when relevant
      skillDirectories: [SKILLS_DIR],

      // Sub-agents — specialized agents the orchestrator can invoke
      customAgents: [
        {
          name: 'pptx-agent',
          displayName: 'Presentation Creator',
          description: 'Specialized sub-agent for creating PowerPoint presentations and slide decks. Invoked when the user asks for a presentation, slides, or deck.',
          prompt: `You are a specialized PowerPoint presentation creator for Sidekick.
Your only job is to create well-structured, professional slide decks using the create_presentation tool.

Guidelines:
- Always use the create_presentation tool — never describe slides in text only
- Plan 5-10 content slides with clear titles and 4-6 bullet points each
- Mix templates for visual variety: insight, comparison, timeline, metrics, process, quote, two-column
- The cover and closing slides are auto-generated; do NOT include them in the slides array
- After creation, confirm the download link and offer to refine the deck`,
          tools: ['create_presentation'],
          infer: true,
        },
        ...(FINANCE_ENABLED ? [{
          name: 'finance-agent',
          displayName: 'Stock Data Assistant',
          description: 'Specialized sub-agent for stock quotes and recent price history using finance APIs.',
          prompt: `You are a stock data specialist.
Use tools first before making market statements.
Rules:
- For "price/quote now" requests, call get_stock_quote
- For trend/performance requests, call get_stock_history
- Keep responses concise and include provider + timestamp
- Never provide investment advice; provide informational analysis only`,
          tools: ['get_stock_quote', 'get_stock_history'],
          infer: true,
        }] : []),
        ...(PLAYWRIGHT_MCP_ENABLED ? [{
          name: 'live-news-agent',
          displayName: 'Live News Browser',
          description: 'Specialized sub-agent for live/latest/breaking news that must use Playwright MCP browser automation.',
          prompt: `You are a live-news retrieval specialist.
Rules:
- For live/latest/breaking/current events, retrieve data with Playwright MCP browser tools.
- NEVER use web_fetch or task for live-news retrieval.
- Browser mode: Use direct authoritative source browsing/search in Playwright.
- Prefer primary/authoritative news sources and include source URLs.
- Keep output factual and concise, include exact timestamps when available.`,
          tools: null,
          infer: true,
        }] : []),
        ...(VERCEL_DEPLOY_ENABLED ? [{
          name: 'vercel-deploy-agent',
          displayName: 'Vercel Preview Deployer',
          description: 'Specialized sub-agent for creating Vercel preview deployments and returning shareable URLs.',
          prompt: `You are a Vercel deployment specialist for local/sandbox projects.
Rules:
- Use shell commands to deploy with: bash skills/vercel-deploy/scripts/deploy.sh <project-path>
- If no path is provided, prefer the latest app under ./sandbox, otherwise ask for the target path.
- If deployment is requested "after build", ensure the target project has been built or is build-ready first.
- Always return BOTH:
  1) Preview URL (live link)
  2) Claim URL (to transfer to user's Vercel account)
- Keep responses concise and actionable.`,
          tools: null,
          infer: true,
        }] : []),
      ],

      // System message with memory context
      systemMessage: {
        mode: "append",
        content: this.buildSystemPrompt(),
      },

      // Custom tools for memory and write actions
      tools: this.createTools(),
    };
    return config;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.emit('session_start', { status: 'Initializing Copilot client' });

    // Use the per-user GitHub token (from OAuth), or fall back to env var
    const token = this.githubToken
      || process.env.COPILOT_GITHUB_TOKEN
      || process.env.GH_TOKEN
      || process.env.GITHUB_TOKEN;

    if (!token && process.env.NODE_ENV === 'production') {
      throw new Error('No GitHub token available for this user.');
    }

    this.client = new CopilotClient(token ? { githubToken: token } : undefined);
    // Fail fast in production. Hanging here makes the UI look broken.
    await withTimeout(this.client.start(), 20000, 'Copilot client start');

    // Create a session with the configured model (and Work IQ if enabled)
    this.session = await withTimeout(
      this.client.createSession(this.getSessionConfig()),
      30000,
      'Copilot session create',
    );

    // Set up event handlers for real-time streaming
    this.session.on((event) => {
      this.handleSessionEvent(event);
    });

    this.isInitialized = true;
    this.emit('session_start', { status: 'Copilot session ready', model: this.currentModel });
  }

  private handleSessionEvent(event: { type: string; data?: Record<string, unknown> }): void {
    const data = event.data || {};

    // Log and forward events to the frontend
    switch (event.type) {
      case 'assistant.message_delta':
        this.emit('text_delta', {
          text: data.deltaContent,
        });
        break;

      case 'assistant.message':
        this.emit('text_complete', {
          content: data.content,
        });
        break;

      case 'assistant.reasoning_delta':
        this.emit('reasoning_delta', {
          text: data.deltaContent,
        });
        break;

      case 'assistant.reasoning':
        this.emit('reasoning_complete', {
          content: data.content,
        });
        break;

      case 'assistant.usage':
        // Contains token + quota snapshots (premium request buckets).
        this.lastUsage = data as Record<string, unknown>;
        this.emit('usage', data as Record<string, unknown>);
        break;

      case 'tool.execution_start':
        this.emit('tool_call_start', {
          tool: data.toolName,
          args: data.arguments,
        });
        this.memoryManager!.logToolCall(
          data.toolName as string,
          (data.arguments as Record<string, unknown>) || {}
        );
        break;

      case 'tool.execution_progress':
        this.emit('tool_call_progress', {
          tool: data.toolCallId,
          message: data.progressMessage,
        });
        break;

      case 'tool.execution_complete':
        this.emit('tool_call_end', {
          tool: data.toolName,
          result: (data.result as Record<string, unknown>)?.content,
          success: data.success,
        });
        break;

      case 'session.idle':
        if (this.pendingStreamingLiveWebEnforcement > 0) {
          this.pendingStreamingLiveWebEnforcement--;
          this.liveWebEnforcementDepth = Math.max(0, this.liveWebEnforcementDepth - 1);
        }
        this.emit('session_idle', {});
        break;

      case 'session.error':
        this.emit('error', {
          message: data.message,
          error: data.error,
        });
        break;

      case 'session.truncation':
        console.warn(`[Session] Context truncated: removed ${data.messagesRemovedDuringTruncation} messages, ${data.tokensRemovedDuringTruncation} tokens`);
        this.emit('session_truncated', {
          messagesRemoved: data.messagesRemovedDuringTruncation,
          tokensRemoved: data.tokensRemovedDuringTruncation,
        });
        break;

      case 'session.compaction_start':
        this.emit('session_compacting', {});
        break;

      case 'session.compaction_complete':
        this.emit('session_compacted', {
          success: data.success,
          tokensRemoved: data.tokensRemoved,
        });
        break;

      default:
        // Forward other events with generic handling
        if (event.type.startsWith('assistant.') || event.type.startsWith('tool.') || event.type.startsWith('session.')) {
          console.log(`[Event] ${event.type}:`, JSON.stringify(data).substring(0, 100));
        }
    }
  }

  /** Wait until any concurrent session-recreation is complete before proceeding. */
  private waitForSession(): Promise<void> {
    if (!this.sessionBusy) return Promise.resolve();
    return new Promise((resolve) => this.sessionBusyQueue.push(resolve));
  }

  private setSessionBusy(busy: boolean): void {
    this.sessionBusy = busy;
    if (!busy) {
      // Drain the queue — wake up any waiting callers
      const waiters = this.sessionBusyQueue.splice(0);
      waiters.forEach((fn) => fn());
    }
  }

  private applyLiveWebPolicy(message: string): string {
    if (!PLAYWRIGHT_MCP_ENABLED) return message;
    if (!LIVE_WEB_QUERY_PATTERN.test(message)) return message;

    return `${message}

[Execution policy: This is a live web query. You MUST use Playwright MCP browser automation for retrieval and MUST NOT use generic web_fetch for this request. Use direct source-site browsing/search in Playwright.]`;
  }

  private buildResponseStructurePolicy(message: string): string {
    if (IDENTITY_QUERY_PATTERN.test(message)) {
      return `Use this structure:
## Who I Am
- Introduce yourself as ${SIDEKICK_NAME}
- Do not mention SDK/internal model details unless explicitly asked

## How I Help
- 2-4 bullets`;
    }

    if (GREETING_QUERY_PATTERN.test(message)) {
      return `Keep response short and clean:
- 1-2 lines max using the ${SIDEKICK_NAME} persona
- Optional single bullet for next useful action`;
    }

    if (LIVE_WEB_QUERY_PATTERN.test(message)) {
      return `Use this exact structure:
## TL;DR
- 1-2 bullets

## Key Updates
- Bullet points only (no dense paragraphs)

## Why It Matters
- 2-4 bullets

## Sources
| Source | Date | Link |
| --- | --- | --- |`;
    }

    if (ACTION_QUERY_PATTERN.test(message)) {
      return `Use this structure:
## Objective
- One bullet

## Plan
- Numbered steps

## Progress / Output
- Bullet points with concrete status

## Next Step
- One clear next action`;
    }

    if (EXPLANATION_QUERY_PATTERN.test(message)) {
      return `Use this structure:
## Short Answer
- 1-2 bullets

## Key Reasons
- 3-6 bullets

## Practical Example
- One concise example`;
    }

    if (OPTIONS_QUERY_PATTERN.test(message)) {
      return `Use this structure:
## Options
- Numbered list with one-line tradeoff each

## Recommendation
- One clear recommended option and why`;
    }

    return `Use this structure:
## Answer
- Direct answer in 1-2 bullets

## Key Points
- 3-6 bullets

## Next
- One suggested follow-up action`;
  }

  private applyResponseStructurePolicy(message: string): string {
    const structurePolicy = this.buildResponseStructurePolicy(message);
    return `${message}

[Response format policy: ${structurePolicy}]`;
  }

  private shouldEnforceLiveWebPolicy(message: string): boolean {
    return PLAYWRIGHT_MCP_ENABLED && LIVE_WEB_QUERY_PATTERN.test(message);
  }

  private async selectLiveNewsAgentIfNeeded(enforceLiveWeb: boolean): Promise<void> {
    if (!enforceLiveWeb || !this.session) return;
    try {
      await this.session.rpc.agent.select({ name: 'live-news-agent' });
    } catch (error) {
      console.warn('[CopilotAgent] Failed to select live-news-agent:', error);
    }
  }

  private async deselectCustomAgentIfNeeded(enforceLiveWeb: boolean): Promise<void> {
    if (!enforceLiveWeb || !this.session) return;
    try {
      await this.session.rpc.agent.deselect();
    } catch (error) {
      console.warn('[CopilotAgent] Failed to deselect custom agent:', error);
    }
  }

  private async switchToLiveNewsModelIfNeeded(enforceLiveWeb: boolean): Promise<string | null> {
    if (!enforceLiveWeb || !LIVE_NEWS_MODEL || !this.session) return null;
    try {
      const current = await this.session.rpc.model.getCurrent();
      const currentModelId = current.modelId || this.currentModel;
      if (currentModelId === LIVE_NEWS_MODEL) {
        return null;
      }
      await this.session.rpc.model.switchTo({ modelId: LIVE_NEWS_MODEL });
      return currentModelId;
    } catch (error) {
      console.warn('[CopilotAgent] Failed to switch to live-news model:', error);
      return null;
    }
  }

  private async restoreModelIfNeeded(previousModelId: string | null): Promise<void> {
    if (!previousModelId || !this.session) return;
    try {
      await this.session.rpc.model.switchTo({ modelId: previousModelId });
    } catch (error) {
      console.warn('[CopilotAgent] Failed to restore model after live-news request:', error);
    }
  }

  async chat(message: string, attachments?: FileAttachment[]): Promise<string> {
    // Wait if the session is being recreated (model change / history clear)
    await this.waitForSession();

    // Initialize if not already done
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.emit('thinking', { status: 'Processing message' });

    // Log user message
    this.memoryManager!.logMessage({ role: 'user', content: message });

    const enforceLiveWeb = this.shouldEnforceLiveWebPolicy(message);
    if (enforceLiveWeb) this.liveWebEnforcementDepth++;
    let previousModelId: string | null = null;

    try {
      await this.selectLiveNewsAgentIfNeeded(enforceLiveWeb);
      previousModelId = await this.switchToLiveNewsModelIfNeeded(enforceLiveWeb);

      // Build the request payload
      const sendPayload: { prompt: string; attachments?: FileAttachment[] } = {
        prompt: this.applyLiveWebPolicy(this.applyResponseStructurePolicy(message)),
      };
      if (attachments && attachments.length > 0) {
        sendPayload.attachments = attachments;
      }

      // Send message and wait for response (longer timeout for complex app builds)
      // Retry once on stream destruction (Azure proxy can interrupt SSE connections)
      let response;
      try {
        response = await this.session!.sendAndWait(sendPayload, COPILOT_SEND_AND_WAIT_TIMEOUT_MS);
      } catch (streamErr: unknown) {
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        if (msg.includes('stream') || msg.includes('destroyed') || msg.includes('write after')) {
          console.warn('[CopilotAgent] Stream interrupted, recreating session and retrying...');
          // Recreate the session and retry once
          this.session = await this.client!.createSession(this.getSessionConfig());
          this.session.on((event) => this.handleSessionEvent(event));
          await this.selectLiveNewsAgentIfNeeded(enforceLiveWeb);
          await this.switchToLiveNewsModelIfNeeded(enforceLiveWeb);
          response = await this.session.sendAndWait(sendPayload, COPILOT_SEND_AND_WAIT_TIMEOUT_MS);
        } else {
          throw streamErr;
        }
      }

      const responseContent = (response?.data as { content?: string })?.content || 'No response received';

      // Log assistant response
      this.memoryManager!.logMessage({ role: 'assistant', content: responseContent });

      this.emit('done', { fullResponse: responseContent });

      return responseContent;
    } catch (error) {
      const errorMsg = `Error: ${error}`;
      this.emit('error', { error: errorMsg });
      throw error;
    } finally {
      await this.restoreModelIfNeeded(previousModelId);
      await this.deselectCustomAgentIfNeeded(enforceLiveWeb);
      if (enforceLiveWeb) {
        this.liveWebEnforcementDepth = Math.max(0, this.liveWebEnforcementDepth - 1);
      }
    }
  }

  // Send message without waiting (for streaming use case)
  async sendStreaming(message: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.emit('thinking', { status: 'Processing message' });
    this.memoryManager!.logMessage({ role: 'user', content: message });

    const enforceLiveWeb = this.shouldEnforceLiveWebPolicy(message);
    if (enforceLiveWeb) {
      this.liveWebEnforcementDepth++;
      this.pendingStreamingLiveWebEnforcement++;
    }
    let previousModelId: string | null = null;

    try {
      await this.selectLiveNewsAgentIfNeeded(enforceLiveWeb);
      previousModelId = await this.switchToLiveNewsModelIfNeeded(enforceLiveWeb);
      await this.session!.send({
        prompt: this.applyLiveWebPolicy(this.applyResponseStructurePolicy(message)),
      });
    } catch (error) {
      if (enforceLiveWeb) {
        this.liveWebEnforcementDepth = Math.max(0, this.liveWebEnforcementDepth - 1);
        this.pendingStreamingLiveWebEnforcement = Math.max(0, this.pendingStreamingLiveWebEnforcement - 1);
      }
      throw error;
    } finally {
      await this.restoreModelIfNeeded(previousModelId);
      await this.deselectCustomAgentIfNeeded(enforceLiveWeb);
    }
  }

  // Clear conversation history (but keep memory) and start new session
  async clearHistory(): Promise<void> {
    this.setSessionBusy(true);
    try {
      if (this.session) {
        await this.session.destroy();
        this.session = null;
      }

      // Re-create session with fresh history
      if (this.client) {
        this.session = await this.client.createSession(this.getSessionConfig());
        this.session.on((event) => {
          this.handleSessionEvent(event);
        });
      }
    } finally {
      this.setSessionBusy(false);
    }

    this.emit('session_start', { status: 'History cleared, new session created' });
  }

  // Get current memory
  getMemory(): string {
    return this.memoryManager!.getMemory();
  }

  // Update memory directly
  updateMemory(content: string): { success: boolean; message: string } {
    const result = this.memoryManager!.updateMemory(content);
    if (result.success) {
      this.emit('memory_updated', { action: 'direct_update' });
    }
    return result;
  }

  // Get current model
  getModel(): string {
    return this.currentModel;
  }

  // Get last usage snapshot (quota + tokens) from the SDK.
  getLastUsage(): Record<string, unknown> | null {
    return this.lastUsage;
  }

  // Switch model at runtime
  async setModel(model: string): Promise<void> {
    if (!model || model === this.currentModel) return;

    this.currentModel = model;
    console.log(`[Agent] Switching model to ${model}`);

    if (!this.isInitialized) return;

    // Block concurrent chat() calls while the session is being rebuilt
    this.setSessionBusy(true);
    try {
      if (this.session) {
        await this.session.destroy();
        this.session = null;
      }
      if (this.client) {
        this.session = await this.client.createSession(this.getSessionConfig());
        this.session.on((event) => {
          this.handleSessionEvent(event);
        });
      }
    } finally {
      this.setSessionBusy(false);
    }
  }

  // Cleanup
  async stop(): Promise<void> {
    if (this.session) {
      await this.session.destroy();
      this.session = null;
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    this.isInitialized = false;
  }
}

// No longer a singleton — instantiated per-user in index.ts
