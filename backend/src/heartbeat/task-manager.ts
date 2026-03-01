/**
 * Background Task Manager
 * Manages long-running tasks and notifies on completion
 */

import { v4 as uuidv4 } from 'uuid';
import type { BackgroundTask, BackgroundTaskStatus, TaskPriority } from './types.js';
import { PRIORITY_ORDER } from './types.js';
import { notifier } from './notifier.js';

export type TaskExecutor = (task: BackgroundTask, updateProgress: (progress: number) => void) => Promise<unknown>;

interface TaskEntry {
  task: BackgroundTask;
  executor: TaskExecutor;
  requiresReview: boolean;
  promise?: Promise<void>;
}

/**
 * Manages background tasks with progress tracking and notifications
 */
export class TaskManager {
  private tasks: Map<string, TaskEntry> = new Map();
  private maxConcurrent: number;
  private runningCount = 0;
  private queue: string[] = [];
  private onUpdateCallback?: (tasks: BackgroundTask[]) => void;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Set callback for task updates
   */
  onUpdate(callback: (tasks: BackgroundTask[]) => void): void {
    this.onUpdateCallback = callback;
  }

  /**
   * Submit a new background task
   */
  submit(
    type: BackgroundTask['type'],
    description: string,
    executor: TaskExecutor,
    metadata?: Record<string, unknown>,
    options?: { requiresReview?: boolean }
  ): BackgroundTask {
    const task: BackgroundTask = {
      id: uuidv4(),
      type,
      description,
      status: 'pending',
      priority: 'normal',
      createdAt: new Date().toISOString(),
      metadata,
    };

    this.tasks.set(task.id, { task, executor, requiresReview: options?.requiresReview ?? false });
    this.queue.push(task.id);

    console.log(`[TaskManager] Task queued: ${task.id} - ${description}`);
    this.emitUpdate();
    this.processQueue();

    return task;
  }

  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.runningCount < this.maxConcurrent) {
      const taskId = this.queue.shift();
      if (!taskId) continue;

      const entry = this.tasks.get(taskId);
      if (!entry) continue;

      this.runningCount++;
      entry.task.status = 'running';
      entry.task.startedAt = new Date().toISOString();
      this.emitUpdate();

      console.log(`[TaskManager] Starting task: ${taskId}`);

      // Run the task
      entry.promise = this.executeTask(entry);
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(entry: TaskEntry): Promise<void> {
    const { task, executor } = entry;

    const updateProgress = (progress: number) => {
      task.progress = Math.min(100, Math.max(0, progress));
      this.emitUpdate();
    };

    try {
      const result = await executor(task, updateProgress);
      task.result = result;
      task.progress = 100;

      if (entry.requiresReview) {
        task.status = 'review';
        console.log(`[TaskManager] Task ready for review: ${task.id}`);
        notifier.notifyTaskComplete(
          task.id,
          task.description,
          'Ready for your review'
        );
      } else {
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        console.log(`[TaskManager] Task completed: ${task.id}`);
        notifier.notifyTaskComplete(
          task.id,
          task.description,
          typeof result === 'string' ? result : JSON.stringify(result).substring(0, 200)
        );
      }
    } catch (error) {
      task.status = 'failed';
      task.error = String(error);
      task.completedAt = new Date().toISOString();

      console.error(`[TaskManager] Task failed: ${task.id}`, error);

      // Notify failure
      notifier.notifyTaskFailed(task.id, task.description, task.error);
    } finally {
      this.runningCount--;
      this.emitUpdate();
      this.processQueue();
    }
  }

  /**
   * Mark a task in 'review' status as completed
   */
  markReviewed(taskId: string): boolean {
    const entry = this.tasks.get(taskId);
    if (!entry || entry.task.status !== 'review') return false;

    entry.task.status = 'completed';
    entry.task.completedAt = new Date().toISOString();
    console.log(`[TaskManager] Task reviewed and completed: ${taskId}`);
    this.emitUpdate();
    return true;
  }

  /**
   * Cancel a pending or running task
   */
  cancel(taskId: string): boolean {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;

    if (entry.task.status === 'pending') {
      // Remove from queue
      const queueIndex = this.queue.indexOf(taskId);
      if (queueIndex >= 0) {
        this.queue.splice(queueIndex, 1);
      }
      entry.task.status = 'cancelled';
      entry.task.completedAt = new Date().toISOString();
      this.emitUpdate();
      return true;
    }

    // Can't cancel running tasks easily without more complex logic
    return false;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId)?.task;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).map(e => e.task);
  }

  /**
   * Get running tasks
   */
  getRunningTasks(): BackgroundTask[] {
    return this.getAllTasks().filter(t => t.status === 'running');
  }

  /**
   * Get pending tasks
   */
  getPendingTasks(): BackgroundTask[] {
    return this.getAllTasks().filter(t => t.status === 'pending');
  }

  /**
   * Get completed tasks
   */
  getCompletedTasks(): BackgroundTask[] {
    return this.getAllTasks().filter(t => t.status === 'completed' || t.status === 'failed');
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): number {
    let count = 0;
    for (const [id, entry] of this.tasks) {
      if (entry.task.status === 'completed' || entry.task.status === 'failed' || entry.task.status === 'cancelled') {
        this.tasks.delete(id);
        count++;
      }
    }
    this.emitUpdate();
    return count;
  }

  /**
   * Get task statistics
   */
  getStats(): { pending: number; running: number; completed: number; failed: number } {
    const tasks = this.getAllTasks();
    return {
      pending: tasks.filter(t => t.status === 'pending').length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };
  }

  /**
   * Emit update to callback
   */
  private emitUpdate(): void {
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.getAllTasks());
    }
  }
}

// Singleton instance
export const taskManager = new TaskManager();
