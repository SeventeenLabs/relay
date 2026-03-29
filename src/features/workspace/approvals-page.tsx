import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Search, XCircle } from 'lucide-react';

import type { PendingApprovalAction } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

type ApprovalsPageProps = {
  projectTitle?: string;
  pendingApprovals: PendingApprovalAction[];
  onApprovePendingAction: (approvalId: string) => void;
  onRejectPendingAction: (approvalId: string, reason: string) => void;
};

export function ApprovalsPage({
  projectTitle,
  pendingApprovals,
  onApprovePendingAction,
  onRejectPendingAction,
}: ApprovalsPageProps) {
  const [query, setQuery] = useState('');
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [bulkRejectReason, setBulkRejectReason] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return pendingApprovals;
    }
    return pendingApprovals.filter((item) =>
      [item.summary, item.path, item.scopeName, item.projectTitle ?? ''].join(' ').toLowerCase().includes(q),
    );
  }, [pendingApprovals, query]);

  const handleApproveAllFiltered = () => {
    for (const approval of filtered) {
      onApprovePendingAction(approval.id);
    }
  };

  const handleRejectAllFiltered = () => {
    const reason = bulkRejectReason.trim();
    if (!reason) {
      return;
    }
    for (const approval of filtered) {
      onRejectPendingAction(approval.id, reason);
    }
    setBulkRejectReason('');
  };

  return (
    <section className="grid h-full w-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4">
      <header className="rounded-2xl border border-border/60 bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="size-5 text-amber-600" />
          <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
          <Badge variant="outline" className="rounded-full text-[10px]">
            {projectTitle?.trim() || 'Current scope'}
          </Badge>
          <Badge variant="outline" className="rounded-full text-[10px] border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300">
            {pendingApprovals.length} pending
          </Badge>
        </div>
        <p className="mt-1 font-sans text-sm text-muted-foreground">
          Review high-risk actions and decide what can proceed.
        </p>
      </header>

      <div className="rounded-xl border border-border/60 bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Search className="size-3.5 text-muted-foreground/60" />
          <Input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search approvals..."
            className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
          />
          <Badge variant="outline" className="rounded-full text-[10px]">
            {filtered.length} filtered
          </Badge>
        </div>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <Input
            value={bulkRejectReason}
            onChange={(event) => setBulkRejectReason(event.target.value)}
            placeholder="Bulk reject reason (required)"
            className="h-8 text-xs"
          />
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={handleApproveAllFiltered}
              disabled={filtered.length === 0}
            >
              <CheckCircle2 className="mr-1 size-3.5" />
              Approve all filtered
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={handleRejectAllFiltered}
              disabled={filtered.length === 0 || !bulkRejectReason.trim()}
            >
              <XCircle className="mr-1 size-3.5" />
              Reject all filtered
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-border/60 bg-card">
        <ScrollArea className="h-full">
          <div className="grid gap-2 p-3">
            {filtered.length === 0 ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-border/70 bg-background px-3 py-10 text-center">
                <div>
                  <CheckCircle2 className="mx-auto mb-1.5 size-4 text-emerald-600" />
                  <p className="font-sans text-sm text-foreground">No pending approvals</p>
                  <p className="mt-1 font-sans text-[11px] text-muted-foreground">New approval requests will appear here.</p>
                </div>
              </div>
            ) : (
              filtered.map((approval) => {
                const rejectReason = rejectReasons[approval.id] || '';
                return (
                  <div key={approval.id} className="rounded-lg border border-border/60 bg-background px-3 py-2.5">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="font-sans text-sm font-medium text-foreground">{approval.summary}</p>
                      <Badge
                        variant="outline"
                        className={`rounded-full text-[10px] uppercase ${
                          approval.riskLevel === 'critical'
                            ? 'border-destructive/35 bg-destructive/10 text-destructive'
                            : approval.riskLevel === 'high'
                              ? 'border-orange-500/35 bg-orange-500/12 text-orange-700 dark:text-orange-300'
                              : approval.riskLevel === 'medium'
                                ? 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300'
                                : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {approval.riskLevel}
                      </Badge>
                    </div>
                    <p className="font-sans text-[11px] text-muted-foreground">Scope: {approval.scopeName}</p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{approval.path}</p>
                    {approval.preview ? (
                      <pre className="mt-1.5 max-h-28 overflow-auto rounded border border-border/60 bg-card px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                        {approval.preview}
                      </pre>
                    ) : null}
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <Input
                        value={rejectReason}
                        onChange={(event) =>
                          setRejectReasons((current) => ({
                            ...current,
                            [approval.id]: event.target.value,
                          }))
                        }
                        placeholder="Reason required for reject"
                        className="h-8 text-xs"
                      />
                      <div className="flex items-center gap-1.5">
                        <Button type="button" size="sm" className="h-8" onClick={() => onApprovePendingAction(approval.id)}>
                          <CheckCircle2 className="mr-1 size-3.5" />
                          Approve
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => onRejectPendingAction(approval.id, rejectReason)}
                          disabled={!rejectReason.trim()}
                        >
                          <XCircle className="mr-1 size-3.5" />
                          Reject
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1 font-sans text-[10px] text-muted-foreground">
                      <Lock className="mr-1 inline size-3" />
                      Reject requires a reason for auditability.
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </section>
  );
}
