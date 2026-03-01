import { useEffect, useMemo, useRef, useState } from 'react';

function getTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function containsDataUrl(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;

  const obj = node as Record<string, unknown>;
  const data = obj['data'];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(d, 'url')) return true;
  }

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (containsDataUrl(v)) return true;
  }
  return false;
}

function applyThemeDefaults(spec: any, theme: 'dark' | 'light') {
  if (!spec || typeof spec !== 'object') return spec;
  const out = { ...spec };
  out.background = out.background ?? 'transparent';
  if (theme === 'dark') {
    out.config = out.config ?? {};
    out.config.axis = {
      labelColor: '#e0e0e0',
      titleColor: '#ffffff',
      gridColor: 'rgba(255,255,255,0.08)',
      domainColor: 'rgba(255,255,255,0.12)',
      tickColor: 'rgba(255,255,255,0.12)',
      ...out.config.axis,
    };
    out.config.legend = {
      labelColor: '#e0e0e0',
      titleColor: '#ffffff',
      ...out.config.legend,
    };
    out.config.title = {
      color: '#ffffff',
      ...out.config.title,
    };
    out.config.view = {
      stroke: 'transparent',
      ...out.config.view,
    };
  } else {
    out.config = out.config ?? {};
    out.config.view = {
      stroke: 'transparent',
      ...out.config.view,
    };
  }
  return out;
}

export function VegaLiteBlock({ code, language }: { code: string; language: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);

  const theme = getTheme();
  const source = useMemo(() => code.replace(/\n$/, ''), [code]);

  useEffect(() => {
    return () => {
      try {
        viewRef.current?.finalize?.();
      } catch {
        // ignore
      }
      viewRef.current = null;
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleDownload = () => {
    downloadText('chart.json', source);
  };

  const clear = () => {
    try {
      viewRef.current?.finalize?.();
    } catch {
      // ignore
    }
    viewRef.current = null;
    if (containerRef.current) containerRef.current.innerHTML = '';
  };

  const render = async () => {
    setError(null);
    setIsRendering(true);
    try {
      // Make the container visible before embedding so Vega can measure layout.
      setIsOpen(true);
      const [{ default: vegaEmbed }, json5Mod] = await Promise.all([
        import('vega-embed'),
        import('json5'),
      ]);
      const JSON5: any = (json5Mod as any)?.default ?? json5Mod;
      const parsed = JSON5.parse(source) as any;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid Vega/Vega-Lite spec.');
      }
      if (containsDataUrl(parsed)) {
        throw new Error('Blocked: spec contains data.url. Use inline data.values instead.');
      }

      const themed = applyThemeDefaults(parsed as any, theme);
      if (!containerRef.current) {
        throw new Error('Missing chart container.');
      }

      clear();
      const result = await vegaEmbed(containerRef.current, themed as any, {
        actions: false,
        renderer: 'svg',
      });
      viewRef.current = result.view;
    } catch (err) {
      clear();
      setIsOpen(false);
      setError(String(err));
    } finally {
      setIsRendering(false);
    }
  };

  const toggle = async () => {
    if (isOpen) {
      setIsOpen(false);
      clear();
      return;
    }
    await render();
  };

  return (
    <div className="codeblock codeblock-vega">
      <div className="codeblock-header">
        <span className="codeblock-lang">{language}</span>
        <div className="codeblock-actions">
          <button type="button" className="codeblock-btn" onClick={handleCopy} title="Copy chart spec">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="codeblock-btn" onClick={handleDownload} title="Download JSON spec">
            Download
          </button>
          <button type="button" className="codeblock-btn" onClick={toggle} disabled={isRendering} title="Render chart">
            {isOpen ? 'Hide' : isRendering ? 'Rendering…' : 'Render'}
          </button>
        </div>
      </div>

      <div className="codeblock-body">
        <pre className="codeblock-pre"><code>{source}</code></pre>
      </div>

      {error && (
        <div className="codeblock-error">
          Chart render failed: {error}
        </div>
      )}

      <div
        className="diagram-wrapper diagram-wrapper-chart"
        ref={containerRef}
        style={isOpen ? undefined : { display: 'none' }}
      />
    </div>
  );
}
