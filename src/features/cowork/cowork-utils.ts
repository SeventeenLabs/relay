import type {
  ChatActivityItem,
  ChatMessage,
  CoworkProjectTaskStatus,
  PendingApprovalAction,
} from '@/app-types';

export type InlineActivityCard = {
  id: string;
  label: string;
  details: string;
  tone: 'neutral' | 'success' | 'danger';
};

export function approvalRiskClasses(riskLevel: PendingApprovalAction['riskLevel']): string {
  if (riskLevel === 'critical') {
    return 'border-destructive/35 bg-destructive/10 text-destructive';
  }
  if (riskLevel === 'high') {
    return 'border-orange-500/35 bg-orange-500/12 text-orange-700 dark:text-orange-300';
  }
  if (riskLevel === 'medium') {
    return 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300';
  }
  return 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300';
}

export function taskStatusClasses(status: CoworkProjectTaskStatus): string {
  if (status === 'completed') {
    return 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300';
  }
  if (status === 'failed' || status === 'rejected') {
    return 'border-destructive/35 bg-destructive/10 text-destructive';
  }
  if (status === 'needs_approval') {
    return 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300';
  }
  if (status === 'approved') {
    return 'border-blue-500/40 bg-blue-500/12 text-blue-700 dark:text-blue-300';
  }
  if (status === 'running') {
    return 'border-violet-500/35 bg-violet-500/12 text-violet-700 dark:text-violet-300';
  }
  return 'border-border bg-muted text-muted-foreground';
}

export function taskStatusLabel(status: CoworkProjectTaskStatus): string {
  if (status === 'needs_approval') return 'Needs approval';
  return status.replace('_', ' ');
}

export function isSystemLikeMessage(message: ChatMessage): boolean {
  // Keep non-activity system noise hidden, but show structured activity updates/tool progress.
  return message.role === 'system' && message.meta?.kind !== 'activity';
}

export function extractInlineActivityCards(message: ChatMessage): { body: string; cards: InlineActivityCard[] } {
  if (message.meta?.kind !== 'activity') {
    return { body: message.text, cards: [] };
  }

  // Legacy inline card renderer removed: return simple plain-text activity output.
  const body = message.meta.items
    .map((item) => {
      const label = item.label?.trim() || 'Activity';
      const details = item.details?.trim() || '';
      return details ? `${label}\n${details}` : label;
    })
    .join('\n\n');

  return { body: body || message.text || 'Activity update', cards: [] };
}
