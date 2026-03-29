import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { ArrowUp, ChevronRight, FileText, FolderOpen, Loader2, WifiOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ChatMessage,
  ChatModelOption,
  CoworkArtifact,
  CoworkProjectTask,
  PendingApprovalAction,
  ProjectPathReference,
} from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  sending: boolean;
  gatewayConnected: boolean;
  webSearchEnabled: boolean;
  projectPathReferences: ProjectPathReference[];
  onOpenGatewaySettings: () => void;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onApprovePendingAction: (approvalId: string) => void;
  onRejectPendingAction: (approvalId: string, reason: string) => void;
};

const COWORK_DEFAULT_MODEL_LABEL = 'Default model';
const MENTION_TOKEN_PATTERN = /@project:"[^"]+"/g;

function buildEditorFragmentFromText(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  MENTION_TOKEN_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_TOKEN_PATTERN.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
    }
    const mention = document.createElement('span');
    mention.className =
      'inline-flex items-center rounded-md border border-sky-500/35 bg-sky-500/12 px-1.5 py-[1px] font-mono text-[0.88em] font-medium text-sky-700 dark:text-sky-200';
    mention.textContent = text.slice(start, end);
    fragment.appendChild(mention);
    cursor = end;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

function getEditorPlainText(editor: HTMLDivElement): string {
  return (editor.textContent ?? '').replace(/\u00A0/g, ' ');
}

function setEditorHtmlFromText(editor: HTMLDivElement, text: string): void {
  editor.replaceChildren(buildEditorFragmentFromText(text));
}

function getCaretCharacterOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return 0;
  }
  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(root);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
}

function setCaretCharacterOffset(root: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  const stack: Node[] = [root];
  let remaining = offset;

  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (remaining <= text.length) {
        range.setStart(node, Math.max(0, remaining));
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= text.length;
      continue;
    }

    const children = Array.from(node.childNodes);
    stack.unshift(...children);
  }

  placeCaretAtEnd(root);
}

function placeCaretAtEnd(root: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

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
  sending,
  gatewayConnected,
  webSearchEnabled,
  projectPathReferences,
  onOpenGatewaySettings,
  onTaskPromptChange,
  onModelChange,
  onWebSearchEnabledChange,
  onSubmit,
  onApprovePendingAction,
  onRejectPendingAction,
}: CoworkPageProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const taskPromptId = useId();
  const taskPromptHelpId = useId();
  const modelSelectId = useId();
  const approvalsHeadingId = useId();
  const workspaceCardBodyId = useId();
  const [expandedInlineActivityId, setExpandedInlineActivityId] = useState<string | null>(null);
  const [workspaceCardCollapsed, setWorkspaceCardCollapsed] = useState(false);
  const [approvalRejectReasons, setApprovalRejectReasons] = useState<Record<string, string>>({});
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionMenuIndex, setMentionMenuIndex] = useState(0);
  const [composerText, setComposerText] = useState(taskPrompt);
  const canSend = composerText.trim().length > 0 && !sending && gatewayConnected;
  const visibleMessages = useMemo(() => messages.filter((message) => !isSystemLikeMessage(message)), [messages]);
  const isInitialWorkspace = visibleMessages.length === 0;
  const showRightPanel = rightPanelOpen && (!isInitialWorkspace || projectSelected);
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

    const editorText = getEditorPlainText(editor);
    if (editorText === composerText) {
      return;
    }
    setEditorHtmlFromText(editor, composerText);
  }, [composerText]);

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
    if (composerEditorRef.current) {
      setEditorHtmlFromText(composerEditorRef.current, nextPrompt);
      placeCaretAtEnd(composerEditorRef.current);
    }
    setMentionMenuOpen(false);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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

  const handleEditorInput = () => {
    const editor = composerEditorRef.current;
    if (!editor) {
      return;
    }
    const caretOffset = getCaretCharacterOffset(editor);
    const nextText = getEditorPlainText(editor);
    setEditorHtmlFromText(editor, nextText);
    setCaretCharacterOffset(editor, caretOffset);
    setComposerText(nextText);
    onTaskPromptChange(nextText);
  };

  const renderCoworkComposer = (textareaMinHeightClass: string) => (
    <form
      className="relative rounded-[26px] border border-border bg-card px-4 py-3.5 shadow-[0_14px_34px_rgba(24,23,20,0.10)]"
      onSubmit={onSubmit}
      ref={formRef}
      aria-busy={sending || awaitingStream}
      >
        {renderMentionMenu()}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`rounded-full font-sans text-[10px] ${
            projectSelected
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          {projectSelected ? `Project: ${projectTitle}` : 'No project context'}
        </Badge>
        {!gatewayConnected ? (
          <span className="font-sans text-[11px] text-muted-foreground">
            Connect the gateway to run cowork tasks.
          </span>
        ) : null}
      </div>
      <div className="relative">
        {!composerText ? (
          <span className="pointer-events-none absolute left-0 top-1.5 font-sans text-base text-muted-foreground">
            How can I help you today?
          </span>
        ) : null}
        <div
          id={taskPromptId}
          ref={composerEditorRef}
          role="textbox"
          aria-label="Task prompt"
          aria-multiline="true"
          aria-describedby={taskPromptHelpId}
          contentEditable
          suppressContentEditableWarning
          onInput={handleEditorInput}
          onKeyDown={handleComposerKeyDown}
          className={`${textareaMinHeightClass} max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-0 py-1.5 font-sans text-base leading-6 text-foreground outline-none`}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p id={taskPromptHelpId} className="font-sans text-xs text-muted-foreground">
          {gatewayConnected
            ? projectSelected
              ? 'Type @ to reference project files/folders. Enter sends, Shift+Enter new line.'
              : 'Enter sends, Shift+Enter new line. Select a project if you want file-aware context.'
            : 'Gateway disconnected. Connect to enable sending.'}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant={webSearchEnabled ? 'default' : 'outline'}
            className="h-9 rounded-xl px-2.5 font-sans text-[11px]"
            onClick={() => onWebSearchEnabledChange(!webSearchEnabled)}
          >
            Web Search {webSearchEnabled ? 'On' : 'Off'}
          </Button>
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
        <ScrollArea className="h-full px-2">
          {isInitialWorkspace ? (
            <div className="mx-auto grid h-full w-full max-w-[920px] place-items-center px-4">
              <div className="w-full">
                <p className="mb-3 text-[clamp(1.6rem,2.4vw,2.2rem)] tracking-tight text-foreground">Let's knock something off your list</p>
                <div className="mt-4 grid gap-2">
                  {renderPendingApprovalsPanel()}
                  {renderCoworkComposer('min-h-[90px]')}
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-[860px] gap-3 px-4" role="log" aria-live="polite" aria-relevant="additions">
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
            <div className="mx-auto grid w-full max-w-[920px] gap-2 px-4">
              {renderPendingApprovalsPanel()}
              {renderCoworkComposer('min-h-[84px]')}
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
    )
  );
}
