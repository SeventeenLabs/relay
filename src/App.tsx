import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type {
  AppConfig,
  ChatActivityItem,
  ChatMessage,
  ChatModelOption,
  CoworkArtifact,
  CoworkProgressStage,
  CoworkProgressStep,
  CoworkProjectTask,
  CoworkProjectTaskStatus,
  CoworkProject,
  CoworkRunPhase,
  GatewayConnectionProfile,
  HealthCheckResult,
  LocalActionReceipt,
  LocalFilePlanAction,
  OutcomePipeline,
  OutcomePipelineRun,
  OperatorDefinition,
  OperatorRun,
  PendingApprovalAction,
  ProjectPathReference,
  ProjectKnowledgeItem,
  ScheduledJob,
  TaskState,
} from './app-types';
import { AppSidebar } from './components/layout/app-sidebar';
import { AppTitlebar } from './components/layout/app-titlebar';
import { Button } from './components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './components/ui/command';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { SidebarProvider } from './components/ui/sidebar';
import { ScrollArea } from './components/ui/scroll-area';
import { OpenClawGatewayClient } from './lib/openclaw-gateway-client';
import { createFileService, LocalFileService } from './lib/file-service';
import { buildMemoryContext, loadMemoryEntries } from './lib/memory-context';
import { accumulateTodayUsage, addUsage, loadTodayUsage, parseUsageFromPayload } from './lib/token-usage';
import {
  compileResearchOperatorPlan,
  createDefaultResearchInputSchema,
  createDefaultResearchOutputRequirements,
  createDefaultResearchRoutingPolicy,
  createDefaultResearchSuccessCriteria,
  validateResearchOperatorInput,
} from './lib/operator-compiler';
import { loadSafetyScopes, resolveLocalActionPolicy } from './lib/safety-policy';
import { registerConnector, hydrateConnectors } from './lib/connectors';
import { createFilesystemConnector } from './lib/connectors/filesystem';
import { createShellConnector } from './lib/connectors/shell';
import { createWebFetchConnector } from './lib/connectors/web-fetch';

import { OnboardingPage } from './features/auth/onboarding-page';
import { useAuth } from './hooks/use-auth';
import { usePreferences } from './hooks/use-preferences';
import {
  type ChatThread,
  type PersistedRecents,
  type RecentWorkspaceEntry,
  type RelayFileAction,
  RELAY_RECENTS_KEY,
  DEFAULT_CHAT_THREAD_TITLE,
  DEFAULT_COWORK_THREAD_TITLE,
  normalizeSessionKey,
  getThreadIdForSession,
  toRecentSidebarLabel,
  toRecentSidebarItems,
  mergeChatThreads,
  loadPersistedRecents,
  deriveThreadTitleFromMessages,
  toFallbackThreadTitle,
  isCustomChatThreadTitle,
  findMatchingSessionKey,
  buildOutboundChatPrompt,
  extractChatText,
  extractChatRole,
  readGatewayError,
  parseRelayFileActions,
  stripRelayActionPayloadFromText,
  parseRelayActivityItems,
  deriveActivityItemsFromAssistantText,
  normalizeCoworkMessage,
} from './lib/chat-utils';

const CoworkPage = lazy(() => import('./features/cowork/cowork-page').then((module) => ({ default: module.CoworkPage })));
const ProjectPage = lazy(() => import('./features/cowork/project-page').then((module) => ({ default: module.ProjectPage })));
const SettingsPage = lazy(() => import('./features/settings/settings-page').then((module) => ({ default: module.SettingsPage })));
const ActivityPage = lazy(() => import('./features/workspace/activity-page').then((module) => ({ default: module.ActivityPage })));
const FilesPage = lazy(() => import('./features/workspace/files-page').then((module) => ({ default: module.FilesPage })));
const MemoryPage = lazy(() => import('./features/workspace/memory-page').then((module) => ({ default: module.MemoryPage })));
const SafetyPage = lazy(() => import('./features/workspace/safety-page').then((module) => ({ default: module.SafetyPage })));
const ApprovalsPage = lazy(() => import('./features/workspace/approvals-page').then((module) => ({ default: module.ApprovalsPage })));
const ScheduledPage = lazy(() => import('./features/workspace/scheduled-page').then((module) => ({ default: module.ScheduledPage })));

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';

const LOCAL_CONFIG_KEY = 'relay.config';
const GATEWAY_CONNECTIONS_STORAGE_KEY = 'relay.gateway.connections.v1';
const DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY = 'relay.gateway.connections.default.v1';
const COWORK_PROJECTS_STORAGE_KEY = 'relay.cowork.projects.v1';
const COWORK_ACTIVE_PROJECT_STORAGE_KEY = 'relay.cowork.projects.active.v1';
const COWORK_TASKS_STORAGE_KEY = 'relay.cowork.tasks.v1';
const COWORK_PROJECT_KNOWLEDGE_STORAGE_KEY = 'relay.cowork.project.knowledge.v1';
const COWORK_WEB_SEARCH_MODE_STORAGE_KEY = 'relay.cowork.websearch.v1';
const CHAT_DRAFT_STORAGE_KEY = 'relay.chat.draft.v1';
const COWORK_DRAFT_STORAGE_KEY = 'relay.cowork.draft.v1';
const SCHEDULED_JOB_PROJECT_LINKS_STORAGE_KEY = 'relay.scheduled.project-links.v1';
const OUTCOME_PIPELINES_STORAGE_KEY = 'relay.outcome-pipelines.v1';
const OUTCOME_PIPELINE_RUNS_STORAGE_KEY = 'relay.outcome-pipeline-runs.v1';
const OPERATOR_DEFINITIONS_STORAGE_KEY = 'relay.operators.definitions.v1';
const OPERATOR_RUNS_STORAGE_KEY = 'relay.operators.runs.v1';

const defaultConfig: AppConfig = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  gatewayToken: '',
};

type AppPage = 'chat' | 'cowork' | 'project' | 'files' | 'local-files' | 'activity' | 'memory' | 'scheduled' | 'approvals' | 'safety' | 'settings';
type SettingsSection = 'Profile' | 'Appearance' | 'System Prompt' | 'Gateway' | 'Connectors' | 'Account' | 'Privacy' | 'Developer';

const COWORK_SEND_SPINNER_MS = 300;
const COWORK_PREP_TIMEOUT_MS = 15_000;
const COWORK_STREAM_WATCHDOG_MS = 45_000;
const MAX_LOCAL_ACTIONS_PER_RUN = 20;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const COWORK_CONTEXT_CONNECTORS = ['Web search', 'Desktop files', 'Gateway tools'];

const COWORK_PROGRESS_SEQUENCE: Array<{ stage: CoworkProgressStage; label: string }> = [
  { stage: 'planning', label: 'Planning' },
  { stage: 'decomposition', label: 'Decomposition' },
  { stage: 'executing_workstreams', label: 'Executing workstreams' },
  { stage: 'synthesizing_outputs', label: 'Synthesizing outputs' },
  { stage: 'deliverables', label: 'Deliverables' },
];

function createInitialCoworkProgressSteps(): CoworkProgressStep[] {
  return COWORK_PROGRESS_SEQUENCE.map((item) => ({
    stage: item.stage,
    label: item.label,
    status: 'pending',
  }));
}

function isDestructiveLocalAction(actionType: PendingApprovalAction['actionType']): boolean {
  return actionType === 'delete' || actionType === 'rename';
}

type ApprovalResolverEntry = {
  resolve: (value: { approved: boolean; reason?: string; expired?: boolean }) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type RelayE2EPendingApprovalInput = Partial<PendingApprovalAction> & {
  actionType?: PendingApprovalAction['actionType'];
};

type RelayE2EBridge = {
  enqueuePendingApproval: (input?: RelayE2EPendingApprovalInput) => string;
  clearPendingApprovals: () => void;
  getPendingApprovals: () => PendingApprovalAction[];
};

type CoworkRunProjectContext = {
  projectId: string;
  projectTitle: string;
  rootFolder: string;
  startedAt: number;
};

type CoworkTaskQueueEntry = {
  taskId: string;
  runId?: string;
  status: CoworkProjectTaskStatus;
};

function validateProjectRelativePath(inputPath: string, options?: { allowEmpty?: boolean }): { ok: true } | { ok: false; reason: string } {
  const raw = (inputPath ?? '').trim();
  if (!raw) {
    return options?.allowEmpty ? { ok: true } : { ok: false, reason: 'Path is required.' };
  }

  const normalized = raw.replace(/\\/g, '/');
  const hasControlChars = Array.from(normalized).some((char) => char.charCodeAt(0) < 32);
  if (hasControlChars) {
    return { ok: false, reason: 'Path contains invalid control characters.' };
  }
  if (normalized.startsWith('/') || normalized.startsWith('~/') || /^[a-zA-Z]:\//.test(normalized)) {
    return { ok: false, reason: 'Absolute paths are not allowed for project-bound actions.' };
  }

  if (normalized === '.' || normalized === './') {
    return { ok: false, reason: 'A concrete relative path is required.' };
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return { ok: false, reason: 'Parent directory traversal is not allowed.' };
  }

  return { ok: true };
}

function extractProjectFileMentions(inputText: string): string[] {
  if (!inputText) {
    return [];
  }

  const mentions = new Set<string>();
  const quotedPattern = /@project:"([^"]+)"/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedPattern.exec(inputText)) !== null) {
    const nextPath = quotedMatch[1]?.trim();
    if (nextPath) {
      mentions.add(nextPath);
    }
  }

  const unquotedPattern = /@project\/([^\s,;]+)/g;
  let unquotedMatch: RegExpExecArray | null;
  while ((unquotedMatch = unquotedPattern.exec(inputText)) !== null) {
    const nextPath = unquotedMatch[1]?.trim();
    if (nextPath) {
      mentions.add(nextPath);
    }
  }

  return Array.from(mentions);
}

function loadCoworkProjects(): CoworkProject[] {
  try {
    const raw = localStorage.getItem(COWORK_PROJECTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry): CoworkProject | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const description = typeof record.description === 'string' ? record.description.trim() : '';
        const instructionsRaw = typeof record.instructions === 'string' ? record.instructions.trim() : '';
        const workspaceFolder = typeof record.workspaceFolder === 'string' ? record.workspaceFolder.trim() : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !name || !workspaceFolder) {
          return null;
        }
        return {
          id,
          name,
          description: description || undefined,
          instructions: instructionsRaw || description || undefined,
          workspaceFolder,
          createdAt,
          updatedAt,
        };
      })
      .filter((project): project is CoworkProject => project !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function loadGatewayConnectionProfiles(): GatewayConnectionProfile[] {
  try {
    const raw = localStorage.getItem(GATEWAY_CONNECTIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry): GatewayConnectionProfile | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const gatewayUrl = typeof record.gatewayUrl === 'string' ? record.gatewayUrl.trim() : '';
        const gatewayToken = typeof record.gatewayToken === 'string' ? record.gatewayToken : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        const lastUsedAt = typeof record.lastUsedAt === 'number' ? record.lastUsedAt : undefined;

        if (!id || !name || !gatewayUrl) {
          return null;
        }

        return {
          id,
          name,
          gatewayUrl,
          gatewayToken,
          createdAt,
          updatedAt,
          lastUsedAt,
        };
      })
      .filter((profile): profile is GatewayConnectionProfile => profile !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function persistGatewayConnectionProfiles(profiles: GatewayConnectionProfile[]) {
  localStorage.setItem(GATEWAY_CONNECTIONS_STORAGE_KEY, JSON.stringify(profiles));
}

function loadDefaultGatewayConnectionId(): string {
  try {
    const raw = localStorage.getItem(DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY);
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

function persistDefaultGatewayConnectionId(connectionId: string) {
  const normalized = connectionId.trim();
  if (!normalized) {
    localStorage.removeItem(DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY);
    return;
  }
  localStorage.setItem(DEFAULT_GATEWAY_CONNECTION_STORAGE_KEY, normalized);
}

function loadActiveCoworkProjectId(): string {
  try {
    const raw = localStorage.getItem(COWORK_ACTIVE_PROJECT_STORAGE_KEY);
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

function loadCoworkTasks(): CoworkProjectTask[] {
  try {
    const raw = localStorage.getItem(COWORK_TASKS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry): CoworkProjectTask | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

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

        if (!id || !projectId || !sessionKey || !prompt) {
          return null;
        }

        return {
          id,
          projectId,
          projectTitle,
          sessionKey,
          runId,
          prompt,
          status,
          summary,
          outcome,
          createdAt,
          updatedAt,
        };
      })
      .filter((item): item is CoworkProjectTask => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 250);
  } catch {
    return [];
  }
}

function loadDraft(storageKey: string): string {
  try {
    const raw = localStorage.getItem(storageKey);
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

function loadScheduledJobProjectLinks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SCHEDULED_JOB_PROJECT_LINKS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === 'string' && key.trim() && typeof value === 'string' && value.trim()) {
        output[key] = value;
      }
    }
    return output;
  } catch {
    return {};
  }
}

function loadProjectKnowledgeItems(): ProjectKnowledgeItem[] {
  try {
    const raw = localStorage.getItem(COWORK_PROJECT_KNOWLEDGE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry): ProjectKnowledgeItem | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        const content = typeof record.content === 'string' ? record.content.trim() : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !projectId || !title || !content) {
          return null;
        }
        return {
          id,
          projectId,
          title,
          content,
          createdAt,
          updatedAt,
        };
      })
      .filter((item): item is ProjectKnowledgeItem => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function loadOutcomePipelines(): OutcomePipeline[] {
  try {
    const raw = localStorage.getItem(OUTCOME_PIPELINES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry): OutcomePipeline | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const triggerKind = record.triggerKind === 'hook' ? 'hook' : record.triggerKind === 'cron' ? 'cron' : null;
        const triggerValue = typeof record.triggerValue === 'string' ? record.triggerValue.trim() : '';
        const delivery =
          record.delivery === 'announce' || record.delivery === 'webhook' || record.delivery === 'none'
            ? record.delivery
            : 'none';
        const sessionTarget =
          record.sessionTarget === 'main' ||
          record.sessionTarget === 'current' ||
          record.sessionTarget === 'isolated' ||
          record.sessionTarget === 'custom'
            ? record.sessionTarget
            : 'current';
        const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
        const description = typeof record.description === 'string' ? record.description.trim() : '';
        const webhookUrl = typeof record.webhookUrl === 'string' ? record.webhookUrl.trim() : '';
        const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !projectId || !name || !triggerKind || !triggerValue) {
          return null;
        }

        const rawSteps = Array.isArray(record.steps) ? record.steps : [];
        const steps = rawSteps
          .map((step): OutcomePipeline['steps'][number] | null => {
            if (!step || typeof step !== 'object') {
              return null;
            }
            const stepRecord = step as Record<string, unknown>;
            const stepId = typeof stepRecord.id === 'string' ? stepRecord.id.trim() : '';
            const kind =
              stepRecord.kind === 'session_spawn' || stepRecord.kind === 'session_send'
                ? stepRecord.kind
                : null;
            const prompt = typeof stepRecord.prompt === 'string' ? stepRecord.prompt.trim() : '';
            const targetSessionKey =
              typeof stepRecord.targetSessionKey === 'string' && stepRecord.targetSessionKey.trim()
                ? stepRecord.targetSessionKey.trim()
                : undefined;
            if (!stepId || !kind || !prompt) {
              return null;
            }
            return { id: stepId, kind, prompt, targetSessionKey };
          })
          .filter((step): step is OutcomePipeline['steps'][number] => step !== null);

        return {
          id,
          projectId,
          name,
          description: description || undefined,
          enabled,
          triggerKind,
          triggerValue,
          sessionTarget,
          delivery,
          webhookUrl: webhookUrl || undefined,
          agentId: agentId || undefined,
          steps,
          createdAt,
          updatedAt,
        };
      })
      .filter((item): item is OutcomePipeline => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function loadOutcomePipelineRuns(): OutcomePipelineRun[] {
  try {
    const raw = localStorage.getItem(OUTCOME_PIPELINE_RUNS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry): OutcomePipelineRun | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const pipelineId = typeof record.pipelineId === 'string' ? record.pipelineId.trim() : '';
        const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
        const status =
          record.status === 'queued' ||
          record.status === 'running' ||
          record.status === 'completed' ||
          record.status === 'failed' ||
          record.status === 'canceled'
            ? record.status
            : 'queued';
        const startedAt = typeof record.startedAt === 'number' ? record.startedAt : Date.now();
        const finishedAt = typeof record.finishedAt === 'number' ? record.finishedAt : undefined;
        const summary = typeof record.summary === 'string' ? record.summary : undefined;
        const error = typeof record.error === 'string' ? record.error : undefined;
        if (!id || !pipelineId || !projectId) {
          return null;
        }
        return { id, pipelineId, projectId, status, startedAt, finishedAt, summary, error };
      })
      .filter((item): item is OutcomePipelineRun => item !== null)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 1000);
  } catch {
    return [];
  }
}

