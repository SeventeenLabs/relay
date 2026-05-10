import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { PendingApprovalAction } from '@/app-types';
import { approvalRiskClasses } from '../cowork-utils';

type PendingApprovalsPanelProps = {
  headingId: string;
  pendingApprovals: PendingApprovalAction[];
  approvalRejectReasons: Record<string, string>;
  onRejectReasonChange: (approvalId: string, value: string) => void;
  onApprovePendingAction: (approvalId: string) => void;
  onRejectPendingAction: (approvalId: string, reason: string) => void;
};

export function PendingApprovalsPanel({
  headingId,
  pendingApprovals,
  approvalRejectReasons,
  onRejectReasonChange,
  onApprovePendingAction,
  onRejectPendingAction,
}: PendingApprovalsPanelProps) {
  if (pendingApprovals.length === 0) {
    return null;
  }

  return (
    <Card
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      data-testid="pending-approvals-card"
      aria-labelledby={headingId}
    >
      <CardHeader className="border-b border-border/80 pb-2">
        <CardTitle id={headingId} className="flex items-center justify-between gap-2 text-sm">
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
            <div
              key={approval.id}
              className="rounded-xl border border-border bg-background p-2.5"
              data-testid={`pending-approval-${approval.id}`}
            >
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
                  <p className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
                    {approval.preview}
                  </p>
                </div>
              ) : null}

              <label htmlFor={rejectReasonId} className="sr-only">
                Rejection reason for {approval.summary}
              </label>
              <Input
                id={rejectReasonId}
                data-testid={`pending-approval-reason-${approval.id}`}
                value={rejectReason}
                onChange={(event) => onRejectReasonChange(approval.id, event.target.value)}
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
}
