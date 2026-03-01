/**
 * Notification Dispatcher
 * Sends nudges to connected clients via WebSocket
 */

import { v4 as uuidv4 } from 'uuid';
import type { Nudge, NudgeType, NudgePriority, NudgeAction } from './types.js';

export type NotifyCallback = (nudge: Nudge) => void;

/**
 * Manages nudge notifications
 */
export class Notifier {
  private callbacks: Set<NotifyCallback> = new Set();
  private nudgeHistory: Nudge[] = [];
  private maxHistory = 100;

  /**
   * Register a callback to receive nudges
   */
  onNudge(callback: NotifyCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Send a nudge to all registered callbacks
   */
  notify(nudge: Omit<Nudge, 'id' | 'createdAt' | 'acknowledged'>): Nudge {
    const fullNudge: Nudge = {
      ...nudge,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      acknowledged: false,
    };

    // Store in history
    this.nudgeHistory.unshift(fullNudge);
    if (this.nudgeHistory.length > this.maxHistory) {
      this.nudgeHistory.pop();
    }

    // Notify all callbacks
    for (const callback of this.callbacks) {
      try {
        callback(fullNudge);
      } catch (error) {
        console.error('[Notifier] Callback error:', error);
      }
    }

    console.log(`[Nudge] ${nudge.priority.toUpperCase()}: ${nudge.title}`);
    return fullNudge;
  }

  /**
   * Create a new email nudge
   */
  notifyNewEmail(from: string, subject: string, preview: string, emailId: string): Nudge {
    return this.notify({
      type: 'new_email',
      priority: 'normal',
      title: `New email from ${from}`,
      message: subject,
      data: { emailId, from, subject, preview },
      actions: [
        { id: 'draft', label: 'Draft Response', action: 'custom', payload: { action: 'draft_response', emailId } },
        { id: 'view', label: 'View', action: 'view', payload: { emailId } },
        { id: 'dismiss', label: 'Dismiss', action: 'dismiss' },
      ],
    });
  }

  /**
   * Create an email draft ready nudge
   */
  notifyDraftReady(emailId: string, to: string, subject: string, draftPreview: string): Nudge {
    return this.notify({
      type: 'email_draft_ready',
      priority: 'normal',
      title: 'Draft response ready',
      message: `Reply to: ${subject}`,
      data: { emailId, to, subject, draftPreview },
      actions: [
        { id: 'review', label: 'Review & Edit', action: 'view', payload: { emailId, view: 'draft' } },
        { id: 'approve', label: 'Send', action: 'approve', payload: { emailId } },
        { id: 'dismiss', label: 'Discard', action: 'dismiss' },
      ],
    });
  }

  /**
   * Create a task completion nudge
   */
  notifyTaskComplete(taskId: string, description: string, result: string): Nudge {
    return this.notify({
      type: 'task_complete',
      priority: 'normal',
      title: 'Task completed',
      message: description,
      data: { taskId, result },
      actions: [
        { id: 'view', label: 'View Result', action: 'view', payload: { taskId } },
        { id: 'dismiss', label: 'Dismiss', action: 'dismiss' },
      ],
    });
  }

  /**
   * Create a task failed nudge
   */
  notifyTaskFailed(taskId: string, description: string, error: string): Nudge {
    return this.notify({
      type: 'task_failed',
      priority: 'high',
      title: 'Task failed',
      message: description,
      data: { taskId, error },
      actions: [
        { id: 'retry', label: 'Retry', action: 'custom', payload: { action: 'retry', taskId } },
        { id: 'view', label: 'View Error', action: 'view', payload: { taskId } },
        { id: 'dismiss', label: 'Dismiss', action: 'dismiss' },
      ],
    });
  }

  /**
   * Create an app build complete nudge
   */
  notifyAppBuildComplete(appName: string, appPath: string, duration: number): Nudge {
    return this.notify({
      type: 'app_build_complete',
      priority: 'normal',
      title: `App "${appName}" built successfully`,
      message: `Completed in ${Math.round(duration / 1000)}s`,
      data: { appName, appPath, duration },
      actions: [
        { id: 'open', label: 'Open Folder', action: 'custom', payload: { action: 'open_folder', path: appPath } },
        { id: 'run', label: 'Run App', action: 'custom', payload: { action: 'run_app', path: appPath } },
        { id: 'dismiss', label: 'Dismiss', action: 'dismiss' },
      ],
    });
  }

  /**
   * Create an app build failed nudge
   */
  notifyAppBuildFailed(appName: string, error: string): Nudge {
    return this.notify({
      type: 'app_build_failed',
      priority: 'high',
      title: `App "${appName}" build failed`,
      message: error.substring(0, 100),
      data: { appName, error },
      actions: [
        { id: 'retry', label: 'Retry', action: 'custom', payload: { action: 'retry_build', appName } },
        { id: 'view', label: 'View Logs', action: 'view' },
        { id: 'dismiss', label: 'Dismiss', action: 'dismiss' },
      ],
    });
  }

  /**
   * Create a meeting reminder nudge
   */
  notifyMeetingSoon(title: string, startTime: string, attendees: string[]): Nudge {
    return this.notify({
      type: 'meeting_soon',
      priority: 'high',
      title: 'Meeting starting soon',
      message: title,
      data: { title, startTime, attendees },
      actions: [
        { id: 'join', label: 'Join', action: 'custom', payload: { action: 'join_meeting' } },
        { id: 'snooze', label: 'Snooze 5min', action: 'snooze', payload: { minutes: 5 } },
        { id: 'dismiss', label: 'Dismiss', action: 'dismiss' },
      ],
    });
  }

  /**
   * Create a custom nudge
   */
  notifyCustom(
    title: string,
    message: string,
    priority: NudgePriority = 'normal',
    actions?: NudgeAction[],
    data?: Record<string, unknown>
  ): Nudge {
    return this.notify({
      type: 'custom',
      priority,
      title,
      message,
      data,
      actions: actions || [
        { id: 'dismiss', label: 'Dismiss', action: 'dismiss' },
      ],
    });
  }

  /**
   * Acknowledge a nudge
   */
  acknowledge(nudgeId: string): boolean {
    const nudge = this.nudgeHistory.find(n => n.id === nudgeId);
    if (nudge) {
      nudge.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Get unacknowledged nudges
   */
  getUnacknowledged(): Nudge[] {
    return this.nudgeHistory.filter(n => !n.acknowledged);
  }

  /**
   * Get nudge history
   */
  getHistory(limit = 50): Nudge[] {
    return this.nudgeHistory.slice(0, limit);
  }

  /**
   * Clear all nudges
   */
  clear(): void {
    this.nudgeHistory = [];
  }
}

// Singleton instance
export const notifier = new Notifier();
