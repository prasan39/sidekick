import { useRef, useState } from 'react';

function getTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

let mermaidInitializedTheme: 'dark' | 'light' | null = null;
let mermaidApi: any | null = null;

async function getMermaid() {
  if (mermaidApi) return mermaidApi;
  const mod: any = await import('mermaid');
  mermaidApi = mod?.default ?? mod;
  return mermaidApi;
}

function sanitizeMermaidCode(code: string): string {
  let sanitized = code.trim();
  
  // Remove any extra whitespace lines
  sanitized = sanitized.split('\n').filter(line => line.trim().length > 0).join('\n');
  
  // Fix malformed brackets: [No| should be [No]
  sanitized = sanitized.replace(/\[([^\]]+)\|\s*/g, '[$1] ');
  
  // Fix pattern: NODE --> [Label Node should be NODE -->|Label| Node
  sanitized = sanitized.replace(/-->\s*\[([^\]]+)\]\s+(\w+)/g, ' -->|$1| $2');
  
  // Fix pattern: NODE -- LABEL --> NODE[...] or NODE -- LABEL --> NODE
  sanitized = sanitized.replace(/(\w+)\s+--\s+([^-\n>]+?)\s+-->\s*(\S+)/g, '$1 -->|$2| $3');
  
  // Fix pattern: NODE -- LABEL -- NODE (double dash)
  sanitized = sanitized.replace(/(\w+)\s+--\s+([^-\n]+?)\s+--\s+(\w+)/g, '$1 -->|$2| $3');
  
  // Fix spacing around pipes
  sanitized = sanitized.replace(/-->\s*\|\s*/g, '-->|');
  sanitized = sanitized.replace(/\s*\|\s*-->/g, '|-->');
  
  // Replace multiple consecutive dashes with proper arrow
  sanitized = sanitized.replace(/(-{3,})>/g, '-->');
  
  // Fix spacing around arrows
  sanitized = sanitized.replace(/\s+-->\s+/g, ' --> ');
  
  // Remove trailing spaces
  sanitized = sanitized.split('\n').map(line => line.trimEnd()).join('\n');
  
  return sanitized;
}

async function ensureMermaidInitialized(theme: 'dark' | 'light') {
  const m = await getMermaid();
  if (mermaidInitializedTheme === theme) return m;
  m.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'light' ? 'default' : 'dark',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'linear',
    },
  });
  mermaidInitializedTheme = theme;
  return m;
}

function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function MermaidBlock({ code }: { code: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const theme = getTheme();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleDownloadSource = () => {
    downloadText('diagram.mmd', code);
  };

  const handleDownloadSvg = () => {
    if (!svg) return;
    downloadText('diagram.svg', svg, 'image/svg+xml;charset=utf-8');
  };

  const render = async () => {
    setError(null);
    setIsRendering(true);
    try {
      const m = await ensureMermaidInitialized(theme);
      
      // Sanitize the code to fix common syntax issues
      const sanitizedCode = sanitizeMermaidCode(code);
      
      // Create a unique ID for this render
      const uniqueId = `mmd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      try {
        // Call mermaid.render directly with the code
        const result = await m.render(uniqueId, sanitizedCode);
        const rawSvg = result.svg;
        
        // Mermaid-generated SVGs are safe, so we can use them directly
        // DOMPurify was stripping text elements, so we skip it for SVGs
        setSvg(rawSvg);
        setIsOpen(true);
      } catch (err) {
        throw err;
      }
    } catch (err) {
      setSvg(null);
      setIsOpen(false);
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Try to provide helpful hint based on error
      let hint = '';
      if (errorMessage.includes('suitable point')) {
        hint = ' Hint: Check for malformed arrows or node connections.';
      }
      setError(errorMessage + hint);
      console.error('Mermaid render error:', {
        error: errorMessage,
        originalCode: code,
        sanitizedCode: sanitizeMermaidCode(code),
      });
    } finally {
      setIsRendering(false);
    }
  };

  const toggle = async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (svg) {
      setIsOpen(true);
      return;
    }
    await render();
  };

  return (
    <div className="codeblock codeblock-mermaid">
      <div className="codeblock-header">
        <span className="codeblock-lang">mermaid</span>
        <div className="codeblock-actions">
          <button type="button" className="codeblock-btn" onClick={handleCopy} title="Copy Mermaid source">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="codeblock-btn" onClick={handleDownloadSource} title="Download Mermaid source">
            Download
          </button>
          <button type="button" className="codeblock-btn" onClick={toggle} disabled={isRendering} title="Render diagram">
            {isOpen ? 'Hide' : isRendering ? 'Rendering…' : 'Render'}
          </button>
          {svg && (
            <button type="button" className="codeblock-btn" onClick={handleDownloadSvg} title="Download SVG">
              SVG
            </button>
          )}
        </div>
      </div>

      <div className="codeblock-body">
        <pre className="codeblock-pre"><code>{code}</code></pre>
      </div>

      <div ref={containerRef} style={{ display: 'none' }} />

      {error && (
        <div className="codeblock-error">
          Mermaid render failed: {error}
        </div>
      )}

      {isOpen && svg && (
        <div className="diagram-wrapper" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}
