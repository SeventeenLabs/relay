import type {
  AgentBackendEvent,
  BackendTypedEventName,
  LegacyAgentBackendEvent,
} from './agent-backend-client';
import type {
  HermesChatMessage,
  HermesConnectOptions,
  HermesCreateCronJobInput,
  HermesCronJob,
  HermesModelChoice,
  HermesSessionSummary,
  HermesToolEntry,
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

const HERMES_CLIENT_LOG_PREFIX = '[Relay:HermesACPClient]';

export class HermesAcpClient {
  private connected = false;
  private gatewayUrl: string | null = null;
  private onEventHandler: ((event: AgentBackendEvent) => void) | null = null;
  private onConnectionHandler: ((connected: boolean, message: string) => void) | null = null;
  private sessions = new Map<string, StoredSession>();
  private activeSessionId: string | null = null;
  private releaseAcpEvents: (() => void) | null = null;
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

  private onAcpUpdate = (event: { sessionId: string; update: unknown }) => {
    const sessionKey = event.sessionId;
    const session = this.ensureSession(sessionKey, sessionKey === 'main' ? 'main' : 'chat');
    const update = (event.update ?? {}) as Record<string, unknown>;
    const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '';

    if (kind === 'agent_message_chunk') {
      const content = (update.content ?? {}) as Record<string, unknown>;
      if (content.type === 'text' && typeof content.text === 'string') {
        const text = content.text;
        const runId = `acp-${Date.now()}`;
        session.history.push({
          id: `${runId}-assistant`,
          role: 'assistant',
          text,
        });
        const payload = {
          sessionKey,
          runId,
          state: 'final',
          message: {
            id: `${runId}-final`,
            role: 'assistant' as const,
            text,
          },
        };
        this.emitLegacyEvent({ type: 'event', event: 'chat', payload });
        this.emitTypedEvent('chat', payload);
      }
      return;
    }

    if (kind === 'tool_call' || kind === 'tool_call_update' || kind === 'plan') {
      const label = kind === 'plan'
        ? 'Plan update'
        : typeof update.title === 'string'
          ? update.title
          : kind === 'tool_call'
            ? 'Tool call'
            : 'Tool update';
      this.emitTypedEvent('run.activity', {
        sessionKey,
        runId: `acp-${Date.now()}`,
        activityItems: [{ id: `activity-${Date.now()}`, label, tone: 'neutral' }],
      });
    }
  };

  private requireRelayBridge() {
    if (!window.relay?.acpConnect) {
      throw new HermesRequestError('ACP bridge is unavailable in this build.', 'not_supported');
    }
    return window.relay;
  }

  async connect(options: HermesConnectOptions): Promise<void> {
    const relay = this.requireRelayBridge();
    const gatewayUrl = (options.gatewayUrl ?? '').trim();
    if (!gatewayUrl) {
      throw new Error('Hermes ACP endpoint is required.');
    }

    this.gatewayUrl = gatewayUrl;
    this.log('info', 'Connect requested', { gatewayUrl });
    const requestId = ++this.requestCounter;
    const startedAt = Date.now();
    try {
      this.releaseAcpEvents?.();
      this.releaseAcpEvents = relay.onAcpEvent(this.onAcpUpdate);
      const result = await relay.acpConnect({ gatewayUrl });
      this.activeSessionId = result.sessionId;
      this.ensureSession(result.sessionId, 'main');
      this.connected = true;
      this.log('info', 'Connected via ACP', { requestId, gatewayUrl, sessionId: result.sessionId, durationMs: Date.now() - startedAt });
      this.onConnectionHandler?.(true, `Connected via ACP (${gatewayUrl})`);
    } catch (error) {
      this.connected = false;
      const message = error instanceof Error ? error.message : 'ACP connection failed.';
      this.log('error', 'Connect failed', { requestId, gatewayUrl, durationMs: Date.now() - startedAt, error: message });
      this.onConnectionHandler?.(false, message);
      throw error;
    }
  }

  disconnect() {
    this.releaseAcpEvents?.();
    this.releaseAcpEvents = null;
    void window.relay?.acpDisconnect?.();
    this.connected = false;
    this.onConnectionHandler?.(false, 'Disconnected from ACP.');
    this.log('info', 'Disconnected');
  }

  resetDeviceIdentity() {
    // no-op in ACP mode
  }

  async getDeviceId(): Promise<string> {
    return 'acp-client';
  }

  async getActiveSessionKey(): Promise<string> {
    return this.activeSessionId ?? 'main';
  }

  private async createSession(kind: 'chat' | 'cowork'): Promise<string> {
    const relay = this.requireRelayBridge();
    const result = await relay.acpCreateSession({});
    const key = result.sessionId;
    this.ensureSession(key, kind);
    if (!this.activeSessionId) {
      this.activeSessionId = key;
    }
    return key;
  }

  async createChatSession(): Promise<string> {
    return this.createSession('chat');
  }

  async createCoworkSession(): Promise<string> {
    return this.createSession('cowork');
  }

  async sendChat(sessionKey: string, text: string): Promise<{ sessionKey: string }> {
    const relay = this.requireRelayBridge();
    if (!this.connected) {
      throw new Error('Hermes ACP client is not connected.');
    }
    const key = sessionKey.trim();
    const session = this.ensureSession(key, key.toLowerCase().includes('cowork') ? 'cowork' : 'chat');
    session.history.push({
      id: `user-${Date.now()}`,
      role: 'user',
      text,
    });
    const runId = `acp-${Date.now()}`;
    this.emitTypedEvent('run.started', { sessionKey: key, runId, label: 'ACP run started' });
    await relay.acpPrompt({ sessionId: key, text });
    return { sessionKey: key };
  }

  cancelChat(sessionKey: string): void {
    const relay = this.requireRelayBridge();
    void relay.acpCancel({ sessionId: sessionKey.trim() });
  }

  async resolveSessionKey(preferredKey = 'main'): Promise<string> {
    const key = preferredKey.trim();
    if (key) {
      this.ensureSession(key, key === 'main' ? 'main' : 'chat');
      return key;
    }
    if (this.activeSessionId) {
      return this.activeSessionId;
    }
    return 'main';
  }

  async getHistory(sessionKey: string, limit = 50): Promise<HermesChatMessage[]> {
    const session = this.sessions.get(sessionKey.trim());
    if (!session) return [];
    return session.history.slice(-Math.max(1, limit));
  }

  async listModels(): Promise<HermesModelChoice[]> {
    // ACP does not guarantee model discovery in a stable way.
    return [{ value: 'hermes-agent', label: 'hermes-agent' }];
  }

  async getSessionModel(_sessionKey: string): Promise<string | null> {
    return null;
  }

  async listSessions(limit = 200): Promise<HermesSessionSummary[]> {
    const relay = this.requireRelayBridge();
    try {
      const sessions = await relay.acpListSessions();
      for (const item of sessions) {
        const existing = this.sessions.get(item.id);
        if (!existing) {
          this.sessions.set(item.id, {
            key: item.id,
            kind: 'chat',
            title: item.title,
            history: [],
          });
        }
      }
    } catch {
      // keep local cache only
    }

    return Array.from(this.sessions.values())
      .slice(-Math.max(1, limit))
      .map((entry) => ({ key: entry.key, kind: entry.kind, title: entry.title }));
  }

  async setSessionModel(sessionKey: string, modelValue: string | null): Promise<void> {
    if (!modelValue) return;
    const relay = this.requireRelayBridge();
    const result = await relay.acpSetSessionModel({ sessionId: sessionKey.trim(), model: modelValue.trim() });
    if (!result.ok) {
      throw new HermesRequestError(result.message ?? 'Failed to set ACP model.', 'not_supported');
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
    throw new HermesRequestError('Cron jobs are not available in ACP mode.', 'not_supported');
  }

  async updateCronJob(_input: HermesUpdateCronJobInput): Promise<void> {
    throw new HermesRequestError('Cron jobs are not available in ACP mode.', 'not_supported');
  }

  async deleteCronJob(_idInput: string): Promise<void> {
    throw new HermesRequestError('Cron jobs are not available in ACP mode.', 'not_supported');
  }

  async fetchToolsCatalog(): Promise<HermesToolsCatalog> {
    const tools: HermesToolEntry[] = [];
    return { tools };
  }

  async listWorkspaceFiles(_relativePath?: string): Promise<{ items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>; truncated: boolean; }> {
    throw new HermesRequestError('workspace.list is not implemented for ACP mode in Relay yet.', 'method_not_found');
  }

  async readWorkspaceFile(_relativePath: string): Promise<{ content: string }> {
    throw new HermesRequestError('workspace.read is not implemented for ACP mode in Relay yet.', 'method_not_found');
  }

  async statWorkspaceFile(_relativePath: string): Promise<{ kind: 'file' | 'directory'; size: number; createdMs: number; modifiedMs: number; }> {
    throw new HermesRequestError('workspace.stat is not implemented for ACP mode in Relay yet.', 'method_not_found');
  }

  async renameWorkspaceFile(_oldPath: string, _newPath: string): Promise<void> {
    throw new HermesRequestError('workspace.rename is not implemented for ACP mode in Relay yet.', 'method_not_found');
  }

  async deleteWorkspaceFile(_path: string): Promise<void> {
    throw new HermesRequestError('workspace.delete is not implemented for ACP mode in Relay yet.', 'method_not_found');
  }

  async writeWorkspaceFile(_path: string, _content: string): Promise<void> {
    throw new HermesRequestError('workspace.write is not implemented for ACP mode in Relay yet.', 'method_not_found');
  }
}
