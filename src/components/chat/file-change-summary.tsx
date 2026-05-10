import { Loader2, RotateCcw, SquareArrowOutUpRight } from 'lucide-react';

import type { FileChangeSummary } from '@/app-types';
import { Button } from '@/components/ui/button';

type FileChangeSummaryCardProps = {
  summary: FileChangeSummary;
  undoing?: boolean;
  onUndo: () => void;
  onReview: () => void;
};

export function FileChangeSummaryCard({ summary, undoing = false, onUndo, onReview }: FileChangeSummaryCardProps) {
  return (
    <div className="rounded-xl border border-border/80 bg-card">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="font-sans text-sm font-medium text-foreground">
          {summary.changedCount} file{summary.changedCount === 1 ? '' : 's'} changed
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onUndo} disabled={undoing}>
            {undoing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
            Undo
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReview}>
            Review
            <SquareArrowOutUpRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="border-t border-border/70 px-3 py-2">
        <div className="grid gap-1">
          {summary.files.slice(0, 8).map((file) => (
            <div key={file.path} className="flex items-center justify-between gap-2">
              <span className="truncate font-sans text-xs text-foreground/90">{file.path}</span>
              <span className="shrink-0 font-mono text-xs">
                <span className="text-emerald-500">+{file.added}</span>{' '}
                <span className="text-rose-500">-{file.deleted}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
