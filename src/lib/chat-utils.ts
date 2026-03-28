/**
 * Pure utility functions and shared types for chat, cowork, and thread management.
 * No React imports — safe to use anywhere.
 */
import type { ChatActivityItem, ChatMessage } from '@/app-types';
import { GatewayRequestError } from './openclaw-gateway-client';

/* ── Exported types ──────────────────────────────────────────────────────── */

export type ChatThread = {
  id: string;
  sessionKey: string;
  title: string;
  updatedAt: number;
};

export type PersistedRecents = {
  chatThreads?: ChatThread[];
  coworkThreads?: ChatThread[];
};

export type RecentWorkspaceEntry = {
  id: string;
  label: string;
  sessionKey: string;
  kind: 'chat' | 'cowork';
};

export type RelayFileAction =
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
    }
  | {
      id: string | undefined;
      type: 'rename';
      path: string;
      newPath: string;
    }
  | {
      id: string | undefined;
      type: 'delete';
      path: string;
    }
  | {
      id: string | undefined;
      type: 'shell_exec';
      path: string;
      command: string;
      timeoutMs?: number;
    }
  | {
      id: string | undefined;
      type: 'web_fetch';
      path: string;
      url: string;
      method?: string;
      body?: string;
      contentType?: string;
    };

/* ── Constants ───────────────────────────────────────────────────────────── */

export const RELAY_RECENTS_KEY = 'relay.recents.v1';

export const DEFAULT_CHAT_THREAD_TITLE = 'New chat';
export const DEFAULT_COWORK_THREAD_TITLE = 'New task';
export const MAIN_SESSION_KEY = 'main';

const MAIN_THREAD_TITLE = 'Main chat';
const RECENT_CHAT_CONTEXT_LIMIT = 8;
const RECENT_CHAT_CHARS_PER_MESSAGE = 500;
const SIDEBAR_RECENTS_LIMIT = 7;
const SIDEBAR_RECENT_LABEL_LIMIT = 88;
const MAX_THREAD_STORE_ITEMS = 100;

/* ── Message extraction ──────────────────────────────────────────────────── */

