import type { MessageUsage } from '@/app-types';

// Approximate pricing per million tokens (USD).
// Prices are estimates based on typical Claude/OpenRouter API pricing.
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // claude-sonnet-4-x variants
  'claude-sonnet-4': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-3-5-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-3-7-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  // claude-haiku
  'claude-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  // claude-opus
  'claude-opus': { inputPer1M: 15.0, outputPer1M: 75.0 },
};

const DEFAULT_PRICING = { inputPer1M: 3.0, outputPer1M: 15.0 };

function getPricing(model?: string) {
  if (!model) return DEFAULT_PRICING;
  const lower = model.toLowerCase();
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) return price;
  }
  return DEFAULT_PRICING;
}

export function calcCostUsd(inputTokens: number, outputTokens: number, model?: string): number {
  const { inputPer1M, outputPer1M } = getPricing(model);
  return (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
}

/** Parse a usage object from the raw gateway event payload (handles multiple field name conventions). */
export function parseUsageFromPayload(
  payload: Record<string, unknown>,
  model?: string,
): MessageUsage | undefined {
  // Try nested `usage` object first (OpenClaw / Anthropic style)
  const nested = payload.usage;
  if (nested && typeof nested === 'object') {
    const u = nested as Record<string, unknown>;
    const inputTokens =
      typeof u.inputTokens === 'number' ? u.inputTokens :
      typeof u.input_tokens === 'number' ? u.input_tokens :
      typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined;
    const outputTokens =
      typeof u.outputTokens === 'number' ? u.outputTokens :
      typeof u.output_tokens === 'number' ? u.output_tokens :
      typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined;

    if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
      const resolvedModel = typeof u.model === 'string' ? u.model : model;
      return {
        inputTokens,
        outputTokens,
        model: resolvedModel,
        costUsd: calcCostUsd(inputTokens, outputTokens, resolvedModel),
      };
    }
  }

  // Try flat top-level fields
  const flatInput =
    typeof payload.inputTokens === 'number' ? payload.inputTokens :
    typeof payload.input_tokens === 'number' ? payload.input_tokens :
    typeof payload.promptTokens === 'number' ? payload.promptTokens : undefined;

  const flatOutput =
    typeof payload.outputTokens === 'number' ? payload.outputTokens :
    typeof payload.output_tokens === 'number' ? payload.output_tokens :
    typeof payload.completionTokens === 'number' ? payload.completionTokens : undefined;

  if (typeof flatInput === 'number' && typeof flatOutput === 'number') {
    return {
      inputTokens: flatInput,
      outputTokens: flatOutput,
      model,
      costUsd: calcCostUsd(flatInput, flatOutput, model),
    };
  }

  return undefined;
}

export function addUsage(a: MessageUsage, b: MessageUsage): MessageUsage {
  const combined: MessageUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  combined.costUsd = calcCostUsd(combined.inputTokens, combined.outputTokens, a.model ?? b.model);
  return combined;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatCostUsd(usd: number): string {
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

// ── Daily persistence ─────────────────────────────────────────────────────────

const DAILY_KEY_PREFIX = 'relay.daily-usage.';

function todayKey(): string {
  const d = new Date();
  return `${DAILY_KEY_PREFIX}${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function loadTodayUsage(): MessageUsage {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const parsed = JSON.parse(raw) as Partial<MessageUsage>;
    return {
      inputTokens: parsed.inputTokens ?? 0,
      outputTokens: parsed.outputTokens ?? 0,
      costUsd: parsed.costUsd ?? 0,
    };
  } catch {
    return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
}

export function accumulateTodayUsage(delta: MessageUsage): void {
  try {
    const current = loadTodayUsage();
    const next: MessageUsage = {
      inputTokens: current.inputTokens + delta.inputTokens,
      outputTokens: current.outputTokens + delta.outputTokens,
      costUsd: (current.costUsd ?? 0) + (delta.costUsd ?? 0),
    };
    localStorage.setItem(todayKey(), JSON.stringify(next));
  } catch {
    // localStorage unavailable — non-fatal
  }
}
