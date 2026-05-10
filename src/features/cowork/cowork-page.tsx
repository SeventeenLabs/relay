import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { ArrowUp, ChevronDown, ChevronRight, Ellipsis, FileText, FolderOpen, Globe, Loader2, MessageSquare, Play, Plus, Shield, Square, WifiOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ChatMessage,
  ChatModelOption,
  FileChangeSummary,
  CoworkArtifact,
  CoworkProgressStep,
  CoworkProjectTask,
  CoworkRunPhase,
  PendingApprovalAction,
  ProjectPathReference,
} from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileChangeSummaryCard } from '@/components/chat/file-change-summary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Menu, MenuGroup, MenuItem } from '@/components/ui/menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { chatMarkdownComponents } from '@/lib/chat-markdown';
import {
  approvalRiskClasses,
  extractInlineActivityCards,
  isSystemLikeMessage,
  taskStatusClasses,
  taskStatusLabel,
} from './cowork-utils';

type CoworkPageProps = {
  projectTitle: string;
  projectSelected: boolean;
  projectInstructions: string;
  scheduledCount: number;
  canRerunLastTask: boolean;
  taskPrompt: string;
  messages: ChatMessage[];
  rightPanelOpen: boolean;
  awaitingStream: boolean;
  artifacts: CoworkArtifact[];
  onOpenArtifact: (artifact: CoworkArtifact) => void;
  onScheduleRun: () => void;
  onRerunLastTask: () => void;
  selectedModel: string;
  models: ChatModelOption[];
  modelsLoading: boolean;
  changingModel: boolean;
  pendingApprovals: PendingApprovalAction[];
  projectTasks: CoworkProjectTask[];
  runPhase: CoworkRunPhase;
  progressSteps: CoworkProgressStep[];
  sending: boolean;
  gatewayConnected: boolean;
  webSearchEnabled: boolean;
  approvalMode: 'standard' | 'project' | 'none';
  projectPathReferences: ProjectPathReference[];
  contextWindowUsedTokens: number;
  contextWindowTotalTokens: number;
  onOpenGatewaySettings: () => void;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  onApprovalModeChange: (mode: 'standard' | 'project' | 'none') => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onApprovePendingAction: (approvalId: string) => void;
  onRejectPendingAction: (approvalId: string, reason: string) => void;
  fileChangeSummary?: FileChangeSummary | null;
  undoingFileChanges?: boolean;
  onUndoFileChanges?: () => void;
  onReviewFileChanges?: () => void;
};

const COWORK_DEFAULT_MODEL_LABEL = 'Server default';
const MODEL_VALUE_SEPARATOR = '::';
const MENTION_TOKEN_PATTERN = /@project:"[^"]+"/g;
const COWORK_IDEA_CARDS = [
  {
    icon: FileText,
    title: 'Research a topic',
    prompt: 'Research this topic and give me a concise report with key findings and sources:',
  },
  {
    icon: FolderOpen,
    title: 'Summarize project files',
    prompt: 'Summarize the important files in this project and highlight what changed recently.',
  },
  {
    icon: Shield,
    title: 'Plan implementation',
    prompt: 'Create an implementation plan for this feature, including steps, risks, and rollout notes:',
  },
] as const;

