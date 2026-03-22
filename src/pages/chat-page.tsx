import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { ArrowUp, ChevronDown, FolderPlus, Loader2, Pencil, Star, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ChatMessage, ChatModelOption } from '@/app-types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { chatMarkdownComponents } from '@/lib/chat-markdown';

type ChatPageProps = {
  taskPrompt: string;
  messages: ChatMessage[];
  sending: boolean;
  awaitingStream: boolean;
  sessionKey: string;
  models: ChatModelOption[];
  selectedModel: string;
  modelsLoading: boolean;
  changingModel: boolean;
  status: string;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
};

export function ChatPage({
  taskPrompt,
  messages,
  sending,
  awaitingStream,
  sessionKey,
  models,
  selectedModel,
  modelsLoading,
  changingModel,
  status,
  onTaskPromptChange,
  onModelChange,
  onSubmit,
}: ChatPageProps) {
  const trimmedStatus = status.trim();
  const isInitial = messages.length === 0;
  const firstUserMessage = messages.find((message) => message.role === 'user')?.text.trim() ?? '';
  const threadTitle = firstUserMessage ? firstUserMessage.slice(0, 64) : 'New conversation';
  const formRef = useRef<HTMLFormElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const canSend = taskPrompt.trim().length > 0 && !sending;

  useEffect(() => {
    if (!headerMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!headerMenuRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (!headerMenuRef.current.contains(event.target)) {
        setHeaderMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [headerMenuOpen]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!canSend) {
      return;
    }
    formRef.current?.requestSubmit();
  };

  if (isInitial) {
    return (
      <section className="grid h-full w-full place-items-center px-6 py-8">
          <div className="w-full max-w-[760px]">
            <h1 className="mb-6 text-center text-[clamp(2rem,4vw,3rem)] tracking-tight text-foreground">Guten Tag, Christian</h1>

            <form
              className="rounded-[28px] border border-[rgba(31,31,28,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(250,248,243,0.95))] p-4 shadow-[0_16px_34px_rgba(24,23,20,0.08)]"
              onSubmit={onSubmit}
              ref={formRef}
            >
              <Textarea
                value={taskPrompt}
                onChange={(event) => onTaskPromptChange(event.target.value)}
                placeholder="Wie kann ich dir heute helfen?"
                rows={2}
                onKeyDown={handleComposerKeyDown}
                aria-label="Message"
                className="min-h-[86px] resize-none border-0 bg-transparent px-0 py-1.5 font-sans text-[17px] leading-7 text-foreground shadow-none focus-visible:ring-0"
              />

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[rgba(31,31,28,0.08)] pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 rounded-xl px-3 font-sans text-xs text-muted-foreground"
                  aria-label="Add attachment"
                >
                  Context
                </Button>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedModel}
                    onChange={(event) => onModelChange(event.target.value)}
                    disabled={modelsLoading || changingModel || models.length === 0}
                    className="h-9 max-w-[240px] rounded-xl border border-[rgba(31,31,28,0.14)] bg-white px-3 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Sonnet 4.6</option>
                    {models.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="submit"
                    size="icon"
                    aria-label={sending ? 'Sending' : 'Send message'}
                    disabled={!canSend}
                    className="h-9 w-9 rounded-xl border-0 bg-[linear-gradient(120deg,#e5a48a,#d98765)] text-[#fffefb]"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-right font-sans text-[11px] text-muted-foreground">
                Enter senden, Shift+Enter neue Zeile
              </p>
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
      <header className="flex items-center px-3 py-1">
        <div className="relative" ref={headerMenuRef}>
          <button
            type="button"
            className="inline-flex h-8 max-w-[460px] items-center gap-2 rounded-md border border-[rgba(31,31,28,0.12)] bg-white px-2.5 font-sans text-sm font-medium text-foreground transition hover:bg-[rgba(31,31,28,0.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            onClick={() => setHeaderMenuOpen((open) => !open)}
            title={threadTitle}
          >
            <span className="truncate">{threadTitle}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>

          {headerMenuOpen && (
            <div className="absolute left-0 top-full z-30 mt-2 w-[224px] rounded-2xl border border-[rgba(31,31,28,0.14)] bg-[#f7f7f7] p-2 shadow-[0_8px_20px_rgba(18,18,16,0.14)]">
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-foreground/85 transition hover:bg-[rgba(31,31,28,0.08)]"
              >
                <Star className="h-4 w-4 text-muted-foreground" />
                Markieren
              </button>
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-foreground/85 transition hover:bg-[rgba(31,31,28,0.08)]"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                Umbenennen
              </button>
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-foreground/85 transition hover:bg-[rgba(31,31,28,0.08)]"
              >
                <FolderPlus className="h-4 w-4 text-muted-foreground" />
                Zum Projekt hinzufugen
              </button>

              <div className="my-1 h-px bg-[rgba(31,31,28,0.12)]" />

              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-[#b42318] transition hover:bg-[#fbe8e8]"
              >
                <Trash2 className="h-4 w-4" />
                Loschen
              </button>
            </div>
          )}
        </div>
      </header>

      <ScrollArea className="h-full px-3 py-0.5">
        <div className="mx-auto grid w-full max-w-[760px] gap-4 pb-0">
          {messages.map((message) => (
            <article key={message.id} className={message.role === 'user' ? 'ml-auto w-[min(92%,620px)]' : 'w-[min(96%,760px)]'}>
              {message.role === 'user' ? (
                <p className="rounded-xl bg-[rgba(228,226,217,0.9)] px-4 py-3 text-right font-sans text-[15px] leading-6 text-foreground">
                  {message.text}
                </p>
              ) : (
                <div className="font-sans text-[15px] leading-7 text-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                    {message.text}
                  </ReactMarkdown>
                </div>
              )}
            </article>
          ))}

          {awaitingStream && (
            <article className="w-[min(96%,760px)]">
              <div className="inline-flex items-center gap-2 rounded-xl bg-[rgba(31,31,28,0.06)] px-3 py-2 font-sans text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            </article>
          )}
        </div>
      </ScrollArea>

      <div className="px-3 pb-0.5 pt-0">
        <form
          className="mx-auto w-full max-w-[760px] rounded-[26px] border border-[rgba(31,31,28,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(250,248,243,0.95))] p-3.5 shadow-[0_12px_28px_rgba(24,23,20,0.08)]"
          onSubmit={onSubmit}
          ref={formRef}
        >
          <Textarea
            value={taskPrompt}
            onChange={(event) => onTaskPromptChange(event.target.value)}
            placeholder="Antworten..."
            rows={2}
            onKeyDown={handleComposerKeyDown}
            aria-label="Message"
            className="min-h-[84px] resize-none border-0 bg-transparent px-0 py-1 font-sans text-[16px] leading-7 shadow-none focus-visible:ring-0"
          />

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[rgba(31,31,28,0.08)] pt-3">
            <Button type="button" variant="ghost" className="h-9 rounded-xl px-3 font-sans text-xs text-muted-foreground" aria-label="Add attachment">
              Context
            </Button>

            <div className="flex items-center gap-2">
              <select
                value={selectedModel}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={modelsLoading || changingModel || models.length === 0}
                className="h-9 max-w-[240px] rounded-xl border border-[rgba(31,31,28,0.14)] bg-white px-3 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Sonnet 4.5</option>
                {models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                size="icon"
                aria-label={sending ? 'Sending' : 'Send message'}
                disabled={!canSend}
                className="h-9 w-9 rounded-xl border-0 bg-[linear-gradient(120deg,#e5a48a,#d98765)] text-[#fffefb]"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-right font-sans text-[11px] text-muted-foreground">
            Enter senden, Shift+Enter neue Zeile
          </p>
        </form>

        <p className="mt-1 text-center font-sans text-[11px] text-muted-foreground">{trimmedStatus || 'Claude ist eine KI und kann Fehler machen. Bitte ueberpruefe die zitierten Quellen.'}</p>
      </div>
    </section>
  );
}
