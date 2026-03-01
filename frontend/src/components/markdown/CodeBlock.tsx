import { useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { MermaidBlock } from './MermaidBlock';
import { VegaLiteBlock } from './VegaLiteBlock';

function extractLanguage(className?: string): string {
  if (!className) return '';
  const match = /language-([^\s]+)/.exec(className);
  return match?.[1] || '';
}

function normalizeLanguage(language: string): string {
  return (language || '').trim().toLowerCase();
}

function languageToExtension(language: string): string {
  const lang = normalizeLanguage(language);
  switch (lang) {
    case 'js':
    case 'javascript':
      return 'js';
    case 'ts':
    case 'typescript':
      return 'ts';
    case 'jsx':
      return 'jsx';
    case 'tsx':
      return 'tsx';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'md';
    case 'yaml':
    case 'yml':
      return 'yml';
    case 'bash':
    case 'sh':
    case 'zsh':
      return 'sh';
    case 'python':
    case 'py':
      return 'py';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    case 'c':
      return 'c';
    case 'cpp':
    case 'c++':
      return 'cpp';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'sql':
      return 'sql';
    case 'mermaid':
      return 'mmd';
    case 'vega':
    case 'vega-lite':
    case 'vegalite':
      return 'json';
    default:
      return 'txt';
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function CodeBlock(props: any) {
  const { inline, className, children } = props;
  const language = normalizeLanguage(extractLanguage(className));

  const code = useMemo(() => {
    const text = String(children ?? '');
    // react-markdown often leaves a trailing newline for fenced blocks.
    return text.replace(/\n$/, '');
  }, [children]);

  const [copied, setCopied] = useState(false);

  if (inline) {
    return <code className="inline-code">{children}</code>;
  }

  if (language === 'mermaid') {
    return <MermaidBlock code={code} />;
  }

  if (language === 'vega' || language === 'vega-lite' || language === 'vegalite') {
    return <VegaLiteBlock code={code} language={language} />;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleDownload = () => {
    const ext = languageToExtension(language);
    downloadText(`snippet.${ext}`, code);
  };

  return (
    <div className="codeblock">
      <div className="codeblock-header">
        <span className="codeblock-lang">{language || 'code'}</span>
        <div className="codeblock-actions">
          <button type="button" className="codeblock-btn" onClick={handleCopy} title="Copy code">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="codeblock-btn" onClick={handleDownload} title="Download snippet">
            Download
          </button>
        </div>
      </div>
      <div className="codeblock-body">
        <SyntaxHighlighter
          language={language || undefined}
          style={vscDarkPlus as any}
          customStyle={{
            margin: 0,
            background: 'transparent',
            border: 'none',
            padding: '12px 14px',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: '1.6',
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
