import type {
  AppConfig,
  CoworkProgressStage,
  CoworkProgressStep,
  CoworkProject,
  CoworkProjectTask,
  CoworkProjectTaskStatus,
  GatewayConnectionProfile,
  HermesTransport,
  OperatorDefinition,
  OperatorRun,
  OutcomePipeline,
  OutcomePipelineRun,
  PendingApprovalAction,
  PendingApprovalDecision,
  ProjectKnowledgeItem,
} from '../app-types.js';
import { DEFAULT_HERMES_GATEWAY_URL, DEFAULT_HERMES_TRANSPORT } from '../lib/hermes-constants.js';
import {
  createDefaultResearchInputSchema,
  createDefaultResearchOutputRequirements,
  createDefaultResearchRoutingPolicy,
  createDefaultResearchSuccessCriteria,
} from '../lib/operator-compiler.js';

export const LOCAL_CONFIG_KEY = 'relay.config';
export const GATEWAY_CONNECTIONS_STORAGE_KEY = 'relay.gateway.connections.v1';
export const DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY = 'relay.gateway.connections.default.v1';
export const COWORK_PROJECTS_STORAGE_KEY = 'relay.cowork.projects.v1';
export const COWORK_ACTIVE_PROJECT_STORAGE_KEY = 'relay.cowork.projects.active.v1';
export const COWORK_TASKS_STORAGE_KEY = 'relay.cowork.tasks.v1';
export const COWORK_PROJECT_KNOWLEDGE_STORAGE_KEY = 'relay.cowork.project.knowledge.v1';
export const COWORK_WEB_SEARCH_MODE_STORAGE_KEY = 'relay.cowork.websearch.v1';
export const CHAT_DRAFT_STORAGE_KEY = 'relay.chat.draft.v1';
export const COWORK_DRAFT_STORAGE_KEY = 'relay.cowork.draft.v1';
export const SCHEDULED_JOB_PROJECT_LINKS_STORAGE_KEY = 'relay.scheduled.project-links.v1';
export const OUTCOME_PIPELINES_STORAGE_KEY = 'relay.outcome-pipelines.v1';
export const OUTCOME_PIPELINE_RUNS_STORAGE_KEY = 'relay.outcome-pipeline-runs.v1';
export const OPERATOR_DEFINITIONS_STORAGE_KEY = 'relay.operators.definitions.v1';
export const OPERATOR_RUNS_STORAGE_KEY = 'relay.operators.runs.v1';

export const DEFAULT_TRANSPORT: HermesTransport = DEFAULT_HERMES_TRANSPORT;

export const defaultConfig: AppConfig = {
  backendType: 'hermes',
  transport: DEFAULT_TRANSPORT,
  gatewayUrl: DEFAULT_HERMES_GATEWAY_URL,
  gatewayToken: '',
};

export type AppPage = 'chat' | 'cowork' | 'project' | 'settings';
export type SettingsSection = 'Profile' | 'Appearance' | 'System Prompt' | 'Gateway' | 'Connectors' | 'Account' | 'Privacy' | 'Developer';

export const COWORK_SEND_SPINNER_MS = 300;
export const COWORK_PREP_TIMEOUT_MS = 15_000;
export const COWORK_STREAM_WATCHDOG_MS = 45_000;
export const MAX_LOCAL_ACTIONS_PER_RUN = 20;
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
export const COWORK_CONTEXT_CONNECTORS = ['Web search', 'Desktop files', 'Gateway tools'];

const COWORK_PROGRESS_SEQUENCE: Array<{ stage: CoworkProgressStage; label: string }> = [
  { stage: 'planning', label: 'Planning' },
  { stage: 'decomposition', label: 'Decomposition' },
  { stage: 'executing_workstreams', label: 'Executing workstreams' },
  { stage: 'synthesizing_outputs', label: 'Synthesizing outputs' },
  { stage: 'deliverables', label: 'Deliverables' },
];