function loadOperatorDefinitions(): OperatorDefinition[] {
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
        const inputSchema = Array.isArray(record.inputSchema)
          ? (record.inputSchema as OperatorDefinition['inputSchema'])
          : createDefaultResearchInputSchema();
        const outputRequirements = Array.isArray(record.outputRequirements)
          ? (record.outputRequirements as OperatorDefinition['outputRequirements'])
          : createDefaultResearchOutputRequirements();
        const routingPolicy =
          record.routingPolicy && typeof record.routingPolicy === 'object'
            ? (record.routingPolicy as OperatorDefinition['routingPolicy'])
            : createDefaultResearchRoutingPolicy();
        const successCriteria = Array.isArray(record.successCriteria)
          ? (record.successCriteria as string[])
          : createDefaultResearchSuccessCriteria();
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        if (!id || !projectId || !name || !kind) return null;
        return {
          id,
          projectId,
          kind,
          name,
          description: description || undefined,
          enabled,
          inputSchema,
          outputRequirements,
          routingPolicy,
          successCriteria,
          createdAt,
          updatedAt,
        };
      })
      .filter((item): item is OperatorDefinition => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function loadOperatorRuns(): OperatorRun[] {
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
        const status =
          record.status === 'queued' ||
          record.status === 'running' ||
          record.status === 'needs_approval' ||
          record.status === 'completed' ||
          record.status === 'failed' ||
          record.status === 'canceled'
            ? record.status
            : 'queued';
        const input = (record.input && typeof record.input === 'object' ? record.input : {}) as Record<string, unknown>;
        const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
        const depth = input.depth === 'light' || input.depth === 'deep' ? input.depth : 'standard';
        const deliverBy = typeof input.deliverBy === 'string' ? input.deliverBy : undefined;
        const stepsRaw = Array.isArray(record.steps) ? record.steps : [];
        const steps = stepsRaw
          .map((step): OperatorRun['steps'][number] | null => {
            if (!step || typeof step !== 'object') return null;
            const stepRecord = step as Record<string, unknown>;
            const stepId = typeof stepRecord.id === 'string' ? stepRecord.id : '';
            const key = typeof stepRecord.key === 'string' ? stepRecord.key : '';
            const label = typeof stepRecord.label === 'string' ? stepRecord.label : '';
            const stepStatus =
              stepRecord.status === 'pending' ||
              stepRecord.status === 'running' ||
              stepRecord.status === 'completed' ||
              stepRecord.status === 'failed'
                ? stepRecord.status
                : 'pending';
            if (!stepId || !key || !label) return null;
            const output: OperatorRun['steps'][number] = {
              id: stepId,
              key,
              label,
              status: stepStatus,
            };
            if (typeof stepRecord.startedAt === 'number') output.startedAt = stepRecord.startedAt;
            if (typeof stepRecord.finishedAt === 'number') output.finishedAt = stepRecord.finishedAt;
            if (typeof stepRecord.details === 'string') output.details = stepRecord.details;
            return output;
          })
          .filter((item): item is OperatorRun['steps'][number] => item !== null);
        const artifactsRaw = Array.isArray(record.artifacts) ? record.artifacts : [];
        const artifacts = artifactsRaw
          .map((artifact) => {
            if (!artifact || typeof artifact !== 'object') return null;
            const artifactRecord = artifact as Record<string, unknown>;
            const artifactId = typeof artifactRecord.id === 'string' ? artifactRecord.id : '';
            const runId = typeof artifactRecord.runId === 'string' ? artifactRecord.runId : '';
            const name = typeof artifactRecord.name === 'string' ? artifactRecord.name : '';
            const content = typeof artifactRecord.content === 'string' ? artifactRecord.content : '';
            const kind = artifactRecord.kind === 'json' || artifactRecord.kind === 'text' ? artifactRecord.kind : 'markdown';
            const createdAt = typeof artifactRecord.createdAt === 'number' ? artifactRecord.createdAt : Date.now();
            if (!artifactId || !runId || !name || !content) return null;
            return { id: artifactId, runId, name, content, kind, createdAt };
          })
          .filter((item): item is OperatorRun['artifacts'][number] => item !== null);
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
        const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
        const compiledPlan =
          record.compiledPlan && typeof record.compiledPlan === 'object'
            ? (record.compiledPlan as OperatorRun['compiledPlan'])
            : undefined;
        if (!id || !operatorId || !projectId || !kind || !topic) return null;
        return {
          id,
          operatorId,
          projectId,
          kind,
          status,
          compiledPlan,
          input: { topic, depth, deliverBy },
          steps,
          summary: typeof record.summary === 'string' ? record.summary : undefined,
          error: typeof record.error === 'string' ? record.error : undefined,
          artifacts,
          createdAt,
          updatedAt,
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

declare global {
  interface Window {
    relayE2E?: RelayE2EBridge;
  }
}









export default function App() {
  /* ── Initialize connectors once ──────────────────────────────────────── */
  useMemo(() => {
    registerConnector(createFilesystemConnector());
    registerConnector(createShellConnector());
    registerConnector(createWebFetchConnector());
    hydrateConnectors();
  }, []);

  const bridge = window.relay;
  const gatewayClientRef = useRef<OpenClawGatewayClient | null>(null);
  const activeSessionKeyRef = useRef('');
  const coworkSessionKeyRef = useRef('');
  const workingFolderRef = useRef('');
  const chatLoadRequestRef = useRef(0);
  const coworkLoadRequestRef = useRef(0);
  const skipNextChatEffectLoadRef = useRef(false);
  const threadMessageCache = useRef<Map<string, ChatMessage[]>>(new Map());
  const coworkMessageCache = useRef<Map<string, ChatMessage[]>>(new Map());
  const executedCoworkActionRunsRef = useRef<Set<string>>(new Set());
  const approvalResolversRef = useRef<Map<string, ApprovalResolverEntry>>(new Map());
  const pendingCoworkRunContextsRef = useRef<Map<string, CoworkRunProjectContext[]>>(new Map());
  const resolvedCoworkRunContextsRef = useRef<Map<string, CoworkRunProjectContext>>(new Map());
  const pendingCoworkTaskQueueRef = useRef<Map<string, CoworkTaskQueueEntry[]>>(new Map());
  const coworkStreamWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [configReady, setConfigReady] = useState(false);
  const [draftGatewayUrl, setDraftGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [draftGatewayToken, setDraftGatewayToken] = useState('');
  const [gatewayConnections, setGatewayConnections] = useState<GatewayConnectionProfile[]>(() => loadGatewayConnectionProfiles());
  const [defaultGatewayConnectionId, setDefaultGatewayConnectionId] = useState(() => loadDefaultGatewayConnectionId());
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [status, setStatus] = useState('Loading configuration...');
  const { preferences, updatePreferences } = usePreferences();
  const {
    authSession,
    authenticating,
    authError,
    guestMode,
    onboardingComplete,
    canUseAppShell,
    userIdentityLabel,
    usageModeLabel,
    handleLogin,
    handleLogout,
    handleContinueAsGuest,
    completeOnboarding,
  } = useAuth({ onStatusChange: setStatus });
  const needsOnboarding = !onboardingComplete;
  const [sendingChat, setSendingChat] = useState(false);
  const [awaitingChatStream, setAwaitingChatStream] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [coworkMessages, setCoworkMessages] = useState<ChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>(() => loadPersistedRecents().chatThreads ?? []);
  const [coworkThreads, setCoworkThreads] = useState<ChatThread[]>(() => loadPersistedRecents().coworkThreads ?? []);

  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pairingRequestId, setPairingRequestId] = useState<string | null>(null);
  const [activeMenuItem, setActiveMenuItem] = useState('');
  const [activePage, setActivePage] = useState<AppPage>('cowork');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('Profile');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatDraftPrompt, setChatDraftPrompt] = useState(() => loadDraft(CHAT_DRAFT_STORAGE_KEY));
  const [coworkDraftPrompt, setCoworkDraftPrompt] = useState(() => loadDraft(COWORK_DRAFT_STORAGE_KEY));
  const [workingFolder, setWorkingFolder] = useState('/Downloads');
  const [coworkProjects, setCoworkProjects] = useState<CoworkProject[]>(() => loadCoworkProjects());
  const [activeCoworkProjectId, setActiveCoworkProjectId] = useState(() => loadActiveCoworkProjectId());
  const [coworkTasks, setCoworkTasks] = useState<CoworkProjectTask[]>(() => loadCoworkTasks());
  const [projectKnowledgeItems, setProjectKnowledgeItems] = useState<ProjectKnowledgeItem[]>(() => loadProjectKnowledgeItems());
  const [taskState, setTaskState] = useState<TaskState>('idle');
  const [localPlanActions, setLocalPlanActions] = useState<LocalFilePlanAction[]>([]);
  const [localPlanLoading, setLocalPlanLoading] = useState(false);
  const [localApplyLoading, setLocalApplyLoading] = useState(false);
  const [localFileDraftPath, setLocalFileDraftPath] = useState('notes/todo.md');
  const [localFileDraftContent, setLocalFileDraftContent] = useState('');
  const [localFileCreateLoading, setLocalFileCreateLoading] = useState(false);
  const [localPlanRootPath, setLocalPlanRootPath] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeSessionKey, setActiveSessionKey] = useState('');
  const [coworkSessionKey, setCoworkSessionKey] = useState('');
  const [chatModels, setChatModels] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [coworkModels, setCoworkModels] = useState<ChatModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [changingCoworkModel, setChangingCoworkModel] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [scheduledJobProjectLinks, setScheduledJobProjectLinks] = useState<Record<string, string>>(() => loadScheduledJobProjectLinks());
  const [outcomePipelines, setOutcomePipelines] = useState<OutcomePipeline[]>(() => loadOutcomePipelines());
  const [outcomePipelineRuns, setOutcomePipelineRuns] = useState<OutcomePipelineRun[]>(() => loadOutcomePipelineRuns());
  const [operatorDefinitions, setOperatorDefinitions] = useState<OperatorDefinition[]>(() => loadOperatorDefinitions());
  const [operatorRuns, setOperatorRuns] = useState<OperatorRun[]>(() => loadOperatorRuns());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentRenameTarget, setRecentRenameTarget] = useState<RecentWorkspaceEntry | null>(null);
  const [recentRenameValue, setRecentRenameValue] = useState('');
  const [recentDeleteTarget, setRecentDeleteTarget] = useState<RecentWorkspaceEntry | null>(null);
  const [recentActionBusy, setRecentActionBusy] = useState(false);
  const [coworkResetKey, setCoworkResetKey] = useState(0);
  const [coworkRightPanelOpen, setCoworkRightPanelOpen] = useState(true);
  const [coworkSending, setCoworkSending] = useState(false);
  const [coworkAwaitingStream, setCoworkAwaitingStream] = useState(false);
  const [coworkStreamingText, setCoworkStreamingText] = useState('');
  const [coworkModel, setCoworkModel] = useState('');
  const [coworkRunPhase, setCoworkRunPhase] = useState<CoworkRunPhase>('idle');
  const [coworkRunStatus, setCoworkRunStatus] = useState('Ready for a new task.');
  const [coworkWebSearchEnabled, setCoworkWebSearchEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COWORK_WEB_SEARCH_MODE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [coworkProjectPathReferences, setCoworkProjectPathReferences] = useState<ProjectPathReference[]>([]);
  const [localActionReceipts, setLocalActionReceipts] = useState<LocalActionReceipt[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalAction[]>([]);
  const [coworkProgressSteps, setCoworkProgressSteps] = useState<CoworkProgressStep[]>(() => createInitialCoworkProgressSteps());
  const [coworkArtifacts, setCoworkArtifacts] = useState<CoworkArtifact[]>([]);
  const [localActionSmokeRunning, setLocalActionSmokeRunning] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [sessionUsage, setSessionUsage] = useState(() => loadTodayUsage());

  const handleChatPromptChange = useCallback((value: string) => {
    setChatDraftPrompt(value);
  }, []);

  const handleCoworkPromptChange = useCallback((value: string) => {
    setCoworkDraftPrompt(value);
  }, []);

  const fileService = useMemo(
    () => createFileService(gatewayClientRef.current, draftGatewayUrl, Boolean(bridge)),
    // Re-create when connection state or URL changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftGatewayUrl, gatewayConnected, bridge],
  );

  const localFileService = useMemo(
    () => (bridge ? new LocalFileService() : null),
    [bridge],
  );

  const recentChatItems = toRecentSidebarItems(chatThreads, 'chat');
  const recentCoworkItems = toRecentSidebarItems(coworkThreads, 'cowork');
  const isCoworkSidebarContext = ['cowork', 'project', 'files', 'local-files', 'activity', 'memory', 'scheduled', 'approvals', 'safety'].includes(activePage);
  const recentItems = isCoworkSidebarContext ? recentCoworkItems : recentChatItems;
  const activeCoworkProject = useMemo(
    () => coworkProjects.find((project) => project.id === activeCoworkProjectId) ?? null,
    [coworkProjects, activeCoworkProjectId],
  );
  const visibleCoworkTasks = useMemo(() => {
    if (!activeCoworkProjectId) {
      return [] as CoworkProjectTask[];
    }
    return coworkTasks
      .filter((task) => task.projectId === activeCoworkProjectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 25);
  }, [activeCoworkProjectId, coworkTasks]);
  const latestVisibleCoworkTaskPrompt = visibleCoworkTasks[0]?.prompt?.trim() ?? '';
  const visibleProjectPipelines = useMemo(() => {
    if (!activeCoworkProjectId) {
      return [] as OutcomePipeline[];
    }
    return outcomePipelines
      .filter((pipeline) => pipeline.projectId === activeCoworkProjectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activeCoworkProjectId, outcomePipelines]);
  const visibleProjectOperators = useMemo(() => {
    if (!activeCoworkProjectId) {
      return [] as OperatorDefinition[];
    }
    return operatorDefinitions
      .filter((item) => item.projectId === activeCoworkProjectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activeCoworkProjectId, operatorDefinitions]);
  const visibleProjectOperatorRuns = useMemo(() => {
    if (!activeCoworkProjectId) {
      return [] as OperatorRun[];
    }
    return operatorRuns
      .filter((item) => item.projectId === activeCoworkProjectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
  }, [activeCoworkProjectId, operatorRuns]);

  const visiblePendingApprovals = useMemo(() => {
    if (!activeCoworkProjectId) {
      return [] as PendingApprovalAction[];
    }

    return pendingApprovals
      .filter((approval) => approval.projectId === activeCoworkProjectId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [activeCoworkProjectId, pendingApprovals]);
  const visibleProjectKnowledge = useMemo(() => {
    if (!activeCoworkProjectId) {
      return [] as ProjectKnowledgeItem[];
    }
    return projectKnowledgeItems
      .filter((item) => item.projectId === activeCoworkProjectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40);
  }, [activeCoworkProjectId, projectKnowledgeItems]);
  const visibleProjectArtifacts = useMemo(() => {
    const runIds = new Set(visibleCoworkTasks.map((task) => task.runId).filter((runId): runId is string => typeof runId === 'string' && runId.length > 0));
    if (runIds.size === 0) {
      return coworkArtifacts.slice(0, 40);
    }
    return coworkArtifacts.filter((artifact) => !artifact.runId || runIds.has(artifact.runId)).slice(0, 40);
  }, [coworkArtifacts, visibleCoworkTasks]);
  const selectedGatewayConnectionId = useMemo(() => {
    const normalizedUrl = draftGatewayUrl.trim() || DEFAULT_GATEWAY_URL;
    const normalizedToken = draftGatewayToken ?? '';
    return gatewayConnections.find((profile) => profile.gatewayUrl === normalizedUrl && profile.gatewayToken === normalizedToken)?.id ?? null;
  }, [draftGatewayToken, draftGatewayUrl, gatewayConnections]);

  const contextFolders = useMemo(() => {
    const folders = [activeCoworkProject?.workspaceFolder?.trim() || '', workingFolder.trim()].filter(Boolean);
    return Array.from(new Set(folders));
  }, [activeCoworkProject?.workspaceFolder, workingFolder]);

  const contextDocuments = useMemo(() => {
    const docs = localActionReceipts
      .filter((entry) => entry.status === 'ok' && (entry.type === 'read_file' || entry.type === 'create_file' || entry.type === 'append_file'))
      .map((entry) => entry.path)
      .filter(Boolean);
    return Array.from(new Set(docs)).slice(0, 8);
  }, [localActionReceipts]);

  const projectMemoryItems = useMemo(() => {
    const items = [
      ...contextDocuments,
      ...(activeCoworkProject?.description ? [activeCoworkProject.description] : []),
    ].map((item) => item.trim()).filter(Boolean);
    return Array.from(new Set(items)).slice(0, 8);
  }, [activeCoworkProject?.description, contextDocuments]);

  const filesTouched = useMemo(
    () =>
      coworkArtifacts
        .filter((artifact) => artifact.kind === 'file')
        .slice(0, 8),
    [coworkArtifacts],
  );

  const setCoworkProgressStage = (
    stage: CoworkProgressStage,
    options?: { details?: string; blocked?: boolean; completeThrough?: boolean },
  ) => {
    const targetIndex = COWORK_PROGRESS_SEQUENCE.findIndex((item) => item.stage === stage);
    if (targetIndex < 0) {
      return;
    }

    setCoworkProgressSteps((current) =>
      current.map((step, index) => {
        const isTarget = index === targetIndex;
        const shouldCompleteEarlier = options?.completeThrough ? index <= targetIndex : index < targetIndex;

        if (options?.blocked && isTarget) {
          return {
            ...step,
            status: 'blocked',
            details: options?.details ?? step.details,
          };
        }

        if (shouldCompleteEarlier) {
          return {
            ...step,
            status: 'completed',
            details: isTarget && options?.details ? options.details : step.details,
          };
        }

        if (isTarget) {
          return {
            ...step,
            status: options?.completeThrough ? 'completed' : 'active',
            details: options?.details ?? step.details,
          };
        }

        return {
          ...step,
          status: step.status === 'blocked' ? 'pending' : 'pending',
          details: index > targetIndex ? undefined : step.details,
        };
      }),
    );
  };

  const resetCoworkProgress = (details?: string) => {
    setCoworkProgressSteps(
      COWORK_PROGRESS_SEQUENCE.map((item, index) => ({
        stage: item.stage,
        label: item.label,
        status: index === 0 ? 'active' : 'pending',
        details: index === 0 ? details : undefined,
      })),
    );
  };

  const recordCoworkArtifactsFromReceipts = (receipts: LocalActionReceipt[], runId: string) => {
    const artifactReceipts = receipts.filter((receipt) =>
      receipt.type === 'create_file' || receipt.type === 'append_file' || receipt.type === 'read_file',
    );

    if (artifactReceipts.length === 0) {
      return;
    }

    const now = Date.now();
    setCoworkArtifacts((current) => {
      const next = [...current];
      for (const receipt of artifactReceipts) {
        const key = `${runId}:${receipt.path}:${receipt.type}`;
        const existingIndex = next.findIndex((artifact) => artifact.id === key);
        const artifact: CoworkArtifact = {
          id: key,
          runId,
          label: receipt.path.split('/').pop() || receipt.path,
          path: receipt.path,
          kind: 'file',
          status: receipt.status,
          source:
            receipt.type === 'create_file' || receipt.type === 'append_file' || receipt.type === 'read_file'
              ? receipt.type
              : undefined,
          updatedAt: now,
        };

        if (existingIndex >= 0) {
          next[existingIndex] = artifact;
        } else {
          next.unshift(artifact);
        }
      }

      return next.slice(0, 40);
    });
  };

  const setCoworkTaskStatus = (
    taskId: string,
    status: CoworkProjectTaskStatus,
    options?: { summary?: string; outcome?: string; runId?: string },
  ) => {
    const now = Date.now();
    setCoworkTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status,
              runId: options?.runId ?? task.runId,
              summary: options?.summary ?? task.summary,
              outcome: options?.outcome ?? task.outcome,
              updatedAt: now,
            }
          : task,
      ),
    );
  };

  const queueCoworkTask = (sessionKey: string, entry: CoworkTaskQueueEntry) => {
    const normalized = normalizeSessionKey(sessionKey);
    if (!normalized) {
      return;
    }

    const queue = pendingCoworkTaskQueueRef.current.get(normalized) ?? [];
    pendingCoworkTaskQueueRef.current.set(normalized, [...queue, entry]);
  };

  const resolveCoworkTaskForRun = (sessionKey: string, runId: string): CoworkTaskQueueEntry | null => {
    const normalized = normalizeSessionKey(sessionKey);
    if (!normalized) {
      return null;
    }

    const queue = pendingCoworkTaskQueueRef.current.get(normalized) ?? [];
    if (queue.length === 0) {
      return null;
    }

    let index = queue.findIndex((item) => item.runId === runId);
    if (index < 0) {
      index = queue.findIndex((item) => !item.runId);
    }
    if (index < 0) {
      index = 0;
    }

    const selected = queue[index];
    const updated: CoworkTaskQueueEntry = {
      ...selected,
      runId,
    };
    queue[index] = updated;
    pendingCoworkTaskQueueRef.current.set(normalized, queue);
    return updated;
  };

  const finalizeCoworkTaskRun = (sessionKey: string, taskId: string) => {
    const normalized = normalizeSessionKey(sessionKey);
    if (!normalized) {
      return;
    }

    const queue = pendingCoworkTaskQueueRef.current.get(normalized) ?? [];
    const next = queue.filter((entry) => entry.taskId !== taskId);
    if (next.length > 0) {
      pendingCoworkTaskQueueRef.current.set(normalized, next);
    } else {
      pendingCoworkTaskQueueRef.current.delete(normalized);
    }
  };

  const enqueueCoworkRunContext = (sessionKey: string, context: CoworkRunProjectContext) => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    if (!normalizedSessionKey) {
      return;
    }

    const currentQueue = pendingCoworkRunContextsRef.current.get(normalizedSessionKey) ?? [];
    pendingCoworkRunContextsRef.current.set(normalizedSessionKey, [...currentQueue, context]);
  };

  const resolveCoworkRunContext = (sessionKey: string, runId: string): CoworkRunProjectContext => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    const runKey = `${normalizedSessionKey || 'unknown'}:${runId}`;
    const cached = resolvedCoworkRunContextsRef.current.get(runKey);
    if (cached) {
      return cached;
    }

    const currentQueue = normalizedSessionKey ? pendingCoworkRunContextsRef.current.get(normalizedSessionKey) ?? [] : [];
    const nextFromQueue = currentQueue.shift();
    if (normalizedSessionKey) {
      if (currentQueue.length > 0) {
        pendingCoworkRunContextsRef.current.set(normalizedSessionKey, currentQueue);
      } else {
        pendingCoworkRunContextsRef.current.delete(normalizedSessionKey);
      }
    }

    const fallback: CoworkRunProjectContext = {
      projectId: activeCoworkProject?.id ?? '',
      projectTitle: activeCoworkProject?.name ?? '',
      rootFolder: workingFolderRef.current,
      startedAt: Date.now(),
    };
    const resolved = nextFromQueue ?? fallback;
    resolvedCoworkRunContextsRef.current.set(runKey, resolved);
    return resolved;
  };

  const commitActiveSessionKey = (nextSessionKey: string) => {
    const normalized = normalizeSessionKey(nextSessionKey);
    activeSessionKeyRef.current = normalized;
    setActiveSessionKey(normalized);
    return normalized;
  };

  const commitCoworkSessionKey = (nextSessionKey: string) => {
    const normalized = normalizeSessionKey(nextSessionKey);
    coworkSessionKeyRef.current = normalized;
    setCoworkSessionKey(normalized);
    return normalized;
  };

  const clearCoworkStreamWatchdog = () => {
    if (coworkStreamWatchdogRef.current) {
      clearTimeout(coworkStreamWatchdogRef.current);
      coworkStreamWatchdogRef.current = null;
    }
  };

  const upsertChatThread = (sessionKey: string, options?: { title?: string; touchedAt?: number }) => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    if (!normalizedSessionKey) {
      return;
    }

    const incomingTitle = options?.title ? toRecentSidebarLabel(options.title) : '';
    const touchedAt = options?.touchedAt;

    setChatThreads((current) => {
      const existing = current.find((thread) => thread.sessionKey === normalizedSessionKey);
      // Keep recents list message-driven: don't create a new chat thread without
      // any usable title signal (typically first user message/history).
      if (!existing && !incomingTitle) {
        return current;
      }

      const canReplaceTitle = !existing || !existing.title || existing.title === DEFAULT_CHAT_THREAD_TITLE;
      const fallbackTitle = toFallbackThreadTitle(normalizedSessionKey, 'chat');
      const title = canReplaceTitle && incomingTitle ? incomingTitle : existing?.title || fallbackTitle;
      const updatedAt = touchedAt ?? existing?.updatedAt ?? Date.now();

      const nextThread: ChatThread = {
        id: getThreadIdForSession(normalizedSessionKey),
        sessionKey: normalizedSessionKey,
        title,
        updatedAt,
      };

      return mergeChatThreads(current, [nextThread]);
    });
  };

  const upsertCoworkThread = (sessionKey: string, options?: { title?: string; touchedAt?: number }) => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    if (!normalizedSessionKey) {
      return;
    }

    const incomingTitle = options?.title ? toRecentSidebarLabel(options.title) : '';
    const touchedAt = options?.touchedAt;

    setCoworkThreads((current) => {
      const existing = current.find((thread) => thread.sessionKey === normalizedSessionKey);
      const canReplaceTitle = !existing || !existing.title || existing.title === DEFAULT_COWORK_THREAD_TITLE;
      const fallbackTitle = toFallbackThreadTitle(normalizedSessionKey, 'cowork');
      const title = canReplaceTitle && incomingTitle ? incomingTitle : existing?.title || fallbackTitle;
      const updatedAt = touchedAt ?? existing?.updatedAt ?? Date.now();

      const nextThread: ChatThread = {
        id: getThreadIdForSession(normalizedSessionKey),
        sessionKey: normalizedSessionKey,
        title,
        updatedAt,
      };

      return mergeChatThreads(current, [nextThread]);
    });
  };

  const renameThread = (sessionKey: string, title: string, kind: 'chat' | 'cowork') => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    const normalizedTitle = toRecentSidebarLabel(title);
    if (!normalizedSessionKey || !normalizedTitle) {
      return;
    }

    const apply = (current: ChatThread[]) => {
      const existing = current.find((thread) => thread.sessionKey === normalizedSessionKey);
      if (!existing) {
        return current;
      }
      const nextThread: ChatThread = {
        ...existing,
        title: normalizedTitle,
        updatedAt: Date.now(),
      };
      return mergeChatThreads(current, [nextThread]);
    };

    if (kind === 'cowork') {
      setCoworkThreads(apply);
    } else {
      setChatThreads(apply);
    }
  };

  const removeThread = (sessionKey: string, kind: 'chat' | 'cowork') => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    if (!normalizedSessionKey) {
      return;
    }

    if (kind === 'cowork') {
      setCoworkThreads((current) => current.filter((thread) => thread.sessionKey !== normalizedSessionKey));
      coworkMessageCache.current.delete(normalizedSessionKey);
      if (coworkSessionKeyRef.current === normalizedSessionKey) {
        commitCoworkSessionKey('');
        setCoworkMessages([]);
      }
      return;
    }

    setChatThreads((current) => current.filter((thread) => thread.sessionKey !== normalizedSessionKey));
    threadMessageCache.current.delete(normalizedSessionKey);
    if (activeSessionKeyRef.current === normalizedSessionKey) {
      commitActiveSessionKey('');
      setChatMessages([]);
      setAwaitingChatStream(false);
      handleChatPromptChange('');
    }
  };

  const pushLocalActionReceipts = (entries: LocalActionReceipt[]) => {
    if (entries.length === 0) {
      return;
    }

    setLocalActionReceipts((current) => [...entries, ...current].slice(0, 30));
  };

  const resolvePendingApproval = (
    approvalId: string,
    decision: { approved: boolean; reason?: string; expired?: boolean },
  ) => {
    setPendingApprovals((current) => current.filter((item) => item.id !== approvalId));

    const resolver = approvalResolversRef.current.get(approvalId);
    if (!resolver) {
      return;
    }

    clearTimeout(resolver.timeoutId);
    approvalResolversRef.current.delete(approvalId);
    resolver.resolve(decision);
  };

  const requestActionApproval = (request: PendingApprovalAction) => {
    setPendingApprovals((current) => [...current, request]);

    return new Promise<{ approved: boolean; reason?: string; expired?: boolean }>((resolve) => {
      const timeoutId = setTimeout(() => {
        resolvePendingApproval(request.id, {
          approved: false,
          reason: 'Approval request timed out.',
          expired: true,
        });
      }, APPROVAL_TIMEOUT_MS);

      approvalResolversRef.current.set(request.id, {
        resolve,
        timeoutId,
      });
    });
  };

  const handleApprovePendingAction = (approvalId: string) => {
    resolvePendingApproval(approvalId, { approved: true });
  };

  const handleRejectPendingAction = (approvalId: string, reason: string) => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setStatus('Provide a reason before rejecting an action.');
      return;
    }

    resolvePendingApproval(approvalId, {
      approved: false,
      reason: trimmedReason,
    });
  };

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const relayE2E: RelayE2EBridge = {
      enqueuePendingApproval: (input) => {
        const now = Date.now();
        const id = input?.id?.trim() || `e2e-approval-${now}`;
        const entry: PendingApprovalAction = {
          id,
          runId: input?.runId?.trim() || 'e2e-run',
          actionId: input?.actionId?.trim() || `e2e-action-${now}`,
          actionType: input?.actionType ?? 'create_file',
          path: input?.path?.trim() || 'notes/e2e.md',
          scopeId: input?.scopeId?.trim() || 'workspace.write',
          scopeName: input?.scopeName?.trim() || 'Workspace write',
          riskLevel: input?.riskLevel ?? 'high',
          summary: input?.summary?.trim() || 'Create notes/e2e.md',
          preview: input?.preview,
          createdAt: input?.createdAt ?? now,
        };

        setPendingApprovals((current) => [...current, entry]);
        return id;
      },
      clearPendingApprovals: () => {
        setPendingApprovals([]);
      },
      getPendingApprovals: () => pendingApprovals,
    };

    window.relayE2E = relayE2E;

    return () => {
      delete window.relayE2E;
    };
  }, [pendingApprovals]);

  const rekeyChatThread = (fromSessionKey: string, toSessionKey: string) => {
    const from = normalizeSessionKey(fromSessionKey);
    const to = normalizeSessionKey(toSessionKey);
    if (!from || !to || from === to) {
      return;
    }

    setChatThreads((current) => {
      const source = current.find((thread) => thread.sessionKey === from);
      const target = current.find((thread) => thread.sessionKey === to);
      if (!source && !target) {
        return current;
      }

      const merged: ChatThread = {
        id: getThreadIdForSession(to),
        sessionKey: to,
        title:
          target?.title && target.title !== DEFAULT_CHAT_THREAD_TITLE
            ? target.title
            : source?.title || target?.title || DEFAULT_CHAT_THREAD_TITLE,
        updatedAt: Math.max(source?.updatedAt ?? 0, target?.updatedAt ?? 0, Date.now()),
      };

      const remaining = current.filter((thread) => thread.sessionKey !== from && thread.sessionKey !== to);
      return mergeChatThreads(remaining, [merged]);
    });
  };

  const loadRecentChatsFromBackend = async (client: OpenClawGatewayClient) => {
    const sessions = await client.listSessions(100);

    const filtered = sessions.filter((session) => {
      const normalized = normalizeSessionKey(session.key);
      return !!normalized;
    });

    const existingSessionKeys = new Set(
      filtered.map((session) => normalizeSessionKey(session.key).toLowerCase()).filter(Boolean),
    );

    const threadsOrNull = await Promise.all(
      filtered.slice(0, 20).map(async (session, index) => {
        const sessionTitle = session.title ? toRecentSidebarLabel(session.title) : '';
        if (sessionTitle) {
          return {
            id: getThreadIdForSession(session.key),
            sessionKey: session.key,
            title: sessionTitle,
            updatedAt: Date.now() - index,
          } satisfies ChatThread;
        }

        try {
          const history = await client.getHistory(session.key, 30);
          const titleFromHistory = deriveThreadTitleFromMessages(history);
          if (!titleFromHistory) {
            return null;
          }

          return {
            id: getThreadIdForSession(session.key),
            sessionKey: session.key,
            title: titleFromHistory,
            updatedAt: Date.now() - index,
          } satisfies ChatThread;
        } catch {
          return null;
        }
      }),
    );

    const threads = threadsOrNull.filter((thread): thread is ChatThread => thread !== null);
    setChatThreads((current) => {
      const validCurrent = current.filter((thread) =>
        existingSessionKeys.has(normalizeSessionKey(thread.sessionKey).toLowerCase()),
      );

      const incomingPreservingCustomTitles = threads.map((thread) => {
        const existing = validCurrent.find(
          (entry) => normalizeSessionKey(entry.sessionKey).toLowerCase() === normalizeSessionKey(thread.sessionKey).toLowerCase(),
        );
        if (existing && isCustomChatThreadTitle(existing.title, existing.sessionKey)) {
          return {
            ...thread,
            title: existing.title,
            updatedAt: Math.max(thread.updatedAt, existing.updatedAt),
          } satisfies ChatThread;
        }

        return thread;
      });

      return mergeChatThreads(validCurrent, incomingPreservingCustomTitles);
    });

    // Keep cowork recents consistent with live gateway sessions too.
    setCoworkThreads((current) =>
      current.filter((thread) => existingSessionKeys.has(normalizeSessionKey(thread.sessionKey).toLowerCase())),
    );
  };

  useEffect(() => {
    const payload: PersistedRecents = {
      chatThreads,
      coworkThreads,
    };
    try {
      localStorage.setItem(RELAY_RECENTS_KEY, JSON.stringify(payload));
    } catch {
      // ignore localStorage quota/privacy failures
    }
  }, [chatThreads, coworkThreads]);

  useEffect(() => {
    try {
      localStorage.setItem(COWORK_PROJECTS_STORAGE_KEY, JSON.stringify(coworkProjects));
    } catch {
      // ignore persistence failures
    }
  }, [coworkProjects]);

  useEffect(() => {
    try {
      localStorage.setItem(COWORK_TASKS_STORAGE_KEY, JSON.stringify(coworkTasks.slice(0, 250)));
    } catch {
      // ignore persistence failures
    }
  }, [coworkTasks]);

  useEffect(() => {
    try {
      localStorage.setItem(COWORK_PROJECT_KNOWLEDGE_STORAGE_KEY, JSON.stringify(projectKnowledgeItems.slice(0, 500)));
    } catch {
      // ignore persistence failures
    }
  }, [projectKnowledgeItems]);

  useEffect(() => {
    try {
      localStorage.setItem(COWORK_WEB_SEARCH_MODE_STORAGE_KEY, coworkWebSearchEnabled ? 'true' : 'false');
    } catch {
      // ignore persistence failures
    }
  }, [coworkWebSearchEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_DRAFT_STORAGE_KEY, chatDraftPrompt);
    } catch {
      // ignore persistence failures
    }
  }, [chatDraftPrompt]);

  useEffect(() => {
    try {
      localStorage.setItem(COWORK_DRAFT_STORAGE_KEY, coworkDraftPrompt);
    } catch {
      // ignore persistence failures
    }
  }, [coworkDraftPrompt]);

  useEffect(() => {
    try {
      localStorage.setItem(SCHEDULED_JOB_PROJECT_LINKS_STORAGE_KEY, JSON.stringify(scheduledJobProjectLinks));
    } catch {
      // ignore persistence failures
    }
  }, [scheduledJobProjectLinks]);

  useEffect(() => {
    try {
      localStorage.setItem(OUTCOME_PIPELINES_STORAGE_KEY, JSON.stringify(outcomePipelines.slice(0, 500)));
    } catch {
      // ignore persistence failures
    }
  }, [outcomePipelines]);

  useEffect(() => {
    try {
      localStorage.setItem(OUTCOME_PIPELINE_RUNS_STORAGE_KEY, JSON.stringify(outcomePipelineRuns.slice(0, 1000)));
    } catch {
      // ignore persistence failures
    }
  }, [outcomePipelineRuns]);

  useEffect(() => {
    try {
      localStorage.setItem(OPERATOR_DEFINITIONS_STORAGE_KEY, JSON.stringify(operatorDefinitions.slice(0, 500)));
    } catch {
      // ignore persistence failures
    }
  }, [operatorDefinitions]);

  useEffect(() => {
    try {
      localStorage.setItem(OPERATOR_RUNS_STORAGE_KEY, JSON.stringify(operatorRuns.slice(0, 1000)));
    } catch {
      // ignore persistence failures
    }
  }, [operatorRuns]);

  useEffect(() => {
    try {
      if (activeCoworkProjectId) {
        localStorage.setItem(COWORK_ACTIVE_PROJECT_STORAGE_KEY, activeCoworkProjectId);
      } else {
        localStorage.removeItem(COWORK_ACTIVE_PROJECT_STORAGE_KEY);
      }
    } catch {
      // ignore persistence failures
    }
  }, [activeCoworkProjectId]);

  useEffect(() => {
    if (!activeCoworkProjectId) {
      return;
    }

    const exists = coworkProjects.some((project) => project.id === activeCoworkProjectId);
    if (exists) {
      return;
    }

    setActiveCoworkProjectId(coworkProjects[0]?.id ?? '');
  }, [activeCoworkProjectId, coworkProjects]);

  useEffect(() => {
    if (coworkProjects.length === 0) {
      setCoworkTasks([]);
      return;
    }

    const validProjectIds = new Set(coworkProjects.map((project) => project.id));
    setCoworkTasks((current) => current.filter((task) => validProjectIds.has(task.projectId)));
  }, [coworkProjects]);

  useEffect(() => {
    if (coworkProjects.length === 0) {
      return;
    }

    const projectIds = new Set(coworkProjects.map((project) => project.id));
    setOperatorDefinitions((current) => {
      const filtered = current.filter((item) => projectIds.has(item.projectId));
      const now = Date.now();
      const withDefaults = [...filtered];
      for (const project of coworkProjects) {
        const exists = withDefaults.some((item) => item.projectId === project.id && item.kind === 'research_report');
        if (!exists) {
          const id =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `operator-${now}-${Math.random().toString(16).slice(2)}`;
          withDefaults.unshift({
            id,
            projectId: project.id,
            kind: 'research_report',
            name: 'Research Report',
            description: 'Produces a structured report with key findings, sources, and next actions.',
            enabled: true,
            inputSchema: createDefaultResearchInputSchema(),
            outputRequirements: createDefaultResearchOutputRequirements(),
            routingPolicy: createDefaultResearchRoutingPolicy(),
            successCriteria: createDefaultResearchSuccessCriteria(),
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      return withDefaults.slice(0, 500);
    });
    setOperatorRuns((current) => current.filter((item) => projectIds.has(item.projectId)));
  }, [coworkProjects]);

  useEffect(() => {
    if (!activeCoworkProject) {
      return;
    }

    const nextFolder = activeCoworkProject.workspaceFolder.trim();
    if (!nextFolder || nextFolder === workingFolder.trim()) {
      return;
    }

    setWorkingFolder(nextFolder);
    workingFolderRef.current = nextFolder;
  }, [activeCoworkProject, workingFolder]);

  useEffect(() => {
    let cancelled = false;

    const loadProjectFileReferences = async () => {
      const rootPath = activeCoworkProject?.workspaceFolder?.trim() ?? '';
      if (!rootPath || !bridge?.listDirInFolder) {
        setCoworkProjectPathReferences([]);
        return;
      }

      const MAX_ITEMS = 500;
      const MAX_DEPTH = 4;
      const MAX_DIR_VISITS = 120;
      const queue: Array<{ relPath: string; depth: number }> = [{ relPath: '', depth: 0 }];
      const pathRefs: ProjectPathReference[] = [];
      let directoryVisits = 0;

      while (queue.length > 0 && pathRefs.length < MAX_ITEMS && directoryVisits < MAX_DIR_VISITS) {
        const next = queue.shift();
        if (!next) {
          break;
        }

        let listing: Awaited<ReturnType<NonNullable<typeof bridge.listDirInFolder>>>;
        try {
          listing = await bridge.listDirInFolder(rootPath, next.relPath);
        } catch {
          break;
        }

        directoryVisits += 1;
        const sortedItems = [...listing.items].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));

        for (const item of sortedItems) {
          pathRefs.push({
            path: item.path,
            kind: item.kind,
          });
          if (pathRefs.length >= MAX_ITEMS) {
            break;
          }

          if (item.kind === 'file') {
            continue;
          }

          if (item.kind === 'directory' && next.depth + 1 < MAX_DEPTH && directoryVisits + queue.length < MAX_DIR_VISITS) {
            queue.push({ relPath: item.path, depth: next.depth + 1 });
          }
        }
      }

      if (cancelled) {
        return;
      }

      const deduped = new Map<string, ProjectPathReference>();
      for (const item of pathRefs) {
        const key = `${item.kind}:${item.path}`;
        if (!deduped.has(key)) {
          deduped.set(key, item);
        }
      }

      setCoworkProjectPathReferences(
        Array.from(deduped.values())
          .sort((a, b) => {
            if (a.kind !== b.kind) {
              return a.kind === 'directory' ? -1 : 1;
            }
            return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
          })
          .slice(0, MAX_ITEMS),
      );
    };

    void loadProjectFileReferences();

    return () => {
      cancelled = true;
    };
  }, [activeCoworkProject?.id, activeCoworkProject?.workspaceFolder, bridge]);

  const loadChatSession = async (sessionKeyInput: string, statusMessage?: string) => {
    const client = gatewayClientRef.current;
    if (!client) {
      return;
    }

    const requestedSessionKey = normalizeSessionKey(sessionKeyInput);
    if (!requestedSessionKey) {
      setStatus('Invalid session key.');
      return;
    }
    commitActiveSessionKey(requestedSessionKey);
    const requestId = chatLoadRequestRef.current + 1;
    chatLoadRequestRef.current = requestId;

    try {
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      let resolvedSessionKey = requestedSessionKey;
      let history: ChatMessage[];

      try {
        const [loadedHistory] = await Promise.all([
          client.getHistory(resolvedSessionKey, 30),
          loadModelsForSession(client, resolvedSessionKey),
        ]);
        history = loadedHistory;
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const isMissingSession = message.includes('no session found') || message.includes('no sendable session found');
        if (!isMissingSession) {
          throw error;
        }

        let retrySessionKey = '';
        try {
          const liveSessions = await client.listSessions(200);
          const liveKeys = liveSessions.map((session) => session.key);
          retrySessionKey = findMatchingSessionKey(liveKeys, resolvedSessionKey) ?? '';
        } catch {
          // fallback below
        }

        if (!retrySessionKey) {
          retrySessionKey = normalizeSessionKey(await client.resolveSessionKey(resolvedSessionKey));
        }

        if (!retrySessionKey) {
          throw error;
        }

        resolvedSessionKey = retrySessionKey;
        if (resolvedSessionKey !== requestedSessionKey) {
          rekeyChatThread(requestedSessionKey, resolvedSessionKey);
        }

        const [loadedHistory] = await Promise.all([
          client.getHistory(resolvedSessionKey, 30),
          loadModelsForSession(client, resolvedSessionKey),
        ]);
        history = loadedHistory;
      }

      if (requestId !== chatLoadRequestRef.current) {
        return;
      }

      commitActiveSessionKey(resolvedSessionKey);

      setChatMessages(history);
      if (history.length > 0) {
        threadMessageCache.current.set(resolvedSessionKey, history);
      }
      const titleFromHistory = deriveThreadTitleFromMessages(history);
      upsertChatThread(resolvedSessionKey, {
        title: titleFromHistory || undefined,
      });

      if (statusMessage) {
        if (titleFromHistory) {
          setStatus(`${statusMessage}: ${titleFromHistory}`);
        } else if (history.length === 0) {
          setStatus(`${statusMessage}: no messages in this chat yet.`);
        } else {
          setStatus(`${statusMessage}: ${toFallbackThreadTitle(resolvedSessionKey, 'chat')}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load chat session.';
      const normalizedMessage = message.toLowerCase();
      const isMissingSession =
        normalizedMessage.includes('no session found') ||
        normalizedMessage.includes('no sendable session found') ||
        normalizedMessage.includes('session not found');
      if (isMissingSession) {
        removeThread(requestedSessionKey, 'chat');
      }
      setStatus(message);
    }
  };

  const loadCoworkSession = async (sessionKeyInput: string, statusMessage?: string) => {
    const client = gatewayClientRef.current;
    if (!client) {
      return;
    }

    const requestedSessionKey = normalizeSessionKey(sessionKeyInput);
    if (!requestedSessionKey) {
      setStatus('Invalid cowork session key.');
      return;
    }

    commitCoworkSessionKey(requestedSessionKey);
    const requestId = coworkLoadRequestRef.current + 1;
    coworkLoadRequestRef.current = requestId;

    try {
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      const history = await client.getHistory(requestedSessionKey, 50);
      const normalizedHistory = history.map(normalizeCoworkMessage);

      if (requestId !== coworkLoadRequestRef.current) {
        return;
      }

      void loadCoworkModels(client, requestedSessionKey);

      setCoworkMessages(normalizedHistory);
      if (normalizedHistory.length > 0) {
        coworkMessageCache.current.set(requestedSessionKey, normalizedHistory);
      }

      const titleFromHistory = deriveThreadTitleFromMessages(normalizedHistory);
      upsertCoworkThread(requestedSessionKey, {
        title: titleFromHistory || undefined,
      });

      if (statusMessage) {
        setStatus(
          titleFromHistory
            ? `${statusMessage}: ${titleFromHistory}`
            : `${statusMessage}: ${toFallbackThreadTitle(requestedSessionKey, 'cowork')}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load cowork session.';
      setStatus(message);
    }
  };

  const ensureConnectedClient = async (client: OpenClawGatewayClient) => {
    await client.connect({
      gatewayUrl: draftGatewayUrl,
      token: draftGatewayToken,
    });
  };

  const getOrResolveSession = async (client: OpenClawGatewayClient) => {
    try {
      const sessionKey = normalizeSessionKey(await client.getActiveSessionKey());
      if (!sessionKey) {
        throw new Error('No active session available from Gateway.');
      }

      commitActiveSessionKey(sessionKey);
      await loadRecentChatsFromBackend(client);
      setStatus(`Session ready: ${sessionKey}`);
      return sessionKey;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to get active session. ${message}`);
    }
  };

  const ensureActiveChatSession = async (
    client: OpenClawGatewayClient,
    options?: { createIfMissing?: boolean },
  ) => {
    await ensureConnectedClient(client);

    const current = normalizeSessionKey(activeSessionKeyRef.current);
    if (current) {
      commitActiveSessionKey(current);
      return current;
    }

    if (options?.createIfMissing) {
      const sessionKey = normalizeSessionKey(await client.createChatSession());
      if (!sessionKey) {
        throw new Error('No session key returned from Gateway.');
      }
      commitActiveSessionKey(sessionKey);
      await loadRecentChatsFromBackend(client);
      setStatus(`Session ready: ${sessionKey}`);
      return sessionKey;
    }

    throw new Error('No active chat session. Start a new chat first.');
  };

  const loadModelsForSession = async (client: OpenClawGatewayClient, sessionKey: string) => {
    setModelsLoading(true);
    try {
      const [choices, currentModel] = await Promise.all([
        client.listModels(),
        client.getSessionModel(sessionKey).catch(() => null),
      ]);

      setChatModels(choices.map((model) => ({ value: model.value, label: model.label })));
      setSelectedModel(currentModel ?? '');
    } catch {
      setChatModels([]);
      setSelectedModel('');
    } finally {
      setModelsLoading(false);
    }
  };

  const loadCoworkModels = async (client: OpenClawGatewayClient, sessionKey?: string) => {
    setModelsLoading(true);
    try {
      const [choices, currentModel] = await Promise.all([
        client.listModels(),
        sessionKey ? client.getSessionModel(sessionKey).catch(() => null) : Promise.resolve(null),
      ]);

      setCoworkModels(choices.map((model) => ({ value: model.value, label: model.label })));
      if (sessionKey) {
        setCoworkModel(currentModel ?? '');
      }
    } catch {
      setCoworkModels([]);
      if (sessionKey) {
        setCoworkModel('');
      }
    } finally {
      setModelsLoading(false);
    }
  };

  const loadLocalConfig = () => {
    try {
      const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        gatewayUrl: parsed.gatewayUrl?.trim() || DEFAULT_GATEWAY_URL,
        gatewayToken: parsed.gatewayToken ?? '',
      } satisfies AppConfig;
    } catch {
      return null;
    }
  };

  const persistLocalConfig = (nextConfig: AppConfig) => {
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(nextConfig));
  };

  const updateGatewayConnections = useCallback((updater: (prev: GatewayConnectionProfile[]) => GatewayConnectionProfile[]) => {
    setGatewayConnections((prev) => {
      const next = updater(prev);
      persistGatewayConnectionProfiles(next);
      return next;
    });
  }, []);

  const setGatewayDefaultConnection = useCallback((connectionId: string) => {
    const normalized = connectionId.trim();
    setDefaultGatewayConnectionId(normalized);
    persistDefaultGatewayConnectionId(normalized);
  }, []);

  const markGatewayConnectionLastUsed = useCallback((connectedConfig: AppConfig) => {
    const gatewayUrl = connectedConfig.gatewayUrl.trim() || DEFAULT_GATEWAY_URL;
    const gatewayToken = connectedConfig.gatewayToken ?? '';
    const now = Date.now();
    let matchedConnectionId = '';

    updateGatewayConnections((prev) =>
      prev.map((profile) => {
        if (profile.gatewayUrl === gatewayUrl && profile.gatewayToken === gatewayToken) {
          matchedConnectionId = profile.id;
          return { ...profile, lastUsedAt: now, updatedAt: now };
        }
        return profile;
      }),
    );

    if (matchedConnectionId) {
      setGatewayDefaultConnection(matchedConnectionId);
    }
  }, [setGatewayDefaultConnection, updateGatewayConnections]);

  const handleSelectGatewayConnection = useCallback((connectionId: string) => {
    const profile = gatewayConnections.find((entry) => entry.id === connectionId);
    if (!profile) {
      return;
    }

    setDraftGatewayUrl(profile.gatewayUrl);
    setDraftGatewayToken(profile.gatewayToken);
    setStatus(`Loaded connection "${profile.name}". Click Save and connect to apply it.`);
  }, [gatewayConnections]);

  const handleSaveGatewayConnection = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus('Connection name is required.');
      return;
    }

    const normalizedUrl = draftGatewayUrl.trim() || DEFAULT_GATEWAY_URL;
    const now = Date.now();
    let savedConnectionId = '';

    updateGatewayConnections((prev) => {
      const duplicateByName = prev.find((entry) => entry.name.toLowerCase() === trimmedName.toLowerCase());
      if (duplicateByName) {
        savedConnectionId = duplicateByName.id;
        return prev
          .map((entry) =>
            entry.id === duplicateByName.id
              ? {
                  ...entry,
                  name: trimmedName,
                  gatewayUrl: normalizedUrl,
                  gatewayToken: draftGatewayToken,
                  updatedAt: now,
                }
              : entry,
          )
          .sort((a, b) => b.updatedAt - a.updatedAt);
      }

      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `conn-${now}-${Math.random().toString(36).slice(2, 9)}`;
      savedConnectionId = id;

      return [
        {
          id,
          name: trimmedName,
          gatewayUrl: normalizedUrl,
          gatewayToken: draftGatewayToken,
          createdAt: now,
          updatedAt: now,
        },
        ...prev,
      ];
    });

    if (savedConnectionId) {
      setGatewayDefaultConnection(savedConnectionId);
    }

    setStatus(`Saved connection "${trimmedName}".`);
  }, [draftGatewayToken, draftGatewayUrl, setGatewayDefaultConnection, updateGatewayConnections]);

  const handleOverwriteGatewayConnection = useCallback((connectionId: string) => {
    const normalizedUrl = draftGatewayUrl.trim() || DEFAULT_GATEWAY_URL;
    const now = Date.now();

    updateGatewayConnections((prev) =>
      prev
        .map((entry) =>
          entry.id === connectionId
            ? {
                ...entry,
                gatewayUrl: normalizedUrl,
                gatewayToken: draftGatewayToken,
                updatedAt: now,
              }
            : entry,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
    setGatewayDefaultConnection(connectionId);

    setStatus('Updated saved connection with current URL/token.');
  }, [draftGatewayToken, draftGatewayUrl, setGatewayDefaultConnection, updateGatewayConnections]);

  const handleDeleteGatewayConnection = useCallback((connectionId: string) => {
    updateGatewayConnections((prev) => prev.filter((entry) => entry.id !== connectionId));
    if (defaultGatewayConnectionId === connectionId) {
      setGatewayDefaultConnection('');
    }
    setStatus('Deleted saved connection.');
  }, [defaultGatewayConnectionId, setGatewayDefaultConnection, updateGatewayConnections]);

  const appendGatewayDiscoveryHint = useCallback(
    async (baseMessage: string): Promise<string> => {
      const fallback = baseMessage.trim() || 'Gateway is offline or unreachable.';
      if (!bridge?.discoverGateway) {
        return fallback;
      }
      try {
        const discovery = await bridge.discoverGateway();
        if (discovery.found && discovery.gatewayUrl) {
          return `${fallback} Discovered local gateway at ${discovery.gatewayUrl}.`;
        }
        if (discovery.binaryFound) {
          const binaryHint = discovery.binaryPath ? ` (${discovery.binaryPath})` : '';
          return `${fallback} OpenClaw binary detected${binaryHint}, but no running gateway was found.`;
        }
        return `${fallback} No local OpenClaw gateway was detected.`;
      } catch {
        return fallback;
      }
    },
    [bridge],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      // Ctrl+N — new chat / new task
      if (event.key === 'n') {
        event.preventDefault();
        if (activePage === 'cowork') {
          setCoworkMessages([]);
          setCoworkAwaitingStream(false);
          setCoworkStreamingText('');
          setCoworkRunPhase('idle');
          setCoworkRunStatus('Ready for a new task.');
          setLocalPlanActions([]);
          handleCoworkPromptChange('');
          setStatus('Ready for a new task.');
          setCoworkResetKey((c) => c + 1);
        } else {
          void handleStartNewChat();
        }
        return;
      }

      // Ctrl+K — open search
      if (event.key === 'k') {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
        if (!searchOpen) {
          setSearchQuery('');
          setActiveMenuItem('Search');
        }
        return;
      }

      // Ctrl+Shift+S — settings
      if (event.key === 'S' && event.shiftKey) {
        event.preventDefault();
        setActivePage('settings');
        return;
      }

      // Ctrl+, — settings (common IDE shortcut)
      if (event.key === ',') {
        event.preventDefault();
        setActivePage('settings');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePage, searchOpen]);


  useEffect(() => {
    const defaultProfile =
      defaultGatewayConnectionId.trim()
        ? gatewayConnections.find((profile) => profile.id === defaultGatewayConnectionId.trim())
        : undefined;

    if (!bridge) {
      const localConfig = loadLocalConfig();
      const resolvedConfig =
        localConfig?.gatewayUrl?.trim()
          ? localConfig
          : defaultProfile
            ? {
                gatewayUrl: defaultProfile.gatewayUrl,
                gatewayToken: defaultProfile.gatewayToken,
              }
            : localConfig;
      if (resolvedConfig) {
        setConfig(resolvedConfig);
        setDraftGatewayUrl(resolvedConfig.gatewayUrl);
        setDraftGatewayToken(resolvedConfig.gatewayToken);
        setStatus('Loaded local configuration (bridge unavailable).');
      } else {
        setStatus('Electron bridge unavailable. Configuration will be saved locally for this browser profile.');
      }
      setConfigReady(true);
      return;
    }

    let cancelled = false;

    bridge
      .getConfig()
      .then((storedConfig) => {
        if (cancelled) {
          return;
        }

        const resolvedConfig =
          storedConfig?.gatewayUrl?.trim()
            ? storedConfig
            : defaultProfile
              ? {
                  gatewayUrl: defaultProfile.gatewayUrl,
                  gatewayToken: defaultProfile.gatewayToken,
                }
              : storedConfig;

        setConfig(resolvedConfig);
        setDraftGatewayUrl(resolvedConfig.gatewayUrl);
        setDraftGatewayToken(resolvedConfig.gatewayToken);
        setStatus('Configuration loaded.');
        setConfigReady(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        const localConfig = loadLocalConfig();
        const resolvedConfig =
          localConfig?.gatewayUrl?.trim()
            ? localConfig
            : defaultProfile
              ? {
                  gatewayUrl: defaultProfile.gatewayUrl,
                  gatewayToken: defaultProfile.gatewayToken,
                }
              : localConfig;
        if (resolvedConfig) {
          setConfig(resolvedConfig);
          setDraftGatewayUrl(resolvedConfig.gatewayUrl);
          setDraftGatewayToken(resolvedConfig.gatewayToken);
          setStatus('Loaded local fallback configuration.');
        } else {
          setStatus('Unable to load config. Using defaults.');
        }
        setConfigReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [bridge, defaultGatewayConnectionId, gatewayConnections]);

  useEffect(() => {
    if (!bridge?.isWindowMaximized) {
      return;
    }

    bridge
      .isWindowMaximized()
      .then((value) => setIsMaximized(value))
      .catch(() => {
        setIsMaximized(false);
      });
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.getDownloadsPath) {
      return;
    }

    let cancelled = false;
    bridge
      .getDownloadsPath()
      .then((downloadsPath) => {
        if (!cancelled && typeof downloadsPath === 'string' && downloadsPath.trim()) {
          setWorkingFolder(downloadsPath);
        }
      })
      .catch(() => {
        // keep existing default
      });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    activeSessionKeyRef.current = normalizeSessionKey(activeSessionKey);
  }, [activeSessionKey]);

  useEffect(() => {
    coworkSessionKeyRef.current = normalizeSessionKey(coworkSessionKey);
  }, [coworkSessionKey]);

  useEffect(() => {
    workingFolderRef.current = workingFolder.trim();
  }, [workingFolder]);

  useEffect(() => {
    const client = new OpenClawGatewayClient();
    client.setConnectionHandler((connected, message) => {
      setStatus(message);
      setGatewayConnected(connected);
    });
    client.setEventHandler((event) => {
      if (event.type === 'event' && event.event === 'chat') {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const eventSessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey.trim() : '';

        const isCoworkEvent = !!eventSessionKey && eventSessionKey === coworkSessionKeyRef.current;
        const runId = typeof payload.runId === 'string' ? payload.runId : `evt-${Date.now()}`;
        const state = typeof payload.state === 'string' ? payload.state : 'final';
        const message = payload.message ?? payload;
        const text = extractChatText(message);
        const visibleText = stripRelayActionPayloadFromText(text);
        const role = extractChatRole(message);

        if (isCoworkEvent) {
          if (state === 'error') {
            clearCoworkStreamWatchdog();
            setCoworkAwaitingStream(false);
            setCoworkRunPhase('error');
            const errorMessage =
              typeof payload.errorMessage === 'string' && payload.errorMessage.trim()
                ? payload.errorMessage
                : 'Cowork stream failed.';
            setCoworkRunStatus(errorMessage);
            setCoworkProgressStage('executing_workstreams', {
              blocked: true,
              details: errorMessage,
            });
            setStatus(errorMessage);
            const taskEntry = resolveCoworkTaskForRun(eventSessionKey || coworkSessionKeyRef.current, runId);
            if (taskEntry) {
              setCoworkTaskStatus(taskEntry.taskId, 'failed', {
                runId,
                summary: errorMessage,
                outcome: errorMessage,
              });
              finalizeCoworkTaskRun(eventSessionKey || coworkSessionKeyRef.current, taskEntry.taskId);
            }
            return;
          }

          if (state === 'delta' && text) {
            clearCoworkStreamWatchdog();
            setCoworkAwaitingStream(false);
            setCoworkRunPhase('streaming');
            setCoworkRunStatus('Cowork is streaming a response.');
            setCoworkProgressStage('executing_workstreams', {
              details: 'Running workstreams and producing intermediate results.',
            });
            setCoworkStreamingText(visibleText);
            const taskEntry = resolveCoworkTaskForRun(eventSessionKey || coworkSessionKeyRef.current, runId);
            if (taskEntry) {
              setCoworkTaskStatus(taskEntry.taskId, 'running', {
                runId,
                summary: 'Streaming response from cowork.',
              });
            }
            const streamId = `cowork-stream-${runId}`;
            setCoworkMessages((current) => {
              if (!visibleText) {
                return current;
              }
              const index = current.findIndex((entry) => entry.id === streamId);
              if (index >= 0) {
                const next = [...current];
                next[index] = { ...next[index], text: visibleText, role };
                if (eventSessionKey) {
                  coworkMessageCache.current.set(eventSessionKey, next);
                }
                return next;
              }
              const next = [...current, { id: streamId, role, text: visibleText }];
              if (eventSessionKey) {
                coworkMessageCache.current.set(eventSessionKey, next);
              }
              return next;
            });
            return;
          }

          if (state === 'final' || state === 'aborted') {
            clearCoworkStreamWatchdog();
            setCoworkAwaitingStream(false);
            setCoworkRunPhase('completed');
            setCoworkRunStatus(state === 'aborted' ? 'Cowork run ended early.' : 'Cowork run completed.');
            setCoworkProgressStage('synthesizing_outputs', {
              details: 'Synthesizing output from completed workstreams.',
            });
            setCoworkStreamingText(visibleText);
            const streamId = `cowork-stream-${runId}`;
            const finalId = `cowork-final-${runId}`;
            const activeModel = typeof payload.model === 'string' ? payload.model : undefined;
            const coworkUsage = parseUsageFromPayload(payload, activeModel);
            if (coworkUsage) {
              accumulateTodayUsage(coworkUsage);
              setSessionUsage((prev) => addUsage(prev, coworkUsage));
            }
            const relayActions = parseRelayFileActions({
              text,
              message,
              payload,
            });
            const structuredActivityItems = parseRelayActivityItems({
              text,
              message,
              payload,
            });
            const fallbackActivityItems = deriveActivityItemsFromAssistantText(visibleText, runId);
            const activityItems = structuredActivityItems.length > 0 ? structuredActivityItems : fallbackActivityItems;
            const hasStructuredActions = relayActions.length > 0;
            const hasStructuredActivity = activityItems.length > 0;
            setCoworkMessages((current) => {
              const withoutStream = current.filter((entry) => {
                if (entry.id === streamId) {
                  return false;
                }
                if ((hasStructuredActions || hasStructuredActivity) && entry.id.startsWith('cowork-stream-')) {
                  return false;
                }
                return true;
              });
              if (withoutStream.some((entry) => entry.id === finalId)) {
                return withoutStream;
              }
              const next =
                visibleText
                  ? [...withoutStream, { id: finalId, role, text: visibleText, ...(coworkUsage ? { usage: coworkUsage } : {}) }]
                  : withoutStream;
              if (eventSessionKey) {
                coworkMessageCache.current.set(eventSessionKey, next);
              }
              return next;
            });

            if (!hasStructuredActions && hasStructuredActivity) {
              const activityMessage: ChatMessage = {
                id: `cowork-activity-${runId}`,
                role: 'system',
                text: activityItems.map((item) => item.label).join('\n'),
                meta: {
                  kind: 'activity',
                  items: activityItems,
                },
              };

              setCoworkMessages((current) => {
                if (current.some((entry) => entry.id === activityMessage.id)) {
                  return current;
                }

                const next = [...current, activityMessage];
                if (eventSessionKey) {
                  coworkMessageCache.current.set(eventSessionKey, next);
                }
                return next;
              });
            }
            if (eventSessionKey) {
              upsertCoworkThread(eventSessionKey, {
                touchedAt: Date.now(),
              });
            }

            const actionRunKey = `${eventSessionKey || 'unknown'}:${runId}`;
            const runContext = resolveCoworkRunContext(eventSessionKey || coworkSessionKeyRef.current, runId);
            const taskEntry = resolveCoworkTaskForRun(eventSessionKey || coworkSessionKeyRef.current, runId);
            if (taskEntry) {
              setCoworkTaskStatus(taskEntry.taskId, 'completed', {
                runId,
                summary: state === 'aborted' ? 'Run ended early.' : 'Run completed.',
              });
            }
            if (
              relayActions.length > 0 &&
              !executedCoworkActionRunsRef.current.has(actionRunKey)
            ) {
              executedCoworkActionRunsRef.current.add(actionRunKey);
              void (async () => {
                const postActionReceipt = (
                  summary: string,
                  actionReceipts: LocalActionReceipt[],
                  previews: string[],
                  errors: string[],
                ) => {
                  setCoworkRunStatus(summary);
                  setCoworkProgressStage('deliverables', {
                    completeThrough: true,
                    details: errors.length > 0 ? 'Deliverables generated with action errors.' : 'Deliverables generated successfully.',
                  });
                  setStatus(summary);
                  pushLocalActionReceipts(actionReceipts);
                  recordCoworkArtifactsFromReceipts(actionReceipts, runId);

                  if (taskEntry) {
                    const nextStatus: CoworkProjectTaskStatus =
                      errors.length > 0 ? 'failed' : actionReceipts.some((item) => item.status === 'ok') ? 'completed' : 'failed';
                    setCoworkTaskStatus(taskEntry.taskId, nextStatus, {
                      runId,
                      summary,
                      outcome: errors.length > 0 ? errors.join('\n') : previews.join('\n'),
                    });
                    finalizeCoworkTaskRun(eventSessionKey || coworkSessionKeyRef.current, taskEntry.taskId);
                  }

                  const machineReadableReceipt = {
                    relay_action_receipts: actionReceipts,
                  };

                  const receiptLines = [
                    summary,
                    ...previews,
                    ...errors.map((line) => `! ${line}`),
                    '```json',
                    JSON.stringify(machineReadableReceipt, null, 2),
                    '```',
                  ];

                  const activityItems: ChatActivityItem[] = [
                    ...actionReceipts.map((receipt, index): ChatActivityItem => {
                      const tone: ChatActivityItem['tone'] = receipt.status === 'ok' ? 'success' : 'danger';
                      const verb =
                        receipt.type === 'create_file' ? 'Created' :
                        receipt.type === 'append_file' ? 'Appended' :
                        receipt.type === 'read_file' ? 'Read' :
                        receipt.type === 'list_dir' ? 'Listed' :
                        receipt.type === 'exists' ? 'Checked' :
                        receipt.type === 'rename' ? 'Renamed' :
                        receipt.type === 'delete' ? 'Deleted' :
                        receipt.type === 'shell_exec' ? 'Executed' :
                        receipt.type === 'web_fetch' ? 'Fetched' :
                        'Completed';
                      return {
                        id: `activity-receipt-${runId}-${index + 1}`,
                        label: `${receipt.status === 'ok' ? verb : `${verb} failed`}: ${receipt.path}`,
                        details: receipt.message || receipt.errorCode || receipt.path,
                        tone,
                      };
                    }),
                  ];
                  if (activityItems.length === 0) {
                    activityItems.push({
                      id: `activity-summary-${runId}`,
                      label: summary,
                      details: summary,
                      tone: errors.length > 0 ? 'danger' : 'success',
                    });
                  }

                  const receiptMessage: ChatMessage = {
                    id: `cowork-actions-${runId}`,
                    role: 'system',
                    text: receiptLines.join('\n'),
                    meta: {
                      kind: 'activity',
                      items: activityItems,
                    },
                  };

                  setCoworkMessages((current) => {
                    if (current.some((entry) => entry.id === receiptMessage.id)) {
                      return current;
                    }

                    const next = [...current, receiptMessage];
                    if (eventSessionKey) {
                      coworkMessageCache.current.set(eventSessionKey, next);
                    }
                    return next;
                  });
                };

                if (!bridge) {
                  const noBridgeMessage = 'AI requested local file actions, but Electron desktop bridge is unavailable.';
                  postActionReceipt(noBridgeMessage, [], [], [noBridgeMessage]);
                  return;
                }

                const rootPath = runContext.rootFolder.trim();
                if (!rootPath) {
                  const noFolderMessage = 'AI requested local file actions, but this run has no project root folder context.';
                  postActionReceipt(noFolderMessage, [], [], [noFolderMessage]);
                  return;
                }

                setCoworkRunStatus('Applying AI file actions...');
                setCoworkProgressStage('executing_workstreams', {
                  details: 'Applying local actions in scoped workspace.',
                });

                const boundedActions = relayActions.slice(0, MAX_LOCAL_ACTIONS_PER_RUN);
                const safetyScopes = loadSafetyScopes(runContext.projectId || undefined);
                const actionReceipts: LocalActionReceipt[] = [];
                const previews: string[] = [];
                const errors: string[] = [];

                if (relayActions.length > MAX_LOCAL_ACTIONS_PER_RUN) {
                  errors.push(
                    `Action limit exceeded: received ${relayActions.length}, executed ${MAX_LOCAL_ACTIONS_PER_RUN}.`,
                  );
                }

                const formatPreviewContent = (value: string) => {
                  const trimmed = value.trim();
                  if (!trimmed) {
                    return '(empty)';
                  }
                  const maxChars = 1200;
                  if (trimmed.length <= maxChars) {
                    return trimmed;
                  }
                  return `${trimmed.slice(0, maxChars)}\n... (truncated)`;
                };

                const mapLocalActionErrorCode = (message: string): string => {
                  const normalized = message.toLowerCase();
                  if (normalized.includes('already exists')) {
                    return 'FILE_EXISTS';
                  }
                  if (normalized.includes('not found') || normalized.includes('enoent')) {
                    return 'NOT_FOUND';
                  }
                  if (normalized.includes('blocked') || normalized.includes('outside') || normalized.includes('traversal')) {
                    return 'PROJECT_BOUNDARY_BLOCK';
                  }
                  if (normalized.includes('permission') || normalized.includes('eacces') || normalized.includes('eperm')) {
                    return 'PERMISSION_DENIED';
                  }
                  if (normalized.includes('timeout')) {
                    return 'TIMEOUT';
                  }
                  return 'ACTION_FAILED';
                };

                const summarizeActionPreview = (action: (typeof boundedActions)[number]) => {
                  if (action.type === 'create_file') {
                    return `Create ${action.path}${action.overwrite ? ' (overwrite)' : ''}`;
                  }
                  if (action.type === 'append_file') {
                    return `Append ${action.path}`;
                  }
                  if (action.type === 'read_file') {
                    return `Read ${action.path}`;
                  }
                  if (action.type === 'list_dir') {
                    return `List directory ${action.path || '.'}`;
                  }
                  if (action.type === 'rename') {
                    return `Rename ${action.path} -> ${action.newPath}`;
                  }
                  if (action.type === 'delete') {
                    return `Delete ${action.path}`;
                  }
                  return `Check exists ${action.path}`;
                };

                const isLowRiskTextWriteAction = (action: (typeof boundedActions)[number]) => {
                  if (action.type !== 'create_file' && action.type !== 'append_file') {
                    return false;
                  }

                  if (action.type === 'create_file' && action.overwrite) {
                    return false;
                  }

                  const normalizedPath = action.path.replace(/\\/g, '/').trim();
                  if (!normalizedPath || normalizedPath.includes('/')) {
                    return false;
                  }

                  const lowered = normalizedPath.toLowerCase();
                  const isTextFile = lowered.endsWith('.md') || lowered.endsWith('.txt');
                  if (!isTextFile) {
                    return false;
                  }

                  // Keep auto-approval conservative: only small single-file drafts.
                  return action.content.length <= 20_000;
                };

                for (let index = 0; index < boundedActions.length; index += 1) {
                  const action = boundedActions[index];
                  const actionId = action.id || `action-${index + 1}`;
                  const actionPath = action.path ?? '.';
                  const policy = resolveLocalActionPolicy(action.type, safetyScopes);
                  let createFileOverwriteApproved = false;
                  let approvedByOperator = false;

                  const pathValidation = validateProjectRelativePath(actionPath, {
                    allowEmpty: action.type === 'list_dir',
                  });
                  if (!pathValidation.ok) {
                    const message = `Blocked by project boundary: ${pathValidation.reason}`;
                    errors.push(`${actionPath || '.'}: ${message}`);
                    actionReceipts.push({
                      id: actionId,
                      type: action.type,
                      path: actionPath || '.',
                      status: 'error',
                      errorCode: 'PROJECT_BOUNDARY_BLOCK',
                      message,
                    });
                    continue;
                  }

                  if (action.type === 'rename') {
                    const targetValidation = validateProjectRelativePath(action.newPath);
                    if (!targetValidation.ok) {
                      const message = `Blocked by project boundary: ${targetValidation.reason}`;
                      errors.push(`${action.newPath}: ${message}`);
                      actionReceipts.push({
                        id: actionId,
                        type: action.type,
                        path: action.newPath,
                        status: 'error',
                        errorCode: 'PROJECT_BOUNDARY_BLOCK',
                        message,
                      });
                      continue;
                    }
                  }

                  if ((action.type === 'create_file' || action.type === 'append_file' || action.type === 'rename' || action.type === 'delete') && !runContext.projectId) {
                    const message = 'Blocked: write actions require an active project context.';
                    errors.push(`${actionPath}: ${message}`);
                    actionReceipts.push({
                      id: actionId,
                      type: action.type,
                      path: actionPath,
                      status: 'error',
                      errorCode: 'PROJECT_REQUIRED',
                      message,
                    });
                    continue;
                  }

                  if (!policy.enabled) {
                    const message = `Blocked by safety policy: ${policy.scopeName} is disabled.`;
                    errors.push(`${actionPath}: ${message}`);
                    actionReceipts.push({
                      id: actionId,
                      type: action.type,
                      path: actionPath,
                      status: 'error',
                      errorCode: 'BLOCKED_BY_POLICY',
                      message,
                    });
                    continue;
                  }

                  if (
                    action.type === 'create_file' &&
                    !action.overwrite &&
                    bridge.existsInFolder
                  ) {
                    try {
                      const existing = await bridge.existsInFolder(rootPath, action.path);
                      if (existing.exists) {
                        const overwriteApprovalId = `${runId}-${actionId}-${index + 1}-overwrite`;
                        setCoworkRunStatus(`Awaiting overwrite approval for ${actionPath}...`);
                        setCoworkProgressStage('executing_workstreams', {
                          details: `File exists at ${actionPath}. Awaiting overwrite approval.`,
                        });

                        const overwriteDecision = await requestActionApproval({
                          id: overwriteApprovalId,
                          runId,
                          actionId,
                          actionType: action.type,
                          projectId: runContext.projectId || undefined,
                          projectTitle: runContext.projectTitle || undefined,
                          projectRootFolder: runContext.rootFolder || undefined,
                          path: actionPath,
                          scopeId: policy.scopeId,
                          scopeName: policy.scopeName,
                          riskLevel: 'high',
                          summary: `${runContext.projectTitle ? `[${runContext.projectTitle}] ` : ''}Overwrite existing file ${actionPath}`,
                          preview: [
                            'The file already exists.',
                            'Approve to overwrite it with the new generated content.',
                            '',
                            formatPreviewContent(action.content),
                          ].join('\n'),
                          createdAt: Date.now(),
                        });

                        if (!overwriteDecision.approved) {
                          const reason = overwriteDecision.reason || 'Overwrite rejected by operator.';
                          const code = overwriteDecision.expired ? 'APPROVAL_TIMEOUT' : 'REJECTED_BY_OPERATOR';
                          errors.push(`${actionPath}: ${reason}`);
                          actionReceipts.push({
                            id: actionId,
                            type: action.type,
                            path: actionPath,
                            status: 'error',
                            errorCode: code,
                            message: reason,
                          });
                          continue;
                        }

                        approvedByOperator = true;
                        createFileOverwriteApproved = true;
                        previews.push(`Approved overwrite create_file -> ${actionPath}`);
                        if (taskEntry) {
                          setCoworkTaskStatus(taskEntry.taskId, 'approved', {
                            runId,
                            summary: `Approved overwrite: ${action.type} ${actionPath}`,
                          });
                        }
                      }
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Unable to verify file existence.';
                      errors.push(`${actionPath}: ${message}`);
                      actionReceipts.push({
                        id: actionId,
                        type: action.type,
                        path: actionPath,
                        status: 'error',
                        errorCode: 'ACTION_FAILED',
                        message,
                      });
                      continue;
                    }
                  }

                  const autoApproved = policy.requiresApproval && isLowRiskTextWriteAction(action);

                  const requiresHardApproval = isDestructiveLocalAction(action.type) || policy.riskLevel === 'critical';

                  if ((policy.requiresApproval || requiresHardApproval) && !autoApproved && !approvedByOperator) {
                    const approvalId = `${runId}-${actionId}-${index + 1}`;
                    const previewBody =
                      action.type === 'create_file' || action.type === 'append_file'
                        ? formatPreviewContent(action.content)
                        : summarizeActionPreview(action);

                    setCoworkRunStatus(`Awaiting approval for ${action.type} (${actionPath})...`);
                    setCoworkProgressStage('executing_workstreams', {
                      details: `Awaiting operator approval for ${action.type} on ${actionPath}.`,
                    });
                    if (taskEntry) {
                      setCoworkTaskStatus(taskEntry.taskId, 'needs_approval', {
                        runId,
                        summary: `Needs approval: ${action.type} ${actionPath}`,
                      });
                    }
                    const decision = await requestActionApproval({
                      id: approvalId,
                      runId,
                      actionId,
                      actionType: action.type,
                      projectId: runContext.projectId || undefined,
                      projectTitle: runContext.projectTitle || undefined,
                      projectRootFolder: runContext.rootFolder || undefined,
                      path: actionPath,
                      scopeId: policy.scopeId,
                      scopeName: policy.scopeName,
                      riskLevel: policy.riskLevel,
                      summary: `${runContext.projectTitle ? `[${runContext.projectTitle}] ` : ''}${summarizeActionPreview(action)}`,
                      preview: previewBody,
                      createdAt: Date.now(),
                    });

                    if (!decision.approved) {
                      const reason = decision.reason || 'Rejected by operator.';
                      const code = decision.expired ? 'APPROVAL_TIMEOUT' : 'REJECTED_BY_OPERATOR';
                      errors.push(`${actionPath}: ${reason}`);
                      if (taskEntry) {
                        setCoworkTaskStatus(taskEntry.taskId, 'rejected', {
                          runId,
                          summary: `Rejected: ${action.type} ${actionPath}`,
                          outcome: reason,
                        });
                      }
                      actionReceipts.push({
                        id: actionId,
                        type: action.type,
                        path: actionPath,
                        status: 'error',
                        errorCode: code,
                        message: reason,
                      });
                      continue;
                    }

                    previews.push(`Approved ${action.type} -> ${actionPath}`);
                    if (taskEntry) {
                      setCoworkTaskStatus(taskEntry.taskId, 'approved', {
                        runId,
                        summary: `Approved: ${action.type} ${actionPath}`,
                      });
                    }
                  } else if (autoApproved) {
                    previews.push(`Auto-approved ${action.type} -> ${actionPath}`);
                    if (taskEntry) {
                      setCoworkTaskStatus(taskEntry.taskId, 'approved', {
                        runId,
                        summary: `Auto-approved: ${action.type} ${actionPath}`,
                      });
                    }
                  }

                  try {
                    if (action.type === 'create_file') {
                      if (!bridge.createFileInFolder) {
                        const message = `${actionPath}: create_file is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'create_file',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.createFileInFolder(
                        rootPath,
                        action.path,
                        action.content,
                        createFileOverwriteApproved ? true : action.overwrite,
                      );
                      actionReceipts.push({
                        id: actionId,
                        type: 'create_file',
                        path: result.filePath,
                        status: 'ok',
                      });
                      previews.push(`+ ${result.filePath}`);
                      continue;
                    }

                    if (action.type === 'append_file') {
                      if (!bridge.appendFileInFolder) {
                        const message = `${actionPath}: append_file is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'append_file',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.appendFileInFolder(rootPath, action.path, action.content);
                      actionReceipts.push({
                        id: actionId,
                        type: 'append_file',
                        path: result.filePath,
                        status: 'ok',
                        message: `Appended ${result.bytesAppended} bytes`,
                      });
                      previews.push(`+ appended ${result.bytesAppended} bytes -> ${result.filePath}`);
                      continue;
                    }

                    if (action.type === 'read_file') {
                      if (!bridge.readFileInFolder) {
                        const message = `${actionPath}: read_file is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'read_file',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.readFileInFolder(rootPath, action.path);
                      actionReceipts.push({
                        id: actionId,
                        type: 'read_file',
                        path: result.filePath,
                        status: 'ok',
                      });
                      previews.push(`> ${result.filePath}`);
                      previews.push('```');
                      previews.push(formatPreviewContent(result.content));
                      previews.push('```');
                      continue;
                    }

                    if (action.type === 'list_dir') {
                      if (!bridge.listDirInFolder) {
                        const message = `${actionPath}: list_dir is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'list_dir',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.listDirInFolder(rootPath, action.path || '');
                      actionReceipts.push({
                        id: actionId,
                        type: 'list_dir',
                        path: action.path || '.',
                        status: 'ok',
                        message: `Listed ${result.items.length} items${result.truncated ? ' (truncated)' : ''}`,
                      });
                      previews.push(`# list_dir ${action.path || '.'}`);
                      previews.push(...result.items.slice(0, 20).map((item) => `${item.kind === 'directory' ? '[dir]' : '[file]'} ${item.path}`));
                      if (result.truncated) {
                        previews.push('... (truncated)');
                      }
                      continue;
                    }

                    if (action.type === 'exists') {
                      if (!bridge.existsInFolder) {
                        const message = `${actionPath}: exists is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'exists',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.existsInFolder(rootPath, action.path);
                      actionReceipts.push({
                        id: actionId,
                        type: 'exists',
                        path: result.path,
                        status: 'ok',
                        message: result.exists ? result.kind : 'none',
                      });
                      previews.push(`? ${result.path} => ${result.exists ? result.kind : 'none'}`);
                    }

                    if (action.type === 'rename') {
                      if (!bridge.renameInFolder) {
                        const message = `${actionPath}: rename is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'rename',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.renameInFolder(rootPath, action.path, action.newPath);
                      actionReceipts.push({
                        id: actionId,
                        type: 'rename',
                        path: result.newPath,
                        status: 'ok',
                        message: `Renamed ${result.oldPath} -> ${result.newPath}`,
                      });
                      previews.push(`~ ${result.oldPath} -> ${result.newPath}`);
                      continue;
                    }

                    if (action.type === 'delete') {
                      if (!bridge.deleteInFolder) {
                        const message = `${actionPath}: delete is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'delete',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.deleteInFolder(rootPath, action.path);
                      actionReceipts.push({
                        id: actionId,
                        type: 'delete',
                        path: result.path,
                        status: 'ok',
                        message: 'Deleted',
                      });
                      previews.push(`- deleted ${result.path}`);
                      continue;
                    }

                    if (action.type === 'shell_exec') {
                      if (!bridge.shellExec) {
                        const message = `${actionPath}: shell_exec is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'shell_exec',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const timeoutMs = typeof action.timeoutMs === 'number' ? action.timeoutMs : 30_000;
                      const result = await bridge.shellExec(rootPath, action.command, timeoutMs);
                      const ok = result.exitCode === 0;
                      actionReceipts.push({
                        id: actionId,
                        type: 'shell_exec',
                        path: actionPath,
                        status: ok ? 'ok' : 'error',
                        message: result.timedOut ? 'Command timed out' : (ok ? `Exit 0` : `Exit ${result.exitCode}`),
                      });
                      previews.push(`$ ${action.command}`);
                      if (result.stdout) {
                        previews.push('```');
                        previews.push(result.stdout.slice(0, 2000));
                        previews.push('```');
                      }
                      if (result.stderr) {
                        previews.push('stderr:');
                        previews.push('```');
                        previews.push(result.stderr.slice(0, 1000));
                        previews.push('```');
                      }
                      continue;
                    }

                    if (action.type === 'web_fetch') {
                      if (!bridge.webFetch) {
                        const message = `${actionPath}: web_fetch is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'web_fetch',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const method = typeof action.method === 'string' ? action.method : 'GET';
                      const headers: Record<string, string> = {};
                      if (typeof action.contentType === 'string') headers['Content-Type'] = action.contentType;
                      const result = await bridge.webFetch(action.url, { method, headers, body: action.body });
                      const ok = result.status >= 200 && result.status < 400;
                      actionReceipts.push({
                        id: actionId,
                        type: 'web_fetch',
                        path: action.url,
                        status: ok ? 'ok' : 'error',
                        message: `${result.status} ${result.statusText}${result.truncated ? ' (truncated)' : ''}`,
                      });
                      previews.push(`> fetch ${method} ${action.url} => ${result.status}`);
                      if (result.body) {
                        previews.push('```');
                        previews.push(result.body.slice(0, 2000));
                        previews.push('```');
                      }
                      continue;
                    }
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown local file action error.';
                    const fullMessage = `${actionPath}: ${message}`;
                    errors.push(fullMessage);
                    actionReceipts.push({
                      id: actionId,
                      type: action.type,
                      path: actionPath,
                      status: 'error',
                      errorCode: mapLocalActionErrorCode(message),
                      message,
                    });
                  }
                }

                const summaryParts: string[] = [];
                const okCount = actionReceipts.filter((item) => item.status === 'ok').length;
                const errorCount = actionReceipts.filter((item) => item.status === 'error').length;
                if (okCount > 0) {
                  summaryParts.push(`Executed ${okCount} local action${okCount === 1 ? '' : 's'}.`);
                }
                if (errorCount > 0) {
                  summaryParts.push(`Failed ${errorCount} action${errorCount === 1 ? '' : 's'}.`);
                }
                if (runContext.projectTitle) {
                  summaryParts.push(`Project: ${runContext.projectTitle}.`);
                }
                summaryParts.push(`Folder: ${rootPath}`);

                const summary = summaryParts.join(' ') || 'No file actions were applied.';
                postActionReceipt(summary, actionReceipts, previews, errors);

                // Fire desktop notification when cowork task completes
                if (bridge?.notify) {
                  const title = errorCount > 0 ? 'Relay — Task completed with errors' : 'Relay — Task completed';
                  const body = runContext.projectTitle
                    ? `${runContext.projectTitle}: ${okCount} action${okCount === 1 ? '' : 's'} executed`
                    : `${okCount} action${okCount === 1 ? '' : 's'} executed`;
                  bridge.notify(title, body).catch(() => { /* notification failure is non-critical */ });
                }
              })();
            } else if (relayActions.length === 0) {
              setCoworkProgressStage('deliverables', {
                completeThrough: true,
                details: 'Delivered conversational result without local file actions.',
              });
              if (taskEntry) {
                setCoworkTaskStatus(taskEntry.taskId, 'completed', {
                  runId,
                  summary: 'No relay actions requested; assistant response completed.',
                  outcome: visibleText,
                });
                finalizeCoworkTaskRun(eventSessionKey || coworkSessionKeyRef.current, taskEntry.taskId);

                if (bridge?.notify) {
                  bridge.notify('Relay — Task completed', runContext.projectTitle || 'Cowork run finished.').catch(() => {});
                }
              }

              const noActionMessage: ChatMessage = {
                id: `cowork-actions-missing-${runId}`,
                role: 'system',
                text: [
                  'No executable relay_actions were found in the cowork final event.',
                  runContext.projectTitle ? `Project: ${runContext.projectTitle}` : 'Project: (none)',
                  `Folder: ${runContext.rootFolder || '(not set)'}`,
                ].join('\n'),
                meta: {
                  kind: 'activity',
                  items: [
                    {
                      id: `activity-no-actions-${runId}`,
                      label: 'No executable relay_actions were found.',
                      details: [
                        runContext.projectTitle ? `Project: ${runContext.projectTitle}` : 'Project: (none)',
                        `Folder: ${runContext.rootFolder || '(not set)'}`,
                      ].join('\n'),
                      tone: 'neutral',
                    },
                  ],
                },
              };

              setCoworkMessages((current) => {
                if (current.some((entry) => entry.id === noActionMessage.id)) {
                  return current;
                }

                const next = [...current, noActionMessage];
                if (eventSessionKey) {
                  coworkMessageCache.current.set(eventSessionKey, next);
                }
                return next;
              });
            }
            return;
          }
        }

        if (eventSessionKey && eventSessionKey !== activeSessionKeyRef.current) {
          const previousActive = normalizeSessionKey(activeSessionKeyRef.current);
          if (previousActive) {
            rekeyChatThread(previousActive, eventSessionKey);
            const cachedMessages = threadMessageCache.current.get(previousActive);
            if (cachedMessages) {
              threadMessageCache.current.set(eventSessionKey, cachedMessages);
              threadMessageCache.current.delete(previousActive);
            }
          }
          commitActiveSessionKey(eventSessionKey);
        }

        if (state === 'error') {
          setAwaitingChatStream(false);
          const errorMessage =
            typeof payload.errorMessage === 'string' && payload.errorMessage.trim()
              ? payload.errorMessage
              : 'Chat stream failed.';
          setStatus(errorMessage);
          return;
        }

        if (state === 'delta' && text) {
          setAwaitingChatStream(false);
          const streamId = `stream-${runId}`;
          setChatMessages((current) => {
            const index = current.findIndex((entry) => entry.id === streamId);
            if (index >= 0) {
              const next = [...current];
              next[index] = { ...next[index], text, role };
              return next;
            }
            return [...current, { id: streamId, role, text }];
          });
          return;
        }

        if ((state === 'final' || state === 'aborted') && text) {
          setAwaitingChatStream(false);
          const streamId = `stream-${runId}`;
          const finalId = `final-${runId}`;
          const activeModel = typeof payload.model === 'string' ? payload.model : undefined;
          const usage = parseUsageFromPayload(payload, activeModel);
          if (usage) {
            accumulateTodayUsage(usage);
            setSessionUsage((prev) => addUsage(prev, usage));
          }
          setChatMessages((current) => {
            const withoutStream = current.filter((entry) => entry.id !== streamId);
            if (withoutStream.some((entry) => entry.id === finalId)) {
              return withoutStream;
            }
            const finalMsg = { id: finalId, role, text, ...(usage ? { usage } : {}) };
            const next = [...withoutStream, finalMsg];
            const cacheKey = activeSessionKeyRef.current;
            if (cacheKey) {
              threadMessageCache.current.set(cacheKey, next);
            }
            return next;
          });

          if (eventSessionKey) {
            upsertChatThread(eventSessionKey, {
              touchedAt: Date.now(),
            });
          }
        }
      }
    });

    gatewayClientRef.current = client;
    return () => {
      clearCoworkStreamWatchdog();
      for (const entry of approvalResolversRef.current.values()) {
        clearTimeout(entry.timeoutId);
      }
      approvalResolversRef.current.clear();
      gatewayClientRef.current?.disconnect();
      gatewayClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!configReady) {
      return;
    }

    const client = gatewayClientRef.current;
    if (!client) {
      return;
    }

    const gatewayUrl = config.gatewayUrl?.trim() || DEFAULT_GATEWAY_URL;
    const gatewayToken = config.gatewayToken ?? '';

    void client
      .connect({
        gatewayUrl,
        token: gatewayToken,
      })
      .then(async () => {
        setHealth({ ok: true, message: `Connected to ${gatewayUrl}` });
        markGatewayConnectionLastUsed({ gatewayUrl, gatewayToken });
        if (!onboardingComplete) {
          completeOnboarding();
        }
        await loadRecentChatsFromBackend(client);
      })
      .catch((error: unknown) => {
        const info = readGatewayError(error);
        const isPairing =
          info.code === 'PAIRING_REQUIRED' ||
          /pairing.required/i.test(info.message);
        if (isPairing) {
          setPairingRequestId(info.requestId ?? null);
          const approvalHint = info.requestId
            ? ` Approve with: openclaw devices approve ${info.requestId}`
            : ' Approve the pending request on the gateway host.';
          setHealth({ ok: false, message: `Pairing required.${approvalHint}` });
          setStatus(`Pairing required.${approvalHint}`);
        } else {
          const offlineMessage = info.message || 'Gateway is offline or unreachable.';
          void appendGatewayDiscoveryHint(offlineMessage).then((nextMessage) => {
            setHealth({ ok: false, message: nextMessage });
            setStatus(nextMessage);
          });
        }
      });
  }, [appendGatewayDiscoveryHint, config.gatewayToken, config.gatewayUrl, onboardingComplete, configReady, markGatewayConnectionLastUsed]);

  useEffect(() => {
    if (activePage !== 'chat') {
      return;
    }

    const normalized = normalizeSessionKey(activeSessionKey);
    if (!normalized) {
      return;
    }

    if (skipNextChatEffectLoadRef.current) {
      skipNextChatEffectLoadRef.current = false;
      return;
    }

    void loadChatSession(normalized, undefined);
  }, [activePage, activeSessionKey]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();

    const nextConfig: AppConfig = {
      gatewayUrl: draftGatewayUrl.trim() || DEFAULT_GATEWAY_URL,
      gatewayToken: draftGatewayToken,
    };

    setSaving(true);
    setStatus('Saving and connecting...');
    setPairingRequestId(null);

    // Persist config
    if (bridge) {
      try {
        const savedConfig = await bridge.saveConfig(nextConfig);
        setConfig(savedConfig);
        setDraftGatewayUrl(savedConfig.gatewayUrl);
        setDraftGatewayToken(savedConfig.gatewayToken);
        persistLocalConfig(savedConfig);
      } catch {
        setStatus('Failed to save configuration.');
        setSaving(false);
        return;
      }
    } else {
      setConfig(nextConfig);
      persistLocalConfig(nextConfig);
    }

    // Connect
    try {
      const client = gatewayClientRef.current;
      if (!client) {
        throw new Error('Gateway client not initialized.');
      }

      await client.connect({
        gatewayUrl: nextConfig.gatewayUrl,
        token: nextConfig.gatewayToken,
      });

      await loadRecentChatsFromBackend(client);

      const sessionKey = normalizeSessionKey(activeSessionKeyRef.current);
      if (sessionKey) {
        void loadModelsForSession(client, sessionKey);
      } else {
        setChatModels([]);
        setSelectedModel('');
      }

      setHealth({ ok: true, message: `Connected to ${nextConfig.gatewayUrl}` });
      setStatus('Configuration saved. Connected to Gateway.');
      markGatewayConnectionLastUsed(nextConfig);
    } catch (error) {
      console.error('[Relay] connect error:', error);
      const info = readGatewayError(error);
      const isPairing =
        info.code === 'PAIRING_REQUIRED' ||
        /pairing.required/i.test(info.message);
      if (isPairing) {
        setPairingRequestId(info.requestId ?? null);
        const approvalHint = info.requestId
          ? ` Approve with: openclaw devices approve ${info.requestId}`
          : ' Approve the pending request on the gateway host.';
        setHealth({ ok: false, message: `Pairing required.${approvalHint}` });
        setStatus(`Configuration saved. Pairing required.${approvalHint}`);
      } else {
        const failureMessage = info.message || 'Gateway connection failed.';
        const hinted = await appendGatewayDiscoveryHint(failureMessage);
        setHealth({ ok: false, message: hinted });
        setStatus(`Configuration saved. ${hinted}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetPairing = async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setChecking(true);
    setPairingRequestId(null);
    setStatus('Resetting local device identity and requesting fresh pairing...');

    try {
      client.disconnect();
      const clientWithReset = client as OpenClawGatewayClient & {
        resetDeviceIdentity?: () => void;
      };
      if (typeof clientWithReset.resetDeviceIdentity === 'function') {
        clientWithReset.resetDeviceIdentity();
      } else {
        // Fallback for stale runtime instances that predate resetDeviceIdentity().
        localStorage.removeItem('openclaw-device-identity-v1');
      }
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      const sessionKey = normalizeSessionKey(activeSessionKeyRef.current);
      if (sessionKey) {
        commitActiveSessionKey(sessionKey);
      }
      setHealth({ ok: true, message: `Re-paired and connected to ${draftGatewayUrl}` });
      setStatus('Re-pair complete. If operator.admin is still missing, approve the new request with admin scope on the gateway host.');
    } catch (error) {
      console.error('[Relay] reset pairing error:', error);
      const info = readGatewayError(error);
      const isPairing =
        info.code === 'PAIRING_REQUIRED' ||
        /pairing.required/i.test(info.message);
      if (isPairing) {
        setPairingRequestId(info.requestId ?? null);
        const approvalHint = info.requestId
          ? `openclaw devices approve ${info.requestId}`
          : 'openclaw devices list then openclaw devices approve <requestId>';
        setHealth({ ok: false, message: 'New pairing request created. Approve it with admin scope.' });
        setStatus(`New pairing request created. Approve with admin scope: ${approvalHint}`);
      } else {
        setHealth({ ok: false, message: info.message || 'Failed to reset pairing.' });
        setStatus(info.message || 'Failed to reset pairing.');
      }
    } finally {
      setChecking(false);
    }
  };

  const handlePlanTask = async (event: FormEvent) => {
    event.preventDefault();
    clearCoworkStreamWatchdog();
    if (!gatewayConnected) {
      setStatus('Gateway disconnected. Connect in Settings > Gateway to run cowork tasks.');
      setCoworkAwaitingStream(false);
      setCoworkSending(false);
      setCoworkRunPhase('error');
      setCoworkRunStatus('Gateway disconnected.');
      return;
    }
    workingFolderRef.current = workingFolder.trim();
    setCoworkSending(true);
    setCoworkAwaitingStream(false);
    setCoworkStreamingText('');
    setCoworkRunPhase('sending');
    setCoworkRunStatus('Sending cowork task...');
    resetCoworkProgress('Interpreting goal and building a task plan.');

    const text = coworkDraftPrompt.trim();
    if (!text) {
      setStatus('Describe the outcome first so OpenClaw can plan the work.');
      setCoworkSending(false);
      return;
    }

    // Clear the composer immediately so submit feedback matches user expectation.
    handleCoworkPromptChange('');

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      setCoworkSending(false);
      return;
    }

    try {
      const withTimeout = async <T,>(promise: Promise<T>, label: string, timeoutMs = COWORK_PREP_TIMEOUT_MS): Promise<T> => {
        const timeoutPromise = new Promise<T>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
          }, timeoutMs);
          promise.finally(() => clearTimeout(timer)).catch(() => {
            // Swallow here because caller handles the final rejection.
          });
        });
        return Promise.race([promise, timeoutPromise]);
      };

      await withTimeout(ensureConnectedClient(client), 'Gateway connect');

      let sessionKey = normalizeSessionKey(coworkSessionKeyRef.current);
      if (!sessionKey) {
        sessionKey = normalizeSessionKey(await withTimeout(client.createCoworkSession(), 'Cowork session creation'));
        if (!sessionKey) {
          throw new Error('No cowork session key returned from Gateway.');
        }
        commitCoworkSessionKey(sessionKey);
      }

      const now = Date.now();
      const queuedTaskId = `task-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const projectId = activeCoworkProject?.id ?? 'unscoped';
      const projectTitle = activeCoworkProject?.name ?? 'Unscoped';

      setCoworkTasks((current) => {
        const next: CoworkProjectTask = {
          id: queuedTaskId,
          projectId,
          projectTitle,
          sessionKey,
          prompt: text,
          status: 'queued',
          summary: 'Task queued for execution.',
          createdAt: now,
          updatedAt: now,
        };
        return [next, ...current].slice(0, 250);
      });
      queueCoworkTask(sessionKey, {
        taskId: queuedTaskId,
        status: 'queued',
      });

      setTaskState('planned');
      setCoworkAwaitingStream(true);
      const outboundMessageId = `cowork-user-${Date.now()}`;
      setCoworkMessages((current) => {
        const next = [...current, { id: outboundMessageId, role: 'user' as const, text }];
        coworkMessageCache.current.set(sessionKey, next);
        return next;
      });
      upsertCoworkThread(sessionKey, {
        title: text,
        touchedAt: Date.now(),
      });

      if (coworkModel.trim()) {
        await withTimeout(client.setSessionModel(sessionKey, coworkModel.trim()), 'Session model update');
      }

      const folderContext = workingFolderRef.current;
      const selectedKindByPath = new Map(
        coworkProjectPathReferences.map((entry) => [entry.path, entry.kind] as const),
      );
      const referencedProjectPaths = Array.from(new Set(extractProjectFileMentions(text))).slice(0, 8);
      let referencedProjectFilesContext = '';
      if (referencedProjectPaths.length > 0 && folderContext) {
        const snippets: string[] = [];
        const MAX_FILE_CHARS = 8_000;
        const MAX_FOLDER_LIST_ITEMS = 40;

        for (const rawPath of referencedProjectPaths) {
          const mentionsDirectory = /\/+$/.test(rawPath) || selectedKindByPath.get(rawPath) === 'directory';
          const relPath = rawPath.replace(/\/+$/, '').trim();
          if (!relPath) {
            continue;
          }

          const validated = validateProjectRelativePath(relPath);
          if (!validated.ok) {
            snippets.push(`- ${relPath}: skipped (${validated.reason})`);
            continue;
          }

          if (mentionsDirectory && bridge?.listDirInFolder) {
            try {
              const listing = await bridge.listDirInFolder(folderContext, relPath);
              const listed = listing.items
                .slice(0, MAX_FOLDER_LIST_ITEMS)
                .map((item) => `- ${item.kind === 'directory' ? '[dir]' : '[file]'} ${item.path}`)
                .join('\n');
              const truncated = listing.items.length > MAX_FOLDER_LIST_ITEMS ? '\n- ...truncated...' : '';
              snippets.push(`### ${relPath}/\n${listed || '- (empty)'}${truncated}`);
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to list folder';
              snippets.push(`- ${relPath}/: list failed (${message})`);
            }
            continue;
          }

          if (!bridge?.readFileInFolder) {
            snippets.push(`- ${relPath}: read unavailable in this mode`);
            continue;
          }

          try {
            const fileResult = await bridge.readFileInFolder(folderContext, relPath);
            const fullContent = fileResult.content ?? '';
            const snippet = fullContent.slice(0, MAX_FILE_CHARS);
            const truncated = fullContent.length > MAX_FILE_CHARS ? '\n[...truncated...]' : '';
            snippets.push(`### ${relPath}\n\`\`\`\n${snippet}${truncated}\n\`\`\``);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read file';
            snippets.push(`- ${relPath}: read failed (${message})`);
          }
        }

        if (snippets.length > 0) {
          referencedProjectFilesContext = `Referenced project files:\n${snippets.join('\n\n')}`;
        }
      }

      setCoworkTaskStatus(queuedTaskId, 'running', {
        summary: 'Sending task to cowork.',
      });

      enqueueCoworkRunContext(sessionKey, {
        projectId: activeCoworkProject?.id ?? '',
        projectTitle: activeCoworkProject?.name ?? '',
        rootFolder: folderContext,
        startedAt: Date.now(),
      });
      const relayFileInstruction = [
        'If the user request involves local files/folders in any way, your response MUST be ONE JSON code block with relay_actions and no prose.',
        '```json',
        '{"relay_actions":[{"id":"a1","type":"list_dir","path":"."},{"id":"a2","type":"create_file","path":"relative/path.ext","content":"file contents","overwrite":false},{"id":"a3","type":"append_file","path":"relative/path.ext","content":"more text"},{"id":"a4","type":"read_file","path":"relative/path.ext"},{"id":"a5","type":"exists","path":"relative/path.ext"},{"id":"a6","type":"rename","path":"old.ext","newPath":"new.ext"},{"id":"a7","type":"delete","path":"obsolete.ext"}]}',
        '```',
        'If filenames are unknown, first emit a list_dir action and do not ask follow-up questions.',
        'Never respond with natural language explanations for file-operation requests.',
      ].join('\n');
      const projectKnowledgeContext = activeCoworkProject
        ? projectKnowledgeItems
            .filter((item) => item.projectId === activeCoworkProject.id)
            .slice(0, 8)
            .map((item) => `- ${item.title}: ${item.content}`)
            .join('\n')
        : '';
      const webSearchInstruction = coworkWebSearchEnabled
        ? [
            'Web search mode is enabled.',
            'For requests requiring up-to-date or external information, use web tools and provide citations.',
            'Always include a Sources section with markdown links for any factual claims from external sources.',
          ].join('\n')
        : '';
      const coworkMemoryContext = preferences.injectMemory
        ? buildMemoryContext(loadMemoryEntries(), preferences.systemPrompt)
        : preferences.systemPrompt.trim();
      const outboundMessage = [
        coworkMemoryContext,
        activeCoworkProject ? `Project context: ${activeCoworkProject.name}` : '',
        projectKnowledgeContext ? `Project knowledge:\n${projectKnowledgeContext}` : '',
        folderContext ? `Working folder context: ${folderContext}` : '',
        referencedProjectFilesContext,
        webSearchInstruction,
        relayFileInstruction,
        '',
        text,
      ]
        .filter((part) => part.length > 0)
        .join('\n\n');

      setCoworkRunPhase('streaming');
      setCoworkRunStatus('Waiting for cowork stream...');
      setCoworkProgressStage('decomposition', {
        details: 'Splitting work into substeps and selecting tools.',
      });
      setStatus('Cowork message sent. Waiting for stream...');
      await withTimeout(client.sendChat(sessionKey, outboundMessage), 'Cowork request send');
      coworkStreamWatchdogRef.current = setTimeout(() => {
        setCoworkAwaitingStream(false);
        setCoworkRunPhase('error');
        const watchdogMessage = 'Gateway accepted the task but no cowork stream was received. Reconnect gateway and retry.';
        setCoworkRunStatus(watchdogMessage);
        setCoworkProgressStage('planning', {
          blocked: true,
          details: watchdogMessage,
        });
        setStatus(watchdogMessage);
        setCoworkTasks((current) =>
          current.map((task) =>
            task.id === queuedTaskId
              ? {
                  ...task,
                  status: 'failed',
                  summary: watchdogMessage,
                  outcome: watchdogMessage,
                  updatedAt: Date.now(),
                }
              : task,
          ),
        );
      }, COWORK_STREAM_WATCHDOG_MS);
      await new Promise((resolve) => setTimeout(resolve, COWORK_SEND_SPINNER_MS));
    } catch (error) {
      clearCoworkStreamWatchdog();
      setCoworkAwaitingStream(false);
      setCoworkRunPhase('error');
      const message = error instanceof Error ? error.message : 'Failed to send cowork task.';
      setCoworkRunStatus(message);
      setCoworkProgressStage('planning', {
        blocked: true,
        details: message,
      });
      setStatus(message);
      // Restore the prompt for quick retry when send/setup fails,
      // but do not overwrite a newer prompt the user already started typing.
      setCoworkDraftPrompt((current) => (current.trim() ? current : text));
    } finally {
      setCoworkSending(false);
    }
  };

  const handleCreateLocalPlan = async () => {
    if (!bridge?.planOrganizeFolder) {
      setStatus('Local file organizer is available in the Electron desktop app only.');
      return;
    }

    const rootPath = workingFolder.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    setLocalPlanLoading(true);
    try {
      const plan = await bridge.planOrganizeFolder(rootPath);
      setLocalPlanActions(plan.actions);
      setLocalPlanRootPath(plan.rootPath);
      setStatus(`Plan ready: ${plan.actions.length} file action${plan.actions.length === 1 ? '' : 's'} in ${plan.rootPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create local file plan.';
      setStatus(message);
      setLocalPlanActions([]);
      setLocalPlanRootPath('');
    } finally {
      setLocalPlanLoading(false);
    }
  };

  const handlePickWorkingFolder = async (): Promise<string | undefined> => {
    if (!bridge?.selectFolder) {
      const input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');

      const selected = await new Promise<string>((resolve) => {
        input.onchange = () => {
          resolve(input.files?.[0]?.webkitRelativePath?.split('/')?.[0] ?? '');
        };
        input.click();
      });

      if (!selected) {
        setStatus('No folder selected.');
        return undefined;
      }

      setWorkingFolder(selected);
      setStatus(
        `Folder selected in browser sandbox: ${selected}. To apply local file changes, run the Electron desktop app (npm run dev).`,
      );
      return selected;
    }

    try {
      const selected = await bridge.selectFolder(workingFolder);
      if (selected && selected.trim()) {
        setWorkingFolder(selected);
        setStatus(`Working folder selected: ${selected}`);
        return selected;
      }
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open folder picker.';
      setStatus(message);
      return undefined;
    }
  };

  const handleOpenCoworkArtifact = async (artifact: CoworkArtifact) => {
    if (!bridge?.openPath) {
      setStatus('Opening artifacts requires the Electron desktop bridge.');
      return;
    }

    try {
      const result = await bridge.openPath(artifact.path);
      if (!result.ok) {
        throw new Error(result.error || 'Unable to open artifact path.');
      }

      setStatus(`Opened artifact: ${artifact.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open artifact.';
      setStatus(message);
    }
  };

  const handleSaveCoworkRunAsSkill = async () => {
    if (!bridge?.createFileInFolder) {
      setStatus('Saving a skill requires the Electron desktop bridge.');
      return;
    }

    const rootPath = workingFolder.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    const latestUserPrompt = [...coworkMessages].reverse().find((message) => message.role === 'user')?.text?.trim() || coworkDraftPrompt.trim();
    if (!latestUserPrompt) {
      setStatus('No cowork prompt found to save as a skill.');
      return;
    }

    const latestAssistantOutput = [...coworkMessages].reverse().find((message) => message.role === 'assistant')?.text?.trim() || '';
    const timestamp = new Date();
    const safeStamp = `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, '0')}${String(timestamp.getDate()).padStart(2, '0')}-${String(timestamp.getHours()).padStart(2, '0')}${String(timestamp.getMinutes()).padStart(2, '0')}${String(timestamp.getSeconds()).padStart(2, '0')}`;
    const relativePath = `.relay/skills/cowork-skill-${safeStamp}.md`;
    const touched = filesTouched.map((item) => `- ${item.path}`).join('\n');

    const skillDoc = [
      '# Cowork Skill Draft',
      '',
      `- Created: ${timestamp.toISOString()}`,
      `- Session: ${coworkSessionKey || '(none)'}`,
      '',
      '## Intent',
      latestUserPrompt,
      '',
      '## Files Touched',
      touched || '- (none)',
      '',
      '## Latest Assistant Output',
      latestAssistantOutput || '(none)',
    ].join('\n');

    try {
      const result = await bridge.createFileInFolder(rootPath, relativePath, skillDoc, false);
      setCoworkArtifacts((current) => [
        {
          id: `skill-${Date.now()}`,
          label: result.filePath.split(/[\\/]/).pop() || result.filePath,
          path: result.filePath,
          kind: 'summary' as const,
          status: 'ok' as const,
          updatedAt: Date.now(),
        },
        ...current,
      ].slice(0, 40));
      setStatus(`Saved skill draft: ${result.filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save skill draft.';
      setStatus(message);
    }
  };

  const handleScheduleCoworkRun = () => {
    const latestUserPrompt = [...coworkMessages].reverse().find((message) => message.role === 'user')?.text?.trim() || coworkDraftPrompt.trim();
    if (!latestUserPrompt) {
      setStatus('No cowork prompt available to schedule.');
      return;
    }

    setActivePage('scheduled');
    setStatus(
      activeCoworkProject?.name
        ? `Opened Schedule for project "${activeCoworkProject.name}".`
        : 'Opened Schedule. Create a cron job for this task prompt from your gateway scheduler.',
    );
  };

  const handleAssignScheduledJobToProject = useCallback((jobId: string, projectId?: string | null) => {
    const normalizedJobId = (jobId ?? '').trim();
    if (!normalizedJobId) {
      return;
    }
    const normalizedProjectId = (projectId ?? '').trim();
    setScheduledJobProjectLinks((current) => {
      if (!normalizedProjectId) {
        const { [normalizedJobId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [normalizedJobId]: normalizedProjectId,
      };
    });
  }, []);

  const handleCreateScheduledJob = useCallback(
    async (input: { name: string; schedule: string; prompt: string; projectId?: string }) => {
      const client = gatewayClientRef.current;
      if (!client) {
        setStatus('Gateway client not initialized.');
        return;
      }

      try {
        await ensureConnectedClient(client);
        const createdId = await client.createCronJob({
          name: input.name,
          schedule: input.schedule,
          prompt: input.prompt,
          projectId: input.projectId,
          sessionKey: normalizeSessionKey(coworkSessionKeyRef.current) || undefined,
          enabled: true,
        });
        const refreshedJobs = await client.listCronJobs();
        setScheduledJobs(refreshedJobs);

        const normalizedProjectId = input.projectId?.trim() ?? '';
        if (createdId && normalizedProjectId) {
          handleAssignScheduledJobToProject(createdId, normalizedProjectId);
        }

        setStatus(`Scheduled task "${input.name}" created.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create scheduled task.';
        setStatus(message);
      }
    },
    [handleAssignScheduledJobToProject],
  );

  const handleUpdateScheduledJob = useCallback(
    async (input: { id: string; name?: string; schedule?: string; prompt?: string; enabled?: boolean }) => {
      const client = gatewayClientRef.current;
      if (!client) {
        setStatus('Gateway client not initialized.');
        return;
      }

      try {
        await ensureConnectedClient(client);
        await client.updateCronJob(input);
        const refreshedJobs = await client.listCronJobs();
        setScheduledJobs(refreshedJobs);
        setStatus('Scheduled task updated.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to update scheduled task.';
        setStatus(message);
      }
    },
    [],
  );

  const handleDeleteScheduledJob = useCallback(
    async (jobId: string) => {
      const client = gatewayClientRef.current;
      if (!client) {
        setStatus('Gateway client not initialized.');
        return;
      }

      try {
        await ensureConnectedClient(client);
        await client.deleteCronJob(jobId);
        handleAssignScheduledJobToProject(jobId, null);
        const refreshedJobs = await client.listCronJobs();
        setScheduledJobs(refreshedJobs);
        setStatus('Scheduled task deleted.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to delete scheduled task.';
        setStatus(message);
      }
    },
    [handleAssignScheduledJobToProject],
  );

  const handlePickWorkingFolderForProject = async (): Promise<string | undefined> => {
    const selected = await handlePickWorkingFolder();
    return selected?.trim() ? selected.trim() : undefined;
  };

  const handleApplyLocalPlan = async () => {
    if (!bridge?.applyOrganizeFolderPlan) {
      setStatus('Local file organizer is available in the Electron desktop app only.');
      return;
    }

    if (!localPlanRootPath || localPlanActions.length === 0) {
      setStatus('Create a plan before applying changes.');
      return;
    }

    setLocalApplyLoading(true);
    try {
      const result = await bridge.applyOrganizeFolderPlan(localPlanRootPath, localPlanActions);
      setStatus(
        `Applied ${result.applied} action${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}. ${
          result.errors.length > 0 ? 'Some items had errors.' : 'Done.'
        }`,
      );
      setLocalPlanActions([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply local file plan.';
      setStatus(message);
    } finally {
      setLocalApplyLoading(false);
    }
  };

  const handleWorkingFolderChange = (value: string) => {
    setWorkingFolder(value);
    const normalized = value.trim();
    workingFolderRef.current = normalized;

    if (!activeCoworkProjectId || !normalized) {
      return;
    }

    setCoworkProjects((current) =>
      current.map((project) =>
        project.id === activeCoworkProjectId
          ? {
              ...project,
              workspaceFolder: normalized,
              updatedAt: Date.now(),
            }
          : project,
      ),
    );
  };

  const handleSelectCoworkProject = (projectId: string) => {
    const normalizedProjectId = projectId.trim();
    setActiveCoworkProjectId(normalizedProjectId);

    if (!normalizedProjectId) {
      return;
    }

    const selected = coworkProjects.find((project) => project.id === normalizedProjectId);
    if (!selected) {
      return;
    }

    if (selected.workspaceFolder.trim()) {
      setWorkingFolder(selected.workspaceFolder);
      workingFolderRef.current = selected.workspaceFolder.trim();
    }
    setStatus(`Project selected: ${selected.name}`);
  };

  const handleCreateCoworkProject = (name: string, workspaceFolder: string, description?: string, instructions?: string) => {
    const normalizedName = name.trim();
    const normalizedFolder = workspaceFolder.trim();
    const normalizedDescription = description?.trim() ?? '';
    const normalizedInstructions = instructions?.trim() ?? '';
    if (!normalizedName || !normalizedFolder) {
      setStatus('Project name and workspace folder are required.');
      return;
    }

    const projectId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = Date.now();
    const nextProject: CoworkProject = {
      id: projectId,
      name: normalizedName,
      description: normalizedDescription || undefined,
      instructions: normalizedInstructions || undefined,
      workspaceFolder: normalizedFolder,
      createdAt: now,
      updatedAt: now,
    };

    setCoworkProjects((current) => [nextProject, ...current]);
    setActiveCoworkProjectId(projectId);
    setWorkingFolder(normalizedFolder);
    workingFolderRef.current = normalizedFolder;
    setStatus(`Project created: ${normalizedName}`);
  };

  const handleRenameCoworkProject = (projectId: string, name: string, description?: string, instructions?: string) => {
    const normalizedProjectId = projectId.trim();
    const normalizedName = name.trim();
    const normalizedDescription = description?.trim() ?? '';
    const normalizedInstructions = instructions?.trim() ?? '';
    if (!normalizedProjectId || !normalizedName) {
      setStatus('Project name is required.');
      return;
    }

    let renamedProjectName = '';
    setCoworkProjects((current) =>
      current.map((project) => {
        if (project.id !== normalizedProjectId) {
          return project;
        }

        renamedProjectName = normalizedName;
        return {
          ...project,
          name: normalizedName,
          description: normalizedDescription || undefined,
          instructions: normalizedInstructions || undefined,
          updatedAt: Date.now(),
        };
      }),
    );

    if (renamedProjectName) {
      setStatus(`Project updated: ${renamedProjectName}`);
    }
  };

  const handleUpdateCoworkProject = (projectId: string, name: string, workspaceFolder: string, description?: string, instructions?: string) => {
    const normalizedProjectId = projectId.trim();
    const normalizedName = name.trim();
    const normalizedFolder = workspaceFolder.trim();
    const normalizedDescription = description?.trim() ?? '';
    const normalizedInstructions = instructions?.trim() ?? '';
    if (!normalizedProjectId || !normalizedName || !normalizedFolder) {
      setStatus('Project name and workspace folder are required.');
      return;
    }

    let updatedProjectName = '';
    let updatedProjectFolder = '';
    setCoworkProjects((current) =>
      current.map((project) => {
        if (project.id !== normalizedProjectId) {
          return project;
        }

        updatedProjectName = normalizedName;
        updatedProjectFolder = normalizedFolder;
        return {
          ...project,
          name: normalizedName,
          description: normalizedDescription || undefined,
          instructions: normalizedInstructions || undefined,
          workspaceFolder: normalizedFolder,
          updatedAt: Date.now(),
        };
      }),
    );

    if (normalizedProjectId === activeCoworkProjectId && updatedProjectFolder) {
      setWorkingFolder(updatedProjectFolder);
      workingFolderRef.current = updatedProjectFolder;
    }

    if (updatedProjectName) {
      setStatus(`Project updated: ${updatedProjectName}`);
    }
  };

  const handleAddProjectKnowledge = (projectId: string, title: string, content: string) => {
    const normalizedProjectId = projectId.trim();
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedProjectId || !normalizedTitle || !normalizedContent) {
      setStatus('Knowledge title and content are required.');
      return;
    }

    const now = Date.now();
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `knowledge-${now}-${Math.random().toString(16).slice(2)}`;

    setProjectKnowledgeItems((current) => [
      {
        id,
        projectId: normalizedProjectId,
        title: normalizedTitle,
        content: normalizedContent,
        createdAt: now,
        updatedAt: now,
      },
      ...current,
    ].slice(0, 500));
    setStatus(`Knowledge saved: ${normalizedTitle}`);
  };

  const handleDeleteProjectKnowledge = (knowledgeId: string) => {
    const normalizedId = knowledgeId.trim();
    if (!normalizedId) {
      return;
    }
    setProjectKnowledgeItems((current) => current.filter((item) => item.id !== normalizedId));
    setStatus('Knowledge entry deleted.');
  };

  const handleToggleOperatorDefinition = useCallback((operatorId: string, enabled: boolean) => {
    const normalizedOperatorId = operatorId.trim();
    if (!normalizedOperatorId) {
      return;
    }
    setOperatorDefinitions((current) =>
      current.map((item) =>
        item.id === normalizedOperatorId
          ? {
              ...item,
              enabled,
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
    setStatus(enabled ? 'Operator enabled.' : 'Operator paused.');
  }, []);

  const handleRunResearchOperator = useCallback(
    async (input: { operatorId: string; topic: string; depth: 'light' | 'standard' | 'deep'; deliverBy?: string }) => {
      const operator = operatorDefinitions.find((item) => item.id === input.operatorId);
      if (!operator) {
        setStatus('Operator not found.');
        return;
      }
      if (!operator.enabled) {
        setStatus('Operator is paused. Enable it first.');
        return;
      }
      const topic = input.topic.trim();
      const validationError = validateResearchOperatorInput({
        topic,
        depth: input.depth,
        deliverBy: input.deliverBy,
      });
      if (validationError) {
        setStatus(validationError);
        return;
      }

      const compiledPlan = compileResearchOperatorPlan(operator, {
        topic,
        depth: input.depth,
        deliverBy: input.deliverBy,
      });

      const now = Date.now();
      const makeId = () =>
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const runId = makeId();
      const stepDefs = compiledPlan.steps.map((step) => ({ key: step.key, label: step.label }));

      const nextRun: OperatorRun = {
        id: runId,
        operatorId: operator.id,
        projectId: operator.projectId,
        kind: operator.kind,
        status: 'queued',
        compiledPlan,
        input: {
          topic,
          depth: input.depth,
          deliverBy: input.deliverBy?.trim() || undefined,
        },
        steps: stepDefs.map((step) => ({
          id: makeId(),
          key: step.key,
          label: step.label,
          status: 'pending',
        })),
        artifacts: [],
        createdAt: now,
        updatedAt: now,
      };
      setOperatorRuns((current) => [nextRun, ...current].slice(0, 1000));

      const setStepRunning = (index: number, details: string) => {
        setOperatorRuns((current) =>
          current.map((run) => {
            if (run.id !== runId) return run;
            return {
              ...run,
              status: 'running',
              startedAt: run.startedAt ?? Date.now(),
              updatedAt: Date.now(),
              steps: run.steps.map((step, stepIndex) => {
                if (stepIndex < index) return step;
                if (stepIndex === index) {
                  return {
                    ...step,
                    status: 'running',
                    startedAt: step.startedAt ?? Date.now(),
                    details,
                  };
                }
                return step;
              }),
            };
          }),
        );
      };

      const completeStep = (index: number, details?: string) => {
        setOperatorRuns((current) =>
          current.map((run) => {
            if (run.id !== runId) return run;
            return {
              ...run,
              updatedAt: Date.now(),
              steps: run.steps.map((step, stepIndex) =>
                stepIndex === index
                  ? {
                      ...step,
                      status: 'completed',
                      details: details ?? step.details,
                      finishedAt: Date.now(),
                    }
                  : step,
              ),
            };
          }),
        );
      };

      try {
        const client = gatewayClientRef.current;
        if (!client) {
          throw new Error('Gateway client not initialized.');
        }
        await ensureConnectedClient(client);

        let sessionKey = normalizeSessionKey(coworkSessionKeyRef.current);
        if (!sessionKey) {
          sessionKey = normalizeSessionKey(await client.createCoworkSession());
          if (!sessionKey) {
            throw new Error('Unable to create operator session.');
          }
          commitCoworkSessionKey(sessionKey);
        }
        const waitForAssistantResponse = async (knownIds: Set<string>): Promise<string> => {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 900));
            const historyNow = await client.getHistory(sessionKey, 120);
            const freshAssistant = [...historyNow]
              .reverse()
              .find((message) => message.role === 'assistant' && !knownIds.has(message.id) && message.text.trim().length > 0);
            if (freshAssistant) {
              return freshAssistant.text.trim();
            }
          }
          return '';
        };

        const resolveTierChain = (primary: 'fast' | 'reasoning' | 'verify') => {
          const merged = [primary, ...compiledPlan.routingPolicy.fallbackTiers];
          return merged.filter((entry, index) => merged.indexOf(entry) === index);
        };

        const stepOutputs: Record<string, string> = {};
        const renderTemplate = (template: string) => {
          const previous = Object.entries(stepOutputs)
            .map(([key, value]) => `Step ${key}: ${value.slice(0, 800)}`)
            .join('\n\n');
          return [
            template.replaceAll('{{topic}}', topic),
            `Depth: ${input.depth}`,
            input.deliverBy?.trim() ? `Requested deadline: ${input.deliverBy.trim()}` : '',
            previous ? `\nPrevious step context:\n${previous}` : '',
            '\nRespond in markdown.',
          ]
            .filter(Boolean)
            .join('\n');
        };

        for (let stepIndex = 0; stepIndex < compiledPlan.steps.length; stepIndex += 1) {
          const step = compiledPlan.steps[stepIndex];
          const tierChain = resolveTierChain(step.modelTier);
          let stepOutput = '';
          let completionNote = '';

          for (let tierIndex = 0; tierIndex < tierChain.length; tierIndex += 1) {
            const tier = tierChain[tierIndex];
            try {
              setStepRunning(stepIndex, `Running ${step.label} on ${tier} tier (${tierIndex + 1}/${tierChain.length}).`);
              const historyBefore = await client.getHistory(sessionKey, 100);
              const knownIds = new Set(historyBefore.map((message) => message.id));
              const stepPrompt = [
                `[Operator: ${operator.name}]`,
                `Step: ${step.label}`,
                `Mode: ${step.mode}`,
                `Model tier: ${tier}`,
                '',
                renderTemplate(step.promptTemplate),
              ].join('\n');

              await client.sendChat(sessionKey, stepPrompt);
              const response = await waitForAssistantResponse(knownIds);
              if (!response) {
                throw new Error(`No assistant output for tier ${tier}.`);
              }

              stepOutput = response;
              completionNote = `Completed on ${tier} tier.`;
              break;
            } catch (tierError) {
              const message = tierError instanceof Error ? tierError.message : 'Step attempt failed.';
              if (tierIndex === tierChain.length - 1) {
                throw new Error(`Step "${step.label}" failed. ${message}`);
              }
            }
          }

          if (!stepOutput) {
            throw new Error(`Step "${step.label}" produced no output.`);
          }

          stepOutputs[step.key] = stepOutput;
          completeStep(stepIndex, completionNote);
        }

        const assistantReport =
          stepOutputs.draft ||
          stepOutputs[compiledPlan.steps[compiledPlan.steps.length - 1]?.key ?? ''] ||
          '';
        if (!assistantReport.trim()) {
          throw new Error('Compiled plan finished but produced no report output.');
        }

        const linkCount = (assistantReport.match(/https?:\/\//gi) ?? []).length;
        const hasMinimumLength = assistantReport.length >= 400;
        const hasSummaryHeading = /#+\s*executive summary/i.test(assistantReport);
        const hasFindingsHeading = /#+\s*key findings/i.test(assistantReport);
        const validationWarnings = [
          !hasMinimumLength ? `short output (${assistantReport.length} chars)` : '',
          !hasSummaryHeading ? 'missing Executive Summary heading' : '',
          !hasFindingsHeading ? 'missing Key Findings heading' : '',
          linkCount < 2 ? `few links (${linkCount})` : '',
        ].filter(Boolean);
        const validationNote =
          validationWarnings.length === 0
            ? `Validation passed. Sources detected: ${linkCount}.`
            : `Validation warnings: ${validationWarnings.join('; ')}.`;

        const finishedAt = Date.now();
        const report = assistantReport;

        setOperatorRuns((current) =>
          current.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  status: 'completed',
                  summary: `Research report completed for "${topic}" via gateway. ${validationNote}`,
                  updatedAt: finishedAt,
                  finishedAt,
                  artifacts: [
                    {
                      id: makeId(),
                      runId,
                      name: `${topic.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'research-report'}.md`,
                      content: report,
                      kind: 'markdown',
                      createdAt: finishedAt,
                    },
                  ],
                }
              : run,
          ),
        );
        setStatus(`Operator completed: ${topic}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Operator run failed.';
        setOperatorRuns((current) =>
          current.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  status: 'failed',
                  error: message,
                  updatedAt: Date.now(),
                  finishedAt: Date.now(),
                }
              : run,
          ),
        );
        setStatus(message);
      }
    },
    [operatorDefinitions],
  );

  const handleCreateOutcomePipeline = useCallback(
    (
      projectId: string,
      input: {
        name: string;
        description?: string;
        triggerKind?: OutcomePipeline['triggerKind'];
        triggerValue?: string;
        sessionTarget?: OutcomePipeline['sessionTarget'];
        delivery?: OutcomePipeline['delivery'];
        webhookUrl?: string;
        agentId?: string;
        prompt: string;
      },
    ) => {
      const normalizedProjectId = projectId.trim();
      const normalizedName = input.name.trim();
      const normalizedPrompt = input.prompt.trim();
      if (!normalizedProjectId || !normalizedName || !normalizedPrompt) {
        setStatus('Pipeline name and prompt are required.');
        return;
      }

      const now = Date.now();
      const makeId = () =>
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `pipeline-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const nextPipeline: OutcomePipeline = {
        id: makeId(),
        projectId: normalizedProjectId,
        name: normalizedName,
        description: input.description?.trim() || undefined,
        enabled: true,
        triggerKind: input.triggerKind ?? 'cron',
        triggerValue: input.triggerValue?.trim() || '0 9 * * *',
        sessionTarget: input.sessionTarget ?? 'current',
        delivery: input.delivery ?? 'none',
        webhookUrl: input.webhookUrl?.trim() || undefined,
        agentId: input.agentId?.trim() || undefined,
        steps: [
          {
            id: makeId(),
            kind: 'session_send',
            prompt: normalizedPrompt,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      setOutcomePipelines((current) => [nextPipeline, ...current].slice(0, 500));
      setStatus(`Pipeline created: ${normalizedName}`);
    },
    [],
  );

  const handleUpdateOutcomePipeline = useCallback(
    (
      pipelineId: string,
      input: {
        name?: string;
        description?: string;
        triggerKind?: OutcomePipeline['triggerKind'];
        triggerValue?: string;
        sessionTarget?: OutcomePipeline['sessionTarget'];
        delivery?: OutcomePipeline['delivery'];
        webhookUrl?: string;
        agentId?: string;
        prompt?: string;
      },
    ) => {
      const normalizedPipelineId = pipelineId.trim();
      if (!normalizedPipelineId) {
        return;
      }
      let updatedName = '';
      let changed = false;
      setOutcomePipelines((current) =>
        current.map((pipeline) => {
          if (pipeline.id !== normalizedPipelineId) {
            return pipeline;
          }
          changed = true;
          updatedName = input.name?.trim() || pipeline.name;
          const nextPrompt = input.prompt?.trim();
          return {
            ...pipeline,
            name: updatedName,
            description: input.description !== undefined ? input.description.trim() || undefined : pipeline.description,
            triggerKind: input.triggerKind ?? pipeline.triggerKind,
            triggerValue: input.triggerValue !== undefined ? input.triggerValue.trim() || pipeline.triggerValue : pipeline.triggerValue,
            sessionTarget: input.sessionTarget ?? pipeline.sessionTarget,
            delivery: input.delivery ?? pipeline.delivery,
            webhookUrl: input.webhookUrl !== undefined ? input.webhookUrl.trim() || undefined : pipeline.webhookUrl,
            agentId: input.agentId !== undefined ? input.agentId.trim() || undefined : pipeline.agentId,
            steps:
              nextPrompt !== undefined
                ? pipeline.steps.length > 0
                  ? pipeline.steps.map((step, index) => (index === 0 ? { ...step, prompt: nextPrompt || step.prompt } : step))
                  : [
                      {
                        id:
                          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                            ? crypto.randomUUID()
                            : `pipeline-step-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        kind: 'session_send' as const,
                        prompt: nextPrompt,
                      },
                    ]
                : pipeline.steps,
            updatedAt: Date.now(),
          };
        }),
      );
      if (changed) {
        setStatus(updatedName ? `Pipeline updated: ${updatedName}` : 'Pipeline updated.');
      }
    },
    [],
  );

  const handleToggleOutcomePipeline = useCallback((pipelineId: string, enabled: boolean) => {
    const normalizedPipelineId = pipelineId.trim();
    if (!normalizedPipelineId) {
      return;
    }
    setOutcomePipelines((current) =>
      current.map((pipeline) =>
        pipeline.id === normalizedPipelineId
          ? {
              ...pipeline,
              enabled,
              updatedAt: Date.now(),
            }
          : pipeline,
      ),
    );
    setStatus(enabled ? 'Pipeline enabled.' : 'Pipeline paused.');
  }, []);

  const handleDeleteOutcomePipeline = useCallback((pipelineId: string) => {
    const normalizedPipelineId = pipelineId.trim();
    if (!normalizedPipelineId) {
      return;
    }
    setOutcomePipelines((current) => current.filter((pipeline) => pipeline.id !== normalizedPipelineId));
    setOutcomePipelineRuns((current) => current.filter((run) => run.pipelineId !== normalizedPipelineId));
    setStatus('Pipeline deleted.');
  }, []);

  const handleDeleteCoworkProject = (projectId: string) => {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      return;
    }

    let deletedProjectName = '';
    setCoworkProjects((current) => {
      const target = current.find((project) => project.id === normalizedProjectId);
      if (target) {
        deletedProjectName = target.name;
      }
      return current.filter((project) => project.id !== normalizedProjectId);
    });
    setProjectKnowledgeItems((current) => current.filter((item) => item.projectId !== normalizedProjectId));
    setOutcomePipelines((current) => current.filter((item) => item.projectId !== normalizedProjectId));
    setOutcomePipelineRuns((current) => current.filter((item) => item.projectId !== normalizedProjectId));
    setOperatorDefinitions((current) => current.filter((item) => item.projectId !== normalizedProjectId));
    setOperatorRuns((current) => current.filter((item) => item.projectId !== normalizedProjectId));

    if (activeCoworkProjectId === normalizedProjectId) {
      setActiveCoworkProjectId('');
    }

    setStatus(
      deletedProjectName
        ? `Project deleted: ${deletedProjectName}`
        : 'Project deleted.',
    );
  };

  const handleCreateFileInWorkingFolder = async () => {
    if (!bridge?.createFileInFolder) {
      setStatus('Creating local files is available in the Electron desktop app only.');
      return;
    }

    const rootPath = workingFolder.trim();
    const relativePath = localFileDraftPath.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    if (!relativePath) {
      setStatus('Provide a relative file path (for example: notes/todo.md).');
      return;
    }

    setLocalFileCreateLoading(true);
    try {
      const result = await bridge.createFileInFolder(rootPath, relativePath, localFileDraftContent);
      setStatus(`Created file: ${result.filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create file in working folder.';
      setStatus(message);
    } finally {
      setLocalFileCreateLoading(false);
    }
  };

  const handleRunLocalActionSmokeTest = async () => {
    if (!bridge) {
      setStatus('Local action smoke test is available in the Electron desktop app only.');
      return;
    }

    const rootPath = workingFolder.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    const relativePath = 'relay-smoke-test.md';
    setLocalActionSmokeRunning(true);

    const receipts: LocalActionReceipt[] = [];
    const errors: string[] = [];

    try {
      if (bridge.createFileInFolder) {
        await bridge.createFileInFolder(rootPath, relativePath, '# Relay Smoke Test\n', true);
        receipts.push({ id: 'smoke-create', type: 'create_file', path: relativePath, status: 'ok' });
      }

      if (bridge.appendFileInFolder) {
        await bridge.appendFileInFolder(rootPath, relativePath, '\nAppended line from smoke test.\n');
        receipts.push({ id: 'smoke-append', type: 'append_file', path: relativePath, status: 'ok' });
      }

      if (bridge.readFileInFolder) {
        const readResult = await bridge.readFileInFolder(rootPath, relativePath);
        receipts.push({
          id: 'smoke-read',
          type: 'read_file',
          path: readResult.filePath,
          status: 'ok',
          message: `Read ${readResult.content.length} chars`,
        });
      }

      if (bridge.existsInFolder) {
        const exists = await bridge.existsInFolder(rootPath, relativePath);
        receipts.push({
          id: 'smoke-exists',
          type: 'exists',
          path: exists.path,
          status: exists.exists ? 'ok' : 'error',
          errorCode: exists.exists ? undefined : 'NOT_FOUND',
          message: exists.exists ? exists.kind : 'none',
        });
      }

      if (bridge.listDirInFolder) {
        const listing = await bridge.listDirInFolder(rootPath, '');
        receipts.push({
          id: 'smoke-list',
          type: 'list_dir',
          path: '.',
          status: 'ok',
          message: `Listed ${listing.items.length} item${listing.items.length === 1 ? '' : 's'}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown smoke test failure.';
      errors.push(message);
      receipts.push({
        id: 'smoke-error',
        type: 'exists',
        path: relativePath,
        status: 'error',
        errorCode: 'SMOKE_FAILED',
        message,
      });
    } finally {
      pushLocalActionReceipts(receipts);
      if (errors.length > 0) {
        setStatus(`Local action smoke test failed: ${errors[0]}`);
      } else {
        setStatus(`Local action smoke test passed. File: ${rootPath}\\${relativePath}`);
      }
      setLocalActionSmokeRunning(false);
    }
  };

  const handleSendChat = async (event: FormEvent) => {
    event.preventDefault();
    if (!gatewayConnected) {
      setStatus('Gateway disconnected. Connect in Settings > Gateway to send chat messages.');
      setAwaitingChatStream(false);
      setSendingChat(false);
      return;
    }

    const text = chatDraftPrompt.trim();
    if (!text) {
      setStatus('Type a message before sending.');
      return;
    }

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setSendingChat(true);
    setAwaitingChatStream(false);
    handleChatPromptChange('');

    try {
      const shouldCreateFreshSession = chatMessages.length === 0;

      let sessionKey = '';
      if (shouldCreateFreshSession) {
        await ensureConnectedClient(client);
        sessionKey = normalizeSessionKey(await client.createChatSession());
        if (!sessionKey) {
          throw new Error('No session key returned from Gateway.');
        }
        // Avoid loading history immediately after creating a fresh session,
        // which can race and overwrite the optimistic first user message.
        skipNextChatEffectLoadRef.current = true;
        commitActiveSessionKey(sessionKey);
      } else {
        sessionKey = await ensureActiveChatSession(client, { createIfMissing: true });
      }

      setChatMessages((current) => {
        const next = [...current, { id: `local-${Date.now()}`, role: 'user' as const, text }];
        threadMessageCache.current.set(sessionKey, next);
        return next;
      });

      upsertChatThread(sessionKey, {
        title: text,
        touchedAt: Date.now(),
      });

      const rawOutbound = buildOutboundChatPrompt(text, chatMessages);
      const chatMemoryContext = preferences.injectMemory
        ? buildMemoryContext(loadMemoryEntries(), preferences.systemPrompt)
        : preferences.systemPrompt.trim();
      const outboundMessage = chatMemoryContext
        ? `${chatMemoryContext}\n\n${rawOutbound}`
        : rawOutbound;
      setAwaitingChatStream(true);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const sent = await client.sendChat(sessionKey, outboundMessage);
          sessionKey = sent.sessionKey;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          const isMissing = message.includes('no session found') || message.includes('no sendable session found');
          if (!isMissing || attempt === 3) {
            throw error;
          }
          setStatus(`Send retry ${attempt}/3: session=${sessionKey} failed (${message}). Resolving session...`);
          sessionKey = await getOrResolveSession(client);
        }
      }

      commitActiveSessionKey(sessionKey);
      setStatus(`Message sent to OpenClaw Gateway (session: ${sessionKey}). Waiting for streaming events...`);
    } catch (error) {
      setAwaitingChatStream(false);
      const message = error instanceof Error ? error.message : 'Failed to send chat message.';
      setStatus(message);
    } finally {
      setSendingChat(false);
    }
  };

  const handleModelChange = async (nextModelValue: string) => {
    const previousModel = selectedModel;
    setSelectedModel(nextModelValue);

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      setSelectedModel(previousModel);
      return;
    }

    setChangingModel(true);
    try {
      const sessionKey = await ensureActiveChatSession(client, { createIfMissing: true });
      await client.setSessionModel(sessionKey, nextModelValue || null);
      setStatus(
        nextModelValue
          ? `Model updated for session ${sessionKey}: ${nextModelValue}`
          : `Model reset to default for session ${sessionKey}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update model.';
      setStatus(message);
      setSelectedModel(previousModel);
    } finally {
      setChangingModel(false);
    }
  };

  const handleCoworkModelChange = async (nextModelValue: string) => {
    const previousModel = coworkModel;
    setCoworkModel(nextModelValue);

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      setCoworkModel(previousModel);
      return;
    }

    const sessionKey = normalizeSessionKey(coworkSessionKeyRef.current);
    if (!sessionKey) {
      setStatus(
        nextModelValue
          ? `Cowork model selected: ${nextModelValue}. It will apply on the next task run.`
          : 'Cowork model reset to default. It will apply on the next task run.',
      );
      return;
    }

    setChangingCoworkModel(true);
    try {
      await ensureConnectedClient(client);
      await client.setSessionModel(sessionKey, nextModelValue || null);
      setStatus(
        nextModelValue
          ? `Cowork model updated for session ${sessionKey}: ${nextModelValue}`
          : `Cowork model reset to default for session ${sessionKey}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update cowork model.';
      setStatus(message);
      setCoworkModel(previousModel);
    } finally {
      setChangingCoworkModel(false);
    }
  };

  const handleStartNewChat = async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    // Save current chat messages before switching
    const currentKey = activeSessionKeyRef.current;
    if (currentKey) {
      const currentMessages = chatMessages;
      if (currentMessages.length > 0) {
        threadMessageCache.current.set(currentKey, currentMessages);
      }
    }

    setChatMessages([]);
    setAwaitingChatStream(false);
    handleChatPromptChange('');

    try {
      await ensureConnectedClient(client);
      const sessionKey = normalizeSessionKey(await client.createChatSession());
      if (!sessionKey) {
        throw new Error('No session key returned from Gateway.');
      }
      commitActiveSessionKey(sessionKey);
      setActivePage('chat');
      setStatus(`Started a new chat: ${sessionKey}.`);
      void loadModelsForSession(client, sessionKey);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create chat session.';
      setStatus(message);
    }
  };

  const handleOpenRecentChat = (sessionKey: string) => {
    const normalized = sessionKey.trim();
    if (!normalized) {
      return;
    }

    // Save current chat messages before switching
    const currentKey = activeSessionKeyRef.current;
    if (currentKey) {
      setChatMessages((current) => {
        if (current.length > 0) {
          threadMessageCache.current.set(currentKey, current);
        }
        return current;
      });
    }

    setActivePage('chat');
    commitActiveSessionKey(normalized);
    handleChatPromptChange('');
    setAwaitingChatStream(false);

    // Restore from local cache first
    const cached = threadMessageCache.current.get(normalized);
    if (cached && cached.length > 0) {
      setChatMessages(cached);
      const titleFromCache = deriveThreadTitleFromMessages(cached);
      setStatus(titleFromCache ? `Opened chat: ${titleFromCache}` : 'Opened chat.');
      skipNextChatEffectLoadRef.current = true;
      return;
    }

    // Fall back to Gateway history
    setChatMessages([]);
    setAwaitingChatStream(false);
    setStatus('Loading recent chat...');
    skipNextChatEffectLoadRef.current = true;
    void loadChatSession(normalized, 'Opened chat');
  };

  const handleOpenRecentCowork = (sessionKey: string) => {
    const normalized = sessionKey.trim();
    if (!normalized) {
      return;
    }

    setActivePage('cowork');
    commitCoworkSessionKey(normalized);
    handleCoworkPromptChange('');
    setCoworkAwaitingStream(false);
    setCoworkRunPhase('idle');
    setCoworkRunStatus('Opened previous cowork session.');

    const cached = coworkMessageCache.current.get(normalized);
    if (cached && cached.length > 0) {
      setCoworkMessages(cached);
      const titleFromCache = deriveThreadTitleFromMessages(cached);
      setStatus(titleFromCache ? `Opened task: ${titleFromCache}` : 'Opened task.');
      return;
    }

    setCoworkMessages([]);
    setStatus('Loading recent cowork task...');
    void loadCoworkSession(normalized, 'Opened task');
  };

  const handleRenameRecentItem = (item: RecentWorkspaceEntry) => {
    setRecentRenameTarget(item);
    setRecentRenameValue(item.label);
  };

  const handleConfirmRenameRecentItem = async () => {
    if (!recentRenameTarget) {
      return;
    }

    const currentLabel = recentRenameTarget.label.trim();
    const nextTitle = toRecentSidebarLabel(recentRenameValue);
    if (!nextTitle) {
      setStatus('Title cannot be empty.');
      return;
    }

    if (nextTitle === currentLabel) {
      setRecentRenameTarget(null);
      setRecentRenameValue('');
      return;
    }

    const client = gatewayClientRef.current;
    setRecentActionBusy(true);
    try {
      if (client) {
        try {
          await ensureConnectedClient(client);
          await client.setSessionTitle(recentRenameTarget.sessionKey, nextTitle);
        } catch {
          setStatus('Renamed locally. Gateway title sync is not available on this server.');
        }
      }

      renameThread(recentRenameTarget.sessionKey, nextTitle, recentRenameTarget.kind);
      setStatus(`${recentRenameTarget.kind === 'cowork' ? 'Task' : 'Chat'} renamed.`);
      setRecentRenameTarget(null);
      setRecentRenameValue('');
    } finally {
      setRecentActionBusy(false);
    }
  };

  const handleDeleteRecentItem = (item: RecentWorkspaceEntry) => {
    setRecentDeleteTarget(item);
  };

  const handleConfirmDeleteRecentItem = async () => {
    if (!recentDeleteTarget) {
      return;
    }

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setRecentActionBusy(true);
    try {
      await ensureConnectedClient(client);
      await client.deleteSession(recentDeleteTarget.sessionKey);
      removeThread(recentDeleteTarget.sessionKey, recentDeleteTarget.kind);
      setStatus(`${recentDeleteTarget.kind === 'cowork' ? 'Task' : 'Chat'} deleted.`);
      setRecentDeleteTarget(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete session.';
      setStatus(message);
    } finally {
      setRecentActionBusy(false);
    }
  };

  const loadScheduledJobs = useCallback(async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setScheduledLoading(true);
    try {
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });
      const rows = await client.listCronJobs();
      setScheduledJobs(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load scheduled jobs.';
      setStatus(message || 'Unable to load scheduled jobs.');
      setScheduledJobs([]);
    } finally {
      setScheduledLoading(false);
    }
  }, [draftGatewayToken, draftGatewayUrl]);

  useEffect(() => {
    if (activePage !== 'cowork' && activePage !== 'scheduled') {
      return;
    }

    void loadScheduledJobs();
    const client = gatewayClientRef.current;
    if (client && activePage === 'cowork') {
      const sessionKey = normalizeSessionKey(coworkSessionKeyRef.current);
      void loadCoworkModels(client, sessionKey || undefined);
    }
  }, [activePage, loadScheduledJobs]);

  useEffect(() => {
    setActiveMenuItem('');
  }, [activePage]);

  const handleMinimize = async () => {
    if (!bridge?.minimizeWindow) {
      setStatus('Window controls are available only in the Electron desktop app.');
      return;
    }

    try {
      await bridge.minimizeWindow();
    } catch {
      setStatus('Unable to minimize window.');
    }
  };

  const handleToggleMaximize = async () => {
    if (!bridge?.toggleMaximizeWindow) {
      setStatus('Window controls are available only in the Electron desktop app.');
      return;
    }

    try {
      const nextState = await bridge.toggleMaximizeWindow();
      setIsMaximized(nextState);
    } catch {
      setStatus('Unable to resize window.');
    }
  };

  const handleClose = async () => {
    if (bridge?.closeWindow) {
      try {
        await bridge.closeWindow();
        return;
      } catch {
        setStatus('Unable to close window from bridge.');
      }
    }

    window.close();
  };

  const handleShowSystemMenu = async (x: number, y: number) => {
    if (!bridge?.showSystemMenu) {
      return;
    }

    try {
      await bridge.showSystemMenu(x, y);
    } catch {
      setStatus('Unable to open system menu.');
    }
  };

  const handleCompleteOnboarding = () => {
    completeOnboarding();
    setActivePage('cowork');
  };

  const handleStartNewTask = () => {
    setActivePage('cowork');
    handleCoworkPromptChange('');
    setTaskState('idle');
    commitCoworkSessionKey('');
    setCoworkMessages([]);
    setCoworkAwaitingStream(false);
    setCoworkStreamingText('');
    setCoworkRunPhase('idle');
    setCoworkRunStatus('Ready for a new task.');
    setLocalPlanActions([]);
    setLocalPlanRootPath('');
    setPendingApprovals([]);
    setStatus('Ready for a new task.');
    setCoworkResetKey((current) => current + 1);
  };

  useEffect(() => {
    if (activePage === 'chat') {
      setActivePage('cowork');
    }
  }, [activePage]);

  const handleRerunLastCoworkTask = () => {
    if (!latestVisibleCoworkTaskPrompt) {
      setStatus('No previous task prompt available to rerun.');
      return;
    }
    setActivePage('cowork');
    handleCoworkPromptChange(latestVisibleCoworkTaskPrompt);
    setStatus('Loaded last task prompt. Review and send to rerun.');
  };

  const pageLoadingFallback = (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading page...
    </div>
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const allThreadsForSearch = [
    ...coworkThreads.map((t) => ({ ...t, label: t.title, kind: 'cowork' as const })),
  ];
  const searchCandidates = (normalizedSearchQuery ? allThreadsForSearch : recentItems).map((item) => ({
    id: item.id,
    sessionKey: item.sessionKey,
    label: ('title' in item ? item.title : item.label) as string,
    updatedAt: ('updatedAt' in item ? item.updatedAt : undefined) as number | undefined,
    kind: ('kind' in item ? item.kind : 'chat') as 'chat' | 'cowork',
  }));
  const matchingChats = normalizedSearchQuery
    ? searchCandidates.filter((thread) => thread.label.toLowerCase().includes(normalizedSearchQuery))
    : searchCandidates;

  const handleSearchOpenChange = (nextOpen: boolean) => {
    setSearchOpen(nextOpen);
    if (nextOpen) {
      setSearchQuery('');
      setActiveMenuItem('Search');
      return;
    }
    setActiveMenuItem('');
  };

  const handleExportChat = useCallback(() => {
    if (chatMessages.length === 0) return;
    const lines = chatMessages.map((m) => {
      const speaker = m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : 'Assistant';
      return `## ${speaker}\n\n${m.text}`;
    });
    const markdown = `# Chat Export — ${new Date().toLocaleDateString()}\n\n${lines.join('\n\n---\n\n')}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-chat-${activeSessionKey || 'export'}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chatMessages, activeSessionKey]);

  return (
    <div className="grid h-full grid-rows-[44px_minmax(0,1fr)] overflow-hidden">
      <AppTitlebar
        sidebarOpen={sidebarOpen}
        activePage={activePage}
        coworkRightPanelOpen={coworkRightPanelOpen}
        isMaximized={isMaximized}
        usageModeLabel={usageModeLabel}
        gatewayConnected={gatewayConnected}
        coworkRunPhase={coworkRunPhase}
        coworkRunStatus={coworkRunStatus}
        coworkProgressSteps={coworkProgressSteps}
        coworkFilesTouchedCount={filesTouched.length}
        coworkSessionKey={coworkSessionKey}
        onSaveRunAsSkill={handleSaveCoworkRunAsSkill}
        onScheduleRun={handleScheduleCoworkRun}
        minimal={needsOnboarding || !canUseAppShell}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onToggleCoworkRightPanel={() => setCoworkRightPanelOpen((current) => !current)}
        onSelectPage={setActivePage}
        onMinimize={handleMinimize}
        onToggleMaximize={handleToggleMaximize}
        onClose={handleClose}
        onShowSystemMenu={handleShowSystemMenu}
        onOpenGatewaySettings={() => {
          setActivePage('settings');
          setSettingsSection('Gateway');
        }}
      />

      {needsOnboarding ? (
        <OnboardingPage
          draftGatewayUrl={draftGatewayUrl}
          draftGatewayToken={draftGatewayToken}
          health={health}
          saving={saving}
          pairingRequestId={pairingRequestId}
          onDraftGatewayUrlChange={setDraftGatewayUrl}
          onDraftGatewayTokenChange={setDraftGatewayToken}
          onSave={handleSave}
          onComplete={handleCompleteOnboarding}
        />
      ) : (
        <SidebarProvider
          className={`grid h-full overflow-hidden transition-[grid-template-columns] duration-200 ${
            sidebarOpen ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-[64px_minmax(0,1fr)]'
          }`}
        >
          <AppSidebar
            sidebarOpen={sidebarOpen}
            activeMenuItem={activeMenuItem}
            activePage={activePage}
            activeSessionKey={activeSessionKey}
            activeCoworkSessionKey={coworkSessionKey}
            userEmail={userIdentityLabel}
            guestMode={guestMode}
            language={preferences.language}
            settingsSection={settingsSection}
            recentItems={recentItems}
            coworkProjects={coworkProjects}
            activeCoworkProjectId={activeCoworkProjectId}
            workingFolder={workingFolder}
            scheduledItems={scheduledJobs}
            scheduledLoading={scheduledLoading}
            sessionUsage={sessionUsage}
            onSelectRecentItem={(item) => {
              if (item.kind === 'cowork') {
                handleOpenRecentCowork(item.sessionKey);
                return;
              }
              handleOpenRecentChat(item.sessionKey);
            }}
            onRenameRecentItem={handleRenameRecentItem}
            onDeleteRecentItem={handleDeleteRecentItem}
            onSelectCoworkProject={handleSelectCoworkProject}
            onCreateCoworkProject={handleCreateCoworkProject}
            onRenameCoworkProject={handleRenameCoworkProject}
            onDeleteCoworkProject={handleDeleteCoworkProject}
            onPickWorkingFolder={handlePickWorkingFolderForProject}
            onStartNewChat={handleStartNewTask}
            onStartNewTask={handleStartNewTask}
            onSelectMenuItem={setActiveMenuItem}
            onSelectPage={(page) => setActivePage(page)}
            onOpenSearch={() => handleSearchOpenChange(true)}
            onOpenSettings={() => setActivePage('settings')}
            onSettingsSectionChange={setSettingsSection}
            onLanguageChange={(language) => updatePreferences({ language })}
            onLogout={handleLogout}
          />

          <main className="relative min-h-0 overflow-hidden p-0">
            <Dialog
              open={Boolean(recentRenameTarget)}
              onOpenChange={(nextOpen) => {
                if (!nextOpen && !recentActionBusy) {
                  setRecentRenameTarget(null);
                  setRecentRenameValue('');
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename {recentRenameTarget?.kind === 'cowork' ? 'task' : 'chat'}</DialogTitle>
                  <DialogDescription>
                    Set a custom title for this recent item.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  value={recentRenameValue}
                  onChange={(event) => setRecentRenameValue(event.target.value)}
                  placeholder="Enter title"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (!recentActionBusy) {
                        void handleConfirmRenameRecentItem();
                      }
                    }
                  }}
                />
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" disabled={recentActionBusy} />}>Cancel</DialogClose>
                  <Button type="button" onClick={() => void handleConfirmRenameRecentItem()} disabled={recentActionBusy}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog
              open={Boolean(recentDeleteTarget)}
              onOpenChange={(nextOpen) => {
                if (!nextOpen && !recentActionBusy) {
                  setRecentDeleteTarget(null);
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="text-red-600 dark:text-red-400">Delete recent session</DialogTitle>
                  <DialogDescription>
                    Delete {recentDeleteTarget?.kind === 'cowork' ? 'task' : 'chat'} "{recentDeleteTarget?.label}" and all of its messages?
                    This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" disabled={recentActionBusy} />}>Cancel</DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleConfirmDeleteRecentItem()}
                    disabled={recentActionBusy}
                  >
                    Delete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <CommandDialog
              open={searchOpen}
              onOpenChange={handleSearchOpenChange}
              title="Search"
              description="Search chats and projects"
              className="w-[min(980px,94vw)] max-w-none"
            >
              <Command>
                <CommandInput
                  placeholder="Search chats and projects"
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandList>
                  <CommandEmpty>No results found.</CommandEmpty>
                  <CommandGroup>
                    {matchingChats.map((thread) => (
                      <CommandItem
                        key={thread.id}
                        value={thread.label}
                        onSelect={() => {
                          if (thread.kind === 'cowork') {
                            handleOpenRecentCowork(thread.sessionKey);
                          } else {
                            handleOpenRecentChat(thread.sessionKey);
                          }
                          handleSearchOpenChange(false);
                        }}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="truncate">{thread.label}</span>
                        {'updatedAt' in thread && typeof thread.updatedAt === 'number' ? (
                          <span className="text-xs text-muted-foreground">
                            {new Date(thread.updatedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </CommandDialog>
            <Suspense fallback={pageLoadingFallback}>
              {activePage === 'cowork' ? (
                <CoworkPage
                  key={`cowork-${coworkResetKey}`}
                  projectTitle={activeCoworkProject?.name || 'No project selected'}
                  projectSelected={Boolean(activeCoworkProject)}
                  projectInstructions={activeCoworkProject?.instructions || ''}
                  scheduledCount={scheduledJobs.length}
                  canRerunLastTask={Boolean(latestVisibleCoworkTaskPrompt)}
                  taskPrompt={coworkDraftPrompt}
                  messages={coworkMessages}
                  rightPanelOpen={coworkRightPanelOpen}
                  awaitingStream={coworkAwaitingStream}
                  artifacts={coworkArtifacts}
                  onOpenArtifact={handleOpenCoworkArtifact}
                  onScheduleRun={handleScheduleCoworkRun}
                  onRerunLastTask={handleRerunLastCoworkTask}
                  selectedModel={coworkModel}
                  models={coworkModels}
                  modelsLoading={modelsLoading}
                  changingModel={changingCoworkModel}
                  pendingApprovals={visiblePendingApprovals}
                  projectTasks={visibleCoworkTasks}
                  sending={coworkSending}
                  gatewayConnected={gatewayConnected}
                  webSearchEnabled={coworkWebSearchEnabled}
                  projectPathReferences={coworkProjectPathReferences}
                  onOpenGatewaySettings={() => {
                    setActivePage('settings');
                    setSettingsSection('Gateway');
                  }}
                  onTaskPromptChange={handleCoworkPromptChange}
                  onModelChange={handleCoworkModelChange}
                  onWebSearchEnabledChange={setCoworkWebSearchEnabled}
                  onSubmit={handlePlanTask}
                  onApprovePendingAction={handleApprovePendingAction}
                  onRejectPendingAction={handleRejectPendingAction}
                />
              ) : activePage === 'project' ? (
                <ProjectPage
                  project={activeCoworkProject}
                  tasks={visibleCoworkTasks}
                  scheduledCount={scheduledJobs.length}
                  pipelineCount={visibleProjectPipelines.length}
                  pipelines={visibleProjectPipelines}
                  operators={visibleProjectOperators}
                  operatorRuns={visibleProjectOperatorRuns}
                  pendingApprovalsCount={visiblePendingApprovals.length}
                  artifacts={visibleProjectArtifacts}
                  projectKnowledge={visibleProjectKnowledge}
                  webSearchEnabled={coworkWebSearchEnabled}
                  onPickFolder={handlePickWorkingFolderForProject}
                  onUpdateProject={handleUpdateCoworkProject}
                  onCreatePipeline={handleCreateOutcomePipeline}
                  onUpdatePipeline={handleUpdateOutcomePipeline}
                  onTogglePipeline={handleToggleOutcomePipeline}
                  onDeletePipeline={handleDeleteOutcomePipeline}
                  onToggleOperator={handleToggleOperatorDefinition}
                  onRunResearchOperator={handleRunResearchOperator}
                  onOpenArtifact={handleOpenCoworkArtifact}
                  onAddKnowledge={handleAddProjectKnowledge}
                  onDeleteKnowledge={handleDeleteProjectKnowledge}
                  onWebSearchEnabledChange={setCoworkWebSearchEnabled}
                  onSelectPage={(page) => setActivePage(page)}
                />
              ) : activePage === 'files' ? (
                gatewayConnected ? (
                  <FilesPage
                    workingFolder={workingFolder}
                    desktopBridgeAvailable={Boolean(bridge)}
                    onPickFolder={handlePickWorkingFolder}
                    fileService={fileService}
                    localFileService={localFileService}
                    gatewayUrl={draftGatewayUrl}
                    root="workspace"
                  />
                ) : (
                  <section className="grid h-full place-items-center p-6">
                    <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 text-center">
                      <h2 className="text-lg font-semibold">Gateway disconnected</h2>
                      <p className="mt-2 font-sans text-sm text-muted-foreground">
                        Connect the gateway to view workspace contents.
                      </p>
                      <Button type="button" className="mt-4" onClick={() => setActivePage('settings')}>
                        Open Gateway Settings
                      </Button>
                    </div>
                  </section>
                )
              ) : activePage === 'local-files' ? (
                gatewayConnected ? (
                  <FilesPage
                    workingFolder={workingFolder}
                    desktopBridgeAvailable={Boolean(bridge)}
                    onPickFolder={handlePickWorkingFolder}
                    fileService={fileService}
                    localFileService={localFileService}
                    gatewayUrl={draftGatewayUrl}
                    root="working-folder"
                  />
                ) : (
                  <section className="grid h-full place-items-center p-6">
                    <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 text-center">
                      <h2 className="text-lg font-semibold">Gateway disconnected</h2>
                      <p className="mt-2 font-sans text-sm text-muted-foreground">
                        Connect the gateway to view project folder contents.
                      </p>
                      <Button type="button" className="mt-4" onClick={() => setActivePage('settings')}>
                        Open Gateway Settings
                      </Button>
                    </div>
                  </section>
                )
              ) : (
                  <ScrollArea className="h-full">
                    {activePage === 'activity' && (
                      <ActivityPage
                        chatMessages={chatMessages}
                        coworkMessages={coworkMessages}
                        activeSessionKey={activeSessionKey}
                        coworkSessionKey={coworkSessionKey}
                        gatewayConnected={gatewayConnected}
                      />
                    )}

                    {activePage === 'memory' && (
                      <MemoryPage
                        gatewayConnected={gatewayConnected}
                      />
                    )}

                    {activePage === 'scheduled' && (
                      <ScheduledPage
                        jobs={scheduledJobs}
                        projectId={activeCoworkProject?.id}
                        projectTitle={activeCoworkProject?.name}
                        draftPrompt={[...coworkMessages].reverse().find((message) => message.role === 'user')?.text?.trim() || coworkDraftPrompt.trim()}
                        jobProjectLinks={scheduledJobProjectLinks}
                        loading={scheduledLoading}
                        status={status}
                        onAssignJobToProject={handleAssignScheduledJobToProject}
                        onCreateJob={handleCreateScheduledJob}
                        onUpdateJob={handleUpdateScheduledJob}
                        onDeleteJob={handleDeleteScheduledJob}
                        onRefresh={loadScheduledJobs}
                      />
                    )}

                    {activePage === 'approvals' && (
                      <ApprovalsPage
                        projectTitle={activeCoworkProject?.name}
                        pendingApprovals={visiblePendingApprovals}
                        onApprovePendingAction={handleApprovePendingAction}
                        onRejectPendingAction={handleRejectPendingAction}
                      />
                    )}

                    {activePage === 'safety' && (
                      <SafetyPage
                        gatewayConnected={gatewayConnected}
                        projectId={activeCoworkProject?.id}
                        projectTitle={activeCoworkProject?.name}
                      />
                    )}

                    {activePage === 'settings' && (
                      <SettingsPage
                        activeSection={settingsSection}
                        draftGatewayUrl={draftGatewayUrl}
                        draftGatewayToken={draftGatewayToken}
                        health={health}
                        status={status}
                        saving={saving}
                        pairingRequestId={pairingRequestId}
                        preferences={preferences}
                        gatewayConnections={gatewayConnections}
                        selectedGatewayConnectionId={selectedGatewayConnectionId}
                        onDraftGatewayUrlChange={setDraftGatewayUrl}
                        onDraftGatewayTokenChange={setDraftGatewayToken}
                        onSave={handleSave}
                        onSelectGatewayConnection={handleSelectGatewayConnection}
                        onSaveGatewayConnection={handleSaveGatewayConnection}
                        onOverwriteGatewayConnection={handleOverwriteGatewayConnection}
                        onDeleteGatewayConnection={handleDeleteGatewayConnection}
                        onResetPairing={handleResetPairing}
                        onUpdatePreferences={updatePreferences}
                      />
                    )}
                  </ScrollArea>
              )}
            </Suspense>
          </main>
        </SidebarProvider>
      )}
    </div>
  );
}