export function extractChatText(message: unknown): string {
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

export function extractChatRole(message: unknown): ChatMessage['role'] {
  if (!message || typeof message !== 'object') {
    return 'assistant';
  }

  const role = (message as Record<string, unknown>).role;
  return role === 'user' || role === 'assistant' || role === 'system' ? role : 'assistant';
}

/* ── Context building ────────────────────────────────────────────────────── */

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

export function buildOutboundChatPrompt(userText: string, recentMessages: ChatMessage[]): string {
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

/* ── Label / key utilities ───────────────────────────────────────────────── */

export function toRecentSidebarLabel(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= SIDEBAR_RECENT_LABEL_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, SIDEBAR_RECENT_LABEL_LIMIT).trimEnd()}...`;
}

export function normalizeSessionKey(sessionKey: string): string {
  return sessionKey.trim();
}

export function getThreadIdForSession(sessionKey: string): string {
  return `thread-${sessionKey}`;
}

export function findMatchingSessionKey(sessionKeys: string[], requestedKey: string): string | null {
  const requested = normalizeSessionKey(requestedKey);
  if (!requested) {
    return null;
  }

  const requestedLower = requested.toLowerCase();
  const direct = sessionKeys.find((key) => normalizeSessionKey(key).toLowerCase() === requestedLower);
  if (direct) {
    return normalizeSessionKey(direct);
  }

  const requestedTail = requestedLower.includes(':')
    ? requestedLower.slice(requestedLower.lastIndexOf(':') + 1)
    : requestedLower;
  if (!requestedTail) {
    return null;
  }

  const byTail = sessionKeys.find((key) => {
    const normalized = normalizeSessionKey(key).toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized.endsWith(`:${requestedTail}`)) {
      return true;
    }
    const tail = normalized.includes(':') ? normalized.slice(normalized.lastIndexOf(':') + 1) : normalized;
    return tail === requestedTail;
  });

  return byTail ? normalizeSessionKey(byTail) : null;
}

/* ── Thread utilities ────────────────────────────────────────────────────── */

export function deriveThreadTitleFromMessages(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) {
    return '';
  }
  return toRecentSidebarLabel(firstUserMessage.text);
}

export function toFallbackThreadTitle(sessionKey: string, kind: 'chat' | 'cowork' = 'chat'): string {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return kind === 'cowork' ? DEFAULT_COWORK_THREAD_TITLE : DEFAULT_CHAT_THREAD_TITLE;
  }
  if (normalized.toLowerCase() === MAIN_SESSION_KEY) {
    return MAIN_THREAD_TITLE;
  }
  return kind === 'cowork' ? DEFAULT_COWORK_THREAD_TITLE : DEFAULT_CHAT_THREAD_TITLE;
}

export function isCustomChatThreadTitle(title: string, sessionKey: string): boolean {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return false;
  }
  return normalizedTitle !== toFallbackThreadTitle(sessionKey, 'chat');
}

export function mergeChatThreads(existing: ChatThread[], incoming: ChatThread[]): ChatThread[] {
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

function normalizeStoredThread(thread: unknown): ChatThread | null {
  if (!thread || typeof thread !== 'object') {
    return null;
  }

  const record = thread as Record<string, unknown>;
  const sessionKey = typeof record.sessionKey === 'string' ? normalizeSessionKey(record.sessionKey) : '';
  if (!sessionKey) {
    return null;
  }

  const title = typeof record.title === 'string' ? toRecentSidebarLabel(record.title) : '';
  const updatedAtRaw = typeof record.updatedAt === 'number' ? record.updatedAt : Number(record.updatedAt);
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();

  return {
    id: getThreadIdForSession(sessionKey),
    sessionKey,
    title: title || toFallbackThreadTitle(sessionKey, sessionKey.toLowerCase().includes('cowork') ? 'cowork' : 'chat'),
    updatedAt,
  };
}

export function loadPersistedRecents(): PersistedRecents {
  try {
    const raw = localStorage.getItem(RELAY_RECENTS_KEY);
    if (!raw) {
      return { chatThreads: [], coworkThreads: [] };
    }

    const parsed = JSON.parse(raw) as PersistedRecents;
    const chatThreads = Array.isArray(parsed?.chatThreads)
      ? parsed.chatThreads
          .map(normalizeStoredThread)
          .filter((thread): thread is ChatThread => thread !== null)
      : [];
    const coworkThreads = Array.isArray(parsed?.coworkThreads)
      ? parsed.coworkThreads
          .map(normalizeStoredThread)
          .filter((thread): thread is ChatThread => thread !== null)
      : [];

    return {
      chatThreads: mergeChatThreads([], chatThreads),
      coworkThreads: mergeChatThreads([], coworkThreads),
    };
  } catch {
    return { chatThreads: [], coworkThreads: [] };
  }
}

export function toRecentSidebarItems(threads: ChatThread[], kind: 'chat' | 'cowork'): RecentWorkspaceEntry[] {
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

/* ── Gateway error helpers ───────────────────────────────────────────────── */

function extractUuidFromMessage(msg?: string): string | undefined {
  if (!msg) return undefined;
  const match = msg.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0];
}

export function readGatewayError(error: unknown): { message: string; code?: string; requestId?: string } {
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

/* ── Relay file action parsing ───────────────────────────────────────────── */

export function parseRelayFileActions(rawInput: unknown): RelayFileAction[] {
  const hasUnsafePathChars = (value: string): boolean =>
    Array.from(value).some((char) => char.charCodeAt(0) < 32);

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
        if (
          type !== 'create_file' &&
          type !== 'append_file' &&
          type !== 'read_file' &&
          type !== 'list_dir' &&
          type !== 'exists' &&
          type !== 'rename' &&
          type !== 'delete'
        ) {
          return acc;
        }

        const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;

        const filePath = typeof record.path === 'string' ? record.path.trim() : '';
        if (filePath && hasUnsafePathChars(filePath)) {
          return acc;
        }
        if ((type === 'create_file' || type === 'append_file' || type === 'read_file' || type === 'exists' || type === 'delete') && !filePath) {
          return acc;
        }

        if (type === 'read_file') {
          acc.push({ id, type: 'read_file' as const, path: filePath });
          return acc;
        }

        if (type === 'list_dir') {
          acc.push({ id, type: 'list_dir' as const, path: filePath || undefined });
          return acc;
        }

        if (type === 'exists') {
          acc.push({ id, type: 'exists' as const, path: filePath });
          return acc;
        }

        if (type === 'rename') {
          const newPath =
            typeof record.newPath === 'string'
              ? record.newPath.trim()
              : typeof record.new_path === 'string'
                ? record.new_path.trim()
                : typeof record.toPath === 'string'
                  ? record.toPath.trim()
                  : typeof record.to === 'string'
                    ? record.to.trim()
                    : '';
            if ((filePath && hasUnsafePathChars(filePath)) || (newPath && hasUnsafePathChars(newPath))) {
              return acc;
            }
          if (!filePath || !newPath) {
            return acc;
          }
          acc.push({ id, type: 'rename' as const, path: filePath, newPath });
          return acc;
        }

        if (type === 'delete') {
          acc.push({ id, type: 'delete' as const, path: filePath });
          return acc;
        }

        const content = typeof record.content === 'string' ? record.content : '';
        const overwrite = typeof record.overwrite === 'boolean' ? record.overwrite : undefined;

        if (type === 'append_file') {
          acc.push({ id, type: 'append_file' as const, path: filePath, content });
          return acc;
        }

        acc.push({ id, type: 'create_file' as const, path: filePath, content, overwrite });
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

export function stripRelayActionPayloadFromText(rawText: string): string {
  if (!rawText.trim()) {
    return '';
  }

  let sanitized = rawText;

  sanitized = sanitized.replace(/```json\s*[\s\S]*?"relay_actions"[\s\S]*?```/gi, '');
  sanitized = sanitized.replace(/```[\s\S]*?"relay_actions"[\s\S]*?```/gi, '');
  sanitized = sanitized.replace(/\{[\s\S]*?"relay_actions"[\s\S]*?\}/gi, '');

  return sanitized.replace(/\n{3,}/g, '\n\n').trim();
}

/* ── Activity item parsing ───────────────────────────────────────────────── */

export function parseRelayActivityItems(rawInput: unknown): ChatActivityItem[] {
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

export function deriveActivityItemsFromAssistantText(text: string, runId: string): ChatActivityItem[] {
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

export function normalizeCoworkMessage(message: ChatMessage): ChatMessage {
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
