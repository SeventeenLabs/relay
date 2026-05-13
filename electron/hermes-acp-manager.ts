import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

type AcpSession = {
  sessionId: string;
  cwd: string;
  model?: string | null;
  history: Array<{ id: string; role: 'user' | 'assistant' | 'system'; text: string }>;
  updatedAt: number;
};

type PromptBuffer = {
  chunks: string[];
  activityItems: Array<{ id: string; label: string; details: string; tone: 'neutral' | 'success' | 'danger' }>;
  contextWindowUsed?: number;
  contextWindowSize?: number;
};

export type AcpLiveActivityEvent = {
  sessionId: string;
  item: { id: string; label: string; details: string; tone: 'neutral' | 'success' | 'danger' };
};

const ACP_LOG_PREFIX = '[Relay:ACP]';
const isWindows = process.platform === 'win32';
const ACP_MANAGER_BUILD_ID = 'acp-manager-2026-05-13-wsl-shell-v2';
const ACP_ENABLE_UNSTABLE = process.env.RELAY_ACP_ENABLE_UNSTABLE === '1';

function log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  if (level === 'error') {
    console.error(ACP_LOG_PREFIX, message, meta ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(ACP_LOG_PREFIX, message, meta ?? '');
    return;
  }
  console.info(ACP_LOG_PREFIX, message, meta ?? '');
}

function documentedLaunchCandidates(): Array<{ command: string; args: string[]; label: string }> {
  // Docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/acp
  // "Any of the following starts Hermes in ACP mode:
  //  hermes acp
  //  hermes-acp
  //  python -m acp_adapter"
  if (isWindows) {
    const distro = process.env.RELAY_HERMES_WSL_DISTRO?.trim() || process.env.HERMES_WSL_DISTRO?.trim() || '';
    const wslShellPrefix = distro ? ['-d', distro, '--', 'bash', '-lic'] : ['--', 'bash', '-lic'];
    const wslCandidates = [
      {
        command: 'wsl.exe',
        args: [...wslShellPrefix, 'hermes acp'],
        label: distro ? `wsl distro ${distro}: hermes acp` : 'wsl default distro: hermes acp',
      },
      {
        command: 'wsl.exe',
        args: [...wslShellPrefix, 'hermes-acp'],
        label: distro ? `wsl distro ${distro}: hermes-acp` : 'wsl default distro: hermes-acp',
      },
      {
        command: 'wsl.exe',
        args: [...wslShellPrefix, 'python -m acp_adapter'],
        label: distro ? `wsl distro ${distro}: python -m acp_adapter` : 'wsl default distro: python -m acp_adapter',
      },
    ];
    return wslCandidates;
  }

  return [
    { command: 'hermes', args: ['acp'], label: 'hermes acp' },
    { command: 'hermes-acp', args: [], label: 'hermes-acp' },
    { command: 'python', args: ['-m', 'acp_adapter'], label: 'python -m acp_adapter' },
  ];
}

export class HermesAcpManager {
  private process: ReturnType<typeof spawn> | null = null;
  private connection: any | null = null;
  private sessions = new Map<string, AcpSession>();
  private promptBuffers = new Map<string, PromptBuffer>();
  private initialized = false;
  private ensureInFlight: Promise<{ ok: boolean }> | null = null;
  private supportsListProviders = true;
  private listProvidersUnsupportedLogged = false;
  private constructorLogged = false;
  private liveActivityListeners = new Set<(event: AcpLiveActivityEvent) => void>();

  private emitLiveActivity(event: AcpLiveActivityEvent) {
    for (const listener of this.liveActivityListeners) {
      try {
        listener(event);
      } catch (error) {
        log('warn', 'ACP live activity listener failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  onLiveActivity(listener: (event: AcpLiveActivityEvent) => void): () => void {
    this.liveActivityListeners.add(listener);
    return () => {
      this.liveActivityListeners.delete(listener);
    };
  }

  private logBuildInfoOnce() {
    if (this.constructorLogged) return;
    this.constructorLogged = true;
    log('info', 'ACP manager loaded', {
      buildId: ACP_MANAGER_BUILD_ID,
      platform: process.platform,
      node: process.version,
    });
  }

  private async startWithCandidate(command: string, args: string[], label: string): Promise<void> {
    log('info', 'Starting ACP process', { command, args, label });
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error(`Failed to start ACP command "${command} ${args.join(' ')}": missing stdio pipes`);
    }

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const lines = chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        log('info', 'Hermes stderr', { line });
      }
    });

