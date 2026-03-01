/**
 * Heartbeat Service - The "Always On" Assistant
 *
 * Orchestrates all background monitoring:
 * - Email monitoring with auto-draft responses
 * - Background task management
 * - App building via Copilot CLI
 * - Proactive nudges and notifications
 *
 * This is the core "heartbeat" that makes the assistant proactive.
 */

import type { HeartbeatConfig, AppBuildRequest, DraftResponse, EmailInfo } from './types.js';
import { DEFAULT_HEARTBEAT_CONFIG } from './types.js';
import { notifier, Notifier } from './notifier.js';
import { taskManager, TaskManager } from './task-manager.js';
import { emailMonitor, EmailMonitor, type CheckCompleteCallback } from './email-monitor.js';
import { cliRunner, CLIRunner } from './cli-runner.js';

// Type for the agent chat function
export type AgentChatFunction = (message: string) => Promise<string>;

/**
 * Main Heartbeat Service - orchestrates all proactive behaviors
 */
// Callback for Teams check results
export type TeamsCheckCallback = (result: { found: number; response: string; timestamp: string }) => void;

export class HeartbeatService {
  private config: HeartbeatConfig;
  private isRunning = false;
  private agentChat?: AgentChatFunction;
  private teamsIntervalId?: ReturnType<typeof setInterval>;
  private teamsCheckCallback?: TeamsCheckCallback;
  private isCheckingTeams = false;

  // Expose components for direct access
  public readonly notifier: Notifier = notifier;
  public readonly taskManager: TaskManager = taskManager;
  public readonly emailMonitor: EmailMonitor = emailMonitor;
  public readonly cliRunner: CLIRunner = cliRunner;

