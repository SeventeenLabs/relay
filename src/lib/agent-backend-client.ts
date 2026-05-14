import type { AppConfig } from '../app-types';
import {
  HermesHttpClient,
  type HermesChatMessage,
  type HermesConnectOptions,
  type HermesCreateCronJobInput,
  type HermesCronJob,
  type HermesModelChoice,
  type HermesSessionSummary,
  type HermesToolEntry,
  type HermesToolsCatalog,
  type HermesUpdateCronJobInput,
} from './hermes-http-client';

export type LegacyAgentBackendEvent = {
  type: 'res' | 'event';
  event?: string;
  payload?: unknown;
  id?: string;
  ok?: boolean;
  error?: { code?: string; message?: string; details?: unknown };
  seq?: number;
  stateVersion?: Record<string, unknown>;
};

export type BackendTypedEventName = 'chat' | 'run.activity' | 'run.started' | 'run.completed' | 'run.failed';

export type BackendTypedEvent = {
  type: 'typed_event';
  event: BackendTypedEventName;
  payload: Record<string, unknown>;
};

export type AgentBackendEvent = LegacyAgentBackendEvent | BackendTypedEvent;

export function isTypedBackendEvent(event: AgentBackendEvent): event is BackendTypedEvent {
  return event.type === 'typed_event';
}

export function isLegacyBackendEvent(event: AgentBackendEvent): event is LegacyAgentBackendEvent {
  return event.type === 'event' || event.type === 'res';
}

export interface AgentBackendClient {
  setEventHandler(handler: (event: AgentBackendEvent) => void): void;
  setConnectionHandler(handler: (connected: boolean, message: string) => void): void;
  isConnected(): boolean;

  connect(options: HermesConnectOptions): Promise<void>;
  disconnect(): void;
  resetDeviceIdentity?(): void;

  getDeviceId?(): Promise<string>;
  getActiveSessionKey(): Promise<string>;
  createChatSession(): Promise<string>;
  createCoworkSession(): Promise<string>;

  sendChat(sessionKey: string, text: string): Promise<{ sessionKey: string }>;
  cancelChat?(sessionKey: string): void;
  resolveSessionKey(preferredKey?: string): Promise<string>;
  getHistory(sessionKey: string, limit?: number): Promise<HermesChatMessage[]>;

  listModels(): Promise<HermesModelChoice[]>;
  getSessionModel(sessionKey: string): Promise<string | null>;
  listSessions(limit?: number): Promise<HermesSessionSummary[]>;
  setSessionModel(sessionKey: string, modelValue: string | null): Promise<void>;
  setSessionTitle(sessionKey: string, title: string | null): Promise<void>;
  deleteSession(sessionKey: string): Promise<void>;

  listCronJobs(): Promise<HermesCronJob[]>;
  createCronJob(input: HermesCreateCronJobInput): Promise<string | null>;
  updateCronJob(input: HermesUpdateCronJobInput): Promise<void>;
  deleteCronJob(idInput: string): Promise<void>;

  fetchToolsCatalog(): Promise<HermesToolsCatalog>;
  listWorkspaceFiles(relativePath?: string): Promise<{
    items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>;
    truncated: boolean;
  }>;
  readWorkspaceFile(relativePath: string): Promise<{ content: string }>;
  statWorkspaceFile(relativePath: string): Promise<{
    kind: 'file' | 'directory';
    size: number;
    createdMs: number;
    modifiedMs: number;
  }>;
  renameWorkspaceFile(oldPath: string, newPath: string): Promise<void>;
  deleteWorkspaceFile(path: string): Promise<void>;
  writeWorkspaceFile(path: string, content: string): Promise<void>;
}

export type { HermesToolEntry };

export function createDefaultBackendClient(config?: Pick<AppConfig, 'transport'>): AgentBackendClient {
  const transport = config?.transport ?? 'hermes_http';
  void transport;
  return new HermesHttpClient();
}