export function createInitialCoworkProgressSteps(): CoworkProgressStep[] {
  return COWORK_PROGRESS_SEQUENCE.map((item) => ({
    stage: item.stage,
    label: item.label,
    status: 'pending',
  }));
}

export function isDestructiveLocalAction(actionType: PendingApprovalAction['actionType']): boolean {
  return actionType === 'delete' || actionType === 'rename';
}

export function normalizeReplaceInput(text: string): string {
  if (!text) {
    return '';
  }

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

export type ApprovalResolverDecision = {
  decision: PendingApprovalDecision;
  reason?: string;
  expired?: boolean;
};

export type ApprovalResolverEntry = {
  resolve: (value: ApprovalResolverDecision) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type RelayE2EPendingApprovalInput = Partial<PendingApprovalAction> & {
  actionType?: PendingApprovalAction['actionType'];
};

export type RelayE2EBridge = {
  enqueuePendingApproval: (input?: RelayE2EPendingApprovalInput) => string;
  clearPendingApprovals: () => void;
  getPendingApprovals: () => PendingApprovalAction[];
};

export type CoworkRunProjectContext = {
  projectId: string;
  projectTitle: string;
  rootFolder: string;
  startedAt: number;
};

export type CoworkTaskQueueEntry = {
  taskId: string;
  runId?: string;
  status: CoworkProjectTaskStatus;
};

export function validateProjectRelativePath(inputPath: string, options?: { allowEmpty?: boolean }): { ok: true } | { ok: false; reason: string } {
  const raw = (inputPath ?? '').trim();
  if (!raw) {
    return options?.allowEmpty ? { ok: true } : { ok: false, reason: 'Path is required.' };
  }
  const normalized = raw.replace(/\\/g, '/');
  const hasControlChars = Array.from(normalized).some((char) => char.charCodeAt(0) < 32);
  if (hasControlChars) return { ok: false, reason: 'Path contains invalid control characters.' };
  if (normalized.startsWith('/') || normalized.startsWith('~/') || /^[a-zA-Z]:\//.test(normalized)) {
    return { ok: false, reason: 'Absolute paths are not allowed for project-bound actions.' };
  }
  if (normalized === '.' || normalized === './') return { ok: false, reason: 'A concrete relative path is required.' };
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return { ok: false, reason: 'Parent directory traversal is not allowed.' };
  }
  return { ok: true };
}

export function extractProjectFileMentions(inputText: string): string[] {
  if (!inputText) return [];
  const mentions = new Set<string>();
  const quotedPattern = /@project:"([^"]+)"/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedPattern.exec(inputText)) !== null) {
    const nextPath = quotedMatch[1]?.trim();
    if (nextPath) mentions.add(nextPath);
  }
  const unquotedPattern = /@project\/([^\s,;]+)/g;
  let unquotedMatch: RegExpExecArray | null;
  while ((unquotedMatch = unquotedPattern.exec(inputText)) !== null) {
    const nextPath = unquotedMatch[1]?.trim();
    if (nextPath) mentions.add(nextPath);
  }
  return Array.from(mentions);
}

