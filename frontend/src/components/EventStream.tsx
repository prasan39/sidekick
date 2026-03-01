import { useRef, useEffect } from 'react';

interface AgentEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface EventStreamProps {
  events: AgentEvent[];
  currentTool: string | null;
}

export function EventStream({ events, currentTool }: EventStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events]);

  const getEventIcon = (type: string): string => {
    switch (type) {
      case 'session_start':
        return '🚀';
      case 'thinking':
        return '🤔';
      case 'text_delta':
      case 'text_complete':
        return '💬';
      case 'reasoning_delta':
      case 'reasoning_complete':
        return '💭';
      case 'tool_call_start':
        return '🔧';
      case 'tool_call_end':
        return '✅';
      case 'tool_call_args':
        return '📝';
      case 'tool_call_complete':
        return '✅';
      case 'tool_result':
        return '📤';
      case 'approval_required':
        return '⏳';
      case 'approval_resolved':
        return '✔️';
      case 'memory_updated':
        return '🧠';
      case 'session_idle':
        return '💤';
      case 'error':
        return '❌';
      case 'done':
        return '🏁';
      case 'ws_connected':
        return '🔌';
      case 'ws_disconnected':
        return '⚠️';
      default:
        return '📌';
    }
  };

  const getEventLabel = (type: string): string => {
    switch (type) {
      case 'session_start':
        return 'Session Started';
      case 'thinking':
        return 'Thinking';
      case 'text_delta':
        return 'Streaming';
      case 'text_complete':
        return 'Text Complete';
      case 'reasoning_delta':
        return 'Reasoning';
      case 'reasoning_complete':
        return 'Reasoning Done';
      case 'tool_call_start':
        return 'Tool Call';
      case 'tool_call_end':
        return 'Tool Complete';
      case 'tool_call_args':
        return 'Building Args';
      case 'tool_call_complete':
        return 'Tool Ready';
      case 'tool_result':
        return 'Tool Result';
      case 'approval_required':
        return 'Awaiting Approval';
      case 'approval_resolved':
        return 'Approval Resolved';
      case 'memory_updated':
        return 'Memory Updated';
      case 'session_idle':
        return 'Session Idle';
      case 'error':
        return 'Error';
      case 'done':
        return 'Complete';
      case 'ws_connected':
        return 'Connected';
      case 'ws_disconnected':
        return 'Disconnected';
      default:
        return type;
    }
  };

  const formatEventData = (event: AgentEvent): string => {
    const { type, data } = event;

    switch (type) {
      case 'session_start':
        return String(data.status || data.model || '');
      case 'tool_call_start':
        return `${data.tool}`;
      case 'tool_call_end':
        return `${data.tool}`;
      case 'tool_result':
        return `${data.tool}: ${String(data.result).substring(0, 50)}...`;
      case 'memory_updated':
        return `${data.action}: ${data.fact || 'updated'}`;
      case 'error':
        return String(data.error || data.message || 'Unknown error');
      case 'thinking':
        return String(data.status || '');
      case 'text_delta':
        return `+${String(data.text || '').length} chars`;
      case 'reasoning_delta':
        return `+${String(data.text || '').length} chars`;
      default:
        return '';
    }
  };

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Only show recent events (last 20)
  const recentEvents = events.slice(-20);

  return (
    <div className="event-stream">
      <div className="event-stream-header">
        <h3>Event Stream</h3>
        {currentTool && (
          <span className="current-tool">
            <span className="tool-spinner"></span>
            {currentTool}
          </span>
        )}
      </div>

      <div className="event-stream-content" ref={containerRef}>
        {recentEvents.length === 0 ? (
          <div className="event-empty">No events yet</div>
        ) : (
          recentEvents.map((event, index) => (
            <div
              key={`${event.timestamp}-${index}`}
              className={`event-item event-${event.type}`}
            >
              <span className="event-icon">{getEventIcon(event.type)}</span>
              <span className="event-time">{formatTime(event.timestamp)}</span>
              <span className="event-label">{getEventLabel(event.type)}</span>
              {formatEventData(event) && (
                <span className="event-data">{formatEventData(event)}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