  constructor(config: Partial<HeartbeatConfig> = {}) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };

    // Configure components
    this.cliRunner.setConfig({
      sandboxPath: this.config.projectSandboxPath,
    });

    this.emailMonitor.setConfig({
      checkInterval: this.config.emailCheckInterval,
      autoDraftEnabled: this.config.emailDraftEnabled,
    });
  }

  /**
   * Set the agent chat function (used for generating responses)
   */
  setAgentChat(chatFn: AgentChatFunction): void {
    this.agentChat = chatFn;

    // Set up email monitor callbacks
    // Work IQ query callback (has MCP access for M365)
    this.emailMonitor.setEmailQueryCallback(async (query) => {
      return this.agentChat!(query);
    });

    // LLM callback for parsing (same agent, used for structured extraction)
    this.emailMonitor.setLLMCallback(async (prompt) => {
      return this.agentChat!(prompt);
    });

    this.emailMonitor.setDraftGeneratorCallback(async (email) => {
      return this.generateEmailDraft(email);
    });
  }

  /**
   * Start the heartbeat service
   */
  start(): void {
    if (this.isRunning) return;

    console.log('[Heartbeat] Starting heartbeat service...');
    this.isRunning = true;

    if (!this.config.enabled) {
      console.log('[Heartbeat] Service is disabled in config');
      return;
    }

    // Start email monitoring if enabled
    if (this.config.emailDraftEnabled) {
      this.emailMonitor.start();
    }

    // Start Teams @mention monitoring if enabled
    if (this.config.teamsCheckEnabled) {
      this.startTeamsMonitoring();
    }

    console.log('[Heartbeat] Service started');
    console.log(`[Heartbeat] Config: ${JSON.stringify({
      emailCheckInterval: this.config.emailCheckInterval,
      emailDraftEnabled: this.config.emailDraftEnabled,
      teamsCheckEnabled: this.config.teamsCheckEnabled,
      teamsCheckInterval: this.config.teamsCheckInterval,
      appBuildEnabled: this.config.appBuildEnabled,
      sandboxPath: this.config.projectSandboxPath,
    })}`);

    // Notify that heartbeat is active
    const monitorMessage = this.config.emailDraftEnabled || this.config.teamsCheckEnabled
      ? 'I\'m now monitoring in the background. I\'ll nudge you about new activity and task completions.'
      : 'I\'m now monitoring in the background. I\'ll nudge you about task completions.';
    notifier.notifyCustom('Assistant Active', monitorMessage, 'low');
  }

  /**
   * Stop the heartbeat service
   */
  stop(): void {
    console.log('[Heartbeat] Stopping heartbeat service...');

    this.emailMonitor.stop();
    this.cliRunner.cancelAll();

    if (this.teamsIntervalId) {
      clearInterval(this.teamsIntervalId);
      this.teamsIntervalId = undefined;
    }

    this.isRunning = false;
    console.log('[Heartbeat] Service stopped');
  }

  /**
   * Generate an email draft response using the agent
   */
  private async generateEmailDraft(email: EmailInfo): Promise<DraftResponse> {
    if (!this.agentChat) {
      throw new Error('Agent chat function not set');
    }

    const prompt = `This is an automated background task. Summarize the received email briefly, then draft a reply for my review.

**Received Email:**
- From: ${email.from}
- Subject: ${email.subject}
- Preview: ${email.preview}

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
- Do NOT add anything after the draft reply
- Just output the email summary and draft. Nothing else.`;

    const response = await this.agentChat(prompt);

    // Parse the response
    const draft = this.parseEmailDraft(response, email);
    return draft;
  }

  /**
   * Parse agent response into structured draft
   */
  private parseEmailDraft(response: string, email: EmailInfo): DraftResponse {
    let body = response;
    let tone: 'formal' | 'friendly' | 'brief' = 'friendly';

    // Extract draft reply section from new format
    const draftMatch = response.match(/\*\*Draft Reply\*\*\s*([\s\S]*?)$/i);
    if (draftMatch) {
      body = draftMatch[1]
        .replace(/---\s*$/g, '')           // trailing ---
        .replace(/Tone:\s*\w+\s*$/i, '')   // trailing Tone: if LLM still adds it
        .replace(/Would you like.*$/im, '') // strip follow-up questions
        .trim();
    } else {
      // Fallback: try old BODY: format
      const bodyMatch = response.match(/BODY:\s*([\s\S]*?)(?:TONE:|$)/i);
      if (bodyMatch) {
        body = bodyMatch[1].trim();
      }
    }

    // Try to detect tone from response if present
    const toneMatch = response.match(/Tone:\s*(\w+)/i);
    if (toneMatch) {
      const t = toneMatch[1].toLowerCase();
      if (t === 'friendly' || t === 'brief' || t === 'formal') {
        tone = t;
      }
    }

    return {
      emailId: email.id,
      to: email.from,
      subject: `Re: ${email.subject}`,
      body,
      tone,
      confidence: 0.8,
    };
  }

  /**
   * Build an app using Copilot CLI
   */
  buildApp(request: AppBuildRequest): string {
    if (!this.config.appBuildEnabled) {
      throw new Error('App building is disabled');
    }

    return this.cliRunner.buildApp(request);
  }

  /**
   * Convenience method to build an app with just a description
   */
  async requestAppBuild(description: string, appName?: string): Promise<string> {
    const taskId = this.buildApp({
      description,
      projectFolder: this.config.projectSandboxPath,
      appName,
    });

    return taskId;
  }

  /**
   * Get status of the heartbeat service
   */
  getStatus(): {
    running: boolean;
    config: HeartbeatConfig;
    emailMonitoring: boolean;
    taskStats: { pending: number; running: number; completed: number; failed: number };
    pendingNudges: number;
    sandboxApps: number;
  } {
    return {
      running: this.isRunning,
      config: this.config,
      emailMonitoring: this.emailMonitor.isMonitoring(),
      taskStats: this.taskManager.getStats(),
      pendingNudges: this.notifier.getUnacknowledged().length,
      sandboxApps: this.cliRunner.listApps().length,
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<HeartbeatConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    // Update component configs
    this.cliRunner.setConfig({
      sandboxPath: this.config.projectSandboxPath,
    });

    this.emailMonitor.setConfig({
      checkInterval: this.config.emailCheckInterval,
      autoDraftEnabled: this.config.emailDraftEnabled,
    });

    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Get configuration
   */
  getConfig(): HeartbeatConfig {
    return { ...this.config };
  }

  /**
   * Set callback for when an email check cycle completes
   */
  onEmailCheckComplete(callback: CheckCompleteCallback): void {
    this.emailMonitor.setCheckCompleteCallback(callback);
  }

  /**
   * Set callback for Teams check results
   */
  onTeamsCheckComplete(callback: TeamsCheckCallback): void {
    this.teamsCheckCallback = callback;
  }

  /**
   * Start Teams @mention monitoring
   */
  private startTeamsMonitoring(): void {
    console.log(`[Heartbeat] Starting Teams monitoring (interval: ${this.config.teamsCheckInterval}ms)`);

    // Check immediately
    this.checkTeamsMentions();

    // Then check periodically
    this.teamsIntervalId = setInterval(() => {
      this.checkTeamsMentions();
    }, this.config.teamsCheckInterval);
  }

  /**
   * Check for Teams @mentions via Work IQ
   */
  private async checkTeamsMentions(): Promise<void> {
    if (!this.agentChat || this.isCheckingTeams) return;

    this.isCheckingTeams = true;

    try {
      console.log('[Heartbeat] Checking for Teams @mentions...');

      const response = await this.agentChat(
        'Show me Teams chat messages and channel messages from the last 2 hours where I am @mentioned. For each message show the sender name, the channel or chat name, and the message content. Only include messages where I am directly @mentioned, not general channel posts.\n\nIMPORTANT: This is an automated background check. Just report the facts. If there are no @mentions, say "No Teams @mentions found." Do NOT ask follow-up questions, do NOT suggest next steps.'
      );

      const lower = response.toLowerCase().trim();
      const noMentions = lower.includes('no teams') || lower.includes('no @mention') ||
                         lower.includes('no mention') || lower.includes('not find any') ||
                         lower.includes('no matching') || lower.includes('no messages') ||
                         lower === '[]' || lower === '' || lower.includes('no results') ||
                         lower.includes('no unread') || lower.includes('did not find');

      this.teamsCheckCallback?.({
        found: noMentions ? 0 : 1,
        response,
        timestamp: new Date().toISOString(),
      });

      if (noMentions) {
        console.log('[Heartbeat] No Teams @mentions found');
      } else {
        console.log('[Heartbeat] Found Teams @mentions');
      }
    } catch (error) {
      console.error('[Heartbeat] Error checking Teams:', error);
    } finally {
      this.isCheckingTeams = false;
    }
  }

  /**
   * Force a Teams check now
   */
  async forceTeamsCheck(): Promise<void> {
    await this.checkTeamsMentions();
  }

  /**
   * Force an email check now
   */
  async forceEmailCheck(): Promise<void> {
    await this.emailMonitor.forceCheck();
  }

  /**
   * Send a custom nudge
   */
  sendNudge(title: string, message: string, priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'): void {
    this.notifier.notifyCustom(title, message, priority);
  }
}

// Singleton instance
export const heartbeatService = new HeartbeatService();
