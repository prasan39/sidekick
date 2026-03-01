/**
 * CLI Runner - Invokes Copilot CLI for app building
 * Runs `copilot` commands in a sandboxed project folder
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AppBuildRequest, AppBuildResult } from './types.js';
import { taskManager } from './task-manager.js';
import { notifier } from './notifier.js';

export interface CLIRunnerConfig {
  sandboxPath: string;           // Base folder for all app builds
  timeout: number;               // Max time for a build (ms)
  copilotCommand: string;        // Command to run copilot ('copilot' or full path)
}

const DEFAULT_CONFIG: CLIRunnerConfig = {
  sandboxPath: path.join(process.cwd(), 'sandbox'),
  timeout: 600000,  // 10 minutes
  copilotCommand: 'copilot',
};

/**
 * Manages Copilot CLI invocations for building apps
 */
export class CLIRunner {
  private config: CLIRunnerConfig;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(config: Partial<CLIRunnerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureSandboxDir();
  }

  /**
   * Ensure sandbox directory exists
   */
  private ensureSandboxDir(): void {
    if (!fs.existsSync(this.config.sandboxPath)) {
      fs.mkdirSync(this.config.sandboxPath, { recursive: true });
      console.log(`[CLIRunner] Created sandbox directory: ${this.config.sandboxPath}`);
    }
  }

  /**
   * Build an app using Copilot CLI
   * Returns a task ID that can be tracked
   */
  buildApp(request: AppBuildRequest): string {
    const appName = request.appName || `app-${Date.now()}`;
    const appPath = path.join(
      request.projectFolder || this.config.sandboxPath,
      appName
    );

    // Create the app directory
    if (!fs.existsSync(appPath)) {
      fs.mkdirSync(appPath, { recursive: true });
    }

    // Submit as background task
    const task = taskManager.submit(
      'app_build',
      `Building app: ${appName}`,
      async (task, updateProgress) => {
        return this.executeBuild(appPath, request.description, appName, updateProgress);
      },
      { appName, appPath, request }
    );

    console.log(`[CLIRunner] App build queued: ${appName} at ${appPath}`);
    return task.id;
  }

  /**
   * Execute the actual build process
   */
  private async executeBuild(
    appPath: string,
    description: string,
    appName: string,
    updateProgress: (progress: number) => void
  ): Promise<AppBuildResult> {
    const startTime = Date.now();
    updateProgress(10);

    return new Promise((resolve, reject) => {
      // Create a prompt file for copilot
      const promptFile = path.join(appPath, 'PROMPT.md');
      fs.writeFileSync(promptFile, `# Build Request\n\n${description}\n`);

      updateProgress(20);

      // Spawn copilot CLI
      // Using --print to get output without interactive mode
      const args = [
        '--print',
        description
      ];

      console.log(`[CLIRunner] Running: ${this.config.copilotCommand} ${args.join(' ')}`);
      console.log(`[CLIRunner] Working directory: ${appPath}`);

      const child = spawn(this.config.copilotCommand, args, {
        cwd: appPath,
        shell: true,
        env: {
          ...process.env,
          // Ensure copilot runs non-interactively
          CI: 'true',
        },
      });

      const processId = uuidv4();
      this.activeProcesses.set(processId, child);

      let stdout = '';
      let stderr = '';
      let progressEstimate = 20;

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log(`[CLIRunner] stdout: ${chunk.substring(0, 100)}`);

        // Estimate progress based on output
        progressEstimate = Math.min(90, progressEstimate + 5);
        updateProgress(progressEstimate);
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log(`[CLIRunner] stderr: ${chunk.substring(0, 100)}`);
      });

      // Timeout handler
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Build timed out after ${this.config.timeout / 1000}s`));
      }, this.config.timeout);

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(processId);

        const duration = Date.now() - startTime;
        updateProgress(100);

        if (code === 0) {
          console.log(`[CLIRunner] Build completed: ${appName} in ${duration}ms`);

          // Notify success
          notifier.notifyAppBuildComplete(appName, appPath, duration);

          resolve({
            success: true,
            appPath,
            output: stdout,
            duration,
          });
        } else {
          const error = `Build failed with code ${code}: ${stderr || stdout}`;
          console.error(`[CLIRunner] Build failed: ${appName}`, error);

          // Notify failure
          notifier.notifyAppBuildFailed(appName, error);

          reject(new Error(error));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(processId);

        console.error(`[CLIRunner] Process error: ${appName}`, error);
        notifier.notifyAppBuildFailed(appName, error.message);

        reject(error);
      });
    });
  }

  /**
   * Run an arbitrary command in the sandbox
   */
  async runCommand(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const workDir = cwd || this.config.sandboxPath;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: workDir,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, code: code || 0 });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * List apps in the sandbox
   */
  listApps(): { name: string; path: string; createdAt: Date }[] {
    const apps: { name: string; path: string; createdAt: Date }[] = [];

    try {
      const entries = fs.readdirSync(this.config.sandboxPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const appPath = path.join(this.config.sandboxPath, entry.name);
          const stats = fs.statSync(appPath);
          apps.push({
            name: entry.name,
            path: appPath,
            createdAt: stats.birthtime,
          });
        }
      }
    } catch {
      // Sandbox doesn't exist yet
    }

    return apps.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get sandbox path
   */
  getSandboxPath(): string {
    return this.config.sandboxPath;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<CLIRunnerConfig>): void {
    this.config = { ...this.config, ...config };
    this.ensureSandboxDir();
  }

  /**
   * Cancel all active processes
   */
  cancelAll(): void {
    for (const [id, process] of this.activeProcesses) {
      process.kill('SIGTERM');
      console.log(`[CLIRunner] Killed process: ${id}`);
    }
    this.activeProcesses.clear();
  }
}

// Singleton instance
export const cliRunner = new CLIRunner();
