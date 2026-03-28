import type {
  OperatorCompiledPlan,
  OperatorCompiledStep,
  OperatorDefinition,
  OperatorRoutingPolicy,
} from '@/app-types';

type ResearchOperatorInput = {
  topic: string;
  depth: 'light' | 'standard' | 'deep';
  deliverBy?: string;
};

export function createDefaultResearchRoutingPolicy(): OperatorRoutingPolicy {
  return {
    costAware: true,
    fallbackTiers: ['fast', 'reasoning', 'verify'],
    verifyWithSecondModel: false,
  };
}

export function createDefaultResearchInputSchema(): OperatorDefinition['inputSchema'] {
  return [
    { key: 'topic', label: 'Topic', type: 'string', required: true },
    { key: 'depth', label: 'Depth', type: 'enum', required: true, options: ['light', 'standard', 'deep'] },
    { key: 'deliverBy', label: 'Deadline', type: 'string', required: false },
  ];
}

export function createDefaultResearchOutputRequirements(): OperatorDefinition['outputRequirements'] {
  return [
    { key: 'executive_summary', label: 'Executive Summary section', type: 'markdown_section', required: true, value: 'Executive Summary' },
    { key: 'key_findings', label: 'Key Findings section', type: 'markdown_section', required: true, value: 'Key Findings' },
    { key: 'source_links', label: 'At least 2 links', type: 'min_links', required: true, value: 2 },
    { key: 'min_length', label: 'Minimum length 400', type: 'min_length', required: true, value: 400 },
  ];
}

export function createDefaultResearchSuccessCriteria(): string[] {
  return [
    'Report includes executive summary and key findings.',
    'Report includes actionable next steps.',
    'Source references meet minimum threshold.',
  ];
}

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function compileResearchOperatorPlan(
  operator: OperatorDefinition,
  input: ResearchOperatorInput,
): OperatorCompiledPlan {
  const steps: OperatorCompiledStep[] = [
    {
      id: makeId('op-step'),
      key: 'scope',
      label: 'Scope research goals',
      mode: 'analysis',
      modelTier: 'fast',
      promptTemplate: 'Clarify objectives, assumptions, and scope boundaries for: {{topic}}.',
    },
    {
      id: makeId('op-step'),
      key: 'collect',
      label: 'Collect source evidence',
      mode: 'gather',
      modelTier: 'fast',
      promptTemplate: 'Gather high-signal source evidence and supporting data for: {{topic}}.',
    },
    {
      id: makeId('op-step'),
      key: 'draft',
      label: 'Draft report and summary',
      mode: 'synthesis',
      modelTier: input.depth === 'deep' ? 'reasoning' : 'fast',
      promptTemplate: 'Draft a structured markdown report for {{topic}} with summary, findings, sources, and recommendations.',
    },
    {
      id: makeId('op-step'),
      key: 'validate',
      label: 'Validate completeness',
      mode: 'validation',
      modelTier: 'verify',
      promptTemplate: 'Validate report quality and required sections for {{topic}} against operator requirements.',
      validates: operator.outputRequirements.map((item) => item.key),
    },
  ];

  return {
    operatorId: operator.id,
    projectId: operator.projectId,
    kind: operator.kind,
    title: `${operator.name}: ${input.topic}`,
    createdAt: Date.now(),
    input: {
      topic: input.topic.trim(),
      depth: input.depth,
      deliverBy: input.deliverBy?.trim() || undefined,
    },
    steps,
    successCriteria: operator.successCriteria,
    routingPolicy: operator.routingPolicy,
  };
}

export function validateResearchOperatorInput(input: ResearchOperatorInput): string | null {
  if (!input.topic.trim()) {
    return 'Topic is required.';
  }
  if (!['light', 'standard', 'deep'].includes(input.depth)) {
    return 'Depth is invalid.';
  }
  return null;
}

