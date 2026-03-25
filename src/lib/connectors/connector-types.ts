import type { SafetyRiskLevel } from '@/app-types';

/* ── Connector system types ──────────────────────────────────────────────── */

export type ConnectorStatus = 'active' | 'inactive' | 'error';

export type ConnectorActionParam = {
  name: string;
  description: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
};

export type ConnectorAction = {
  /** Fully-qualified action name, e.g. `filesystem.read_file`, `shell.exec` */
  id: string;
  name: string;
  description: string;
  /** Safety scope that governs this action */
  scopeId: string;
  riskLevel: SafetyRiskLevel;
  params: ConnectorActionParam[];
};

export type ConnectorConfig = Record<string, unknown>;

export type ConnectorDefinition = {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: ConnectorStatus;
  /** Runtime configuration — e.g. allowed domains, timeout values */
  config: ConnectorConfig;
  actions: ConnectorAction[];
  /** Test connectivity / readiness */
  test: () => Promise<{ ok: boolean; message: string }>;
  /** Execute an action by id */
  execute: (
    actionId: string,
    params: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ) => Promise<ConnectorActionResult>;
};

export type ConnectorExecutionContext = {
  rootPath: string;
  bridge: BridgeApi;
};

export type ConnectorActionResult = {
  ok: boolean;
  data?: unknown;
  message?: string;
  errorCode?: string;
};

/** Minimal bridge API surface connectors need (subset of window.relay) */
export type BridgeApi = {
  createFileInFolder?: (root: string, rel: string, content: string, overwrite?: boolean) => Promise<unknown>;
  appendFileInFolder?: (root: string, rel: string, content: string) => Promise<unknown>;
  readFileInFolder?: (root: string, rel: string) => Promise<unknown>;
  listDirInFolder?: (root: string, rel?: string) => Promise<unknown>;
  existsInFolder?: (root: string, rel: string) => Promise<unknown>;
  renameInFolder?: (root: string, old: string, newRel: string) => Promise<unknown>;
  deleteInFolder?: (root: string, rel: string) => Promise<unknown>;
  statInFolder?: (root: string, rel: string) => Promise<unknown>;
  shellExec?: (root: string, command: string, timeoutMs?: number) => Promise<unknown>;
  webFetch?: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<unknown>;
};
