// ── SIGNAL GUARD: must be FIRST before any imports ──────────────────
// Trap every possible termination signal to find out what kills us.
// In dev mode we ignore SIGINT entirely (Python-wrapped node / VS Code
// terminal process-group issues forward spurious SIGINTs).
const _DEV = !!process.env.TSX_DEV;

// Handle SIGINT separately with proper prevention
process.on('SIGINT', () => {
  if (_DEV) {
    console.log(`[SIGNAL-GUARD] Ignoring SIGINT (dev mode)`);
    // Prevent default exit behavior in dev mode
    return;
  }
  console.log(`[SIGNAL-GUARD] Received SIGINT — shutting down`);
  process.exit(0);
});

// Handle other signals
for (const sig of ['SIGHUP', 'SIGBREAK'] as const) {
  process.on(sig, () => {
    console.log(`[SIGNAL-GUARD] Received ${sig} — shutting down`);
    process.exit(0);
  });
}

process.on('beforeExit', (code) => console.log(`[SIGNAL-GUARD] beforeExit code=${code}`));
process.on('exit', (code) => console.log(`[SIGNAL-GUARD] exit code=${code}`));
process.on('uncaughtException', (err) => {
  console.error(`[SIGNAL-GUARD] uncaughtException:`, err);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[SIGNAL-GUARD] unhandledRejection:`, reason);
});
// ────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import multer from 'multer';
import { parseOffice } from 'officeparser';
import { CopilotAgent, AgentEvent } from './copilot-agent.js';
import { EnhancedMemoryManager } from './memory/index.js';
import { createAuthRouter, authMiddleware, verifyToken, AuthUser } from './auth.js';
import { approvalManager } from './approval-manager.js';
import { heartbeatService } from './heartbeat/index.js';
import { WORKIQ_ENABLED, SUBSTACK_ENABLED, GMAIL_ENABLED } from './config.js';
import { substackPipeline } from './substack/index.js';
import { gmailClient } from './gmail.js';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  }) as Promise<T>;
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const CHAT_REQUEST_TIMEOUT_MS = Number(process.env.CHAT_REQUEST_TIMEOUT_MS) || 960000; // 16 minutes
const AUTH_BYPASS_LOCAL = process.env.AUTH_BYPASS_LOCAL === 'true';
const LOCAL_BYPASS_USER: AuthUser = {
  githubId: 0,
  login: 'local-dev',
  avatarUrl: '',
  githubToken: '',
};

// Middleware
app.use(cors());
app.use(express.json());

// ── Per-user session management ──────────────────────────────────────
interface UserSession {
  agent: CopilotAgent;
  memoryManager: EnhancedMemoryManager;
  lastActive: number;
}
const userSessions = new Map<number, UserSession>();
const SESSION_TTL = 15 * 60 * 1000; // 15 minutes idle timeout (memory-conscious)
const MAX_SESSIONS = 2; // Free tier memory limit

function getUserSession(user: AuthUser): UserSession {
  let session = userSessions.get(user.githubId);
  if (!session) {
    // Evict oldest session if at capacity
    if (userSessions.size >= MAX_SESSIONS) {
      let oldestId: number | null = null;
      let oldestTime = Infinity;
      for (const [id, s] of userSessions) {
        if (s.lastActive < oldestTime) {
          oldestTime = s.lastActive;
          oldestId = id;
        }
      }
      if (oldestId !== null) {
        const evicted = userSessions.get(oldestId)!;
        console.log(`[Session] Evicting idle session for user ${oldestId}`);
        evicted.agent.stop().catch(() => {});
        evicted.memoryManager.close();
        userSessions.delete(oldestId);
      }
    }

    const dataDir = path.join(process.cwd(), 'data', 'users', String(user.githubId));
    const memoryManager = new EnhancedMemoryManager(dataDir);
    const agent = new CopilotAgent(user.githubToken, memoryManager);
    agent.setEventCallback((event) => {
      console.log(`[${user.login}][${event.type}]`, JSON.stringify(event.data).substring(0, 100));
      broadcast(event);
    });
    session = { agent, memoryManager, lastActive: Date.now() };
    userSessions.set(user.githubId, session);
    // Initialize async
    memoryManager.initialize().catch(err => console.warn(`[Session] Memory init failed for ${user.login}:`, err));
  }
  session.lastActive = Date.now();
  return session;
}

// Cleanup idle sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of userSessions) {
    if (now - session.lastActive > SESSION_TTL) {
      console.log(`[Session] Cleaning up idle session for user ${id}`);
      session.agent.stop().catch(() => {});
      session.memoryManager.close();
      userSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Auth routes (unprotected)
app.use('/api/auth', createAuthRouter());

// Public API paths that do not require JWT auth
const PUBLIC_API_PATHS = new Set([
  '/health',
  '/gmail/oauth/callback',
]);

// Protect all other API routes with JWT auth
app.use('/api', (req, res, next) => {
  if (AUTH_BYPASS_LOCAL) {
    req.user = LOCAL_BYPASS_USER;
    return next();
  }
  if (PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }
  return authMiddleware(req, res, next);
});

// File uploads configuration
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const allowedMimeTypes = [
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  // Documents
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  // Office
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  // Code
  'application/json', 'application/xml', 'text/html', 'text/css',
  'application/javascript', 'text/javascript', 'application/typescript',
];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

// Serve uploaded files for thumbnail previews
app.use('/uploads', express.static(uploadsDir));

// In production, optionally serve the built frontend from the backend.
const serveFrontend = process.env.SERVE_FRONTEND === 'true' || process.env.NODE_ENV === 'production';
const frontendDist = path.join(process.cwd(), 'frontend', 'dist');

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for real-time events
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected clients
const clients = new Set<WebSocket>();

// Track last check timestamps so they survive page refreshes
let lastEmailCheckTimestamp: string | null = null;
let lastTeamsCheckTimestamp: string | null = null;

// Store recent activities so they survive page refreshes
interface StoredActivity {
  id: string;
  query: string;
  response: string;
  timestamp: string;
}
const recentActivities: StoredActivity[] = [];

wss.on('connection', async (ws, req) => {
  let user: AuthUser = LOCAL_BYPASS_USER;
  if (!AUTH_BYPASS_LOCAL) {
    try {
      const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(1008, 'Authentication required');
        return;
      }
      user = await verifyToken(token);
    } catch (err) {
      console.warn('[WS] Authentication failed:', err);
      ws.close(1008, 'Invalid or expired token');
      return;
    }
  }

  console.log(`Client connected: ${user.login}`);
  (ws as any).user = user;
  clients.add(ws);

  // Ensure user session exists
  const session = getUserSession(user);

  // Mark connection alive for ping/pong keepalive
  (ws as any).isAlive = true;
  ws.on('pong', () => { (ws as any).isAlive = true; });

  // Send initial state
  ws.send(JSON.stringify({
    type: 'connected',
    timestamp: new Date().toISOString(),
    data: {
      pendingApprovals: approvalManager.getPendingApprovals(),
      memory: session.memoryManager.getMemory(),
      usage: session.agent.getLastUsage(),
      lastEmailCheck: lastEmailCheckTimestamp,
      lastTeamsCheck: lastTeamsCheckTimestamp,
      activities: recentActivities,
      settings: {
        model: session.agent.getModel(),
        emailCheckInterval: heartbeatService.getConfig().emailCheckInterval,
        teamsCheckInterval: heartbeatService.getConfig().teamsCheckInterval,
        emailDraftEnabled: heartbeatService.getConfig().emailDraftEnabled,
        teamsCheckEnabled: heartbeatService.getConfig().teamsCheckEnabled,
        workIqEnabled: WORKIQ_ENABLED,
      },
      user: { login: user.login, avatarUrl: user.avatarUrl },
    },
  }));

  ws.on('close', (code, reason) => {
    const r = reason ? reason.toString() : '';
    console.log(`Client disconnected: ${user!.login} (code=${code} reason=${r})`);
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Ping every 25s to keep connections alive and detect dead ones
const WS_PING_INTERVAL = setInterval(() => {
  wss.clients.forEach((ws) => {
    if ((ws as any).isAlive === false) {
      clients.delete(ws);
      return ws.terminate();
    }
    (ws as any).isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(WS_PING_INTERVAL));

// Broadcast event to all connected clients
function broadcast(event: AgentEvent | { type: string; timestamp: string; data: Record<string, unknown> }): void {
  const message = JSON.stringify(event);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Note: Event callbacks are now set per-user in getUserSession

// Set up approval update callback
approvalManager.setUpdateCallback((approvals) => {
  broadcast({
    type: 'approvals_updated',
    timestamp: new Date().toISOString(),
    data: { approvals },
  });
});

// Set up heartbeat nudge notifications via WebSocket
heartbeatService.notifier.onNudge((nudge) => {
  broadcast({
    type: 'nudge',
    timestamp: new Date().toISOString(),
    data: { ...nudge } as Record<string, unknown>,
  });
});

// Set up task update notifications
heartbeatService.taskManager.onUpdate((tasks) => {
  broadcast({
    type: 'tasks_updated',
    timestamp: new Date().toISOString(),
    data: { tasks },
  });
});

// REST API Endpoints

// Binary document types that need text extraction (SDK's view tool can't parse these)
const binaryDocMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
]);

// Convert binary documents to text files the SDK can read
async function resolveAttachment(f: Express.Multer.File) {
  if (binaryDocMimeTypes.has(f.mimetype)) {
    try {
      const ast = await parseOffice(f.path);
      const text = ast.toText();
      const txtPath = f.path.replace(/\.[^.]+$/, '.txt');
      fs.writeFileSync(txtPath, `[Extracted from: ${f.originalname}]\n\n${text}`, 'utf-8');
      console.log(`[Upload] Extracted text from ${f.originalname} → ${path.basename(txtPath)}`);
      return { type: 'file' as const, path: txtPath, displayName: f.originalname };
    } catch (err) {
      console.warn(`[Upload] Text extraction failed for ${f.originalname}:`, err);
      // Fall through to raw attachment
    }
  }
  return { type: 'file' as const, path: f.path, displayName: f.originalname };
}

// Send a chat message (supports multipart file uploads)
app.post('/api/chat', upload.array('files', 5), async (req, res) => {
  const message = req.body.message;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const session = getUserSession(req.user!);
    const files = req.files as Express.Multer.File[] | undefined;
    const attachments = files && files.length > 0
      ? await Promise.all(files.map(resolveAttachment))
      : undefined;

    // Never hang the HTTP request indefinitely in production.
    const response = await withTimeout(
      session.agent.chat(message, attachments),
      CHAT_REQUEST_TIMEOUT_MS,
      'Chat request',
    );
    res.json({ response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Get memory content
app.get('/api/memory', (req, res) => {
  const session = getUserSession(req.user!);
  res.json({
    memory: session.memoryManager.getMemory(),
    stats: session.memoryManager.getDailyStats(),
  });
});

// Update memory content
app.put('/api/memory', (req, res) => {
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Content is required' });
  }

  const session = getUserSession(req.user!);
  const result = session.agent.updateMemory(content);
  res.json(result);
});

// Get pending approvals
app.get('/api/pending', (req, res) => {
  res.json({ approvals: approvalManager.getPendingApprovals() });
});

// Approve or deny an action
app.post('/api/approve', (req, res) => {
  const { approvalId, approved } = req.body;

  if (!approvalId || typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'approvalId and approved are required' });
  }

  const result = approvalManager.resolve(approvalId, approved);
  res.json(result);
});

// Patterns to filter out internal heartbeat messages and their responses
const HEARTBEAT_CONTENT_FILTERS = [
  'You are a JSON extractor',
  'Show me all emails I received in the last',
  'Show me my unread emails',
  'automated background check',
  'automated background task',
  'Teams chat messages',
  'No Teams @mentions found',
  'No matching emails found',
  'No matching emails',
  'No new emails',
];

function isHeartbeatMessage(content: string): boolean {
  return HEARTBEAT_CONTENT_FILTERS.some(f => content.includes(f));
}

// Get chat history from daily JSONL (survives page refresh)
app.get('/api/chat/history', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const session = getUserSession(req.user!);
    const entries = session.memoryManager.getRecentContext(500);
    const chatMessages = entries
      .filter(e => (e.role === 'user' || e.role === 'assistant') && !e.type)
      .filter(e => !isHeartbeatMessage(e.content))
      .slice(-limit)
      .map((e, i) => ({
        id: `history_${i}_${Date.now()}`,
        role: e.role,
        content: e.content,
        timestamp: e.ts,
      }));

    res.json({ messages: chatMessages });
  } catch (error) {
    console.error('History error:', error);
    res.json({ messages: [] });
  }
});

// Clear conversation history
app.post('/api/clear', async (req, res) => {
  const session = getUserSession(req.user!);
  // Clear conversation log FIRST so the new session's system prompt starts fresh
  session.memoryManager.clearConversationLog();
  await session.agent.clearHistory();
  const cleaned = cleanUploads();
  res.json({ success: true, message: 'Conversation history cleared', filesRemoved: cleaned });
});

// Serve generated PowerPoint files for download
app.get('/api/presentations/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(process.cwd(), 'data', 'presentations', filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.sendFile(filePath);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    clients: clients.size,
  });
});

// Enhanced memory endpoints

// Search memory using hybrid search
app.post('/api/memory/search', async (req, res) => {
  const { query, limit = 10 } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const session = getUserSession(req.user!);
    const results = await session.memoryManager.recall(query, limit);
    res.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Get memory index stats
app.get('/api/memory/stats', (req, res) => {
  const session = getUserSession(req.user!);
  res.json({
    index: session.memoryManager.getIndexStats(),
    daily: session.memoryManager.getDailyStats(),
    compaction: session.memoryManager.getCompactionStatus(),
  });
});

// Rebuild memory index
app.post('/api/memory/rebuild', async (req, res) => {
  try {
    const session = getUserSession(req.user!);
    await session.memoryManager.rebuildIndex();
    res.json({ success: true, stats: session.memoryManager.getIndexStats() });
  } catch (error) {
    console.error('Rebuild error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Trigger pre-compaction flush
app.post('/api/memory/flush', async (req, res) => {
  try {
    const session = getUserSession(req.user!);
    const facts = await session.memoryManager.triggerPreCompactionFlush();
    res.json({ success: true, factsSaved: facts.length, facts });
  } catch (error) {
    console.error('Flush error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ==================== HEARTBEAT / PROACTIVE NUDGING ENDPOINTS ====================

// Get heartbeat status
app.get('/api/heartbeat/status', (req, res) => {
  res.json(heartbeatService.getStatus());
});

// Start/stop heartbeat
app.post('/api/heartbeat/start', (req, res) => {
  heartbeatService.start();
  res.json({ success: true, status: heartbeatService.getStatus() });
});

app.post('/api/heartbeat/stop', (req, res) => {
  heartbeatService.stop();
  res.json({ success: true, status: heartbeatService.getStatus() });
});

// Update heartbeat config
app.put('/api/heartbeat/config', (req, res) => {
  const config = req.body;
  heartbeatService.setConfig(config);
  res.json({ success: true, config: heartbeatService.getConfig() });
});

// ==================== SETTINGS ENDPOINTS ====================

// Get current settings
app.get('/api/settings', (req, res) => {
  const session = getUserSession(req.user!);
  const hbConfig = heartbeatService.getConfig();
  res.json({
    model: session.agent.getModel(),
    emailCheckInterval: hbConfig.emailCheckInterval,
    teamsCheckInterval: hbConfig.teamsCheckInterval,
    emailDraftEnabled: hbConfig.emailDraftEnabled,
    teamsCheckEnabled: hbConfig.teamsCheckEnabled,
    workIqEnabled: WORKIQ_ENABLED,
  });
});

// Update settings
app.put('/api/settings', async (req, res) => {
  const { model, emailCheckInterval, teamsCheckInterval, emailDraftEnabled, teamsCheckEnabled } = req.body;

  try {
    const session = getUserSession(req.user!);
    // Update model if changed
    if (model && typeof model === 'string') {
      await session.agent.setModel(model);
    }

    // Update heartbeat config — only send values that actually changed to avoid
    // an unnecessary stop→start cycle that could drop a scheduled check.
    const currentConfig = heartbeatService.getConfig();
    const configUpdate: Record<string, unknown> = {};
    if (WORKIQ_ENABLED && typeof emailCheckInterval === 'number' && emailCheckInterval >= 60000
        && emailCheckInterval !== currentConfig.emailCheckInterval) {
      configUpdate.emailCheckInterval = emailCheckInterval;
    }
    if (WORKIQ_ENABLED && typeof teamsCheckInterval === 'number' && teamsCheckInterval >= 60000
        && teamsCheckInterval !== currentConfig.teamsCheckInterval) {
      configUpdate.teamsCheckInterval = teamsCheckInterval;
    }
    if (WORKIQ_ENABLED && typeof emailDraftEnabled === 'boolean'
        && emailDraftEnabled !== currentConfig.emailDraftEnabled) {
      configUpdate.emailDraftEnabled = emailDraftEnabled;
    }
    if (WORKIQ_ENABLED && typeof teamsCheckEnabled === 'boolean'
        && teamsCheckEnabled !== currentConfig.teamsCheckEnabled) {
      configUpdate.teamsCheckEnabled = teamsCheckEnabled;
    }

    if (Object.keys(configUpdate).length > 0) {
      heartbeatService.setConfig(configUpdate as any);
    }

    // Broadcast settings update to all clients
    broadcast({
      type: 'settings_updated',
      timestamp: new Date().toISOString(),
      data: {
        model: session.agent.getModel(),
        emailCheckInterval: heartbeatService.getConfig().emailCheckInterval,
        teamsCheckInterval: heartbeatService.getConfig().teamsCheckInterval,
        emailDraftEnabled: heartbeatService.getConfig().emailDraftEnabled,
        teamsCheckEnabled: heartbeatService.getConfig().teamsCheckEnabled,
        workIqEnabled: WORKIQ_ENABLED,
      },
    });

    res.json({
      success: true,
      settings: {
        model: session.agent.getModel(),
        emailCheckInterval: heartbeatService.getConfig().emailCheckInterval,
        teamsCheckInterval: heartbeatService.getConfig().teamsCheckInterval,
        emailDraftEnabled: heartbeatService.getConfig().emailDraftEnabled,
        teamsCheckEnabled: heartbeatService.getConfig().teamsCheckEnabled,
        workIqEnabled: WORKIQ_ENABLED,
      },
    });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Force email check
app.post('/api/heartbeat/check-emails', async (req, res) => {
  if (!WORKIQ_ENABLED) {
    return res.status(400).json({ error: 'Work IQ is disabled' });
  }
  try {
    await heartbeatService.forceEmailCheck();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Force Teams check
app.post('/api/heartbeat/check-teams', async (req, res) => {
  if (!WORKIQ_ENABLED) {
    return res.status(400).json({ error: 'Work IQ is disabled' });
  }
  try {
    await heartbeatService.forceTeamsCheck();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get nudges
app.get('/api/nudges', (req, res) => {
  res.json({
    unacknowledged: heartbeatService.notifier.getUnacknowledged(),
    history: heartbeatService.notifier.getHistory(50),
  });
});

// ==================== GMAIL MCP (minimal) ====================

// Return OAuth URL to authorize Gmail access
app.get('/api/gmail/oauth/url', (req, res) => {
  try {
    if (!gmailClient.isConfigured()) {
      return res.status(400).json({ error: 'Gmail not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in env.' });
    }
    const url = gmailClient.getAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// OAuth callback endpoint
app.get('/api/gmail/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code) return res.status(400).send('Missing code');
    await gmailClient.handleCallback(code);
    res.send('Gmail authorized successfully. You can close this window.');
  } catch (err) {
    console.error('[Gmail] OAuth callback error:', err);
    res.status(500).send('Gmail authorization failed: ' + String(err));
  }
});

// Simple endpoint to list latest Gmail messages (requires authorization)
app.get('/api/gmail/latest', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    const max = parseInt((req.query.max as string) || '5', 10);
    const list = await gmailClient.listLatest(q, max);
    res.json({ messages: list });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Acknowledge a nudge
app.post('/api/nudges/:id/acknowledge', (req, res) => {
  const success = heartbeatService.notifier.acknowledge(req.params.id);
  res.json({ success });
});

// Send a custom nudge (for testing)
app.post('/api/nudges', (req, res) => {
  const { title, message, priority = 'normal' } = req.body;
  const nudge = heartbeatService.notifier.notifyCustom(title, message, priority);
  res.json(nudge);
});

// Test endpoint: push a fake heartbeat activity to the Activity Feed
app.post('/api/test-activity', (req, res) => {
  const { message, response } = req.body;
  broadcast({
    type: 'heartbeat_activity',
    timestamp: new Date().toISOString(),
    data: { message: message || 'Test query', response: response || 'Test response' },
  });
  res.json({ ok: true });
});

// ==================== BACKGROUND TASKS ENDPOINTS ====================

// Get all tasks
app.get('/api/tasks', (req, res) => {
  res.json({
    tasks: heartbeatService.taskManager.getAllTasks(),
    stats: heartbeatService.taskManager.getStats(),
  });
});

// Get a specific task
app.get('/api/tasks/:id', (req, res) => {
  const task = heartbeatService.taskManager.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(task);
});

// Cancel a task
app.post('/api/tasks/:id/cancel', (req, res) => {
  const success = heartbeatService.taskManager.cancel(req.params.id);
  res.json({ success });
});

// Mark all email_draft tasks in 'review' status as reviewed
// (must be before :id route so Express doesn't match 'review-drafts' as :id)
app.post('/api/tasks/review-drafts', (req, res) => {
  const tasks = heartbeatService.taskManager.getAllTasks();
  let count = 0;
  for (const task of tasks) {
    if (task.type === 'email_draft' && task.status === 'review') {
      heartbeatService.taskManager.markReviewed(task.id);
      count++;
    }
  }
  res.json({ reviewed: count });
});

// Mark a task as reviewed (moves from 'review' to 'completed')
app.post('/api/tasks/:id/review', (req, res) => {
  const success = heartbeatService.taskManager.markReviewed(req.params.id);
  res.json({ success });
});

// Generate a draft reply for a specific email task
app.post('/api/tasks/:id/draft', (req, res) => {
  const task = heartbeatService.taskManager.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.type !== 'email_draft') {
    return res.status(400).json({ error: 'Not an email task' });
  }

  const meta = task.metadata as { emailId: string; emailFrom: string; emailSubject: string; emailPreview: string } | undefined;
  if (!meta) {
    return res.status(400).json({ error: 'Missing email metadata' });
  }

  // Mark task as completed (user chose to draft)
  heartbeatService.taskManager.markReviewed(req.params.id);

  // Return immediately — draft generates in background via heartbeat agent
  res.json({ success: true, generating: true });

  // Fire-and-forget: generate draft through heartbeat's agentChat (handles silent mode)
  const prompt = `This is an automated background task. Summarize the received email briefly, then draft a reply for my review.

**Received Email:**
- From: ${meta.emailFrom}
- Subject: ${meta.emailSubject}
- Preview: ${meta.emailPreview}

Format your response EXACTLY like this (keep the section headers):

**Email Received**
From: [sender name]
Subject: [subject]
[1-2 sentence summary of what they're asking or saying]

---

**Draft Reply**
[your professional, concise draft response — sign off with my name]

CRITICAL RULES:
- Do NOT include "Tone:" or any metadata labels in your output
- Do NOT ask "Would you like me to send this?" or any follow-up questions
- Do NOT offer next steps or actions
- Just output the email summary and draft. Nothing else.`;

  // Fire-and-forget: generate draft using requesting user's session
  const draftSession = getUserSession(req.user!);
  void (async () => {
    draftSession.agent.setSilentMode(true);
    try {
      const response = await draftSession.agent.chat(prompt);

      // Store as persistent activity
      const activity: StoredActivity = {
        id: Date.now().toString(),
        query: prompt,
        response,
        timestamp: new Date().toISOString(),
      };
      recentActivities.unshift(activity);
      if (recentActivities.length > 50) recentActivities.length = 50;

      broadcast({
        type: 'heartbeat_activity',
        timestamp: activity.timestamp,
        data: { message: prompt, response },
      });

      console.log(`[Draft] Draft ready for "${meta.emailSubject}"`);
    } catch (error) {
      console.error('[Draft] Error generating draft:', error);
    } finally {
      draftSession.agent.setSilentMode(false);
    }
  })();
});

// Clear completed tasks
app.post('/api/tasks/clear-completed', (req, res) => {
  const count = heartbeatService.taskManager.clearCompleted();
  res.json({ cleared: count });
});

// ==================== APP BUILDING ENDPOINTS ====================

// Build a new app
app.post('/api/apps/build', async (req, res) => {
  const { description, appName, projectFolder } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Description is required' });
  }

  try {
    const taskId = heartbeatService.buildApp({
      description,
      appName,
      projectFolder: projectFolder || heartbeatService.getConfig().projectSandboxPath,
    });
    res.json({ taskId, message: 'App build started' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// List built apps
app.get('/api/apps', (req, res) => {
  res.json({
    apps: heartbeatService.cliRunner.listApps(),
    sandboxPath: heartbeatService.cliRunner.getSandboxPath(),
  });
});

// ==================== EMAIL DRAFTS ENDPOINTS ====================

// Get all drafts
app.get('/api/drafts', (req, res) => {
  const drafts = heartbeatService.emailMonitor.getAllDrafts();
  res.json({ drafts: Array.from(drafts.entries()).map(([id, draft]) => ({ id, ...draft })) });
});

// Get a specific draft
app.get('/api/drafts/:emailId', (req, res) => {
  const draft = heartbeatService.emailMonitor.getDraft(req.params.emailId);
  if (!draft) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  res.json(draft);
});

// Delete a draft
app.delete('/api/drafts/:emailId', (req, res) => {
  const success = heartbeatService.emailMonitor.deleteDraft(req.params.emailId);
  res.json({ success });
});

// Clean up all files in the uploads directory
function cleanUploads(): number {
  try {
    const files = fs.readdirSync(uploadsDir);
    let count = 0;
    for (const file of files) {
      fs.unlinkSync(path.join(uploadsDir, file));
      count++;
    }
    if (count > 0) console.log(`[Cleanup] Removed ${count} uploaded file(s)`);
    return count;
  } catch (err) {
    console.warn('[Cleanup] Failed to clean uploads:', err);
    return 0;
  }
}

// Multer error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 5 files per message.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message?.startsWith('File type not allowed')) {
    return res.status(415).json({ error: err.message });
  }
  next(err);
});

// Graceful shutdown — SIGTERM only (SIGINT is handled at the top of the file).
async function gracefulShutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down...`);
  cleanUploads();
  substackPipeline.stop();
  heartbeatService.stop();
  // Cleanup all user sessions
  for (const [, session] of userSessions) {
    await session.agent.stop();
    session.memoryManager.close();
  }
  userSessions.clear();
  server.close();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Initialize enhanced memory and start server
async function startServer() {
  console.log('[Startup] Per-user session mode — memory initialized on first login');

  // Configure heartbeat with sandbox path
  const sandboxPath = path.join(process.cwd(), 'sandbox');
  heartbeatService.setConfig({
    projectSandboxPath: sandboxPath,
    emailDraftEnabled: WORKIQ_ENABLED ? heartbeatService.getConfig().emailDraftEnabled : false,
    teamsCheckEnabled: WORKIQ_ENABLED ? heartbeatService.getConfig().teamsCheckEnabled : false,
  });

  // Connect heartbeat to agent chat for email drafting
  // Uses first active user session, or skips if none available
  heartbeatService.setAgentChat(async (message) => {
    const firstSession = userSessions.values().next().value as UserSession | undefined;
    if (!firstSession) {
      console.warn('[Heartbeat] No active user sessions — skipping');
      return 'No active sessions';
    }
    firstSession.agent.setSilentMode(true);
    try {
      const response = await firstSession.agent.chat(message);

      // Only broadcast meaningful activity to the frontend (draft responses)
      // Skip internal plumbing: email queries, JSON parsing, Teams queries
      const isInternalQuery =
        message.includes('Show me my unread emails') ||
        message.includes('Show me all my unread emails') ||
        message.includes('You are a JSON extractor') ||
        message.includes('Teams chat messages');

      // Also skip empty/no-results responses from polluting the activity feed
      const isEmptyResult =
        response.includes('No Teams @mentions found') ||
        response.includes('No matching emails') ||
        response.includes('No new emails') ||
        response === '[]';

      if (!isInternalQuery && !isEmptyResult) {
        const activity: StoredActivity = {
          id: Date.now().toString(),
          query: message,
          response,
          timestamp: new Date().toISOString(),
        };
        recentActivities.unshift(activity);
        if (recentActivities.length > 50) recentActivities.length = 50;

        broadcast({
          type: 'heartbeat_activity',
          timestamp: activity.timestamp,
          data: { message, response },
        });
      }

      return response;
    } finally {
      firstSession.agent.setSilentMode(false);
    }
  });

  // Broadcast lightweight email check status (for "Last checked" indicator)
  heartbeatService.onEmailCheckComplete((result) => {
    lastEmailCheckTimestamp = result.timestamp;
    broadcast({
      type: 'email_check_status',
      timestamp: new Date().toISOString(),
      data: { found: result.found, checkedAt: result.timestamp },
    });
  });

  // Broadcast Teams @mention results (only when mentions found)
  heartbeatService.onTeamsCheckComplete((result) => {
    lastTeamsCheckTimestamp = result.timestamp;
    // Update status timestamp regardless
    broadcast({
      type: 'teams_check_status',
      timestamp: new Date().toISOString(),
      data: { found: result.found, checkedAt: result.timestamp },
    });

    // Only broadcast as activity if there are actual mentions
    if (result.found > 0) {
      broadcast({
        type: 'heartbeat_activity',
        timestamp: new Date().toISOString(),
        data: {
          message: 'Teams @mention check',
          response: result.response,
        },
      });
    }
  });

  // Start heartbeat service (proactive monitoring)
  heartbeatService.start();
  console.log('[Startup] Heartbeat service started');

  // Start Substack digest pipeline (cron + on-demand via Gmail MCP)
  if (SUBSTACK_ENABLED) {
    substackPipeline.setAgentChat(async (message) => {
      const firstSession = userSessions.values().next().value as UserSession | undefined;
      if (!firstSession) return 'No active sessions';
      firstSession.agent.setSilentMode(true);
      try {
        return await firstSession.agent.chat(message);
      } finally {
        firstSession.agent.setSilentMode(false);
      }
    });
    substackPipeline.setNudge((title, message) => {
      heartbeatService.notifier.notifyCustom(title, message, 'normal');
    });
    substackPipeline.setBroadcast(broadcast);
    substackPipeline.start();
    console.log('[Startup] Substack digest pipeline started');
  }

  // Serve frontend assets in production (single-service deploy)
  if (serveFrontend && fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
    console.log(`[Startup] Serving frontend from ${frontendDist}`);
  }

  server.listen(PORT, HOST, () => {
    console.log(`
╔═════════════════════════════════════════════════════════════════════╗
║              Work Assistant Backend Running                          ║
╠═════════════════════════════════════════════════════════════════════╣
║  HTTP Server: http://localhost:${PORT}                                 ║
║  WebSocket:   ws://localhost:${PORT}/ws                                ║
╠═════════════════════════════════════════════════════════════════════╣
║  Default Model: gpt-5-mini (via GitHub Copilot SDK)                  ║
║  MCP: Work IQ for Microsoft 365 access ${WORKIQ_ENABLED ? 'ENABLED' : 'DISABLED'}                       ║
║  Gmail: ${GMAIL_ENABLED ? 'CONFIGURED (OAuth tool available)' : 'NOT CONFIGURED'}                       ║
║  Memory: Enhanced (OpenClaw-style hybrid search)                     ║
║  Heartbeat: ACTIVE (proactive nudging enabled)                       ║
╠═════════════════════════════════════════════════════════════════════╣
║  Core Endpoints:                                                     ║
║    POST /api/chat              - Send message                        ║
║    GET  /api/health            - Health check                        ║
║                                                                      ║
║  Memory Endpoints:                                                   ║
║    GET  /api/memory            - View memory                         ║
║    PUT  /api/memory            - Update memory                       ║
║    POST /api/memory/search     - Hybrid search                       ║
║    GET  /api/memory/stats      - Index stats                         ║
║                                                                      ║
║  Heartbeat Endpoints (Proactive):                                    ║
║    GET  /api/heartbeat/status  - Service status                      ║
║    POST /api/heartbeat/start   - Start monitoring                    ║
║    POST /api/heartbeat/stop    - Stop monitoring                     ║
║    GET  /api/nudges            - View nudges                         ║
║    GET  /api/tasks             - Background tasks                    ║
║    POST /api/apps/build        - Build app via Copilot CLI           ║
║    GET  /api/drafts            - Email draft responses               ║
╚═════════════════════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(err => { console.error('Fatal startup error:', err); process.exit(1); });
