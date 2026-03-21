export type AppConfig = {
  gatewayUrl: string;
  gatewayToken: string;
};

export type HealthCheckResult = {
  ok: boolean;
  status?: number;
  message: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
};

export type ChatModelOption = {
  value: string;
  label: string;
};

export type ScheduledJob = {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  state: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export type LocalFilePlanAction = {
  id: string;
  fromPath: string;
  toPath: string;
  category: string;
  operation: 'move' | 'rename';
};

export type LocalFilePlanResult = {
  rootPath: string;
  actions: LocalFilePlanAction[];
};

export type LocalFileApplyResult = {
  applied: number;
  skipped: number;
  errors: string[];
};