import { ChevronRight, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ChatMessage, FileChangeSummary } from '@/app-types';
import { FileChangeSummaryCard } from '@/components/chat/file-change-summary';
import { chatMarkdownComponents } from '@/lib/chat-markdown';
import { extractInlineActivityCards } from '../cowork-utils';

type ChatMessageListProps = {
  visibleMessages: ChatMessage[];
  expandedInlineActivityId: string | null;
  onToggleInlineActivity: (cardId: string) => void;
  sending: boolean;
  awaitingStream: boolean;
  assistantActivityLabel: string;
  fileChangeSummary?: FileChangeSummary | null;
  undoingFileChanges?: boolean;
  onUndoFileChanges?: () => void;
  onReviewFileChanges?: () => void;
  chatBottomRef: React.RefObject<HTMLDivElement | null>;
};

function toCompactCardLabel(label: string) {
  const raw = label.trim();
  const colonIndex = raw.indexOf(':');
  if (colonIndex <= 0 || colonIndex >= raw.length - 1) {
    return raw;
  }

  const verb = raw.slice(0, colonIndex).trim();
  const pathPart = raw.slice(colonIndex + 1).trim();
  const normalized = pathPart.replace(/\\/g, '/');
  const fileName = normalized.split('/').filter(Boolean).pop();
  return fileName ? `${verb}: ${fileName}` : raw;
}

export function ChatMessageList({
  visibleMessages,
  expandedInlineActivityId,
  onToggleInlineActivity,
  sending,
  awaitingStream,
  assistantActivityLabel,
  fileChangeSummary,
  undoingFileChanges = false,
  onUndoFileChanges,
  onReviewFileChanges,
  chatBottomRef,
}: ChatMessageListProps) {
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-3 px-4 pb-6 pt-12" role="log" aria-live="polite" aria-relevant="additions">
      {visibleMessages.map((message) => {
        const inline = extractInlineActivityCards(message);
        const isUser = message.role === 'user';

        return (
          <article key={message.id} className="mx-auto w-full max-w-[720px] px-2 py-0 font-sans text-sm text-foreground">
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
                  const compactLabel = toCompactCardLabel(card.label);
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
                        onClick={() => onToggleInlineActivity(card.id)}
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
  );
}
