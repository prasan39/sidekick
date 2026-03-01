/**
 * Scheduler — node-cron wrapper for daily Substack digest trigger
 */
import cron from 'node-cron';

export class Scheduler {
  private task: cron.ScheduledTask | null = null;
  private cronExpression: string;
  private callback: (() => Promise<void>) | null = null;

  constructor(cronExpression = '0 8 * * *') {
    this.cronExpression = cronExpression;
  }

  setCronExpression(expr: string): void {
    this.cronExpression = expr;
    // Restart if already running
    if (this.task && this.callback) {
      this.stop();
      this.start(this.callback);
    }
  }

  start(callback: () => Promise<void>): void {
    this.callback = callback;

    if (this.task) {
      this.task.stop();
    }

    this.task = cron.schedule(this.cronExpression, async () => {
      console.log(`[Scheduler] Cron triggered: ${this.cronExpression}`);
      try {
        await callback();
      } catch (err) {
        console.error('[Scheduler] Cron execution error:', err);
      }
    });

    console.log(`[Scheduler] Scheduled: ${this.cronExpression}`);
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[Scheduler] Stopped');
    }
  }

  getNextRun(): string | null {
    // node-cron doesn't expose next run time directly, so we compute it
    if (!this.task) return null;
    try {
      // Parse cron to estimate next run
      const parts = this.cronExpression.split(' ');
      const hour = parseInt(parts[1]) || 8;
      const now = new Date();
      const next = new Date(now);
      next.setHours(hour, parseInt(parts[0]) || 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next.toISOString();
    } catch {
      return null;
    }
  }

  isRunning(): boolean {
    return this.task !== null;
  }
}