export function CoworkPage({
  projectTitle,
  projectSelected,
  projectInstructions,
  scheduledCount,
  canRerunLastTask,
  taskPrompt,
  messages,
  rightPanelOpen,
  awaitingStream,
  artifacts,
  onOpenArtifact,
  onScheduleRun,
  onRerunLastTask,
  selectedModel,
  models,
  modelsLoading,
  changingModel,
  pendingApprovals,
  projectTasks,
  runPhase,
  progressSteps,
  sending,
  gatewayConnected,
  webSearchEnabled,
  approvalMode,
  projectPathReferences,
  contextWindowUsedTokens,
  contextWindowTotalTokens,
  onOpenGatewaySettings,
  onTaskPromptChange,
  onModelChange,
  onWebSearchEnabledChange,
  onApprovalModeChange,
  onSubmit,
  onApprovePendingAction,
  onRejectPendingAction,
  fileChangeSummary,
  undoingFileChanges = false,
  onUndoFileChanges,
  onReviewFileChanges,
}: CoworkPageProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const composerEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const taskPromptId = useId();
  const approvalsHeadingId = useId();
  const workspaceCardBodyId = useId();
  const [expandedInlineActivityId, setExpandedInlineActivityId] = useState<string | null>(null);
  const [workspaceCardCollapsed, setWorkspaceCardCollapsed] = useState(false);
  const [approvalRejectReasons, setApprovalRejectReasons] = useState<Record<string, string>>({});
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionMenuIndex, setMentionMenuIndex] = useState(0);
  const [composerText, setComposerText] = useState(taskPrompt);
  const [openDropdown, setOpenDropdown] = useState<'model' | 'effort' | 'approvals' | null>(null);
  const [modelProviderFilter, setModelProviderFilter] = useState<string>('all');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [effortLevel, setEffortLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [activeWorkStartedAt, setActiveWorkStartedAt] = useState<number | null>(null);
  const [elapsedWorkSeconds, setElapsedWorkSeconds] = useState(0);
  const shouldAutoScrollRef = useRef(true);
  const canSend = composerText.trim().length > 0 && !sending && gatewayConnected;
  const hasModelChoices = models.length > 0;
  const modelDropdownDisabled = modelsLoading || changingModel || !hasModelChoices;
  const parsedModels = useMemo(() => {
    return models.map((option) => {
      const rawValue = option.value.trim();
      const separatorIndex = rawValue.indexOf(MODEL_VALUE_SEPARATOR);
      let provider = 'unknown';
      let modelId = rawValue;

      if (separatorIndex > 0 && separatorIndex < rawValue.length - MODEL_VALUE_SEPARATOR.length) {
        provider = rawValue.slice(0, separatorIndex).trim() || 'unknown';
        modelId = rawValue.slice(separatorIndex + MODEL_VALUE_SEPARATOR.length).trim() || rawValue;
      } else {
        const labelMatch = option.label.match(/\(([^)]+)\)\s*$/);
        if (labelMatch?.[1]) {
          provider = labelMatch[1].trim().toLowerCase();
        }
      }

      return {
        ...option,
        provider,
        modelId,
      };
    });
  }, [models]);
  const selectedModelOption = parsedModels.find((model) => model.value === selectedModel) ?? null;
  const selectedModelLabel = selectedModelOption ? `${selectedModelOption.modelId} (${selectedModelOption.provider})` : '';
  const modelProviderBuckets = useMemo(() => {
    const buckets = new Map<string, typeof parsedModels>();
    for (const item of parsedModels) {
      const key = item.provider || 'unknown';
      const current = buckets.get(key) ?? [];
      current.push(item);
      buckets.set(key, current);
    }

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const providers = Array.from(buckets.entries())
      .map(([provider, entries]) => ({
        provider,
        entries: entries.slice().sort((a, b) => collator.compare(a.modelId, b.modelId)),
      }))
      .sort((a, b) => {
        if (selectedModelOption?.provider === a.provider) return -1;
        if (selectedModelOption?.provider === b.provider) return 1;
        return collator.compare(a.provider, b.provider);
      });

    return providers;
  }, [parsedModels, selectedModelOption?.provider]);
  const visibleProviderBuckets = useMemo(() => {
    const query = modelSearchQuery.trim().toLowerCase();
    const providerScopedBuckets =
      modelProviderFilter === 'all'
        ? modelProviderBuckets
        : modelProviderBuckets.filter((bucket) => bucket.provider === modelProviderFilter);

    if (!query) {
      return providerScopedBuckets;
    }

    return providerScopedBuckets
      .map((bucket) => ({
        ...bucket,
        entries: bucket.entries.filter((model) => {
          const normalizedProvider = model.provider.toLowerCase();
          const normalizedModelId = model.modelId.toLowerCase();
          const normalizedLabel = model.label.toLowerCase();
          return (
            normalizedModelId.includes(query) ||
            normalizedProvider.includes(query) ||
            normalizedLabel.includes(query)
          );
        }),
      }))
      .filter((bucket) => bucket.entries.length > 0);
  }, [modelProviderBuckets, modelProviderFilter, modelSearchQuery]);
  const totalModelCount = useMemo(
    () => modelProviderBuckets.reduce((sum, bucket) => sum + bucket.entries.length, 0),
    [modelProviderBuckets],
  );
  const visibleModelCount = useMemo(
    () => visibleProviderBuckets.reduce((sum, bucket) => sum + bucket.entries.length, 0),
    [visibleProviderBuckets],
  );
  const visibleMessages = useMemo(() => messages.filter((message) => !isSystemLikeMessage(message)), [messages]);
  const isInitialWorkspace = visibleMessages.length === 0;
  const isRunActive = runPhase === 'sending' || runPhase === 'streaming' || sending || awaitingStream;
  const safeContextWindowTotalTokens = Math.max(1, contextWindowTotalTokens);
  const contextWindowUsagePercent = Math.max(0, Math.min(100, Math.round((contextWindowUsedTokens / safeContextWindowTotalTokens) * 100)));
  const contextWindowUsedTokensLabel = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    Math.max(0, contextWindowUsedTokens),
  );
  const contextWindowTotalTokensLabel = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    safeContextWindowTotalTokens,
  );
  const assistantActivityLabel =
    runPhase === 'sending'
      ? 'Thinking...'
      : runPhase === 'streaming'
        ? 'Working...'
        : runPhase === 'error'
          ? 'Error'
          : '';
  const firstUserMessage = visibleMessages.find((message) => message.role === 'user')?.text.trim() ?? '';
  const headerTitle = firstUserMessage ? firstUserMessage.slice(0, 64) : (projectTitle || 'Project chat');
  const workStatusLabel = isRunActive ? `${Math.floor(elapsedWorkSeconds / 60)}m ${elapsedWorkSeconds % 60}s lang bearbeitet` : '';
  const composerDropdownItemClass =
    'h-8 rounded-lg px-2.5 text-[11px] leading-none text-foreground/85 hover:bg-muted/80 hover:text-foreground data-[active=true]:bg-primary/12 data-[active=true]:text-foreground data-[active=true]:ring-1 data-[active=true]:ring-primary/30';
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [],
  );

  const formatTimestamp = (value: string | number | Date) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Unknown time';
    }
    return dateTimeFormatter.format(parsed);
  };

  const artifactDisplayName = (artifact: CoworkArtifact) => {
    const normalizedPath = artifact.path.replace(/\\/g, '/');
    const fileName = normalizedPath.split('/').filter(Boolean).pop();
    if (fileName) {
      return fileName;
    }
    return artifact.label;
  };

  useEffect(() => {
    setComposerText(taskPrompt);
  }, [taskPrompt]);

  useEffect(() => {
    const editor = composerEditorRef.current;
    if (!editor) {
      return;
    }
    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
  }, [composerText]);

  useEffect(() => {
    const host = scrollHostRef.current;
    if (!host) {
      return;
    }
    const viewport = host.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) {
      return;
    }

    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom <= 28;
    };

    handleScroll();
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (isInitialWorkspace) {
      return;
    }
    if (!shouldAutoScrollRef.current) {
      return;
    }
    const node = chatBottomRef.current;
    if (!node) {
      return;
    }
    requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'end' });
    });
  }, [awaitingStream, isInitialWorkspace, progressSteps, visibleMessages.length]);

  useEffect(() => {
    if (sending || awaitingStream) {
      shouldAutoScrollRef.current = true;
    }
  }, [awaitingStream, sending]);

  useEffect(() => {
    if (isRunActive) {
      setActiveWorkStartedAt((current) => current ?? Date.now());
      return;
    }
    setActiveWorkStartedAt(null);
    setElapsedWorkSeconds(0);
  }, [isRunActive]);

  useEffect(() => {
    if (!activeWorkStartedAt) {
      return;
    }
    const update = () => setElapsedWorkSeconds(Math.max(0, Math.floor((Date.now() - activeWorkStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeWorkStartedAt]);

  const mentionQuery = useMemo(() => {
    const match = composerText.match(/(^|\s)@([^\s]*)$/);
    if (!match) {
      return null;
    }
    return match[2] ?? '';
  }, [composerText]);

  const mentionCommands = useMemo(() => {
    if (!projectSelected || mentionQuery === null) {
      return [] as Array<{ path: string; kind: ProjectPathReference['kind']; source?: ProjectPathReference['source'] }>;
    }

    const normalizedQuery = mentionQuery.toLowerCase();
    return projectPathReferences
      .filter((entry) => {
        const normalizedPath = entry.path.toLowerCase();
        if (!normalizedQuery) {
          return true;
        }
        const sourceLabel = entry.source === 'external' ? 'external' : 'project';
        return normalizedPath.includes(normalizedQuery) || `${sourceLabel}/${normalizedPath}`.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const sourceA = a.source ?? 'project';
        const sourceB = b.source ?? 'project';
        if (sourceA !== sourceB) {
          return sourceA === 'external' ? -1 : 1;
        }
        if (a.kind !== b.kind) {
          return a.kind === 'directory' ? -1 : 1;
        }
        return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
      })
      .slice(0, 30);
  }, [mentionQuery, projectPathReferences, projectSelected]);

  useEffect(() => {
    setMentionMenuOpen(Boolean(projectSelected && mentionQuery !== null && mentionCommands.length > 0));
    setMentionMenuIndex(0);
  }, [mentionCommands.length, mentionQuery, projectSelected]);

  useEffect(() => {
    if (!openDropdown) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (target.closest('.composer-dropdown')) {
        return;
      }
      setOpenDropdown(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenDropdown(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [openDropdown]);

  useEffect(() => {
    if (openDropdown !== 'model') {
      return;
    }
    setModelSearchQuery('');
    if (selectedModelOption?.provider) {
      setModelProviderFilter(selectedModelOption.provider);
      return;
    }
    const firstProvider = modelProviderBuckets[0]?.provider ?? 'all';
    setModelProviderFilter(firstProvider);
  }, [modelProviderBuckets, openDropdown, selectedModelOption?.provider]);

  const executeMentionCommand = (index: number) => {
    const command = mentionCommands[index];
    if (!command) {
      return;
    }

    const mentionPath = command.kind === 'directory' ? `${command.path}/` : command.path;
    const mentionToken = `@project:"${mentionPath}" `;
    const nextPrompt = composerText.replace(/(^|\s)@([^\s]*)$/, (full, prefix) => `${prefix}${mentionToken}`);
    setComposerText(nextPrompt);
    onTaskPromptChange(nextPrompt);
    requestAnimationFrame(() => {
      const editor = composerEditorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      const nextCaret = nextPrompt.length;
      editor.setSelectionRange(nextCaret, nextCaret);
    });
    setMentionMenuOpen(false);
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMenuOpen && mentionCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionMenuIndex((current) => (current + 1) % mentionCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionMenuIndex((current) => (current - 1 + mentionCommands.length) % mentionCommands.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        executeMentionCommand(mentionMenuIndex);
        return;
      }
      if (event.key === 'Escape') {
        setMentionMenuOpen(false);
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

  const renderMentionMenu = () => {
    if (!mentionMenuOpen || mentionCommands.length === 0) {
      return null;
    }

    return (
      <div className="absolute bottom-full left-4 z-20 mb-2 w-[min(680px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_20px_45px_rgba(20,20,18,0.20)]">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
          <p className="font-sans text-xs font-semibold tracking-wide text-foreground">References</p>
          <p className="font-sans text-[11px] text-muted-foreground">Enter to insert</p>
        </div>
        <div className="max-h-72 overflow-y-auto bg-popover p-1.5">
          {mentionCommands.map((command, index) => {
            const fullPath = `${command.path}${command.kind === 'directory' ? '/' : ''}`;
            const segments = command.path.split('/');
            const name = segments[segments.length - 1] || command.path;
            const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
            const sourceLabel = command.source === 'external' ? 'external' : 'project';

            return (
              <button
                key={`${command.kind}-${command.path}`}
                type="button"
                onClick={() => executeMentionCommand(index)}
                className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                  index === mentionMenuIndex
                    ? 'bg-muted text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                  {command.kind === 'directory' ? (
                    <FolderOpen className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-sans text-sm text-foreground">{name}{command.kind === 'directory' ? '/' : ''}</span>
                  {parent ? <span className="block truncate font-mono text-[11px] text-muted-foreground">{parent}</span> : null}
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {sourceLabel} {command.kind === 'directory' ? '@folder' : '@file'}
                </span>
                <span className="sr-only">{fullPath}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const applyIdeaPrompt = (value: string) => {
    setComposerText(value);
    onTaskPromptChange(value);
    requestAnimationFrame(() => {
      const editor = composerEditorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      const nextCaret = value.length;
      editor.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleEditorInput = (nextText: string) => {
    setComposerText(nextText);
    onTaskPromptChange(nextText);
  };

  const renderCoworkComposer = (textareaMinHeightClass: string) => (
    <div className="space-y-2">
      <form
        className="relative rounded-[18px] border border-border/75 bg-card shadow-[0_1px_2px_rgba(16,16,14,0.08)]"
        onSubmit={onSubmit}
        ref={formRef}
        aria-busy={sending || awaitingStream}
      >
        {renderMentionMenu()}
        <div className="relative px-4 pt-3">
          <textarea
            id={taskPromptId}
            ref={composerEditorRef}
            aria-label="Task prompt"
            placeholder="What should Relay do next?"
            value={composerText}
            onChange={(event) => handleEditorInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            className={`${textareaMinHeightClass} max-h-[26vh] w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-0 pb-1.5 pt-1 font-sans text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/45`}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted/70">
              <Plus className="h-4 w-4" />
            </Button>

            <div className="composer-dropdown relative">
              <button
                type="button"
                disabled={modelDropdownDisabled}
                className={`inline-flex h-7 max-w-[230px] items-center gap-1.5 rounded-md px-2 font-sans text-[11px] transition ${
                  openDropdown === 'model'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                } disabled:cursor-not-allowed disabled:opacity-60`}
                onClick={() => setOpenDropdown((current) => (current === 'model' ? null : 'model'))}
              >
                <span className="truncate">{`Model: ${selectedModelLabel || COWORK_DEFAULT_MODEL_LABEL}`}</span>
                <ChevronDown className="h-3 w-3 opacity-80" />
              </button>
              {openDropdown === 'model' && !modelDropdownDisabled ? (
                <div className="absolute bottom-[calc(100%+0.4rem)] left-0 z-30 w-[560px] overflow-hidden rounded-xl border border-border/80 bg-popover shadow-[0_12px_28px_rgba(0,0,0,0.25)]">
                  <div className="border-b border-border/80 px-2.5 py-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                      <p className="font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Model selector</p>
                      <p className="font-sans text-[10px] text-muted-foreground">
                        {visibleModelCount === totalModelCount
                          ? `${totalModelCount} models`
                          : `${visibleModelCount} of ${totalModelCount}`}
                      </p>
                    </div>
                    <Input
                      value={modelSearchQuery}
                      onChange={(event) => setModelSearchQuery(event.target.value)}
                      placeholder="Search model or provider"
                      aria-label="Search models"
                      className="h-8 rounded-md border-border/80 bg-background px-2.5 py-1 text-[11px]"
                    />
                    <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                      <button
                        type="button"
                        className={`h-7 shrink-0 rounded-md border px-2.5 font-sans text-[11px] transition ${
                          modelProviderFilter === 'all'
                            ? 'border-border bg-muted text-foreground shadow-sm'
                            : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/60 hover:text-foreground'
                        }`}
                        onClick={() => setModelProviderFilter('all')}
                      >
                        All ({totalModelCount})
                      </button>
                      {modelProviderBuckets.map((bucket) => (
                        <button
                          key={bucket.provider}
                          type="button"
                          className={`h-7 shrink-0 rounded-md border px-2.5 font-sans text-[11px] transition ${
                            modelProviderFilter === bucket.provider
                              ? 'border-border bg-muted text-foreground shadow-sm'
                              : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/60 hover:text-foreground'
                          }`}
                          onClick={() => setModelProviderFilter(bucket.provider)}
                        >
                          {bucket.provider} ({bucket.entries.length})
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-[340px] overflow-y-auto p-2">
                    <Menu>
                      <MenuGroup>
                        <MenuItem
                          className={composerDropdownItemClass}
                          active={selectedModel === ''}
                          onClick={() => {
                            onModelChange('');
                            setOpenDropdown(null);
                          }}
                        >
                          {COWORK_DEFAULT_MODEL_LABEL}
                        </MenuItem>
                      </MenuGroup>
                    </Menu>
                    {visibleProviderBuckets.length === 0 ? (
                      <div className="px-2 py-5 text-center font-sans text-[11px] text-muted-foreground">
                        No models match "{modelSearchQuery.trim()}".
                      </div>
                    ) : (
                      visibleProviderBuckets.map((bucket) => (
                        <div key={bucket.provider} className="mt-2 first:mt-1">
                          <p className="px-2.5 pb-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {bucket.provider}
                          </p>
                          <Menu>
                            <MenuGroup>
                              {bucket.entries.map((model) => (
                                <MenuItem
                                  key={model.value}
                                  className={composerDropdownItemClass}
                                  active={selectedModel === model.value}
                                  onClick={() => {
                                    onModelChange(model.value);
                                    setOpenDropdown(null);
                                  }}
                                >
                                  {model.modelId}
                                </MenuItem>
                              ))}
                            </MenuGroup>
                          </Menu>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="composer-dropdown relative">
              <button
                type="button"
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-sans text-[11px] transition ${
                  openDropdown === 'effort'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
                onClick={() => setOpenDropdown((current) => (current === 'effort' ? null : 'effort'))}
              >
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">Reasoning</span>
                <span>{effortLevel === 'low' ? 'Low' : effortLevel === 'medium' ? 'Mittel' : 'High'}</span>
                <ChevronDown className="h-3 w-3 opacity-80" />
              </button>
              {openDropdown === 'effort' ? (
                <div className="absolute bottom-[calc(100%+0.3rem)] left-0 z-30 w-[136px] rounded-lg border border-border bg-popover p-1 shadow-xl">
                  <Menu>
                    <MenuGroup>
                      {(['low', 'medium', 'high'] as const).map((value) => (
                        <MenuItem
                          key={value}
                          className={composerDropdownItemClass}
                          active={effortLevel === value}
                          onClick={() => {
                            setEffortLevel(value);
                            setOpenDropdown(null);
                          }}
                        >
                          {value === 'low' ? 'Low' : value === 'medium' ? 'Mittel' : 'High'}
                        </MenuItem>
                      ))}
                    </MenuGroup>
                  </Menu>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="submit"
              size="icon"
              aria-label={sending ? 'Sending' : 'Send task'}
              disabled={!canSend}
              className="h-8 w-8 rounded-full border border-border/70 bg-muted text-foreground hover:bg-muted/90 disabled:text-muted-foreground"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 font-sans text-[12px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="composer-dropdown relative inline-flex items-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-sans text-[11px] transition ${
                      openDropdown === 'approvals'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    }`}
                    onClick={() => setOpenDropdown((current) => (current === 'approvals' ? null : 'approvals'))}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>{approvalMode === 'project' ? 'Project' : approvalMode === 'none' ? 'No approvals' : 'Standard'}</span>
                    <ChevronDown className="h-3 w-3 opacity-80" />
                  </button>
                </TooltipTrigger>
                {approvalMode === 'standard' ? (
                  <TooltipContent>
                    Standard approvals: asks for high-risk actions.
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
            {openDropdown === 'approvals' ? (
              <div className="absolute bottom-[calc(100%+0.3rem)] left-0 z-30 w-[176px] rounded-lg border border-border bg-popover p-1 shadow-xl">
                <Menu>
                  <MenuGroup>
                    <MenuItem
                      className={composerDropdownItemClass}
                      active={approvalMode === 'standard'}
                      onClick={() => {
                        onApprovalModeChange('standard');
                        setOpenDropdown(null);
                      }}
                    >
                      Standard
                    </MenuItem>
                    <MenuItem
                      className={composerDropdownItemClass}
                      active={approvalMode === 'project'}
                      onClick={() => {
                        onApprovalModeChange('project');
                        setOpenDropdown(null);
                      }}
                    >
                      Project
                    </MenuItem>
                    <MenuItem
                      className={composerDropdownItemClass}
                      active={approvalMode === 'none'}
                      onClick={() => {
                        onApprovalModeChange('none');
                        setOpenDropdown(null);
                      }}
                    >
                      No approvals
                    </MenuItem>
                  </MenuGroup>
                </Menu>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="group relative">
            <button
              type="button"
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition hover:bg-muted/70 ${
                gatewayConnected ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-300'
              }`}
              aria-label="Context window usage"
            >
              <span
                className="relative inline-block h-3.5 w-3.5 rounded-full"
                style={{
                  background: `conic-gradient(currentColor ${contextWindowUsagePercent * 3.6}deg, color-mix(in srgb, currentColor 22%, transparent) 0deg)`,
                }}
              >
                <span className="absolute inset-[2px] rounded-full bg-background" />
              </span>
            </button>
            <div className="pointer-events-none absolute bottom-[calc(100%+0.45rem)] right-0 z-20 hidden w-[170px] rounded-xl border border-border bg-popover px-3 py-2 text-center shadow-xl group-hover:block">
              <p className="font-sans text-[11px] text-muted-foreground">Context window:</p>
              <p className="font-sans text-[11px] text-muted-foreground">{contextWindowUsagePercent}% full</p>
              <p className="mt-1 font-sans text-[11px] text-foreground">{contextWindowUsedTokensLabel} / {contextWindowTotalTokensLabel} Tokens</p>
              <p className="font-sans text-[11px] text-foreground">used</p>
              <p className="mt-1 font-sans text-[11px] text-foreground/90">Relay compacts context automatically.</p>
            </div>
          </div>
        </div>
      </div>

      {(modelsLoading || changingModel || !hasModelChoices) && (
        <p className="px-1 font-sans text-[11px] text-muted-foreground">
          {modelsLoading ? 'Loading models...' : changingModel ? 'Switching model...' : 'No models available from Hermes'}
        </p>
      )}
    </div>
  );

  const renderPendingApprovalsPanel = () => {
    if (pendingApprovals.length === 0) {
      return null;
    }

    return (
      <Card
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        data-testid="pending-approvals-card"
        aria-labelledby={approvalsHeadingId}
      >
        <CardHeader className="border-b border-border/80 pb-2">
          <CardTitle id={approvalsHeadingId} className="flex items-center justify-between gap-2 text-sm">
            <span>Approvals required</span>
            <Badge variant="outline" className="rounded-full font-sans text-[10px]">
              {pendingApprovals.length}
            </Badge>
          </CardTitle>
          <p className="font-sans text-xs text-muted-foreground">Review and approve or reject pending high-risk actions.</p>
        </CardHeader>
        <CardContent className="max-h-64 space-y-2 overflow-y-auto pt-3 pr-2">
          {pendingApprovals.map((approval) => {
            const rejectReason = approvalRejectReasons[approval.id] || '';
            const rejectReasonId = `pending-approval-reason-field-${approval.id}`;
            return (
              <div key={approval.id} className="rounded-xl border border-border bg-background p-2.5" data-testid={`pending-approval-${approval.id}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <Badge variant="outline" className={`rounded-full font-sans text-[10px] uppercase ${approvalRiskClasses(approval.riskLevel)}`}>
                    {approval.riskLevel}
                  </Badge>
                  <p className="font-mono text-[10px] text-muted-foreground">{approval.scopeName}</p>
                </div>
                <p className="break-words font-sans text-xs text-foreground">{approval.summary}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{approval.path}</p>
                {approval.preview ? (
                  <div className="mt-1.5 rounded-lg border border-border bg-card p-1.5">
                    <p className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">{approval.preview}</p>
                  </div>
                ) : null}
                <label htmlFor={rejectReasonId} className="sr-only">
                  Rejection reason for {approval.summary}
                </label>
                <Input
                  id={rejectReasonId}
                  data-testid={`pending-approval-reason-${approval.id}`}
                  value={rejectReason}
                  onChange={(event) =>
                    setApprovalRejectReasons((current) => ({
                      ...current,
                      [approval.id]: event.target.value,
                    }))
                  }
                  placeholder="Reason required for reject"
                  className="mt-2 h-8 font-sans text-xs"
                />
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 border-0 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => onApprovePendingAction(approval.id)}
                    data-testid={`pending-approval-approve-${approval.id}`}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => onRejectPendingAction(approval.id, rejectReason)}
                    disabled={!rejectReason.trim()}
                    data-testid={`pending-approval-reject-${approval.id}`}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  };


  return (
    !gatewayConnected ? (
      <section className="grid h-full w-full place-items-center p-6">
        <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted">
            <WifiOff className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Cowork is offline</h2>
          <p className="mt-2 font-sans text-sm text-muted-foreground">
            Connect the gateway to run cowork tasks and access project context.
          </p>
          <Button type="button" className="mt-4" onClick={onOpenGatewaySettings}>
            Open Gateway Settings
          </Button>
        </div>
      </section>
    ) : (
      <section
      data-slot="cowork-surface"
      className="grid h-full w-full min-h-0 overflow-hidden p-0"
    >
      <header className="absolute inset-x-0 top-0 z-20 flex h-9 items-center justify-between bg-background px-3">
        <button
          type="button"
          className="inline-flex h-8 max-w-[560px] items-center gap-1.5 rounded px-0.5 font-sans text-[13px] font-semibold leading-none text-foreground transition hover:bg-transparent"
          title={headerTitle}
        >
          <span className="truncate">{headerTitle}</span>
          <Ellipsis className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-1.5 pr-1">
          {workStatusLabel ? <span className="font-sans text-sm text-muted-foreground">{workStatusLabel}</span> : null}
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60" aria-label="Run">
            <Play className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full bg-blue-500 px-2 text-white hover:bg-blue-500/90" aria-label="Agent">
            <Square className="h-3.5 w-3.5" />
            <ChevronDown className="h-3 w-3" />
          </button>
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60" aria-label="Threads">
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60" aria-label="Web">
            <Globe className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60" aria-label="Layout">
            <Square className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <div
        className={`grid h-full min-h-0 overflow-hidden bg-transparent ${
          isInitialWorkspace ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)_auto]'
        }`}
      >
        <div ref={scrollHostRef} className="h-full">
        <ScrollArea className="h-full px-2">
          {isInitialWorkspace ? (
            <div className="mx-auto grid h-full w-full max-w-[920px] place-items-center px-4 pt-10">
              <div className="w-full">
                <p className="mb-1 text-[clamp(1.6rem,2.4vw,2.2rem)] tracking-tight text-foreground">What should we get done?</p>
                <p className="font-sans text-sm text-muted-foreground">Start with your own task, or pick a quick idea below.</p>
                <div className="mt-4 grid gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    {COWORK_IDEA_CARDS.map((item) => (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() => applyIdeaPrompt(item.prompt)}
                        className="min-w-0 rounded-lg border border-border/50 bg-muted/25 px-2.5 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <p className="flex items-center gap-1.5 truncate font-sans text-[12px] font-medium text-foreground/90">
                          <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{item.title}</span>
                        </p>
                      </button>
                    ))}
                  </div>
                  {renderPendingApprovalsPanel()}
                  {renderCoworkComposer('min-h-[40px]')}
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-[860px] gap-3 px-4 pb-6 pt-12" role="log" aria-live="polite" aria-relevant="additions">
              {visibleMessages.map((message) => {
                const inline = extractInlineActivityCards(message);
                const isUser = message.role === 'user';

                return (
                  <article
                    key={message.id}
                    className="mx-auto w-full max-w-[720px] px-2 py-0 font-sans text-sm text-foreground"
                  >
                    {inline.body ? (
                      <div
                        className={
                          isUser
                            ? 'ml-auto w-fit max-w-[92%] rounded-2xl bg-muted px-3 py-2 font-sans text-sm leading-6 text-foreground'
                            : 'font-sans text-sm leading-6 text-foreground'
                        }
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                          {inline.body}
                        </ReactMarkdown>
                      </div>
                    ) : null}

                    {inline.cards.length > 0 ? (
                      <div className="mt-2 grid gap-1.5">
                        {inline.cards.map((card) => {
                          const compactLabel = (() => {
                            const raw = card.label.trim();
                            const colonIndex = raw.indexOf(':');
                            if (colonIndex <= 0 || colonIndex >= raw.length - 1) {
                              return raw;
                            }
                            const verb = raw.slice(0, colonIndex).trim();
                            const pathPart = raw.slice(colonIndex + 1).trim();
                            const normalized = pathPart.replace(/\\/g, '/');
                            const fileName = normalized.split('/').filter(Boolean).pop();
                            return fileName ? `${verb}: ${fileName}` : raw;
                          })();
                          const toneClass =
                            card.tone === 'danger'
                              ? 'bg-destructive/5'
                              : card.tone === 'success'
                                ? 'bg-blue-500/5'
                                : 'bg-card';

                          return (
                            <div key={card.id} className="rounded-xl border border-border/80 bg-card">
                              <button
                                type="button"
                                className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/60 ${toneClass}`}
                                onClick={() => setExpandedInlineActivityId((current) => (current === card.id ? null : card.id))}
                                title={card.details}
                                aria-expanded={expandedInlineActivityId === card.id}
                                aria-controls={`inline-activity-${card.id}`}
                              >
                                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                                  <FileText className="h-3 w-3" />
                                </span>
                                <span className="min-w-0 flex-1 truncate font-sans text-xs text-foreground/90" title={card.label}>
                                  {compactLabel}
                                </span>
                                <ChevronRight
                                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                                    expandedInlineActivityId === card.id ? 'rotate-90' : 'group-hover:translate-x-0.5'
                                  }`}
                                />
                              </button>

                              {expandedInlineActivityId === card.id ? (
                                <div id={`inline-activity-${card.id}`} className="px-3 py-2">
                                  <div className="break-words text-xs leading-5 text-muted-foreground">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                                      {card.details}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {(sending || awaitingStream) ? (
                <article className="mx-auto w-full max-w-[720px] px-2 py-0 font-sans text-sm text-foreground">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 font-sans text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {assistantActivityLabel || 'Thinking...'}
                  </div>
                </article>
              ) : null}
              {fileChangeSummary && onUndoFileChanges && onReviewFileChanges ? (
                <article className="mx-auto w-full max-w-[720px] px-2 py-0">
                  <FileChangeSummaryCard
                    summary={fileChangeSummary}
                    undoing={undoingFileChanges}
                    onUndo={onUndoFileChanges}
                    onReview={onReviewFileChanges}
                  />
                </article>
              ) : null}
              <div ref={chatBottomRef} aria-hidden className="h-0.5 w-full" />
            </div>
          )}
        </ScrollArea>
        </div>

        {!isInitialWorkspace ? (
          <div className="px-2 pb-3 pt-1">
            <div className="mx-auto grid w-full max-w-[920px] gap-2 px-4">
              {renderPendingApprovalsPanel()}
              {renderCoworkComposer('min-h-[38px]')}
            </div>
          </div>
        ) : null}
      </div>


    </section>
    )
  );
}
