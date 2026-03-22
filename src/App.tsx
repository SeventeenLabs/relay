import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type {
  AppConfig,
  ChatMessage,
  ChatModelOption,
  HealthCheckResult,
  LocalFilePlanAction,
  ScheduledJob,
} from './app-types';
import { AppSidebar } from './components/layout/app-sidebar';
import { AppTitlebar } from './components/layout/app-titlebar';
import { Button } from './components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './components/ui/command';
import { SidebarProvider } from './components/ui/sidebar';
import { ScrollArea } from './components/ui/scroll-area';
import { GatewayRequestError, OpenClawGatewayClient } from './lib/openclaw-gateway-client';
import { ChatPage } from './pages/chat-page';
import { CoworkPage } from './pages/cowork-page';
import { LoginPage } from './pages/login-page';
import { OnboardingPage } from './pages/onboarding-page';
import { SettingsPage } from './pages/settings-page';
import {
  getSupabaseAuthConfigError,
  restoreSupabaseSession,
  signInWithPassword,
  signOutSupabase,
} from './lib/supabase-auth';

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';

const LOCAL_CONFIG_KEY = 'relay.config';
const AUTH_LOCAL_STORAGE_KEY = 'relay.auth.local';
const AUTH_SESSION_STORAGE_KEY = 'relay.auth.session';
const RELAY_USAGE_MODE_KEY = 'relay.usage.mode';
const RELAY_ONBOARDING_KEY = 'relay.onboarding.complete';

const defaultConfig: AppConfig = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  gatewayToken: '',
};

type AppPage = 'chat' | 'cowork' | 'settings';

type AuthSession = {
  email: string;
  accessToken: string;
  refreshToken: string;
  rememberMe: boolean;
  expiresAt: number;
};

type RecentChatEntry = {
  id: string;
  label: string;
  sessionKey: string;
};

type ChatThread = {
  id: string;
  sessionKey: string;
  title: string;
  updatedAt: number;
};

function extractChatText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const record = message as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) {
    return record.text;
  }
  if (typeof record.content === 'string' && record.content.trim()) {
    return record.content;
  }

  if (Array.isArray(record.content)) {
    const parts = record.content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }
        const part = item as Record<string, unknown>;
        if (part.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter((part) => part.length > 0);
    return parts.join('');
  }

  return '';
}

function extractChatRole(message: unknown): ChatMessage['role'] {
  if (!message || typeof message !== 'object') {
    return 'assistant';
  }

  const role = (message as Record<string, unknown>).role;
  return role === 'user' || role === 'assistant' || role === 'system' ? role : 'assistant';
}

const RECENT_CHAT_CONTEXT_LIMIT = 8;
const RECENT_CHAT_CHARS_PER_MESSAGE = 500;
const SIDEBAR_RECENTS_LIMIT = 7;
const SIDEBAR_RECENT_LABEL_LIMIT = 88;
const MAX_THREAD_STORE_ITEMS = 100;
const DEFAULT_THREAD_TITLE = 'New chat';
const MAIN_SESSION_KEY = 'main';
const MAIN_THREAD_TITLE = 'Main chat';
const COWORK_SEND_SPINNER_MS = 300;

function truncateForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trimEnd()}...`;
}

function buildRecentChatContext(messages: ChatMessage[]): string {
  const recent = messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.text.trim().length > 0)
    .slice(-RECENT_CHAT_CONTEXT_LIMIT)
    .map((message) => {
      const speaker = message.role === 'user' ? 'User' : 'Assistant';
      const normalized = message.text.replace(/\s+/g, ' ').trim();
      return `${speaker}: ${truncateForContext(normalized, RECENT_CHAT_CHARS_PER_MESSAGE)}`;
    });

  return recent.join('\n');
}

function buildOutboundChatPrompt(userText: string, recentMessages: ChatMessage[]): string {
  const contextBlock = buildRecentChatContext(recentMessages);
  if (!contextBlock) {
    return userText;
  }

  return [
    'Use the recent conversation context below when helpful. If context conflicts with the latest user request, prioritize the latest request.',
    '',
    'Recent conversation:',
    contextBlock,
    '',
    'Latest user message:',
    userText,
  ].join('\n');
}

function toRecentSidebarLabel(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= SIDEBAR_RECENT_LABEL_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, SIDEBAR_RECENT_LABEL_LIMIT).trimEnd()}...`;
}

function normalizeSessionKey(sessionKey: string): string {
  return sessionKey.trim();
}

function getThreadIdForSession(sessionKey: string): string {
  return `thread-${sessionKey}`;
}

function deriveThreadTitleFromMessages(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) {
    return '';
  }

  return toRecentSidebarLabel(firstUserMessage.text);
}

function toFallbackThreadTitle(sessionKey: string): string {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return DEFAULT_THREAD_TITLE;
  }

  if (normalized.toLowerCase() === MAIN_SESSION_KEY) {
    return MAIN_THREAD_TITLE;
  }

  return DEFAULT_THREAD_TITLE;
}

function mergeChatThreads(existing: ChatThread[], incoming: ChatThread[]): ChatThread[] {
  const bySession = new Map<string, ChatThread>();

  for (const thread of [...incoming, ...existing]) {
    const normalizedSessionKey = normalizeSessionKey(thread.sessionKey).toLowerCase();
    if (!normalizedSessionKey) {
      continue;
    }

    const previous = bySession.get(normalizedSessionKey);
    if (!previous || thread.updatedAt >= previous.updatedAt) {
      bySession.set(normalizedSessionKey, thread);
    }
  }

  return Array.from(bySession.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_THREAD_STORE_ITEMS);
}

