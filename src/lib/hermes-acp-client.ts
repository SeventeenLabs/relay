import type {
  AgentBackendClient,
  AgentBackendEvent,
} from './agent-backend-client';
import type {
  GatewayChatMessage,
  GatewayConnectOptions,
  GatewayCreateCronJobInput,
  GatewayCronJob,
  GatewayModelChoice,
  GatewaySessionSummary,
  GatewayToolsCatalog,
  GatewayUpdateCronJobInput,
} from './hermes-gateway-client';

export class HermesAcpClient implements AgentBackendClient {
  private connected = false;
  private connectInFlight: Promise<void> | null = null;
  private lastConnectKey = '';
  private cwdHint = '';
  private gatewayBaseUrl = '';
  private gatewayToken = '';
  private onEventHandler: ((event: AgentBackendEvent) => void) | null = null;
  private onConnectionHandler: ((connected: boolean, message: string) => void) | null = null;
  private sessions = new Map<string, GatewaySessionSummary>();
  private models: GatewayModelChoice[] = [];
  private currentModelValue: string | null = null;
  private unsubscribeLiveActivity: (() => void) | null = null;

  private isUsefulToolActivity(label: string): boolean {
    const normalized = label.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.includes('usage_update')) return false;
    if (normalized.includes('agent_thought_chunk')) return false;
    if (normalized.startsWith('agent update:')) return false;
    if (normalized.includes('thought_chunk')) return false;
    return true;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
    const prefix = '[Relay:HermesACPClient]';
    if (level === 'error') {
      console.error(prefix, message, meta ?? '');
      return;
    }
    if (level === 'warn') {
      console.warn(prefix, message, meta ?? '');
      return;
    }
    console.info(prefix, message, meta ?? '');
  }

  setEventHandler(handler: (event: AgentBackendEvent) => void): void {
    this.onEventHandler = handler;
  }

  setConnectionHandler(handler: (connected: boolean, message: string) => void): void {
    this.onConnectionHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(options: GatewayConnectOptions): Promise<void> {
    const connectKey = typeof options.gatewayUrl === 'string' ? options.gatewayUrl.trim() : '';
    if (this.connected && this.lastConnectKey === connectKey) {
      this.log('info', 'Connect skipped (already connected)', { mode: 'stdio', cwdHint: this.cwdHint || '(default)' });
      return;
    }
    if (this.connectInFlight) {
      await this.connectInFlight;
      return;
    }

    this.connectInFlight = (async () => {
    const gateway = typeof options.gatewayUrl === 'string' ? options.gatewayUrl.trim() : '';
    this.gatewayBaseUrl = gateway;
    this.gatewayToken = typeof options.token === 'string' ? options.token.trim() : '';
    this.cwdHint = gateway && !/^https?:\/\//i.test(gateway)
      ? gateway
      : '';
    if (!window.relay?.acpEnsureAgent) {
      throw new Error('ACP bridge is not available. Update Electron preload/main to expose ACP IPC methods.');
    }
    try {
      await window.relay.acpEnsureAgent();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No handler registered for 'acp:ensure-agent'")) {
        throw new Error('ACP IPC handler is missing in the running Electron main process. Restart the app/dev process so the updated main process loads.');
      }
      throw error;
    }
    this.models = await this.refreshModelsFromAvailableSources();
    this.log('info', 'Model catalog loaded for ACP client', { count: this.models.length });
    if (!this.unsubscribeLiveActivity && window.relay?.acpOnLiveActivity) {
      this.unsubscribeLiveActivity = window.relay.acpOnLiveActivity((event) => {
        const sessionKey = typeof event?.sessionId === 'string' ? event.sessionId.trim() : '';
        const item = event?.item;
        if (!sessionKey || !item || typeof item !== 'object') {
          return;
        }
        const label = typeof item.label === 'string' ? item.label.trim() : '';
        if (!label || !this.isUsefulToolActivity(label)) {
          return;
        }
        const id =
          typeof item.id === 'string' && item.id.trim().length > 0
            ? item.id.trim()
            : `activity-${Date.now()}`;
        const details = typeof item.details === 'string' ? item.details : '';
        const toneValue = typeof item.tone === 'string' ? item.tone : 'neutral';
        const tone: 'neutral' | 'success' | 'danger' =
          toneValue === 'success' || toneValue === 'danger' || toneValue === 'neutral'
            ? toneValue
            : 'neutral';
        this.onEventHandler?.({
          type: 'typed_event',
          event: 'run.activity',
          payload: {
            sessionKey,
            runId: `live-${Date.now()}`,
            activityItems: [{ id, label, details, tone }],
          },
        });
      });
      this.log('info', 'Subscribed to live ACP activity stream');
    }
    this.connected = true;
    this.lastConnectKey = connectKey;
    this.log('info', 'Connected via ACP', { mode: 'stdio', cwdHint: this.cwdHint || '(default)' });
    this.onConnectionHandler?.(true, 'Connected via Hermes ACP transport.');
    })();
    try {
      await this.connectInFlight;
    } finally {
      this.connectInFlight = null;
    }
  }

  disconnect(): void {
    if (!this.connected) {
      return;
    }
    this.log('info', 'Disconnected');
    this.connected = false;
    this.lastConnectKey = '';
    this.sessions.clear();
    if (this.unsubscribeLiveActivity) {
      this.unsubscribeLiveActivity();
      this.unsubscribeLiveActivity = null;
    }
    this.onConnectionHandler?.(false, 'Disconnected from Hermes ACP transport.');
  }

  resetDeviceIdentity(): void {
    // no-op in stub
  }

  async getDeviceId(): Promise<string> {
    return 'acp-client';
  }

  async getActiveSessionKey(): Promise<string> {
    return 'main';
  }

  async createChatSession(): Promise<string> {
    if (!window.relay?.acpNewSession) {
      throw new Error('ACP new-session bridge is unavailable.');
    }
    const session = await window.relay.acpNewSession({ cwd: this.cwdHint || '' });
    this.sessions.set(session.sessionId, { key: session.sessionId, kind: 'chat' });
    this.log('info', 'Created chat session', { sessionId: session.sessionId });
    return session.sessionId;
  }

  async createCoworkSession(): Promise<string> {
    if (!window.relay?.acpNewSession) {
      throw new Error('ACP new-session bridge is unavailable.');
    }
    const session = await window.relay.acpNewSession({ cwd: this.cwdHint || '' });
    this.sessions.set(session.sessionId, { key: session.sessionId, kind: 'cowork' });
    this.log('info', 'Created cowork session', { sessionId: session.sessionId });
    return session.sessionId;
  }

  async sendChat(sessionKey: string, text: string): Promise<{ sessionKey: string }> {
    if (!window.relay?.acpPrompt) {
      throw new Error('ACP prompt bridge is unavailable.');
    }
    const runId = `acp-run-${Date.now()}`;
    this.onEventHandler?.({
      type: 'typed_event',
      event: 'run.started',
      payload: {
        sessionKey,
        runId,
        source: 'acp',
      },
    });
    this.log('info', 'Sending ACP prompt', { sessionKey, textLength: text.length });
    const result = await window.relay.acpPrompt({ sessionId: sessionKey, text });
    let assistantText = result.text ?? '';
    if (!assistantText.trim()) {
      const fallback = await this.fetchFallbackCompletion(text);
      if (fallback) {
        assistantText = fallback;
        this.log('warn', 'ACP returned empty text; used Hermes HTTP fallback completion', {
          sessionKey,
          fallbackLength: assistantText.length,
        });
      }
    }
    if (!assistantText.trim()) {
      assistantText = 'I could not retrieve a response from Hermes for this turn. Please retry.';
      this.log('error', 'No assistant text from ACP or fallback for turn', { sessionKey });
    }
    const activityItems = (Array.isArray(result.activityItems) ? result.activityItems : []).filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const label = typeof (item as { label?: unknown }).label === 'string' ? ((item as { label: string }).label).trim() : '';
      return this.isUsefulToolActivity(label);
    });
    if (activityItems.length > 0) {
      this.onEventHandler?.({
        type: 'typed_event',
        event: 'run.activity',
        payload: {
          sessionKey,
          runId,
          activityItems,
        },
      });
    }
    const payload = {
      sessionKey,
      runId,
      state: 'final',
      ...(activityItems.length > 0 ? { activityItems } : {}),
      ...(typeof result.contextWindowUsed === 'number' ? { contextWindowUsed: result.contextWindowUsed } : {}),
      ...(typeof result.contextWindowSize === 'number' ? { contextWindowSize: result.contextWindowSize } : {}),
      message: {
        id: `${runId}-final`,
        role: 'assistant' as const,
        text: assistantText,
      },
    };
    this.onEventHandler?.({
      type: 'event',
      event: 'chat',
      payload,
    });
    this.onEventHandler?.({
      type: 'typed_event',
      event: 'chat',
      payload,
    });
    this.onEventHandler?.({
      type: 'typed_event',
      event: 'run.completed',
      payload: {
        sessionKey,
        runId,
        summary: assistantText.slice(0, 200),
      },
    });
    return { sessionKey };
  }

  cancelChat(sessionKey: string): void {
    if (!window.relay?.acpCancel) {
      return;
    }
    this.log('info', 'Cancelling ACP prompt', { sessionKey });
    void window.relay.acpCancel({ sessionId: sessionKey });
  }

  async resolveSessionKey(preferredKey?: string): Promise<string> {
    const normalized = preferredKey?.trim() || 'main';
    if (!this.sessions.has(normalized)) {
      this.sessions.set(normalized, { key: normalized, kind: 'chat' });
    }
    return normalized;
  }

  async getHistory(sessionKey: string, limit = 50): Promise<GatewayChatMessage[]> {
    if (!window.relay?.acpGetHistory) {
      return [];
    }
    const items = await window.relay.acpGetHistory({ sessionId: sessionKey, limit });
    return items.map((item) => ({
      id: item.id,
      role: item.role,
      text: item.text,
    }));
  }

  async listModels(): Promise<GatewayModelChoice[]> {
    this.models = await this.refreshModelsFromAvailableSources();
    this.log('info', 'listModels resolved', { count: this.models.length });
    return this.models;
  }

  async getSessionModel(sessionKey: string): Promise<string | null> {
    if (this.currentModelValue) {
      return this.currentModelValue;
    }
    if (!window.relay?.acpGetSessionModel) {
      return null;
    }
    const result = await window.relay.acpGetSessionModel({ sessionId: sessionKey });
    const modelValue = result.model ?? null;
    this.currentModelValue = modelValue;
    return modelValue;
  }

  async listSessions(limit = 200): Promise<GatewaySessionSummary[]> {
    if (!window.relay?.acpListSessions) {
      return Array.from(this.sessions.values()).slice(0, limit);
    }
    const items = await window.relay.acpListSessions({ limit });
    return items.map((item) => ({
      key: item.key,
      kind: item.kind,
      title: item.title,
    }));
  }

  async setSessionModel(sessionKey: string, modelValue: string | null): Promise<void> {
    const normalizedValue = modelValue?.trim() || null;
    this.log('info', 'setSessionModel requested', { sessionKey, modelValue: normalizedValue ?? '(default)' });

    // Preferred path: ACP session-level model switch when server supports it.
    if (window.relay?.acpSetSessionModel) {
      try {
        const result = await window.relay.acpSetSessionModel({ sessionId: sessionKey, modelValue: normalizedValue });
        if (result?.applied) {
          this.currentModelValue = normalizedValue;
          this.log('info', 'setSessionModel applied via ACP session API', { sessionKey });
          return;
        }
        this.log('warn', 'ACP session model switch not applied; trying Hermes main model fallback', {
          sessionKey,
          reason: result?.reason ?? 'unknown',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log('warn', 'ACP session model switch failed, trying Hermes main model fallback', {
          sessionKey,
          error: message,
        });
      }
    }

    // Fallback path: switch Hermes main model via dashboard API bridge.
    if (normalizedValue && window.relay?.hermesSetMainModel) {
      const splitIndex = normalizedValue.indexOf('::');
      const provider = splitIndex > 0 ? normalizedValue.slice(0, splitIndex).trim() : '';
      const model = splitIndex > 0 ? normalizedValue.slice(splitIndex + 2).trim() : normalizedValue;
      if (!provider || !model) {
        throw new Error(`Invalid model value "${normalizedValue}". Expected "provider::model".`);
      }
      const result = await window.relay.hermesSetMainModel({ provider, model });
      const confirmedProviderFromResult = typeof result.confirmedProvider === 'string' ? result.confirmedProvider.trim() : '';
      const confirmedModelFromResult = typeof result.confirmedModel === 'string' ? result.confirmedModel.trim() : '';
      if (confirmedProviderFromResult && confirmedModelFromResult) {
        const expected = `${provider.toLowerCase()}::${model.toLowerCase()}`;
        const actual = `${confirmedProviderFromResult.toLowerCase()}::${confirmedModelFromResult.toLowerCase()}`;
        if (expected !== actual) {
          throw new Error(
            `Hermes kept ${confirmedProviderFromResult}/${confirmedModelFromResult} instead of requested ${provider}/${model}.`,
          );
        }
      }

      // Secondary verification through model options to avoid false-success states.
      if (window.relay?.hermesModelOptions) {
        const options = await window.relay.hermesModelOptions({});
        const activeProvider = typeof options.provider === 'string' ? options.provider.trim() : '';
        const activeModel = typeof options.model === 'string' ? options.model.trim() : '';
        if (activeProvider && activeModel) {
          const expected = `${provider.toLowerCase()}::${model.toLowerCase()}`;
          const actual = `${activeProvider.toLowerCase()}::${activeModel.toLowerCase()}`;
          if (expected !== actual) {
            throw new Error(`Hermes active model is ${activeProvider}/${activeModel}, not ${provider}/${model}.`);
          }
        }
      }

      this.currentModelValue = normalizedValue;
      this.log('info', 'setSessionModel applied via Hermes main model API', { provider, model });
      return;
    }

    if (!normalizedValue) {
      this.currentModelValue = null;
      this.log('info', 'Model reset requested; keeping server default');
      return;
    }

    throw new Error('Model switching is unavailable: ACP server does not support session switching and Hermes main model API is unavailable.');
  }

  async setSessionTitle(_sessionKey: string, _title: string | null): Promise<void> {
    // no-op in stub
  }

  async deleteSession(_sessionKey: string): Promise<void> {
    if (window.relay?.acpCloseSession) {
      await window.relay.acpCloseSession({ sessionId: _sessionKey });
    }
    this.sessions.delete(_sessionKey);
  }

  async listCronJobs(): Promise<GatewayCronJob[]> {
    return [];
  }

  async createCronJob(_input: GatewayCreateCronJobInput): Promise<string | null> {
    return null;
  }

  async updateCronJob(_input: GatewayUpdateCronJobInput): Promise<void> {
    // no-op in stub
  }

  async deleteCronJob(_idInput: string): Promise<void> {
    // no-op in stub
  }

  async fetchToolsCatalog(): Promise<GatewayToolsCatalog> {
    return { tools: [] };
  }

  async listWorkspaceFiles(_relativePath?: string): Promise<{
    items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>;
    truncated: boolean;
  }> {
    return { items: [], truncated: false };
  }

  async readWorkspaceFile(_relativePath: string): Promise<{ content: string }> {
    throw new Error('ACP transport stub does not support file reads yet.');
  }

  async statWorkspaceFile(_relativePath: string): Promise<{
    kind: 'file' | 'directory';
    size: number;
    createdMs: number;
    modifiedMs: number;
  }> {
    throw new Error('ACP transport stub does not support file stat yet.');
  }

  async renameWorkspaceFile(_oldPath: string, _newPath: string): Promise<void> {
    throw new Error('ACP transport stub does not support rename yet.');
  }

  async deleteWorkspaceFile(_path: string): Promise<void> {
    throw new Error('ACP transport stub does not support delete yet.');
  }

  async writeWorkspaceFile(_path: string, _content: string): Promise<void> {
    throw new Error('ACP transport stub does not support write yet.');
  }

  private async refreshModelsFromAvailableSources(): Promise<GatewayModelChoice[]> {
    // Source 1: ACP unstable providers (if exposed by the running Electron bridge).
    if (window.relay?.acpListModels) {
      try {
        const acpModels = await window.relay.acpListModels();
        if (Array.isArray(acpModels) && acpModels.length > 0) {
          return acpModels;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log('warn', 'acpListModels failed; trying Hermes model options fallback', { error: message });
      }
    }

    // Source 2: Hermes dashboard model options (docs-supported source of authenticated provider/model lists).
    if (window.relay?.hermesModelOptions) {
      try {
        const options = await window.relay.hermesModelOptions({});
        const providers = Array.isArray(options?.providers) ? options.providers : [];
        const mapped: GatewayModelChoice[] = [];
        for (const provider of providers) {
          const providerSlug = typeof provider?.slug === 'string' ? provider.slug.trim() : '';
          const models = Array.isArray(provider?.models) ? provider.models : [];
          if (!providerSlug) continue;
          for (const modelId of models) {
            const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
            if (!normalizedModelId) continue;
            mapped.push({
              value: `${providerSlug}::${normalizedModelId}`,
              label: `${normalizedModelId} (${providerSlug})`,
            });
          }
        }
        if (mapped.length > 0) {
          return mapped;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log('warn', 'hermesModelOptions fallback failed', { error: message });
      }
    }

    return [];
  }

  private async fetchFallbackCompletion(promptText: string): Promise<string | null> {
    if (!window.relay?.backendHttpRequest || !this.gatewayBaseUrl.trim()) {
      return null;
    }
    try {
      const baseUrl = this.gatewayBaseUrl.trim().replace(/\/+$/, '');
      const modelValue = this.currentModelValue?.trim() || '';
      const model = modelValue.includes('::') ? modelValue.split('::')[1] : modelValue;
      const body = JSON.stringify({
        ...(model ? { model } : {}),
        messages: [{ role: 'user', content: promptText }],
      });
      const response = await window.relay.backendHttpRequest({
        baseUrl,
        path: '/chat/completions',
        method: 'POST',
        token: this.gatewayToken || undefined,
        body,
      });
      if (!response.ok) {
        return null;
      }
      const parsed = JSON.parse(response.body ?? '{}') as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return content.trim();
      }
      return null;
    } catch (error) {
      this.log('warn', 'Hermes HTTP fallback completion failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
