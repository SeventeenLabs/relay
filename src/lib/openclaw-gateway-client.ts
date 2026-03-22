import { getPublicKeyAsync, signAsync, utils } from '@noble/ed25519';

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

export type GatewaySessionSummary = {
  key: string;
  kind: string;
};

type GatewaySessionsListResult = {
  defaults?: {
    mainSessionKey?: unknown;
    mainKey?: unknown;
  };
  sessions?: Array<{
    key?: unknown;
    kind?: unknown;
  }>;
};

type RpcPending = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type GatewayErrorDetails = {
  code?: string;
  requestId?: string;
  canRetryWithDeviceToken?: boolean;
  reason?: string;
  [key: string]: unknown;
};

type GatewayResponseFrame = {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
};

type GatewayEventFrame = {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: Record<string, unknown>;
};

type GatewayFrame = GatewayResponseFrame | GatewayEventFrame;

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

const DEFAULT_TIMEOUT_MS = 15_000;
const GATEWAY_PROTOCOL_VERSION = 3;
const CLIENT_ID = 'openclaw-control-ui';
const CLIENT_MODE = 'webchat';
const DEVICE_IDENTITY_STORAGE_KEY = 'openclaw-device-identity-v1';
const REQUESTED_SCOPES = ['operator.read', 'operator.write', 'operator.admin'] as const;

type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

type StoredIdentity = DeviceIdentity & {
  version: 1;
  createdAtMs: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeMetadataField(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '';
  }

  let output = '';
  for (const char of trimmed) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint >= 65 && codePoint <= 90) {
      output += String.fromCodePoint(codePoint + 32);
    } else {
      output += char;
    }
  }
  return output;
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}): string {
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token ?? '',
    params.nonce,
    normalizeMetadataField(params.platform),
    normalizeMetadataField(params.deviceFamily),
  ].join('|');
}

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', publicKey.slice().buffer);
  return bytesToHex(new Uint8Array(hash));
}

function getSafeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const storage = getSafeLocalStorage();
  try {
    const raw = storage?.getItem(DEVICE_IDENTITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === 'string' &&
        typeof parsed.publicKey === 'string' &&
        typeof parsed.privateKey === 'string'
      ) {
        const derivedId = await fingerprintPublicKey(base64UrlDecode(parsed.publicKey));
        if (derivedId !== parsed.deviceId) {
          const updated: StoredIdentity = {
            ...parsed,
            deviceId: derivedId,
          };
          storage?.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(updated));
          return {
            deviceId: derivedId,
            publicKey: parsed.publicKey,
            privateKey: parsed.privateKey,
          };
        }

        return {
          deviceId: parsed.deviceId,
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
        };
      }
    }
  } catch {
    // fall through to regenerate identity
  }

  const privateKey = utils.randomSecretKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);
  const identity: DeviceIdentity = {
    deviceId,
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
  };

  const stored: StoredIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    createdAtMs: Date.now(),
  };
  storage?.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(stored));

  return identity;
}

async function signDevicePayload(privateKeyBase64Url: string, payload: string): Promise<string> {
  const key = base64UrlDecode(privateKeyBase64Url);
  const data = new TextEncoder().encode(payload);
  const sig = await signAsync(data, key);
  return base64UrlEncode(sig);
}

export class OpenClawGatewayClient {
  private socket: WebSocket | null = null;
  private connectedUrl: string | null = null;
  private requestCounter = 0;
  private pending = new Map<string, RpcPending>();
  private grantedScopes: string[] = [];

  private onEventHandler: ((event: GatewayFrame) => void) | null = null;
  private onConnectionHandler: ((connected: boolean, message: string) => void) | null = null;

  setEventHandler(handler: (event: GatewayFrame) => void) {
    this.onEventHandler = handler;
  }

