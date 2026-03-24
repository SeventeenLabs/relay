import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type {
  AppConfig,
  ChatActivityItem,
  ChatMessage,
  ChatModelOption,
  HealthCheckResult,
  LocalActionReceipt,
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
import { createFileService, LocalFileService } from './lib/file-service';
import { LoginPage } from './features/auth/login-page';
import { OnboardingPage } from './features/auth/onboarding-page';
import { ChatPage } from './features/chat/chat-page';
import { CoworkPage } from './features/cowork/cowork-page';
import { SettingsPage } from './features/settings/settings-page';
import { ActivityPage } from './features/workspace/activity-page';
import { FilesPage } from './features/workspace/files-page';
import { MemoryPage } from './features/workspace/memory-page';
import { SafetyPage } from './features/workspace/safety-page';
import { ScheduledPage } from './features/workspace/scheduled-page';
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
const RELAY_PREFERENCES_KEY = 'relay.preferences';

type UserPreferences = {
  fullName: string;
  displayName: string;
  role: string;
  responsePreferences: string;
  systemPrompt: string;
  theme: 'light' | 'auto' | 'dark';
  style: 'claude' | 'relay';
  language: 'en' | 'de';
};

const defaultPreferences: UserPreferences = {
  fullName: '',
  displayName: '',
  role: '',
  responsePreferences: '',
  systemPrompt: '',
  theme: 'light',
  style: 'claude',
  language: 'en',
};

const defaultConfig: AppConfig = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  gatewayToken: '',
};

type AppPage = 'chat' | 'cowork' | 'files' | 'activity' | 'memory' | 'scheduled' | 'safety' | 'settings';
type SettingsSection = 'Profile' | 'Appearance' | 'System Prompt' | 'Gateway' | 'Connectors' | 'Account' | 'Privacy' | 'Developer';

type AuthSession = {
  email: string;
  accessToken: string;
  refreshToken: string;
  rememberMe: boolean;
  expiresAt: number;
};

type RecentWorkspaceEntry = {
  id: string;
  label: string;
  sessionKey: string;
  kind: 'chat' | 'cowork';
};

type ChatThread = {
  id: string;
  sessionKey: string;
  title: string;
  updatedAt: number;
};

type RelayFileAction =
  | {
      id: string | undefined;
      type: 'create_file';
      path: string;
      content: string;
      overwrite?: boolean;
    }
  | {
      id: string | undefined;
      type: 'append_file';
      path: string;
      content: string;
    }
  | {
      id: string | undefined;
      type: 'read_file';
      path: string;
    }
  | {
      id: string | undefined;
      type: 'list_dir';
      path: string | undefined;
    }
  | {
      id: string | undefined;
      type: 'exists';
      path: string;
    };

type CoworkRunPhase = 'idle' | 'sending' | 'streaming' | 'completed' | 'error';

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
const MAX_LOCAL_ACTIONS_PER_RUN = 20;

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

function toRecentSidebarItems(threads: ChatThread[], kind: 'chat' | 'cowork'): RecentWorkspaceEntry[] {
  return [...threads]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, SIDEBAR_RECENTS_LIMIT)
    .map((thread) => ({
      id: thread.id,
      label: thread.title,
      sessionKey: thread.sessionKey,
      kind,
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

function parseRelayFileActions(rawInput: unknown): RelayFileAction[] {
  const normalizeRelayActions = (value: unknown): RelayFileAction[] => {
    let rawActions: unknown = value;

    if (typeof rawActions === 'string') {
      try {
        rawActions = JSON.parse(rawActions);
      } catch {
        return [];
      }
    }

    const actionArray = Array.isArray(rawActions) ? rawActions : rawActions ? [rawActions] : [];

    return actionArray.reduce<RelayFileAction[]>((acc, action) => {
        if (!action || typeof action !== 'object') {
          return acc;
        }

        const record = action as Record<string, unknown>;
        const type = record.type;
        if (type !== 'create_file' && type !== 'append_file' && type !== 'read_file' && type !== 'list_dir' && type !== 'exists') {
          return acc;
        }

        const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;

        const filePath = typeof record.path === 'string' ? record.path.trim() : '';
        if ((type === 'create_file' || type === 'append_file' || type === 'read_file' || type === 'exists') && !filePath) {
          return acc;
        }

        if (type === 'read_file') {
          acc.push({
            id,
            type: 'read_file' as const,
            path: filePath,
          });
          return acc;
        }

        if (type === 'list_dir') {
          acc.push({
            id,
            type: 'list_dir' as const,
            path: filePath || undefined,
          });
          return acc;
        }

        if (type === 'exists') {
          acc.push({
            id,
            type: 'exists' as const,
            path: filePath,
          });
          return acc;
        }

        const content = typeof record.content === 'string' ? record.content : '';
        const overwrite = typeof record.overwrite === 'boolean' ? record.overwrite : undefined;

        if (type === 'append_file') {
          acc.push({
            id,
            type: 'append_file' as const,
            path: filePath,
            content,
          });
          return acc;
        }

        acc.push({
          id,
          type: 'create_file' as const,
          path: filePath,
          content,
          overwrite,
        });

        return acc;
      }, []);
  };

  const tryParseCandidateText = (candidate: string): RelayFileAction[] => {
    const text = candidate.trim();
    if (!text) {
      return [];
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions);
      if (direct.length > 0) {
        return direct;
      }
    } catch {
      // Continue with fallbacks.
    }

    const jsonObjectWithRelayActionsPattern = /\{[\s\S]*?"relay_actions"[\s\S]*?\}/gi;
    let objectMatch: RegExpExecArray | null;
    while ((objectMatch = jsonObjectWithRelayActionsPattern.exec(text)) !== null) {
      const payload = objectMatch[0]?.trim();
      if (!payload) {
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions);
        if (direct.length > 0) {
          return direct;
        }
      } catch {
        // Keep scanning.
      }
    }

    const jsonCodeBlockPattern = /```json\s*([\s\S]*?)```/gi;
    let codeBlockMatch: RegExpExecArray | null;
    while ((codeBlockMatch = jsonCodeBlockPattern.exec(text)) !== null) {
      const payload = codeBlockMatch[1]?.trim();
      if (!payload) {
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions);
        if (direct.length > 0) {
          return direct;
        }
      } catch {
        // Continue trying other candidates.
      }
    }

    const genericCodeBlockPattern = /```\s*([\s\S]*?)```/gi;
    while ((codeBlockMatch = genericCodeBlockPattern.exec(text)) !== null) {
      const payload = codeBlockMatch[1]?.trim();
      if (!payload) {
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions);
        if (direct.length > 0) {
          return direct;
        }
      } catch {
        // Keep trying.
      }
    }

    return [];
  };

  const queue: unknown[] = [rawInput];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (typeof current === 'string') {
      const fromText = tryParseCandidateText(current);
      if (fromText.length > 0) {
        return fromText;
      }
      continue;
    }

    if (typeof current !== 'object') {
      continue;
    }

    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    const direct = normalizeRelayActions(record.relay_actions ?? record.relayActions);
    if (direct.length > 0) {
      return direct;
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return [];
}

