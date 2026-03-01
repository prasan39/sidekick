/**
 * Heartbeat Module Exports
 * The "Always On" assistant with proactive nudging
 */

// Main service (use this as the primary interface)
export { HeartbeatService, heartbeatService } from './heartbeat-service.js';
export type { AgentChatFunction } from './heartbeat-service.js';

// Types
export * from './types.js';

// Individual components (for advanced usage)
export { Notifier, notifier } from './notifier.js';
export { TaskManager, taskManager } from './task-manager.js';
export { EmailMonitor, emailMonitor } from './email-monitor.js';
export type { EmailQueryCallback, DraftGeneratorCallback } from './email-monitor.js';
export { CLIRunner, cliRunner } from './cli-runner.js';
export type { CLIRunnerConfig } from './cli-runner.js';
