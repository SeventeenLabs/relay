import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ChevronDown,
  Ellipsis,
  FileText,
  FolderOpen,
  Globe,
  MessageSquare,
  Play,
  Shield,
  Square,
  WifiOff,
} from 'lucide-react';

import type {
  ChatActivityItem,
  ChatMessage,
  ChatModelOption,
  CoworkArtifact,
  CoworkProgressStep,
  CoworkProjectTask,
  CoworkRunPhase,
  FileChangeSummary,
  PendingApprovalAction,
  ProjectPathReference,
} from '@/app-types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

import { ChatMessageList } from './cowork/components/chat-message-list';
import { CoworkComposer } from './cowork/components/cowork-composer';
import { PendingApprovalsPanel } from './cowork/components/pending-approvals-panel';
import { isSystemLikeMessage } from './cowork/cowork-utils';

type ChatPageProps = {
  projectTitle: string;
  projectSelected: boolean;
  projectInstructions: string;
  scheduledCount: number;
  canRerunLastTask: boolean;
  taskPrompt: string;
  messages: ChatMessage[];
  liveActivityItems: ChatActivityItem[];
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
  hermesConnected: boolean;
  webSearchEnabled: boolean;
  approvalMode: 'standard' | 'project' | 'none';
  reasoningEffort: 'low' | 'medium' | 'high';
  projectPathReferences: ProjectPathReference[];
  contextWindowUsedTokens: number;
  contextWindowTotalTokens: number;
  onOpenConnectionSettings: () => void;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: 'low' | 'medium' | 'high') => void;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  onApprovalModeChange: (mode: 'standard' | 'project' | 'none') => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onApprovePendingAction: (approvalId: string) => void;
  onApprovePendingActionAlways: (approvalId: string) => void;
  onRejectPendingAction: (approvalId: string, reason: string) => void;
  fileChangeSummary?: FileChangeSummary | null;
  undoingFileChanges?: boolean;
  onUndoFileChanges?: () => void;
  onReviewFileChanges?: () => void;
};

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

