import type { AgentBackendEvent } from './agent-backend-client';

export type GatewayConnectOptions = {
  gatewayUrl: string;
  token?: string;
  password?: string;
};

export type GatewayChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
};

export type GatewayModelChoice = {
  value: string;
  label: string;
};

export type GatewayCronJob = {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  state: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export type GatewayCreateCronJobInput = {
  name: string;
  schedule: string;
  prompt: string;
  projectId?: string;
  sessionKey?: string;
  enabled?: boolean;
};

export type GatewayUpdateCronJobInput = {
  id: string;
  name?: string;
  schedule?: string;
  prompt?: string;
  enabled?: boolean;
};

export type GatewaySessionSummary = {
  key: string;
  kind: string;
  title?: string;
};

export type GatewayToolEntry = {
  name: string;
  group?: string;
  source: 'core' | 'plugin';
  pluginId?: string;
  optional?: boolean;
};

export type GatewayToolsCatalog = {
  tools: GatewayToolEntry[];
};

export type GatewayErrorDetails = {
  code?: string;
  requestId?: string;
  reason?: string;
  [key: string]: unknown;
};

export class GatewayRequestError extends Error {
  code?: string;
  details?: GatewayErrorDetails;

  constructor(message: string, code?: string, details?: GatewayErrorDetails) {
    super(message);
    this.name = 'GatewayRequestError';
    this.code = code;
    this.details = details;
  }
}

type StoredSession = {
  key: string;
  kind: 'chat' | 'cowork' | 'main';
  title?: string;
  model?: string | null;
  history: GatewayChatMessage[];
};

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };
const MODEL_VALUE_SEPARATOR = '::';

