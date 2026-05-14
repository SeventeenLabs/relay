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
type SessionRunState = {
  runId: string;
  buffer: string;
  messageId: string | null;
  closed: boolean;
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
  private currentModelBySession = new Map<string, string | null>();
  private runStateBySession = new Map<string, SessionRunState>();
  private latestModelCatalog: HermesModelChoice[] = [];
  private currentCwd: string | null = null;

  private normalizeModelId(value: string): string {
    const normalized = value.trim();
    if (!normalized) return '';
    return normalized.replace('/', ':');
  }

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
    const update = (event.update ?? {}) as Record<string, unknown>;
    const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '';
    this.log('info', 'ACP session update', {
      sessionId: sessionKey,
      kind,
      keys: Object.keys(update).slice(0, 12),
    });

    const getOrCreateRunState = (): SessionRunState => {
      const existing = this.runStateBySession.get(sessionKey);
      if (existing) return existing;
      const created: SessionRunState = { runId: `acp-${Date.now()}`, buffer: '', messageId: null, closed: false };
      this.runStateBySession.set(sessionKey, created);
      return created;
    };

    const emitChatState = (state: 'delta' | 'final', text: string) => {
      const run = getOrCreateRunState();
      this.log('info', 'ACP emit chat state', { sessionId: sessionKey, runId: run.runId, state, chars: text.length });
      const payload = {
        sessionKey,
        runId: run.runId,
        state,
        message: {
          id: `${run.runId}-${state}`,
          role: 'assistant' as const,
          text,
        },
      };
      this.emitLegacyEvent({ type: 'event', event: 'chat', payload });
    };

    if (kind === 'agent_message_start') {
      const messageId = typeof update.messageId === 'string' && update.messageId.trim()
        ? update.messageId.trim()
        : null;
      const run = getOrCreateRunState();
      run.messageId = messageId;
      run.closed = false;
      return;
    }

    if (kind === 'agent_message_chunk') {
      const content = update.content && typeof update.content === 'object'
        ? (update.content as Record<string, unknown>)
        : null;
      let chunkText = '';
      if (content?.type === 'text' && typeof content.text === 'string') {
        chunkText = content.text;
      } else if (content?.type === 'resource') {
        const resource = content.resource && typeof content.resource === 'object'
          ? (content.resource as Record<string, unknown>)
          : null;
        if (typeof resource?.text === 'string') {
          chunkText = resource.text;
        }
      }
      if (!chunkText) {
        this.log('warn', 'ACP text chunk ignored (non-text content)', {
          sessionId: sessionKey,
          contentType: typeof content?.type === 'string' ? content.type : '(unknown)',
        });
        return;
      }
      const messageId = typeof update.messageId === 'string' && update.messageId.trim()
        ? update.messageId.trim()
        : null;
      const run = getOrCreateRunState();
      if (messageId && run.messageId && messageId !== run.messageId) {
        run.buffer = '';
      }
      run.messageId = messageId;
      run.closed = false;
      run.buffer += chunkText;
      emitChatState('delta', run.buffer);
      return;
    }

    if (kind === 'agent_message_end') {
      const run = getOrCreateRunState();
      run.closed = true;
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
    this.currentCwd = typeof options.cwd === 'string' && options.cwd.trim() ? options.cwd.trim() : this.currentCwd;
    this.log('info', 'Connect requested', { gatewayUrl });
    const requestId = ++this.requestCounter;
    const startedAt = Date.now();
    try {
      this.releaseAcpEvents?.();
      this.releaseAcpEvents = relay.onAcpEvent(this.onAcpUpdate);
      const result = await relay.acpConnect({
        gatewayUrl,
        cwd: this.currentCwd ?? undefined,
      });
      this.activeSessionId = result.sessionId;
      this.ensureSession(result.sessionId, 'main');
      this.currentModelBySession.set(result.sessionId, null);
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
    this.currentModelBySession.clear();
    this.runStateBySession.clear();
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
    const result = await relay.acpCreateSession({
      cwd: this.currentCwd ?? undefined,
    });
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
    this.runStateBySession.set(key, { runId, buffer: '', messageId: null, closed: false });
    this.emitTypedEvent('run.started', { sessionKey: key, runId, label: 'ACP run started' });
    await relay.acpPrompt({ sessionId: key, text });

    // Give ACP stream callbacks a short drain window after prompt completion.
    let run = this.runStateBySession.get(key);
    let lastSize = run?.buffer.length ?? 0;
    for (let i = 0; i < 10; i += 1) {
      if (!run) break;
      if (run.closed) break;
      await new Promise((resolve) => setTimeout(resolve, 80));
      run = this.runStateBySession.get(key);
      const nextSize = run?.buffer.length ?? 0;
      if (nextSize === lastSize) {
        break;
      }
      lastSize = nextSize;
    }

    if (run && run.buffer.length > 0) {
      session.history.push({
        id: `${run.runId}-assistant`,
        role: 'assistant',
        text: run.buffer,
      });
      this.emitLegacyEvent({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: key,
          runId: run.runId,
          state: 'final',
          message: {
            id: `${run.runId}-final`,
            role: 'assistant',
            text: run.buffer,
          },
        },
      });
    } else {
      this.log('warn', 'ACP prompt finished without agent text chunks', { sessionId: key, runId });
      this.emitLegacyEvent({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: key,
          runId,
          state: 'error',
          errorMessage: 'No assistant text was received from ACP.',
        },
      });
    }
    this.runStateBySession.delete(key);
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
    const relay = this.requireRelayBridge();
    this.log('info', 'Loading ACP models', { sessionId: '(catalog)' });
    const result = await relay.acpListModels();
    const mapped = (result.models ?? [])
      .map((model) => {
        const value = typeof model.id === 'string' ? model.id.trim() : '';
        const name = typeof model.name === 'string' ? model.name.trim() : '';
        if (!value) return null;
        return {
          value,
          label: name || value,
        };
      })
      .filter((entry): entry is HermesModelChoice => Boolean(entry));
    const byId = new Map<string, HermesModelChoice>();
    for (const existing of this.latestModelCatalog) {
      byId.set(existing.value, existing);
    }
    for (const next of mapped) {
      byId.set(next.value, next);
    }
    this.latestModelCatalog = Array.from(byId.values());
    this.log('info', 'ACP models loaded', {
      sessionId: '(catalog)',
      fetchedCount: mapped.length,
      mergedCount: this.latestModelCatalog.length,
      currentModelId: result.currentModelId ?? null,
    });
    return this.latestModelCatalog;
  }

  async getSessionModel(sessionKey: string): Promise<string | null> {
    const relay = this.requireRelayBridge();
    const key = sessionKey.trim() || this.activeSessionId || '';
    if (!key) return null;
    const result = await relay.acpListModels({ sessionId: key });
    const current = result.currentModelId ?? null;
    this.currentModelBySession.set(key, current);
    this.log('info', 'ACP current model read', { sessionId: key, currentModelId: current });
    return current;
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
    const key = sessionKey.trim();
    const requested = modelValue.trim();
    const separatorIndex = requested.indexOf('::');
    const candidate = separatorIndex >= 0 ? requested.slice(separatorIndex + 2).trim() : requested;
    const normalizedCandidate = this.normalizeModelId(candidate);
    const resolvedFromCatalog =
      this.latestModelCatalog.find((entry) => entry.value.trim() === candidate)?.value ??
      this.latestModelCatalog.find((entry) => this.normalizeModelId(entry.value) === normalizedCandidate)?.value ??
      candidate;

    this.log('info', 'Setting ACP model', {
      sessionId: key,
      requested,
      candidate,
      resolvedModelId: resolvedFromCatalog,
    });
    const result = await relay.acpSetSessionModel({ sessionId: key, model: resolvedFromCatalog });
    if (!result.ok) {
      throw new HermesRequestError(result.message ?? 'Failed to set ACP model.', 'not_supported');
    }
    const verify = await relay.acpListModels({ sessionId: key }).catch(() => null);
    const currentAfterSet = verify?.currentModelId ?? resolvedFromCatalog;
    this.currentModelBySession.set(key, currentAfterSet);
    const session = this.sessions.get(key);
    if (session) {
      session.model = currentAfterSet;
    }
    this.log('info', 'ACP model set succeeded', {
      sessionId: key,
      requested,
      appliedModelId: resolvedFromCatalog,
      currentModelId: currentAfterSet,
    });
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
    const relay = this.requireRelayBridge();
    const relativePath = (_relativePath ?? '').trim();
    this.log('info', 'ACP workspace.list start', { path: relativePath || '(root)' });
    const raw = await relay.acpWorkspaceList({ path: relativePath });
    const items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }> = [];
    if (Array.isArray(raw?.items)) {
      for (const entry of raw.items) {
        const path = typeof entry?.path === 'string' ? entry.path.trim() : '';
        if (!path) continue;
        const rawKind = typeof entry?.kind === 'string' ? entry.kind.trim().toLowerCase() : '';
        items.push({
          path,
          kind: rawKind === 'directory' ? 'directory' : 'file',
          size: typeof entry?.size === 'number' ? entry.size : undefined,
          modifiedMs: typeof entry?.modifiedMs === 'number' ? entry.modifiedMs : undefined,
        });
      }
    }
    const truncated = Boolean(raw?.truncated);
    this.log('info', 'ACP workspace.list done', { path: relativePath || '(root)', count: items.length, truncated });
    return { items, truncated };
  }

  async readWorkspaceFile(_relativePath: string): Promise<{ content: string }> {
    const relay = this.requireRelayBridge();
    const relativePath = _relativePath.trim();
    this.log('info', 'ACP workspace.read start', { path: relativePath });
    const raw = await relay.acpWorkspaceRead({ path: relativePath });
    const content = typeof raw?.content === 'string' ? raw.content : '';
    this.log('info', 'ACP workspace.read done', { path: relativePath, chars: content.length });
    return { content };
  }

  async statWorkspaceFile(_relativePath: string): Promise<{ kind: 'file' | 'directory'; size: number; createdMs: number; modifiedMs: number; }> {
    const relay = this.requireRelayBridge();
    const relativePath = _relativePath.trim();
    this.log('info', 'ACP workspace.stat start', { path: relativePath });
    const raw = await relay.acpWorkspaceStat({ path: relativePath });
    const rawKind = typeof raw?.kind === 'string' ? raw.kind.trim().toLowerCase() : '';
    const result = {
      kind: rawKind === 'directory' ? 'directory' : 'file',
      size: typeof raw?.size === 'number' ? raw.size : 0,
      createdMs: typeof raw?.createdMs === 'number' ? raw.createdMs : 0,
      modifiedMs: typeof raw?.modifiedMs === 'number' ? raw.modifiedMs : 0,
    } as const;
    this.log('info', 'ACP workspace.stat done', { path: relativePath, kind: result.kind, size: result.size });
    return result;
  }

  async renameWorkspaceFile(_oldPath: string, _newPath: string): Promise<void> {
    const relay = this.requireRelayBridge();
    const oldPath = _oldPath.trim();
    const newPath = _newPath.trim();
    this.log('info', 'ACP workspace.rename start', { oldPath, newPath });
    await relay.acpWorkspaceRename({ oldPath, newPath });
    this.log('info', 'ACP workspace.rename done', { oldPath, newPath });
  }

  async deleteWorkspaceFile(_path: string): Promise<void> {
    const relay = this.requireRelayBridge();
    const targetPath = _path.trim();
    this.log('info', 'ACP workspace.delete start', { path: targetPath });
    await relay.acpWorkspaceDelete({ path: targetPath });
    this.log('info', 'ACP workspace.delete done', { path: targetPath });
  }

  async writeWorkspaceFile(_path: string, _content: string): Promise<void> {
    const relay = this.requireRelayBridge();
    const targetPath = _path.trim();
    this.log('info', 'ACP workspace.write start', { path: targetPath, chars: _content.length });
    await relay.acpWorkspaceWrite({ path: targetPath, content: _content });
    this.log('info', 'ACP workspace.write done', { path: targetPath, chars: _content.length });
  }
}
