import { Streamdown } from 'streamdown';

interface MessageProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export function Message({ role, content, timestamp, isStreaming = false }: MessageProps) {
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className={`message ${role}`}>
      <div className="message-avatar">
        {role === 'user' ? 'U' : 'M'}
      </div>
      <div className="message-bubble">
        <div className="message-content">
          {role === 'assistant' ? (
            <Streamdown
              mode={isStreaming ? 'streaming' : 'static'}
              parseIncompleteMarkdown={true}
            >
              {content}
            </Streamdown>
          ) : (
            <p>{content}</p>
          )}
        </div>
        <span className="message-time">{time}</span>
      </div>
    </div>
  );
}
