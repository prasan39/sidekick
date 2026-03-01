import { useState, useRef, useEffect, KeyboardEvent, DragEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Streamdown } from 'streamdown';
import {
  Send, Square, Paperclip, Trash2, Copy, Check,
  ThumbsUp, ThumbsDown, ShieldAlert, CheckCircle, XCircle,
  Sparkles, Brain, Wrench, Image, FileText, FileSpreadsheet, File as FileIcon
} from 'lucide-react';
import type { Message, PendingApproval, UsageInfo, QuotaSnapshot } from '../hooks/useChat';
import { MODEL_OPTIONS } from '../hooks/useChat';
import { MarkdownView } from './markdown/MarkdownView';
import { AttachmentPreviewModal, type PreviewAttachment } from './AttachmentPreviewModal';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;
const ACCEPTED_TYPES = 'image/*,.pdf,.txt,.csv,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx';

interface PendingFile {
  id: string;
  file: File;
  thumbUrl?: string;
}

function makeId(): string {
  // Prefer stable unique IDs for attachment chips.
  // `crypto.randomUUID()` is widely supported in modern browsers.
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string): React.ReactNode {
  if (type.startsWith('image/')) return <Image size={18} />;
  if (type === 'application/pdf') return <FileText size={18} />;
  if (type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') return <FileSpreadsheet size={18} />;
  return <FileIcon size={18} />;
}

interface ChatProps {
  messages: Message[];
  streamingContent: string;
  reasoningContent: string;
  isLoading: boolean;
  currentTool: string | null;
  pendingApprovals: PendingApproval[];
  restoredCount: number;
  modelId?: string;
  workIqEnabled?: boolean;
  usage?: UsageInfo | null;
  onSend: (message: string, files?: File[]) => void;
  onStop: () => void;
  onApprove: (id: string, approved: boolean) => void;
  onClear: () => void;
  inputPrefill?: string;
  onInputPrefillConsumed?: () => void;
}

function getModelDisplay(modelId?: string): { label: string; providerColor: string } {
  const model = MODEL_OPTIONS.find(m => m.id === modelId);
  if (!model) return { label: modelId || 'Unknown', providerColor: '#8a8a8a' };
  const colors: Record<string, string> = {
    Anthropic: '#d97706',
    OpenAI: '#10a37f',
    Google: '#4285f4',
    GitHub: '#6e40c9',
    xAI: '#111827',
  };
  return { label: model.label, providerColor: colors[model.provider] || '#8a8a8a' };
}

function pickQuotaSnapshot(usage?: UsageInfo | null): { key: string; snap: QuotaSnapshot } | null {
  const qs = usage?.quotaSnapshots;
  if (!qs) return null;
  if (Object.keys(qs).length === 0) return null;

  // Prefer premium bucket when available to avoid showing "Unlimited" from
  // base chat entitlement while using premium models (e.g. Claude Sonnet).
  if (qs['premium_interactions']) {
    return { key: 'premium_interactions', snap: qs['premium_interactions'] };
  }
  if (qs['chat']) return { key: 'chat', snap: qs['chat'] };
  const entries = Object.entries(qs);
  const finite = entries
    .filter(([, v]) => v && typeof v.entitlementRequests === 'number' && v.entitlementRequests > 0 && !v.isUnlimitedEntitlement)
    .sort((a, b) => (b[1].entitlementRequests || 0) - (a[1].entitlementRequests || 0));
  if (finite.length > 0) {
    const [key, snap] = finite[0];
    return { key, snap };
  }
  const [key, snap] = entries[0] as [string, QuotaSnapshot];
  return { key, snap };
}

function formatQuotaTicker(usage?: UsageInfo | null): { text: string; title?: string; level?: 'low' } | null {
  const picked = pickQuotaSnapshot(usage);
  if (!picked) return null;
  const { key, snap } = picked;
  const reset = snap.resetDate ? new Date(snap.resetDate) : null;
  const title = reset ? `Resets ${reset.toLocaleString()} (${key})` : `Quota bucket: ${key}`;
  if (snap.isUnlimitedEntitlement) return { text: 'Premium: Unlimited', title };
  if (typeof snap.entitlementRequests === 'number' && typeof snap.usedRequests === 'number' && snap.entitlementRequests > 0) {
    const remaining = Math.max(0, snap.entitlementRequests - snap.usedRequests);
    const level = remaining / snap.entitlementRequests <= 0.2 ? 'low' : undefined;
    return { text: `Premium left: ${remaining}/${snap.entitlementRequests}`, title, level };
  }
  if (typeof snap.remainingPercentage === 'number') return { text: `Premium left: ${snap.remainingPercentage}%`, title };
  return null;
}

// Copy to clipboard helper
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="msg-action-btn" onClick={handleCopy} title="Copy message">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

// Feedback buttons
function FeedbackButtons() {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  return (
    <>
      <button
        className={`msg-action-btn ${feedback === 'up' ? 'active' : ''}`}
        onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
        title="Good response"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        className={`msg-action-btn ${feedback === 'down' ? 'active' : ''}`}
        onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
        title="Poor response"
      >
        <ThumbsDown size={14} />
      </button>
    </>
  );
}

export function Chat({
  messages,
  streamingContent,
  reasoningContent,
  isLoading,
  currentTool,
  pendingApprovals,
  restoredCount,
  modelId,
  workIqEnabled,
  usage,
  onSend,
  onStop,
  onApprove,
  onClear,
  inputPrefill,
  onInputPrefillConsumed,
}: ChatProps) {
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<PendingFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewAttachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ensure we revoke blob URLs created for the input attachment preview bar.
  const attachedFilesRef = useRef<PendingFile[]>([]);
  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);
  useEffect(() => {
    return () => {
      attachedFilesRef.current.forEach((p) => {
        if (p.thumbUrl) {
          try { URL.revokeObjectURL(p.thumbUrl); } catch { /* ignore */ }
        }
      });
    };
  }, []);

  const addFiles = (newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const valid: PendingFile[] = [];
    for (const f of fileArray) {
      if (f.size > MAX_FILE_SIZE) {
        alert(`"${f.name}" exceeds the 10 MB limit.`);
        continue;
      }
      valid.push({
        id: makeId(),
        file: f,
        thumbUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
      });
    }
    setAttachedFiles(prev => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        combined.slice(MAX_FILES).forEach((p) => {
          if (p.thumbUrl) {
            try { URL.revokeObjectURL(p.thumbUrl); } catch { /* ignore */ }
          }
        });
        alert(`Maximum ${MAX_FILES} files per message. Extra files were dropped.`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  };

  const removeFile = (id: string) => {
    setAttachedFiles(prev => {
      const removed = prev.find(p => p.id === id);
      if (removed?.thumbUrl) {
        try { URL.revokeObjectURL(removed.thumbUrl); } catch { /* ignore */ }
      }
      return prev.filter(p => p.id !== id);
    });
  };

  const clearPendingFiles = () => {
    setAttachedFiles(prev => {
      prev.forEach((p) => {
        if (p.thumbUrl) {
          try { URL.revokeObjectURL(p.thumbUrl); } catch { /* ignore */ }
        }
      });
      return [];
    });
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (inputPrefill) {
      setInput(inputPrefill);
      onInputPrefillConsumed?.();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [inputPrefill, onInputPrefillConsumed]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !isLoading) {
      onSend(input.trim(), attachedFiles.length > 0 ? attachedFiles.map(p => p.file) : undefined);
      setInput('');
      clearPendingFiles();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div className="chat">
      <div className="chat-messages">
        {messages.length === 0 && !isLoading && (
          <div className="welcome-message">
            <div className="welcome-icon">
              <Sparkles size={28} color="white" />
            </div>
            <h2>What can I help you ship?</h2>
            <p>Your AI-powered work companion with persistent memory, file analysis, and app building capabilities.</p>
            <div className="welcome-grid">
              <button className="welcome-card" onClick={() => onSend("Build me a project tracker app with task statuses, due dates, and a Kanban board view")}>
                <span className="card-icon"><Wrench size={24} /></span>
                <span className="card-title">Build a live app</span>
                <span className="card-desc">Describe any app and watch it get built in real-time with preview</span>
              </button>
              <button className="welcome-card" onClick={() => onSend("Analyze the attached file and give me a structured summary with key insights and action items")}>
                <span className="card-icon"><FileSpreadsheet size={24} /></span>
                <span className="card-title">Analyze documents</span>
                <span className="card-desc">Drop any file - PPT, PDF, Excel - get instant insights and summaries</span>
              </button>
              <button className="welcome-card" onClick={() => onSend("Draft a concise product brief for a new coworking app aimed at freelancers. Include goals, target users, and key features.")}>
                <span className="card-icon"><Brain size={24} /></span>
                <span className="card-title">Draft a brief</span>
                <span className="card-desc">Get a clear, structured plan you can refine fast</span>
              </button>
              <button className="welcome-card" onClick={() => onSend("Summarize this repo and propose the next 3 improvements I should tackle.")}>
                <span className="card-icon"><FileText size={24} /></span>
                <span className="card-title">Review this repo</span>
                <span className="card-desc">Quick scan with prioritized improvements</span>
              </button>
              {workIqEnabled && (
                <>
                  <button className="welcome-card" onClick={() => onSend("Show me today's calendar with meeting details. For each meeting, list the attendees and any agenda or documents shared.")}>
                    <span className="card-icon">{"\uD83D\uDCC5"}</span>
                    <span className="card-title">Today's schedule</span>
                    <span className="card-desc">Meetings, attendees & prep materials</span>
                  </button>
                  <button className="welcome-card" onClick={() => onSend("Show my unread emails from today. Prioritize by sender importance and flag anything that needs a response.")}>
                    <span className="card-icon">{"\u2709\uFE0F"}</span>
                    <span className="card-title">Triage emails</span>
                    <span className="card-desc">Smart inbox prioritization & flagging</span>
                  </button>
                  <button className="welcome-card" onClick={() => onSend("Summarize all my unread Teams messages and @mentions. Group by channel and highlight anything that needs my response.")}>
                    <span className="card-icon">{"\uD83D\uDCAC"}</span>
                    <span className="card-title">Teams catch-up</span>
                    <span className="card-desc">Unread messages & @mentions summary</span>
                  </button>
                  <button className="welcome-card" onClick={() => onSend("Draft a reply to my most recent email that needs a response. Match the sender's tone and keep it professional.")}>
                    <span className="card-icon">{"\u270D\uFE0F"}</span>
                    <span className="card-title">Auto-draft replies</span>
                    <span className="card-desc">AI-composed email responses</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg, index) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {restoredCount > 0 && index === restoredCount && (
                <div className="history-divider">
                  <span className="history-divider-line"></span>
                  <span className="history-divider-text">{restoredCount} earlier messages restored</span>
                  <span className="history-divider-line"></span>
                </div>
              )}
              <div className={`message ${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === 'user' ? '\uD83D\uDC64' : <Sparkles size={14} />}
                </div>
                <div className="message-bubble">
                  <div className="message-content">
                    {msg.role === 'assistant' ? (
                      <MarkdownView
                        content={msg.content}
                        onOpenAttachment={(att) => {
                          setPreviewAttachment({
                            name: att.name,
                            type: att.type,
                            size: att.size,
                            url: att.url,
                          });
                        }}
                      />
                    ) : (
                      <p>{msg.content}</p>
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="message-attachments">
                        {msg.attachments.map((att, i) => (
                          <button
                            key={i}
                            type="button"
                            className="message-attachment-item"
                            onClick={() => setPreviewAttachment(att)}
                            title="Preview attachment"
                          >
                            {att.type.startsWith('image/') && att.url ? (
                              <img src={att.url} alt={att.name} className="attachment-thumb" />
                            ) : (
                              <span className="attachment-icon">{getFileIcon(att.type)}</span>
                            )}
                            <span className="attachment-name">{att.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="message-meta">
                    <span className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    {msg.role === 'assistant' && (
                      <div className="msg-actions">
                        <CopyButton text={msg.content} />
                        <FeedbackButtons />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Streaming content */}
        {(streamingContent || isLoading) && (
          <motion.div
            className="message assistant streaming"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="message-avatar"><Sparkles size={14} /></div>
            <div className="message-content">
              {reasoningContent && (
                <div className="reasoning-block">
                  <span className="reasoning-label"><Brain size={12} /> Thinking...</span>
                  <p>{reasoningContent}</p>
                </div>
              )}
              {currentTool && (
                <div className="tool-indicator-inline">
                  <span className="tool-spinner branded"></span>
                  Using {currentTool}...
                </div>
              )}
              {streamingContent ? (
                <Streamdown mode="streaming" parseIncompleteMarkdown={true}>
                  {streamingContent}
                </Streamdown>
              ) : (
                !reasoningContent && !currentTool && (
                  <div className="typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                )
              )}
            </div>
          </motion.div>
        )}

        {/* Pending approvals */}
        {pendingApprovals.map((approval) => (
          <motion.div
            key={approval.id}
            className="approval-card"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="approval-header">
              <span className="approval-icon"><ShieldAlert size={20} color="#F59E0B" /></span>
              <span className="approval-title">Action requires approval</span>
            </div>
            <div className="approval-content">
              <div className="approval-tool">{approval.tool}</div>
              <pre className="approval-preview">{approval.preview}</pre>
            </div>
            <div className="approval-actions">
              <button className="btn btn-approve" onClick={() => onApprove(approval.id, true)}>
                <CheckCircle size={14} /> Approve
              </button>
              <button className="btn btn-deny" onClick={() => onApprove(approval.id, false)}>
                <XCircle size={14} /> Deny
              </button>
            </div>
          </motion.div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form className="chat-input-form" onSubmit={handleSubmit}>
        {modelId && (() => {
          const { label, providerColor } = getModelDisplay(modelId);
          const quota = formatQuotaTicker(usage);
          return (
            <div className="model-indicator">
              <span className="model-indicator-dot" style={{ background: providerColor }}></span>
              <span className="model-indicator-label">{label}</span>
              {quota && (
                <span className={`quota-ticker${quota.level === 'low' ? ' low' : ''}`} title={quota.title}>
                  {quota.text}
                </span>
              )}
            </div>
          );
        })()}
        <div
          className={`chat-input-wrapper${isDragOver ? ' drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {attachedFiles.length > 0 && (
            <div className="attachment-preview-bar">
              {attachedFiles.map((p) => (
                <div key={p.id} className="attachment-chip">
                  {p.file.type.startsWith('image/') && p.thumbUrl ? (
                    <img src={p.thumbUrl} alt={p.file.name} className="chip-thumb" />
                  ) : (
                    <span className="chip-icon">{getFileIcon(p.file.type)}</span>
                  )}
                  <span className="chip-name">{p.file.name}</span>
                  <span className="chip-size">{formatFileSize(p.file.size)}</span>
                  <button type="button" className="chip-remove" onClick={() => removeFile(p.id)} title="Remove file">
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            disabled={isLoading}
            rows={1}
          />
          <div className="chat-input-actions">
            <button type="button" className="btn btn-icon btn-attach" onClick={() => fileInputRef.current?.click()} title="Attach files" disabled={isLoading}>
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
            <button type="button" className="btn btn-icon btn-clear" onClick={onClear} title="Clear conversation" disabled={messages.length === 0}>
              <Trash2 size={16} />
            </button>
            {isLoading ? (
              <button type="button" className="btn btn-stop btn-send" onClick={onStop} title="Stop generating">
                <Square size={14} />
              </button>
            ) : (
              <button type="submit" className="btn btn-primary btn-send" disabled={!input.trim()}>
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </form>

      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
