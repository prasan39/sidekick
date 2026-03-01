import { useState, useRef, useEffect } from 'react';
import type { Nudge } from '../hooks/useChat';

interface NudgePanelProps {
  nudges: Nudge[];
  onDismiss: (id: string) => void;
}

export function NudgePanel({ nudges, onDismiss }: NudgePanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return '#ef4444';
      case 'high': return '#f97316';
      case 'normal': return '#3b82f6';
      case 'low': return '#6b7280';
      default: return '#3b82f6';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'URGENT';
      case 'high': return 'HIGH';
      case 'normal': return '';
      case 'low': return '';
      default: return '';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'new_email': return '\u2709\uFE0F';
      case 'email_draft_ready': return '\uD83D\uDCDD';
      case 'task_complete': return '\u2705';
      case 'task_failed': return '\u274C';
      case 'app_build_complete': return '\uD83D\uDE80';
      case 'app_build_failed': return '\uD83D\uDD27';
      case 'meeting_soon': return '\uD83D\uDCC5';
      default: return '\uD83D\uDCAC';
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString();
  };

  const dismissAll = () => {
    nudges.forEach(n => onDismiss(n.id));
  };

  const count = nudges.length;

  return (
    <div className="notif-anchor" ref={panelRef}>
      {/* Bell button */}
      <button
        className="notif-bell"
        onClick={() => setOpen(!open)}
        title={count > 0 ? `${count} notification${count > 1 ? 's' : ''}` : 'No notifications'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="notif-badge">{count > 9 ? '9+' : count}</span>
        )}
      </button>

      {/* Drawer */}
      {open && (
        <div className="notif-drawer">
          {/* Header */}
          <div className="notif-drawer-header">
            <span className="notif-drawer-title">Notifications</span>
            {count > 0 && (
              <button className="notif-clear-all" onClick={dismissAll}>
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div className="notif-drawer-list">
            {count === 0 ? (
              <div className="notif-empty">
                <div className="notif-empty-icon">{'\uD83D\uDD14'}</div>
                <div className="notif-empty-text">All caught up!</div>
                <div className="notif-empty-sub">No new notifications</div>
              </div>
            ) : (
              nudges.map((nudge, i) => (
                <div
                  key={nudge.id}
                  className="notif-item"
                  style={{
                    borderLeftColor: getPriorityColor(nudge.priority),
                    animationDelay: `${i * 0.04}s`,
                  }}
                >
                  <div className="notif-item-icon">{getTypeIcon(nudge.type)}</div>
                  <div className="notif-item-body">
                    <div className="notif-item-top">
                      <span className="notif-item-title">{nudge.title}</span>
                      {getPriorityLabel(nudge.priority) && (
                        <span
                          className="notif-item-priority"
                          style={{ color: getPriorityColor(nudge.priority) }}
                        >
                          {getPriorityLabel(nudge.priority)}
                        </span>
                      )}
                    </div>
                    <div className="notif-item-message">{nudge.message}</div>
                    <div className="notif-item-time">{formatTime(nudge.createdAt)}</div>
                  </div>
                  <button
                    className="notif-item-dismiss"
                    onClick={() => onDismiss(nudge.id)}
                    title="Dismiss"
                  >
                    {'\u2715'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