export function loadCoworkProjects(): CoworkProject[] {
  try {
    const raw = localStorage.getItem(COWORK_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): CoworkProject | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const description = typeof record.description === 'string' ? record.description.trim() : '';
        const instructionsRaw = typeof record.instructions === 'string' ? record.instructions.trim() : '';
        const workspaceFolder = typeof record.workspaceFolder === 'string' ? record.workspaceFolder.trim() : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !name || !workspaceFolder) return null;
        return { id, name, description: description || undefined, instructions: instructionsRaw || description || undefined, workspaceFolder, createdAt, updatedAt };
      })
      .filter((project): project is CoworkProject => project !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function loadGatewayConnectionProfiles(): GatewayConnectionProfile[] {
  try {
    const raw = localStorage.getItem(GATEWAY_CONNECTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): GatewayConnectionProfile | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const rawGatewayUrl = typeof record.gatewayUrl === 'string' ? record.gatewayUrl.trim() : '';
        const backendType: AppConfig['backendType'] = 'hermes';
        const transport: HermesTransport = DEFAULT_TRANSPORT;
        const gatewayUrl = rawGatewayUrl || DEFAULT_HERMES_GATEWAY_URL;
        const gatewayToken = typeof record.gatewayToken === 'string' ? record.gatewayToken : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        const lastUsedAt = typeof record.lastUsedAt === 'number' ? record.lastUsedAt : undefined;
        if (!id || !name || !gatewayUrl) return null;
        return { id, name, backendType, transport, gatewayUrl, gatewayToken, createdAt, updatedAt, lastUsedAt };
      })
      .filter((profile): profile is GatewayConnectionProfile => profile !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function persistGatewayConnectionProfiles(profiles: GatewayConnectionProfile[]) {
  localStorage.setItem(GATEWAY_CONNECTIONS_STORAGE_KEY, JSON.stringify(profiles));
}

export function loadDefaultGatewayConnectionId(): string {
  try {
    const raw = localStorage.getItem(DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY);
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

export function persistDefaultGatewayConnectionId(connectionId: string) {
  const normalized = connectionId.trim();
  if (!normalized) {
    localStorage.removeItem(DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY);
    return;
  }
  localStorage.setItem(DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY, normalized);
}

export function loadActiveCoworkProjectId(): string {
  try {
    const raw = localStorage.getItem(COWORK_ACTIVE_PROJECT_STORAGE_KEY);
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

export function loadCoworkTasks(): CoworkProjectTask[] {
  try {
    const raw = localStorage.getItem(COWORK_TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): CoworkProjectTask | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const projectTitle = typeof record.projectTitle === 'string' ? record.projectTitle.trim() : '';
        const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey.trim() : '';
        const runId = typeof record.runId === 'string' ? record.runId.trim() : undefined;
        const prompt = typeof record.prompt === 'string' ? record.prompt : '';
        const status = typeof record.status === 'string' ? (record.status as CoworkProjectTaskStatus) : 'queued';
        const summary = typeof record.summary === 'string' ? record.summary : undefined;
        const outcome = typeof record.outcome === 'string' ? record.outcome : undefined;
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !projectId || !sessionKey || !prompt) return null;
        return { id, projectId, projectTitle, sessionKey, runId, prompt, status, summary, outcome, createdAt, updatedAt };
      })
      .filter((item): item is CoworkProjectTask => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 250);
  } catch {
    return [];
  }
}

export function loadDraft(storageKey: string): string {
  try {
    const raw = localStorage.getItem(storageKey);
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

export function loadScheduledJobProjectLinks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SCHEDULED_JOB_PROJECT_LINKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === 'string' && key.trim() && typeof value === 'string' && value.trim()) output[key] = value;
    }
    return output;
  } catch {
    return {};
  }
}

export function loadProjectKnowledgeItems(): ProjectKnowledgeItem[] {
  try {
    const raw = localStorage.getItem(COWORK_PROJECT_KNOWLEDGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): ProjectKnowledgeItem | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        const content = typeof record.content === 'string' ? record.content.trim() : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !projectId || !title || !content) return null;
        return { id, projectId, title, content, createdAt, updatedAt };
      })
      .filter((item): item is ProjectKnowledgeItem => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function loadOutcomePipelines(): OutcomePipeline[] {
  try {
    const raw = localStorage.getItem(OUTCOME_PIPELINES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): OutcomePipeline | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const triggerKind = record.triggerKind === 'hook' ? 'hook' : record.triggerKind === 'cron' ? 'cron' : null;
        const triggerValue = typeof record.triggerValue === 'string' ? record.triggerValue.trim() : '';
        const delivery = record.delivery === 'announce' || record.delivery === 'webhook' || record.delivery === 'none' ? record.delivery : 'none';
        const sessionTarget = record.sessionTarget === 'main' || record.sessionTarget === 'current' || record.sessionTarget === 'isolated' || record.sessionTarget === 'custom' ? record.sessionTarget : 'current';
        const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
        const description = typeof record.description === 'string' ? record.description.trim() : '';
        const webhookUrl = typeof record.webhookUrl === 'string' ? record.webhookUrl.trim() : '';
        const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !projectId || !name || !triggerKind || !triggerValue) return null;
        const rawSteps = Array.isArray(record.steps) ? record.steps : [];
        const steps = rawSteps
          .map((step): OutcomePipeline['steps'][number] | null => {
            if (!step || typeof step !== 'object') return null;
            const stepRecord = step as Record<string, unknown>;
            const stepId = typeof stepRecord.id === 'string' ? stepRecord.id.trim() : '';
            const kind = stepRecord.kind === 'session_spawn' || stepRecord.kind === 'session_send' ? stepRecord.kind : null;
            const prompt = typeof stepRecord.prompt === 'string' ? stepRecord.prompt.trim() : '';
            const targetSessionKey = typeof stepRecord.targetSessionKey === 'string' && stepRecord.targetSessionKey.trim() ? stepRecord.targetSessionKey.trim() : undefined;
            if (!stepId || !kind || !prompt) return null;
            return { id: stepId, kind, prompt, targetSessionKey };
          })
          .filter((step): step is OutcomePipeline['steps'][number] => step !== null);
        return {
          id, projectId, name, description: description || undefined, enabled, triggerKind, triggerValue, sessionTarget, delivery, webhookUrl: webhookUrl || undefined, agentId: agentId || undefined, steps, createdAt, updatedAt,
        };
      })
      .filter((item): item is OutcomePipeline => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function loadOutcomePipelineRuns(): OutcomePipelineRun[] {
  try {
    const raw = localStorage.getItem(OUTCOME_PIPELINE_RUNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): OutcomePipelineRun | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const pipelineId = typeof record.pipelineId === 'string' ? record.pipelineId.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const status = record.status === 'queued' || record.status === 'running' || record.status === 'completed' || record.status === 'failed' || record.status === 'canceled' ? record.status : 'queued';
        const startedAt = typeof record.startedAt === 'number' ? record.startedAt : Date.now();
        const finishedAt = typeof record.finishedAt === 'number' ? record.finishedAt : undefined;
        const summary = typeof record.summary === 'string' ? record.summary : undefined;
        const error = typeof record.error === 'string' ? record.error : undefined;
        if (!id || !pipelineId || !projectId) return null;
        return { id, pipelineId, projectId, status, startedAt, finishedAt, summary, error };
      })
      .filter((item): item is OutcomePipelineRun => item !== null)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 1000);
  } catch {
    return [];
  }
}

