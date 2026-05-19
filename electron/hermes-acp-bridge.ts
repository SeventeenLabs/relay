import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type Agent,
  type SessionNotification,
} from '@agentclientprotocol/sdk';

type SessionInfo = {
  id: string;
  title?: string;
  cwd?: string;
};

type AcpModelState = {
  availableModels: Array<{ id: string; name: string }>;
  currentModelId: string | null;
  modelConfigId: string | null;
};

type AcpUpdateCallback = (update: { sessionId: string; update: unknown }) => void;
const HERMES_ACP_MAIN_LOG_PREFIX = '[Relay:HermesACPMain]';
const ACP_MAX_LIST_ITEMS = 500;
const ACP_MAX_SEARCH_RESULTS = 200;
function logAcp(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  if (level === 'error') {
    console.error(HERMES_ACP_MAIN_LOG_PREFIX, message, meta ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(HERMES_ACP_MAIN_LOG_PREFIX, message, meta ?? '');
    return;
  }
  console.info(HERMES_ACP_MAIN_LOG_PREFIX, message, meta ?? '');
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseSshLaunch(gatewayUrl: string): { command: string; args: string[] } {
  const url = new URL(gatewayUrl);
  const user = decodeURIComponent(url.username || '').trim();
  const host = url.hostname.trim();
  const port = Number(url.port || '22');
  if (!user || !host || !Number.isFinite(port) || port <= 0) {
    throw new Error('Invalid ssh gateway URL for ACP. Use ssh://user@host[:port].');
  }
  const shellScript =
    "if command -v hermes >/dev/null 2>&1; then exec hermes acp; elif [ -x /root/.local/bin/hermes ]; then exec /root/.local/bin/hermes acp; else echo 'hermes not found in PATH and /root/.local/bin/hermes missing' >&2; exit 127; fi";
  const escapedForDoubleQuotes = shellScript.replace(/(["\\$`])/g, '\\$1');
  const remoteCommand = `bash -lc "${escapedForDoubleQuotes}"`;

  return {
    command: 'ssh',
    args: [
      '-p',
      String(port),
      `${user}@${host}`,
      remoteCommand,
    ],
  };
}

export class HermesAcpBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: ClientSideConnection | null = null;
  private onUpdate: AcpUpdateCallback | null = null;
  private knownSessions = new Map<string, SessionInfo>();
  private modelStateBySession = new Map<string, AcpModelState>();
  private globalModelCatalog = new Map<string, { id: string; name: string }>();
  private active = false;

  private resolveSessionId(requestedSessionId?: string): string {
    const requested = (requestedSessionId ?? '').trim();
    if (requested) {
      if (!this.knownSessions.has(requested)) {
        throw new Error(`ACP session is unknown: ${requested}`);
      }
      return requested;
    }

    const fallback = this.knownSessions.keys().next().value as string | undefined;
    if (!fallback) {
      throw new Error('ACP has no active session.');
    }
    return fallback;
  }

  private resolveSessionRoot(sessionId: string): string {
    const resolvedSessionId = this.resolveSessionId(sessionId);
    const session = this.knownSessions.get(resolvedSessionId);
    const root = session?.cwd?.trim() || '';
    if (!root) {
      throw new Error(`ACP session is unknown or missing cwd: ${resolvedSessionId}`);
    }
    return root;
  }

  private resolveAllowedPath(sessionId: string, requestedPath: string): string {
    const root = this.resolveSessionRoot(sessionId);
    const normalizedRequest = requestedPath.trim();
    if (!normalizedRequest) {
      throw new Error('Path is required.');
    }

    if (path.isAbsolute(normalizedRequest)) {
      // ACP fs/read_text_file + fs/write_text_file expect absolute paths.
      // We also allow absolute paths for workspace extension methods.
      return path.resolve(normalizedRequest);
    }

    // Back-compat for callers that still send relative paths.
    const resolved = path.resolve(root, normalizedRequest);
    if (!isPathInside(root, resolved)) {
      throw new Error(`Relative path escapes session root: ${normalizedRequest}`);
    }
    return resolved;
  }

  private buildReadSlice(content: string, line?: number | null, limit?: number | null): string {
    if (!line && !limit) return content;
    const startLine = Math.max(1, Number.isFinite(line as number) ? Number(line) : 1);
    const maxLines = Number.isFinite(limit as number) ? Math.max(1, Number(limit)) : null;
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const startIndex = Math.min(lines.length, startLine - 1);
    const endIndex = maxLines ? Math.min(lines.length, startIndex + maxLines) : lines.length;
    return lines.slice(startIndex, endIndex).join('\n');
  }

  private normalizeRelPath(rawPath: unknown): string {
    if (typeof rawPath !== 'string') return '';
    return rawPath.trim().replace(/\\/g, '/');
  }

  private async workspaceListLocal(sessionId: string, requestedPath: string) {
    const root = this.resolveSessionRoot(sessionId);
    const normalizedRequest = this.normalizeRelPath(requestedPath || '.');
    const resolvedDir = this.resolveAllowedPath(sessionId, normalizedRequest);
    const stat = await fs.stat(resolvedDir);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${normalizedRequest || '.'}`);
    }
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
    const items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }> = [];
    for (const entry of entries) {
      if (items.length >= ACP_MAX_LIST_ITEMS) break;
      const absolute = path.join(resolvedDir, entry.name);
      const displayPath = path.isAbsolute(normalizedRequest)
        ? absolute
        : path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        items.push({ path: displayPath, kind: 'directory' });
        continue;
      }
      if (entry.isFile()) {
        const entryStat = await fs.stat(absolute);
        items.push({
          path: displayPath,
          kind: 'file',
          size: entryStat.size,
          modifiedMs: entryStat.mtimeMs,
        });
      }
    }
    return { items, truncated: entries.length > items.length };
  }

  private async workspaceSearchLocal(sessionId: string, query: string, requestedPath: string) {
    const root = this.resolveSessionRoot(sessionId);
    const normalizedRequest = this.normalizeRelPath(requestedPath || '.');
    const searchRoot = this.resolveAllowedPath(sessionId, normalizedRequest);
    const returnAbsolute = path.isAbsolute(normalizedRequest);
    const normalizedQuery = query.trim().toLowerCase();
    const results: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }> = [];
    const walk = async (dir: string) => {
      if (results.length >= ACP_MAX_SEARCH_RESULTS) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= ACP_MAX_SEARCH_RESULTS) break;
        const absolute = path.join(dir, entry.name);
        const displayPath = returnAbsolute
          ? absolute
          : path.relative(root, absolute).replace(/\\/g, '/');
        const nameLower = entry.name.toLowerCase();
        if (!normalizedQuery || nameLower.includes(normalizedQuery)) {
          if (entry.isDirectory()) {
            results.push({ path: displayPath, kind: 'directory' });
          } else if (entry.isFile()) {
            const entryStat = await fs.stat(absolute);
            results.push({
              path: displayPath,
              kind: 'file',
              size: entryStat.size,
              modifiedMs: entryStat.mtimeMs,
            });
          }
        }
        if (entry.isDirectory()) {
          await walk(absolute);
        }
      }
    };
    await walk(searchRoot);
    return { items: results, truncated: results.length >= ACP_MAX_SEARCH_RESULTS };
  }

  private upsertGlobalCatalog(models: Array<{ id: string; name: string }>) {
    for (const model of models) {
      const id = model.id.trim();
      if (!id) continue;
      const name = model.name.trim() || id;
      this.globalModelCatalog.set(id, { id, name });
    }
  }

  private captureModelStateFromConfigOptions(sessionId: string, configOptions: unknown) {
    if (!Array.isArray(configOptions)) return;
    const modelOption = configOptions.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const item = entry as Record<string, unknown>;
      const category = typeof item.category === 'string' ? item.category : '';
      const id = typeof item.id === 'string' ? item.id : '';
      return category === 'model' || id === 'model';
    });
    if (!modelOption || typeof modelOption !== 'object') return;
    const option = modelOption as Record<string, unknown>;
    const modelConfigId = typeof option.id === 'string' && option.id.trim() ? option.id.trim() : null;
    const currentModelId = typeof option.currentValue === 'string' && option.currentValue.trim()
      ? option.currentValue.trim()
      : null;
    const options = option.options;
    const availableModels: Array<{ id: string; name: string }> = [];
    if (Array.isArray(options)) {
      for (const item of options) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (Array.isArray(record.options)) {
          for (const grouped of record.options) {
            if (!grouped || typeof grouped !== 'object') continue;
            const groupedRecord = grouped as Record<string, unknown>;
            const id = typeof groupedRecord.value === 'string' ? groupedRecord.value.trim() : '';
            if (!id) continue;
            const name =
              typeof groupedRecord.name === 'string' && groupedRecord.name.trim()
                ? groupedRecord.name.trim()
                : id;
            availableModels.push({ id, name });
          }
          continue;
        }
        const id = typeof record.value === 'string' ? record.value.trim() : '';
        if (!id) continue;
        const name =
          typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : id;
        availableModels.push({ id, name });
      }
    }
    const previous = this.modelStateBySession.get(sessionId);
    this.modelStateBySession.set(sessionId, {
      availableModels: availableModels.length > 0 ? availableModels : previous?.availableModels ?? [],
      currentModelId: currentModelId ?? previous?.currentModelId ?? null,
      modelConfigId: modelConfigId ?? previous?.modelConfigId ?? null,
    });
    this.upsertGlobalCatalog(availableModels);
  }

  // Hermes ACP compatibility: some versions expose model state via `models`
  // in newSession/update payloads instead of config options.
  private captureModelStateFromLegacyModels(sessionId: string, source: unknown) {
    if (!source || typeof source !== 'object') return;
    const record = source as Record<string, unknown>;
    const models = record.models;
    if (!models || typeof models !== 'object') return;
    const modelsRecord = models as Record<string, unknown>;
    const availableRaw = Array.isArray(modelsRecord.availableModels) ? modelsRecord.availableModels : [];
    const currentModelId =
      typeof modelsRecord.currentModelId === 'string' && modelsRecord.currentModelId.trim()
        ? modelsRecord.currentModelId.trim()
        : null;
    const availableModels: Array<{ id: string; name: string }> = [];
    for (const item of availableRaw) {
      if (!item || typeof item !== 'object') continue;
      const model = item as Record<string, unknown>;
      const id = typeof model.modelId === 'string' ? model.modelId.trim() : '';
      if (!id) continue;
      const name =
        typeof model.name === 'string' && model.name.trim()
          ? model.name.trim()
          : id;
      availableModels.push({ id, name });
    }
    if (availableModels.length === 0 && !currentModelId) return;
    const previous = this.modelStateBySession.get(sessionId);
    this.modelStateBySession.set(sessionId, {
      availableModels: availableModels.length > 0 ? availableModels : previous?.availableModels ?? [],
      currentModelId: currentModelId ?? previous?.currentModelId ?? null,
      modelConfigId: previous?.modelConfigId ?? null,
    });
    this.upsertGlobalCatalog(availableModels);
  }

  private captureModelStateFromUpdate(sessionId: string, update: unknown) {
    if (!update || typeof update !== 'object') {
      return;
    }
    const record = update as Record<string, unknown>;
    this.captureModelStateFromConfigOptions(sessionId, record.configOptions);
    this.captureModelStateFromLegacyModels(sessionId, record);
  }

  setUpdateCallback(cb: AcpUpdateCallback | null) {
    this.onUpdate = cb;
  }

  private makeClientHandler(): Client {
    return {
      requestPermission: async (params) => {
        const first = params.options?.[0];
        if (!first) {
          return { outcome: { outcome: 'cancelled' } };
        }
        return {
          outcome: {
            outcome: 'selected',
            optionId: first.optionId,
          },
        };
      },
      sessionUpdate: async (params: SessionNotification) => {
        // filled by closure in connect()
        void params;
      },
      readTextFile: async (params) => {
        const requestedPath = typeof params.path === 'string' ? params.path : '';
        const resolvedPath = this.resolveAllowedPath(params.sessionId, requestedPath);
        logAcp('info', 'ACP fs.read_text_file request', {
          sessionId: params.sessionId,
          requestedPath,
          resolvedPath,
          line: params.line ?? undefined,
          limit: params.limit ?? undefined,
        });
        const content = await fs.readFile(resolvedPath, 'utf8');
        return {
          content: this.buildReadSlice(content, params.line ?? null, params.limit ?? null),
        };
      },
      writeTextFile: async (params) => {
        const requestedPath = typeof params.path === 'string' ? params.path : '';
        const resolvedPath = this.resolveAllowedPath(params.sessionId, requestedPath);
        const content = typeof params.content === 'string' ? params.content : '';
        logAcp('info', 'ACP fs.write_text_file request', {
          sessionId: params.sessionId,
          requestedPath,
          resolvedPath,
          chars: content.length,
        });
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, content, 'utf8');
        return {};
      },
      extMethod: async (method, params) => {
        const sessionId =
          (typeof params?.sessionId === 'string' && params.sessionId.trim())
            ? params.sessionId.trim()
            : ((this.knownSessions.keys().next().value as string | undefined) ?? '');
        if (!sessionId) throw new Error(`ext method "${method}" requires sessionId`);
        if (method === 'workspace.list') {
          const relPath = this.normalizeRelPath(params?.path);
          logAcp('info', 'ACP ext workspace.list request', { sessionId, path: relPath || '(root)' });
          return this.workspaceListLocal(sessionId, relPath) as unknown as Record<string, unknown>;
        }
        if (method === 'workspace.read') {
          const relPath = this.normalizeRelPath(params?.path);
          const resolvedPath = this.resolveAllowedPath(sessionId, relPath);
          logAcp('info', 'ACP ext workspace.read request', { sessionId, path: relPath });
          const content = await fs.readFile(resolvedPath, 'utf8');
          return { content };
        }
        if (method === 'workspace.stat') {
          const relPath = this.normalizeRelPath(params?.path);
          const resolvedPath = this.resolveAllowedPath(sessionId, relPath);
          logAcp('info', 'ACP ext workspace.stat request', { sessionId, path: relPath });
          const fileStat = await fs.stat(resolvedPath);
          return {
            kind: fileStat.isDirectory() ? 'directory' : 'file',
            size: fileStat.size,
            createdMs: fileStat.birthtimeMs,
            modifiedMs: fileStat.mtimeMs,
          };
        }
        if (method === 'workspace.write') {
          const relPath = this.normalizeRelPath(params?.path);
          const resolvedPath = this.resolveAllowedPath(sessionId, relPath);
          const content = typeof params?.content === 'string' ? params.content : '';
          logAcp('info', 'ACP ext workspace.write request', { sessionId, path: relPath, chars: content.length });
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, content, 'utf8');
          return { ok: true };
        }
        if (method === 'workspace.rename') {
          const oldPath = this.normalizeRelPath(params?.oldPath);
          const newPath = this.normalizeRelPath(params?.newPath);
          const oldAbs = this.resolveAllowedPath(sessionId, oldPath);
          const newAbs = this.resolveAllowedPath(sessionId, newPath);
          logAcp('info', 'ACP ext workspace.rename request', { sessionId, oldPath, newPath });
          await fs.mkdir(path.dirname(newAbs), { recursive: true });
          await fs.rename(oldAbs, newAbs);
          return { ok: true };
        }
        if (method === 'workspace.delete') {
          const relPath = this.normalizeRelPath(params?.path);
          const resolvedPath = this.resolveAllowedPath(sessionId, relPath);
          logAcp('info', 'ACP ext workspace.delete request', { sessionId, path: relPath });
          const fileStat = await fs.stat(resolvedPath);
          if (fileStat.isDirectory()) {
            await fs.rm(resolvedPath, { recursive: true });
          } else {
            await fs.unlink(resolvedPath);
          }
          return { ok: true };
        }
        if (method === 'workspace.search' || method === 'search_files') {
          const query = typeof params?.query === 'string' ? params.query : typeof params?.pattern === 'string' ? params.pattern : '';
          const relPath = this.normalizeRelPath(params?.path);
          logAcp('info', 'ACP ext workspace.search request', { sessionId, query, path: relPath || '(root)' });
          return this.workspaceSearchLocal(sessionId, query, relPath) as unknown as Record<string, unknown>;
        }
        throw new Error(`Unsupported ACP ext method: ${method}`);
      },
    };
  }

  async connect(input: { gatewayUrl?: string; cwd?: string }) {
    await this.disconnect();

    const gatewayUrl = (input.gatewayUrl ?? '').trim();
    const cwd = (input.cwd ?? process.cwd()).trim() || process.cwd();

    if (!gatewayUrl.toLowerCase().startsWith('ssh://')) {
      throw new Error('ACP requires a remote SSH endpoint (ssh://user@host[:port]). Local ACP fallback is disabled.');
    }
    const launch = parseSshLaunch(gatewayUrl);
    logAcp('info', 'ACP connect requested', { gatewayUrl, cwd, command: launch.command, args: launch.args });

    this.child = spawn(launch.command, launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });

    let stderrBuffer = '';
    let childExitCode: number | null = null;
    let childExitSignal: NodeJS.Signals | null = null;
    let childSpawnError: Error | null = null;

    const childSpawnErrorPromise = new Promise<never>((_resolve, reject) => {
      this.child?.once('error', (error) => {
        childSpawnError = error instanceof Error ? error : new Error(String(error));
        reject(childSpawnError);
      });
    });

    this.child.stderr.on('data', (chunk) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderrBuffer += text;
      if (stderrBuffer.length > 8_000) {
        stderrBuffer = stderrBuffer.slice(-8_000);
      }
    });

    this.child.once('exit', (code, signal) => {
      childExitCode = code;
      childExitSignal = signal;
    });

    const stream = ndJsonStream(
      Writable.toWeb(this.child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(this.child.stdout) as unknown as ReadableStream<Uint8Array>,
    );

    const clientHandler = this.makeClientHandler();
    clientHandler.sessionUpdate = async (params) => {
      this.captureModelStateFromUpdate(params.sessionId, params.update);
      this.onUpdate?.({
        sessionId: params.sessionId,
        update: params.update,
      });
    };

    this.connection = new ClientSideConnection((_agent: Agent) => clientHandler, stream);
    try {
      await Promise.race([
        this.connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
          },
        }),
        childSpawnErrorPromise,
      ]);

      this.active = true;
      const initial = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      this.knownSessions.set(initial.sessionId, { id: initial.sessionId, cwd });
      this.captureModelStateFromConfigOptions(initial.sessionId, (initial as { configOptions?: unknown }).configOptions);
      this.captureModelStateFromLegacyModels(initial.sessionId, initial as unknown);
      logAcp('info', 'ACP connect established', { sessionId: initial.sessionId });
      return { ok: true, sessionId: initial.sessionId };
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error);
      const launchDetail = `${launch.command} ${launch.args.join(' ')}`;
      if (baseMessage.includes('spawn hermes ENOENT')) {
        throw new Error(
          `ACP connect failed via ${launchDetail}. Hermes CLI was not found on PATH in the Electron process (spawn hermes ENOENT). ` +
            'Install Hermes CLI on this machine or launch Relay from an environment where `hermes` is available. ' +
            'For SSH endpoints, this error means local Relay still attempted a local hermes spawn; re-check saved endpoint/transport.',
        );
      }
      const exitDetail =
        childExitCode !== null || childExitSignal
          ? ` (exit code: ${childExitCode ?? 'null'}, signal: ${childExitSignal ?? 'none'})`
          : '';
      const stderrDetail = stderrBuffer.trim() ? ` stderr: ${stderrBuffer.trim()}` : '';
      logAcp('error', 'ACP connect failed', {
        gatewayUrl,
        exitCode: childExitCode,
        exitSignal: childExitSignal,
        error: baseMessage,
        stderr: stderrBuffer.trim() || undefined,
      });
      throw new Error(`ACP connect failed via ${launchDetail}${exitDetail}. ${baseMessage}${stderrDetail}`.trim());
    }
  }

  private requireConnection(): ClientSideConnection {
    if (!this.connection || !this.active) {
      throw new Error('ACP is not connected.');
    }
    return this.connection;
  }

  async createSession(input: { cwd?: string }) {
    const connection = this.requireConnection();
    const cwd = (input.cwd ?? process.cwd()).trim() || process.cwd();
    const result = await connection.newSession({
      cwd,
      mcpServers: [],
    });
    this.knownSessions.set(result.sessionId, { id: result.sessionId, cwd });
    this.captureModelStateFromConfigOptions(result.sessionId, (result as { configOptions?: unknown }).configOptions);
    this.captureModelStateFromLegacyModels(result.sessionId, result as unknown);
    logAcp('info', 'ACP session created', { sessionId: result.sessionId, cwd });
    return { sessionId: result.sessionId };
  }

  async prompt(input: { sessionId: string; text: string }) {
    const connection = this.requireConnection();
    logAcp('info', 'ACP prompt start', { sessionId: input.sessionId, chars: input.text.length });
    const result = await connection.prompt({
      sessionId: input.sessionId,
      prompt: [{ type: 'text', text: input.text }],
    });
    logAcp('info', 'ACP prompt done', { sessionId: input.sessionId, stopReason: result.stopReason });
    return { stopReason: result.stopReason };
  }

  async listSessions() {
    const connection = this.requireConnection();
    try {
      const result = await connection.listSessions({});
      const sessions = result.sessions.map((entry: { sessionId: string; title?: string | null; cwd?: string | null }) => ({
        id: entry.sessionId,
        title: entry.title ?? undefined,
        cwd: entry.cwd ?? undefined,
      }));
      for (const session of sessions) {
        this.knownSessions.set(session.id, session);
      }
      return sessions;
    } catch {
      return Array.from(this.knownSessions.values());
    }
  }

  async setSessionModel(input: { sessionId: string; model: string }) {
    const connection = this.requireConnection() as ClientSideConnection & {
      unstable_setSessionModel?: (params: { sessionId: string; modelId: string }) => Promise<unknown>;
      setSessionConfigOption?: (params: {
        sessionId: string;
        configId: string;
        value: string;
      }) => Promise<{ configOptions?: unknown }>;
    };
    const state = this.modelStateBySession.get(input.sessionId);
    const modelConfigId = state?.modelConfigId;
    if (modelConfigId && typeof connection.setSessionConfigOption === 'function') {
      const response = await connection.setSessionConfigOption({
        sessionId: input.sessionId,
        configId: modelConfigId,
        value: input.model,
      });
      this.captureModelStateFromConfigOptions(input.sessionId, response?.configOptions);
      logAcp('info', 'ACP model set via config option', { sessionId: input.sessionId, modelId: input.model, configId: modelConfigId });
      return { ok: true };
    }
    if (typeof connection.unstable_setSessionModel !== 'function') {
      return { ok: false, message: 'Session model switching is not supported by this ACP server.' };
    }
    await connection.unstable_setSessionModel({
      sessionId: input.sessionId,
      modelId: input.model,
    });
    logAcp('info', 'ACP model set via unstable_setSessionModel', { sessionId: input.sessionId, modelId: input.model });
    const previous = this.modelStateBySession.get(input.sessionId);
    if (previous) {
      this.modelStateBySession.set(input.sessionId, {
        ...previous,
        currentModelId: input.model,
      });
    }
    return { ok: true };
  }

  async listModels(input?: { sessionId?: string }) {
    const targetSessionId = (input?.sessionId ?? '').trim();
    // Rebuild global catalog from all known session states if needed.
    if (this.globalModelCatalog.size === 0) {
      for (const state of this.modelStateBySession.values()) {
        this.upsertGlobalCatalog(state.availableModels);
      }
    }
    const models = Array.from(this.globalModelCatalog.values());
    const targetState = targetSessionId ? this.modelStateBySession.get(targetSessionId) : null;
    const effectiveModels = models.length > 0 ? models : targetState?.availableModels ?? [];
    const fallbackCurrentModelId =
      Array.from(this.modelStateBySession.values()).find((state) => typeof state.currentModelId === 'string' && state.currentModelId.trim())
        ?.currentModelId ?? null;
    const currentModelId = targetSessionId
      ? targetState?.currentModelId ?? fallbackCurrentModelId
      : fallbackCurrentModelId;
    logAcp('info', 'ACP models read (global catalog)', {
      targetSessionId: targetSessionId || '(none)',
      count: effectiveModels.length,
      currentModelId,
    });
    return { models: effectiveModels, currentModelId };
  }

  async cancel(input: { sessionId: string }) {
    const connection = this.requireConnection();
    await connection.cancel({ sessionId: input.sessionId });
    return { ok: true };
  }

  async workspaceList(input?: { sessionId?: string; path?: string }) {
    const requestedSessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
    const sessionId = this.resolveSessionId(requestedSessionId);
    const relativePath = typeof input?.path === 'string' ? input.path : '';
    logAcp('info', 'ACP workspace.list request', { sessionId, path: relativePath || '(root)' });
    return this.workspaceListLocal(sessionId, relativePath);
  }

  async workspaceRead(input: { sessionId?: string; path: string }) {
    const requestedSessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
    const sessionId = this.resolveSessionId(requestedSessionId);
    logAcp('info', 'ACP workspace.read request', { sessionId, path: input.path });
    const resolvedPath = this.resolveAllowedPath(sessionId, input.path);
    const content = await fs.readFile(resolvedPath, 'utf8');
    return { content };
  }

  async workspaceStat(input: { sessionId?: string; path: string }) {
    const requestedSessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
    const sessionId = this.resolveSessionId(requestedSessionId);
    logAcp('info', 'ACP workspace.stat request', { sessionId, path: input.path });
    const resolvedPath = this.resolveAllowedPath(sessionId, input.path);
    const fileStat = await fs.stat(resolvedPath);
    return {
      kind: fileStat.isDirectory() ? 'directory' : 'file',
      size: fileStat.size,
      createdMs: fileStat.birthtimeMs,
      modifiedMs: fileStat.mtimeMs,
    };
  }

  async workspaceRename(input: { sessionId?: string; oldPath: string; newPath: string }) {
    const requestedSessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
    const sessionId = this.resolveSessionId(requestedSessionId);
    logAcp('info', 'ACP workspace.rename request', { sessionId, oldPath: input.oldPath, newPath: input.newPath });
    const oldAbs = this.resolveAllowedPath(sessionId, input.oldPath);
    const newAbs = this.resolveAllowedPath(sessionId, input.newPath);
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.rename(oldAbs, newAbs);
    return { ok: true };
  }

  async workspaceDelete(input: { sessionId?: string; path: string }) {
    const requestedSessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
    const sessionId = this.resolveSessionId(requestedSessionId);
    logAcp('info', 'ACP workspace.delete request', { sessionId, path: input.path });
    const resolvedPath = this.resolveAllowedPath(sessionId, input.path);
    const fileStat = await fs.stat(resolvedPath);
    if (fileStat.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true });
    } else {
      await fs.unlink(resolvedPath);
    }
    return { ok: true };
  }

  async workspaceWrite(input: { sessionId?: string; path: string; content: string }) {
    const requestedSessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
    const sessionId = this.resolveSessionId(requestedSessionId);
    logAcp('info', 'ACP workspace.write request', { sessionId, path: input.path, chars: input.content.length });
    const resolvedPath = this.resolveAllowedPath(sessionId, input.path);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, input.content, 'utf8');
    return { ok: true };
  }

  async kanbanExec(input: { sessionId?: string; args: string[]; timeoutMs?: number; requireJsonOutput?: boolean }) {
    const rawArgs = Array.isArray(input.args) ? input.args : [];
    const args = rawArgs
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
    if (args.length === 0) {
      throw new Error('Kanban command arguments are required.');
    }

    const commandArgs = args[0] === 'kanban' ? args : ['kanban', ...args];
    const timeoutMs = Number.isFinite(input.timeoutMs as number) && (input.timeoutMs as number) > 0
      ? Math.round(input.timeoutMs as number)
      : 30_000;

    const requestedSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    const fallbackSessionId = this.knownSessions.keys().next().value as string | undefined;
    const resolvedSessionId = requestedSessionId || fallbackSessionId || '';

    let cwd = process.cwd();
    if (resolvedSessionId) {
      try {
        cwd = this.resolveSessionRoot(resolvedSessionId);
      } catch {
        cwd = process.cwd();
      }
    }

    logAcp('info', 'ACP kanban exec via local Hermes CLI', {
      sessionId: resolvedSessionId || '(none)',
      cwd,
      args: commandArgs,
      timeoutMs,
    });

    const runResult = await new Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const proc = spawn('hermes', commandArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      proc.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      proc.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      proc.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`Kanban command timed out after ${timeoutMs}ms.`));
          return;
        }
        resolve({ stdout, stderr, exitCode, signal });
      });
    });

    if (runResult.exitCode !== 0) {
      const detail = runResult.stderr.trim() || runResult.stdout.trim() || 'Unknown error';
      throw new Error(
        `Kanban command failed (exit=${runResult.exitCode ?? 'null'}, signal=${runResult.signal ?? 'none'}): ${detail}`,
      );
    }

    if (input.requireJsonOutput && !runResult.stdout.trim()) {
      throw new Error('Kanban command returned no data.');
    }

    return {
      stdout: runResult.stdout,
      exitCode: runResult.exitCode,
      signal: runResult.signal,
    };
  }

  async disconnect() {
    logAcp('info', 'ACP disconnect requested');
    this.active = false;
    this.knownSessions.clear();
    this.modelStateBySession.clear();
    this.globalModelCatalog.clear();
    if (this.connection) {
      try {
        await Promise.race([
          this.connection.closed,
          new Promise((resolve) => setTimeout(resolve, 200)),
        ]);
      } catch {
        // ignore
      }
    }
    this.connection = null;
    if (this.child) {
      if (!this.child.killed) {
        this.child.kill();
      }
      this.child = null;
    }
    return { ok: true };
  }
}
