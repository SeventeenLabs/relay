import type { Components } from 'react-markdown';

export const chatMarkdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-semibold leading-7 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold leading-7 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold leading-6 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-6 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-6 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-[rgba(31,31,28,0.15)] pl-3 italic text-muted-foreground">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-[rgba(31,31,28,0.35)] underline-offset-2 hover:text-foreground">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-');

    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-[rgba(31,31,28,0.08)] px-3 py-2 font-mono text-[13px] leading-6 text-foreground">
          {children}
        </code>
      );
    }

    return <code className="rounded bg-[rgba(31,31,28,0.08)] px-1 py-0.5 font-mono text-[13px] text-foreground">{children}</code>;
  },
  pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,
};
