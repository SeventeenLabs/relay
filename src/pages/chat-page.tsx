import type { FormEvent } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

import type { ChatMessage, ChatModelOption } from '@/app-types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

const markdownComponents: Components = {
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

type ChatPageProps = {
  taskPrompt: string;
  messages: ChatMessage[];
  sending: boolean;
  sessionKey: string;
  models: ChatModelOption[];
  selectedModel: string;
  modelsLoading: boolean;
  changingModel: boolean;
  status: string;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onStartNewChat: () => void;
};

export function ChatPage({
  taskPrompt,
  messages,
  sending,
  sessionKey,
  models,
  selectedModel,
  modelsLoading,
  changingModel,
  status,
  onTaskPromptChange,
  onModelChange,
  onSubmit,
  onStartNewChat,
}: ChatPageProps) {
  const trimmedStatus = status.trim();
  const isInitial = messages.length === 0;
  const firstUserMessage = messages.find((message) => message.role === 'user')?.text.trim() ?? '';
  const threadTitle = firstUserMessage ? firstUserMessage.slice(0, 64) : 'New conversation';

  if (isInitial) {
    return (
      <section className="grid h-full w-full place-items-center px-6 py-8">
          <div className="w-full max-w-[760px]">
            <h1 className="mb-6 text-center text-[clamp(2rem,4vw,3rem)] tracking-tight text-foreground">Guten Tag, Christian</h1>

            <form
              className="rounded-3xl border border-[rgba(31,31,28,0.12)] bg-[rgba(255,255,255,0.9)] p-4 shadow-[0_8px_24px_rgba(31,31,28,0.05)]"
              onSubmit={onSubmit}
            >
              <Textarea
                value={taskPrompt}
                onChange={(event) => onTaskPromptChange(event.target.value)}
                placeholder="Wie kann ich dir heute helfen?"
                rows={2}
                className="min-h-[72px] resize-none border-0 bg-transparent px-0 py-1 font-sans shadow-none focus-visible:ring-0"
              />

              <div className="mt-2 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 w-8 rounded-md p-0 font-sans text-lg"
                  aria-label="Add attachment"
                >
                  +
                </Button>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedModel}
                    onChange={(event) => onModelChange(event.target.value)}
                    disabled={modelsLoading || changingModel || models.length === 0}
                    className="h-8 max-w-[210px] rounded-md border border-[rgba(31,31,28,0.12)] bg-white px-2 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Sonnet 4.6</option>
                    {models.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    className="h-8 min-w-[84px] border-0 bg-[linear-gradient(120deg,#e5a48a,#d98765)] px-3 text-[#fffefb]"
                    type="submit"
                    disabled={sending}
                  >
                    {sending ? 'Sending...' : 'Queue'}
                  </Button>
                </div>
              </div>
            </form>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {['Schreiben', 'Lernen', 'Code', 'Privates', 'Claudes Auswahl'].map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-md border-[rgba(31,31,28,0.12)] bg-[rgba(255,255,255,0.65)] px-3 font-sans text-xs text-muted-foreground"
                >
                  {item}
                </Button>
              ))}
            </div>

            <p className="mt-3 text-center font-sans text-[11px] text-muted-foreground">{trimmedStatus || 'Connected. Ready.'}</p>
          </div>
      </section>
    );
  }

  return (
    <section className="grid h-full w-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="flex items-center justify-between border-b border-[rgba(31,31,28,0.08)] px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="max-w-[460px] truncate font-sans text-sm font-medium text-foreground">{threadTitle}</p>
          <span className="font-sans text-xs text-muted-foreground">˅</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-md px-2.5 font-sans text-[11px]"
            onClick={onStartNewChat}
          >
            New chat
          </Button>
          <button
            type="button"
            className="h-6 w-6 rounded-md border-0 bg-transparent text-sm text-muted-foreground transition hover:bg-muted"
            aria-label="Open thread actions"
          >
            ↗
          </button>
        </div>
      </header>

      <ScrollArea className="h-full px-4 py-4">
        <div className="mx-auto grid w-full max-w-[760px] gap-5 pb-3">
          {messages.map((message) => (
            <article key={message.id} className={message.role === 'user' ? 'ml-auto w-[min(92%,620px)]' : 'w-[min(96%,760px)]'}>
              {message.role === 'user' ? (
                <p className="rounded-xl bg-[rgba(228,226,217,0.9)] px-4 py-3 text-right font-sans text-[15px] leading-6 text-foreground">
                  {message.text}
                </p>
              ) : (
                <div className="font-sans text-[15px] leading-7 text-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {message.text}
                  </ReactMarkdown>
                </div>
              )}
            </article>
          ))}
        </div>
      </ScrollArea>

      <div className="px-4 pb-3 pt-1">
        <form className="mx-auto w-full max-w-[760px] rounded-3xl border border-[rgba(31,31,28,0.12)] bg-[rgba(255,255,255,0.9)] p-4 shadow-[0_8px_24px_rgba(31,31,28,0.05)]" onSubmit={onSubmit}>
          <Textarea
            value={taskPrompt}
            onChange={(event) => onTaskPromptChange(event.target.value)}
            placeholder="Antworten..."
            rows={2}
            className="min-h-[72px] resize-none border-0 bg-transparent px-0 py-1 font-sans shadow-none focus-visible:ring-0"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" className="h-8 w-8 rounded-md p-0 font-sans text-lg" aria-label="Add attachment">
              +
            </Button>

            <div className="flex items-center gap-2">
              <select
                value={selectedModel}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={modelsLoading || changingModel || models.length === 0}
                className="h-8 max-w-[210px] rounded-md border border-[rgba(31,31,28,0.12)] bg-white px-2 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Sonnet 4.5</option>
                {models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              <Button
                className="h-8 min-w-[84px] border-0 bg-[linear-gradient(120deg,#e5a48a,#d98765)] px-3 text-[#fffefb]"
                type="submit"
                disabled={sending}
              >
                {sending ? 'Sending...' : 'Queue'}
              </Button>
            </div>
          </div>
        </form>

        <p className="mt-2 text-center font-sans text-[11px] text-muted-foreground">{trimmedStatus || 'Claude ist eine KI und kann Fehler machen. Bitte ueberpruefe die zitierten Quellen.'}</p>
      </div>
    </section>
  );
}
