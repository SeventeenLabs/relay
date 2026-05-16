import type {
  AgentBackendEvent,
  BackendTypedEventName,
  HermesKanbanTask,
  HermesKanbanTaskDetail,
} from './agent-backend-client';
import type {
  HermesChatMessage,
  HermesConnectOptions,
  HermesCreateCronJobInput,
  HermesCronJob,
  HermesModelChoice,
  HermesSessionSummary,
  HermesToolsCatalog,
  HermesUpdateCronJobInput,
} from './hermes-http-client';
import { HermesRequestError } from './hermes-http-client';

type StoredSession = {
  key: string;
  kind: 'chat' | 'cowork' | 'main';
  title?: string;
  model?: string | null;
  history: HermesChatMessage[];
};

type DaemonEnvelope = {
  type?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

type RunBuffer = {
  runId: string;
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
};

const HERMES_CLIENT_LOG_PREFIX = '[Relay:RelayDaemonClient]';

export class RelayDaemonClient {
  private connected = false;
  private baseUrl: string | null = null;
  private token: string | null = null;
  private onEventHandler: ((event: AgentBackendEvent) => void) | null = null;
  private onConnectionHandler: ((connected: boolean, message: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private sessions = new Map<string, StoredSession>();
  private activeSessionId: string | null = null;
  private workspaceKey: string | null = null;
  private runBuffers = new Map<string, RunBuffer>();

  private log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
    const payload = meta ? { ...meta } : undefined;
    if (level === 'error') {
      console.error(HERMES_CLIENT_LOG_PREFIX, message, payload ?? '');
      return;
    }
    if (level === 'warn') {
      console.warn(HERMES_CLIENT_LOG_PREFIX, message, payload ?? '');
      return;
    }
    console.info(HERMES_CLIENT_LOG_PREFIX, message, payload ?? '');
  }

  private normalizeBaseUrl(input: string): string {
    const trimmed = (input ?? '').trim();
    if (!trimmed) {
      throw new Error('Relay daemon endpoint is required.');
    }
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(withProtocol);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path.endsWith('/v1')) {
      parsed.pathname = path.slice(0, -3) || '/';
    } else {
      parsed.pathname = path || '/';
    }
    return parsed.toString().replace(/\/$/, '');
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    if (!this.baseUrl) {
      throw new Error('Relay daemon client is not connected.');
    }
    const headers = new Headers(init?.headers ?? {});
    headers.set('Content-Type', 'application/json');
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    let response: Response;
    const relayBridge = (window as Window & { relay?: { backendHttpRequest?: (payload: { baseUrl: string; path: string; method?: string; token?: string; body?: string }) => Promise<{ ok: boolean; status: number; statusText: string; body: string }> } }).relay;
    if (relayBridge?.backendHttpRequest) {
      const result = await relayBridge.backendHttpRequest({
        baseUrl: this.baseUrl,
        path,
        method: init?.method ?? 'GET',
        token: this.token ?? undefined,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      response = new Response(result.body, { status: result.status, statusText: result.statusText });
    } else {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    }

    if (!response.ok) {
      let message = `Relay daemon request failed (${response.status}).`;
      try {
        const json = await response.json() as { error?: { message?: string } };
        if (typeof json?.error?.message === 'string' && json.error.message.trim()) {
          message = json.error.message.trim();
        }
      } catch {
        // ignore parse errors
      }
      throw new HermesRequestError(message, String(response.status));
    }

    return response;
  }

  private ensureSession(key: string, kind: 'chat' | 'cowork' | 'main' = 'chat'): StoredSession {
    const normalized = key.trim();
    const existing = this.sessions.get(normalized);
    if (existing) {
      return existing;
    }
    const created: StoredSession = { key: normalized, kind, history: [] };
    this.sessions.set(normalized, created);
    return created;
  }

  private parseKanbanTaskRecord(record: unknown): HermesKanbanTask | null {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const row = record as Record<string, unknown>;
    const id = typeof row.id === 'string'
      ? row.id.trim()
      : typeof row.task_id === 'string'
        ? row.task_id.trim()
        : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!id || !title) {
      return null;
    }
    const status = typeof row.status === 'string' ? row.status.trim() : 'todo';
    const assignee = typeof row.assignee === 'string' ? row.assignee.trim() : '';
    const tenant = typeof row.tenant === 'string' ? row.tenant.trim() : '';
    const updatedAt = typeof row.updated_at === 'string'
      ? row.updated_at.trim()
      : typeof row.updatedAt === 'string'
        ? row.updatedAt.trim()
        : '';
    return {
      id,
      title,
      status,
      assignee: assignee || undefined,
      tenant: tenant || undefined,
      updatedAt: updatedAt || undefined,
    };
  }

  private parseKanbanCommentRecord(record: unknown): { author?: string; text: string; createdAt?: string } | null {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const row = record as Record<string, unknown>;
    const text = typeof row.body === 'string'
      ? row.body.trim()
      : typeof row.text === 'string'
        ? row.text.trim()
        : '';
    if (!text) {
      return null;
    }
    const author = typeof row.author === 'string' ? row.author.trim() : '';
    const createdAt = typeof row.created_at === 'string'
      ? row.created_at.trim()
      : typeof row.createdAt === 'string'
        ? row.createdAt.trim()
        : '';
    return {
      author: author || undefined,
      text,
      createdAt: createdAt || undefined,
    };
  }

  private async getWorkspaceSessionId(): Promise<string> {
    if (this.activeSessionId) {
      return this.activeSessionId;
    }
    return this.createChatSession();
  }

  private buildQuery(pathname: string, params: Record<string, string | undefined>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.trim()) {
        query.set(key, value.trim());
      }
    }
    const suffix = query.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return response.json() as Promise<T>;
  }

  private normalizeCronJob(row: Record<string, unknown>): HermesCronJob | null {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) {
      return null;
    }
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
    const schedule = typeof row.schedule === 'string' && row.schedule.trim() ? row.schedule.trim() : 'unknown';
    const enabled = Boolean(row.enabled);
    const state = typeof row.state === 'string' && row.state.trim() ? row.state.trim() : enabled ? 'enabled' : 'paused';
    const nextRunAt = typeof row.nextRunAt === 'string' ? row.nextRunAt : null;
    const lastRunAt = typeof row.lastRunAt === 'string' ? row.lastRunAt : null;
    return {
      id,
      name,
      schedule,
      enabled,
      state,
      nextRunAt,
      lastRunAt,
    };
  }

  private normalizeModelChoice(entry: unknown): HermesModelChoice | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const row = entry as Record<string, unknown>;
    const value = typeof row.id === 'string' ? row.id.trim() : '';
    if (!value) {
      return null;
    }
    return {
      value,
      label: value,
    };
  }

  private normalizeWorkspaceFileKind(kind: unknown): 'file' | 'directory' {
    return typeof kind === 'string' && kind.toLowerCase() === 'directory' ? 'directory' : 'file';
  }

  private normalizeWorkspaceFileStat(raw: unknown): { kind: 'file' | 'directory'; size: number; createdMs: number; modifiedMs: number } {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      kind: this.normalizeWorkspaceFileKind(row.kind),
      size: typeof row.size === 'number' ? row.size : 0,
      createdMs: typeof row.createdMs === 'number' ? row.createdMs : 0,
      modifiedMs: typeof row.modifiedMs === 'number' ? row.modifiedMs : 0,
    };
  }

  private normalizeWorkspaceFileList(rawItems: unknown): Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }> {
    if (!Array.isArray(rawItems)) {
      return [];
    }
    const rows: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }> = [];
    for (const entry of rawItems) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const filePath = typeof row.path === 'string' ? row.path.trim() : '';
      if (!filePath) {
        continue;
      }
      rows.push({
        path: filePath,
        kind: this.normalizeWorkspaceFileKind(row.kind),
        size: typeof row.size === 'number' ? row.size : undefined,
        modifiedMs: typeof row.modifiedMs === 'number' ? row.modifiedMs : undefined,
      });
    }
    return rows;
  }

  private normalizeKanbanTaskList(raw: unknown): HermesKanbanTask[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => this.parseKanbanTaskRecord(entry))
      .filter((entry): entry is HermesKanbanTask => entry !== null);
  }

  private normalizeKanbanTaskDetail(raw: unknown): HermesKanbanTaskDetail | null {
    const task = this.parseKanbanTaskRecord(raw);
    if (!task) {
      return null;
    }
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const body = typeof row.body === 'string' ? row.body : undefined;
    const commentsRaw = Array.isArray(row.comments) ? row.comments : [];
    const comments = commentsRaw
      .map((entry) => this.parseKanbanCommentRecord(entry))
      .filter((entry): entry is { author?: string; text: string; createdAt?: string } => entry !== null);
    return {
      ...task,
      body,
      comments,
    };
  }

  private parseKanbanCreateResponse(raw: unknown): string {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = typeof row.id === 'string'
      ? row.id.trim()
      : typeof row.task_id === 'string'
        ? row.task_id.trim()
        : '';
    if (!id) {
      throw new HermesRequestError('Kanban create did not return a task id.', 'kanban_invalid_response');
    }
    return id;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Relay daemon client is not connected.');
    }
  }

  private ensureSessionExists(sessionId: string): StoredSession {
    const key = sessionId.trim();
    if (!key) {
      throw new Error('Session key is required.');
    }
    return this.ensureSession(key);
  }

  private updateSessionModel(sessionId: string, modelValue: string | null): void {
    const session = this.ensureSessionExists(sessionId);
    session.model = modelValue?.trim() || null;
  }

  private getSessionModelValue(sessionId: string): string | null {
    const session = this.sessions.get(sessionId.trim());
    return session?.model ?? null;
  }

  private normalizeSessionListEntry(entry: unknown): HermesSessionSummary | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const row = entry as Record<string, unknown>;
    const key = typeof row.id === 'string' ? row.id.trim() : '';
    if (!key) {
      return null;
    }
    const status = typeof row.status === 'string' ? row.status.trim() : 'chat';
    const title = typeof row.label === 'string' ? row.label.trim() : key;
    return {
      key,
      kind: status || 'chat',
      title,
    };
  }

  private normalizeModelList(raw: unknown): HermesModelChoice[] {
    if (!raw || typeof raw !== 'object') {
      return [];
    }
    const data = (raw as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((entry) => this.normalizeModelChoice(entry))
      .filter((entry): entry is HermesModelChoice => entry !== null);
  }

  private normalizeCronList(raw: unknown): HermesCronJob[] {
    if (!raw || typeof raw !== 'object') {
      return [];
    }
    const jobs = (raw as { jobs?: unknown }).jobs;
    if (!Array.isArray(jobs)) {
      return [];
    }
    return jobs
      .map((entry) => this.normalizeCronJob((entry as Record<string, unknown>) ?? {}))
      .filter((entry): entry is HermesCronJob => entry !== null);
  }

  private normalizeSessions(raw: unknown, limit: number): HermesSessionSummary[] {
    if (!raw || typeof raw !== 'object') {
      return [];
    }
    const sessions = (raw as { sessions?: unknown }).sessions;
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions
      .map((entry) => this.normalizeSessionListEntry(entry))
      .filter((entry): entry is HermesSessionSummary => entry !== null)
      .slice(0, Math.max(1, limit));
  }

  private normalizeWorkspaceListResponse(raw: unknown): { items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>; truncated: boolean } {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      items: this.normalizeWorkspaceFileList(row.items),
      truncated: Boolean(row.truncated),
    };
  }

  private normalizeWorkspaceReadResponse(raw: unknown): { content: string } {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      content: typeof row.content === 'string' ? row.content : '',
    };
  }

  private normalizeKanbanTaskListResponse(raw: unknown): HermesKanbanTask[] {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return this.normalizeKanbanTaskList(row.tasks);
  }

  private normalizeKanbanTaskResponse(raw: unknown): HermesKanbanTaskDetail | null {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return this.normalizeKanbanTaskDetail(row.task);
  }

  private normalizeKanbanCreateResponse(raw: unknown): string {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return this.parseKanbanCreateResponse(row);
  }

  private normalizeCronCreateResponse(raw: unknown): string | null {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    return id || null;
  }

  private normalizeOkResponse(raw: unknown): boolean {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return Boolean(row.ok);
  }

  private resolveRootPath(rootPath?: string): string | undefined {
    const normalized = rootPath?.trim();
    return normalized || undefined;
  }

  private async parseResponseJson(path: string, init?: RequestInit): Promise<unknown> {
    try {
      return await this.requestJson<unknown>(path, init);
    } catch (error) {
      if (error instanceof HermesRequestError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new HermesRequestError(message || 'Relay daemon request failed.', 'request_failed');
    }
  }

  private normalizeCronUpdatePayload(input: HermesUpdateCronJobInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (typeof input.name === 'string') payload.name = input.name;
    if (typeof input.schedule === 'string') payload.schedule = input.schedule;
    if (typeof input.prompt === 'string') payload.prompt = input.prompt;
    if (typeof input.enabled === 'boolean') payload.enabled = input.enabled;
    return payload;
  }

  private normalizeCronCreatePayload(input: HermesCreateCronJobInput): Record<string, unknown> {
    return {
      name: input.name,
      schedule: input.schedule,
      prompt: input.prompt,
      enabled: input.enabled,
    };
  }

  private normalizeKanbanCreatePayload(input: { title: string; body?: string; assignee?: string; tenant?: string; rootPath?: string }): Record<string, unknown> {
    return {
      title: input.title,
      body: input.body,
      assignee: input.assignee,
      tenant: input.tenant,
      rootPath: input.rootPath,
    };
  }

  private normalizeKanbanCommentPayload(text: string, rootPath?: string): Record<string, unknown> {
    return {
      text,
      rootPath,
    };
  }

  private normalizeWorkspaceWritePayload(path: string, content: string): Record<string, unknown> {
    return { path, content };
  }

  private normalizeWorkspaceRenamePayload(oldPath: string, newPath: string): Record<string, unknown> {
    return { oldPath, newPath };
  }

  private normalizeWorkspaceDeletePayload(path: string): Record<string, unknown> {
    return { path };
  }

  private normalizeWorkspacePath(path: string): string {
    return path.trim();
  }

  private normalizeKanbanTaskId(taskId: string): string {
    return taskId.trim();
  }

  private normalizeCronId(id: string): string {
    return id.trim();
  }

  private normalizeCommentText(text: string): string {
    return text.trim();
  }

  private normalizeSessionId(sessionId: string): string {
    return sessionId.trim();
  }

  private normalizeSchedule(value: string): string {
    return value.trim();
  }

  private normalizeName(value: string): string {
    return value.trim();
  }

  private normalizePrompt(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private normalizeRootPath(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private normalizeTaskTitle(value: string): string {
    return value.trim();
  }

  private normalizeOptionalText(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private normalizeOptionalBool(value?: boolean): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private normalizeSessionQuery(sessionId: string): string {
    return encodeURIComponent(sessionId.trim());
  }

  private ensureNonEmpty(value: string, label: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new HermesRequestError(`${label} is required.`, 'invalid_request');
    }
    return trimmed;
  }

  private normalizeLimit(limit: number): number {
    return Math.max(1, limit);
  }

  private normalizeTasksInput(input?: { assignee?: string; status?: string; tenant?: string; archived?: boolean; rootPath?: string }): Record<string, string | undefined> {
    return {
      assignee: input?.assignee,
      status: input?.status,
      tenant: input?.tenant,
      archived: input?.archived ? 'true' : undefined,
      rootPath: input?.rootPath,
    };
  }

  private normalizeTaskDetailInput(input?: { rootPath?: string }): Record<string, string | undefined> {
    return {
      rootPath: input?.rootPath,
    };
  }

  private normalizeTaskCommentInput(input?: { rootPath?: string }): string | undefined {
    return input?.rootPath?.trim() || undefined;
  }

  private normalizeWorkspaceInput(relativePath?: string): string | undefined {
    return relativePath?.trim() || undefined;
  }

  private normalizeWorkspaceReadPath(relativePath: string): string {
    return this.ensureNonEmpty(relativePath, 'Workspace path');
  }

  private normalizeWorkspaceRenamePath(pathValue: string, label: string): string {
    return this.ensureNonEmpty(pathValue, label);
  }

  private normalizeDeletePath(pathValue: string): string {
    return this.ensureNonEmpty(pathValue, 'Workspace path');
  }

  private normalizeWritePath(pathValue: string): string {
    return this.ensureNonEmpty(pathValue, 'Workspace path');
  }

  private normalizeCronInputId(id: string): string {
    return this.ensureNonEmpty(id, 'Cron job id');
  }

  private normalizeTaskIdInput(taskId: string): string {
    return this.ensureNonEmpty(taskId, 'Kanban task id');
  }

  private normalizeCommentInput(text: string): string {
    return this.ensureNonEmpty(text, 'Kanban comment text');
  }

  private normalizeCronName(name: string): string {
    return this.ensureNonEmpty(name, 'Cron name');
  }

  private normalizeCronSchedule(schedule: string): string {
    return this.ensureNonEmpty(schedule, 'Cron schedule');
  }

  private normalizeKanbanTitle(title: string): string {
    return this.ensureNonEmpty(title, 'Kanban task title');
  }

  private normalizeWorkspaceSession(sessionId: string): string {
    return this.ensureNonEmpty(sessionId, 'Session id');
  }

  private normalizeSessionKey(sessionKey: string): string {
    return this.ensureNonEmpty(sessionKey, 'Session key');
  }

  private ensureConnectedSession(sessionKey: string): string {
    this.ensureConnected();
    return this.normalizeSessionKey(sessionKey);
  }

  private normalizeModelValue(value: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed || null;
  }

  private ensureCronUpdateId(input: HermesUpdateCronJobInput): string {
    return this.normalizeCronInputId(input.id);
  }

  private ensureCronCreateName(input: HermesCreateCronJobInput): string {
    return this.normalizeCronName(input.name);
  }

  private ensureCronCreateSchedule(input: HermesCreateCronJobInput): string {
    return this.normalizeCronSchedule(input.schedule);
  }

  private ensureKanbanCreateTitle(input: { title: string }): string {
    return this.normalizeKanbanTitle(input.title);
  }

  private ensureWorkspaceSessionId(sessionId: string): string {
    return this.normalizeWorkspaceSession(sessionId);
  }

  private ensureRootPath(rootPath?: string): string | undefined {
    return this.normalizeRootPath(rootPath);
  }

  private ensureOptionalText(value?: string): string | undefined {
    return this.normalizeOptionalText(value);
  }

  private ensureOptionalBool(value?: boolean): boolean | undefined {
    return this.normalizeOptionalBool(value);
  }

  private ensureModelSession(sessionKey: string): string {
    return this.normalizeSessionKey(sessionKey);
  }

  private ensureLimit(limit: number): number {
    return this.normalizeLimit(limit);
  }

  private ensureCronDeleteId(idInput: string): string {
    return this.normalizeCronInputId(idInput);
  }

  private ensureKanbanTaskId(taskId: string): string {
    return this.normalizeTaskIdInput(taskId);
  }

  private ensureKanbanCommentText(text: string): string {
    return this.normalizeCommentInput(text);
  }

  private ensureWorkspaceReadPath(pathValue: string): string {
    return this.normalizeWorkspaceReadPath(pathValue);
  }

  private ensureWorkspaceWritePath(pathValue: string): string {
    return this.normalizeWritePath(pathValue);
  }

  private ensureWorkspaceDeletePath(pathValue: string): string {
    return this.normalizeDeletePath(pathValue);
  }

  private ensureWorkspaceRenameOldPath(pathValue: string): string {
    return this.normalizeWorkspaceRenamePath(pathValue, 'Workspace oldPath');
  }

  private ensureWorkspaceRenameNewPath(pathValue: string): string {
    return this.normalizeWorkspaceRenamePath(pathValue, 'Workspace newPath');
  }

  private ensureSessionForModel(sessionKey: string): string {
    return this.ensureModelSession(sessionKey);
  }

  private ensureSessionForHistory(sessionKey: string): string {
    return this.normalizeSessionKey(sessionKey);
  }

  private ensureSessionForDelete(sessionKey: string): string {
    return this.normalizeSessionKey(sessionKey);
  }

  private ensureSessionForTitle(sessionKey: string): string {
    return this.normalizeSessionKey(sessionKey);
  }

  private ensureSessionForSend(sessionKey: string): string {
    return this.ensureConnectedSession(sessionKey);
  }

  private ensureSessionForResolve(preferredKey: string): string {
    return preferredKey.trim();
  }

  private ensurePreferredSession(preferredKey: string): string {
    return this.ensureSessionForResolve(preferredKey);
  }

  private ensureSessionForWorkspace(sessionId: string): string {
    return this.ensureWorkspaceSessionId(sessionId);
  }

  private ensureSessionExistsAndConnected(sessionKey: string): string {
    return this.ensureSessionForSend(sessionKey);
  }

  private ensureCronPayload(input: HermesCreateCronJobInput): Record<string, unknown> {
    return this.normalizeCronCreatePayload({
      ...input,
      name: this.ensureCronCreateName(input),
      schedule: this.ensureCronCreateSchedule(input),
      prompt: input.prompt,
      enabled: this.ensureOptionalBool(input.enabled),
    });
  }

  private ensureCronUpdatePayload(input: HermesUpdateCronJobInput): { id: string; payload: Record<string, unknown> } {
    const id = this.ensureCronUpdateId(input);
    const payload = this.normalizeCronUpdatePayload({
      ...input,
      name: this.normalizeOptionalText(input.name),
      schedule: this.normalizeOptionalText(input.schedule),
      prompt: this.normalizeOptionalText(input.prompt),
      enabled: this.ensureOptionalBool(input.enabled),
    });
    return { id, payload };
  }

  private ensureKanbanCreatePayload(input: { title: string; body?: string; assignee?: string; tenant?: string; rootPath?: string }): Record<string, unknown> {
    return this.normalizeKanbanCreatePayload({
      ...input,
      title: this.ensureKanbanCreateTitle(input),
      body: this.ensureOptionalText(input.body),
      assignee: this.ensureOptionalText(input.assignee),
      tenant: this.ensureOptionalText(input.tenant),
      rootPath: this.ensureRootPath(input.rootPath),
    });
  }

  private ensureKanbanCommentPayload(text: string, rootPath?: string): Record<string, unknown> {
    return this.normalizeKanbanCommentPayload(this.ensureKanbanCommentText(text), this.ensureRootPath(rootPath));
  }

  private ensureWorkspaceWritePayload(path: string, content: string): Record<string, unknown> {
    return this.normalizeWorkspaceWritePayload(this.ensureWorkspaceWritePath(path), content);
  }

  private ensureWorkspaceRenamePayload(oldPath: string, newPath: string): Record<string, unknown> {
    return this.normalizeWorkspaceRenamePayload(this.ensureWorkspaceRenameOldPath(oldPath), this.ensureWorkspaceRenameNewPath(newPath));
  }

  private ensureWorkspaceDeletePayload(path: string): Record<string, unknown> {
    return this.normalizeWorkspaceDeletePayload(this.ensureWorkspaceDeletePath(path));
  }

  private async requestWorkspaceJson(path: string, init?: RequestInit): Promise<unknown> {
    const sessionId = await this.getWorkspaceSessionId();
    const normalizedSession = this.ensureSessionForWorkspace(sessionId);
    const normalizedPath = path.replace(':sessionId', encodeURIComponent(normalizedSession));
    return this.parseResponseJson(normalizedPath, init);
  }

  private async requestDaemonJson(path: string, init?: RequestInit): Promise<unknown> {
    return this.parseResponseJson(path, init);
  }

  private createJsonBody(payload: Record<string, unknown>): string {
    return JSON.stringify(payload);
  }

  private ensureWorkspaceTargetPath(relativePath: string): string {
    return this.ensureWorkspaceReadPath(relativePath);
  }

  private ensureWorkspaceRelativePath(relativePath?: string): string | undefined {
    return this.normalizeWorkspaceInput(relativePath);
  }

  private ensureTaskRootPath(rootPath?: string): string | undefined {
    return this.ensureRootPath(rootPath);
  }

  private ensureTasksInput(input?: { assignee?: string; status?: string; tenant?: string; archived?: boolean; rootPath?: string }): Record<string, string | undefined> {
    return this.normalizeTasksInput({
      assignee: this.ensureOptionalText(input?.assignee),
      status: this.ensureOptionalText(input?.status),
      tenant: this.ensureOptionalText(input?.tenant),
      archived: this.ensureOptionalBool(input?.archived),
      rootPath: this.ensureTaskRootPath(input?.rootPath),
    });
  }

  private ensureTaskDetailInput(input?: { rootPath?: string }): Record<string, string | undefined> {
    return this.normalizeTaskDetailInput({
      rootPath: this.ensureTaskRootPath(input?.rootPath),
    });
  }

  private ensureTaskCommentRoot(input?: { rootPath?: string }): string | undefined {
    return this.normalizeTaskCommentInput({ rootPath: this.ensureTaskRootPath(input?.rootPath) });
  }

  private ensureModelSessionKey(sessionKey: string): string {
    return this.ensureSessionForModel(sessionKey);
  }

  private ensureHistorySessionKey(sessionKey: string): string {
    return this.ensureSessionForHistory(sessionKey);
  }

  private ensureDeleteSessionKey(sessionKey: string): string {
    return this.ensureSessionForDelete(sessionKey);
  }

  private ensureTitleSessionKey(sessionKey: string): string {
    return this.ensureSessionForTitle(sessionKey);
  }

  private ensureSendSessionKey(sessionKey: string): string {
    return this.ensureSessionExistsAndConnected(sessionKey);
  }

  private ensureResolvePreferredKey(preferredKey: string): string {
    return this.ensurePreferredSession(preferredKey);
  }

  private ensureWorkspaceListPath(relativePath?: string): string | undefined {
    return this.ensureWorkspaceRelativePath(relativePath);
  }

  private ensureStatPath(relativePath: string): string {
    return this.ensureWorkspaceTargetPath(relativePath);
  }

  private ensureReadPath(relativePath: string): string {
    return this.ensureWorkspaceTargetPath(relativePath);
  }

  private ensureWritePath(path: string): string {
    return this.ensureWorkspaceWritePath(path);
  }

  private ensureDeletePath(path: string): string {
    return this.ensureWorkspaceDeletePath(path);
  }

  private ensureRenameOldPath(path: string): string {
    return this.ensureWorkspaceRenameOldPath(path);
  }

  private ensureRenameNewPath(path: string): string {
    return this.ensureWorkspaceRenameNewPath(path);
  }

  private ensureCronListPath(): string {
    return '/v1/cron/jobs';
  }

  private ensureKanbanListPath(): string {
    return '/v1/kanban/tasks';
  }

  private ensureKanbanTaskPath(taskId: string): string {
    return `/v1/kanban/tasks/${encodeURIComponent(this.ensureKanbanTaskId(taskId))}`;
  }

  private ensureKanbanCommentPath(taskId: string): string {
    return `${this.ensureKanbanTaskPath(taskId)}/comment`;
  }

  private ensureCronJobPath(id: string): string {
    return `/v1/cron/jobs/${encodeURIComponent(this.normalizeCronInputId(id))}`;
  }

  private ensureWorkspaceListEndpoint(sessionIdPlaceholder = ':sessionId'): string {
    return `/v1/sessions/${sessionIdPlaceholder}/workspace/list`;
  }

  private ensureWorkspaceReadEndpoint(sessionIdPlaceholder = ':sessionId'): string {
    return `/v1/sessions/${sessionIdPlaceholder}/workspace/read`;
  }

  private ensureWorkspaceStatEndpoint(sessionIdPlaceholder = ':sessionId'): string {
    return `/v1/sessions/${sessionIdPlaceholder}/workspace/stat`;
  }

  private ensureWorkspaceWriteEndpoint(sessionIdPlaceholder = ':sessionId'): string {
    return `/v1/sessions/${sessionIdPlaceholder}/workspace/write`;
  }

  private ensureWorkspaceRenameEndpoint(sessionIdPlaceholder = ':sessionId'): string {
    return `/v1/sessions/${sessionIdPlaceholder}/workspace/rename`;
  }

  private ensureWorkspaceDeleteEndpoint(sessionIdPlaceholder = ':sessionId'): string {
    return `/v1/sessions/${sessionIdPlaceholder}/workspace/delete`;
  }

  private ensureModelsEndpoint(): string {
    return '/v1/models';
  }

  private ensureSessionsEndpoint(): string {
    return '/v1/sessions';
  }

  private ensureDeleteSessionEndpoint(sessionKey: string): string {
    return `/v1/sessions/${encodeURIComponent(this.ensureDeleteSessionKey(sessionKey))}`;
  }

  private ensureSendInputEndpoint(sessionKey: string): string {
    return `/v1/sessions/${encodeURIComponent(this.ensureSendSessionKey(sessionKey))}/input`;
  }

  private ensureSessionModelStorage(sessionKey: string, modelValue: string | null): void {
    this.updateSessionModel(this.ensureModelSessionKey(sessionKey), this.normalizeModelValue(modelValue));
  }

  private ensureSessionModelFetch(sessionKey: string): string | null {
    return this.getSessionModelValue(this.ensureModelSessionKey(sessionKey));
  }

  private ensureMainModelFallback(choices: HermesModelChoice[]): string | null {
    return choices[0]?.value ?? null;
  }

  private ensureSessionHistory(sessionKey: string, limit: number): HermesChatMessage[] {
    const session = this.sessions.get(this.ensureHistorySessionKey(sessionKey));
    if (!session) {
      return [];
    }
    return session.history.slice(-this.ensureLimit(limit));
  }

  private ensureSessionTitle(sessionKey: string, title: string | null): void {
    const session = this.ensureSession(this.ensureTitleSessionKey(sessionKey), 'chat');
    session.title = title?.trim() || undefined;
  }

  private ensureSessionDeleteLocal(sessionKey: string): void {
    const key = this.ensureDeleteSessionKey(sessionKey);
    this.sessions.delete(key);
    if (this.activeSessionId === key) {
      this.activeSessionId = null;
    }
  }

  private ensureKanbanDetailResponse(raw: unknown): HermesKanbanTaskDetail | null {
    return this.normalizeKanbanTaskResponse(raw);
  }

  private ensureKanbanListResponse(raw: unknown): HermesKanbanTask[] {
    return this.normalizeKanbanTaskListResponse(raw);
  }

  private ensureKanbanCreateId(raw: unknown): string {
    return this.normalizeKanbanCreateResponse(raw);
  }

  private ensureCronListResponse(raw: unknown): HermesCronJob[] {
    return this.normalizeCronList(raw);
  }

  private ensureModelListResponse(raw: unknown): HermesModelChoice[] {
    return this.normalizeModelList(raw);
  }

  private ensureSessionListResponse(raw: unknown, limit: number): HermesSessionSummary[] {
    return this.normalizeSessions(raw, limit);
  }

  private ensureWorkspaceListResponse(raw: unknown): { items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>; truncated: boolean } {
    return this.normalizeWorkspaceListResponse(raw);
  }

  private ensureWorkspaceReadResponse(raw: unknown): { content: string } {
    return this.normalizeWorkspaceReadResponse(raw);
  }

  private ensureWorkspaceStatResponse(raw: unknown): { kind: 'file' | 'directory'; size: number; createdMs: number; modifiedMs: number } {
    return this.normalizeWorkspaceFileStat(raw);
  }

  private ensureOk(raw: unknown): boolean {
    return this.normalizeOkResponse(raw);
  }

  private ensureCronCreateId(raw: unknown): string | null {
    return this.normalizeCronCreateResponse(raw);
  }

  private emitTypedEvent(event: BackendTypedEventName, payload: Record<string, unknown>): void {
    this.onEventHandler?.({ type: 'typed_event', event, payload });
  }

  private emitChatEvent(sessionKey: string, runId: string, state: 'delta' | 'final' | 'error', text: string, extra?: Record<string, unknown>) {
    this.onEventHandler?.({
      type: 'event',
      event: 'chat',
      payload: {
        sessionKey,
        runId,
        state,
        message: {
          id: `${runId}-${state}`,
          role: 'assistant',
          text,
        },
        ...(extra ?? {}),
      },
    });
  }

  private finalizeRunBuffer(sessionId: string) {
    const buffer = this.runBuffers.get(sessionId);
    if (!buffer) return;
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    const session = this.ensureSession(sessionId);
    if (buffer.text.trim()) {
      session.history.push({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: buffer.text,
      });
      this.emitChatEvent(sessionId, buffer.runId, 'final', buffer.text);
      this.emitTypedEvent('run.completed', {
        sessionKey: sessionId,
        runId: buffer.runId,
        label: 'Run completed',
      });
    }
    this.runBuffers.delete(sessionId);
  }

  private handleDaemonMessage(rawData: string) {
    let envelope: DaemonEnvelope;
    try {
      envelope = JSON.parse(rawData) as DaemonEnvelope;
    } catch {
      return;
    }
    const type = typeof envelope.type === 'string' ? envelope.type : '';
    const sessionId = typeof envelope.sessionId === 'string' ? envelope.sessionId.trim() : '';
    const payload = envelope.payload ?? {};

    if (!type) return;

    if (type === 'run_activity' && sessionId) {
      const detail = typeof payload.detail === 'string' ? payload.detail : 'Run activity';
      this.emitTypedEvent('run.activity', {
        sessionKey: sessionId,
        runId: `run-${Date.now()}`,
        activityItems: [{ id: `activity-${Date.now()}`, label: detail, tone: 'neutral' }],
      });
      return;
    }

    if (type === 'stream_delta' && sessionId) {
      const chunk = typeof payload.text === 'string' ? payload.text : '';
      if (!chunk) return;

      const existing = this.runBuffers.get(sessionId) ?? { runId: `run-${Date.now()}`, text: '', timer: null };
      existing.text += chunk;
      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      existing.timer = setTimeout(() => this.finalizeRunBuffer(sessionId), 700);
      this.runBuffers.set(sessionId, existing);

      this.emitChatEvent(sessionId, existing.runId, 'delta', existing.text);
      return;
    }

    if (type === 'process_exit' && sessionId) {
      this.finalizeRunBuffer(sessionId);
      this.emitTypedEvent('run.failed', {
        sessionKey: sessionId,
        runId: `run-${Date.now()}`,
        label: 'ACP process exited',
      });
      return;
    }

    if (type === 'session_closed' && sessionId) {
      this.sessions.delete(sessionId);
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }
    }
  }

  setEventHandler(handler: (event: AgentBackendEvent) => void) {
    this.onEventHandler = handler;
  }

  setConnectionHandler(handler: (connected: boolean, message: string) => void) {
    this.onConnectionHandler = handler;
  }

  isConnected() {
    return this.connected;
  }

  async connect(options: HermesConnectOptions): Promise<void> {
    this.baseUrl = this.normalizeBaseUrl(options.gatewayUrl);
    this.token = options.token?.trim() || null;

    const healthResponse = await this.request('/health', { method: 'GET' });
    const health = await healthResponse.json() as { ok?: boolean };
    if (!health.ok) {
      throw new Error('Relay daemon health check failed.');
    }

    const wsTarget = new URL('/v1/ws', this.baseUrl);
    if (this.token) {
      wsTarget.searchParams.set('token', this.token);
    }

    const workspacesResponse = await this.request('/v1/workspaces', { method: 'GET' });
    const workspacesJson = await workspacesResponse.json() as { workspaces?: Array<{ key?: string }> };
    const firstWorkspace = workspacesJson.workspaces?.find((entry) => typeof entry?.key === 'string' && entry.key.trim());
    this.workspaceKey = firstWorkspace?.key?.trim() ?? null;
    if (!this.workspaceKey) {
      throw new Error('Relay daemon has no configured workspaces.');
    }

    await new Promise<void>((resolve, reject) => {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      const socket = new WebSocket(wsTarget.toString());
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Relay daemon WebSocket connection timed out.'));
      }, 10_000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.ws = socket;
        this.connected = true;
        this.onConnectionHandler?.(true, `Connected to relay-daemon (${this.baseUrl})`);
        resolve();
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Relay daemon WebSocket connection failed.'));
      };

      socket.onmessage = (event) => {
        this.handleDaemonMessage(typeof event.data === 'string' ? event.data : String(event.data ?? ''));
      };

      socket.onclose = () => {
        this.connected = false;
        this.onConnectionHandler?.(false, 'Relay daemon disconnected.');
      };
    });
  }

  disconnect(): void {
    this.runBuffers.forEach((buffer) => {
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
    });
    this.runBuffers.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.onConnectionHandler?.(false, 'Relay daemon disconnected.');
  }

  async getActiveSessionKey(): Promise<string> {
    if (this.activeSessionId) {
      return this.activeSessionId;
    }
    const created = await this.createChatSession();
    return created;
  }

  private async createSession(kind: 'chat' | 'cowork' | 'main'): Promise<string> {
    if (!this.connected) {
      throw new Error('Relay daemon client is not connected.');
    }
    if (!this.workspaceKey) {
      throw new Error('Relay daemon workspace is not configured.');
    }

    const response = await this.request('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ workspace: this.workspaceKey, label: `relay-${kind}` }),
    });
    const json = await response.json() as { session?: { id?: string } };
    const id = typeof json.session?.id === 'string' ? json.session.id.trim() : '';
    if (!id) {
      throw new Error('Relay daemon did not return a session id.');
    }
    this.activeSessionId = id;
    this.ensureSession(id, kind);
    return id;
  }

  async createChatSession(): Promise<string> {
    return this.createSession('chat');
  }

  async createCoworkSession(): Promise<string> {
    return this.createSession('cowork');
  }

  async sendChat(sessionKey: string, text: string): Promise<{ sessionKey: string }> {
    const key = sessionKey.trim();
    if (!key) throw new Error('Session key is required.');
    if (!this.connected) throw new Error('Relay daemon client is not connected.');

    const session = this.ensureSession(key, key.toLowerCase().includes('cowork') ? 'cowork' : 'chat');
    session.history.push({ id: `user-${Date.now()}`, role: 'user', text });
    this.activeSessionId = key;

    const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.emitTypedEvent('run.started', { sessionKey: key, runId, label: 'Run started' });

    await this.request(`/v1/sessions/${encodeURIComponent(key)}/input`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    return { sessionKey: key };
  }

  async resolveSessionKey(preferredKey = 'main'): Promise<string> {
    const normalized = preferredKey.trim();
    if (normalized) {
      this.ensureSession(normalized, normalized === 'main' ? 'main' : 'chat');
      this.activeSessionId = normalized;
      return normalized;
    }
    return this.getActiveSessionKey();
  }

  async getHistory(sessionKey: string, limit = 50): Promise<HermesChatMessage[]> {
    const session = this.sessions.get(sessionKey.trim());
    if (!session) return [];
    return session.history.slice(-Math.max(1, limit));
  }

  async listModels(): Promise<HermesModelChoice[]> {
    const raw = await this.requestDaemonJson(this.ensureModelsEndpoint(), { method: 'GET' });
    const choices = this.ensureModelListResponse(raw);
    return choices;
  }

  async getSessionModel(sessionKey: string): Promise<string | null> {
    const local = this.ensureSessionModelFetch(sessionKey);
    if (local) {
      return local;
    }
    const choices = await this.listModels();
    return this.ensureMainModelFallback(choices);
  }

  async listSessions(limit = 200): Promise<HermesSessionSummary[]> {
    const raw = await this.requestDaemonJson(this.ensureSessionsEndpoint(), { method: 'GET' });
    return this.ensureSessionListResponse(raw, limit);
  }

  async setSessionModel(sessionKey: string, modelValue: string | null): Promise<void> {
    this.ensureSessionModelStorage(sessionKey, modelValue);
  }

  async setSessionTitle(sessionKey: string, title: string | null): Promise<void> {
    this.ensureSessionTitle(sessionKey, title);
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const endpoint = this.ensureDeleteSessionEndpoint(sessionKey);
    await this.requestDaemonJson(endpoint, { method: 'DELETE' });
    this.ensureSessionDeleteLocal(sessionKey);
  }

  async listCronJobs(): Promise<HermesCronJob[]> {
    const raw = await this.requestDaemonJson(this.ensureCronListPath(), { method: 'GET' });
    return this.ensureCronListResponse(raw);
  }

  async createCronJob(input: HermesCreateCronJobInput): Promise<string | null> {
    const payload = this.ensureCronPayload(input);
    const raw = await this.requestDaemonJson(this.ensureCronListPath(), {
      method: 'POST',
      body: this.createJsonBody(payload),
    });
    return this.ensureCronCreateId(raw);
  }

  async updateCronJob(input: HermesUpdateCronJobInput): Promise<void> {
    const { id, payload } = this.ensureCronUpdatePayload(input);
    await this.requestDaemonJson(this.ensureCronJobPath(id), {
      method: 'PATCH',
      body: this.createJsonBody(payload),
    });
  }

  async deleteCronJob(idInput: string): Promise<void> {
    await this.requestDaemonJson(this.ensureCronJobPath(this.ensureCronDeleteId(idInput)), {
      method: 'DELETE',
    });
  }

  async listKanbanTasks(input?: { assignee?: string; status?: string; tenant?: string; archived?: boolean; rootPath?: string }): Promise<HermesKanbanTask[]> {
    const queryPath = this.buildQuery(this.ensureKanbanListPath(), this.ensureTasksInput(input));
    const raw = await this.requestDaemonJson(queryPath, { method: 'GET' });
    return this.ensureKanbanListResponse(raw);
  }

  async createKanbanTask(input: { title: string; body?: string; assignee?: string; tenant?: string; rootPath?: string }): Promise<string> {
    const payload = this.ensureKanbanCreatePayload(input);
    const raw = await this.requestDaemonJson(this.ensureKanbanListPath(), {
      method: 'POST',
      body: this.createJsonBody(payload),
    });
    return this.ensureKanbanCreateId(raw);
  }

  async getKanbanTask(taskId: string, input?: { rootPath?: string }): Promise<HermesKanbanTaskDetail | null> {
    const basePath = this.ensureKanbanTaskPath(taskId);
    const queryPath = this.buildQuery(basePath, this.ensureTaskDetailInput(input));
    const raw = await this.requestDaemonJson(queryPath, { method: 'GET' });
    return this.ensureKanbanDetailResponse(raw);
  }

  async commentKanbanTask(taskId: string, text: string, input?: { rootPath?: string }): Promise<void> {
    const payload = this.ensureKanbanCommentPayload(text, this.ensureTaskCommentRoot(input));
    const raw = await this.requestDaemonJson(this.ensureKanbanCommentPath(taskId), {
      method: 'POST',
      body: this.createJsonBody(payload),
    });
    if (!this.ensureOk(raw)) {
      throw new HermesRequestError('Kanban comment request failed.', 'kanban_comment_failed');
    }
  }

  async fetchToolsCatalog(): Promise<HermesToolsCatalog> {
    return { tools: [] };
  }

  async listWorkspaceFiles(relativePath?: string): Promise<{ items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>; truncated: boolean; }> {
    const queryPath = this.buildQuery(this.ensureWorkspaceListEndpoint(), {
      path: this.ensureWorkspaceListPath(relativePath),
    });
    const raw = await this.requestWorkspaceJson(queryPath, { method: 'GET' });
    return this.ensureWorkspaceListResponse(raw);
  }

  async readWorkspaceFile(relativePath: string): Promise<{ content: string }> {
    const queryPath = this.buildQuery(this.ensureWorkspaceReadEndpoint(), {
      path: this.ensureReadPath(relativePath),
    });
    const raw = await this.requestWorkspaceJson(queryPath, { method: 'GET' });
    return this.ensureWorkspaceReadResponse(raw);
  }

  async statWorkspaceFile(relativePath: string): Promise<{ kind: 'file' | 'directory'; size: number; createdMs: number; modifiedMs: number; }> {
    const queryPath = this.buildQuery(this.ensureWorkspaceStatEndpoint(), {
      path: this.ensureStatPath(relativePath),
    });
    const raw = await this.requestWorkspaceJson(queryPath, { method: 'GET' });
    return this.ensureWorkspaceStatResponse(raw);
  }

  async renameWorkspaceFile(oldPath: string, newPath: string): Promise<void> {
    const raw = await this.requestWorkspaceJson(this.ensureWorkspaceRenameEndpoint(), {
      method: 'POST',
      body: this.createJsonBody(this.ensureWorkspaceRenamePayload(oldPath, newPath)),
    });
    if (!this.ensureOk(raw)) {
      throw new HermesRequestError('Workspace rename request failed.', 'workspace_rename_failed');
    }
  }

  async deleteWorkspaceFile(path: string): Promise<void> {
    const raw = await this.requestWorkspaceJson(this.ensureWorkspaceDeleteEndpoint(), {
      method: 'POST',
      body: this.createJsonBody(this.ensureWorkspaceDeletePayload(path)),
    });
    if (!this.ensureOk(raw)) {
      throw new HermesRequestError('Workspace delete request failed.', 'workspace_delete_failed');
    }
  }

  async writeWorkspaceFile(path: string, content: string): Promise<void> {
    const raw = await this.requestWorkspaceJson(this.ensureWorkspaceWriteEndpoint(), {
      method: 'POST',
      body: this.createJsonBody(this.ensureWorkspaceWritePayload(path, content)),
    });
    if (!this.ensureOk(raw)) {
      throw new HermesRequestError('Workspace write request failed.', 'workspace_write_failed');
    }
  }
}
