/**
 * Heartbeat System Types
 * Defines nudges, tasks, and notification structures
 */

export type NudgeType =
  | 'new_email'
  | 'email_draft_ready'
  | 'task_complete'
  | 'task_failed'
  | 'reminder'
  | 'meeting_soon'
  | 'app_build_complete'
  | 'app_build_failed'
  | 'substack_digest_ready'
  | 'custom';

export type NudgePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Nudge {
  id: string;
  type: NudgeType;
  priority: NudgePriority;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: NudgeAction[];
  createdAt: string;
  expiresAt?: string;
  acknowledged: boolean;
}

export interface NudgeAction {
  id: string;
  label: string;
  action: 'approve' | 'dismiss' | 'snooze' | 'view' | 'custom';
  payload?: Record<string, unknown>;
}

export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface BackgroundTask {
  id: string;
  type: 'email_draft' | 'app_build' | 'research' | 'custom';
  description: string;
  status: BackgroundTaskStatus;
  priority: TaskPriority;
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailInfo {
  id: string;
  from: string;
  subject: string;
  preview: string;
  receivedAt: string;
  isRead: boolean;
  importance: 'low' | 'normal' | 'high';
}

export interface DraftResponse {
  emailId: string;
  to: string;
  subject: string;
  body: string;
  tone: 'formal' | 'friendly' | 'brief';
  confidence: number;
}

export interface AppBuildRequest {
  description: string;
  projectFolder: string;
  appName?: string;
  framework?: string;
  features?: string[]; // optional list of requested features (e.g., ["dueDate", "priority"]) 
}

export interface AppBuildResult {
  success: boolean;
  appPath: string;
  output: string;
  duration: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  emailCheckInterval: number;      // ms between email checks
  teamsCheckInterval: number;      // ms between Teams @mention checks
  teamsCheckEnabled: boolean;
  taskCheckInterval: number;       // ms between task status checks
  maxConcurrentTasks: number;
  emailDraftEnabled: boolean;
  appBuildEnabled: boolean;
  projectSandboxPath: string;      // Where to build apps
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: true,
  emailCheckInterval: 3600000,     // Check emails every 1 hour
  teamsCheckInterval: 3600000,     // Check Teams @mentions every 1 hour
  teamsCheckEnabled: true,
  taskCheckInterval: 5000,         // Check tasks every 5 seconds
  maxConcurrentTasks: 3,
  emailDraftEnabled: true,         // Auto-draft responses to personal emails
  appBuildEnabled: true,
  projectSandboxPath: './sandbox', // Default sandbox folder
};
