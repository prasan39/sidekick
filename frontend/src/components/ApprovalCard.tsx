import ReactMarkdown from 'react-markdown';

interface PendingApproval {
  id: string;
  action: string;
  tool: string;
  preview: string;
  expiresAt: string;
}

interface ApprovalCardProps {
  approval: PendingApproval;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

export function ApprovalCard({ approval, onApprove, onDeny }: ApprovalCardProps) {
  const expiresIn = Math.max(
    0,
    Math.floor((new Date(approval.expiresAt).getTime() - Date.now()) / 1000)
  );
  const minutes = Math.floor(expiresIn / 60);
  const seconds = expiresIn % 60;

  const getToolIcon = (tool: string) => {
    switch (tool) {
      case 'send_email':
        return '📧';
      case 'create_event':
        return '📅';
      case 'send_teams_message':
        return '💬';
      case 'upload_file':
        return '📤';
      default:
        return '⚡';
    }
  };

  return (
    <div className="approval-card">
      <div className="approval-header">
        <span className="approval-icon">{getToolIcon(approval.tool)}</span>
        <span className="approval-action">{approval.action}</span>
        <span className="approval-timer">
          {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
      </div>

      <div className="approval-preview">
        <ReactMarkdown>{approval.preview}</ReactMarkdown>
      </div>

      <div className="approval-actions">
        <button
          className="btn btn-approve"
          onClick={() => onApprove(approval.id)}
        >
          Approve
        </button>
        <button
          className="btn btn-deny"
          onClick={() => onDeny(approval.id)}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
