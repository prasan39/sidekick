import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Copy, Check } from 'lucide-react';

export interface PreviewAttachment {
  name: string;
  type: string;
  size?: number;
  url?: string;
}

interface AttachmentPreviewModalProps {
  attachment: PreviewAttachment | null;
  onClose: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(att: PreviewAttachment): boolean {
  if (att.type === 'application/pdf') return true;
  return att.name.toLowerCase().endsWith('.pdf');
}

function isImage(att: PreviewAttachment): boolean {
  if (att.type.startsWith('image/')) return true;
  return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(att.name);
}

function isTextLike(att: PreviewAttachment): boolean {
  if (att.type.startsWith('text/')) return true;
  const t = att.type.toLowerCase();
  if (t === 'application/json') return true;
  if (t === 'application/xml') return true;
  if (t === 'application/javascript' || t === 'text/javascript') return true;
  if (t === 'application/typescript') return true;

  return /\.(txt|md|markdown|csv|json|xml|html|css|js|ts|jsx|tsx)$/i.test(att.name);
}

export function AttachmentPreviewModal({ attachment, onClose }: AttachmentPreviewModalProps) {
  const [text, setText] = useState<string>('');
  const [textError, setTextError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const isOpen = Boolean(attachment);
  const url = attachment?.url;
  const canPreviewText = attachment ? isTextLike(attachment) : false;

  const title = useMemo(() => {
    if (!attachment) return '';
    const size = formatBytes(attachment.size);
    return size ? `${attachment.name} (${size})` : attachment.name;
  }, [attachment]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    setTimeout(() => overlayRef.current?.focus(), 0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!attachment || !canPreviewText || !url) {
      setText('');
      setTextError(null);
      return;
    }

    const controller = new AbortController();
    setText('');
    setTextError(null);

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        const raw = await res.text();
        const clipped = raw.length > 300_000 ? raw.slice(0, 300_000) + '\n\n…(truncated)…' : raw;
        setText(clipped);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setTextError(String(err));
      }
    })();

    return () => controller.abort();
  }, [attachment, canPreviewText, url]);

  useEffect(() => {
    if (!isOpen && previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus?.();
      previouslyFocusedRef.current = null;
    }
  }, [isOpen]);

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  if (!attachment) return null;

  return (
    <div
      className="apm-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      ref={overlayRef}
    >
      <div className="apm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="apm-header">
          <div className="apm-title" title={title}>{attachment.name}</div>
          <div className="apm-actions">
            {canPreviewText && text && (
              <button type="button" className="apm-btn" onClick={handleCopyText} title="Copy text">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
            {url && (
              <a className="apm-btn" href={url} download={attachment.name} title="Download">
                <Download size={14} />
              </a>
            )}
            <button type="button" className="apm-btn" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="apm-body">
          {!url && (
            <div className="apm-empty">No preview available (missing URL).</div>
          )}

          {url && isImage(attachment) && (
            <div className="apm-image-wrap">
              <img src={url} alt={attachment.name} className="apm-image" />
            </div>
          )}

          {url && !isImage(attachment) && isPdf(attachment) && (
            <iframe className="apm-pdf" src={url} title={attachment.name} />
          )}

          {url && canPreviewText && (
            <>
              {textError ? (
                <div className="apm-error">Failed to load preview: {textError}</div>
              ) : (
                <pre className="apm-text"><code>{text || 'Loading…'}</code></pre>
              )}
            </>
          )}

          {url && !isImage(attachment) && !isPdf(attachment) && !canPreviewText && (
            <div className="apm-empty">No inline preview for this file type.</div>
          )}
        </div>
      </div>
    </div>
  );
}