  setConnectionHandler(handler: (connected: boolean, message: string) => void) {
    this.onConnectionHandler = handler;
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async getDeviceId(): Promise<string> {
    const identity = await loadOrCreateDeviceIdentity();
    return identity.deviceId;
  }

  async getActiveSessionKey(): Promise<string> {
    try {
      const sessions = await this.listSessions(50);
      if (sessions.length > 0) {
        const mainSession = sessions.find(
          (s) => s.kind === 'main' || s.key.trim().toLowerCase() === 'main' || s.key.trim().toLowerCase().endsWith(':main'),
        );
        if (mainSession) {
          return mainSession.key.trim();
        }
        return sessions[0].key.trim();
      }
    } catch {
      // fall through to sessions.resolve
    }

    return this.resolveSessionKey('main');
  }

  async createChatSession(): Promise<string> {
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Derive agent prefix from existing sessions so new key lands in the right store
    let agentPrefix = '';
    try {
      const sessions = await this.listSessions(50);
      const mainSession = sessions.find(
        (s) => s.kind === 'main' || s.key.trim().toLowerCase().endsWith(':main'),
      );
      if (mainSession) {
        const parts = mainSession.key.split(':');
        if (parts.length >= 2) {
          agentPrefix = parts.slice(0, -1).join(':');
        }
      }
    } catch {
      // no prefix available
    }

    const newKey = agentPrefix ? `${agentPrefix}:relay-${uuid}` : `relay-${uuid}`;

    // Register the session via sessions.patch so the Gateway knows about it
    // before the first chat.send
    try {
      await this.call('sessions.patch', { key: newKey });
    } catch {
      // Gateway may create it on-demand via chat.send instead
    }

    return newKey;
  }

  async connect(options: GatewayConnectOptions): Promise<void> {
    const wsUrl = this.normalizeGatewayUrl(options.gatewayUrl);

    if (this.isConnected() && this.connectedUrl === wsUrl) {
      return;
    }

    if (this.isConnected() && this.connectedUrl !== wsUrl) {
      this.disconnect();
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      let settled = false;
      let connectChallengeNonce: string | null = null;

      const rejectIfPending = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const resolveIfPending = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const sendConnect = async () => {
        if (!connectChallengeNonce || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
          return;
        }

        const requestedScopes = [...REQUESTED_SCOPES];
        const role = 'operator';
        const token = options.token?.trim() || undefined;
        const password = options.password?.trim() || undefined;

        const authPayload: Record<string, unknown> = {};
        if (token) {
          authPayload.token = token;
        }
        if (password) {
          authPayload.password = password;
        }

        const platform = typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'web';
        const nonce = connectChallengeNonce.trim();

        const identity = await loadOrCreateDeviceIdentity();
        const signedAtMs = Date.now();
        const signaturePayload = buildDeviceAuthPayloadV3({
          deviceId: identity.deviceId,
          clientId: CLIENT_ID,
          clientMode: CLIENT_MODE,
          role,
          scopes: requestedScopes,
          signedAtMs,
          token: token ?? null,
          nonce,
          platform,
          deviceFamily: 'desktop',
        });
        const signature = await signDevicePayload(identity.privateKey, signaturePayload);

        const device = {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signature,
          signedAt: signedAtMs,
          nonce,
        };

        const auth = Object.keys(authPayload).length > 0 ? authPayload : undefined;

        type ConnectHelloPayload = {
          auth?: {
            scopes?: unknown;
          };
        };

        const resolveGrantedScopes = (payload: unknown): string[] => {
          if (!payload || typeof payload !== 'object') {
            return [];
          }
          const hello = payload as ConnectHelloPayload;
          const scopes = hello.auth?.scopes;
          if (!Array.isArray(scopes)) {
            return [];
          }
          return scopes.filter((scope): scope is string => typeof scope === 'string');
        }

        try {
          const connectResult = await this.call(
            'connect',
            {
              minProtocol: GATEWAY_PROTOCOL_VERSION,
              maxProtocol: GATEWAY_PROTOCOL_VERSION,
              client: {
                id: CLIENT_ID,
                displayName: 'Relay',
                version: '0.1.0',
                platform,
                mode: CLIENT_MODE,
                deviceFamily: 'desktop',
              },
              role,
              scopes: requestedScopes,
              caps: [],
              commands: [],
              permissions: {},
              auth,
              device,
              locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
              userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'relay/0.1.0',
            },
            8_000,
          );

          this.grantedScopes = resolveGrantedScopes(connectResult);

          const missingScopes = requestedScopes.filter((scope) => !this.grantedScopes.includes(scope));
          if (this.grantedScopes.length > 0 && missingScopes.length > 0) {
            this.onConnectionHandler?.(
              true,
              `Connected to ${wsUrl} (granted: ${this.grantedScopes.join(', ')}; missing: ${missingScopes.join(', ')}).`,
            );
          } else {
            this.onConnectionHandler?.(true, `Connected to ${wsUrl}`);
          }

          resolveIfPending();
        } catch (error) {
          try {
            socket.close(1008, 'connect failed');
          } catch {
            // ignore close errors during failed handshake
          }
          rejectIfPending(error);
        }
      };

      socket.onopen = () => {
        this.socket = socket;
        this.connectedUrl = wsUrl;

        // OpenClaw sends connect.challenge immediately after open.
        setTimeout(() => {
          if (connectChallengeNonce) {
            return;
          }
          rejectIfPending(new Error('Gateway connect challenge timeout.'));
          try {
            socket.close(1008, 'connect challenge timeout');
          } catch {
            // ignore close errors
          }
        }, 3_000);
      };

      socket.onerror = () => {
        rejectIfPending(new Error(`Unable to open WebSocket connection to ${wsUrl}`));
      };

      socket.onclose = () => {
        this.socket = null;
        this.connectedUrl = null;
        this.rejectPending('Gateway connection closed.');
        this.onConnectionHandler?.(false, 'Disconnected from OpenClaw Gateway.');
        rejectIfPending(new Error('Gateway connection closed before connect completed.'));
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return;
        }

        let parsed: GatewayFrame;
        try {
          parsed = JSON.parse(event.data) as GatewayFrame;
        } catch {
          return;
        }

        if (parsed.type === 'event' && parsed.event === 'connect.challenge') {
          const payload = parsed.payload as { nonce?: unknown } | undefined;
          connectChallengeNonce = typeof payload?.nonce === 'string' ? payload.nonce : null;
          void sendConnect();
          return;
        }

        this.handleSocketMessage(event.data);
      };
    });
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    this.connectedUrl = null;
    this.grantedScopes = [];
    this.rejectPending('Gateway connection closed.');
  }

  resetDeviceIdentity() {
    const storage = getSafeLocalStorage();
    try {
      storage?.removeItem(DEVICE_IDENTITY_STORAGE_KEY);
    } catch {
      // ignore storage errors so re-pair flow can continue with reconnect
    }
  }

  async sendChat(sessionKey: string, text: string): Promise<{ sessionKey: string }> {
    const resolvedSessionKey = sessionKey.trim();
    if (!resolvedSessionKey) {
      throw new Error('Session key is required.');
    }
    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await this.call('chat.send', {
      sessionKey: resolvedSessionKey,
      message: text,
      idempotencyKey,
    });

    return {
      sessionKey: resolvedSessionKey,
    };
  }

  async resolveSessionKey(preferredKey = 'main'): Promise<string> {
    const preferred = preferredKey.trim() || 'main';

    try {
      const resolved = await this.call('sessions.resolve', {
        key: preferred,
        includeGlobal: true,
        includeUnknown: false,
      });
      if (resolved && typeof resolved === 'object') {
        const key = (resolved as { key?: unknown }).key;
        if (typeof key === 'string' && key.trim()) {
          return key.trim();
        }
      }
    } catch {
      // fall through to sessions.list fallback
    }

    try {
      const listed = await this.call('sessions.list', {
        limit: 50,
        includeGlobal: false,
        includeUnknown: false,
      });
      const result = (listed ?? {}) as GatewaySessionsListResult;

      const defaultsMainSession =
        typeof result.defaults?.mainSessionKey === 'string' ? result.defaults.mainSessionKey.trim() : '';
      if (defaultsMainSession) {
        return defaultsMainSession;
      }

      const mainSession = result.sessions?.find(
        (row) => row && typeof row.key === 'string' && (row.kind === 'main' || row.key === 'main'),
      );
      if (mainSession && typeof mainSession.key === 'string' && mainSession.key.trim()) {
        return mainSession.key.trim();
      }

      const firstSession = result.sessions?.find((row) => row && typeof row.key === 'string' && row.key.trim());
      if (firstSession && typeof firstSession.key === 'string') {
        return firstSession.key.trim();
      }
    } catch {
      // final fallback below
    }

    return preferred;
  }



  async getHistory(sessionKey: string, limit = 50) {
    const result = await this.call('chat.history', { sessionKey, limit });
    return this.parseHistory(result);
  }

  async listModels(): Promise<GatewayModelChoice[]> {
    const result = await this.call('models.list', {});
    if (!result || typeof result !== 'object') {
      return [];
    }

    const rows = Array.isArray((result as { models?: unknown[] }).models)
      ? ((result as { models?: unknown[] }).models ?? [])
      : [];

    const seen = new Set<string>();
    const choices: GatewayModelChoice[] = [];

    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object') {
        return;
      }

      const item = row as Record<string, unknown>;
      const provider = typeof item.provider === 'string' ? item.provider.trim() : '';
      const model = typeof item.model === 'string' ? item.model.trim() : '';
      const id = typeof item.id === 'string' ? item.id.trim() : '';

      const value = id || (provider && model ? `${provider}/${model}` : model);
      if (!value || seen.has(value)) {
        return;
      }

      const labelCandidates = [item.label, item.displayName, item.name, value];
      const label = labelCandidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      seen.add(value);
      choices.push({
        value,
        label: label?.trim() ?? `Model ${index + 1}`,
      });
    });

    return choices;
  }

  async getSessionModel(sessionKey: string): Promise<string | null> {
    const result = await this.call('sessions.list', {
      limit: 200,
      includeGlobal: true,
      includeUnknown: false,
    });

    if (!result || typeof result !== 'object') {
      return null;
    }

    const rows = Array.isArray((result as GatewaySessionsListResult).sessions)
      ? (result as GatewaySessionsListResult).sessions ?? []
      : [];
    const normalizedSessionKey = sessionKey.trim();
    const row = rows.find((entry) => entry && typeof entry.key === 'string' && entry.key.trim() === normalizedSessionKey);
    if (!row || typeof row !== 'object') {
      return null;
    }

    const record = row as Record<string, unknown>;
    const provider = typeof record.modelProvider === 'string' ? record.modelProvider.trim() : '';
    const model = typeof record.model === 'string' ? record.model.trim() : '';
    if (!model) {
      return null;
    }

    return provider ? `${provider}/${model}` : model;
  }

  async listSessions(limit = 200): Promise<GatewaySessionSummary[]> {
    const result = await this.call('sessions.list', {
      limit,
      includeGlobal: true,
      includeUnknown: false,
    });

    if (!result || typeof result !== 'object') {
      return [];
    }

    const rows = Array.isArray((result as GatewaySessionsListResult).sessions)
      ? (result as GatewaySessionsListResult).sessions ?? []
      : [];

    const seen = new Set<string>();
    const sessions: GatewaySessionSummary[] = [];

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        continue;
      }

      const record = row as Record<string, unknown>;
      const key = typeof record.key === 'string' ? record.key.trim() : '';
      if (!key) {
        continue;
      }

      const dedupeKey = key.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }

      const kind = typeof record.kind === 'string' ? record.kind.trim() : '';
      sessions.push({
        key,
        kind: kind || (dedupeKey === 'main' ? 'main' : 'chat'),
      });
      seen.add(dedupeKey);
    }

    return sessions;
  }

  async setSessionModel(sessionKey: string, modelValue: string | null): Promise<void> {
    const key = sessionKey.trim();
    if (!key) {
      throw new Error('Session key is required.');
    }

    await this.call('sessions.patch', {
      key,
      model: modelValue && modelValue.trim() ? modelValue.trim() : null,
    });
  }

  async listCronJobs(): Promise<GatewayCronJob[]> {
    const result = await this.call('cron.list', { limit: 200 });
    if (!result || typeof result !== 'object') {
      return [];
    }

    const payload = result as Record<string, unknown>;
    const rows = Array.isArray(payload.jobs)
      ? payload.jobs
      : Array.isArray(payload.crons)
        ? payload.crons
        : Array.isArray(payload.items)
          ? payload.items
          : [];

    const jobs = rows
      .map((row, index) => {
        if (!row || typeof row !== 'object') {
          return null;
        }

        const item = row as Record<string, unknown>;
        const idCandidates = [item.id, item.key, item.name];
        const id = idCandidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);

        const nameCandidates = [item.name, item.label, item.id];
        const name = nameCandidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);

        const scheduleCandidates = [item.schedule, item.cron, item.expression];
        const schedule = scheduleCandidates.find(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        );

        const stateCandidates = [item.state, item.status];
        const state = stateCandidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);

        const nextRunCandidates = [item.nextRunAt, item.nextRun, item.nextAt];
        const nextRunAt = nextRunCandidates.find(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        );

        const lastRunCandidates = [item.lastRunAt, item.lastRun, item.lastCompletedAt];
        const lastRunAt = lastRunCandidates.find(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        );

        const enabled =
          typeof item.enabled === 'boolean'
            ? item.enabled
            : typeof state === 'string'
              ? !['disabled', 'paused', 'inactive'].includes(state.toLowerCase())
              : true;

        if (!id && !name) {
          return null;
        }

        return {
          id: (id ?? `cron-${index + 1}`).trim(),
          name: (name ?? id ?? `Cron ${index + 1}`).trim(),
          schedule: schedule?.trim() ?? 'n/a',
          enabled,
          state: state?.trim() ?? (enabled ? 'enabled' : 'disabled'),
          nextRunAt: nextRunAt?.trim() ?? null,
          lastRunAt: lastRunAt?.trim() ?? null,
        } satisfies GatewayCronJob;
      })
      .filter((entry): entry is GatewayCronJob => Boolean(entry));

    return jobs;
  }

  private parseHistory(payload: unknown): GatewayChatMessage[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const value = payload as Record<string, unknown>;
    const rawMessages = Array.isArray(value.messages)
      ? value.messages
      : Array.isArray(value.history)
        ? value.history
        : [];

    return rawMessages
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const item = entry as Record<string, unknown>;
        const role = typeof item.role === 'string' ? item.role : 'assistant';
        const id = typeof item.id === 'string' ? item.id : `history-${index}`;

        const text =
          typeof item.text === 'string'
            ? item.text
            : typeof item.content === 'string'
              ? item.content
              : '';

        if (!text) {
          return null;
        }

        if (role !== 'user' && role !== 'assistant' && role !== 'system') {
          return { id, role: 'assistant' as const, text };
        }

        return { id, role, text };
      })
      .filter((item): item is GatewayChatMessage => Boolean(item));
  }

  private normalizeGatewayUrl(input: string) {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Gateway URL is required.');
    }

    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
      return trimmed;
    }

    if (trimmed.startsWith('http://')) {
      return `ws://${trimmed.slice('http://'.length)}`;
    }

    if (trimmed.startsWith('https://')) {
      return `wss://${trimmed.slice('https://'.length)}`;
    }

    return `ws://${trimmed}`;
  }

  private async call(method: string, params: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway socket is not connected.');
    }

    const id = `req-${Date.now()}-${this.requestCounter++}`;
    const message = {
      type: 'req' as const,
      id,
      method,
      params,
    };

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeoutId });
    });

    this.socket.send(JSON.stringify(message));
    return responsePromise;
  }

  private handleSocketMessage(raw: unknown) {
    if (typeof raw !== 'string') {
      return;
    }

    let frame: GatewayFrame;
    try {
      frame = JSON.parse(raw) as GatewayFrame;
    } catch {
      return;
    }

    if (frame.type === 'res' && frame.id && this.pending.has(frame.id)) {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(frame.id);

      if (!frame.ok) {
        const details =
          frame.error?.details && typeof frame.error.details === 'object'
            ? (frame.error.details as GatewayErrorDetails)
            : undefined;
        const detailCode =
          typeof details?.code === 'string'
            ? details.code
            : frame.error?.code;
        pending.reject(
          new GatewayRequestError(
            frame.error?.message || frame.error?.code || 'Gateway request failed.',
            detailCode,
            details,
          ),
        );
      } else {
        pending.resolve(frame.payload);
      }
      return;
    }

    if (frame.type === 'event') {
      this.onEventHandler?.(frame);
    }
  }

  private rejectPending(message: string) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
