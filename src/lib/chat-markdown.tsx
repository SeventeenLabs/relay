import { useState } from 'react';
import type { Components } from 'react-markdown';
import { Check, Copy } from 'lucide-react';

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace('language-', '') ?? '';
  const text = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="group relative mb-3 last:mb-0">
      {lang && (
        <div className="flex items-center justify-between rounded-t-lg bg-[rgba(31,31,28,0.12)] px-3 py-1">
          <span className="font-mono text-[11px] text-muted-foreground">{lang}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground transition hover:bg-[rgba(31,31,28,0.1)]"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <div className={`relative ${lang ? 'rounded-b-lg' : 'rounded-lg'}`}>
        {!lang && (
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-[rgba(31,31,28,0.1)]"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
        <pre className={`overflow-x-auto bg-[rgba(31,31,28,0.08)] px-3 py-2 font-mono text-[13px] leading-6 text-foreground ${lang ? 'rounded-b-lg' : 'rounded-lg'}`}>
          <code>{text}</code>
        </pre>
      </div>
    </div>
  );
}

export const chatMarkdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-semibold leading-7 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold leading-7 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold leading-6 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-3 break-words last:mb-0 [overflow-wrap:anywhere]">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-6 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-6 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="break-words leading-6 [overflow-wrap:anywhere]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 break-words border-l-2 border-[rgba(31,31,28,0.15)] pl-3 italic text-muted-foreground [overflow-wrap:anywhere]">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-[rgba(31,31,28,0.35)] underline-offset-2 hover:text-foreground">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return <code className="rounded bg-[rgba(31,31,28,0.08)] px-1 py-0.5 font-mono text-[13px] text-foreground break-all">{children}</code>;
  },
  pre: ({ children }) => {
    // If child is already a CodeBlock, render without extra wrapper
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === 'object' && 'type' in child && (child as { type?: unknown }).type === CodeBlock) {
      return <>{children}</>;
    }
    // For code blocks without a language class, wrap in CodeBlock too
    if (child && typeof child === 'object' && 'props' in child) {
      const props = (child as { props?: { className?: string; children?: React.ReactNode } }).props;
      if (props && !props.className?.includes('language-')) {
        return <CodeBlock>{props.children}</CodeBlock>;
      }
    }
    return <pre className="mb-3 last:mb-0">{children}</pre>;
  },
  table: ({ children }) => (
    <div className="mb-3 max-w-full overflow-x-auto rounded-lg border border-border last:mb-0">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top break-words [overflow-wrap:anywhere]">{children}</td>,
};
