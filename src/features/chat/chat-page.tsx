import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent, KeyboardEvent } from 'react';

import { ArrowUp, ChevronDown, ChevronRight, Code2, Download, Ellipsis, FolderPlus, Loader2, Mic, Paperclip, PanelRightClose, PanelRightOpen, Pencil, Plus, Star, Trash2, WifiOff, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ChatMessage, ChatModelOption, FileChangeSummary } from '@/app-types';
import { FileChangeSummaryCard } from '@/components/chat/file-change-summary';
import { Button } from '@/components/ui/button';
import { TokenBadge } from '@/components/ui/token-badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { chatMarkdownComponents } from '@/lib/chat-markdown';

type ChatPageProps = {
  taskPrompt: string;
  messages: ChatMessage[];
  sending: boolean;
  awaitingStream: boolean;
  sessionKey: string;
  userDisplayName?: string;
  models: ChatModelOption[];
  selectedModel: string;
  modelsLoading: boolean;
  changingModel: boolean;
  gatewayConnected: boolean;
  status: string;
  fileChangeSummary?: FileChangeSummary | null;
  undoingFileChanges?: boolean;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onStop?: () => void;
  onExport?: () => void;
  onNewChat?: () => void;
  onClearChat?: () => void;
  onOpenSettings?: () => void;
  onOpenGatewaySettings?: () => void;
  onUndoFileChanges?: () => void;
  onReviewFileChanges?: () => void;
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 100_000;
const MAX_ATTACHMENT_CONTENT_CHARS = 50_000;
const COMPOSER_EXTRA_BOTTOM_SPACE = 16;
const HEADER_OVERLAY_HEIGHT = 44;
const CHAT_COLUMN_MAX_WIDTH = 760;
const COMPOSER_COLUMN_MAX_WIDTH = 920;
const DEFAULT_MODEL_FALLBACK_LABEL = 'Server default';
const CODEX_SUGGESTIONS = [
  'Review my latest commits for correctness and maintainability issues',
  'Help me unblock my latest open PR',
  'Connect my favorite apps with Codex',
] as const;

export function ChatPage({
  taskPrompt,
  messages,
  sending,
  awaitingStream,
  sessionKey,
  userDisplayName,
  models,
  selectedModel,
  modelsLoading,
  changingModel,
  gatewayConnected,
  status,
  fileChangeSummary,
  undoingFileChanges = false,
  onTaskPromptChange,
  onModelChange,
  onSubmit,
  onStop,
  onExport,
  onNewChat,
  onClearChat,
  onOpenSettings,
  onOpenGatewaySettings,
  onUndoFileChanges,
  onReviewFileChanges,
}: ChatPageProps) {
  const trimmedStatus = status.trim();
  const isInitial = messages.length === 0;
  const firstUserMessage = messages.find((message) => message.role === 'user')?.text.trim() ?? '';
  const threadTitle = firstUserMessage ? firstUserMessage.slice(0, 64) : 'New conversation';
  const formRef = useRef<HTMLFormElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [greetingNow, setGreetingNow] = useState(() => new Date());
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [composerDockHeight, setComposerDockHeight] = useState(170);
  const [activeWorkStartedAt, setActiveWorkStartedAt] = useState<number | null>(null);
  const [elapsedWorkSeconds, setElapsedWorkSeconds] = useState(0);
  const canSend = (taskPrompt.trim().length > 0 || attachedFiles.length > 0) && !sending && gatewayConnected;
  const hasModelChoices = models.length > 0;
  const modelSelectDisabled = modelsLoading || changingModel || !hasModelChoices;
  const selectedModelLabel = useMemo(
    () => models.find((model) => model.value === selectedModel)?.label ?? '',
    [models, selectedModel],
  );
  const modelStatusLabel = modelsLoading
    ? 'Loading models'
    : changingModel
      ? 'Switching model'
      : selectedModelLabel || DEFAULT_MODEL_FALLBACK_LABEL;
  const assistantActivityLabel = sending
    ? 'Thinking...'
    : awaitingStream
      ? 'Working...'
      : '';
  const composerBottomInset = composerDockHeight + COMPOSER_EXTRA_BOTTOM_SPACE;
  const isWorking = sending || awaitingStream;
  const workStatusLabel = isWorking ? `${Math.floor(elapsedWorkSeconds / 60)}m ${elapsedWorkSeconds % 60}s lang bearbeitet` : '';

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'auto') => {
    const viewport = messageViewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  };

  const greetingTitle = useMemo(() => {
    const hour = greetingNow.getHours();
    const normalizedName = userDisplayName?.trim() || 'there';

    const dayPart =
      hour < 5 ? 'Good night' :
      hour < 12 ? 'Good morning' :
      hour < 18 ? 'Good afternoon' :
      'Good evening';

    return `${dayPart}, ${normalizedName}`;
  }, [greetingNow, userDisplayName]);

  const slashCommands = useMemo(() => {
    const all = [
      { cmd: '/new', label: 'New chat', action: () => onNewChat?.() },
      { cmd: '/reset', label: 'Reset chat', action: () => onNewChat?.() },
      { cmd: '/status', label: 'Show status', action: () => onTaskPromptChange('/status') },
      { cmd: '/stop', label: 'Stop response', action: () => onTaskPromptChange('/stop') },
      { cmd: '/provider', label: 'Provider info', action: () => onTaskPromptChange('/provider') },
      { cmd: '/model', label: 'Use model dropdown', action: () => onTaskPromptChange('/model') },
      { cmd: '/help', label: 'Show commands', action: () => onTaskPromptChange('/help') },
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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setGreetingNow(new Date());
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (isWorking) {
      setActiveWorkStartedAt((current) => current ?? Date.now());
      return;
    }
    setActiveWorkStartedAt(null);
    setElapsedWorkSeconds(0);
  }, [isWorking]);

  useEffect(() => {
    if (!activeWorkStartedAt) {
      return;
    }
    const update = () => setElapsedWorkSeconds(Math.max(0, Math.floor((Date.now() - activeWorkStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeWorkStartedAt]);

  useEffect(() => {
    const dock = composerDockRef.current;
    if (!dock) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.ceil(dock.getBoundingClientRect().height);
      if (nextHeight > 0) {
        setComposerDockHeight(nextHeight);
      }
    };

    updateHeight();

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(dock);

    window.addEventListener('resize', updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

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
    const files = Array.from(event.dataTransfer.files).slice(0, MAX_ATTACHMENTS);
    const textFiles: { name: string; content: string }[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) continue;
      const content = await readTextFile(file);
      if (content.trim()) {
        textFiles.push({ name: file.name, content: content.slice(0, MAX_ATTACHMENT_CONTENT_CHARS) });
      }
    }
    if (textFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...textFiles].slice(0, MAX_ATTACHMENTS));
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

  useEffect(() => {
    autoScrollEnabledRef.current = true;
    setShowJumpToLatest(false);
    window.requestAnimationFrame(() => scrollMessagesToBottom('auto'));
  }, [sessionKey]);

  useEffect(() => {
    if (!autoScrollEnabledRef.current) {
      return;
    }

    const behavior: ScrollBehavior = messages.length <= 1 ? 'auto' : 'smooth';
    window.requestAnimationFrame(() => scrollMessagesToBottom(behavior));
  }, [messages, awaitingStream]);

  if (!gatewayConnected) {
    return (
      <section className="grid h-full w-full place-items-center p-6">
        <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted">
            <WifiOff className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Chat is offline</h2>
          <p className="mt-2 font-sans text-sm text-muted-foreground">
            Connect the gateway to continue chatting.
          </p>
          <Button type="button" className="mt-4" onClick={() => (onOpenGatewaySettings ?? onOpenSettings)?.()}>
            Open Gateway Settings
          </Button>
        </div>
      </section>
    );
  }

  const handleMessageViewportScroll = () => {
    const viewport = messageViewportRef.current;
    if (!viewport) {
      return;
    }

    const thresholdPx = 80;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceFromBottom <= thresholdPx;

    autoScrollEnabledRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  };

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

  const renderSlashCommandMenu = () => {
    if (!slashMenuOpen || slashCommands.length === 0) {
      return null;
    }

    return (
      <div className="absolute bottom-full left-4 z-20 mb-1 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
        {slashCommands.map((cmd, i) => (
          <button
            key={cmd.cmd}
            type="button"
            onClick={() => {
              onTaskPromptChange('');
              cmd.action();
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-sans text-sm transition ${i === slashMenuIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/70'}`}
          >
            <span className="font-mono text-xs">{cmd.cmd}</span>
            <span>{cmd.label}</span>
          </button>
        ))}
      </div>
    );
  };

  const renderAttachedFiles = () => {
    if (attachedFiles.length === 0) {
      return null;
    }

    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {attachedFiles.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 font-sans text-[11px] text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            {f.name}
            <button
              type="button"
              onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
              className="ml-0.5 rounded hover:bg-muted/80"
              aria-label={`Remove ${f.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    );
  };

  if (isInitial) {
    return (
      <section
        className="relative grid h-full w-full min-h-0 content-center px-3 pb-2 pt-4"
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
          <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/95 px-3 py-1 backdrop-blur">
            <div className="relative" ref={headerMenuRef}>
              <button
                type="button"
                className="inline-flex h-8 max-w-[460px] items-center gap-2 rounded-md border border-border bg-background px-2.5 font-sans text-sm font-medium text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-haspopup="menu"
                aria-expanded={headerMenuOpen}
                onClick={() => setHeaderMenuOpen((open) => !open)}
                title={threadTitle}
              >
                <span className="truncate">{threadTitle}</span>
                <Ellipsis className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {workStatusLabel ? (
                <span className="font-sans text-sm text-muted-foreground">{workStatusLabel}</span>
              ) : null}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </header>
          <div className="mx-auto min-h-0 w-full pt-10" style={{ maxWidth: `${COMPOSER_COLUMN_MAX_WIDTH}px` }}>
              <h1 className="mb-6 text-center text-[clamp(2rem,4vw,3rem)] tracking-tight text-foreground">{greetingTitle}</h1>

              <form
                className="relative mx-auto w-full rounded-[24px] border border-border/80 bg-card/98 p-3 shadow-[0_14px_34px_rgba(24,23,20,0.10)]"
                onSubmit={handleSubmitWithFiles}
                ref={formRef}
              >
                {renderSlashCommandMenu()}
                <Textarea
                  value={taskPrompt}
                  onChange={(event) => onTaskPromptChange(event.target.value)}
                  placeholder="Ask Relay anything. Use @ to mention files or tools."
                  rows={2}
                  onKeyDown={handleComposerKeyDown}
                  aria-label="Message"
                  className="min-h-[82px] max-h-[40vh] resize-none border-0 bg-transparent px-1 py-1.5 font-sans text-[16px] leading-7 text-foreground shadow-none focus-visible:ring-0"
                />

                {renderAttachedFiles()}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
                  <div className="flex items-center gap-1.5">
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" title="Attach files">
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full px-2.5 font-sans text-xs text-orange-500" title="Full access mode">
                      Vollzugriff
                      <ChevronDown className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <select
                      value={hasModelChoices ? selectedModel : ''}
                      onChange={(event) => onModelChange(event.target.value)}
                      disabled={modelSelectDisabled}
                      aria-label="Model selection"
                      className="h-8 max-w-[240px] rounded-full border border-border/70 bg-background px-3 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {modelsLoading ? <option value="">Loading models...</option> : null}
                      {!modelsLoading && !hasModelChoices ? <option value="">No models available</option> : null}
                      {!modelsLoading && hasModelChoices ? <option value="">{DEFAULT_MODEL_FALLBACK_LABEL}</option> : null}
                      {!modelsLoading && hasModelChoices
                        ? models.map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.label}
                          </option>
                        ))
                        : null}
                    </select>
                    <span className="font-sans text-xs text-muted-foreground">{modelStatusLabel}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-muted-foreground" title="Voice input">
                      <Mic className="h-4 w-4" />
                    </Button>
                    <Button
                      type={sending ? 'button' : 'submit'}
                      size="icon"
                      aria-label={sending ? 'Stop response' : 'Send message'}
                      disabled={sending ? false : !canSend}
                      className="h-8 w-8 rounded-full border-0 bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={sending ? () => onStop?.() : undefined}
                    >
                      {sending ? <X className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </form>

              <div className="mt-4 w-full rounded-2xl border border-border/60 bg-card/30 px-3 py-2">
                {CODEX_SUGGESTIONS.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    className={`flex w-full items-center gap-2 py-2 text-left font-sans text-sm text-muted-foreground transition hover:text-foreground ${index < CODEX_SUGGESTIONS.length - 1 ? 'border-b border-border/50' : ''}`}
                    onClick={() => onTaskPromptChange(item)}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    <span>{item}</span>
                  </button>
                ))}
              </div>

              <p className="mt-3 text-center font-sans text-[11px] text-muted-foreground">
                {assistantActivityLabel ? `${assistantActivityLabel} ${trimmedStatus}`.trim() : (trimmedStatus || 'Connected. Ready.')}
              </p>
          </div>
      </section>
    );
  }

  return (
    <section
      className="relative h-full w-full min-h-0"
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
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/95 px-3 py-1 backdrop-blur">
        <div className="relative" ref={headerMenuRef}>
          <button
            type="button"
            className="inline-flex h-8 max-w-[460px] items-center gap-2 rounded-md border border-border bg-background px-2.5 font-sans text-sm font-medium text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            onClick={() => setHeaderMenuOpen((open) => !open)}
            title={threadTitle}
          >
            <span className="truncate">{threadTitle}</span>
            <Ellipsis className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
        <div className="flex items-center gap-2">
          {workStatusLabel ? (
            <span className="font-sans text-sm text-muted-foreground">{workStatusLabel}</span>
          ) : null}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </header>

      <div className={`grid h-full min-h-0 ${artifactPanelOpen && codeArtifacts.length > 0 ? 'grid-cols-[minmax(0,1fr)_340px]' : 'grid-cols-[minmax(0,1fr)]'} gap-0 transition-[grid-template-columns] duration-200`}>
      <div className="relative min-h-0">
        <div
          ref={messageViewportRef}
          onScroll={handleMessageViewportScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="h-full overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-1"
        >
        <div
          className="mx-auto grid w-full gap-4 pb-4"
          style={{
            maxWidth: `${CHAT_COLUMN_MAX_WIDTH}px`,
            paddingTop: `${HEADER_OVERLAY_HEIGHT + 8}px`,
            paddingBottom: `calc(${composerBottomInset}px + env(safe-area-inset-bottom))`,
          }}
        >
          {messages.map((message) => (
            <article key={message.id} className={message.role === 'user' ? 'ml-auto min-w-0 w-[min(92%,620px)]' : 'min-w-0 w-full'}>
              {message.role === 'user' ? (
                <p className="break-words rounded-xl bg-muted px-4 py-3 text-right font-sans text-[15px] leading-6 text-foreground [overflow-wrap:anywhere]">
                  {message.text}
                </p>
              ) : (
                <div className="min-w-0">
                  <div className="font-sans text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                      {message.text}
                    </ReactMarkdown>
                  </div>
                  {message.role === 'assistant' && (
                    <TokenBadge usage={message.usage} text={message.usage ? undefined : message.text} />
                  )}
                </div>
              )}
            </article>
          ))}

          {(sending || awaitingStream) && (
            <article className="w-full">
              <div className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 font-sans text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {assistantActivityLabel || 'Thinking...'}
              </div>
            </article>
          )}
          <div ref={messageEndRef} className="h-px w-full" />
        </div>
        </div>
        {fileChangeSummary && onUndoFileChanges && onReviewFileChanges ? (
          <div className="absolute right-3 bottom-0 left-3 z-20">
            <div className="mx-auto w-full pb-2" style={{ maxWidth: `${CHAT_COLUMN_MAX_WIDTH}px` }}>
              <FileChangeSummaryCard
                summary={fileChangeSummary}
                undoing={undoingFileChanges}
                onUndo={onUndoFileChanges}
                onReview={onReviewFileChanges}
              />
            </div>
          </div>
        ) : null}
        {showJumpToLatest && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="absolute right-5 z-20 h-9 w-9 rounded-full border-border bg-card text-muted-foreground shadow-md hover:bg-muted"
            style={{ bottom: `calc(${composerBottomInset - 12}px + env(safe-area-inset-bottom))` }}
            onClick={() => {
              autoScrollEnabledRef.current = true;
              setShowJumpToLatest(false);
              const viewport = messageViewportRef.current;
              if (viewport) {
                viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
                return;
              }
              scrollMessagesToBottom('smooth');
            }}
            aria-label="Jump to latest message"
            title="Jump to latest"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        )}
      </div>

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

      <div
        ref={composerDockRef}
        className="pointer-events-none absolute right-0 bottom-0 left-0 z-30 px-3 pb-0 pt-2"
      >
        <div className="pointer-events-auto mx-auto w-full" style={{ maxWidth: `${COMPOSER_COLUMN_MAX_WIDTH}px` }}>
        <form
          className="relative mx-auto w-full rounded-[24px] border border-border/80 bg-card p-3 shadow-[0_14px_34px_rgba(24,23,20,0.10)]"
          onSubmit={handleSubmitWithFiles}
          ref={formRef}
        >
          {renderSlashCommandMenu()}
          <Textarea
            value={taskPrompt}
            onChange={(event) => onTaskPromptChange(event.target.value)}
            placeholder="Ask Relay anything. Use @ to mention files or tools."
            rows={2}
            onKeyDown={handleComposerKeyDown}
            aria-label="Message"
            className="min-h-[82px] max-h-[40vh] resize-none border-0 bg-transparent px-1 py-1 font-sans text-[16px] leading-7 shadow-none focus-visible:ring-0"
          />

          {renderAttachedFiles()}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
            <div className="flex items-center gap-1.5">
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" title="Attach files">
                <Plus className="h-4 w-4" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full px-2.5 font-sans text-xs text-orange-500" title="Full access mode">
                Vollzugriff
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <select
                value={hasModelChoices ? selectedModel : ''}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={modelSelectDisabled}
                aria-label="Model selection"
                className="h-8 max-w-[240px] rounded-full border border-border/70 bg-background px-3 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelsLoading ? <option value="">Loading models...</option> : null}
                {!modelsLoading && !hasModelChoices ? <option value="">No models available</option> : null}
                {!modelsLoading && hasModelChoices ? <option value="">{DEFAULT_MODEL_FALLBACK_LABEL}</option> : null}
                {!modelsLoading && hasModelChoices
                  ? models.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))
                  : null}
              </select>
              <span className="font-sans text-xs text-muted-foreground">{modelStatusLabel}</span>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-muted-foreground" title="Voice input">
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                type={sending ? 'button' : 'submit'}
                size="icon"
                aria-label={sending ? 'Stop response' : 'Send message'}
                disabled={sending ? false : !canSend}
                className="h-8 w-8 rounded-full border-0 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={sending ? () => onStop?.() : undefined}
              >
                {sending ? <X className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </form>

        <p className="mt-2 text-center font-sans text-[11px] text-muted-foreground" aria-live="polite">
          {trimmedStatus || (gatewayConnected ? 'Connected. Ready.' : 'Gateway disconnected. Chat is paused.')}
        </p>
        </div>
      </div>
    </section>
  );
}
