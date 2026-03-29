export type AppConfig = {
  gatewayUrl: string;
  gatewayToken: string;
};

export type GatewayConnectionProfile = {
  id: string;
  name: string;
  gatewayUrl: string;
  gatewayToken: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
};

export type HealthCheckResult = {
  ok: boolean;
  status?: number;
  message: string;
};

export type MessageUsage = {
  inputTokens: number;
  outputTokens: number;
  model?: string;
  costUsd?: number;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  meta?: ChatMessageMeta;
  usage?: MessageUsage;
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

export type OutcomePipelineTriggerKind = 'cron' | 'hook';
export type OutcomePipelineStepKind = 'session_spawn' | 'session_send';
export type OutcomePipelineDelivery = 'none' | 'announce' | 'webhook';
export type OutcomePipelineRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export type OutcomePipeline = {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  enabled: boolean;
  triggerKind: OutcomePipelineTriggerKind;
  triggerValue: string;
  sessionTarget: 'main' | 'current' | 'isolated' | 'custom';
  delivery: OutcomePipelineDelivery;
  webhookUrl?: string;
  agentId?: string;
  steps: Array<{
    id: string;
    kind: OutcomePipelineStepKind;
    prompt: string;
    targetSessionKey?: string;
  }>;
  createdAt: number;
  updatedAt: number;
};

export type OutcomePipelineRun = {
  id: string;
  pipelineId: string;
  projectId: string;
  status: OutcomePipelineRunStatus;
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
};

export type OperatorKind = 'research_report';
export type OperatorRunStatus = 'queued' | 'running' | 'needs_approval' | 'completed' | 'failed' | 'canceled';
export type OperatorStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type OperatorStepExecutionMode = 'analysis' | 'gather' | 'synthesis' | 'validation' | 'publish';
export type OperatorModelTier = 'fast' | 'reasoning' | 'verify';

export type OperatorInputSchemaField = {
  key: string;
  label: string;
  type: 'string' | 'enum';
  required: boolean;
  options?: string[];
};

export type OperatorOutputRequirement = {
  key: string;
  label: string;
  type: 'markdown_section' | 'min_links' | 'min_length';
  required: boolean;
  value?: string | number;
};

export type OperatorRoutingPolicy = {
  costAware: boolean;
  fallbackTiers: OperatorModelTier[];
  verifyWithSecondModel: boolean;
};

export type OperatorCompiledStep = {
  id: string;
  key: string;
  label: string;
  mode: OperatorStepExecutionMode;
  modelTier: OperatorModelTier;
  promptTemplate: string;
  validates?: string[];
};

export type OperatorCompiledPlan = {
  operatorId: string;
  projectId: string;
  kind: OperatorKind;
  title: string;
  createdAt: number;
  input: {
    topic: string;
    depth: 'light' | 'standard' | 'deep';
    deliverBy?: string;
  };
  steps: OperatorCompiledStep[];
  successCriteria: string[];
  routingPolicy: OperatorRoutingPolicy;
};

export type OperatorDefinition = {
  id: string;
  projectId: string;
  kind: OperatorKind;
  name: string;
  description?: string;
  enabled: boolean;
  inputSchema: OperatorInputSchemaField[];
  outputRequirements: OperatorOutputRequirement[];
  routingPolicy: OperatorRoutingPolicy;
  successCriteria: string[];
  createdAt: number;
  updatedAt: number;
};

export type OperatorRunStep = {
  id: string;
  key: string;
  label: string;
  status: OperatorStepStatus;
  startedAt?: number;
  finishedAt?: number;
  details?: string;
};

export type OperatorArtifact = {
  id: string;
  runId: string;
  name: string;
  content: string;
  kind: 'markdown' | 'json' | 'text';
  createdAt: number;
};

export type OperatorRun = {
  id: string;
  operatorId: string;
  projectId: string;
  kind: OperatorKind;
  status: OperatorRunStatus;
  compiledPlan?: OperatorCompiledPlan;
  input: {
    topic: string;
    depth: 'light' | 'standard' | 'deep';
    deliverBy?: string;
  };
  steps: OperatorRunStep[];
  summary?: string;
  error?: string;
  artifacts: OperatorArtifact[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
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
  modifiedMs?: number;
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

export type LocalFileRenameResult = {
  oldPath: string;
  newPath: string;
  renamed: boolean;
};

export type LocalFileDeleteResult = {
  path: string;
  deleted: boolean;
};

export type LocalFileStatResult = {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  createdMs: number;
  modifiedMs: number;
};

export type GatewayDiscoveryResult = {
  /** A running gateway was found and responded to a health check. */
  found: boolean;
  /** The WebSocket URL of the discovered gateway (e.g. ws://127.0.0.1:18789). */
  gatewayUrl: string | null;
  /** An OpenClaw binary was found on disk but no gateway is running. */
  binaryFound: boolean;
  /** Filesystem path to the discovered binary, if any. */
  binaryPath: string | null;
  /** Human-readable summary of what was detected. */
  message: string;
};

export type LocalActionType = 'create_file' | 'append_file' | 'read_file' | 'list_dir' | 'exists' | 'rename' | 'delete' | 'shell_exec' | 'web_fetch';

export type LocalActionReceipt = {
  id: string;
  type: LocalActionType;
  path: string;
  status: 'ok' | 'error';
  errorCode?: string;
  message?: string;
};

export type TaskState = 'idle' | 'planned';

export type CoworkProjectTaskStatus =
  | 'queued'
  | 'running'
  | 'needs_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

export type CoworkProjectTask = {
  id: string;
  projectId: string;
  projectTitle: string;
  sessionKey: string;
  runId?: string;
  prompt: string;
  status: CoworkProjectTaskStatus;
  summary?: string;
  outcome?: string;
  createdAt: number;
  updatedAt: number;
};

export type CoworkRunPhase = 'idle' | 'sending' | 'streaming' | 'completed' | 'error';

export type CoworkProgressStage =
  | 'planning'
  | 'decomposition'
  | 'executing_workstreams'
  | 'synthesizing_outputs'
  | 'deliverables';

export type CoworkProgressStepStatus = 'pending' | 'active' | 'completed' | 'blocked';

export type CoworkProgressStep = {
  stage: CoworkProgressStage;
  label: string;
  status: CoworkProgressStepStatus;
  details?: string;
};

export type CoworkArtifact = {
  id: string;
  runId?: string;
  label: string;
  path: string;
  kind: 'file' | 'summary';
  status: 'ok' | 'error';
  source?: 'create_file' | 'append_file' | 'read_file';
  updatedAt: number;
};

export type SafetyRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type SafetyPermissionScope = {
  id: string;
  name: string;
  description: string;
  riskLevel: SafetyRiskLevel;
  enabled: boolean;
  requiresApproval: boolean;
};

export type PendingApprovalAction = {
  id: string;
  runId: string;
  actionId: string;
  actionType: LocalActionType;
  projectId?: string;
  projectTitle?: string;
  projectRootFolder?: string;
  path: string;
  scopeId: string;
  scopeName: string;
  riskLevel: SafetyRiskLevel;
  summary: string;
  preview?: string;
  createdAt: number;
};

export type CoworkProject = {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  workspaceFolder: string;
  contextPaths?: ProjectPathReference[];
  createdAt: number;
  updatedAt: number;
};

export type ProjectKnowledgeItem = {
  id: string;
  projectId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectPathReference = {
  path: string;
  kind: 'file' | 'directory';
  source?: 'project' | 'external';
};

export type MemoryEntry = {
  id: string;
  category: 'about-me' | 'rules' | 'knowledge' | 'reflection';
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type UserPreferences = {
  fullName: string;
  displayName: string;
  role: string;
  responsePreferences: string;
  systemPrompt: string;
  injectMemory: boolean;
  theme: 'light' | 'auto' | 'dark';
  style: 'claude' | 'relay';
  language: 'en' | 'de';
};
