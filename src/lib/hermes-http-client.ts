import type {
  AgentBackendEvent,
  BackendTypedEventName,
  LegacyAgentBackendEvent,
} from './agent-backend-client';
import { ensureGatewayApiBase } from './gateway-endpoint';

export type HermesConnectOptions = {
  gatewayUrl: string;
  token?: string;
  password?: string;
};

export type HermesChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
};

export type HermesModelChoice = {
  value: string;
  label: string;
};

export type HermesCronJob = {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  state: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export type HermesCreateCronJobInput = {
  name: string;
  schedule: string;
  prompt: string;
  projectId?: string;
  sessionKey?: string;
  enabled?: boolean;
};

export type HermesUpdateCronJobInput = {
  id: string;
  name?: string;
  schedule?: string;
  prompt?: string;
  enabled?: boolean;
};

export type HermesSessionSummary = {
  key: string;
  kind: string;
  title?: string;
};

export type HermesToolEntry = {
  name: string;
  group?: string;
  source: 'core' | 'plugin';
  pluginId?: string;
  optional?: boolean;
};

export type HermesToolsCatalog = {
  tools: HermesToolEntry[];
};

export type HermesErrorDetails = {
  code?: string;
  requestId?: string;
  reason?: string;
  [key: string]: unknown;
};

export class HermesRequestError extends Error {
  code?: string;
  details?: HermesErrorDetails;

  constructor(message: string, code?: string, details?: HermesErrorDetails) {
    super(message);
    this.name = 'HermesRequestError';
    this.code = code;
    this.details = details;
  }
}

type StoredSession = {
  key: string;
  kind: 'chat' | 'cowork' | 'main';
  title?: string;
  model?: string | null;
  history: HermesChatMessage[];
};

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };
const MODEL_VALUE_SEPARATOR = '::';
const HERMES_CLIENT_LOG_PREFIX = '[Relay:HermesClient]';

export class HermesHttpClient {
  private connected = false;
  private apiBaseUrl: string | null = null;
  private token: string | null = null;
  private onEventHandler: ((event: AgentBackendEvent) => void) | null = null;
  private onConnectionHandler: ((connected: boolean, message: string) => void) | null = null;
  private sessions = new Map<string, StoredSession>();
  private defaultModel: string | null = null;
  private inflightChat = new Map<string, AbortController>();
  private requestCounter = 0;

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

  setEventHandler(handler: (event: AgentBackendEvent) => void) {
    this.onEventHandler = handler;
  }

  setConnectionHandler(handler: (connected: boolean, message: string) => void) {
    this.onConnectionHandler = handler;
  }

  isConnected() {
    return this.connected;
  }

