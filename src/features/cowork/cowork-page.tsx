import { useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { ArrowUp, ChevronRight, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ChatMessage,
  ChatModelOption,
  CoworkArtifact,
  CoworkProjectTask,
  PendingApprovalAction,
} from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
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
  taskPrompt: string;
  messages: ChatMessage[];
  rightPanelOpen: boolean;
  awaitingStream: boolean;
  artifacts: CoworkArtifact[];
  onOpenArtifact: (artifact: CoworkArtifact) => void;
  onScheduleRun: () => void;
  selectedModel: string;
  models: ChatModelOption[];
  modelsLoading: boolean;
  changingModel: boolean;
  pendingApprovals: PendingApprovalAction[];
  projectTasks: CoworkProjectTask[];
  sending: boolean;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onApprovePendingAction: (approvalId: string) => void;
  onRejectPendingAction: (approvalId: string, reason: string) => void;
};

const COWORK_DEFAULT_MODEL_LABEL = 'Default model';

export function CoworkPage({
  projectTitle,
  projectSelected,
  projectInstructions,
  scheduledCount,
  taskPrompt,
  messages,
  rightPanelOpen,
  awaitingStream,
  artifacts,
  onOpenArtifact,
  onScheduleRun,
  selectedModel,
  models,
  modelsLoading,
  changingModel,
  pendingApprovals,
  projectTasks,
  sending,
  onTaskPromptChange,
  onModelChange,
  onSubmit,
  onApprovePendingAction,
  onRejectPendingAction,
}: CoworkPageProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const taskPromptId = useId();
  const taskPromptHelpId = useId();
  const modelSelectId = useId();
  const approvalsHeadingId = useId();
  const workspaceCardBodyId = useId();
  const [expandedInlineActivityId, setExpandedInlineActivityId] = useState<string | null>(null);
  const [workspaceCardCollapsed, setWorkspaceCardCollapsed] = useState(false);
  const [approvalRejectReasons, setApprovalRejectReasons] = useState<Record<string, string>>({});
  const canSend = taskPrompt.trim().length > 0 && !sending && projectSelected;
  const visibleMessages = useMemo(() => messages.filter((message) => !isSystemLikeMessage(message)), [messages]);
  const isInitialWorkspace = visibleMessages.length === 0;
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

  const roleLabel = (role: ChatMessage['role']) => {
    if (role === 'user') return 'You';
    if (role === 'assistant') return 'Cowork';
    if (role === 'system') return 'System';
    return role;
  };

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

  const renderCoworkComposer = (textareaMinHeightClass: string) => (
    <form
      className="rounded-[26px] border border-border/90 bg-card/98 px-4 py-3.5 shadow-[0_14px_34px_rgba(24,23,20,0.10)]"
      onSubmit={onSubmit}
      ref={formRef}
      aria-busy={sending || awaitingStream}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`rounded-full font-sans text-[10px] ${
            projectSelected
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          }`}
        >
          {projectSelected ? `Runs in: ${projectTitle}` : 'No project selected'}
        </Badge>
        {!projectSelected ? (
          <span className="font-sans text-[11px] text-muted-foreground">
            Select a project in the sidebar before running a task.
          </span>
        ) : null}
      </div>
      <Textarea
        id={taskPromptId}
        value={taskPrompt}
        onChange={(event) => onTaskPromptChange(event.target.value)}
        placeholder="How can I help you today?"
        rows={2}
        onKeyDown={handleComposerKeyDown}
        aria-label="Task prompt"
        aria-describedby={taskPromptHelpId}
        className={`${textareaMinHeightClass} resize-none border-0 bg-transparent px-0 py-1.5 font-sans text-lg leading-7 text-foreground shadow-none focus-visible:ring-0`}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p id={taskPromptHelpId} className="font-sans text-xs text-muted-foreground">
          {projectSelected ? 'Press Enter to send, Shift+Enter for a new line' : 'Choose a project to enable sending'}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor={modelSelectId} className="sr-only">Model</label>
          <select
            id={modelSelectId}
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={modelsLoading || changingModel || models.length === 0}
            className="h-9 max-w-[260px] rounded-xl border border-border bg-background px-3 font-sans text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Model"
          >
            <option value="">{COWORK_DEFAULT_MODEL_LABEL}</option>
            {models.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>

          <Button
            type="submit"
            size="icon"
            aria-label={sending ? 'Sending' : 'Send task'}
            disabled={!canSend}
            className="h-9 w-9 rounded-xl border-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {(modelsLoading || changingModel) && (
        <p className="mt-2 font-sans text-[11px] text-muted-foreground">
          {modelsLoading ? 'Loading models...' : 'Switching model...'}
        </p>
      )}
    </form>
  );

  return (
    <section
      className={`grid h-full w-full min-h-0 overflow-hidden transition-[grid-template-columns,gap] duration-200 ${
        rightPanelOpen
          ? 'gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]'
          : 'gap-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_0px]'
      } p-0`}
    >
      <div
        className={`grid h-full min-h-0 overflow-hidden bg-transparent ${
          isInitialWorkspace ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)_auto]'
        }`}
      >
        <ScrollArea className="h-full px-2">
          {isInitialWorkspace ? (
            <div className="mx-auto grid h-full w-full max-w-[920px] place-items-center">
              <div className="w-full">
                <p className="mb-3 text-[clamp(1.6rem,2.4vw,2.2rem)] tracking-tight text-foreground">Let's knock something off your list</p>
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="font-sans text-sm text-muted-foreground">
                    Cowork runs against your configured gateway and supports file-aware task context.
                  </p>
                  <ul className="mt-3 grid gap-1.5 font-sans text-xs text-muted-foreground">
                    <li>Ask for planning, implementation, or review tasks.</li>
                    <li>File writes are scoped to the selected project folder.</li>
                    <li>Risky actions require explicit approval.</li>
                  </ul>
                </div>

                <div className="mt-4">{renderCoworkComposer('min-h-[90px]')}</div>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-[860px] gap-3" role="log" aria-live="polite" aria-relevant="additions">
              {pendingApprovals.length > 0 ? (
                <Card
                  className="overflow-visible rounded-2xl border-amber-300/70 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-950/20"
                  data-testid="pending-approvals-card"
                  aria-labelledby={approvalsHeadingId}
                >
                  <CardHeader className="pb-2">
                    <CardTitle id={approvalsHeadingId} className="text-sm">
                      Action required: approvals ({pendingApprovals.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 pt-0">
                    {pendingApprovals.map((approval) => {
                      const rejectReason = approvalRejectReasons[approval.id] || '';
                      const rejectReasonId = `pending-approval-reason-field-${approval.id}`;
                      return (
                        <div key={approval.id} className="rounded-xl border border-border bg-card p-2.5" data-testid={`pending-approval-${approval.id}`}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <Badge variant="outline" className={`rounded-full font-sans text-[10px] uppercase ${approvalRiskClasses(approval.riskLevel)}`}>
                              {approval.riskLevel}
                            </Badge>
                            <p className="break-words font-sans text-xs text-foreground">{approval.summary}</p>
                          </div>
                          <p className="break-words font-sans text-xs text-muted-foreground">Scope: {approval.scopeName}</p>
                          {approval.projectTitle ? (
                            <p className="break-words font-sans text-xs text-muted-foreground">Project: {approval.projectTitle}</p>
                          ) : null}
                          <p className="break-all font-sans text-xs text-muted-foreground">Path: {approval.path}</p>
                          {approval.preview ? (
                            <div className="mt-1.5 rounded border border-border bg-background p-1.5">
                              <p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">{approval.preview}</p>
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
                            placeholder="Rejection reason (required to reject)"
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
                          <p className="mt-1 font-sans text-[10px] text-muted-foreground">
                            Reject requires a reason to keep the project audit trail clear.
                          </p>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              ) : null}

              {visibleMessages.map((message) => {
                const inline = extractInlineActivityCards(message);

                return (
                  <article
                    key={message.id}
                    className={
                      message.role === 'user'
                        ? 'ml-auto w-[min(92%,720px)] px-2 py-0 text-right font-sans text-sm text-foreground'
                        : 'w-[min(95%,720px)] px-2 py-0 font-sans text-sm text-foreground'
                    }
                  >
                    <p
                      className={`mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                        message.role === 'user' ? 'text-right' : ''
                      }`}
                    >
                      {roleLabel(message.role)}
                    </p>

                    {inline.body ? (
                      <div className="font-sans text-sm leading-6 text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                          {inline.body}
                        </ReactMarkdown>
                      </div>
                    ) : null}

                    {inline.cards.length > 0 ? (
                      <div className="mt-2 grid gap-1.5">
                        {inline.cards.map((card) => {
                          const toneClass =
                            card.tone === 'danger'
                              ? 'border-destructive/30 bg-destructive/10'
                              : card.tone === 'success'
                                ? 'border-emerald-500/35 bg-emerald-500/10'
                                : 'border-border bg-muted/60';

                          return (
                            <div key={card.id} className="rounded-xl border border-border bg-card">
                              <button
                                type="button"
                                className={`group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-muted ${toneClass}`}
                                onClick={() => setExpandedInlineActivityId((current) => (current === card.id ? null : card.id))}
                                title={card.details}
                                aria-expanded={expandedInlineActivityId === card.id}
                                aria-controls={`inline-activity-${card.id}`}
                              >
                                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                                  <FileText className="h-3 w-3" />
                                </span>
                                <span className="min-w-0 flex-1 truncate font-sans text-xs text-foreground/90">{card.label}</span>
                                <ChevronRight
                                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                                    expandedInlineActivityId === card.id ? 'rotate-90' : 'group-hover:translate-x-0.5'
                                  }`}
                                />
                              </button>

                              {expandedInlineActivityId === card.id ? (
                                <div id={`inline-activity-${card.id}`} className="border-t border-border px-3 py-2">
                                  <div className="text-xs leading-5 text-muted-foreground">
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

              {(sending || awaitingStream) && (
                <article className="w-[min(95%,720px)] px-2 py-0 font-sans text-sm text-muted-foreground">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Working...
                  </div>
                </article>
              )}
            </div>
          )}
        </ScrollArea>

        {!isInitialWorkspace ? (
          <div className="px-2">
            <div className="mx-auto grid w-full max-w-[920px] gap-2">
              {renderCoworkComposer('min-h-[84px]')}
            </div>
          </div>
        ) : null}
      </div>

      <aside
        className={`min-h-0 w-full transition-opacity duration-200 ${
          rightPanelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto py-2 pr-1">
          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card/95 shadow-sm" data-testid="cowork-instructions-card">
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
                  <div className="rounded-lg border border-border/70 bg-background/60 px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Recents</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{projectTasks.length}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/60 px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Artifacts</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{artifacts.length}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/60 px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Approvals</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{pendingApprovals.length}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/60 px-2 py-1.5">
                    <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Scheduled</p>
                    <p className="font-sans text-sm font-semibold text-foreground">{scheduledCount}</p>
                  </div>
                </div>
              ) : null}
            </CardHeader>
            {!workspaceCardCollapsed ? (
              <CardContent className="space-y-2 border-t border-border/70 pt-3">
                <p className="font-sans text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Project instructions</p>
                <div className="rounded-xl border border-border/70 bg-background/60 px-2.5 py-2">
                  <p className="font-sans text-xs leading-5 text-foreground/90">
                    {projectInstructions.trim() || 'Add project instructions in Project Settings to define role, tone, constraints, and output format.'}
                  </p>
                </div>
              </CardContent>
            ) : null}
          </Card>

          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card/95 shadow-sm" data-testid="cowork-scheduled-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                Scheduled
                <Badge variant="outline" className="rounded-full font-sans text-[10px]">{scheduledCount}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <p className="font-sans text-xs text-muted-foreground">Plan recurring cowork runs for this project workflow.</p>
              <Button type="button" size="sm" variant="outline" onClick={onScheduleRun} className="w-full">
                Open schedule
              </Button>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card/95 shadow-sm" data-testid="cowork-artifacts-card">
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
                    className="w-full rounded-lg border border-border bg-background/70 p-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`cowork-artifact-${artifact.id}`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate font-sans text-xs font-medium text-foreground">{artifact.label}</p>
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
                    <p className="break-all font-sans text-[10px] text-muted-foreground">{artifact.path}</p>
                    <p className="mt-1 font-sans text-[10px] text-muted-foreground" title={String(artifact.updatedAt)}>
                      Updated {formatTimestamp(artifact.updatedAt)}
                    </p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-border/80 bg-card/95 shadow-sm" data-testid="cowork-project-recents">
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
                  <div key={`recent-${task.id}`} className="rounded-lg border border-border bg-background/70 px-2.5 py-2">
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
  );
}