function stripRelayActionPayloadFromText(rawText: string): string {
  if (!rawText.trim()) {
    return '';
  }

  let sanitized = rawText;

  // Remove explicit relay_actions JSON code blocks.
  sanitized = sanitized.replace(/```json\s*[\s\S]*?"relay_actions"[\s\S]*?```/gi, '');

  // Remove generic code blocks that contain relay_actions payload.
  sanitized = sanitized.replace(/```[\s\S]*?"relay_actions"[\s\S]*?```/gi, '');

  // Remove inline JSON objects containing relay_actions.
  sanitized = sanitized.replace(/\{[\s\S]*?"relay_actions"[\s\S]*?\}/gi, '');

  return sanitized.replace(/\n{3,}/g, '\n\n').trim();
}

function parseRelayActivityItems(rawInput: unknown): ChatActivityItem[] {
  const normalizeItems = (value: unknown): ChatActivityItem[] => {
    const items = Array.isArray(value) ? value : [];
    return items.reduce<ChatActivityItem[]>((acc, item, index) => {
      if (!item || typeof item !== 'object') {
        return acc;
      }
      const record = item as Record<string, unknown>;
      const label = typeof record.label === 'string' ? record.label.trim() : '';
      if (!label) {
        return acc;
      }
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `activity-${index + 1}`;
      const toneValue = typeof record.tone === 'string' ? record.tone.trim().toLowerCase() : 'neutral';
      const tone: ChatActivityItem['tone'] =
        toneValue === 'success' || toneValue === 'danger' || toneValue === 'neutral' ? toneValue : 'neutral';
      const details = typeof record.details === 'string' && record.details.trim() ? record.details.trim() : undefined;
      acc.push({ id, label, details, tone });
      return acc;
    }, []);
  };

  const queue: unknown[] = [rawInput];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (typeof current !== 'object') {
      continue;
    }

    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    const direct = normalizeItems(record.relay_activity ?? record.relayActivity);
    if (direct.length > 0) {
      return direct;
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return [];
}

function deriveActivityItemsFromAssistantText(text: string, runId: string): ChatActivityItem[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const lower = normalized.toLowerCase();
  const hasActionVerb =
    lower.includes('created') ||
    lower.includes('updated') ||
    lower.includes('deleted') ||
    lower.includes('scheduled') ||
    lower.includes('applied') ||
    lower.includes('presented');
  const hasWindowsPathHint = normalized.includes(':\\');
  const hasFolderHint = lower.includes(' folder ');
  const hasFileHint = lower.includes(' file');
  const hasInPhrase = lower.includes(' in ');
  const tokens = normalized.split(' ');
  const hasFileNameToken = tokens.some((token) => {
    const trimmed = token.trim();
    if (!trimmed || trimmed.length < 3 || trimmed.length > 80) {
      return false;
    }
    if (trimmed.endsWith('.') || trimmed.endsWith(',')) {
      return false;
    }
    const dotIndex = trimmed.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex >= trimmed.length - 1) {
      return false;
    }
    return true;
  });

  const hasContextHint = hasWindowsPathHint || hasFolderHint || hasFileHint || (hasInPhrase && hasFileNameToken);

  if (!hasActionVerb || !hasContextHint) {
    return [];
  }

  const tone: ChatActivityItem['tone'] =
    lower.includes('failed') || lower.includes('error')
      ? 'danger'
      : lower.includes('created') || lower.includes('updated') || lower.includes('applied') || lower.includes('done')
        ? 'success'
        : 'neutral';

  const firstLine = normalized.split('\n')[0]?.trim() || normalized;
  return [
    {
      id: `activity-summary-${runId}`,
      label: firstLine,
      details: normalized,
      tone,
    },
  ];
}

function normalizeCoworkMessage(message: ChatMessage): ChatMessage {
  if (message.meta?.kind === 'activity' || message.role !== 'assistant') {
    return message;
  }

  const items = deriveActivityItemsFromAssistantText(message.text, message.id);
  if (items.length === 0) {
    return message;
  }

  return {
    ...message,
    meta: {
      kind: 'activity',
      items,
    },
  };
}

