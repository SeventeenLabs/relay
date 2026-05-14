import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
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

type AcpUpdateCallback = (update: { sessionId: string; update: unknown }) => void;

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
  const quotedScript = shellScript.replace(/'/g, `'\\''`);
  const remoteCommand = `bash -lc '${quotedScript}'`;

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
  private active = false;

  setUpdateCallback(cb: AcpUpdateCallback | null) {
    this.onUpdate = cb;
  }

  private makeClientHandler(): Client {
    return {
      async requestPermission(params) {
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
      async sessionUpdate(params: SessionNotification) {
        // filled by closure in connect()
        void params;
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
          clientCapabilities: {},
        }),
        childSpawnErrorPromise,
      ]);

      this.active = true;
      const initial = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      this.knownSessions.set(initial.sessionId, { id: initial.sessionId, cwd });
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
    return { sessionId: result.sessionId };
  }

  async prompt(input: { sessionId: string; text: string }) {
    const connection = this.requireConnection();
    const result = await connection.prompt({
      sessionId: input.sessionId,
      prompt: [{ type: 'text', text: input.text }],
    });
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
    };
    if (typeof connection.unstable_setSessionModel !== 'function') {
      return { ok: false, message: 'Session model switching is not supported by this ACP server.' };
    }
    await connection.unstable_setSessionModel({
      sessionId: input.sessionId,
      modelId: input.model,
    });
    return { ok: true };
  }

  async cancel(input: { sessionId: string }) {
    const connection = this.requireConnection();
    await connection.cancel({ sessionId: input.sessionId });
    return { ok: true };
  }

  async disconnect() {
    this.active = false;
    this.knownSessions.clear();
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