function toRecentSidebarItems(threads: ChatThread[]): RecentChatEntry[] {
  return [...threads]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, SIDEBAR_RECENTS_LIMIT)
    .map((thread) => ({
      id: thread.id,
      label: thread.title,
      sessionKey: thread.sessionKey,
    }));
}

/** Try to extract a UUID from an error message (e.g. pairing request IDs). */
function extractUuidFromMessage(msg?: string): string | undefined {
  if (!msg) return undefined;
  const match = msg.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0];
}

function readGatewayError(error: unknown): { message: string; code?: string; requestId?: string } {
  if (!(error instanceof Error)) {
    return { message: 'Gateway connection failed.' };
  }

  if (error instanceof GatewayRequestError) {
    console.log('[Relay] GatewayRequestError details:', JSON.stringify(error.details));
    const d = error.details as Record<string, unknown> | undefined;
    const requestId =
      (typeof d?.requestId === 'string' && d.requestId) ||
      (typeof d?.request_id === 'string' && d.request_id) ||
      (typeof d?.pairingRequestId === 'string' && d.pairingRequestId) ||
      extractUuidFromMessage(error.message) ||
      undefined;
    return {
      message: error.message,
      code: error.code,
      requestId,
    };
  }

  return {
    message: error.message || 'Gateway connection failed.',
    requestId: extractUuidFromMessage(error.message),
  };
}