export class HermesGatewayClient {
  private connected = false;
  private apiBaseUrl: string | null = null;
  private token: string | null = null;
  private onEventHandler: ((event: AgentBackendEvent) => void) | null = null;
  private onConnectionHandler: ((connected: boolean, message: string) => void) | null = null;
  private sessions = new Map<string, StoredSession>();
  private defaultModel: string | null = null;
  private inflightChat = new Map<string, AbortController>();

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
    const trimmed = (input ?? '').trim();
    if (!trimmed) {
      throw new Error('Hermes endpoint is required.');
    }

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const normalized = withProtocol.replace(/\/+$/, '');
    if (normalized.endsWith('/v1')) {
      return normalized;
    }
    return `${normalized}/v1`;
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
      throw new GatewayRequestError(`Unable to reach Hermes endpoint (${this.apiBaseUrl}): ${message}`, 'network_error');
    }

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
      throw new GatewayRequestError(message, String(response.status), { status: response.status, path });
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

  private toOpenAIMessages(history: GatewayChatMessage[]): OpenAIMessage[] {
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

  private emitChatEvent(sessionKey: string, runId: string, state: 'delta' | 'final' | 'error' | 'aborted', text: string, extra?: Record<string, unknown>) {
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
        ...extra,
      },
    });
  }

  async connect(options: GatewayConnectOptions): Promise<void> {
    const base = this.normalizeBaseUrl(options.gatewayUrl);
    const nextToken = options.token?.trim() || null;

    this.apiBaseUrl = base;
    this.token = nextToken;

    try {
      const response = await this.request('/models', { method: 'GET' });
      const json = await response.json() as { data?: Array<{ id?: string }> };
      const models = Array.isArray(json.data) ? json.data : [];
      const first = models.find((entry) => typeof entry?.id === 'string' && entry.id.trim().length > 0);
      this.defaultModel = first?.id?.trim() || null;
      this.connected = true;
      this.ensureSession('main', 'main');
      this.onConnectionHandler?.(true, `Connected to ${base}`);
    } catch (error) {
      this.connected = false;
      const message = error instanceof Error ? error.message : 'Failed to connect to Hermes endpoint.';
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
      const response = await this.request('/chat/completions', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const accumulated = json.choices?.[0]?.message?.content ?? '';

      session.history.push({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: accumulated,
      });
      this.emitChatEvent(key, runId, 'final', accumulated, { model });
    } catch (error) {
      if (controller.signal.aborted) {
        this.emitChatEvent(key, runId, 'aborted', '');
        return { sessionKey: key };
      }
      const message = error instanceof Error ? error.message : 'Hermes request failed.';
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

  async getHistory(sessionKey: string, limit = 50): Promise<GatewayChatMessage[]> {
    const key = sessionKey.trim();
    const session = this.sessions.get(key);
    if (!session) return [];
    return session.history.slice(-Math.max(1, limit));
  }

  async listModels(): Promise<GatewayModelChoice[]> {
    if (window.relay?.hermesModelOptions) {
      try {
        const options = await window.relay.hermesModelOptions({ gatewayUrl: this.apiBaseUrl ?? undefined });
        const providers = Array.isArray(options.providers) ? options.providers : [];
        const orderedProviders = [...providers].sort((a, b) => Number(Boolean(b.is_current)) - Number(Boolean(a.is_current)));
        const seen = new Set<string>();
        const mapped: GatewayModelChoice[] = [];

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
          return mapped;
        }
      } catch {
        // Fall through to OpenAI-compatible endpoint as a last resort.
      }
    }

    const response = await this.request('/models', { method: 'GET' });
    const json = await response.json() as { data?: Array<{ id?: string }> };
    const models = Array.isArray(json.data) ? json.data : [];
    return models
      .map((m) => (typeof m.id === 'string' && m.id.trim() ? { value: m.id.trim(), label: m.id.trim() } : null))
      .filter((m): m is GatewayModelChoice => Boolean(m));
  }

  async getSessionModel(sessionKey: string): Promise<string | null> {
    if (window.relay?.hermesModelOptions) {
      try {
        const options = await window.relay.hermesModelOptions({ gatewayUrl: this.apiBaseUrl ?? undefined });
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

  async listSessions(limit = 200): Promise<GatewaySessionSummary[]> {
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

    const confirmedProvider = result.confirmedProvider?.trim() || '';
    const confirmedModel = result.confirmedModel?.trim() || '';
    if (confirmedProvider && confirmedModel && (confirmedProvider !== provider || confirmedModel !== model)) {
      throw new Error(
        `Hermes kept ${confirmedProvider}/${confirmedModel} instead of requested ${provider}/${model}. Start a new session or restart gateway.`,
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

  async listCronJobs(): Promise<GatewayCronJob[]> {
    return [];
  }

  async createCronJob(_input: GatewayCreateCronJobInput): Promise<string | null> {
    throw new GatewayRequestError('Hermes API cron endpoints are not configured in this client.', 'not_supported');
  }

  async updateCronJob(_input: GatewayUpdateCronJobInput): Promise<void> {
    throw new GatewayRequestError('Hermes API cron endpoints are not configured in this client.', 'not_supported');
  }

  async deleteCronJob(_idInput: string): Promise<void> {
    throw new GatewayRequestError('Hermes API cron endpoints are not configured in this client.', 'not_supported');
  }

  async fetchToolsCatalog(): Promise<GatewayToolsCatalog> {
    return { tools: [] };
  }

  async listWorkspaceFiles(_relativePath?: string): Promise<{ items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>; truncated: boolean; }> {
    throw new GatewayRequestError('workspace.list is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async readWorkspaceFile(_relativePath: string): Promise<{ content: string }> {
    throw new GatewayRequestError('workspace.read is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async statWorkspaceFile(_relativePath: string): Promise<{ kind: 'file' | 'directory'; size: number; createdMs: number; modifiedMs: number; }> {
    throw new GatewayRequestError('workspace.stat is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async renameWorkspaceFile(_oldPath: string, _newPath: string): Promise<void> {
    throw new GatewayRequestError('workspace.rename is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async deleteWorkspaceFile(_path: string): Promise<void> {
    throw new GatewayRequestError('workspace.delete is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }

  async writeWorkspaceFile(_path: string, _content: string): Promise<void> {
    throw new GatewayRequestError('workspace.write is not supported by Hermes OpenAI API mode.', 'method_not_found');
  }
}