export function ChatPage(props: ChatPageProps) {
  const {
    projectTitle,
    projectSelected,
    taskPrompt,
    messages,
    liveActivityItems,
    awaitingStream,
    selectedModel,
    models,
    modelsLoading,
    changingModel,
    pendingApprovals,
    runPhase,
    progressSteps,
    sending,
    hermesConnected,
    approvalMode,
    reasoningEffort,
    projectPathReferences,
    contextWindowUsedTokens,
    contextWindowTotalTokens,
    onOpenConnectionSettings,
    onTaskPromptChange,
    onModelChange,
    onReasoningEffortChange,
    onApprovalModeChange,
    onSubmit,
    onApprovePendingAction,
    onApprovePendingActionAlways,
    onRejectPendingAction,
    fileChangeSummary,
    undoingFileChanges = false,
    onUndoFileChanges,
    onReviewFileChanges,
  } = props;

  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const taskPromptId = useId();
  const approvalsHeadingId = useId();

  const [expandedInlineActivityId, setExpandedInlineActivityId] = useState<string | null>(null);
  const [approvalRejectReasons, setApprovalRejectReasons] = useState<Record<string, string>>({});
  const [activeWorkStartedAt, setActiveWorkStartedAt] = useState<number | null>(null);
  const [elapsedWorkSeconds, setElapsedWorkSeconds] = useState(0);

  const visibleMessages = useMemo(() => messages.filter((message) => !isSystemLikeMessage(message)), [messages]);
  const isInitialWorkspace = visibleMessages.length === 0;
  const isRunActive = runPhase === 'sending' || runPhase === 'streaming' || sending || awaitingStream;

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

  return (
    <section data-slot="cowork-surface" className="grid h-full w-full min-h-0 overflow-hidden p-0">
      {!hermesConnected ? (
        <div className="absolute inset-x-0 top-9 z-30 mx-3 mt-2 rounded-lg border border-border bg-card/95 px-3 py-2 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <WifiOff className="h-4 w-4" />
              <span>Cowork is offline. Reconnect Hermes to send new tasks.</span>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={onOpenConnectionSettings}>
              Open Connection Settings
            </Button>
          </div>
        </div>
      ) : null}
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
                          onClick={() => onTaskPromptChange(item.prompt)}
                          className="min-w-0 rounded-lg border border-border/50 bg-muted/25 px-2.5 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <p className="flex items-center gap-1.5 truncate font-sans text-[12px] font-medium text-foreground/90">
                            <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{item.title}</span>
                          </p>
                        </button>
                      ))}
                    </div>

                    <PendingApprovalsPanel
                      headingId={approvalsHeadingId}
                      pendingApprovals={pendingApprovals}
                      approvalRejectReasons={approvalRejectReasons}
                      onRejectReasonChange={(approvalId, value) =>
                        setApprovalRejectReasons((current) => ({
                          ...current,
                          [approvalId]: value,
                        }))
                      }
                      onApprovePendingAction={onApprovePendingAction}
                      onApprovePendingActionAlways={onApprovePendingActionAlways}
                      onRejectPendingAction={onRejectPendingAction}
                    />

                    <CoworkComposer
                      taskPromptId={taskPromptId}
                      taskPrompt={taskPrompt}
                      textareaMinHeightClass="min-h-[40px]"
                      projectSelected={projectSelected}
                      projectPathReferences={projectPathReferences}
                      selectedModel={selectedModel}
                      models={models}
                      modelsLoading={modelsLoading}
                      changingModel={changingModel}
                      sending={sending}
                      hermesConnected={hermesConnected}
                      approvalMode={approvalMode}
                      reasoningEffort={reasoningEffort}
                      contextWindowUsedTokens={contextWindowUsedTokens}
                      contextWindowTotalTokens={contextWindowTotalTokens}
                      onTaskPromptChange={onTaskPromptChange}
                      onModelChange={onModelChange}
                      onReasoningEffortChange={onReasoningEffortChange}
                      onApprovalModeChange={onApprovalModeChange}
                      onSubmit={onSubmit}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <ChatMessageList
                visibleMessages={visibleMessages}
                expandedInlineActivityId={expandedInlineActivityId}
                onToggleInlineActivity={(cardId) =>
                  setExpandedInlineActivityId((current) => (current === cardId ? null : cardId))
                }
                sending={sending}
                awaitingStream={awaitingStream}
                assistantActivityLabel={assistantActivityLabel}
                liveActivityItems={liveActivityItems}
                fileChangeSummary={fileChangeSummary}
                undoingFileChanges={undoingFileChanges}
                onUndoFileChanges={onUndoFileChanges}
                onReviewFileChanges={onReviewFileChanges}
                chatBottomRef={chatBottomRef}
              />
            )}
          </ScrollArea>
        </div>

        {!isInitialWorkspace ? (
          <div className="px-2 pb-3 pt-1">
            <div className="mx-auto grid w-full max-w-[920px] gap-2 px-4">
              <PendingApprovalsPanel
                headingId={approvalsHeadingId}
                pendingApprovals={pendingApprovals}
                approvalRejectReasons={approvalRejectReasons}
                onRejectReasonChange={(approvalId, value) =>
                  setApprovalRejectReasons((current) => ({
                    ...current,
                    [approvalId]: value,
                  }))
                }
                onApprovePendingAction={onApprovePendingAction}
                onApprovePendingActionAlways={onApprovePendingActionAlways}
                onRejectPendingAction={onRejectPendingAction}
              />

              <CoworkComposer
                taskPromptId={taskPromptId}
                taskPrompt={taskPrompt}
                textareaMinHeightClass="min-h-[38px]"
                projectSelected={projectSelected}
                projectPathReferences={projectPathReferences}
                selectedModel={selectedModel}
                models={models}
                modelsLoading={modelsLoading}
                changingModel={changingModel}
                sending={sending}
                hermesConnected={hermesConnected}
                approvalMode={approvalMode}
                reasoningEffort={reasoningEffort}
                contextWindowUsedTokens={contextWindowUsedTokens}
                contextWindowTotalTokens={contextWindowTotalTokens}
                onTaskPromptChange={onTaskPromptChange}
                onModelChange={onModelChange}
                onReasoningEffortChange={onReasoningEffortChange}
                onApprovalModeChange={onApprovalModeChange}
                onSubmit={onSubmit}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