export default function App() {
  const bridge = window.relay;
  const gatewayClientRef = useRef<OpenClawGatewayClient | null>(null);
  const activeSessionKeyRef = useRef('');
  const chatLoadRequestRef = useRef(0);
  const skipNextChatEffectLoadRef = useRef(false);
  const threadMessageCache = useRef<Map<string, ChatMessage[]>>(new Map());

  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [draftGatewayUrl, setDraftGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [draftGatewayToken, setDraftGatewayToken] = useState('');
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [status, setStatus] = useState('Loading configuration...');
  const [sendingChat, setSendingChat] = useState(false);
  const [awaitingChatStream, setAwaitingChatStream] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);

  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pairingRequestId, setPairingRequestId] = useState<string | null>(null);
  const [activeMenuItem, setActiveMenuItem] = useState('');
  const [activePage, setActivePage] = useState<AppPage>('cowork');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [workingFolder, setWorkingFolder] = useState('/Downloads');
  const [taskState, setTaskState] = useState<'idle' | 'planned'>('idle');
  const [localPlanActions, setLocalPlanActions] = useState<LocalFilePlanAction[]>([]);
  const [localPlanLoading, setLocalPlanLoading] = useState(false);
  const [localApplyLoading, setLocalApplyLoading] = useState(false);
  const [localPlanRootPath, setLocalPlanRootPath] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeSessionKey, setActiveSessionKey] = useState('');
  const [chatModels, setChatModels] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');
  const [guestMode, setGuestMode] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(
    () => localStorage.getItem(RELAY_ONBOARDING_KEY) === 'true',
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [coworkResetKey, setCoworkResetKey] = useState(0);
  const [coworkSending, setCoworkSending] = useState(false);

  const recentChatItems = toRecentSidebarItems(chatThreads);

  const commitActiveSessionKey = (nextSessionKey: string) => {
    const normalized = normalizeSessionKey(nextSessionKey);
    activeSessionKeyRef.current = normalized;
    setActiveSessionKey(normalized);
    return normalized;
  };

  const upsertChatThread = (sessionKey: string, options?: { title?: string; touchedAt?: number }) => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    if (!normalizedSessionKey) {
      return;
    }

    const incomingTitle = options?.title ? toRecentSidebarLabel(options.title) : '';
    const touchedAt = options?.touchedAt;

    setChatThreads((current) => {
      const existing = current.find((thread) => thread.sessionKey === normalizedSessionKey);
      const canReplaceTitle = !existing || !existing.title || existing.title === DEFAULT_THREAD_TITLE;
      const fallbackTitle = toFallbackThreadTitle(normalizedSessionKey);
      const title = canReplaceTitle && incomingTitle ? incomingTitle : existing?.title || fallbackTitle;
      const updatedAt = touchedAt ?? existing?.updatedAt ?? Date.now();

      const nextThread: ChatThread = {
        id: getThreadIdForSession(normalizedSessionKey),
        sessionKey: normalizedSessionKey,
        title,
        updatedAt,
      };

      return mergeChatThreads(current, [nextThread]);
    });
  };

  const rekeyChatThread = (fromSessionKey: string, toSessionKey: string) => {
    const from = normalizeSessionKey(fromSessionKey);
    const to = normalizeSessionKey(toSessionKey);
    if (!from || !to || from === to) {
      return;
    }

    setChatThreads((current) => {
      const source = current.find((thread) => thread.sessionKey === from);
      const target = current.find((thread) => thread.sessionKey === to);
      if (!source && !target) {
        return current;
      }

      const merged: ChatThread = {
        id: getThreadIdForSession(to),
        sessionKey: to,
        title:
          target?.title && target.title !== DEFAULT_THREAD_TITLE
            ? target.title
            : source?.title || target?.title || DEFAULT_THREAD_TITLE,
        updatedAt: Math.max(source?.updatedAt ?? 0, target?.updatedAt ?? 0, Date.now()),
      };

      const remaining = current.filter((thread) => thread.sessionKey !== from && thread.sessionKey !== to);
      return mergeChatThreads(remaining, [merged]);
    });
  };

  const loadRecentChatsFromBackend = async (client: OpenClawGatewayClient) => {
    const sessions = await client.listSessions(100);

    const filtered = sessions.filter((session) => {
      const normalized = normalizeSessionKey(session.key);
      return !!normalized;
    });

    const threadsOrNull = await Promise.all(
      filtered.slice(0, 20).map(async (session, index) => {
        try {
          const history = await client.getHistory(session.key, 30);
          const titleFromHistory = deriveThreadTitleFromMessages(history);
          if (!titleFromHistory) {
            return null;
          }

          return {
            id: getThreadIdForSession(session.key),
            sessionKey: session.key,
            title: titleFromHistory,
            updatedAt: Date.now() - index,
          } satisfies ChatThread;
        } catch {
          return null;
        }
      }),
    );

    const threads = threadsOrNull.filter((thread): thread is ChatThread => thread !== null);
    setChatThreads(mergeChatThreads([], threads));
  };

  const loadChatSession = async (sessionKeyInput: string, statusMessage?: string) => {
    const client = gatewayClientRef.current;
    if (!client) {
      return;
    }

    const requestedSessionKey = normalizeSessionKey(sessionKeyInput);
    if (!requestedSessionKey) {
      setStatus('Invalid session key.');
      return;
    }
    commitActiveSessionKey(requestedSessionKey);
    const requestId = chatLoadRequestRef.current + 1;
    chatLoadRequestRef.current = requestId;

    try {
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      const [history] = await Promise.all([
        client.getHistory(requestedSessionKey, 30),
        loadModelsForSession(client, requestedSessionKey),
      ]);

      if (requestId !== chatLoadRequestRef.current) {
        return;
      }

      setChatMessages(history);
      if (history.length > 0) {
        threadMessageCache.current.set(requestedSessionKey, history);
      }
      const titleFromHistory = deriveThreadTitleFromMessages(history);
      upsertChatThread(requestedSessionKey, {
        title: titleFromHistory || undefined,
      });

      if (statusMessage) {
        if (titleFromHistory) {
          setStatus(`${statusMessage}: ${titleFromHistory}`);
        } else if (history.length === 0) {
          setStatus(`${statusMessage}: no messages in this chat yet.`);
        } else {
          setStatus(`${statusMessage}: ${toFallbackThreadTitle(requestedSessionKey)}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load chat session.';
      setStatus(message);
    }
  };

  const clearAuthStorage = () => {
    localStorage.removeItem(AUTH_LOCAL_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  };

  const persistAuthSession = (session: AuthSession) => {
    clearAuthStorage();
    const serialized = JSON.stringify(session);
    if (session.rememberMe) {
      localStorage.setItem(AUTH_LOCAL_STORAGE_KEY, serialized);
      return;
    }
    sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, serialized);
  };

  const readStoredAuthSession = (): AuthSession | null => {
    const localRaw = localStorage.getItem(AUTH_LOCAL_STORAGE_KEY);
    const sessionRaw = sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    const raw = localRaw ?? sessionRaw;
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AuthSession>;
      if (
        typeof parsed.email !== 'string' ||
        typeof parsed.accessToken !== 'string' ||
        typeof parsed.refreshToken !== 'string' ||
        typeof parsed.rememberMe !== 'boolean' ||
        typeof parsed.expiresAt !== 'number'
      ) {
        return null;
      }

      return {
        email: parsed.email,
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        rememberMe: parsed.rememberMe,
        expiresAt: parsed.expiresAt,
      };
    } catch {
      return null;
    }
  };

  const ensureConnectedClient = async (client: OpenClawGatewayClient) => {
    await client.connect({
      gatewayUrl: draftGatewayUrl,
      token: draftGatewayToken,
    });
  };

  const getOrResolveSession = async (client: OpenClawGatewayClient) => {
    try {
      const sessionKey = normalizeSessionKey(await client.getActiveSessionKey());
      if (!sessionKey) {
        throw new Error('No active session available from Gateway.');
      }

      commitActiveSessionKey(sessionKey);
      await loadRecentChatsFromBackend(client);
      setStatus(`Session ready: ${sessionKey}`);
      return sessionKey;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to get active session. ${message}`);
    }
  };

  const ensureActiveChatSession = async (
    client: OpenClawGatewayClient,
    options?: { createIfMissing?: boolean },
  ) => {
    await ensureConnectedClient(client);

    const current = normalizeSessionKey(activeSessionKeyRef.current);
    if (current) {
      commitActiveSessionKey(current);
      return current;
    }

    if (options?.createIfMissing) {
      const sessionKey = normalizeSessionKey(await client.createChatSession());
      if (!sessionKey) {
        throw new Error('No session key returned from Gateway.');
      }
      commitActiveSessionKey(sessionKey);
      await loadRecentChatsFromBackend(client);
      setStatus(`Session ready: ${sessionKey}`);
      return sessionKey;
    }

    throw new Error('No active chat session. Start a new chat first.');
  };

  const loadModelsForSession = async (client: OpenClawGatewayClient, sessionKey: string) => {
    setModelsLoading(true);
    try {
      const [choices, currentModel] = await Promise.all([
        client.listModels(),
        client.getSessionModel(sessionKey).catch(() => null),
      ]);

      setChatModels(choices.map((model) => ({ value: model.value, label: model.label })));
      setSelectedModel(currentModel ?? '');
    } catch {
      setChatModels([]);
      setSelectedModel('');
    } finally {
      setModelsLoading(false);
    }
  };

  const loadLocalConfig = () => {
    try {
      const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        gatewayUrl: parsed.gatewayUrl?.trim() || DEFAULT_GATEWAY_URL,
        gatewayToken: parsed.gatewayToken ?? '',
      } satisfies AppConfig;
    } catch {
      return null;
    }
  };

  const persistLocalConfig = (nextConfig: AppConfig) => {
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(nextConfig));
  };

  useEffect(() => {
    const storedUsageMode = localStorage.getItem(RELAY_USAGE_MODE_KEY);
    if (storedUsageMode === 'guest') {
      setGuestMode(true);
      setStatus('Running in local mode.');
    }

    const storedSession = readStoredAuthSession();
    if (!storedSession) {
      const configError = getSupabaseAuthConfigError();
      if (configError && storedUsageMode !== 'guest') {
        setAuthError(configError);
      }
      return;
    }

    let cancelled = false;
    setAuthenticating(true);

    const recoverSession = async () => {
      try {
        const restored = await restoreSupabaseSession(storedSession);
        if (cancelled) {
          return;
        }

        setAuthSession(restored);
        setGuestMode(false);
        localStorage.setItem(RELAY_USAGE_MODE_KEY, 'auth');
        persistAuthSession(restored);
        setStatus(`Signed in as ${restored.email}.`);
      } catch {
        if (cancelled) {
          return;
        }

        clearAuthStorage();
        setAuthError('Session expired or invalid. Please login again.');
      } finally {
        if (!cancelled) {
          setAuthenticating(false);
        }
      }
    };

    void recoverSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bridge) {
      const localConfig = loadLocalConfig();
      if (localConfig) {
        setConfig(localConfig);
        setDraftGatewayUrl(localConfig.gatewayUrl);
        setDraftGatewayToken(localConfig.gatewayToken);
        setStatus('Loaded local configuration (bridge unavailable).');
      } else {
        setStatus('Electron bridge unavailable. Configuration will be saved locally for this browser profile.');
      }
      return;
    }

    let cancelled = false;

    bridge
      .getConfig()
      .then((storedConfig) => {
        if (cancelled) {
          return;
        }

        setConfig(storedConfig);
        setDraftGatewayUrl(storedConfig.gatewayUrl);
        setDraftGatewayToken(storedConfig.gatewayToken);
        setStatus('Configuration loaded.');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        const localConfig = loadLocalConfig();
        if (localConfig) {
          setConfig(localConfig);
          setDraftGatewayUrl(localConfig.gatewayUrl);
          setDraftGatewayToken(localConfig.gatewayToken);
          setStatus('Loaded local fallback configuration.');
        } else {
          setStatus('Unable to load config. Using defaults.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.isWindowMaximized) {
      return;
    }

    bridge
      .isWindowMaximized()
      .then((value) => setIsMaximized(value))
      .catch(() => {
        setIsMaximized(false);
      });
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.getDownloadsPath) {
      return;
    }

    let cancelled = false;
    bridge
      .getDownloadsPath()
      .then((downloadsPath) => {
        if (!cancelled && typeof downloadsPath === 'string' && downloadsPath.trim()) {
          setWorkingFolder(downloadsPath);
        }
      })
      .catch(() => {
        // keep existing default
      });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    activeSessionKeyRef.current = normalizeSessionKey(activeSessionKey);
  }, [activeSessionKey]);

  useEffect(() => {
    const client = new OpenClawGatewayClient();
    client.setConnectionHandler((_connected, message) => {
      setStatus(message);
    });
    client.setEventHandler((event) => {
      if (event.type === 'event' && event.event === 'chat') {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const eventSessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey.trim() : '';
        if (eventSessionKey && eventSessionKey !== activeSessionKeyRef.current) {
          return;
        }

        const runId = typeof payload.runId === 'string' ? payload.runId : `evt-${Date.now()}`;
        const state = typeof payload.state === 'string' ? payload.state : 'final';
        const message = payload.message ?? payload;
        const text = extractChatText(message);
        const role = extractChatRole(message);

        if (state === 'error') {
          setAwaitingChatStream(false);
          const errorMessage =
            typeof payload.errorMessage === 'string' && payload.errorMessage.trim()
              ? payload.errorMessage
              : 'Chat stream failed.';
          setStatus(errorMessage);
          return;
        }

        if (state === 'delta' && text) {
          setAwaitingChatStream(false);
          const streamId = `stream-${runId}`;
          setChatMessages((current) => {
            const index = current.findIndex((entry) => entry.id === streamId);
            if (index >= 0) {
              const next = [...current];
              next[index] = { ...next[index], text, role };
              return next;
            }
            return [...current, { id: streamId, role, text }];
          });
          return;
        }

        if ((state === 'final' || state === 'aborted') && text) {
          setAwaitingChatStream(false);
          const streamId = `stream-${runId}`;
          const finalId = `final-${runId}`;
          setChatMessages((current) => {
            const withoutStream = current.filter((entry) => entry.id !== streamId);
            if (withoutStream.some((entry) => entry.id === finalId)) {
              return withoutStream;
            }
            const next = [...withoutStream, { id: finalId, role, text }];
            const cacheKey = activeSessionKeyRef.current;
            if (cacheKey) {
              threadMessageCache.current.set(cacheKey, next);
            }
            return next;
          });

          if (eventSessionKey) {
            upsertChatThread(eventSessionKey, {
              touchedAt: Date.now(),
            });
          }
        }
      }
    });

    gatewayClientRef.current = client;
    return () => {
      gatewayClientRef.current?.disconnect();
      gatewayClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const client = gatewayClientRef.current;
    if (!client) {
      return;
    }

    void client
      .connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      })
      .then(async () => {
        setHealth({ ok: true, message: `Connected to ${draftGatewayUrl}` });
        if (!onboardingComplete) {
          localStorage.setItem(RELAY_ONBOARDING_KEY, 'true');
          setOnboardingComplete(true);
        }
        await loadRecentChatsFromBackend(client);
      })
      .catch((error: unknown) => {
        console.error('[Relay] auto-connect error:', error);
        const info = readGatewayError(error);
        const isPairing =
          info.code === 'PAIRING_REQUIRED' ||
          /pairing.required/i.test(info.message);
        if (isPairing) {
          setPairingRequestId(info.requestId ?? null);
          const approvalHint = info.requestId
            ? ` Approve with: openclaw devices approve ${info.requestId}`
            : ' Approve the pending request on the gateway host.';
          setHealth({ ok: false, message: `Pairing required.${approvalHint}` });
          setStatus(`Pairing required.${approvalHint}`);
        } else {
          setHealth({ ok: false, message: info.message || 'Gateway connection failed.' });
        }
      });
  }, [draftGatewayUrl, draftGatewayToken]);

  useEffect(() => {
    if (activePage !== 'chat') {
      return;
    }

    const normalized = normalizeSessionKey(activeSessionKey);
    if (!normalized) {
      return;
    }

    if (skipNextChatEffectLoadRef.current) {
      skipNextChatEffectLoadRef.current = false;
      return;
    }

    void loadChatSession(normalized, undefined);
  }, [activePage, activeSessionKey]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();

    const nextConfig: AppConfig = {
      gatewayUrl: draftGatewayUrl.trim() || DEFAULT_GATEWAY_URL,
      gatewayToken: draftGatewayToken,
    };

    setSaving(true);
    setStatus('Saving and connecting...');
    setPairingRequestId(null);

    // Persist config
    if (bridge) {
      try {
        const savedConfig = await bridge.saveConfig(nextConfig);
        setConfig(savedConfig);
        setDraftGatewayUrl(savedConfig.gatewayUrl);
        setDraftGatewayToken(savedConfig.gatewayToken);
        persistLocalConfig(savedConfig);
      } catch {
        setStatus('Failed to save configuration.');
        setSaving(false);
        return;
      }
    } else {
      setConfig(nextConfig);
      persistLocalConfig(nextConfig);
    }

    // Connect
    try {
      const client = gatewayClientRef.current;
      if (!client) {
        throw new Error('Gateway client not initialized.');
      }

      await client.connect({
        gatewayUrl: nextConfig.gatewayUrl,
        token: nextConfig.gatewayToken,
      });

      const sessionKey = normalizeSessionKey(activeSessionKeyRef.current);
      if (sessionKey) {
        void loadModelsForSession(client, sessionKey);
      } else {
        setChatModels([]);
        setSelectedModel('');
      }

      setHealth({ ok: true, message: `Connected to ${nextConfig.gatewayUrl}` });
      setStatus('Configuration saved. Connected to Gateway.');
    } catch (error) {
      console.error('[Relay] connect error:', error);
      const info = readGatewayError(error);
      const isPairing =
        info.code === 'PAIRING_REQUIRED' ||
        /pairing.required/i.test(info.message);
      if (isPairing) {
        setPairingRequestId(info.requestId ?? null);
        const approvalHint = info.requestId
          ? ` Approve with: openclaw devices approve ${info.requestId}`
          : ' Approve the pending request on the gateway host.';
        setHealth({ ok: false, message: `Pairing required.${approvalHint}` });
        setStatus(`Configuration saved. Pairing required.${approvalHint}`);
      } else {
        setHealth({ ok: false, message: info.message || 'Gateway connection failed.' });
        setStatus(`Configuration saved. ${info.message || 'Gateway connection failed.'}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetPairing = async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setChecking(true);
    setPairingRequestId(null);
    setStatus('Resetting local device identity and requesting fresh pairing...');

    try {
      client.disconnect();
      const clientWithReset = client as OpenClawGatewayClient & {
        resetDeviceIdentity?: () => void;
      };
      if (typeof clientWithReset.resetDeviceIdentity === 'function') {
        clientWithReset.resetDeviceIdentity();
      } else {
        // Fallback for stale runtime instances that predate resetDeviceIdentity().
        localStorage.removeItem('openclaw-device-identity-v1');
      }
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      const sessionKey = normalizeSessionKey(activeSessionKeyRef.current);
      if (sessionKey) {
        commitActiveSessionKey(sessionKey);
      }
      setHealth({ ok: true, message: `Re-paired and connected to ${draftGatewayUrl}` });
      setStatus('Re-pair complete. If operator.admin is still missing, approve the new request with admin scope on the gateway host.');
    } catch (error) {
      console.error('[Relay] reset pairing error:', error);
      const info = readGatewayError(error);
      const isPairing =
        info.code === 'PAIRING_REQUIRED' ||
        /pairing.required/i.test(info.message);
      if (isPairing) {
        setPairingRequestId(info.requestId ?? null);
        const approvalHint = info.requestId
          ? `openclaw devices approve ${info.requestId}`
          : 'openclaw devices list then openclaw devices approve <requestId>';
        setHealth({ ok: false, message: 'New pairing request created. Approve it with admin scope.' });
        setStatus(`New pairing request created. Approve with admin scope: ${approvalHint}`);
      } else {
        setHealth({ ok: false, message: info.message || 'Failed to reset pairing.' });
        setStatus(info.message || 'Failed to reset pairing.');
      }
    } finally {
      setChecking(false);
    }
  };

  const handlePlanTask = async (event: FormEvent) => {
    event.preventDefault();
    setCoworkSending(true);

    if (!taskPrompt.trim()) {
      setStatus('Describe the outcome first so OpenClaw can plan the work.');
      setCoworkSending(false);
      return;
    }

    setTaskState('planned');
    setStatus('Plan drafted. Review and approve before execution.');
    await new Promise((resolve) => setTimeout(resolve, COWORK_SEND_SPINNER_MS));
    setCoworkSending(false);
  };

  const handleCreateLocalPlan = async () => {
    if (!bridge?.planOrganizeFolder) {
      setStatus('Local file organizer is available in the Electron desktop app only.');
      return;
    }

    const rootPath = workingFolder.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    setLocalPlanLoading(true);
    try {
      const plan = await bridge.planOrganizeFolder(rootPath);
      setLocalPlanActions(plan.actions);
      setLocalPlanRootPath(plan.rootPath);
      setStatus(`Plan ready: ${plan.actions.length} file action${plan.actions.length === 1 ? '' : 's'} in ${plan.rootPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create local file plan.';
      setStatus(message);
      setLocalPlanActions([]);
      setLocalPlanRootPath('');
    } finally {
      setLocalPlanLoading(false);
    }
  };

  const handlePickWorkingFolder = async () => {
    if (!bridge?.selectFolder) {
      const input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');

      input.onchange = () => {
        const selected = input.files?.[0]?.webkitRelativePath?.split('/')[0] ?? '';
        if (!selected) {
          setStatus('No folder selected.');
          return;
        }

        setWorkingFolder(selected);
        setStatus(
          `Folder selected in browser sandbox: ${selected}. To apply local file changes, run the Electron desktop app (npm run dev).`,
        );
      };

      input.click();
      return;
    }

    try {
      const selected = await bridge.selectFolder(workingFolder);
      if (selected && selected.trim()) {
        setWorkingFolder(selected);
        setStatus(`Working folder selected: ${selected}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open folder picker.';
      setStatus(message);
    }
  };

  const handleApplyLocalPlan = async () => {
    if (!bridge?.applyOrganizeFolderPlan) {
      setStatus('Local file organizer is available in the Electron desktop app only.');
      return;
    }

    if (!localPlanRootPath || localPlanActions.length === 0) {
      setStatus('Create a plan before applying changes.');
      return;
    }

    setLocalApplyLoading(true);
    try {
      const result = await bridge.applyOrganizeFolderPlan(localPlanRootPath, localPlanActions);
      setStatus(
        `Applied ${result.applied} action${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}. ${
          result.errors.length > 0 ? 'Some items had errors.' : 'Done.'
        }`,
      );
      setLocalPlanActions([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply local file plan.';
      setStatus(message);
    } finally {
      setLocalApplyLoading(false);
    }
  };

  const handleSendChat = async (event: FormEvent) => {
    event.preventDefault();

    const text = taskPrompt.trim();
    if (!text) {
      setStatus('Type a message before sending.');
      return;
    }

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setSendingChat(true);
    setAwaitingChatStream(false);
    setTaskPrompt('');

    try {
      const shouldCreateFreshSession = chatMessages.length === 0;

      let sessionKey = '';
      if (shouldCreateFreshSession) {
        await ensureConnectedClient(client);
        sessionKey = normalizeSessionKey(await client.createChatSession());
        if (!sessionKey) {
          throw new Error('No session key returned from Gateway.');
        }
        // Avoid loading history immediately after creating a fresh session,
        // which can race and overwrite the optimistic first user message.
        skipNextChatEffectLoadRef.current = true;
        commitActiveSessionKey(sessionKey);
      } else {
        sessionKey = await ensureActiveChatSession(client, { createIfMissing: true });
      }

      setChatMessages((current) => {
        const next = [...current, { id: `local-${Date.now()}`, role: 'user' as const, text }];
        threadMessageCache.current.set(sessionKey, next);
        return next;
      });

      upsertChatThread(sessionKey, {
        title: text,
        touchedAt: Date.now(),
      });

      const outboundMessage = buildOutboundChatPrompt(text, chatMessages);
      setAwaitingChatStream(true);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const sent = await client.sendChat(sessionKey, outboundMessage);
          sessionKey = sent.sessionKey;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          const isMissing = message.includes('no session found') || message.includes('no sendable session found');
          if (!isMissing || attempt === 3) {
            throw error;
          }
          setStatus(`Send retry ${attempt}/3: session=${sessionKey} failed (${message}). Resolving session...`);
          sessionKey = await getOrResolveSession(client);
        }
      }

      commitActiveSessionKey(sessionKey);
      setStatus(`Message sent to OpenClaw Gateway (session: ${sessionKey}). Waiting for streaming events...`);
    } catch (error) {
      setAwaitingChatStream(false);
      const message = error instanceof Error ? error.message : 'Failed to send chat message.';
      setStatus(message);
    } finally {
      setSendingChat(false);
    }
  };

  const handleModelChange = async (nextModelValue: string) => {
    const previousModel = selectedModel;
    setSelectedModel(nextModelValue);

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      setSelectedModel(previousModel);
      return;
    }

    setChangingModel(true);
    try {
      const sessionKey = await ensureActiveChatSession(client, { createIfMissing: true });
      await client.setSessionModel(sessionKey, nextModelValue || null);
      setStatus(
        nextModelValue
          ? `Model updated for session ${sessionKey}: ${nextModelValue}`
          : `Model reset to default for session ${sessionKey}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update model.';
      setStatus(message);
      setSelectedModel(previousModel);
    } finally {
      setChangingModel(false);
    }
  };

  const handleStartNewChat = async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    // Save current chat messages before switching
    const currentKey = activeSessionKeyRef.current;
    if (currentKey) {
      const currentMessages = chatMessages;
      if (currentMessages.length > 0) {
        threadMessageCache.current.set(currentKey, currentMessages);
      }
    }

    setChatMessages([]);
    setAwaitingChatStream(false);
    setTaskPrompt('');

    try {
      await ensureConnectedClient(client);
      const sessionKey = normalizeSessionKey(await client.createChatSession());
      if (!sessionKey) {
        throw new Error('No session key returned from Gateway.');
      }
      commitActiveSessionKey(sessionKey);
      setActivePage('chat');
      setStatus(`Started a new chat: ${sessionKey}.`);
      void loadModelsForSession(client, sessionKey);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create chat session.';
      setStatus(message);
    }
  };

  const handleOpenRecentChat = (sessionKey: string) => {
    const normalized = sessionKey.trim();
    if (!normalized) {
      return;
    }

    // Save current chat messages before switching
    const currentKey = activeSessionKeyRef.current;
    if (currentKey) {
      setChatMessages((current) => {
        if (current.length > 0) {
          threadMessageCache.current.set(currentKey, current);
        }
        return current;
      });
    }

    setActivePage('chat');
    commitActiveSessionKey(normalized);
    setTaskPrompt('');
    setAwaitingChatStream(false);

    // Restore from local cache first
    const cached = threadMessageCache.current.get(normalized);
    if (cached && cached.length > 0) {
      setChatMessages(cached);
      const titleFromCache = deriveThreadTitleFromMessages(cached);
      setStatus(titleFromCache ? `Opened chat: ${titleFromCache}` : 'Opened chat.');
      skipNextChatEffectLoadRef.current = true;
      return;
    }

    // Fall back to Gateway history
    setChatMessages([]);
    setAwaitingChatStream(false);
    setStatus('Loading recent chat...');
    skipNextChatEffectLoadRef.current = true;
    void loadChatSession(normalized, 'Opened chat');
  };

  const loadScheduledJobs = useCallback(async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setScheduledLoading(true);
    try {
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });
      const rows = await client.listCronJobs();
      setScheduledJobs(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load scheduled jobs.';
      setStatus(message || 'Unable to load scheduled jobs.');
      setScheduledJobs([]);
    } finally {
      setScheduledLoading(false);
    }
  }, [draftGatewayToken, draftGatewayUrl]);

  useEffect(() => {
    if (activePage !== 'cowork') {
      return;
    }

    void loadScheduledJobs();
  }, [activePage, loadScheduledJobs]);

  useEffect(() => {
    if (activePage === 'chat' || activePage === 'settings' || activePage === 'cowork') {
      setActiveMenuItem('');
    }
  }, [activePage]);

  const handleMinimize = async () => {
    if (!bridge?.minimizeWindow) {
      setStatus('Window controls are available only in the Electron desktop app.');
      return;
    }

    try {
      await bridge.minimizeWindow();
    } catch {
      setStatus('Unable to minimize window.');
    }
  };

  const handleToggleMaximize = async () => {
    if (!bridge?.toggleMaximizeWindow) {
      setStatus('Window controls are available only in the Electron desktop app.');
      return;
    }

    try {
      const nextState = await bridge.toggleMaximizeWindow();
      setIsMaximized(nextState);
    } catch {
      setStatus('Unable to resize window.');
    }
  };

  const handleClose = async () => {
    if (bridge?.closeWindow) {
      try {
        await bridge.closeWindow();
        return;
      } catch {
        setStatus('Unable to close window from bridge.');
      }
    }

    window.close();
  };

  const handleShowSystemMenu = async (x: number, y: number) => {
    if (!bridge?.showSystemMenu) {
      return;
    }

    try {
      await bridge.showSystemMenu(x, y);
    } catch {
      setStatus('Unable to open system menu.');
    }
  };

  const handleLogin = async (credentials: {
    email: string;
    password: string;
    rememberMe: boolean;
  }) => {
    setAuthError('');

    const configError = getSupabaseAuthConfigError();
    if (configError) {
      setAuthError(configError);
      return;
    }

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email);
    if (!isValidEmail) {
      setAuthError('Invalid credentials. Use a valid work email.');
      return;
    }

    if (!credentials.password.trim()) {
      setAuthError('Invalid credentials. Password is required.');
      return;
    }

    setAuthenticating(true);
    try {
      const session = await signInWithPassword(credentials.email, credentials.password, credentials.rememberMe);

      setAuthSession(session);
      setGuestMode(false);
      localStorage.setItem(RELAY_USAGE_MODE_KEY, 'auth');
      persistAuthSession(session);
      setStatus(`Signed in as ${session.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid credentials.';
      setAuthError(message);
    } finally {
      setAuthenticating(false);
    }
  };

  const handleLogout = () => {
    if (authSession) {
      void signOutSupabase().catch(() => {
        // local cleanup below is still enough to end the desktop session
      });
    }

    setAuthSession(null);
    setGuestMode(false);
    localStorage.removeItem(RELAY_USAGE_MODE_KEY);
    clearAuthStorage();
    setAuthError('');
    setStatus('Signed out.');
  };

  const handleContinueAsGuest = () => {
    setGuestMode(true);
    setAuthError('');
    setAuthSession(null);
    clearAuthStorage();
    localStorage.setItem(RELAY_USAGE_MODE_KEY, 'guest');
    setStatus('Running in local mode. Sign in anytime for hosted cloud features.');
  };

  const handleCompleteOnboarding = () => {
    localStorage.setItem(RELAY_ONBOARDING_KEY, 'true');
    setOnboardingComplete(true);
    setActivePage('chat');
  };

  const handleStartNewTask = () => {
    setActivePage('cowork');
    setTaskPrompt('');
    setTaskState('idle');
    setLocalPlanActions([]);
    setLocalPlanRootPath('');
    setStatus('Ready for a new task.');
    setCoworkResetKey((current) => current + 1);
  };

  const userIdentityLabel = authSession?.email ?? 'Guest (local mode)';
  const canUseAppShell = Boolean(authSession) || guestMode;
  const needsOnboarding = canUseAppShell && !onboardingComplete;
  const usageModeLabel = guestMode ? 'Local mode' : authSession ? 'Cloud mode' : 'Signed out';
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchCandidates = (normalizedSearchQuery ? chatThreads : recentChatItems).map((item) => ({
    id: item.id,
    sessionKey: item.sessionKey,
    label: 'title' in item ? item.title : item.label,
    updatedAt: 'updatedAt' in item ? item.updatedAt : undefined,
  }));
  const matchingChats = searchCandidates.filter((thread) =>
    thread.label.toLowerCase().includes(normalizedSearchQuery),
  );

  const handleSearchOpenChange = (nextOpen: boolean) => {
    setSearchOpen(nextOpen);
    if (nextOpen) {
      setSearchQuery('');
      setActiveMenuItem('Search');
      return;
    }
    setActiveMenuItem('');
  };

  return (
    <div className="grid h-full grid-rows-[44px_minmax(0,1fr)] overflow-hidden">
      <AppTitlebar
        sidebarOpen={sidebarOpen}
        activePage={activePage}
        isMaximized={isMaximized}
        usageModeLabel={usageModeLabel}
        minimal={needsOnboarding || !canUseAppShell}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onSelectPage={setActivePage}
        onMinimize={handleMinimize}
        onToggleMaximize={handleToggleMaximize}
        onClose={handleClose}
        onShowSystemMenu={handleShowSystemMenu}
      />

      {needsOnboarding ? (
        <OnboardingPage
          draftGatewayUrl={draftGatewayUrl}
          draftGatewayToken={draftGatewayToken}
          health={health}
          saving={saving}
          pairingRequestId={pairingRequestId}
          onDraftGatewayUrlChange={setDraftGatewayUrl}
          onDraftGatewayTokenChange={setDraftGatewayToken}
          onSave={handleSave}
          onComplete={handleCompleteOnboarding}
        />
      ) : canUseAppShell ? (
        <SidebarProvider
          className={`grid h-full overflow-hidden transition-[grid-template-columns] duration-200 ${
            sidebarOpen ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-[64px_minmax(0,1fr)]'
          }`}
        >
          <AppSidebar
            sidebarOpen={sidebarOpen}
            activeMenuItem={activeMenuItem}
            activePage={activePage}
            activeSessionKey={activeSessionKey}
            userEmail={userIdentityLabel}
            guestMode={guestMode}
            recentItems={recentChatItems}
            scheduledItems={scheduledJobs}
            scheduledLoading={scheduledLoading}
            onSelectRecentChat={handleOpenRecentChat}
            onStartNewChat={handleStartNewChat}
            onStartNewTask={handleStartNewTask}
            onSelectMenuItem={setActiveMenuItem}
            onOpenSearch={() => handleSearchOpenChange(true)}
            onOpenSettings={() => setActivePage('settings')}
            onLogout={handleLogout}
          />

          <main className="relative min-h-0 overflow-hidden p-5">
            <CommandDialog
              open={searchOpen}
              onOpenChange={handleSearchOpenChange}
              title="Search"
              description="Search chats and projects"
              className="w-[min(980px,94vw)] max-w-none"
            >
              <Command>
                <CommandInput
                  placeholder="Search chats and projects"
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandList>
                  <CommandEmpty>No results found.</CommandEmpty>
                  <CommandGroup>
                    {matchingChats.map((thread) => (
                      <CommandItem
                        key={thread.id}
                        value={thread.label}
                        onSelect={() => {
                          handleOpenRecentChat(thread.sessionKey);
                          handleSearchOpenChange(false);
                        }}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="truncate">{thread.label}</span>
                        {'updatedAt' in thread && typeof thread.updatedAt === 'number' ? (
                          <span className="text-xs text-muted-foreground">
                            {new Date(thread.updatedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </CommandDialog>
            {activePage === 'cowork' ? (
              <CoworkPage
                key={`cowork-${coworkResetKey}`}
                taskPrompt={taskPrompt}
                workingFolder={workingFolder}
                taskState={taskState}
                status={status}
                desktopBridgeAvailable={Boolean(bridge)}
                localPlanActions={localPlanActions}
                localPlanLoading={localPlanLoading}
                localApplyLoading={localApplyLoading}
                sending={coworkSending}
                onTaskPromptChange={setTaskPrompt}
                onWorkingFolderChange={setWorkingFolder}
                onPickWorkingFolder={handlePickWorkingFolder}
                onSubmit={handlePlanTask}
                onCreateLocalPlan={handleCreateLocalPlan}
                onApplyLocalPlan={handleApplyLocalPlan}
              />
            ) : (
              <ScrollArea className="h-full">
                {activePage === 'chat' && (
                  <ChatPage
                    taskPrompt={taskPrompt}
                    messages={chatMessages}
                    sending={sendingChat}
                    awaitingStream={awaitingChatStream}
                    sessionKey={activeSessionKey}
                    models={chatModels}
                    selectedModel={selectedModel}
                    modelsLoading={modelsLoading}
                    changingModel={changingModel}
                    status={status}
                    onTaskPromptChange={setTaskPrompt}
                    onModelChange={handleModelChange}
                    onSubmit={handleSendChat}
                  />
                )}

                {activePage === 'settings' && (
                  <SettingsPage
                    draftGatewayUrl={draftGatewayUrl}
                    draftGatewayToken={draftGatewayToken}
                    health={health}
                    status={status}
                    saving={saving}
                    pairingRequestId={pairingRequestId}
                    onDraftGatewayUrlChange={setDraftGatewayUrl}
                    onDraftGatewayTokenChange={setDraftGatewayToken}
                    onSave={handleSave}
                    onResetPairing={handleResetPairing}
                  />
                )}
              </ScrollArea>
            )}
          </main>
        </SidebarProvider>
      ) : (
        <LoginPage
          authenticating={authenticating}
          errorMessage={authError}
          onLogin={handleLogin}
          onContinueAsGuest={handleContinueAsGuest}
        />
      )}
    </div>
  );
}
