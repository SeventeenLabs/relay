import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { ArrowUp, ChevronDown, ChevronRight, FileText, FolderOpen, Loader2, Plus, Shield, WifiOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ChatMessage,
  ChatModelOption,
  CoworkArtifact,
  CoworkProgressStep,
  CoworkProjectTask,
  CoworkRunPhase,
  PendingApprovalAction,
  ProjectPathReference,
} from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Menu, MenuGroup, MenuItem } from '@/components/ui/menu';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  runStatus: string;
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
};

const COWORK_DEFAULT_MODEL_LABEL = 'Default model';
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
  runStatus,
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
  const [liveRunLines, setLiveRunLines] = useState<string[]>([]);
  const [openDropdown, setOpenDropdown] = useState<'model' | 'effort' | 'approvals' | null>(null);
  const [effortLevel, setEffortLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const liveRunLineSetRef = useRef<Set<string>>(new Set());
  const shouldAutoScrollRef = useRef(true);
  const canSend = composerText.trim().length > 0 && !sending && gatewayConnected;
  const visibleMessages = useMemo(() => messages.filter((message) => !isSystemLikeMessage(message)), [messages]);
  const isInitialWorkspace = visibleMessages.length === 0;
  const showRightPanel = rightPanelOpen && projectSelected;
  const isRunActive = runPhase === 'sending' || runPhase === 'streaming' || sending || awaitingStream;
  const safeContextWindowTotalTokens = Math.max(1, contextWindowTotalTokens);
  const contextWindowUsagePercent = Math.max(0, Math.min(100, Math.round((contextWindowUsedTokens / safeContextWindowTotalTokens) * 100)));
  const contextWindowUsedTokensLabel = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    Math.max(0, contextWindowUsedTokens),
  );
  const contextWindowTotalTokensLabel = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    safeContextWindowTotalTokens,
  );
  const composerDropdownItemClass =
    'h-7 rounded-md px-2 text-[11px] text-foreground/80 hover:bg-muted hover:text-foreground data-[active=true]:bg-primary/12 data-[active=true]:text-foreground data-[active=true]:ring-1 data-[active=true]:ring-primary/30';
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
    if (!isRunActive) {
      liveRunLineSetRef.current.clear();
      setLiveRunLines([]);
      return;
    }

    const candidateLines: string[] = [];
    const statusLine = runStatus.trim();
    if (statusLine) {
      candidateLines.push(statusLine);
    }
    for (const step of progressSteps) {
      if (!step.details?.trim()) {
        continue;
      }
      if (step.status === 'active' || step.status === 'completed' || step.status === 'blocked') {
        candidateLines.push(`${step.label}: ${step.details.trim()}`);
      }
    }

    if (candidateLines.length === 0) {
      candidateLines.push('Starting cowork run...');
    }

    const nextUnique: string[] = [];
    for (const line of candidateLines) {
      if (!liveRunLineSetRef.current.has(line)) {
        liveRunLineSetRef.current.add(line);
        nextUnique.push(line);
      }
    }

    if (nextUnique.length > 0) {
      setLiveRunLines((current) => [...current, ...nextUnique].slice(-14));
    }
  }, [isRunActive, progressSteps, runStatus]);

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
  }, [awaitingStream, isInitialWorkspace, liveRunLines, progressSteps, runStatus, visibleMessages.length]);

  useEffect(() => {
    if (sending || awaitingStream) {
      shouldAutoScrollRef.current = true;
    }
  }, [awaitingStream, sending]);

  const mentionQuery = useMemo(() => {
    const match = composerText.match(/(^|\s)@([^\s]*)$/);
    if (!match) {
      return null;
    }
    return match[2] ?? '';
  }, [composerText]);

  const mentionCommands = useMemo(() => {
    if (!projectSelected || mentionQuery === null) {
      return [] as Array<{ path: string; kind: ProjectPathReference['kind'] }>;
    }

    const normalizedQuery = mentionQuery.toLowerCase();
    return projectPathReferences
      .filter((entry) => {
        const normalizedPath = entry.path.toLowerCase();
        if (!normalizedQuery) {
          return true;
        }
        return normalizedPath.includes(normalizedQuery) || `project/${normalizedPath}`.includes(normalizedQuery);
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

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
          <p className="font-sans text-xs font-semibold tracking-wide text-foreground">Project references</p>
          <p className="font-sans text-[11px] text-muted-foreground">Enter to insert</p>
        </div>
        <div className="max-h-72 overflow-y-auto bg-popover p-1.5">
          {mentionCommands.map((command, index) => {
            const fullPath = `${command.path}${command.kind === 'directory' ? '/' : ''}`;
            const segments = command.path.split('/');
            const name = segments[segments.length - 1] || command.path;
            const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : '';

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
                    <FileText className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-sans text-sm text-foreground">{name}{command.kind === 'directory' ? '/' : ''}</span>
                  {parent ? <span className="block truncate font-mono text-[11px] text-muted-foreground">{parent}</span> : null}
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {command.kind === 'directory' ? '@folder' : '@file'}
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

        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted/70">
              <Plus className="h-4 w-4" />
            </Button>

            <div className="composer-dropdown relative">
              <button
                type="button"
                className={`inline-flex h-6 max-w-[210px] items-center gap-1 rounded-md px-1.5 font-sans text-[11px] transition ${
                  openDropdown === 'model'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
                onClick={() => setOpenDropdown((current) => (current === 'model' ? null : 'model'))}
              >
                <span className="truncate">
                  {selectedModel ? models.find((m) => m.value === selectedModel)?.label ?? selectedModel : COWORK_DEFAULT_MODEL_LABEL}
                </span>
                <ChevronDown className="h-3 w-3 opacity-80" />
              </button>
              {openDropdown === 'model' ? (
                <div className="absolute bottom-[calc(100%+0.3rem)] left-0 z-30 w-[230px] rounded-lg border border-border bg-popover p-1 shadow-xl">
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
                      {models.map((model) => (
                        <MenuItem
                          key={model.value}
                          className={composerDropdownItemClass}
                          active={selectedModel === model.value}
                          onClick={() => {
                            onModelChange(model.value);
                            setOpenDropdown(null);
                          }}
                        >
                          {model.label}
                        </MenuItem>
                      ))}
                    </MenuGroup>
                  </Menu>
                </div>
              ) : null}
            </div>

            <div className="composer-dropdown relative">
              <button
                type="button"
                className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-sans text-[11px] transition ${
                  openDropdown === 'effort'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
                onClick={() => setOpenDropdown((current) => (current === 'effort' ? null : 'effort'))}
              >
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

      {(modelsLoading || changingModel) && (
        <p className="px-1 font-sans text-[11px] text-muted-foreground">
          {modelsLoading ? 'Loading models...' : 'Switching model...'}
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

  const renderLiveRunPanel = () => {
    if (!isRunActive) {
      return null;
    }
    const lines = liveRunLines.length > 0 ? liveRunLines : ['Starting cowork run...'];

    return (
      <article className="mx-auto w-full max-w-[720px] px-2 py-0 font-sans text-sm text-foreground">
        <p className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cowork</p>
        <div className="space-y-1.5">
          {lines.map((line, index) => (
            <p key={`${line}-${index}`} className="font-mono text-[12px] leading-5 text-foreground/90">
              {line}
            </p>
          ))}
          <p className="font-mono text-[12px] leading-5 text-muted-foreground">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin align-middle" />
            Running...
          </p>
        </div>
      </article>
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
      className={`grid h-full w-full min-h-0 overflow-hidden transition-[grid-template-columns,gap] duration-200 ${
        showRightPanel
          ? 'gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]'
          : 'gap-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_0px]'
      } p-0`}
    >
      <div
        className={`grid h-full min-h-0 overflow-hidden bg-transparent ${
          isInitialWorkspace ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)_auto]'
        }`}
      >
        <div ref={scrollHostRef} className="h-full">
        <ScrollArea className="h-full px-2">
          {isInitialWorkspace ? (
            <div className="mx-auto grid h-full w-full max-w-[920px] place-items-center px-4">
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
            <div className="mx-auto grid w-full max-w-[860px] gap-3 px-4 py-6" role="log" aria-live="polite" aria-relevant="additions">
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
                                ? 'bg-emerald-500/5'
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
              {renderLiveRunPanel()}
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

      <aside
        className={`min-h-0 w-full transition-opacity duration-200 ${
          showRightPanel ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto py-2 pr-1">
          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card shadow-sm" data-testid="cowork-instructions-card">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Project</p>
                  <CardTitle className="mt-1 truncate text-sm">{projectTitle || 'Cowork'}</CardTitle>
                </div>
                <div className="flex items-start gap-1.5">
                  <Badge
                    variant="outline"
                    className={`rounded-full font-sans text-[10px] ${
                      projectSelected
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {projectSelected ? 'Project Selected' : 'Select Project'}
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-6 w-6 rounded-md"
                    onClick={() => setWorkspaceCardCollapsed((current) => !current)}
                    aria-expanded={!workspaceCardCollapsed}
                    aria-controls={workspaceCardBodyId}
                    aria-label={workspaceCardCollapsed ? 'Expand project card' : 'Minimize project card'}
                  >
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${workspaceCardCollapsed ? '' : 'rotate-90'}`} />
                  </Button>
                </div>
              </div>

              {!workspaceCardCollapsed ? (
                <div id={workspaceCardBodyId} className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg border border-border/70 bg-background px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Recents</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{projectTasks.length}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Artifacts</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{artifacts.length}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Approvals</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{pendingApprovals.length}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Scheduled</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{scheduledCount}</p>
                  </div>
                </div>
              ) : null}
            </CardHeader>
            {!workspaceCardCollapsed ? (
              <CardContent className="space-y-2 border-t border-border/70 pt-3">
                <p className="font-sans text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Project instructions</p>
                <div className="rounded-xl border border-border/70 bg-background px-2.5 py-2">
                  <p className="font-sans text-xs leading-5 text-foreground/90">
                    {projectInstructions.trim() || 'Add project instructions in Project Settings to define role, tone, constraints, and output format.'}
                  </p>
                </div>
              </CardContent>
            ) : null}
          </Card>

          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card shadow-sm" data-testid="cowork-scheduled-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                Scheduled
                <Badge variant="outline" className="rounded-full font-sans text-[10px]">{scheduledCount}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <p className="font-sans text-xs text-muted-foreground">Plan recurring cowork runs for this project workflow.</p>
              <div className="grid grid-cols-2 gap-1.5">
                <Button type="button" size="sm" variant="outline" onClick={onScheduleRun} className="w-full">
                  Open schedule
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onRerunLastTask} className="w-full" disabled={!canRerunLastTask}>
                  Rerun last
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card shadow-sm" data-testid="cowork-artifacts-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                Artifacts
                <Badge variant="outline" className="rounded-full font-sans text-[10px]">{artifacts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-60 space-y-1.5 overflow-y-auto pt-0 pr-1">
              {artifacts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-2.5 py-2">
                  <p className="font-sans text-xs text-muted-foreground">No artifacts yet for this run.</p>
                </div>
              ) : (
                artifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => onOpenArtifact(artifact)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`cowork-artifact-${artifact.id}`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate font-sans text-xs font-medium text-foreground">{artifactDisplayName(artifact)}</p>
                      <div className="flex items-center gap-1">
                        {artifact.source ? (
                          <Badge variant="outline" className="rounded-full font-sans text-[10px] capitalize">
                            {artifact.source.replace('_', ' ')}
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={`rounded-full font-sans text-[10px] ${artifact.status === 'ok' ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-destructive/35 bg-destructive/10 text-destructive'}`}
                        >
                          {artifact.status}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-1 font-sans text-[10px] text-muted-foreground" title={String(artifact.updatedAt)}>
                      Updated {formatTimestamp(artifact.updatedAt)}
                    </p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card shadow-sm" data-testid="cowork-project-recents">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                Recents in this project
                <Badge variant="outline" className="rounded-full font-sans text-[10px]">{projectTasks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-52 space-y-1.5 overflow-y-auto pt-0 pr-1">
              {projectTasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-2.5 py-2">
                  <p className="font-sans text-xs text-muted-foreground">No project recents yet.</p>
                </div>
              ) : (
                projectTasks.map((task) => (
                  <div key={`recent-${task.id}`} className="rounded-lg border border-border bg-background px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="outline" className={`rounded-full font-sans text-[10px] capitalize ${taskStatusClasses(task.status)}`}>
                        {taskStatusLabel(task.status)}
                      </Badge>
                    </div>
                    <p className="truncate font-sans text-xs font-medium text-foreground">{task.prompt}</p>
                    <p className="mt-1 font-sans text-[10px] text-muted-foreground" title={String(task.updatedAt)}>
                      Updated {formatTimestamp(task.updatedAt)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </aside>
    </section>
    )
  );
}