export default function App() {
  const bridge = window.relay;
  const gatewayClientRef = useRef<OpenClawGatewayClient | null>(null);
  const activeSessionKeyRef = useRef('');
  const coworkSessionKeyRef = useRef('');
  const workingFolderRef = useRef('');
  const chatLoadRequestRef = useRef(0);
  const coworkLoadRequestRef = useRef(0);
  const skipNextChatEffectLoadRef = useRef(false);
  const threadMessageCache = useRef<Map<string, ChatMessage[]>>(new Map());
  const coworkMessageCache = useRef<Map<string, ChatMessage[]>>(new Map());
  const executedCoworkActionRunsRef = useRef<Set<string>>(new Set());

  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [configReady, setConfigReady] = useState(false);
  const [draftGatewayUrl, setDraftGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [draftGatewayToken, setDraftGatewayToken] = useState('');
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [status, setStatus] = useState('Loading configuration...');
  const [sendingChat, setSendingChat] = useState(false);
  const [awaitingChatStream, setAwaitingChatStream] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [coworkMessages, setCoworkMessages] = useState<ChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [coworkThreads, setCoworkThreads] = useState<ChatThread[]>([]);

  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pairingRequestId, setPairingRequestId] = useState<string | null>(null);
  const [activeMenuItem, setActiveMenuItem] = useState('');
  const [activePage, setActivePage] = useState<AppPage>('cowork');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('Profile');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [workingFolder, setWorkingFolder] = useState('/Downloads');
  const [taskState, setTaskState] = useState<'idle' | 'planned'>('idle');
  const [localPlanActions, setLocalPlanActions] = useState<LocalFilePlanAction[]>([]);
  const [localPlanLoading, setLocalPlanLoading] = useState(false);
  const [localApplyLoading, setLocalApplyLoading] = useState(false);
  const [localFileDraftPath, setLocalFileDraftPath] = useState('notes/todo.md');
  const [localFileDraftContent, setLocalFileDraftContent] = useState('');
  const [localFileCreateLoading, setLocalFileCreateLoading] = useState(false);
  const [localPlanRootPath, setLocalPlanRootPath] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeSessionKey, setActiveSessionKey] = useState('');
  const [coworkSessionKey, setCoworkSessionKey] = useState('');
  const [chatModels, setChatModels] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [coworkModels, setCoworkModels] = useState<ChatModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [changingCoworkModel, setChangingCoworkModel] = useState(false);
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
  const [coworkRightPanelOpen, setCoworkRightPanelOpen] = useState(true);
  const [coworkSending, setCoworkSending] = useState(false);
  const [coworkAwaitingStream, setCoworkAwaitingStream] = useState(false);
  const [coworkStreamingText, setCoworkStreamingText] = useState('');
  const [coworkModel, setCoworkModel] = useState('');
  const [coworkRunPhase, setCoworkRunPhase] = useState<CoworkRunPhase>('idle');
  const [coworkRunStatus, setCoworkRunStatus] = useState('Ready for a new task.');
  const [localActionReceipts, setLocalActionReceipts] = useState<LocalActionReceipt[]>([]);
  const [localActionSmokeRunning, setLocalActionSmokeRunning] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    try {
      const stored = localStorage.getItem(RELAY_PREFERENCES_KEY);
      if (stored) return { ...defaultPreferences, ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return defaultPreferences;
  });
  const [gatewayConnected, setGatewayConnected] = useState(false);

  const fileService = useMemo(
    () => createFileService(gatewayClientRef.current, draftGatewayUrl, Boolean(bridge)),
    // Re-create when connection state or URL changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftGatewayUrl, gatewayConnected, bridge],
  );

  const localFileService = useMemo(
    () => (bridge ? new LocalFileService() : null),
    [bridge],
  );

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(RELAY_PREFERENCES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const recentChatItems = toRecentSidebarItems(chatThreads, 'chat');
  const recentCoworkItems = toRecentSidebarItems(coworkThreads, 'cowork');
  const recentItems = activePage === 'cowork' ? recentCoworkItems : recentChatItems;

  const commitActiveSessionKey = (nextSessionKey: string) => {
    const normalized = normalizeSessionKey(nextSessionKey);
    activeSessionKeyRef.current = normalized;
    setActiveSessionKey(normalized);
    return normalized;
  };

  const commitCoworkSessionKey = (nextSessionKey: string) => {
    const normalized = normalizeSessionKey(nextSessionKey);
    coworkSessionKeyRef.current = normalized;
    setCoworkSessionKey(normalized);
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

  const upsertCoworkThread = (sessionKey: string, options?: { title?: string; touchedAt?: number }) => {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    if (!normalizedSessionKey) {
      return;
    }

    const incomingTitle = options?.title ? toRecentSidebarLabel(options.title) : '';
    const touchedAt = options?.touchedAt;

    setCoworkThreads((current) => {
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

  const pushLocalActionReceipts = (entries: LocalActionReceipt[]) => {
    if (entries.length === 0) {
      return;
    }

    setLocalActionReceipts((current) => [...entries, ...current].slice(0, 30));
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

  const loadCoworkSession = async (sessionKeyInput: string, statusMessage?: string) => {
    const client = gatewayClientRef.current;
    if (!client) {
      return;
    }

    const requestedSessionKey = normalizeSessionKey(sessionKeyInput);
    if (!requestedSessionKey) {
      setStatus('Invalid cowork session key.');
      return;
    }

    commitCoworkSessionKey(requestedSessionKey);
    const requestId = coworkLoadRequestRef.current + 1;
    coworkLoadRequestRef.current = requestId;

    try {
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      const history = await client.getHistory(requestedSessionKey, 50);
      const normalizedHistory = history.map(normalizeCoworkMessage);

      if (requestId !== coworkLoadRequestRef.current) {
        return;
      }

      void loadCoworkModels(client, requestedSessionKey);

      setCoworkMessages(normalizedHistory);
      if (normalizedHistory.length > 0) {
        coworkMessageCache.current.set(requestedSessionKey, normalizedHistory);
      }

      const titleFromHistory = deriveThreadTitleFromMessages(normalizedHistory);
      upsertCoworkThread(requestedSessionKey, {
        title: titleFromHistory || undefined,
      });

      if (statusMessage) {
        setStatus(
          titleFromHistory
            ? `${statusMessage}: ${titleFromHistory}`
            : `${statusMessage}: ${toFallbackThreadTitle(requestedSessionKey)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load cowork session.';
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

  const loadCoworkModels = async (client: OpenClawGatewayClient, sessionKey?: string) => {
    setModelsLoading(true);
    try {
      const [choices, currentModel] = await Promise.all([
        client.listModels(),
        sessionKey ? client.getSessionModel(sessionKey).catch(() => null) : Promise.resolve(null),
      ]);

      setCoworkModels(choices.map((model) => ({ value: model.value, label: model.label })));
      if (sessionKey) {
        setCoworkModel(currentModel ?? '');
      }
    } catch {
      setCoworkModels([]);
      if (sessionKey) {
        setCoworkModel('');
      }
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

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      // Ctrl+N — new chat / new task
      if (event.key === 'n') {
        event.preventDefault();
        if (activePage === 'cowork') {
          setCoworkMessages([]);
          setCoworkAwaitingStream(false);
          setCoworkStreamingText('');
          setCoworkRunPhase('idle');
          setCoworkRunStatus('Ready for a new task.');
          setLocalPlanActions([]);
          setTaskPrompt('');
          setStatus('Ready for a new task.');
          setCoworkResetKey((c) => c + 1);
        } else {
          void handleStartNewChat();
        }
        return;
      }

      // Ctrl+K — open search
      if (event.key === 'k') {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
        if (!searchOpen) {
          setSearchQuery('');
          setActiveMenuItem('Search');
        }
        return;
      }

      // Ctrl+Shift+S — settings
      if (event.key === 'S' && event.shiftKey) {
        event.preventDefault();
        setActivePage('settings');
        return;
      }

      // Ctrl+, — settings (common IDE shortcut)
      if (event.key === ',') {
        event.preventDefault();
        setActivePage('settings');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePage, searchOpen]);

  // Apply theme class to document
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.theme === 'dark') {
      root.classList.add('dark');
    } else if (preferences.theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
      const handler = (e: MediaQueryListEvent) => root.classList.toggle('dark', e.matches);
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      root.classList.remove('dark');
    }
  }, [preferences.theme]);

  useEffect(() => {
    document.documentElement.lang = preferences.language;
  }, [preferences.language]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('relay-style', preferences.style === 'relay');
  }, [preferences.style]);

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
      setConfigReady(true);
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
        setConfigReady(true);
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
        setConfigReady(true);
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
    coworkSessionKeyRef.current = normalizeSessionKey(coworkSessionKey);
  }, [coworkSessionKey]);

  useEffect(() => {
    workingFolderRef.current = workingFolder.trim();
  }, [workingFolder]);

  useEffect(() => {
    const client = new OpenClawGatewayClient();
    client.setConnectionHandler((connected, message) => {
      setStatus(message);
      setGatewayConnected(connected);
    });
    client.setEventHandler((event) => {
      if (event.type === 'event' && event.event === 'chat') {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const eventSessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey.trim() : '';

        const isCoworkEvent = !!eventSessionKey && eventSessionKey === coworkSessionKeyRef.current;
        const runId = typeof payload.runId === 'string' ? payload.runId : `evt-${Date.now()}`;
        const state = typeof payload.state === 'string' ? payload.state : 'final';
        const message = payload.message ?? payload;
        const text = extractChatText(message);
        const visibleText = stripRelayActionPayloadFromText(text);
        const role = extractChatRole(message);

        if (isCoworkEvent) {
          if (state === 'error') {
            setCoworkAwaitingStream(false);
            setCoworkRunPhase('error');
            const errorMessage =
              typeof payload.errorMessage === 'string' && payload.errorMessage.trim()
                ? payload.errorMessage
                : 'Cowork stream failed.';
            setCoworkRunStatus(errorMessage);
            setStatus(errorMessage);
            return;
          }

          if (state === 'delta' && text) {
            setCoworkAwaitingStream(false);
            setCoworkRunPhase('streaming');
            setCoworkRunStatus('Cowork is streaming a response.');
            setCoworkStreamingText(visibleText);
            const streamId = `cowork-stream-${runId}`;
            setCoworkMessages((current) => {
              if (!visibleText) {
                return current;
              }
              const index = current.findIndex((entry) => entry.id === streamId);
              if (index >= 0) {
                const next = [...current];
                next[index] = { ...next[index], text: visibleText, role };
                if (eventSessionKey) {
                  coworkMessageCache.current.set(eventSessionKey, next);
                }
                return next;
              }
              const next = [...current, { id: streamId, role, text: visibleText }];
              if (eventSessionKey) {
                coworkMessageCache.current.set(eventSessionKey, next);
              }
              return next;
            });
            return;
          }

          if (state === 'final' || state === 'aborted') {
            setCoworkAwaitingStream(false);
            setCoworkRunPhase('completed');
            setCoworkRunStatus(state === 'aborted' ? 'Cowork run ended early.' : 'Cowork run completed.');
            setCoworkStreamingText(visibleText);
            const streamId = `cowork-stream-${runId}`;
            const finalId = `cowork-final-${runId}`;
            const relayActions = parseRelayFileActions({
              text,
              message,
              payload,
            });
            const structuredActivityItems = parseRelayActivityItems({
              text,
              message,
              payload,
            });
            const fallbackActivityItems = deriveActivityItemsFromAssistantText(visibleText, runId);
            const activityItems = structuredActivityItems.length > 0 ? structuredActivityItems : fallbackActivityItems;
            const hasStructuredActions = relayActions.length > 0;
            const hasStructuredActivity = activityItems.length > 0;
            setCoworkMessages((current) => {
              const withoutStream = current.filter((entry) => {
                if (entry.id === streamId) {
                  return false;
                }
                if ((hasStructuredActions || hasStructuredActivity) && entry.id.startsWith('cowork-stream-')) {
                  return false;
                }
                return true;
              });
              if (withoutStream.some((entry) => entry.id === finalId)) {
                return withoutStream;
              }
              // When the final event includes structured relay_actions, activity receipts are the
              // canonical UI output and we suppress duplicate assistant confirmation text.
              const next =
                !hasStructuredActions && !hasStructuredActivity && visibleText
                  ? [...withoutStream, { id: finalId, role, text: visibleText }]
                  : withoutStream;
              if (eventSessionKey) {
                coworkMessageCache.current.set(eventSessionKey, next);
              }
              return next;
            });

            if (!hasStructuredActions && hasStructuredActivity) {
              const activityMessage: ChatMessage = {
                id: `cowork-activity-${runId}`,
                role: 'system',
                text: activityItems.map((item) => item.label).join('\n'),
                meta: {
                  kind: 'activity',
                  items: activityItems,
                },
              };

              setCoworkMessages((current) => {
                if (current.some((entry) => entry.id === activityMessage.id)) {
                  return current;
                }

                const next = [...current, activityMessage];
                if (eventSessionKey) {
                  coworkMessageCache.current.set(eventSessionKey, next);
                }
                return next;
              });
            }
            if (eventSessionKey) {
              upsertCoworkThread(eventSessionKey, {
                touchedAt: Date.now(),
              });
            }

            const actionRunKey = `${eventSessionKey || 'unknown'}:${runId}`;
            if (
              relayActions.length > 0 &&
              !executedCoworkActionRunsRef.current.has(actionRunKey)
            ) {
              executedCoworkActionRunsRef.current.add(actionRunKey);
              void (async () => {
                const postActionReceipt = (
                  summary: string,
                  actionReceipts: LocalActionReceipt[],
                  previews: string[],
                  errors: string[],
                ) => {
                  setCoworkRunStatus(summary);
                  setStatus(summary);
                  pushLocalActionReceipts(actionReceipts);

                  const machineReadableReceipt = {
                    relay_action_receipts: actionReceipts,
                  };

                  const receiptLines = [
                    summary,
                    ...previews,
                    ...errors.map((line) => `! ${line}`),
                    '```json',
                    JSON.stringify(machineReadableReceipt, null, 2),
                    '```',
                  ];

                  const activityItems: ChatActivityItem[] = [
                    {
                      id: `activity-summary-${runId}`,
                      label: summary,
                      details: [
                        ...previews,
                        ...errors.map((line) => `! ${line}`),
                      ].join('\n').trim() || summary,
                      tone: errors.length > 0 ? 'danger' : 'success',
                    },
                    ...actionReceipts.map((receipt, index): ChatActivityItem => {
                      const tone: ChatActivityItem['tone'] = receipt.status === 'ok' ? 'success' : 'danger';
                      return {
                        id: `activity-receipt-${runId}-${index + 1}`,
                        label: `${receipt.status === 'ok' ? 'Done.' : 'Failed.'} ${receipt.type} ${receipt.path}`,
                        details: receipt.message || receipt.errorCode || receipt.path,
                        tone,
                      };
                    }),
                  ];

                  const receiptMessage: ChatMessage = {
                    id: `cowork-actions-${runId}`,
                    role: 'system',
                    text: receiptLines.join('\n'),
                    meta: {
                      kind: 'activity',
                      items: activityItems,
                    },
                  };

                  setCoworkMessages((current) => {
                    if (current.some((entry) => entry.id === receiptMessage.id)) {
                      return current;
                    }

                    const next = [...current, receiptMessage];
                    if (eventSessionKey) {
                      coworkMessageCache.current.set(eventSessionKey, next);
                    }
                    return next;
                  });
                };

                if (!bridge) {
                  const noBridgeMessage = 'AI requested local file actions, but Electron desktop bridge is unavailable.';
                  postActionReceipt(noBridgeMessage, [], [], [noBridgeMessage]);
                  return;
                }

                const rootPath = workingFolderRef.current;
                if (!rootPath) {
                  const noFolderMessage = 'AI requested local file actions, but no working folder is selected.';
                  postActionReceipt(noFolderMessage, [], [], [noFolderMessage]);
                  return;
                }

                setCoworkRunStatus('Applying AI file actions...');

                const boundedActions = relayActions.slice(0, MAX_LOCAL_ACTIONS_PER_RUN);
                const actionReceipts: LocalActionReceipt[] = [];
                const previews: string[] = [];
                const errors: string[] = [];

                if (relayActions.length > MAX_LOCAL_ACTIONS_PER_RUN) {
                  errors.push(
                    `Action limit exceeded: received ${relayActions.length}, executed ${MAX_LOCAL_ACTIONS_PER_RUN}.`,
                  );
                }

                const formatPreviewContent = (value: string) => {
                  const trimmed = value.trim();
                  if (!trimmed) {
                    return '(empty)';
                  }
                  const maxChars = 1200;
                  if (trimmed.length <= maxChars) {
                    return trimmed;
                  }
                  return `${trimmed.slice(0, maxChars)}\n... (truncated)`;
                };

                for (let index = 0; index < boundedActions.length; index += 1) {
                  const action = boundedActions[index];
                  const actionId = action.id || `action-${index + 1}`;
                  const actionPath = action.path ?? '.';
                  try {
                    if (action.type === 'create_file') {
                      if (!bridge.createFileInFolder) {
                        const message = `${actionPath}: create_file is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'create_file',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.createFileInFolder(rootPath, action.path, action.content, action.overwrite);
                      actionReceipts.push({
                        id: actionId,
                        type: 'create_file',
                        path: result.filePath,
                        status: 'ok',
                      });
                      previews.push(`+ ${result.filePath}`);
                      continue;
                    }

                    if (action.type === 'append_file') {
                      if (!bridge.appendFileInFolder) {
                        const message = `${actionPath}: append_file is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'append_file',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.appendFileInFolder(rootPath, action.path, action.content);
                      actionReceipts.push({
                        id: actionId,
                        type: 'append_file',
                        path: result.filePath,
                        status: 'ok',
                        message: `Appended ${result.bytesAppended} bytes`,
                      });
                      previews.push(`+ appended ${result.bytesAppended} bytes -> ${result.filePath}`);
                      continue;
                    }

                    if (action.type === 'read_file') {
                      if (!bridge.readFileInFolder) {
                        const message = `${actionPath}: read_file is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'read_file',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.readFileInFolder(rootPath, action.path);
                      actionReceipts.push({
                        id: actionId,
                        type: 'read_file',
                        path: result.filePath,
                        status: 'ok',
                      });
                      previews.push(`> ${result.filePath}`);
                      previews.push('```');
                      previews.push(formatPreviewContent(result.content));
                      previews.push('```');
                      continue;
                    }

                    if (action.type === 'list_dir') {
                      if (!bridge.listDirInFolder) {
                        const message = `${actionPath}: list_dir is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'list_dir',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.listDirInFolder(rootPath, action.path || '');
                      actionReceipts.push({
                        id: actionId,
                        type: 'list_dir',
                        path: action.path || '.',
                        status: 'ok',
                        message: `Listed ${result.items.length} items${result.truncated ? ' (truncated)' : ''}`,
                      });
                      previews.push(`# list_dir ${action.path || '.'}`);
                      previews.push(...result.items.slice(0, 20).map((item) => `${item.kind === 'directory' ? '[dir]' : '[file]'} ${item.path}`));
                      if (result.truncated) {
                        previews.push('... (truncated)');
                      }
                      continue;
                    }

                    if (action.type === 'exists') {
                      if (!bridge.existsInFolder) {
                        const message = `${actionPath}: exists is unavailable in this app context.`;
                        errors.push(message);
                        actionReceipts.push({
                          id: actionId,
                          type: 'exists',
                          path: actionPath,
                          status: 'error',
                          errorCode: 'UNAVAILABLE',
                          message,
                        });
                        continue;
                      }

                      const result = await bridge.existsInFolder(rootPath, action.path);
                      actionReceipts.push({
                        id: actionId,
                        type: 'exists',
                        path: result.path,
                        status: 'ok',
                        message: result.exists ? result.kind : 'none',
                      });
                      previews.push(`? ${result.path} => ${result.exists ? result.kind : 'none'}`);
                    }
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown local file action error.';
                    const fullMessage = `${actionPath}: ${message}`;
                    errors.push(fullMessage);
                    actionReceipts.push({
                      id: actionId,
                      type: action.type,
                      path: actionPath,
                      status: 'error',
                      errorCode: 'ACTION_FAILED',
                      message,
                    });
                  }
                }

                const summaryParts: string[] = [];
                const okCount = actionReceipts.filter((item) => item.status === 'ok').length;
                const errorCount = actionReceipts.filter((item) => item.status === 'error').length;
                if (okCount > 0) {
                  summaryParts.push(`Executed ${okCount} local action${okCount === 1 ? '' : 's'}.`);
                }
                if (errorCount > 0) {
                  summaryParts.push(`Failed ${errorCount} action${errorCount === 1 ? '' : 's'}.`);
                }
                summaryParts.push(`Folder: ${rootPath}`);

                const summary = summaryParts.join(' ') || 'No file actions were applied.';
                postActionReceipt(summary, actionReceipts, previews, errors);
              })();
            } else if (relayActions.length === 0) {
              const noActionMessage: ChatMessage = {
                id: `cowork-actions-missing-${runId}`,
                role: 'system',
                text: [
                  'No executable relay_actions were found in the cowork final event.',
                  `Folder: ${workingFolderRef.current || '(not set)'}`,
                ].join('\n'),
                meta: {
                  kind: 'activity',
                  items: [
                    {
                      id: `activity-no-actions-${runId}`,
                      label: 'No executable relay_actions were found.',
                      details: `Folder: ${workingFolderRef.current || '(not set)'}`,
                      tone: 'neutral',
                    },
                  ],
                },
              };

              setCoworkMessages((current) => {
                if (current.some((entry) => entry.id === noActionMessage.id)) {
                  return current;
                }

                const next = [...current, noActionMessage];
                if (eventSessionKey) {
                  coworkMessageCache.current.set(eventSessionKey, next);
                }
                return next;
              });
            }
            return;
          }
        }

        if (eventSessionKey && eventSessionKey !== activeSessionKeyRef.current) {
          return;
        }

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
    if (!configReady) {
      return;
    }

    const client = gatewayClientRef.current;
    if (!client) {
      return;
    }

    const gatewayUrl = config.gatewayUrl?.trim() || DEFAULT_GATEWAY_URL;
    const gatewayToken = config.gatewayToken ?? '';

    void client
      .connect({
        gatewayUrl,
        token: gatewayToken,
      })
      .then(async () => {
        setHealth({ ok: true, message: `Connected to ${gatewayUrl}` });
        if (!onboardingComplete) {
          localStorage.setItem(RELAY_ONBOARDING_KEY, 'true');
          setOnboardingComplete(true);
        }
        await loadRecentChatsFromBackend(client);
      })
      .catch((error: unknown) => {
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
          const offlineMessage = info.message || 'Gateway is offline or unreachable.';
          setHealth({ ok: false, message: offlineMessage });
          setStatus(offlineMessage);
        }
      });
  }, [config.gatewayToken, config.gatewayUrl, onboardingComplete, configReady]);

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
    workingFolderRef.current = workingFolder.trim();
    setCoworkSending(true);
    setCoworkAwaitingStream(false);
    setCoworkStreamingText('');
    setCoworkRunPhase('sending');
    setCoworkRunStatus('Sending cowork task...');

    const text = taskPrompt.trim();
    if (!text) {
      setStatus('Describe the outcome first so OpenClaw can plan the work.');
      setCoworkSending(false);
      return;
    }

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      setCoworkSending(false);
      return;
    }

    try {
      await ensureConnectedClient(client);

      let sessionKey = normalizeSessionKey(coworkSessionKeyRef.current);
      if (!sessionKey) {
        sessionKey = normalizeSessionKey(await client.createChatSession());
        if (!sessionKey) {
          throw new Error('No cowork session key returned from Gateway.');
        }
        commitCoworkSessionKey(sessionKey);
      }

      setTaskState('planned');
      setCoworkAwaitingStream(true);
      const outboundMessageId = `cowork-user-${Date.now()}`;
      setCoworkMessages((current) => {
        const next = [...current, { id: outboundMessageId, role: 'user' as const, text }];
        coworkMessageCache.current.set(sessionKey, next);
        return next;
      });
      upsertCoworkThread(sessionKey, {
        title: text,
        touchedAt: Date.now(),
      });

      if (coworkModel.trim()) {
        await client.setSessionModel(sessionKey, coworkModel.trim());
      }

      const folderContext = workingFolderRef.current;
      const relayFileInstruction = [
        'If local file actions are required, include ONE JSON code block in your response with this schema only:',
        '```json',
        '{"relay_actions":[{"id":"a1","type":"create_file","path":"relative/path.ext","content":"file contents","overwrite":false},{"id":"a2","type":"append_file","path":"relative/path.ext","content":"more text"},{"id":"a3","type":"read_file","path":"relative/path.ext"},{"id":"a4","type":"list_dir","path":"relative/folder"},{"id":"a5","type":"exists","path":"relative/path.ext"}]}',
        '```',
        'Only include relay_actions when local file actions are required.',
      ].join('\n');
      const outboundMessage = [
        folderContext ? `Working folder context: ${folderContext}` : '',
        relayFileInstruction,
        '',
        text,
      ]
        .filter((part) => part.length > 0)
        .join('\n\n');

      setCoworkRunPhase('streaming');
      setCoworkRunStatus('Waiting for cowork stream...');
      setStatus('Cowork message sent. Waiting for stream...');
      await client.sendChat(sessionKey, outboundMessage);
      await new Promise((resolve) => setTimeout(resolve, COWORK_SEND_SPINNER_MS));
    } catch (error) {
      setCoworkAwaitingStream(false);
      setCoworkRunPhase('error');
      const message = error instanceof Error ? error.message : 'Failed to send cowork task.';
      setCoworkRunStatus(message);
      setStatus(message);
    } finally {
      setCoworkSending(false);
    }
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

  const handleWorkingFolderChange = (value: string) => {
    setWorkingFolder(value);
    workingFolderRef.current = value.trim();
  };

  const handleCreateFileInWorkingFolder = async () => {
    if (!bridge?.createFileInFolder) {
      setStatus('Creating local files is available in the Electron desktop app only.');
      return;
    }

    const rootPath = workingFolder.trim();
    const relativePath = localFileDraftPath.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    if (!relativePath) {
      setStatus('Provide a relative file path (for example: notes/todo.md).');
      return;
    }

    setLocalFileCreateLoading(true);
    try {
      const result = await bridge.createFileInFolder(rootPath, relativePath, localFileDraftContent);
      setStatus(`Created file: ${result.filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create file in working folder.';
      setStatus(message);
    } finally {
      setLocalFileCreateLoading(false);
    }
  };

  const handleRunLocalActionSmokeTest = async () => {
    if (!bridge) {
      setStatus('Local action smoke test is available in the Electron desktop app only.');
      return;
    }

    const rootPath = workingFolder.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    const relativePath = 'relay-smoke-test.md';
    setLocalActionSmokeRunning(true);

    const receipts: LocalActionReceipt[] = [];
    const errors: string[] = [];

    try {
      if (bridge.createFileInFolder) {
        await bridge.createFileInFolder(rootPath, relativePath, '# Relay Smoke Test\n', true);
        receipts.push({ id: 'smoke-create', type: 'create_file', path: relativePath, status: 'ok' });
      }

      if (bridge.appendFileInFolder) {
        await bridge.appendFileInFolder(rootPath, relativePath, '\nAppended line from smoke test.\n');
        receipts.push({ id: 'smoke-append', type: 'append_file', path: relativePath, status: 'ok' });
      }

      if (bridge.readFileInFolder) {
        const readResult = await bridge.readFileInFolder(rootPath, relativePath);
        receipts.push({
          id: 'smoke-read',
          type: 'read_file',
          path: readResult.filePath,
          status: 'ok',
          message: `Read ${readResult.content.length} chars`,
        });
      }

      if (bridge.existsInFolder) {
        const exists = await bridge.existsInFolder(rootPath, relativePath);
        receipts.push({
          id: 'smoke-exists',
          type: 'exists',
          path: exists.path,
          status: exists.exists ? 'ok' : 'error',
          errorCode: exists.exists ? undefined : 'NOT_FOUND',
          message: exists.exists ? exists.kind : 'none',
        });
      }

      if (bridge.listDirInFolder) {
        const listing = await bridge.listDirInFolder(rootPath, '');
        receipts.push({
          id: 'smoke-list',
          type: 'list_dir',
          path: '.',
          status: 'ok',
          message: `Listed ${listing.items.length} item${listing.items.length === 1 ? '' : 's'}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown smoke test failure.';
      errors.push(message);
      receipts.push({
        id: 'smoke-error',
        type: 'exists',
        path: relativePath,
        status: 'error',
        errorCode: 'SMOKE_FAILED',
        message,
      });
    } finally {
      pushLocalActionReceipts(receipts);
      if (errors.length > 0) {
        setStatus(`Local action smoke test failed: ${errors[0]}`);
      } else {
        setStatus(`Local action smoke test passed. File: ${rootPath}\\${relativePath}`);
      }
      setLocalActionSmokeRunning(false);
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

  const handleCoworkModelChange = async (nextModelValue: string) => {
    const previousModel = coworkModel;
    setCoworkModel(nextModelValue);

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      setCoworkModel(previousModel);
      return;
    }

    const sessionKey = normalizeSessionKey(coworkSessionKeyRef.current);
    if (!sessionKey) {
      setStatus(
        nextModelValue
          ? `Cowork model selected: ${nextModelValue}. It will apply on the next task run.`
          : 'Cowork model reset to default. It will apply on the next task run.',
      );
      return;
    }

    setChangingCoworkModel(true);
    try {
      await ensureConnectedClient(client);
      await client.setSessionModel(sessionKey, nextModelValue || null);
      setStatus(
        nextModelValue
          ? `Cowork model updated for session ${sessionKey}: ${nextModelValue}`
          : `Cowork model reset to default for session ${sessionKey}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update cowork model.';
      setStatus(message);
      setCoworkModel(previousModel);
    } finally {
      setChangingCoworkModel(false);
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

  const handleOpenRecentCowork = (sessionKey: string) => {
    const normalized = sessionKey.trim();
    if (!normalized) {
      return;
    }

    setActivePage('cowork');
    commitCoworkSessionKey(normalized);
    setTaskPrompt('');
    setCoworkAwaitingStream(false);
    setCoworkRunPhase('idle');
    setCoworkRunStatus('Opened previous cowork session.');

    const cached = coworkMessageCache.current.get(normalized);
    if (cached && cached.length > 0) {
      setCoworkMessages(cached);
      const titleFromCache = deriveThreadTitleFromMessages(cached);
      setStatus(titleFromCache ? `Opened task: ${titleFromCache}` : 'Opened task.');
      return;
    }

    setCoworkMessages([]);
    setStatus('Loading recent cowork task...');
    void loadCoworkSession(normalized, 'Opened task');
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
    if (activePage !== 'cowork' && activePage !== 'scheduled') {
      return;
    }

    void loadScheduledJobs();
    const client = gatewayClientRef.current;
    if (client && activePage === 'cowork') {
      const sessionKey = normalizeSessionKey(coworkSessionKeyRef.current);
      void loadCoworkModels(client, sessionKey || undefined);
    }
  }, [activePage, loadScheduledJobs]);

  useEffect(() => {
    setActiveMenuItem('');
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
    commitCoworkSessionKey('');
    setCoworkMessages([]);
    setCoworkAwaitingStream(false);
    setCoworkStreamingText('');
    setCoworkRunPhase('idle');
    setCoworkRunStatus('Ready for a new task.');
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
  const allThreadsForSearch = [
    ...chatThreads.map((t) => ({ ...t, label: t.title, kind: 'chat' as const })),
    ...coworkThreads.map((t) => ({ ...t, label: t.title, kind: 'cowork' as const })),
  ];
  const searchCandidates = (normalizedSearchQuery ? allThreadsForSearch : recentItems).map((item) => ({
    id: item.id,
    sessionKey: item.sessionKey,
    label: ('title' in item ? item.title : item.label) as string,
    updatedAt: ('updatedAt' in item ? item.updatedAt : undefined) as number | undefined,
    kind: ('kind' in item ? item.kind : 'chat') as 'chat' | 'cowork',
  }));
  const matchingChats = normalizedSearchQuery
    ? searchCandidates.filter((thread) => thread.label.toLowerCase().includes(normalizedSearchQuery))
    : searchCandidates;

  const handleSearchOpenChange = (nextOpen: boolean) => {
    setSearchOpen(nextOpen);
    if (nextOpen) {
      setSearchQuery('');
      setActiveMenuItem('Search');
      return;
    }
    setActiveMenuItem('');
  };

  const handleExportChat = useCallback(() => {
    if (chatMessages.length === 0) return;
    const lines = chatMessages.map((m) => {
      const speaker = m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : 'Assistant';
      return `## ${speaker}\n\n${m.text}`;
    });
    const markdown = `# Chat Export — ${new Date().toLocaleDateString()}\n\n${lines.join('\n\n---\n\n')}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-chat-${activeSessionKey || 'export'}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chatMessages, activeSessionKey]);

  return (
    <div className="grid h-full grid-rows-[44px_minmax(0,1fr)] overflow-hidden">
      <AppTitlebar
        sidebarOpen={sidebarOpen}
        activePage={activePage}
        coworkRightPanelOpen={coworkRightPanelOpen}
        isMaximized={isMaximized}
        usageModeLabel={usageModeLabel}
        minimal={needsOnboarding || !canUseAppShell}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onToggleCoworkRightPanel={() => setCoworkRightPanelOpen((current) => !current)}
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
            activeCoworkSessionKey={coworkSessionKey}
            userEmail={userIdentityLabel}
            guestMode={guestMode}
            gatewayConnected={gatewayConnected}
            language={preferences.language}
            settingsSection={settingsSection}
            recentItems={recentItems}
            scheduledItems={scheduledJobs}
            scheduledLoading={scheduledLoading}
            onSelectRecentItem={(item) => {
              if (item.kind === 'cowork') {
                handleOpenRecentCowork(item.sessionKey);
                return;
              }
              handleOpenRecentChat(item.sessionKey);
            }}
            onStartNewChat={handleStartNewChat}
            onStartNewTask={handleStartNewTask}
            onSelectMenuItem={setActiveMenuItem}
            onSelectPage={(page) => setActivePage(page)}
            onOpenSearch={() => handleSearchOpenChange(true)}
            onOpenSettings={() => setActivePage('settings')}
            onSettingsSectionChange={setSettingsSection}
            onLanguageChange={(language) => updatePreferences({ language })}
            onLogout={handleLogout}
          />

          <main className={`relative min-h-0 overflow-hidden ${activePage === 'files' ? 'p-0' : 'p-5'}`}>
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
                          if (thread.kind === 'cowork') {
                            handleOpenRecentCowork(thread.sessionKey);
                          } else {
                            handleOpenRecentChat(thread.sessionKey);
                          }
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
                messages={coworkMessages}
                rightPanelOpen={coworkRightPanelOpen}
                awaitingStream={coworkAwaitingStream}
                streamingAssistantText={coworkStreamingText}
                runPhase={coworkRunPhase}
                runStatus={coworkRunStatus}
                sessionKey={coworkSessionKey}
                selectedModel={coworkModel}
                models={coworkModels}
                modelsLoading={modelsLoading}
                changingModel={changingCoworkModel}
                desktopBridgeAvailable={Boolean(bridge)}
                localPlanActions={localPlanActions}
                localPlanLoading={localPlanLoading}
                localApplyLoading={localApplyLoading}
                fileCreateLoading={localFileCreateLoading}
                localActionReceipts={localActionReceipts}
                localActionSmokeRunning={localActionSmokeRunning}
                fileDraftPath={localFileDraftPath}
                fileDraftContent={localFileDraftContent}
                sending={coworkSending}
                onTaskPromptChange={setTaskPrompt}
                onWorkingFolderChange={handleWorkingFolderChange}
                onModelChange={handleCoworkModelChange}
                onFileDraftPathChange={setLocalFileDraftPath}
                onFileDraftContentChange={setLocalFileDraftContent}
                onPickWorkingFolder={handlePickWorkingFolder}
                onSubmit={handlePlanTask}
                onCreateLocalPlan={handleCreateLocalPlan}
                onApplyLocalPlan={handleApplyLocalPlan}
                onCreateFileInWorkingFolder={handleCreateFileInWorkingFolder}
                onRunLocalActionSmokeTest={handleRunLocalActionSmokeTest}
              />
            ) : activePage === 'files' ? (
              <FilesPage
                workingFolder={workingFolder}
                desktopBridgeAvailable={Boolean(bridge)}
                onPickFolder={handlePickWorkingFolder}
                fileService={fileService}
                localFileService={localFileService}
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
                    onExport={handleExportChat}
                    onNewChat={handleStartNewChat}
                    onClearChat={() => setChatMessages([])}
                    onOpenSettings={() => setActivePage('settings')}
                  />
                )}

                {activePage === 'activity' && (
                  <ActivityPage
                    chatMessages={chatMessages}
                    coworkMessages={coworkMessages}
                    activeSessionKey={activeSessionKey}
                    coworkSessionKey={coworkSessionKey}
                    gatewayConnected={gatewayConnected}
                  />
                )}

                {activePage === 'memory' && (
                  <MemoryPage
                    gatewayConnected={gatewayConnected}
                  />
                )}

                {activePage === 'scheduled' && (
                  <ScheduledPage
                    jobs={scheduledJobs}
                    loading={scheduledLoading}
                    status={status}
                    onRefresh={loadScheduledJobs}
                  />
                )}

                {activePage === 'safety' && (
                  <SafetyPage
                    gatewayConnected={gatewayConnected}
                  />
                )}

                {activePage === 'settings' && (
                  <SettingsPage
                    activeSection={settingsSection}
                    draftGatewayUrl={draftGatewayUrl}
                    draftGatewayToken={draftGatewayToken}
                    health={health}
                    status={status}
                    saving={saving}
                    pairingRequestId={pairingRequestId}
                    preferences={preferences}
                    onDraftGatewayUrlChange={setDraftGatewayUrl}
                    onDraftGatewayTokenChange={setDraftGatewayToken}
                    onSave={handleSave}
                    onResetPairing={handleResetPairing}
                    onUpdatePreferences={updatePreferences}
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
