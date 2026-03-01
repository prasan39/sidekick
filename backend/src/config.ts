export const WORKIQ_ENABLED = process.env.WORKIQ_ENABLED === 'true';
export const SUBSTACK_ENABLED = process.env.SUBSTACK_DIGEST_ENABLED === 'true';
export const GMAIL_ENABLED = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
export const FINANCE_ENABLED = process.env.FINANCE_ENABLED !== 'false';

function parseExtraArgs(raw: string | undefined): string[] {
  const value = (raw || '').trim();
  if (!value) return [];

  // JSON array form: ["--browser=chrome", "--caps=vision,pdf"]
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item).trim())
          .filter(Boolean);
      }
    } catch {
      // fall back to string parsing
    }
  }

  // Shell-like splitting with quote support.
  const shellParts = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (shellParts && shellParts.length > 1) {
    return shellParts
      .map((part) => part.replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
  }

  // Legacy fallback (comma-separated).
  return value
    .split(',')
    .map((arg) => arg.trim())
    .filter(Boolean);
}

// Optional Playwright MCP browser automation integration
export const PLAYWRIGHT_MCP_ENABLED = process.env.PLAYWRIGHT_MCP_ENABLED === 'true';
// Playwright MCP runs headed by default; for backend/server usage we default to headless unless explicitly disabled.
export const PLAYWRIGHT_MCP_HEADLESS = process.env.PLAYWRIGHT_MCP_HEADLESS !== 'false';
export const PLAYWRIGHT_MCP_EXTRA_ARGS = parseExtraArgs(process.env.PLAYWRIGHT_MCP_EXTRA_ARGS);
// Web search behavior when Playwright MCP is enabled:
// - direct: use search engines/news sites directly
// - chatgpt: open chatgpt.com and ask it to web search (requires active login in that browser session)
export const PLAYWRIGHT_WEB_SEARCH_MODE =
  (process.env.PLAYWRIGHT_WEB_SEARCH_MODE || 'chatgpt').toLowerCase() === 'chatgpt'
    ? 'chatgpt'
    : 'direct';

// Optional model override for live-news/browser-heavy requests.
// Example: LIVE_NEWS_MODEL=gpt-5.1
export const LIVE_NEWS_MODEL = (process.env.LIVE_NEWS_MODEL || '').trim();