    const output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(output, input);

    const manager = this;
    const client: any = {
      async requestPermission(_params: unknown) {
        return { outcome: { outcome: 'cancelled' } };
      },
      async sessionUpdate(params: any) {
        try {
          const update = params?.update;
          const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';
          if (!sessionId || !update) return;
          if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
            const text = typeof update.content.text === 'string' ? update.content.text : '';
            if (!text) return;
            const buffer = manager.promptBuffers.get(sessionId);
            if (buffer) {
              buffer.chunks.push(text);
              log('info', 'ACP chunk buffered', { sessionId, chunkLength: text.length, totalChunks: buffer.chunks.length });
            } else {
              log('warn', 'ACP chunk arrived without prompt buffer', { sessionId, chunkLength: text.length });
            }
            return;
          }

          const sessionUpdateKind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '';
          if (sessionUpdateKind === 'usage_update') {
            const buffer = manager.promptBuffers.get(sessionId);
            if (!buffer) return;
            const size = typeof update.size === 'number' ? update.size : undefined;
            const used = typeof update.used === 'number' ? update.used : undefined;
            if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
              buffer.contextWindowSize = size;
            }
            if (typeof used === 'number' && Number.isFinite(used) && used >= 0) {
              buffer.contextWindowUsed = used;
            }
            return;
          }
          const isToolUpdate =
            sessionUpdateKind === 'tool_call' ||
            sessionUpdateKind === 'tool_call_update' ||
            sessionUpdateKind === 'tool_result' ||
            sessionUpdateKind === 'tool_result_update' ||
            sessionUpdateKind.includes('tool_call');
          if (isToolUpdate) {
            const buffer = manager.promptBuffers.get(sessionId);
            if (!buffer) return;
            const toolCall = (update as { toolCall?: Record<string, unknown> }).toolCall ?? {};
            const toolIdRaw = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : `tool-${Date.now()}`;
            const toolKind = typeof toolCall.kind === 'string' ? toolCall.kind.trim() : '';
            const status = typeof toolCall.status === 'string' ? toolCall.status : '';
            const tone: 'neutral' | 'success' | 'danger' =
              status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'neutral';
            const toOneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
            const toShort = (value: string, max = 120) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
            const parseLooseObject = (value: unknown): Record<string, unknown> | null => {
              if (!value || typeof value !== 'object') return null;
              return value as Record<string, unknown>;
            };
            const pickKeyValue = (record: Record<string, unknown> | null, keys: string[]): string => {
              if (!record) return '';
              for (const key of keys) {
                const raw = record[key];
                if (typeof raw === 'string' && raw.trim()) return raw.trim();
                if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
              }
              return '';
            };
            const pickAnyNested = (record: Record<string, unknown> | null, keys: string[]): string => {
              if (!record) return '';
              for (const key of keys) {
                const direct = record[key];
                if (typeof direct === 'string' && direct.trim()) return direct.trim();
                const nested = parseLooseObject(direct);
                const nestedPicked = pickKeyValue(nested, keys);
                if (nestedPicked) return nestedPicked;
              }
              return '';
            };
            const parseJsonLikeObject = (value: unknown): Record<string, unknown> | null => {
              if (typeof value !== 'string') return null;
              const raw = value.trim();
              if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) return null;
              try {
                const parsed = JSON.parse(raw);
                return parseLooseObject(parsed);
              } catch {
                return null;
              }
            };
            const argsCandidate =
              (toolCall as Record<string, unknown>).input ??
              (toolCall as Record<string, unknown>).arguments ??
              (toolCall as Record<string, unknown>).rawInput ??
              null;
            const outputCandidate =
              (toolCall as Record<string, unknown>).output ??
              (toolCall as Record<string, unknown>).result ??
              (toolCall as Record<string, unknown>).error ??
              null;
            const updateRecord = parseLooseObject(update);
            const argsRecord =
              parseLooseObject(argsCandidate) ??
              parseLooseObject((toolCall as Record<string, unknown>).args ?? null) ??
              parseJsonLikeObject((toolCall as Record<string, unknown>).rawInput) ??
              parseLooseObject((updateRecord?.toolCall as unknown) ?? null) ??
              null;
            const outputRecord =
              parseLooseObject(outputCandidate) ??
              parseLooseObject((toolCall as Record<string, unknown>).result ?? null) ??
              null;
            const toolName =
              (typeof toolCall.name === 'string' && toolCall.name.trim()) ||
              (typeof toolCall.title === 'string' && toolCall.title.trim()) ||
              pickKeyValue(argsRecord, ['tool', 'toolName', 'name', 'method']) ||
              pickAnyNested(updateRecord, ['tool', 'toolName', 'name', 'method']) ||
              toolKind ||
              'tool';
            const commandHint =
              pickKeyValue(argsRecord, ['command', 'cmd', 'program', 'query', 'pattern', 'glob']) ||
              pickAnyNested(updateRecord, ['command', 'cmd', 'program', 'query', 'pattern', 'glob']);
            const pathHint =
              pickKeyValue(argsRecord, ['path', 'file', 'target', 'cwd', 'url', 'relativePath']) ||
              pickAnyNested(updateRecord, ['path', 'file', 'target', 'cwd', 'url', 'relativePath']);
            const details = (() => {
              const resultHint = pickKeyValue(outputRecord, ['summary', 'message', 'status', 'result', 'error']);
              const parts: string[] = [];
              if (status) parts.push(status);
              if (commandHint) parts.push(`action: ${toShort(toOneLine(commandHint), 90)}`);
              if (pathHint) parts.push(`target: ${toShort(toOneLine(pathHint), 90)}`);
              if (resultHint) parts.push(`result: ${toShort(toOneLine(resultHint), 90)}`);
              if (parts.length === 0) parts.push('running');
              return parts.join(' | ');
            })();
            const outputText = (() => {
              const raw = outputCandidate;
              if (typeof raw === 'string') {
                return toShort(toOneLine(raw), 180);
              }
              const outputSummary =
                pickKeyValue(outputRecord, ['summary', 'message', 'result', 'error']) ||
                pickAnyNested(outputRecord, ['summary', 'message', 'result', 'error']);
              if (outputSummary) {
                return toShort(toOneLine(outputSummary), 180);
              }
              return '';
            })();
            // User requested: only show Hermes toolcall responses (not call-start/status noise).
            if (!outputText) {
              return;
            }
            buffer.activityItems.push({ id: toolIdRaw, label: outputText, details: outputText, tone });
            manager.emitLiveActivity({
              sessionId,
              item: { id: toolIdRaw, label: outputText, details: outputText, tone },
            });
            log('info', 'ACP tool activity buffered', {
              sessionId,
              toolCallId: toolIdRaw,
              status: status || 'unknown',
              sessionUpdate: sessionUpdateKind || 'unknown',
            });
            return;
          }
        } catch (error) {
          log('error', 'ACP sessionUpdate handler failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };

    const spawnError = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
    const earlyExit = new Promise<never>((_resolve, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`ACP process exited before initialize (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      });
    });

    const connection = new acp.ClientSideConnection((_agent: unknown) => client, stream);
    await Promise.race([
      connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      }),
      spawnError,
      earlyExit,
    ]);

    child.once('exit', (code, signal) => {
      log('warn', 'ACP process exited', { code: code ?? null, signal: signal ?? null });
      this.initialized = false;
      this.connection = null;
      this.process = null;
      this.sessions.clear();
      this.promptBuffers.clear();
    });

    this.process = child;
    this.connection = connection;
    this.initialized = true;
    this.supportsListProviders = true;
    this.listProvidersUnsupportedLogged = false;
    log('info', 'ACP process initialized', { command, args, label });
  }

  private async ensureAgentInternal(): Promise<{ ok: boolean }> {
    this.logBuildInfoOnce();
    if (this.initialized && this.connection && this.process) {
      return { ok: true };
    }

    const launchCandidates = documentedLaunchCandidates();
    log('info', 'ACP launch candidates resolved', {
      buildId: ACP_MANAGER_BUILD_ID,
      count: launchCandidates.length,
      candidates: launchCandidates.map((candidate) => ({
        command: candidate.command,
        args: candidate.args,
        label: candidate.label,
      })),
    });

    const errors: string[] = [];
    for (const candidate of launchCandidates) {
      try {
        await this.startWithCandidate(candidate.command, candidate.args, candidate.label);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.command} ${candidate.args.join(' ')} (${candidate.label}) -> ${message}`);
        log('warn', 'ACP launch candidate failed', {
          command: candidate.command,
          args: candidate.args,
          label: candidate.label,
          error: message,
        });
      }
    }

    throw new Error(
      [
        'Unable to start Hermes ACP using documented launch commands.',
        'Tried:',
        errors.join(' | '),
        "Install ACP extra: pip install -e '.[acp]'",
      ].join(' '),
    );
  }

  async ensureAgent(): Promise<{ ok: boolean }> {
    if (this.initialized && this.connection && this.process) {
      return { ok: true };
    }
    if (this.ensureInFlight) {
      return this.ensureInFlight;
    }
    this.ensureInFlight = this.ensureAgentInternal().finally(() => {
      this.ensureInFlight = null;
    });
    return this.ensureInFlight;
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    this.initialized = false;
    this.connection = null;
    this.process = null;
    this.sessions.clear();
    this.promptBuffers.clear();
  }

  async newSession(payload: { cwd?: string }): Promise<{ sessionId: string }> {
    if (!this.connection || !this.initialized) throw new Error('ACP is not connected.');
    const cwd = payload.cwd?.trim() || process.cwd();
    log('info', 'ACP newSession requested', { cwd });
    const result = await this.connection.newSession({
      cwd,
      mcpServers: [],
    });
    const sessionId = String(result.sessionId);
    this.sessions.set(sessionId, {
      sessionId,
      cwd,
      history: [],
      updatedAt: Date.now(),
    });
    log('info', 'ACP newSession created', { sessionId, cwd });
    return { sessionId };
  }

  async prompt(payload: { sessionId: string; text: string }): Promise<{
    text: string;
    stopReason?: string;
    activityItems?: Array<{ id: string; label: string; details: string; tone: 'neutral' | 'success' | 'danger' }>;
    contextWindowUsed?: number;
    contextWindowSize?: number;
  }> {
    const sessionId = payload.sessionId?.trim();
    if (!sessionId || !this.connection || !this.initialized) throw new Error('ACP is not connected.');
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown ACP session: ${sessionId}`);
    log('info', 'ACP prompt requested', { sessionId, textLength: payload.text.length });

    session.history.push({ id: `user-${Date.now()}`, role: 'user', text: payload.text });
    session.updatedAt = Date.now();

    this.promptBuffers.set(sessionId, { chunks: [], activityItems: [] });
    const response = await this.connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: payload.text }],
    });
    const buffer = this.promptBuffers.get(sessionId);
    const chunks = buffer?.chunks ?? [];
    const activityItems = buffer?.activityItems ?? [];
    const contextWindowUsed = buffer?.contextWindowUsed;
    const contextWindowSize = buffer?.contextWindowSize;
    this.promptBuffers.delete(sessionId);
    const text = chunks.join('');

    session.history.push({ id: `assistant-${Date.now()}`, role: 'assistant', text });
    session.updatedAt = Date.now();
    log('info', 'ACP prompt completed', { sessionId, responseLength: text.length, stopReason: response?.stopReason ?? null });
    return { text, stopReason: response?.stopReason, activityItems, contextWindowUsed, contextWindowSize };
  }

  async cancel(payload: { sessionId: string }): Promise<{ ok: boolean }> {
    const sessionId = payload.sessionId?.trim();
    if (!sessionId || !this.connection || !this.initialized) return { ok: false };
    log('info', 'ACP cancel requested', { sessionId });
    await this.connection.cancel({ sessionId });
    return { ok: true };
  }

  async closeSession(payload: { sessionId: string }): Promise<{ ok: boolean }> {
    const sessionId = payload.sessionId?.trim();
    if (!sessionId || !this.connection || !this.initialized) return { ok: false };
    log('info', 'ACP closeSession requested', { sessionId });
    try {
      await this.connection.closeSession({ sessionId });
    } catch {
      // best-effort close
    }
    this.sessions.delete(sessionId);
    log('info', 'ACP closeSession completed', { sessionId });
    return { ok: true };
  }

  listSessions(limit = 200): Array<{ key: string; kind: string; title?: string }> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, limit))
      .map((session) => ({
        key: session.sessionId,
        kind: 'chat',
        title: session.history.find((item) => item.role === 'user')?.text.slice(0, 60),
      }));
  }

  getHistory(sessionId: string, limit = 50): Array<{ id: string; role: 'user' | 'assistant' | 'system'; text: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.history.slice(-Math.max(1, limit));
  }

  async setSessionModel(payload: { sessionId: string; modelValue: string | null }): Promise<{ applied: boolean; reason?: string }> {
    const sessionId = payload.sessionId?.trim();
    if (!sessionId) return { applied: false, reason: 'invalid-session-id' };
    const session = this.sessions.get(sessionId);
    if (!session) return { applied: false, reason: 'session-not-found' };
    const normalizedModel = payload.modelValue?.trim() || null;
    session.updatedAt = Date.now();
    log('info', 'ACP setSessionModel requested', { sessionId, model: normalizedModel ?? '(default)' });

    if (!normalizedModel) {
      session.model = null;
      return { applied: true };
    }

    if (!ACP_ENABLE_UNSTABLE || !this.connection?.unstable_setSessionModel || !this.initialized) {
      return { applied: false, reason: 'unsupported' };
    }

    try {
      await this.connection.unstable_setSessionModel({
        sessionId,
        model: normalizedModel,
      });
      session.model = normalizedModel;
      return { applied: true };
    } catch (error) {
      log('warn', 'ACP unstable_setSessionModel failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { applied: false, reason: 'acp-error' };
    }
  }

  getSessionModel(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.model ?? null;
  }

  async listModels(): Promise<Array<{ value: string; label: string }>> {
    if (!ACP_ENABLE_UNSTABLE || !this.connection?.unstable_listProviders || !this.initialized || !this.supportsListProviders) {
      log('info', 'ACP listModels skipped', {
        unstableEnabled: ACP_ENABLE_UNSTABLE,
        hasMethod: Boolean(this.connection?.unstable_listProviders),
        initialized: this.initialized,
        supportsListProviders: this.supportsListProviders,
      });
      return [];
    }
    try {
      const result = await this.connection.unstable_listProviders({});
      const providers = Array.isArray(result?.providers) ? result.providers : [];
      const out: Array<{ value: string; label: string }> = [];
      for (const provider of providers) {
        const providerId = typeof provider?.providerId === 'string' ? provider.providerId : '';
        const models = Array.isArray(provider?.models) ? provider.models : [];
        for (const model of models) {
          const modelId = typeof model?.modelId === 'string' ? model.modelId : '';
          if (!modelId) continue;
          out.push({
            value: providerId ? `${providerId}::${modelId}` : modelId,
            label: providerId ? `${modelId} (${providerId})` : modelId,
          });
        }
      }
      return out;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/method not found/i.test(message)) {
        this.supportsListProviders = false;
        if (!this.listProvidersUnsupportedLogged) {
          this.listProvidersUnsupportedLogged = true;
          log('warn', 'ACP unstable_listProviders not supported by server; disabling model discovery', { error: message });
        }
        return [];
      }
      log('warn', 'ACP listProviders failed', { error: message });
      return [];
    }
  }
}