export function loadOperatorDefinitions(): OperatorDefinition[] {
  try {
    const raw = localStorage.getItem(OPERATOR_DEFINITIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): OperatorDefinition | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const description = typeof record.description === 'string' ? record.description.trim() : '';
        const kind = record.kind === 'research_report' ? 'research_report' : null;
        const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
        const inputSchema = Array.isArray(record.inputSchema) ? (record.inputSchema as OperatorDefinition['inputSchema']) : createDefaultResearchInputSchema();
        const outputRequirements = Array.isArray(record.outputRequirements) ? (record.outputRequirements as OperatorDefinition['outputRequirements']) : createDefaultResearchOutputRequirements();
        const routingPolicy = record.routingPolicy && typeof record.routingPolicy === 'object' ? (record.routingPolicy as OperatorDefinition['routingPolicy']) : createDefaultResearchRoutingPolicy();
        const successCriteria = Array.isArray(record.successCriteria) ? (record.successCriteria as string[]) : createDefaultResearchSuccessCriteria();
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !projectId || !name || !kind) return null;
        return { id, projectId, kind, name, description: description || undefined, enabled, inputSchema, outputRequirements, routingPolicy, successCriteria, createdAt, updatedAt };
      })
      .filter((item): item is OperatorDefinition => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function loadOperatorRuns(): OperatorRun[] {
  try {
    const raw = localStorage.getItem(OPERATOR_RUNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): OperatorRun | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const operatorId = typeof record.operatorId === 'string' ? record.operatorId.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const kind = record.kind === 'research_report' ? 'research_report' : null;
        const status = record.status === 'queued' || record.status === 'running' || record.status === 'needs_approval' || record.status === 'completed' || record.status === 'failed' || record.status === 'canceled' ? record.status : 'queued';
        const input = (record.input && typeof record.input === 'object' ? record.input : {}) as Record<string, unknown>;
        const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
        const depth = input.depth === 'light' || input.depth === 'deep' ? input.depth : 'standard';
        const deliverBy = typeof input.deliverBy === 'string' ? input.deliverBy : undefined;
        const stepsRaw = Array.isArray(record.steps) ? record.steps : [];
        const steps = stepsRaw.map((step): OperatorRun['steps'][number] | null => {
          if (!step || typeof step !== 'object') return null;
          const stepRecord = step as Record<string, unknown>;
          const stepId = typeof stepRecord.id === 'string' ? stepRecord.id : '';
          const key = typeof stepRecord.key === 'string' ? stepRecord.key : '';
          const label = typeof stepRecord.label === 'string' ? stepRecord.label : '';
          const stepStatus = stepRecord.status === 'pending' || stepRecord.status === 'running' || stepRecord.status === 'completed' || stepRecord.status === 'failed' ? stepRecord.status : 'pending';
          if (!stepId || !key || !label) return null;
          const output: OperatorRun['steps'][number] = { id: stepId, key, label, status: stepStatus };
          if (typeof stepRecord.startedAt === 'number') output.startedAt = stepRecord.startedAt;
          if (typeof stepRecord.finishedAt === 'number') output.finishedAt = stepRecord.finishedAt;
          if (typeof stepRecord.details === 'string') output.details = stepRecord.details;
          return output;
        }).filter((item): item is OperatorRun['steps'][number] => item !== null);
        const artifactsRaw = Array.isArray(record.artifacts) ? record.artifacts : [];
        const artifacts = artifactsRaw.map((artifact) => {
          if (!artifact || typeof artifact !== 'object') return null;
          const artifactRecord = artifact as Record<string, unknown>;
          const artifactId = typeof artifactRecord.id === 'string' ? artifactRecord.id : '';
          const runId = typeof artifactRecord.runId === 'string' ? artifactRecord.runId : '';
          const name = typeof artifactRecord.name === 'string' ? artifactRecord.name : '';
          const content = typeof artifactRecord.content === 'string' ? artifactRecord.content : '';
          const kindValue = artifactRecord.kind === 'json' || artifactRecord.kind === 'text' ? artifactRecord.kind : 'markdown';
          const createdAt = typeof artifactRecord.createdAt === 'number' ? artifactRecord.createdAt : Date.now();
          if (!artifactId || !runId || !name || !content) return null;
          return { id: artifactId, runId, name, content, kind: kindValue, createdAt };
        }).filter((item): item is OperatorRun['artifacts'][number] => item !== null);
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        const compiledPlan = record.compiledPlan && typeof record.compiledPlan === 'object' ? (record.compiledPlan as OperatorRun['compiledPlan']) : undefined;
        if (!id || !operatorId || !projectId || !kind || !topic) return null;
        return {
          id, operatorId, projectId, kind, status, compiledPlan, input: { topic, depth, deliverBy }, steps,
          summary: typeof record.summary === 'string' ? record.summary : undefined,
          error: typeof record.error === 'string' ? record.error : undefined,
          artifacts, createdAt, updatedAt,
          startedAt: typeof record.startedAt === 'number' ? record.startedAt : undefined,
          finishedAt: typeof record.finishedAt === 'number' ? record.finishedAt : undefined,
        };
      })
      .filter((item): item is OperatorRun => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 1000);
  } catch {
    return [];
  }
}
