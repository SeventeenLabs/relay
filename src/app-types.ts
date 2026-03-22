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
  meta?: ChatMessageMeta;
};

export type ChatActivityTone = 'neutral' | 'success' | 'danger';

export type ChatActivityItem = {
  id: string;
  label: string;
  details?: string;
  tone: ChatActivityTone;
};

export type ChatMessageMeta =
  | {
      kind: 'activity';
      items: ChatActivityItem[];
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

export type LocalFileCreateResult = {
  filePath: string;
  created: boolean;
};

export type LocalFileReadResult = {
  filePath: string;
  content: string;
};

export type LocalFileAppendResult = {
  filePath: string;
  appended: boolean;
  bytesAppended: number;
};

export type LocalFileListItem = {
  path: string;
  kind: 'file' | 'directory';
  size?: number;
};

export type LocalFileListResult = {
  rootPath: string;
  items: LocalFileListItem[];
  truncated: boolean;
};

export type LocalFileExistsResult = {
  path: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'none';
};

export type LocalActionType = 'create_file' | 'append_file' | 'read_file' | 'list_dir' | 'exists';

export type LocalActionReceipt = {
  id: string;
  type: LocalActionType;
  path: string;
  status: 'ok' | 'error';
  errorCode?: string;
  message?: string;
};