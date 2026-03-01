# Sidekick

**Tagline:** The AI teammate that sits beside you and gets real work done.

**Backstory:**
Every superhero has a sidekick, and builders are no different. You are the hero driving the mission; Sidekick handles the ground game.
It can see your local project folders, make code and file changes, run commands, and help execute tasks end-to-end instead of just chatting.
When the work gets chaotic across tools and tabs, Sidekick stays in your corner so you can move faster without losing control.

Full-stack AI workspace built with React + Express + GitHub Copilot SDK.

## Highlights

- Streaming chat UI with tool-call events
- Persistent memory + hybrid recall
- Optional Playwright MCP browser automation
- Optional finance tools (stock quote/history)
- Optional Gmail + Substack digest pipeline

## Tech Stack

- Frontend: React, Vite, TypeScript
- Backend: Node.js, Express, WebSocket, TypeScript
- Agent runtime: `@github/copilot-sdk`

## Quick Start (Local, No OAuth)

This is the fastest path for forks.

### 1. Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm
- GitHub account with Copilot access

### 2. Clone and install

```bash
git clone <your-fork-url>
cd sidekick
npm install
```

Example (upstream):

```bash
git clone https://github.com/prasan39/sidekick.git
cd sidekick
```

### 3. Backend env

```bash
cp backend/.env.example backend/.env
```

Set at least:

```env
COPILOT_GITHUB_TOKEN=gho_or_github_pat_token_here
AUTH_BYPASS_LOCAL=true
```

How to get token:

```bash
gh auth token
```

Then paste it into `backend/.env` as `COPILOT_GITHUB_TOKEN`.

### 4. Frontend env

```bash
cp frontend/.env.example frontend/.env.local
```

Keep:

```env
VITE_API_BASE=
VITE_AUTH_BYPASS=true
```

### 5. Run

```bash
npm run dev
```

Open: `http://localhost:5173`

## OAuth Mode (Optional)

If you want real GitHub sign-in instead of local bypass:

- Backend:
  - set `AUTH_BYPASS_LOCAL=false`
  - set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWT_SECRET`, `APP_URL`
- Frontend:
  - set `VITE_AUTH_BYPASS=false`

## Useful Scripts

- `npm run dev` - start frontend + backend
- `npm run build` - build frontend + backend
- `npm run start:prod` - run built backend

## Environment Notes

- Never commit `backend/.env` or `frontend/.env.local`
- Keep real keys/tokens only in local env or secret manager

## Project Layout

```text
.
├── backend/
│   ├── src/
│   └── .env.example
├── frontend/
│   ├── src/
│   └── .env.example
├── package.json
└── README.md
```
