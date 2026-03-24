import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent, KeyboardEvent } from 'react';

import { ArrowUp, ChevronDown, Code2, Download, FolderPlus, Loader2, Paperclip, PanelRightClose, PanelRightOpen, Pencil, Star, Trash2, X } from 'lucide-react';
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
  onExport?: () => void;
  onNewChat?: () => void;
  onClearChat?: () => void;
  onOpenSettings?: () => void;
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
  onExport,
  onNewChat,
  onClearChat,
  onOpenSettings,
}: ChatPageProps) {
  const trimmedStatus = status.trim();
  const isInitial = messages.length === 0;
  const firstUserMessage = messages.find((message) => message.role === 'user')?.text.trim() ?? '';
  const threadTitle = firstUserMessage ? firstUserMessage.slice(0, 64) : 'New conversation';
  const formRef = useRef<HTMLFormElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const canSend = (taskPrompt.trim().length > 0 || attachedFiles.length > 0) && !sending;

  const slashCommands = useMemo(() => {
    const all = [
      { cmd: '/new', label: 'New chat', action: () => onNewChat?.() },
      { cmd: '/clear', label: 'Clear chat', action: () => onClearChat?.() },
      { cmd: '/export', label: 'Export chat', action: () => onExport?.() },
      { cmd: '/settings', label: 'Settings', action: () => onOpenSettings?.() },
    ];
    const query = taskPrompt.trim().toLowerCase();
    if (!query.startsWith('/')) return [];
    return all.filter((c) => c.cmd.startsWith(query));
  }, [taskPrompt, onNewChat, onClearChat, onExport, onOpenSettings]);

  useEffect(() => {
    setSlashMenuOpen(slashCommands.length > 0 && taskPrompt.trim().startsWith('/'));
    setSlashMenuIndex(0);
  }, [slashCommands, taskPrompt]);

  // Extract code blocks from assistant messages for the artifact panel
  const codeArtifacts = useMemo(() => {
    const blocks: { lang: string; code: string; messageIndex: number }[] = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    messages.forEach((msg, idx) => {
      if (msg.role !== 'assistant') return;
      let match: RegExpExecArray | null;
      while ((match = codeBlockRegex.exec(msg.text)) !== null) {
        blocks.push({ lang: match[1] || 'text', code: match[2].trim(), messageIndex: idx });
      }
    });
    return blocks;
  }, [messages]);

  const readTextFile = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsText(file);
    });
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files).slice(0, 5);
    const textFiles: { name: string; content: string }[] = [];
    for (const file of files) {
      if (file.size > 100_000) continue;
      const content = await readTextFile(file);
      if (content.trim()) {
        textFiles.push({ name: file.name, content: content.slice(0, 50_000) });
      }
    }
    if (textFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...textFiles].slice(0, 5));
    }
  };

  const handleSubmitWithFiles = (event: FormEvent) => {
    if (attachedFiles.length > 0) {
      const fileContext = attachedFiles
        .map((f) => `--- File: ${f.name} ---\n${f.content}\n--- End of ${f.name} ---`)
        .join('\n\n');
      const combined = taskPrompt.trim()
        ? `${taskPrompt}\n\n${fileContext}`
        : `Here are the files I'd like you to review:\n\n${fileContext}`;
      onTaskPromptChange(combined);
      setAttachedFiles([]);
      // Submit on next tick after state update
      setTimeout(() => formRef.current?.requestSubmit(), 0);
      event.preventDefault();
      return;
    }
    onSubmit(event);
  };

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
    // Slash command navigation
    if (slashMenuOpen && slashCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashMenuIndex((i) => (i + 1) % slashCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashMenuIndex((i) => (i - 1 + slashCommands.length) % slashCommands.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const cmd = slashCommands[slashMenuIndex];
        if (cmd) {
          onTaskPromptChange('');
          cmd.action();
        }
        return;
      }
      if (event.key === 'Escape') {
        setSlashMenuOpen(false);
        return;
      }
    }

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
      <section
        className="grid h-full w-full place-items-center px-6 py-8"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void handleDrop(e)}
      >
          {dragOver && (
            <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,31,28,0.08)] backdrop-blur-sm">
              <div className="rounded-2xl border-2 border-dashed border-border bg-card px-8 py-6 text-center">
                <Paperclip className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="font-sans text-sm text-foreground">Drop files to attach</p>
              </div>
            </div>
          )}
          <div className="w-full max-w-[760px]">
            <h1 className="mb-6 text-center text-[clamp(2rem,4vw,3rem)] tracking-tight text-foreground">Guten Tag, Christian</h1>

            <form
              className="relative rounded-[28px] border border-border bg-card p-4 shadow-[0_16px_34px_rgba(24,23,20,0.08)]"
              onSubmit={handleSubmitWithFiles}
              ref={formRef}
            >
              {slashMenuOpen && slashCommands.length > 0 && (
                <div className="absolute bottom-full left-4 z-20 mb-1 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                  {slashCommands.map((cmd, i) => (
                    <button
                      key={cmd.cmd}
                      type="button"
                      onClick={() => { onTaskPromptChange(''); cmd.action(); }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-sans text-sm transition ${i === slashMenuIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/70'}`}
                    >
                      <span className="font-mono text-xs">{cmd.cmd}</span>
                      <span>{cmd.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <Textarea
                value={taskPrompt}
                onChange={(event) => onTaskPromptChange(event.target.value)}
                placeholder="How can I help you today?"
                rows={2}
                onKeyDown={handleComposerKeyDown}
                aria-label="Message"
                className="min-h-[86px] resize-none border-0 bg-transparent px-0 py-1.5 font-sans text-[17px] leading-7 text-foreground shadow-none focus-visible:ring-0"
              />

              {attachedFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {attachedFiles.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 font-sans text-[11px] text-muted-foreground">
                      <Paperclip className="h-3 w-3" />
                      {f.name}
                      <button type="button" onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))} className="ml-0.5 rounded hover:bg-muted/80" aria-label={`Remove ${f.name}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
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
                    className="h-9 max-w-[240px] rounded-xl border border-border bg-background px-3 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
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
                    className="h-9 w-9 rounded-xl border-0 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-right font-sans text-[11px] text-muted-foreground">
                Press Enter to send, Shift+Enter for a new line
              </p>
            </form>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {['Writing', 'Learning', 'Code', 'Personal', "Claude's picks"].map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-md border-border bg-card px-3 font-sans text-xs text-muted-foreground"
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
    <section
      className="grid h-full w-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void handleDrop(e)}
    >
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,31,28,0.08)] backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-border bg-card px-8 py-6 text-center">
            <Paperclip className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="font-sans text-sm text-foreground">Drop files to attach</p>
          </div>
        </div>
      )}
      <header className="flex items-center justify-between px-3 py-1">
        <div className="relative" ref={headerMenuRef}>
          <button
            type="button"
            className="inline-flex h-8 max-w-[460px] items-center gap-2 rounded-md border border-border bg-background px-2.5 font-sans text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            onClick={() => setHeaderMenuOpen((open) => !open)}
            title={threadTitle}
          >
            <span className="truncate">{threadTitle}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>

          {headerMenuOpen && (
            <div className="absolute left-0 top-full z-30 mt-2 w-[224px] rounded-2xl border border-border bg-popover p-2 shadow-[0_8px_20px_rgba(18,18,16,0.14)]">
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-foreground/85 transition hover:bg-muted"
              >
                <Star className="h-4 w-4 text-muted-foreground" />
                Star
              </button>
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-foreground/85 transition hover:bg-muted"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                Rename
              </button>
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-foreground/85 transition hover:bg-muted"
              >
                <FolderPlus className="h-4 w-4 text-muted-foreground" />
                Add to project
              </button>
              {onExport && (
                <button
                  type="button"
                  onClick={() => { onExport(); setHeaderMenuOpen(false); }}
                  className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-foreground/85 transition hover:bg-muted"
                >
                  <Download className="h-4 w-4 text-muted-foreground" />
                  Export
                </button>
              )}

              <div className="my-1 h-px bg-border" />

              <button
                type="button"
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-sans text-[16px] text-destructive transition hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          )}
        </div>
        {codeArtifacts.length > 0 && (
          <button
            type="button"
            onClick={() => setArtifactPanelOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-sans text-xs text-muted-foreground transition hover:bg-muted"
            title={artifactPanelOpen ? 'Close artifacts' : 'Show code artifacts'}
          >
            {artifactPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            <Code2 className="h-3.5 w-3.5" />
            <span>{codeArtifacts.length}</span>
          </button>
        )}
      </header>

      <div className={`grid min-h-0 ${artifactPanelOpen && codeArtifacts.length > 0 ? 'grid-cols-[minmax(0,1fr)_340px]' : 'grid-cols-[minmax(0,1fr)]'} gap-0 transition-[grid-template-columns] duration-200`}>
      <ScrollArea className="h-full px-3 py-0.5">
        <div className="mx-auto grid w-full max-w-[760px] gap-4 pb-0">
          {messages.map((message) => (
            <article key={message.id} className={message.role === 'user' ? 'ml-auto w-[min(92%,620px)]' : 'w-[min(96%,760px)]'}>
              {message.role === 'user' ? (
                <p className="rounded-xl bg-muted px-4 py-3 text-right font-sans text-[15px] leading-6 text-foreground">
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
              <div className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 font-sans text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            </article>
          )}
        </div>
      </ScrollArea>

      {artifactPanelOpen && codeArtifacts.length > 0 && (
        <ScrollArea className="h-full border-l border-border px-3 py-2">
          <h3 className="mb-3 font-sans text-xs font-medium uppercase tracking-wide text-muted-foreground">Code Artifacts</h3>
          <div className="grid gap-3">
            {codeArtifacts.map((artifact, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/40">
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border">
                  <span className="font-mono text-[11px] text-muted-foreground">{artifact.lang}</span>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(artifact.code)}
                    className="font-sans text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Copy
                  </button>
                </div>
                <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[12px] leading-5 text-foreground">
                  <code>{artifact.code.length > 500 ? `${artifact.code.slice(0, 500)}...` : artifact.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
      </div>

      <div className="px-3 pb-0.5 pt-0">
        <form
          className="relative mx-auto w-full max-w-[760px] rounded-[26px] border border-border bg-card p-3.5 shadow-[0_12px_28px_rgba(24,23,20,0.08)]"
          onSubmit={handleSubmitWithFiles}
          ref={formRef}
        >
          {slashMenuOpen && slashCommands.length > 0 && (
            <div className="absolute bottom-full left-4 z-20 mb-1 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
              {slashCommands.map((cmd, i) => (
                <button
                  key={cmd.cmd}
                  type="button"
                  onClick={() => { onTaskPromptChange(''); cmd.action(); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-sans text-sm transition ${i === slashMenuIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/70'}`}
                >
                  <span className="font-mono text-xs">{cmd.cmd}</span>
                  <span>{cmd.label}</span>
                </button>
              ))}
            </div>
          )}
          <Textarea
            value={taskPrompt}
            onChange={(event) => onTaskPromptChange(event.target.value)}
            placeholder="Type your message..."
            rows={2}
            onKeyDown={handleComposerKeyDown}
            aria-label="Message"
            className="min-h-[84px] resize-none border-0 bg-transparent px-0 py-1 font-sans text-[16px] leading-7 shadow-none focus-visible:ring-0"
          />

          {attachedFiles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {attachedFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 font-sans text-[11px] text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  {f.name}
                  <button type="button" onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))} className="ml-0.5 rounded hover:bg-muted/80" aria-label={`Remove ${f.name}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" className="h-9 rounded-xl px-3 font-sans text-xs text-muted-foreground" aria-label="Add attachment">
              Context
            </Button>

            <div className="flex items-center gap-2">
              <select
                value={selectedModel}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={modelsLoading || changingModel || models.length === 0}
                className="h-9 max-w-[240px] rounded-xl border border-border bg-background px-3 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
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
                className="h-9 w-9 rounded-xl border-0 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-right font-sans text-[11px] text-muted-foreground">
            Press Enter to send, Shift+Enter for a new line
          </p>
        </form>

        <p className="mt-1 text-center font-sans text-[11px] text-muted-foreground">{trimmedStatus || 'Claude is an AI and can make mistakes. Please verify cited sources.'}</p>
      </div>
    </section>
  );
}
