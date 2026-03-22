import { useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { ArrowUp, ChevronRight, Clock3, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatActivityItem, ChatMessage, ChatModelOption, LocalActionReceipt, LocalFilePlanAction } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { chatMarkdownComponents } from '@/lib/chat-markdown';

type TaskState = 'idle' | 'planned';
type CoworkRunPhase = 'idle' | 'sending' | 'streaming' | 'completed' | 'error';

type InlineActivityCard = {
  id: string;
  label: string;
  details: string;
  tone: 'neutral' | 'success' | 'danger';
};

type CoworkPageProps = {
  taskPrompt: string;
  workingFolder: string;
  taskState: TaskState;
  status: string;
  messages: ChatMessage[];
  rightPanelOpen: boolean;
  awaitingStream: boolean;
  streamingAssistantText: string;
  runPhase: CoworkRunPhase;
  runStatus: string;
  sessionKey: string;
  selectedModel: string;
  models: ChatModelOption[];
  modelsLoading: boolean;
  changingModel: boolean;
  desktopBridgeAvailable: boolean;
  localPlanActions: LocalFilePlanAction[];
  localPlanLoading: boolean;
  localApplyLoading: boolean;
  fileCreateLoading: boolean;
  localActionReceipts: LocalActionReceipt[];
  localActionSmokeRunning: boolean;
  fileDraftPath: string;
  fileDraftContent: string;
  sending: boolean;
  onTaskPromptChange: (value: string) => void;
  onWorkingFolderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onFileDraftPathChange: (value: string) => void;
  onFileDraftContentChange: (value: string) => void;
  onPickWorkingFolder: () => void | Promise<void>;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onCreateLocalPlan: () => void | Promise<void>;
  onApplyLocalPlan: () => void | Promise<void>;
  onCreateFileInWorkingFolder: () => void | Promise<void>;
  onRunLocalActionSmokeTest: () => void | Promise<void>;
};

const connectors = ['Web search', 'Desktop files', 'Gateway tools'];

function runPhaseClasses(phase: CoworkRunPhase): string {
  if (phase === 'completed') {
    return 'border-[rgba(47,122,88,0.35)] bg-[rgba(47,122,88,0.08)] text-[#2f7a58]';
  }
  if (phase === 'streaming' || phase === 'sending') {
    return 'border-[rgba(222,130,94,0.45)] bg-[rgba(222,130,94,0.12)] text-[#8a4b31]';
  }
  if (phase === 'error') {
    return 'border-[rgba(173,56,56,0.34)] bg-[rgba(173,56,56,0.1)] text-[#7f2c2c]';
  }
  return 'border-[rgba(98,96,90,0.3)] bg-[rgba(98,96,90,0.09)] text-[#4d4b45]';
}

function runPhaseLabel(phase: CoworkRunPhase): string {
  if (phase === 'sending') return 'Sending';
  if (phase === 'streaming') return 'Streaming';
  if (phase === 'completed') return 'Completed';
  if (phase === 'error') return 'Error';
  return 'Idle';
}

function isSystemLikeMessage(message: ChatMessage): boolean {
  return message.role === 'system' && message.meta?.kind !== 'activity';
}

function extractInlineActivityCards(message: ChatMessage): { body: string; cards: InlineActivityCard[] } {
  if (message.meta?.kind !== 'activity') {
    return { body: message.text, cards: [] };
  }

  const toCard = (item: ChatActivityItem): InlineActivityCard => ({
    id: item.id,
    label: item.label,
    details: item.details || `Raw event: ${item.label}`,
    tone: item.tone,
  });

  return { body: '', cards: message.meta.items.map(toCard) };
}

export function CoworkPage({
  taskPrompt,
  workingFolder,
  taskState,
  status,
  messages,
  rightPanelOpen,
  awaitingStream,
  streamingAssistantText: _streamingAssistantText,
  runPhase,
  runStatus,
  sessionKey,
  selectedModel,
  models,
  modelsLoading,
  changingModel,
  desktopBridgeAvailable,
  localPlanActions,
  localPlanLoading,
  localApplyLoading,
  fileCreateLoading,
  localActionReceipts,
  localActionSmokeRunning,
  fileDraftPath,
  fileDraftContent,
  sending,
  onTaskPromptChange,
  onWorkingFolderChange,
  onModelChange,
  onFileDraftPathChange,
  onFileDraftContentChange,
  onPickWorkingFolder,
  onSubmit,
  onCreateLocalPlan,
  onApplyLocalPlan,
  onCreateFileInWorkingFolder,
  onRunLocalActionSmokeTest,
}: CoworkPageProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [expandedSystemMessageId, setExpandedSystemMessageId] = useState<string | null>(null);
  const [expandedInlineActivityId, setExpandedInlineActivityId] = useState<string | null>(null);
  const canSend = taskPrompt.trim().length > 0 && !sending;
  const visibleMessages = useMemo(() => messages.filter((message) => !isSystemLikeMessage(message)), [messages]);
  const systemMessages = useMemo(
    () => messages.filter((message) => isSystemLikeMessage(message)).slice(-8).reverse(),
    [messages],
  );
  const isInitialWorkspace = visibleMessages.length === 0;

  const messageCounts = useMemo(() => {
    const user = messages.filter((message) => message.role === 'user').length;
    const assistant = messages.filter((message) => message.role === 'assistant').length;
    return { user, assistant };
  }, [messages]);

  const folderLabel = workingFolder.trim() || '(not set)';
  const selectedModelLabel = selectedModel
    ? models.find((model) => model.value === selectedModel)?.label || selectedModel
    : 'Default';

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

  return (
    <section
      className={`grid h-full w-full min-h-0 overflow-hidden transition-[grid-template-columns,gap] duration-200 ${
        rightPanelOpen
          ? 'gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px]'
          : 'gap-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_0px]'
      }`}
    >
      <div
        className={`grid h-full min-h-0 overflow-hidden bg-transparent ${
          isInitialWorkspace ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)_auto]'
        }`}
      >
        {!isInitialWorkspace ? (
          <header className="flex flex-wrap items-center gap-2 px-2 py-2">
            <p className="mr-1 text-sm font-medium text-foreground">Cowork</p>
            <Badge variant="outline" className={`rounded-full font-sans text-[11px] ${runPhaseClasses(runPhase)}`}>
              {runPhaseLabel(runPhase)}
            </Badge>
            <Badge variant="outline" className="rounded-full font-sans text-[11px]">
              {selectedModelLabel}
            </Badge>
            <p className="max-w-[45%] truncate font-sans text-xs text-muted-foreground" title={folderLabel}>
              {folderLabel}
            </p>
          </header>
        ) : null}

        <ScrollArea className="h-full px-2 py-4">
          {isInitialWorkspace ? (
            <div className="mx-auto grid h-full w-full max-w-[860px] place-items-center">
              <div className="w-full max-w-[640px]">
                <p className="mb-3 text-[clamp(1.8rem,2.8vw,2.5rem)] tracking-tight text-foreground">Let's knock something off your list</p>
                <div className="rounded-2xl border border-[rgba(31,31,28,0.1)] bg-[rgba(255,255,255,0.7)] p-4">
                  <p className="font-sans text-sm text-muted-foreground">
                    Cowork runs against your configured gateway and supports file-aware task context.
                  </p>
                </div>

                <form className="mt-4 rounded-[28px] border border-[rgba(31,31,28,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,248,243,0.95))] px-4 py-3.5 shadow-[0_16px_34px_rgba(24,23,20,0.08)]" onSubmit={onSubmit} ref={formRef}>
                  <Textarea
                    value={taskPrompt}
                    onChange={(event) => onTaskPromptChange(event.target.value)}
                    placeholder="How can I help you today?"
                    rows={2}
                    onKeyDown={handleComposerKeyDown}
                    aria-label="Task prompt"
                    className="min-h-[90px] resize-none border-0 bg-transparent px-0 py-1.5 font-sans text-[20px] leading-7 text-foreground shadow-none focus-visible:ring-0"
                  />
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-[rgba(31,31,28,0.08)] pt-3">
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="ghost" className="h-9 rounded-xl px-3 font-sans text-xs text-muted-foreground" aria-label="Select context">
                        Task context
                      </Button>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={selectedModel}
                        onChange={(event) => onModelChange(event.target.value)}
                        disabled={modelsLoading || changingModel || models.length === 0}
                        className="h-9 max-w-[240px] rounded-xl border border-[rgba(31,31,28,0.14)] bg-white px-3 font-sans text-xs text-foreground outline-none"
                      >
                        <option value="">Default model</option>
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
                        className="h-9 w-9 rounded-xl border-0 bg-[linear-gradient(120deg,#e5a48a,#d98765)] text-[#fffefb]"
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-right font-sans text-[11px] text-muted-foreground">Enter send, Shift+Enter new line</p>
                </form>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-[860px] gap-3">
              {visibleMessages.map((message) => {
                const inline = extractInlineActivityCards(message);

                return (
                  <article
                    key={message.id}
                    className={
                      message.role === 'user'
                        ? 'ml-auto w-[min(92%,700px)] px-2 py-1 text-right font-sans text-sm text-foreground'
                        : 'w-[min(95%,760px)] px-2 py-1 font-sans text-sm text-foreground'
                    }
                  >
                    <p
                      className={`mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
                        message.role === 'user' ? 'text-right' : ''
                      }`}
                    >
                      {message.role}
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
                              ? 'border-[rgba(173,56,56,0.28)] bg-[rgba(173,56,56,0.06)]'
                              : card.tone === 'success'
                                ? 'border-[rgba(47,122,88,0.28)] bg-[rgba(47,122,88,0.08)]'
                                : 'border-[rgba(31,31,28,0.14)] bg-[rgba(246,245,242,0.86)]';

                          return (
                            <div key={card.id} className="rounded-xl border border-[rgba(31,31,28,0.08)] bg-white">
                              <button
                                type="button"
                                className={`group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-[rgba(240,239,235,0.96)] ${toneClass}`}
                                onClick={() => setExpandedInlineActivityId((current) => (current === card.id ? null : card.id))}
                                title={card.details}
                              >
                                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[rgba(31,31,28,0.16)] bg-white text-muted-foreground">
                                  <FileText className="h-3 w-3" />
                                </span>
                                <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-foreground/90">{card.label}</span>
                                <ChevronRight
                                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                                    expandedInlineActivityId === card.id ? 'rotate-90' : 'group-hover:translate-x-0.5'
                                  }`}
                                />
                              </button>

                              {expandedInlineActivityId === card.id ? (
                                <div className="border-t border-[rgba(31,31,28,0.08)] px-3 py-2">
                                  <div className="text-[11px] leading-5 text-muted-foreground">
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
                <article className="w-[min(95%,760px)] px-2 py-1 font-sans text-sm text-muted-foreground">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-[rgba(31,31,28,0.06)] px-3 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Working...
                  </div>
                </article>
              )}
            </div>
          )}
        </ScrollArea>

        {!isInitialWorkspace ? (
          <div className="px-2 pb-3 pt-1">
            <div className="mx-auto grid w-full max-w-[860px] gap-2">
              <form className="rounded-[26px] border border-[rgba(31,31,28,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,248,243,0.95))] px-4 py-3.5 shadow-[0_12px_28px_rgba(24,23,20,0.08)]" onSubmit={onSubmit} ref={formRef}>
                <Textarea
                  value={taskPrompt}
                  onChange={(event) => onTaskPromptChange(event.target.value)}
                  placeholder="How can I help you today?"
                  rows={2}
                  onKeyDown={handleComposerKeyDown}
                  aria-label="Task prompt"
                  className="min-h-[84px] resize-none border-0 bg-transparent px-0 py-1.5 font-sans text-[18px] leading-7 text-foreground shadow-none focus-visible:ring-0"
                />
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-[rgba(31,31,28,0.08)] pt-3">
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" className="h-9 rounded-xl px-3 font-sans text-xs text-muted-foreground" aria-label="Select context">
                      Task context
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedModel}
                      onChange={(event) => onModelChange(event.target.value)}
                      disabled={modelsLoading || changingModel || models.length === 0}
                      className="h-9 max-w-[240px] rounded-xl border border-[rgba(31,31,28,0.14)] bg-white px-3 font-sans text-xs text-foreground outline-none"
                    >
                      <option value="">Default model</option>
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
                      className="h-9 w-9 rounded-xl border-0 bg-[linear-gradient(120deg,#e5a48a,#d98765)] text-[#fffefb]"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-right font-sans text-[11px] text-muted-foreground">Enter send, Shift+Enter new line</p>
              </form>
            </div>
          </div>
        ) : null}
      </div>

      <aside
        className={`grid min-h-0 w-full overflow-hidden transition-opacity duration-200 lg:grid-rows-[auto_auto_minmax(0,1fr)] ${
          rightPanelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="grid min-h-0 w-full gap-3">
          <Card className="rounded-2xl border-[rgba(31,31,28,0.1)] bg-[rgba(255,255,255,0.82)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Run status</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <Badge variant="outline" className={`w-fit rounded-full font-sans text-[11px] ${runPhaseClasses(runPhase)}`}>
                {runPhaseLabel(runPhase)}
              </Badge>
              <p className="font-sans text-xs text-muted-foreground">{runStatus}</p>
              <p className="font-sans text-xs text-muted-foreground">{status}</p>
              {sessionKey ? <p className="font-sans text-[11px] text-muted-foreground">Session: {sessionKey}</p> : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-[rgba(31,31,28,0.1)] bg-[rgba(255,255,255,0.82)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Working folder</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <div className="flex items-center gap-2">
                <Input
                  value={workingFolder}
                  onChange={(event) => onWorkingFolderChange(event.target.value)}
                  placeholder="/Downloads"
                  className="font-sans"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => void onPickWorkingFolder()}>
                  Browse
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void onCreateLocalPlan()} disabled={localPlanLoading}>
                  {localPlanLoading ? 'Planning...' : 'Generate plan'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="border-0 bg-[linear-gradient(120deg,#ea9f7d,#de825e)] text-[#fffefb]"
                  onClick={() => void onApplyLocalPlan()}
                  disabled={localApplyLoading || localPlanActions.length === 0}
                >
                  {localApplyLoading ? 'Applying...' : `Apply ${localPlanActions.length}`}
                </Button>
              </div>
              <div className="grid gap-2 rounded-lg border border-[rgba(31,31,28,0.1)] bg-white p-2">
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Create file</p>
                <Input
                  value={fileDraftPath}
                  onChange={(event) => onFileDraftPathChange(event.target.value)}
                  placeholder="notes/todo.md"
                  className="font-sans text-xs"
                />
                <Textarea
                  value={fileDraftContent}
                  onChange={(event) => onFileDraftContentChange(event.target.value)}
                  rows={5}
                  placeholder="Write file contents..."
                  className="font-sans text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onCreateFileInWorkingFolder()}
                  disabled={fileCreateLoading}
                >
                  {fileCreateLoading ? 'Creating...' : 'Create file in folder'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onRunLocalActionSmokeTest()}
                  disabled={localActionSmokeRunning}
                >
                  {localActionSmokeRunning ? 'Running smoke test...' : 'Run local action smoke test'}
                </Button>
              </div>
              {!desktopBridgeAvailable && (
                <p className="font-sans text-[11px] text-muted-foreground">Desktop app required for native folder access.</p>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0 rounded-2xl border-[rgba(31,31,28,0.1)] bg-[rgba(255,255,255,0.82)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Context</CardTitle>
            </CardHeader>
            <CardContent className="grid h-full min-h-0 gap-2 pt-0">
              <div>
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Connectors</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {connectors.map((connector) => (
                    <Badge key={connector} variant="outline" className="font-sans text-[11px]">
                      {connector}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-[rgba(31,31,28,0.1)] bg-white p-2">
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Conversation</p>
                <p className="font-sans text-xs text-foreground">{messageCounts.user} user message(s), {messageCounts.assistant} assistant message(s)</p>
              </div>
              <div className="rounded-lg border border-[rgba(31,31,28,0.1)] bg-white p-2">
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">System activity</p>
                {systemMessages.length === 0 ? (
                  <p className="font-sans text-xs text-muted-foreground">No system events yet.</p>
                ) : (
                  <div className="mt-1 grid gap-1.5">
                    {systemMessages.map((message) => {
                      const [headline, ...rest] = message.text.split('\n');
                      const details = rest.join('\n').trim();
                      const isExpanded = expandedSystemMessageId === message.id;

                      const statusToneClass =
                        /failed|error|unavailable/i.test(headline)
                          ? 'border-[rgba(173,56,56,0.26)] bg-[rgba(173,56,56,0.06)]'
                          : 'border-[rgba(31,31,28,0.12)] bg-[rgba(246,245,242,0.88)]';

                      return (
                        <div key={message.id} className="rounded-xl border border-[rgba(31,31,28,0.08)] bg-white">
                          <button
                            type="button"
                            title={details ? `${headline}\n\n${details}` : headline}
                            className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors hover:bg-[rgba(240,239,235,0.96)] ${statusToneClass}`}
                            onClick={() => setExpandedSystemMessageId((current) => (current === message.id ? null : message.id))}
                          >
                            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[rgba(31,31,28,0.16)] bg-white text-muted-foreground">
                              <Clock3 className="h-3 w-3" />
                            </span>
                            <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-foreground/90">
                              {headline || 'System event'}
                            </span>
                            <ChevronRight
                              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                                isExpanded ? 'rotate-90' : 'group-hover:translate-x-0.5'
                              }`}
                            />
                          </button>

                          {isExpanded && details ? (
                            <div className="border-t border-[rgba(31,31,28,0.08)] px-2.5 py-2">
                              <div className="max-h-40 overflow-auto text-[11px] leading-5 text-muted-foreground">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                                  {details}
                                </ReactMarkdown>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-[rgba(31,31,28,0.1)] bg-white p-2">
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Local actions</p>
                {localActionReceipts.length === 0 ? (
                  <p className="font-sans text-xs text-muted-foreground">No local actions yet.</p>
                ) : (
                  <div className="mt-1 grid gap-1">
                    {localActionReceipts.slice(0, 6).map((item) => (
                      <div key={`${item.id}-${item.path}`} className="rounded border border-[rgba(31,31,28,0.08)] px-2 py-1">
                        <p className="font-sans text-[11px] text-foreground">
                          {item.type} • {item.status}
                        </p>
                        <p className="truncate font-sans text-[10px] text-muted-foreground">{item.path}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </aside>
    </section>
  );
}
