# Heartbeat Service - Always-On Proactive Assistant

The heartbeat service enables your work assistant to be **always on** and proactively help you without waiting for prompts.

## Features

| Feature | Description |
|---------|-------------|
| **Email Monitoring** | Polls for new emails, notifies you, auto-drafts responses |
| **Draft Responses** | AI generates response drafts (never sends automatically) |
| **Background Tasks** | Track long-running tasks with progress updates |
| **App Building** | Invoke Copilot CLI to build apps in a sandbox folder |
| **Nudge System** | Push notifications via WebSocket for all events |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     Heartbeat Service                           │
│                    (Always Running)                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│   │   Email     │    │    Task     │    │    CLI      │      │
│   │  Monitor    │    │   Manager   │    │   Runner    │      │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘      │
│          │                  │                   │              │
│          │     ┌────────────┴────────────┐     │              │
│          │     │                         │     │              │
│          ▼     ▼                         ▼     ▼              │
│   ┌─────────────────────────────────────────────────┐        │
│   │                  Notifier                        │        │
│   │         (WebSocket Push to UI)                  │        │
│   └─────────────────────────────────────────────────┘        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Email Monitoring & Auto-Draft

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│ Work IQ │ ───▶ │ Detect  │ ───▶ │  Draft  │ ───▶ │  Nudge  │
│  Poll   │      │  New    │      │Response │      │   You   │
│ (1 min) │      │ Emails  │      │ (AI)    │      │         │
└─────────┘      └─────────┘      └─────────┘      └─────────┘
                                        │
                                        ▼
                                  ┌─────────┐
                                  │ YOU     │
                                  │ Review  │
                                  │ & Edit  │
                                  │ & Send  │
                                  └─────────┘
```

**Key point**: The assistant NEVER sends emails automatically. It only drafts them and nudges you to review.

### 2. Background Tasks

When you ask the assistant to do something long-running:

```typescript
// You: "Analyze all my emails from last month"
// Assistant: Starts background task, immediately responds
// ... task runs in background ...
// Assistant: *nudge* "Analysis complete! Here are the results..."
```

### 3. App Building via Copilot CLI

```typescript
// You: "Build me a React dashboard for my sales data"
// Assistant: Invokes Copilot CLI in sandbox folder
// ... Copilot builds the app ...
// Assistant: *nudge* "App 'sales-dashboard' built! Open folder?"
```

## API Endpoints

### Heartbeat Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/heartbeat/status` | GET | Get service status |
| `/api/heartbeat/start` | POST | Start proactive monitoring |
| `/api/heartbeat/stop` | POST | Stop monitoring |
| `/api/heartbeat/config` | PUT | Update config (intervals, etc.) |
| `/api/heartbeat/check-emails` | POST | Force immediate email check |

### Nudges

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nudges` | GET | Get all nudges (unread + history) |
| `/api/nudges` | POST | Send custom nudge (testing) |
| `/api/nudges/:id/acknowledge` | POST | Mark nudge as read |

### Background Tasks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks` | GET | List all tasks with stats |
| `/api/tasks/:id` | GET | Get task details |
| `/api/tasks/:id/cancel` | POST | Cancel pending task |
| `/api/tasks/clear-completed` | POST | Clear finished tasks |

### App Building

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/apps/build` | POST | Start building an app |
| `/api/apps` | GET | List all built apps |

### Email Drafts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/drafts` | GET | List all draft responses |
| `/api/drafts/:emailId` | GET | Get specific draft |
| `/api/drafts/:emailId` | DELETE | Discard draft |

## WebSocket Events

The heartbeat sends these events via WebSocket (`ws://localhost:3001/ws`):

```typescript
// New nudge
{ type: 'nudge', data: { id, type, title, message, actions, ... } }

// Tasks updated
{ type: 'tasks_updated', data: { tasks: [...] } }
```

## Nudge Types

| Type | When Triggered | Actions Available |
|------|----------------|-------------------|
| `new_email` | New unread email detected | Draft Response, View, Dismiss |
| `email_draft_ready` | AI draft completed | Review & Edit, Send, Discard |
| `task_complete` | Background task finished | View Result, Dismiss |
| `task_failed` | Background task errored | Retry, View Error, Dismiss |
| `app_build_complete` | App build succeeded | Open Folder, Run App, Dismiss |
| `app_build_failed` | App build failed | Retry, View Logs, Dismiss |
| `meeting_soon` | Meeting in 15 minutes | Join, Snooze, Dismiss |
| `custom` | Manual/programmatic | Configurable |

## Configuration

```typescript
interface HeartbeatConfig {
  enabled: boolean;              // Master switch
  emailCheckInterval: number;    // ms between email polls (default: 60000)
  taskCheckInterval: number;     // ms between task checks (default: 5000)
  maxConcurrentTasks: number;    // Parallel task limit (default: 3)
  emailDraftEnabled: boolean;    // Auto-draft responses
  appBuildEnabled: boolean;      // Allow Copilot CLI builds
  projectSandboxPath: string;    // Where to build apps
}
```

Update via API:

```bash
curl -X PUT http://localhost:3001/api/heartbeat/config \
  -H "Content-Type: application/json" \
  -d '{"emailCheckInterval": 30000, "emailDraftEnabled": true}'
```

## Usage Examples

### Start Proactive Monitoring

```bash
curl -X POST http://localhost:3001/api/heartbeat/start
```

### Build an App

```bash
curl -X POST http://localhost:3001/api/apps/build \
  -H "Content-Type: application/json" \
  -d '{"description": "Create a React todo app with local storage", "appName": "my-todo-app"}'
```

### Get Pending Nudges

```bash
curl http://localhost:3001/api/nudges
```

### Acknowledge a Nudge

```bash
curl -X POST http://localhost:3001/api/nudges/abc123/acknowledge
```

## Safety Guarantees

1. **Never auto-sends emails** - Only drafts, you must approve
2. **Never auto-sends Teams messages** - Requires explicit approval
3. **Sandbox isolation** - App builds happen in dedicated folder
4. **Cancellable tasks** - Long-running tasks can be stopped
5. **Configurable intervals** - Control how often it checks things
6. **Can be disabled** - `POST /api/heartbeat/stop` at any time

## Cost

| Component | Cost |
|-----------|------|
| Email polling | Uses Work IQ (your Copilot license) |
| Draft generation | Uses Claude via Copilot SDK (your license) |
| App building | Uses Copilot CLI (your license) |
| Background tasks | Local processing, free |
| Notifications | Local WebSocket, free |

Everything runs through your existing GitHub Copilot license - no additional costs.
