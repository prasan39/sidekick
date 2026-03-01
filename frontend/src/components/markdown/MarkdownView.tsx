import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { Presentation, Download } from 'lucide-react';

export interface OpenableAttachment {
  name: string;
  type: string;
  url: string;
  size?: number;
}

interface MarkdownViewProps {
  content: string;
  onOpenAttachment?: (att: OpenableAttachment) => void;
}

function isExternalHref(href?: string): boolean {
  if (!href) return false;
  return /^https?:\/\//i.test(href);
}

function inferNameFromUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    const path = u.pathname || '';
    const last = path.split('/').filter(Boolean).pop();
    return last || 'image';
  } catch {
    const parts = url.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'image';
  }
}

export function MarkdownView({ content, onOpenAttachment }: MarkdownViewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ node: _node, ...props }) => (
          <div className="table-wrapper">
            <table {...props} />
          </div>
        ),
        code: (props: any) => <CodeBlock {...props} />,
        a: ({ node: _node, href, children, ...props }) => {
          // Render a styled download card for generated presentations
          if (href?.includes('/api/presentations/') && href.endsWith('.pptx')) {
            const backendUrl = `http://localhost:3001${href}`;
            const rawName = decodeURIComponent(href.split('/').pop() || 'presentation.pptx');
            // Strip the timestamp suffix: "my-title-1234567890.pptx" → "my-title.pptx"
            const label = rawName.replace(/-\d{10,}\.pptx$/, '.pptx').replace(/-/g, ' ');
            return (
              <a
                href={backendUrl}
                download
                className="pptx-download-card"
                {...props}
              >
                <span className="pptx-download-icon"><Presentation size={22} /></span>
                <span className="pptx-download-info">
                  <span className="pptx-download-label">{label}</span>
                  <span className="pptx-download-sub">PowerPoint Presentation</span>
                </span>
                <span className="pptx-download-btn"><Download size={16} /> Download</span>
              </a>
            );
          }
          const external = isExternalHref(href);
          return (
            <a
              href={href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noreferrer noopener' : undefined}
              {...props}
            >
              {children}
            </a>
          );
        },
        img: ({ node: _node, src, alt, ...props }) => {
          const handleOpen = () => {
            if (!src || !onOpenAttachment) return;
            onOpenAttachment({
              name: alt || inferNameFromUrl(src),
              type: 'image/*',
              url: src,
            });
          };

          return (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img
              src={src}
              alt={alt}
              loading="lazy"
              onClick={onOpenAttachment ? handleOpen : undefined}
              style={onOpenAttachment ? { cursor: 'zoom-in' } : undefined}
              {...props}
            />
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

