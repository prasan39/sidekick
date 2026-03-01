import { useState, useEffect, useCallback, useRef } from 'react';

export interface AttachmentInfo {
  name: string;
  type: string;
  size: number;
  url?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: AttachmentInfo[];
}

export interface AgentEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface PendingApproval {
  id: string;
  action: string;
  tool: string;
  args: Record<string, unknown>;
  preview: string;
  createdAt: string;
  expiresAt: string;
  status: string;
}

export interface Nudge {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: { id: string; label: string; action: string }[];
  createdAt: string;
  acknowledged: boolean;
}

export interface BackgroundTask {
  id: string;
  type: string;
  description: string;
  status: string;
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  query: string;
  response: string;
  timestamp: string;
}

export interface QuotaSnapshot {
  isUnlimitedEntitlement: boolean;
  entitlementRequests: number;
  usedRequests: number;
  usageAllowedWithExhaustedQuota: boolean;
  overage: number;
  overageAllowedWithExhaustedQuota: boolean;
  remainingPercentage: number;
  resetDate?: string;
}

export interface UsageInfo {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  duration?: number;
  initiator?: string;
  apiCallId?: string;
  providerCallId?: string;
  quotaSnapshots?: Record<string, QuotaSnapshot>;
}

export interface HeartbeatStatus {
  running: boolean;
  emailMonitoring: boolean;
  taskStats: { pending: number; running: number; completed: number; failed: number };
  pendingNudges: number;
}

export interface AppSettings {
  model: string;
  emailCheckInterval: number;
  teamsCheckInterval: number;
  emailDraftEnabled: boolean;
  teamsCheckEnabled: boolean;
  workIqEnabled: boolean;
}

export const MODEL_OPTIONS = [
  // Included / low-cost models first
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', provider: 'OpenAI', rateLabel: 'Included (0x)' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'OpenAI', rateLabel: 'Included (0x)' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', rateLabel: 'Included (0x)' },
  { id: 'raptor-mini', label: 'Raptor Mini', provider: 'GitHub', rateLabel: 'Included (0x)' },
  { id: 'grok-code-fast-1', label: 'Grok Code Fast 1', provider: 'xAI', rateLabel: '0.25x premium' },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', provider: 'Anthropic', rateLabel: '0.33x premium' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash', provider: 'Google', rateLabel: '0.33x premium' },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', provider: 'OpenAI', rateLabel: '0.33x premium' },

  // Premium-heavy models
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', provider: 'Anthropic', rateLabel: '1x premium' },
  { id: 'gpt-5', label: 'GPT-5', provider: 'OpenAI', rateLabel: 'Premium (plan-based)' },
  { id: 'claude-opus-4.5', label: 'Claude Opus 4.5', provider: 'Anthropic', rateLabel: '3x premium' },
] as const;

export const INTERVAL_OPTIONS = [
  { value: 300000, label: '5 minutes' },
  { value: 600000, label: '10 minutes' },
  { value: 900000, label: '15 minutes' },
  { value: 1800000, label: '30 minutes' },
  { value: 3600000, label: '1 hour' },
  { value: 7200000, label: '2 hours' },
] as const;

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '';

function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

