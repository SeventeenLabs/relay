import type { MessageUsage } from '@/app-types';
import { formatCostUsd, formatTokenCount } from '@/lib/token-usage';

/** Rough estimate: ~4 chars per token for typical English/code text. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

type TokenBadgeProps = {
  usage?: MessageUsage;
  /** Fall back to estimating from raw text when no real usage data is available. */
  text?: string;
};

export function TokenBadge({ usage, text }: TokenBadgeProps) {
  const isEstimated = !usage;
  const total = usage
    ? usage.inputTokens + usage.outputTokens
    : text ? estimateTokens(text) : 0;

  if (total === 0) return null;

  const prefix = isEstimated ? '~' : '';
  const label = [
    `${prefix}${formatTokenCount(total)} tokens`,
    !isEstimated && usage?.costUsd !== undefined ? formatCostUsd(usage.costUsd) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const title = isEstimated
    ? `~${total.toLocaleString()} tokens (estimated from text length)`
    : [
        `Input: ${usage!.inputTokens.toLocaleString()} tokens`,
        `Output: ${usage!.outputTokens.toLocaleString()} tokens`,
        usage!.costUsd !== undefined ? `Estimated cost: ${formatCostUsd(usage!.costUsd)}` : null,
        usage!.model ? `Model: ${usage!.model}` : null,
      ]
        .filter(Boolean)
        .join('\n');

  return (
    <span
      className="mt-1 inline-block font-sans text-[11px] text-muted-foreground/60 select-none"
      title={title}
    >
      {label}
    </span>
  );
}
