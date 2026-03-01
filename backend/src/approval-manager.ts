import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PendingApproval {
  id: string;
  action: string;
  tool: string;
  args: Record<string, unknown>;
  preview: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

export class ApprovalManager {
  private pendingPath: string;
  private approvals: Map<string, PendingApproval> = new Map();
  private resolvers: Map<string, (approved: boolean) => void> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private onUpdate?: (approvals: PendingApproval[]) => void;

  constructor(dataDir: string = path.join(__dirname, '..', 'data')) {
    this.pendingPath = path.join(dataDir, 'pending.json');
    this.loadPending();
  }

  setUpdateCallback(callback: (approvals: PendingApproval[]) => void): void {
    this.onUpdate = callback;
  }

  private loadPending(): void {
    try {
      if (fs.existsSync(this.pendingPath)) {
        const data = JSON.parse(fs.readFileSync(this.pendingPath, 'utf-8'));
        for (const approval of data) {
          if (approval.status === 'pending') {
            const expiresAt = new Date(approval.expiresAt);
            if (expiresAt > new Date()) {
              this.approvals.set(approval.id, approval);
            } else {
              approval.status = 'expired';
            }
          }
        }
      }
    } catch {
      // Start fresh if file is corrupted
    }
  }

  private savePending(): void {
    try {
      const data = Array.from(this.approvals.values());
      fs.writeFileSync(this.pendingPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save pending approvals:', error);
    }
  }

  private notifyUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.getPendingApprovals());
    }
  }

  // Create a new pending approval and wait for resolution
  async requestApproval(
    tool: string,
    args: Record<string, unknown>,
    preview: string
  ): Promise<boolean> {
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    const approval: PendingApproval = {
      id,
      action: this.getActionDescription(tool, args),
      tool,
      args,
      preview,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'pending',
    };

    this.approvals.set(id, approval);
    this.savePending();
    this.notifyUpdate();

    // Set expiration timeout
    const timeout = setTimeout(() => {
      this.resolve(id, false, 'expired');
    }, 5 * 60 * 1000);

    this.timeouts.set(id, timeout);

    // Wait for approval/denial
    return new Promise<boolean>((resolve) => {
      this.resolvers.set(id, resolve);
    });
  }

  private getActionDescription(tool: string, args: Record<string, unknown>): string {
    switch (tool) {
      case 'send_email':
        return `Send email to ${args.to}`;
      case 'create_event':
        return `Create calendar event: ${args.title}`;
      case 'upload_file':
        return `Upload file: ${args.filename}`;
      case 'delete_file':
        return `Delete file: ${args.path}`;
      case 'send_teams_message':
        return `Send Teams message to ${args.channel || args.user}`;
      default:
        return `Execute ${tool}`;
    }
  }

  // Resolve an approval (approve or deny)
  resolve(id: string, approved: boolean, reason?: string): { success: boolean; message: string } {
    const approval = this.approvals.get(id);

    if (!approval) {
      return { success: false, message: `Approval ${id} not found` };
    }

    if (approval.status !== 'pending') {
      return { success: false, message: `Approval ${id} already ${approval.status}` };
    }

    // Update status
    approval.status = approved ? 'approved' : (reason === 'expired' ? 'expired' : 'denied');
    this.savePending();

    // Clear timeout
    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }

    // Resolve the promise
    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver(approved);
      this.resolvers.delete(id);
    }

    // Clean up
    this.approvals.delete(id);
    this.notifyUpdate();

    return {
      success: true,
      message: approved ? 'Action approved' : `Action ${reason === 'expired' ? 'expired' : 'denied'}`,
    };
  }

  // Get all pending approvals
  getPendingApprovals(): PendingApproval[] {
    return Array.from(this.approvals.values()).filter(a => a.status === 'pending');
  }

  // Get a specific approval
  getApproval(id: string): PendingApproval | undefined {
    return this.approvals.get(id);
  }
}

// Singleton instance
export const approvalManager = new ApprovalManager();
