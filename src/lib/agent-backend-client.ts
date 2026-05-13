import type { AppConfig } from '../app-types';
import {
  HermesGatewayClient,
  type GatewayChatMessage,
  type GatewayConnectOptions,
  type GatewayCreateCronJobInput,
  type GatewayCronJob,
  type GatewayModelChoice,
  type GatewaySessionSummary,
  type GatewayToolEntry,
  type GatewayToolsCatalog,
  type GatewayUpdateCronJobInput,
} from './hermes-gateway-client';
import { HermesAcpClient } from './hermes-acp-client';

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

  connect(options: GatewayConnectOptions): Promise<void>;
  disconnect(): void;
  resetDeviceIdentity?(): void;

  getDeviceId?(): Promise<string>;
  getActiveSessionKey(): Promise<string>;
  createChatSession(): Promise<string>;
  createCoworkSession(): Promise<string>;

  sendChat(sessionKey: string, text: string): Promise<{ sessionKey: string }>;
  cancelChat?(sessionKey: string): void;
  resolveSessionKey(preferredKey?: string): Promise<string>;
  getHistory(sessionKey: string, limit?: number): Promise<GatewayChatMessage[]>;

  listModels(): Promise<GatewayModelChoice[]>;
  getSessionModel(sessionKey: string): Promise<string | null>;
  listSessions(limit?: number): Promise<GatewaySessionSummary[]>;
  setSessionModel(sessionKey: string, modelValue: string | null): Promise<void>;
  setSessionTitle(sessionKey: string, title: string | null): Promise<void>;
  deleteSession(sessionKey: string): Promise<void>;

  listCronJobs(): Promise<GatewayCronJob[]>;
  createCronJob(input: GatewayCreateCronJobInput): Promise<string | null>;
  updateCronJob(input: GatewayUpdateCronJobInput): Promise<void>;
  deleteCronJob(idInput: string): Promise<void>;

  fetchToolsCatalog(): Promise<GatewayToolsCatalog>;
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

export type { GatewayToolEntry };

export function createDefaultBackendClient(config?: Pick<AppConfig, 'transport'>): AgentBackendClient {
  const transport = config?.transport ?? 'hermes_acp';
  if (transport === 'hermes_acp') {
    return new HermesAcpClient();
  }
  return new HermesGatewayClient();
}