function authHeaders(headers?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  return {
    ...headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function getWsUrls(): string[] {
  if (typeof window === 'undefined') return [];
  const env = (import.meta as any).env || {};
  const token = getAuthToken();
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

  if (env.VITE_WS_URL) return [`${env.VITE_WS_URL}${tokenParam}`];

  const sameOrigin = (() => {
    const url = new URL('/ws', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString() + tokenParam;
  })();

  if (env.DEV) {
    const host = window.location.hostname || '127.0.0.1';
    const direct = `ws://${host}:3001/ws${tokenParam}`;
    const loopback = `ws://127.0.0.1:3001/ws${tokenParam}`;
    return Array.from(new Set([direct, loopback]));
  }

  return [sameOrigin];
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [reasoningContent, setReasoningContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [memory, setMemory] = useState('');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [heartbeatStatus, setHeartbeatStatus] = useState<HeartbeatStatus | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [inputPrefill, setInputPrefill] = useState('');
  const [lastEmailCheck, setLastEmailCheck] = useState<string | null>(null);
  const [lastTeamsCheck, setLastTeamsCheck] = useState<string | null>(null);
  const [restoredCount, setRestoredCount] = useState(0);
  const [settings, setSettings] = useState<AppSettings>({
    model: 'gpt-5-mini',
    emailCheckInterval: 3600000,
    teamsCheckInterval: 3600000,
    emailDraftEnabled: true,
    teamsCheckEnabled: true,
    workIqEnabled: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const wsConnectingRef = useRef(false); // extra guard against double-connect
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const disconnectTimerRef = useRef<NodeJS.Timeout | null>(null); // debounce "disconnected" state
  const reconnectAttemptsRef = useRef(0);
  const wsUrlIndexRef = useRef(0);
  const historyFetchedRef = useRef(false); // only fetch history on first connect
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingContentRef = useRef('');
  const attachmentObjectUrlsRef = useRef<Set<string>>(new Set());

  // Keep ref in sync with state so the abort handler can read the latest value
  useEffect(() => { streamingContentRef.current = streamingContent; }, [streamingContent]);

  useEffect(() => {
    return () => {
      // Cleanup blob URLs on unmount.
      attachmentObjectUrlsRef.current.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      });
      attachmentObjectUrlsRef.current.clear();
    };
  }, []);

  const trackObjectUrl = (url?: string) => {
    if (!url) return;
    if (!url.startsWith('blob:')) return;
    attachmentObjectUrlsRef.current.add(url);
  };

  const revokeAllAttachmentObjectUrls = () => {
    attachmentObjectUrlsRef.current.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    });
    attachmentObjectUrlsRef.current.clear();
  };

  const addEvent = useCallback((event: AgentEvent) => {
    setEvents(prev => [...prev.slice(-50), event]);
  }, []);

  const fetchHeartbeatStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/heartbeat/status`, { headers: authHeaders() });
      const data = await res.json();
      setHeartbeatStatus(data);
    } catch (err) {
      console.error('Failed to fetch heartbeat status:', err);
    }
  };

  const fetchNudges = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/nudges`, { headers: authHeaders() });
      const data = await res.json();
      setNudges(data.unacknowledged || []);
    } catch (err) {
      console.error('Failed to fetch nudges:', err);
    }
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`, { headers: authHeaders() });
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  };

  const fetchChatHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/history?limit=50`, { headers: authHeaders() });
      const data = await res.json();
      const historyMessages = data.messages || [];
      if (historyMessages.length > 0) {
        setMessages(historyMessages);
        setRestoredCount(historyMessages.length);
      } else {
        setMessages([]);
        setRestoredCount(0);
      }
    } catch (err) {
      console.error('Failed to fetch chat history:', err);
    }
  };

  const acknowledgeNudge = async (nudgeId: string) => {
    try {
      await fetch(`${API_BASE}/api/nudges/${nudgeId}/acknowledge`, { method: 'POST', headers: authHeaders() });
      setNudges(prev => prev.filter(n => n.id !== nudgeId));
    } catch (err) {
      console.error('Failed to acknowledge nudge:', err);
    }
  };

  const connectWebSocket = useCallback(() => {
    // Guard: don't open if already open, connecting, or a connection attempt is in-flight
    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) return;
    if (wsConnectingRef.current) return;

    // Clear any pending reconnect timer
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    wsConnectingRef.current = true;
    const url = getWsUrls()[Math.min(wsUrlIndexRef.current, getWsUrls().length - 1)];
    if (!url) {
      console.error('No WebSocket URL available');
      scheduleReconnect();
      wsConnectingRef.current = false;
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      // Assign to ref immediately so any reentrant call sees it
      wsRef.current = ws;
    } catch (err) {
      wsConnectingRef.current = false;
      console.error('WebSocket creation failed:', err);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('WebSocket connected');
      wsConnectingRef.current = false;
      reconnectAttemptsRef.current = 0; // reset backoff
      // Cancel any pending "disconnected" debounce
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setIsConnected(true);
      addEvent({ type: 'ws_connected', timestamp: new Date().toISOString(), data: {} });
      fetchHeartbeatStatus();
      fetchNudges();
      fetchTasks();
      // Only fetch history once — skip on reconnects to avoid message flicker
      if (!historyFetchedRef.current) {
        historyFetchedRef.current = true;
        fetchChatHistory();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AgentEvent;
        addEvent(data);

        switch (data.type) {
          case 'connected':
            if (data.data.pendingApprovals) {
              setPendingApprovals(data.data.pendingApprovals as PendingApproval[]);
            }
            if (data.data.memory) {
              setMemory(data.data.memory as string);
            }
            if (data.data.usage) {
              setUsage(data.data.usage as UsageInfo);
            }
            if (data.data.lastEmailCheck) {
              setLastEmailCheck(data.data.lastEmailCheck as string);
            }
            if (data.data.lastTeamsCheck) {
              setLastTeamsCheck(data.data.lastTeamsCheck as string);
            }
            if (data.data.settings) {
              setSettings(data.data.settings as AppSettings);
            }
            if (data.data.activities && Array.isArray(data.data.activities)) {
              setActivities(data.data.activities as Activity[]);
            }
            break;

          case 'text_delta':
            setStreamingContent(prev => prev + (data.data.text as string));
            break;

          case 'reasoning_delta':
            setReasoningContent(prev => prev + (data.data.text as string));
            break;

          case 'tool_call_start':
            setCurrentTool(data.data.tool as string);
            break;

          case 'tool_call_progress':
            setCurrentTool(prev => prev ? `${data.data.message}` : null);
            break;

          case 'tool_call_end':
          case 'session_idle':
            setCurrentTool(null);
            break;

          case 'approvals_updated':
            setPendingApprovals(data.data.approvals as PendingApproval[]);
            break;

          case 'memory_updated':
            fetchMemory();
            break;

          case 'nudge': {
            const nudge = data.data as unknown as Nudge;
            setNudges(prev => [nudge, ...prev.filter(n => n.id !== nudge.id)]);
            break;
          }

          case 'tasks_updated':
            setTasks(data.data.tasks as BackgroundTask[]);
            break;

          case 'heartbeat_activity':
            setActivities(prev => [{
              id: Date.now().toString(),
              query: data.data.message as string,
              response: data.data.response as string,
              timestamp: data.timestamp,
            }, ...prev].slice(0, 50));
            break;

          case 'email_check_status':
            setLastEmailCheck(data.data.checkedAt as string);
            break;

          case 'teams_check_status':
            setLastTeamsCheck(data.data.checkedAt as string);
            break;

          case 'settings_updated':
            setSettings(data.data as unknown as AppSettings);
            break;

          case 'usage':
            setUsage(data.data as unknown as UsageInfo);
            break;

          case 'error':
            console.error('Agent error:', data.data);
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onclose = (ev) => {
      console.log(`WebSocket closed (code=${ev.code} reason=${ev.reason})`);
      wsConnectingRef.current = false;
      if (wsRef.current === ws) wsRef.current = null;
      // Debounce: only flip to "disconnected" after 1.5s to avoid flicker on quick reconnects
      disconnectTimerRef.current = setTimeout(() => {
        disconnectTimerRef.current = null;
        setIsConnected(false);
      }, 1500);

      // Keep socket auto-reconnect behavior consistent regardless of auth mode.

      // Don't reconnect if the close was intentional (code 1000) or component unmounted
      if (ev.code !== 1000) {
        if (wsUrlIndexRef.current < getWsUrls().length - 1) {
          wsUrlIndexRef.current += 1;
          console.warn(`WebSocket fallback → ${getWsUrls()[wsUrlIndexRef.current]}`);
        }
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — no action needed here
    };
  }, [addEvent]);

  // Exponential backoff: 1s → 2s → 4s → 8s → … capped at 30s
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return; // already scheduled
    const attempt = reconnectAttemptsRef.current;
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    reconnectAttemptsRef.current = attempt + 1;
    console.log(`WebSocket reconnect in ${delay}ms (attempt ${attempt + 1})`);
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connectWebSocket();
    }, delay);
  }, [connectWebSocket]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      // Intentional unmount — close cleanly with code 1000
      wsConnectingRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'unmount');
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  const fetchMemory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/memory`, { headers: authHeaders() });
      const data = await res.json();
      setMemory(data.memory);
    } catch (err) {
      console.error('Failed to fetch memory:', err);
    }
  };

  const sendMessage = async (content: string, files?: File[]) => {
    if (!content.trim() || isLoading) return;

    // Build attachment info for user message display
    const attachments: AttachmentInfo[] | undefined = files && files.length > 0
      ? files.map(f => ({
          name: f.name,
          type: f.type,
          size: f.size,
          url: (() => {
            const url = URL.createObjectURL(f);
            trackObjectUrl(url);
            return url;
          })(),
        }))
      : undefined;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
      attachments,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingContent('');
    setReasoningContent('');
    setCurrentTool(null);

    // Create an AbortController so the request can be cancelled
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      let res: Response;

      if (files && files.length > 0) {
        const formData = new FormData();
        formData.append('message', content);
        files.forEach(f => formData.append('files', f));

        res = await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: authHeaders(),
          body: formData,
          signal: abortController.signal,
        });
      } else {
        res = await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ message: content }),
          signal: abortController.signal,
        });
      }

      // Handle 401 — trigger logout
      if (res.status === 401) {
        localStorage.removeItem('auth_token');
        window.location.reload();
        return;
      }

      const data = await res.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || data.error || 'No response',
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User stopped generation — keep any partial streaming content as the response
        const partial = streamingContentRef.current;
        if (partial) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: partial + '\n\n*(generation stopped)*',
            timestamp: new Date().toISOString(),
          }]);
        }
      } else {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${err}`,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamingContent('');
      setReasoningContent('');
      setCurrentTool(null);
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const approveAction = async (approvalId: string, approved: boolean) => {
    try {
      await fetch(`${API_BASE}/api/approve`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ approvalId, approved }),
      });
    } catch (err) {
      console.error('Failed to approve/deny:', err);
    }
  };

  const updateMemory = async (content: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/memory`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.success) {
        setMemory(content);
      }
      return data;
    } catch (err) {
      console.error('Failed to update memory:', err);
      return { success: false, message: String(err) };
    }
  };

  const clearHistory = async () => {
    try {
      await fetch(`${API_BASE}/api/clear`, { method: 'POST', headers: authHeaders() });
      revokeAllAttachmentObjectUrls();
      setMessages([]);
      setEvents([]);
      setRestoredCount(0);
      setStreamingContent('');
      setReasoningContent('');
      setCurrentTool(null);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const newChat = async () => {
    try {
      await fetch(`${API_BASE}/api/clear`, { method: 'POST', headers: authHeaders() });
      revokeAllAttachmentObjectUrls();
      setMessages([]);
      setRestoredCount(0);
      setStreamingContent('');
      setReasoningContent('');
    } catch (err) {
      console.error('Failed to start new chat:', err);
    }
  };

  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(newSettings),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
      }
      return data;
    } catch (err) {
      console.error('Failed to update settings:', err);
      return { success: false, error: String(err) };
    }
  };

  const clearCompletedTasks = async () => {
    try {
      await fetch(`${API_BASE}/api/tasks/clear-completed`, { method: 'POST', headers: authHeaders() });
      setTasks(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'failed'));
    } catch (err) {
      console.error('Failed to clear completed tasks:', err);
    }
  };

  const forceCheck = async () => {
    if (!settings.workIqEnabled) return;
    try {
      const requests: Promise<Response>[] = [];
      if (settings.emailDraftEnabled) {
        requests.push(fetch(`${API_BASE}/api/heartbeat/check-emails`, { method: 'POST', headers: authHeaders() }));
      }
      if (settings.teamsCheckEnabled) {
        requests.push(fetch(`${API_BASE}/api/heartbeat/check-teams`, { method: 'POST', headers: authHeaders() }));
      }
      if (requests.length > 0) {
        await Promise.all(requests);
      }
    } catch (err) {
      console.error('Failed to force check:', err);
    }
  };

  const buildApp = async (description: string, appName?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/apps/build`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ description, appName }),
      });
      return await res.json();
    } catch (err) {
      console.error('Failed to build app:', err);
      return { error: String(err) };
    }
  };

  return {
    messages,
    events,
    streamingContent,
    reasoningContent,
    isLoading,
    isConnected,
    usage,
    pendingApprovals,
    memory,
    currentTool,
    nudges,
    tasks,
    heartbeatStatus,
    activities,
    lastEmailCheck,
    lastTeamsCheck,
    inputPrefill,
    setInputPrefill,
    restoredCount,
    settings,
    sendMessage,
    stopGeneration,
    approveAction,
    updateMemory,
    clearHistory,
    newChat,
    updateSettings,
    fetchMemory,
    acknowledgeNudge,
    clearCompletedTasks,
    forceCheck,
    buildApp,
    fetchTasks,
  };
}
