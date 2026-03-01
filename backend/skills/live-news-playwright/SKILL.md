---
name: live-news-playwright
description: Use this skill when the user asks for live/latest/today/breaking/current news or web updates that require fresh browsing.
version: 1.0.0
---

# Live News Playwright Skill

Use this skill for requests that depend on fresh web data.

## Trigger keywords

- live
- latest
- breaking
- today
- current update
- right now
- news

## Workflow

1. Use Playwright MCP browser tools for retrieval.
2. In `chatgpt` mode, open `https://chatgpt.com` first and use ChatGPT web search.
3. If ChatGPT is unavailable/sign-in blocked, fall back to direct browsing of authoritative sources.
4. Collect concise facts only (headline, timestamp, source, URL, summary).
5. Return source links and call out when timestamps are missing.

## Guardrails

- Do not use `web_fetch` for live-news retrieval.
- Prefer primary or highly reputable sources.
- Distinguish confirmed facts from unverified claims.
- Include exact dates/times when available.