  private normalizeBaseUrl(input: string): string {
    const normalized = ensureGatewayApiBase(input ?? '');
    if (!normalized) {
      throw new Error('Hermes endpoint is required.');
    }
    return normalized;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    if (!this.apiBaseUrl) {
      throw new Error('Hermes client is not connected.');
    }
    const headers = new Headers(init?.headers ?? {});
    headers.set('Content-Type', 'application/json');
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const requestId = ++this.requestCounter;
    const method = init?.method ?? 'GET';
    const startedAt = Date.now();
    this.log('info', 'HTTP request started', { requestId, method, path, baseUrl: this.apiBaseUrl });

    let response: Response;
    try {
      if (window.relay?.backendHttpRequest) {
        const result = await window.relay.backendHttpRequest({
          baseUrl: this.apiBaseUrl,
          path,
          method: init?.method ?? 'GET',
          token: this.token ?? undefined,
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        response = new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
        });
      } else {
        response = await fetch(`${this.apiBaseUrl}${path}`, {
          ...init,
          headers,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('error', 'HTTP request failed before response', { requestId, method, path, durationMs: Date.now() - startedAt, error: message });
      throw new HermesRequestError(`Unable to reach Hermes endpoint (${this.apiBaseUrl}): ${message}`, 'network_error');
    }

    this.log('info', 'HTTP response received', { requestId, method, path, status: response.status, durationMs: Date.now() - startedAt });

    if (!response.ok) {
      let message = `Hermes API request failed (${response.status}).`;
      try {
        const data = await response.json() as { error?: { message?: string } };
        if (typeof data?.error?.message === 'string' && data.error.message.trim()) {
          message = data.error.message.trim();
        }
      } catch {
        // ignore parse errors
      }
      if (response.status === 401 || response.status === 403) {
        message = `${message} Check Hermes API token / API_SERVER_KEY.`;
      } else if (response.status === 404) {
        message = `${message} Check endpoint URL includes /v1.`;
      }
      this.log('warn', 'HTTP request returned non-ok status', { requestId, method, path, status: response.status, message });
      throw new HermesRequestError(message, String(response.status), { status: response.status, path });
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

  private toOpenAIMessages(history: HermesChatMessage[]): OpenAIMessage[] {
    return history
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.text }));
  }

  private async resolveDefaultModel(): Promise<string> {
    if (this.defaultModel) {
      return this.defaultModel;
    }
    try {
      const response = await this.request('/models', { method: 'GET' });
      const json = await response.json() as { data?: Array<{ id?: string }> };
      const first = Array.isArray(json.data)
        ? json.data.find((m) => typeof m.id === 'string' && m.id.trim().length > 0)
        : null;
      if (first?.id) {
        this.defaultModel = first.id.trim();
        return this.defaultModel;
      }
    } catch {
      // fall through to static default
    }
    this.defaultModel = 'hermes-agent';
    return this.defaultModel;
  }

  private emitLegacyEvent(event: LegacyAgentBackendEvent): void {
    this.onEventHandler?.(event);
  }

  private emitTypedEvent(event: BackendTypedEventName, payload: Record<string, unknown>): void {
    this.onEventHandler?.({
      type: 'typed_event',
      event,
      payload,
    });
  }

  private emitChatEvent(sessionKey: string, runId: string, state: 'delta' | 'final' | 'error' | 'aborted', text: string, extra?: Record<string, unknown>) {
    const payload = {
      sessionKey,
      runId,
      state,
      message: {
        id: `${runId}-${state}`,
        role: 'assistant' as const,
        text,
      },
      ...extra,
    };

    this.emitLegacyEvent({
      type: 'event',
      event: 'chat',
      payload,
    });

    this.emitTypedEvent('chat', payload);

    if (state === 'final') {
      this.emitTypedEvent('run.completed', {
        sessionKey,
        runId,
        summary: typeof text === 'string' ? text.slice(0, 200) : '',
      });
    }

    if (state === 'error') {
      this.emitTypedEvent('run.failed', {
        sessionKey,
        runId,
        errorMessage: typeof extra?.errorMessage === 'string' ? extra.errorMessage : 'Run failed.',
      });
    }
  }

  private emitRunActivity(sessionKey: string, runId: string, label: string, details?: string, tone: 'neutral' | 'success' | 'danger' = 'neutral') {
    this.emitTypedEvent('run.activity', {
      sessionKey,
      runId,
      label,
      details,
      tone,
    });
  }

  async connect(options: HermesConnectOptions): Promise<void> {
    const base = this.normalizeBaseUrl(options.gatewayUrl);
    const nextToken = options.token?.trim() || null;

    this.apiBaseUrl = base;
    this.token = nextToken;

    this.log('info', 'Connect requested', { gatewayUrl: base, hasToken: Boolean(nextToken) });
    try {
      const response = await this.request('/models', { method: 'GET' });
      const json = await response.json() as { data?: Array<{ id?: string }> };
      const models = Array.isArray(json.data) ? json.data : [];
      const first = models.find((entry) => typeof entry?.id === 'string' && entry.id.trim().length > 0);
      this.defaultModel = first?.id?.trim() || null;
      this.connected = true;
      this.ensureSession('main', 'main');
      this.log('info', 'Connect succeeded', { gatewayUrl: base, defaultModel: this.defaultModel });
      this.onConnectionHandler?.(true, `Connected to ${base}`);
    } catch (error) {
      this.connected = false;
      const message = error instanceof Error ? error.message : 'Failed to connect to Hermes endpoint.';
      this.log('error', 'Connect failed', { gatewayUrl: base, error: message });
      this.onConnectionHandler?.(false, message);
      throw error;
    }
  }

  disconnect() {
    for (const controller of this.inflightChat.values()) {
      controller.abort();
    }
    this.inflightChat.clear();
    this.connected = false;
    this.log('info', 'Disconnected');
    this.onConnectionHandler?.(false, 'Disconnected from Hermes API.');
  }

  resetDeviceIdentity() {
    // No-op for HTTP auth mode.
  }

  async getDeviceId(): Promise<string> {
    return 'http-client';
  }

  async getActiveSessionKey(): Promise<string> {
    return 'main';
  }

  private createSession(kind: 'chat' | 'cowork'): string {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const key = `relay-${kind}-${id}`;
    this.ensureSession(key, kind);
    return key;
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
    if (!this.connected) throw new Error('Hermes client is not connected.');

    const session = this.ensureSession(key, key.toLowerCase().includes('cowork') ? 'cowork' : 'chat');
    session.history.push({
      id: `user-${Date.now()}`,
      role: 'user',
      text,
    });

    const runId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.log('info', 'Chat run started', { sessionKey: key, runId, userChars: text.length });

    this.emitTypedEvent('run.started', {
      sessionKey: key,
      runId,
      label: 'Chat run started',
    });

    const sessionModelRaw = session.model?.trim() || '';
    const separatorIndex = sessionModelRaw.indexOf(MODEL_VALUE_SEPARATOR);
    const model =
      separatorIndex > 0 && separatorIndex < sessionModelRaw.length - MODEL_VALUE_SEPARATOR.length
        ? sessionModelRaw.slice(separatorIndex + MODEL_VALUE_SEPARATOR.length).trim()
        : (sessionModelRaw || await this.resolveDefaultModel());
    const body = {
      model,
      messages: this.toOpenAIMessages(session.history),
      stream: false,
    };

    this.inflightChat.get(key)?.abort();
    const controller = new AbortController();
    this.inflightChat.set(key, controller);

    try {
      this.emitRunActivity(key, runId, 'Calling Hermes API', 'Requesting /chat/completions');
      const response = await this.request('/chat/completions', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const accumulated = json.choices?.[0]?.message?.content ?? '';
      this.log('info', 'Chat run completed', { sessionKey: key, runId, assistantChars: accumulated.length, model });

      session.history.push({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: accumulated,
      });
      this.emitChatEvent(key, runId, 'final', accumulated, { model });
    } catch (error) {
      if (controller.signal.aborted) {
        this.log('warn', 'Chat run aborted', { sessionKey: key, runId });
        this.emitChatEvent(key, runId, 'aborted', '');
        return { sessionKey: key };
      }
      const message = error instanceof Error ? error.message : 'Hermes request failed.';
      this.log('error', 'Chat run failed', { sessionKey: key, runId, error: message });
      this.emitChatEvent(key, runId, 'error', '', { errorMessage: message });
      throw error;
    } finally {
      const current = this.inflightChat.get(key);
      if (current === controller) {
        this.inflightChat.delete(key);
      }
    }

    return { sessionKey: key };
  }

  cancelChat(sessionKey: string): void {
    const key = sessionKey.trim();
    if (!key) {
      return;
    }
    this.inflightChat.get(key)?.abort();
  }

  async resolveSessionKey(preferredKey = 'main'): Promise<string> {
    const key = preferredKey.trim() || 'main';
    this.ensureSession(key, key === 'main' ? 'main' : 'chat');
    return key;
  }

  async getHistory(sessionKey: string, limit = 50): Promise<HermesChatMessage[]> {
    const key = sessionKey.trim();
    const session = this.sessions.get(key);
    if (!session) return [];
    return session.history.slice(-Math.max(1, limit));
  }

  async listModels(): Promise<HermesModelChoice[]> {
    this.log('info', 'Listing models');
    if (window.relay?.hermesModelOptions) {
      try {
        const options = await window.relay.hermesModelOptions({
          gatewayUrl: this.apiBaseUrl ?? undefined,
        });
        const providers = Array.isArray(options.providers) ? options.providers : [];
        const orderedProviders = [...providers].sort((a, b) => Number(Boolean(b.is_current)) - Number(Boolean(a.is_current)));
        const seen = new Set<string>();
        const mapped: HermesModelChoice[] = [];

        for (const provider of orderedProviders) {
          for (const modelIdRaw of provider.models ?? []) {
            const modelId = typeof modelIdRaw === 'string' ? modelIdRaw.trim() : '';
            if (!modelId || seen.has(modelId)) {
              continue;
            }
            seen.add(modelId);
            mapped.push({
              value: `${provider.slug}${MODEL_VALUE_SEPARATOR}${modelId}`,
              label: `${modelId} (${provider.slug})`,
            });
          }
        }

        if (mapped.length > 0) {
          this.log('info', 'Model list loaded from dashboard bridge', { count: mapped.length });
          return mapped;
        }
      } catch {
        this.log('warn', 'Dashboard model options failed; falling back to /models');
        // Fall through to OpenAI-compatible endpoint as a last resort.
      }
    }

    const response = await this.request('/models', { method: 'GET' });
    const json = await response.json() as { data?: Array<{ id?: string }> };
    const models = Array.isArray(json.data) ? json.data : [];
    const mapped = models
      .map((m) => (typeof m.id === 'string' && m.id.trim() ? { value: m.id.trim(), label: m.id.trim() } : null))
      .filter((m): m is HermesModelChoice => Boolean(m));
    this.log('info', 'Model list loaded from Hermes /models', { count: mapped.length });
    return mapped;
  }

  async getSessionModel(sessionKey: string): Promise<string | null> {
    if (window.relay?.hermesModelOptions) {
      try {
        const options = await window.relay.hermesModelOptions({
          gatewayUrl: this.apiBaseUrl ?? undefined,
        });
        const provider = typeof options.provider === 'string' ? options.provider.trim() : '';
        const model = typeof options.model === 'string' ? options.model.trim() : '';
        if (provider && model) {
          return `${provider}${MODEL_VALUE_SEPARATOR}${model}`;
        }
      } catch {
        // Fall back to local session state below.
      }
    }
    const session = this.sessions.get(sessionKey.trim());
    return session?.model ?? null;
  }

  async listSessions(limit = 200): Promise<HermesSessionSummary[]> {
    return Array.from(this.sessions.values())
      .slice(-Math.max(1, limit))
      .map((s) => ({ key: s.key, kind: s.kind, title: s.title }));
  }

  async setSessionModel(sessionKey: string, modelValue: string | null): Promise<void> {
    const session = this.ensureSession(sessionKey.trim(), 'chat');
    const normalized = modelValue?.trim() || null;
    session.model = normalized;

    if (!normalized || !window.relay?.hermesSetMainModel) {
      return;
    }

    const separatorIndex = normalized.indexOf(MODEL_VALUE_SEPARATOR);
    if (separatorIndex <= 0 || separatorIndex >= normalized.length - MODEL_VALUE_SEPARATOR.length) {
      return;
    }

    const provider = normalized.slice(0, separatorIndex).trim();
    const model = normalized.slice(separatorIndex + MODEL_VALUE_SEPARATOR.length).trim();
    if (!provider || !model) {
      return;
    }

    const result = await window.relay.hermesSetMainModel({
      gatewayUrl: this.apiBaseUrl ?? undefined,
      provider,
      model,
    });
    this.log('info', 'Requested main model change', { sessionKey, provider, model, confirmedProvider: result.confirmedProvider, confirmedModel: result.confirmedModel });

    const confirmedProvider = result.confirmedProvider?.trim() || '';
    const confirmedModel = result.confirmedModel?.trim() || '';
    if (confirmedProvider && confirmedModel && (confirmedProvider !== provider || confirmedModel !== model)) {
      throw new Error(
        `Hermes kept ${confirmedProvider}/${confirmedModel} instead of requested ${provider}/${model}. Start a new session or restart Hermes.`,
      );
    }
  }

  async setSessionTitle(sessionKey: string, title: string | null): Promise<void> {
    const session = this.ensureSession(sessionKey.trim(), 'chat');
    session.title = title?.trim() || undefined;
  }

  async deleteSession(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey.trim());
  }

  async listCronJobs(): Promise<HermesCronJob[]> {
    return [];
  }

  async createCronJob(_input: HermesCreateCronJobInput): Promise<string | null> {
    throw new HermesRequestError('Hermes API cron endpoints are not configured in this client.', 'not_supported');
  }

  async updateCronJob(_input: HermesUpdateCronJobInput): Promise<void> {
    throw new HermesRequestError('Hermes API cron endpoints are not configured in this client.', 'not_supported');
  }

  async deleteCronJob(_idInput: string): Promise<void> {
    throw new HermesRequestError('Hermes API cron endpoints are not configured in this client.', 'not_supported');
  }

  async fetchToolsCatalog(): Promise<HermesToolsCatalog> {
    return { tools: [] };
  }

  async listWorkspaceFiles(_relativePath?: string): Promise<{ items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>; truncated: boolean; }> {
    throw new HermesRequestError('workspace.list is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async readWorkspaceFile(_relativePath: string): Promise<{ content: string }> {
    throw new HermesRequestError('workspace.read is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async statWorkspaceFile(_relativePath: string): Promise<{ kind: 'file' | 'directory'; size: number; createdMs: number; modifiedMs: number; }> {
    throw new HermesRequestError('workspace.stat is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async renameWorkspaceFile(_oldPath: string, _newPath: string): Promise<void> {
    throw new HermesRequestError('workspace.rename is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async deleteWorkspaceFile(_path: string): Promise<void> {
    throw new HermesRequestError('workspace.delete is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async writeWorkspaceFile(_path: string, _content: string): Promise<void> {
    throw new HermesRequestError('workspace.write is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }
}

