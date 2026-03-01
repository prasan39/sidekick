# Sidekick

**Tagline:** Your coding sidekick for local missions.

**Backstory:**
You are the superhero; Sidekick handles the ground game.
It can read your local project folders, edit code, run commands, and ship tasks end-to-end.
When your mission gets chaotic, Sidekick stays beside you and keeps execution fast.

Sidekick is the public, sanitized export of the CoWork app: React + Vite frontend, Express + WebSocket backend, and GitHub Copilot SDK orchestration.

## What You Get

- Terminal-inspired chat UI with light/dark themes
- Streaming responses + tool-call status
- Structured output policy (answer/steps/options formats)
- Optional reasoning stream rendering
- Memory + retrieval endpoints
- Optional Playwright MCP live web browsing
- Optional finance tools (quote/history)
- Optional PPTX generation skill + sub-agent
- Optional Vercel preview deploy skill + sub-agent
- Optional web artifact and theme skills

## Included Skills

Skills live in `backend/skills/`:

- `finance-stocks` - quote/history tools for public tickers
- `live-news-playwright` - fresh/live web retrieval with Playwright MCP
- `pptx` - structured presentation creation via `create_presentation`
- `theme-factory` - reusable visual themes for artifacts/decks
- `web-artifacts-builder` - generate complex single-file web artifacts
- `vercel-deploy` - claimable Vercel preview deployment workflow

## When Skills and Sub-Agents Are Invoked

- Skills are loaded from `backend/skills` via `skillDirectories` in `backend/src/copilot-agent.ts`.
- The SDK/orchestrator pulls skills context when the user request semantically matches a skill (or when explicitly requested).
- Custom sub-agents are registered with `infer: true` and auto-selected by intent:
  - `pptx-agent` for presentation/deck requests
  - `finance-agent` for stock quote/history requests (`FINANCE_ENABLED=true`)
  - `live-news-agent` for queries matching live-web terms like `latest`, `today`, `breaking`, `news` (`PLAYWRIGHT_MCP_ENABLED=true`)
  - `vercel-deploy-agent` for deployment/share-preview requests (`VERCEL_DEPLOY_ENABLED=true`)

## Quick Start (Local)

### 1. Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm
- GitHub account with Copilot access

### 2. Clone + install

```bash
git clone https://github.com/prasan39/sidekick.git
cd sidekick
npm install
```

### 3. Configure backend

```bash
cp backend/.env.example backend/.env
```

Set at least:

```env
COPILOT_GITHUB_TOKEN=gho_or_github_pat_token_here
AUTH_BYPASS_LOCAL=true
SIDEKICK_NAME=SidekickNova
```

Get token:

```bash
gh auth token
```

### 4. Configure frontend

```bash
cp frontend/.env.example frontend/.env.local
```

Default local bypass:

```env
VITE_API_BASE=
VITE_AUTH_BYPASS=true
```

### 5. Run

```bash
npm run dev
```

Open `http://localhost:5173`.

## Optional Feature Flags

Backend (`backend/.env`):

- `PLAYWRIGHT_MCP_ENABLED=true` to enable live web browsing via Playwright MCP
- `PLAYWRIGHT_MCP_HEADLESS=false` for headed browser mode
- `PLAYWRIGHT_MCP_EXTRA_ARGS=--browser=chrome --caps=vision,pdf`
- `LIVE_NEWS_MODEL=gpt-5.1` to use a stronger model for live news flows
- `FINANCE_ENABLED=true|false`
- `VERCEL_DEPLOY_ENABLED=true|false`
- `SUBSTACK_DIGEST_ENABLED=true|false`

## OAuth Mode (Optional)

If you want real GitHub sign-in instead of local bypass:

- Backend: `AUTH_BYPASS_LOCAL=false`, and set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWT_SECRET`, `APP_URL`
- Frontend: `VITE_AUTH_BYPASS=false`

## Scripts

- `npm run dev` - frontend + backend
- `npm run build` - build frontend + backend
- `npm run start:prod` - run compiled backend

## Security Notes

- Do not commit `backend/.env` or `frontend/.env.local`
- This public repo intentionally excludes personal memory data and user-specific persona names
