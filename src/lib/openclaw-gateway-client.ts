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

type GatewaySessionsListResult = {
  defaults?: {
    mainSessionKey?: unknown;
    mainKey?: unknown;
  };
  sessions?: Array<{
    key?: unknown;
    kind?: unknown;
    title?: unknown;
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
  private lastConnectOptions: GatewayConnectOptions | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectEnabled = true;

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

  private scheduleReconnect() {
    if (!this.reconnectEnabled || !this.lastConnectOptions || this.reconnectTimer) {
      return;
    }
    const delays = [1000, 2000, 4000, 8000, 15000, 30000];
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)];
    this.reconnectAttempt += 1;
    this.onConnectionHandler?.(false, `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.lastConnectOptions || this.isConnected()) return;
      void this.connect(this.lastConnectOptions)
        .then(() => {
          this.reconnectAttempt = 0;
        })
        .catch(() => {
          this.scheduleReconnect();
        });
    }, delay);
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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

  private async createSessionByKind(kind: 'chat' | 'cowork'): Promise<string> {
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

    const keyBase = kind === 'cowork' ? `relay-cowork-${uuid}` : `relay-chat-${uuid}`;
    const newKey = agentPrefix ? `${agentPrefix}:${keyBase}` : keyBase;

    // Register the session via sessions.patch so the Gateway knows about it
    // before the first chat.send
    try {
      await this.call('sessions.patch', { key: newKey });
    } catch {
      // Gateway may create it on-demand via chat.send instead
    }

    return newKey;
  }

  async createChatSession(): Promise<string> {
    return this.createSessionByKind('chat');
  }

  async createCoworkSession(): Promise<string> {
    return this.createSessionByKind('cowork');
  }

  async connect(options: GatewayConnectOptions): Promise<void> {
    this.lastConnectOptions = options;
    this.cancelReconnect();
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
                version: '2026.3.24',
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
              userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'relay/2026.3.24',
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
        this.scheduleReconnect();
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
    this.reconnectEnabled = false;
    this.cancelReconnect();
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
      const titleCandidates = [record.title, record.name, record.label];
      const title = titleCandidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      sessions.push({
        key,
        kind: kind || (dedupeKey === 'main' ? 'main' : 'chat'),
        title: title?.trim(),
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

  async setSessionTitle(sessionKey: string, title: string | null): Promise<void> {
    const key = sessionKey.trim();
    if (!key) {
      throw new Error('Session key is required.');
    }

    await this.call('sessions.patch', {
      key,
      title: title && title.trim() ? title.trim() : null,
    });
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const key = sessionKey.trim();
    if (!key) {
      throw new Error('Session key is required.');
    }

    await this.call('sessions.delete', { key });
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

  async createCronJob(input: GatewayCreateCronJobInput): Promise<string | null> {
    const name = input.name.trim();
    const schedule = input.schedule.trim();
    const prompt = input.prompt.trim();
    if (!name) {
      throw new Error('Cron job name is required.');
    }
    if (!schedule) {
      throw new Error('Cron schedule is required.');
    }
    if (!prompt) {
      throw new Error('Cron prompt is required.');
    }

    const result = await this.tryCronMutation([
      { method: 'cron.create', params: { name, schedule, prompt, enabled: input.enabled ?? true, projectId: input.projectId, sessionKey: input.sessionKey } },
      { method: 'cron.create', params: { name, cron: schedule, prompt, enabled: input.enabled ?? true, projectId: input.projectId, sessionKey: input.sessionKey } },
      { method: 'cron.create', params: { job: { name, schedule, prompt, enabled: input.enabled ?? true, projectId: input.projectId, sessionKey: input.sessionKey } } },
      { method: 'cron.add', params: { name, schedule, prompt, enabled: input.enabled ?? true, projectId: input.projectId, sessionKey: input.sessionKey } },
      { method: 'scheduler.create', params: { name, schedule, prompt, enabled: input.enabled ?? true, projectId: input.projectId, sessionKey: input.sessionKey } },
    ]);

    if (!result || typeof result !== 'object') {
      return null;
    }
    const payload = result as Record<string, unknown>;
    const idCandidates = [payload.id, payload.key, payload.jobId];
    const id = idCandidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    return id?.trim() ?? null;
  }

  async updateCronJob(input: GatewayUpdateCronJobInput): Promise<void> {
    const id = input.id.trim();
    if (!id) {
      throw new Error('Cron job id is required.');
    }

    const payload: Record<string, unknown> = { id };
    if (typeof input.name === 'string') payload.name = input.name.trim();
    if (typeof input.schedule === 'string') payload.schedule = input.schedule.trim();
    if (typeof input.prompt === 'string') payload.prompt = input.prompt.trim();
    if (typeof input.enabled === 'boolean') payload.enabled = input.enabled;

    await this.tryCronMutation([
      { method: 'cron.update', params: payload },
      { method: 'cron.patch', params: payload },
      { method: 'cron.set', params: payload },
      { method: 'cron.update', params: { ...payload, key: id } },
      { method: 'scheduler.update', params: payload },
    ]);
  }

  async deleteCronJob(idInput: string): Promise<void> {
    const id = idInput.trim();
    if (!id) {
      throw new Error('Cron job id is required.');
    }

    await this.tryCronMutation([
      { method: 'cron.delete', params: { id } },
      { method: 'cron.remove', params: { id } },
      { method: 'cron.delete', params: { key: id } },
      { method: 'scheduler.delete', params: { id } },
    ]);
  }

  private async tryCronMutation(attempts: Array<{ method: string; params: Record<string, unknown> }>): Promise<unknown> {
    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        return await this.call(attempt.method, attempt.params);
      } catch (error) {
        lastError = error;
        if (!this.shouldRetryCronFallback(error)) {
          throw error;
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('Gateway does not support cron mutation RPCs.');
  }

  private shouldRetryCronFallback(error: unknown): boolean {
    if (error instanceof GatewayRequestError) {
      const code = (error.code ?? '').toLowerCase();
      const detailsCode = (error.details?.code ?? '').toLowerCase();
      const message = (error.message ?? '').toLowerCase();
      if (code.includes('method_not_found') || detailsCode.includes('method_not_found')) {
        return true;
      }
      if (message.includes('unknown method') || message.includes('method not found')) {
        return true;
      }
      if (code.includes('invalid_params') || detailsCode.includes('invalid_params')) {
        return true;
      }
      if (message.includes('invalid param') || message.includes('missing')) {
        return true;
      }
      return false;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('unknown method') || message.includes('method not found')) {
        return true;
      }
    }
    return false;
  }

  /* ═══════════════════════════════════ Tools Catalog ═══════════════════════════════════ */

  /**
   * Fetches the runtime tool catalog from the gateway.
   * Requires `operator.read` scope.
   */
  async fetchToolsCatalog(): Promise<GatewayToolsCatalog> {
    const result = await this.call('tools.catalog', {});

    if (!result || typeof result !== 'object') {
      return { tools: [] };
    }

    const payload = result as Record<string, unknown>;
    const rawTools = Array.isArray(payload.tools)
      ? payload.tools
      : Array.isArray(payload.catalog)
        ? payload.catalog
        : [];

    const tools = rawTools
      .map((entry): GatewayToolEntry | null => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name : '';
        if (!name) return null;
        const tool: GatewayToolEntry = {
          name,
          source: item.source === 'plugin' ? 'plugin' : 'core',
        };
        if (typeof item.group === 'string') tool.group = item.group;
        if (typeof item.pluginId === 'string') tool.pluginId = item.pluginId;
        if (typeof item.optional === 'boolean') tool.optional = item.optional;
        return tool;
      })
      .filter((entry): entry is GatewayToolEntry => entry !== null);

    return { tools };
  }

  /* ═══════════════════════════════════ Workspace File RPCs ═══════════════════════════════════ */

  /**
   * List files in the agent's workspace directory.
   * Calls `workspace.list` on the OpenClaw gateway.
   */
  async listWorkspaceFiles(relativePath?: string): Promise<{
    items: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedMs?: number }>;
    truncated: boolean;
  }> {
    const result = await this.call('workspace.list', {
      path: relativePath ?? '',
    });

    if (!result || typeof result !== 'object') {
      return { items: [], truncated: false };
    }

    const payload = result as Record<string, unknown>;
    const rawItems = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.files)
        ? payload.files
        : Array.isArray(payload.entries)
          ? payload.entries
          : [];

    const items = rawItems
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const path = typeof item.path === 'string' ? item.path : typeof item.name === 'string' ? item.name : '';
        if (!path) return null;
        const kind = item.kind === 'directory' || item.type === 'directory' || item.isDirectory === true
          ? ('directory' as const)
          : ('file' as const);
        const size = typeof item.size === 'number' ? item.size : undefined;
        const modifiedMs = typeof item.modifiedMs === 'number'
          ? item.modifiedMs
          : typeof item.mtime === 'number'
            ? item.mtime
            : undefined;
        return { path, kind, size, modifiedMs };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const truncated = typeof payload.truncated === 'boolean' ? payload.truncated : false;
    return { items, truncated };
  }

  /**
   * Read a file from the agent's workspace.
   * Calls `workspace.read` on the OpenClaw gateway.
   */
  async readWorkspaceFile(relativePath: string): Promise<{ content: string }> {
    const result = await this.call('workspace.read', { path: relativePath });

    if (!result || typeof result !== 'object') {
      return { content: '' };
    }

    const payload = result as Record<string, unknown>;
    const content = typeof payload.content === 'string'
      ? payload.content
      : typeof payload.text === 'string'
        ? payload.text
        : typeof payload.data === 'string'
          ? payload.data
          : '';

    return { content };
  }

  /**
   * Get metadata for a workspace file or directory.
   * Calls `workspace.stat` on the OpenClaw gateway.
   */
  async statWorkspaceFile(relativePath: string): Promise<{
    kind: 'file' | 'directory';
    size: number;
    createdMs: number;
    modifiedMs: number;
  }> {
    const result = await this.call('workspace.stat', { path: relativePath });

    if (!result || typeof result !== 'object') {
      throw new Error('Failed to stat workspace file.');
    }

    const payload = result as Record<string, unknown>;
    const kind = payload.kind === 'directory' || payload.type === 'directory' || payload.isDirectory === true
      ? ('directory' as const)
      : ('file' as const);
    const size = typeof payload.size === 'number' ? payload.size : 0;
    const createdMs = typeof payload.createdMs === 'number'
      ? payload.createdMs
      : typeof payload.ctime === 'number'
        ? payload.ctime
        : 0;
    const modifiedMs = typeof payload.modifiedMs === 'number'
      ? payload.modifiedMs
      : typeof payload.mtime === 'number'
        ? payload.mtime
        : 0;

    return { kind, size, createdMs, modifiedMs };
  }

  /**
   * Rename/move a file in the agent's workspace.
   * Calls `workspace.rename` on the OpenClaw gateway.
   */
  async renameWorkspaceFile(oldPath: string, newPath: string): Promise<void> {
    await this.call('workspace.rename', { oldPath, newPath });
  }

  /**
   * Delete a file or directory in the agent's workspace.
   * Calls `workspace.delete` on the OpenClaw gateway.
   */
  async deleteWorkspaceFile(path: string): Promise<void> {
    await this.call('workspace.delete', { path });
  }

  /**
   * Create (or overwrite) a file in the agent's workspace.
   * Calls `workspace.write` on the OpenClaw gateway.
   */
  async writeWorkspaceFile(path: string, content: string): Promise<void> {
    await this.call('workspace.write', { path, content });
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

        let text = '';
        if (typeof item.text === 'string') {
          text = item.text;
        } else if (typeof item.content === 'string') {
          text = item.content;
        } else if (Array.isArray(item.content)) {
          const parts = item.content
            .map((part) => {
              if (!part || typeof part !== 'object') {
                return '';
              }
              const piece = part as Record<string, unknown>;
              if (piece.type === 'text' && typeof piece.text === 'string') {
                return piece.text;
              }
              return '';
            })
            .filter((part) => part.length > 0);
          text = parts.join('');
        }

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
