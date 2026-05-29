/**
 * Pure utility functions and shared types for chat, cowork, and thread management.
 * No React imports — safe to use anywhere.
 */
import type { ChatActivityItem, ChatMessage } from '@/app-types';
import { HermesRequestError } from './hermes-http-client';

/* ── Exported types ──────────────────────────────────────────────────────── */

export type ChatThread = {
  id: string;
  sessionKey: string;
  title: string;
  updatedAt: number;
  projectId?: string;
  pinned?: boolean;
  archived?: boolean;
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
  updatedAt?: number;
  projectId?: string;
  pinned?: boolean;
  archived?: boolean;
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
      type: 'replace_in_file';
      path: string;
      oldString: string;
      newString: string;
      replaceAll?: boolean;
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
const SIDEBAR_RECENTS_LIMIT = 24;
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

function normalizeTitleSourceText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/working folder context:[^\n]*/gi, ' ')
    .replace(/project instructions:[^\n]*/gi, ' ')
    .replace(/connected tools:[^\n]*/gi, ' ')
    .replace(/[A-Za-z]:\\[^\s]+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function trimLeadInPhrases(text: string): string {
  return text
    .replace(/^\s*(can\s+you|could\s+you|would\s+you|please|i\s+need\s+you\s+to|i\s+need\s+help\s+with|help\s+me\s+)(:|-)?\s*/i, '')
    .replace(/^\s*(let'?s|lets)\s+/i, '')
    .trim();
}

function toSentenceCase(text: string): string {
  const normalized = text.trim().replace(/\s{2,}/g, ' ');
  if (!normalized) {
    return '';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function deriveThreadTitleFromMessages(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.text.trim())?.text ?? '';
  if (!firstUserMessage.trim()) {
    return '';
  }

  const normalizedUserText = trimLeadInPhrases(normalizeTitleSourceText(firstUserMessage));
  const strippedRelayScaffolding = normalizedUserText
    .replace(/\bworking folder context\b.*$/i, '')
    .replace(/\bproject instructions\b.*$/i, '')
    .trim();
  const effectiveTitleSource = strippedRelayScaffolding || normalizedUserText;
  const primarySegment = effectiveTitleSource
    .split(/[.!?\n:;]+/)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0 && !/^working folder context\b/i.test(segment)) ?? effectiveTitleSource;

  const cleanedSegment = primarySegment
    .replace(/^[-*#>\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const compactTitle = cleanedSegment.replace(/\s{2,}/g, ' ').trim();

  if (!compactTitle) {
    return '';
  }

  return toRecentSidebarLabel(toSentenceCase(compactTitle));
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
    if (!previous) {
      bySession.set(normalizedSessionKey, thread);
      continue;
    }

    if (thread.updatedAt >= previous.updatedAt) {
      bySession.set(normalizedSessionKey, {
        ...previous,
        ...thread,
        projectId: thread.projectId ?? previous.projectId,
        pinned: thread.pinned ?? previous.pinned,
        archived: thread.archived ?? previous.archived,
      });
    } else {
      bySession.set(normalizedSessionKey, {
        ...thread,
        ...previous,
        projectId: previous.projectId ?? thread.projectId,
        pinned: previous.pinned ?? thread.pinned,
        archived: previous.archived ?? thread.archived,
      });
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

  const sanitizeStoredTitle = (value: string): string => {
    const normalized = value
      .replace(/\bworking folder context\b:[^\n]*/gi, ' ')
      .replace(/\bproject instructions\b:[^\n]*/gi, ' ')
      .replace(/[A-Za-z]:\\[^\s]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return toRecentSidebarLabel(normalized);
  };
  const title = typeof record.title === 'string' ? sanitizeStoredTitle(record.title) : '';
  const updatedAtRaw = typeof record.updatedAt === 'number' ? record.updatedAt : Number(record.updatedAt);
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';

  return {
    id: getThreadIdForSession(sessionKey),
    sessionKey,
    title: title || toFallbackThreadTitle(sessionKey, sessionKey.toLowerCase().includes('cowork') ? 'cowork' : 'chat'),
    updatedAt,
    ...(projectId ? { projectId } : {}),
    ...(record.pinned === true ? { pinned: true } : {}),
    ...(record.archived === true ? { archived: true } : {}),
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
      updatedAt: thread.updatedAt,
      projectId: thread.projectId,
      pinned: thread.pinned,
      archived: thread.archived,
    }));
}

/* ── Gateway error helpers ───────────────────────────────────────────────── */

function extractUuidFromMessage(msg?: string): string | undefined {
  if (!msg) return undefined;
  const match = msg.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0];
}

export function readHermesError(error: unknown): { message: string; code?: string; requestId?: string } {
  if (!(error instanceof Error)) {
    return { message: 'Hermes connection failed.' };
  }

  if (error instanceof HermesRequestError) {
    console.log('[Relay] HermesRequestError details:', JSON.stringify(error.details));
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
    message: error.message || 'Hermes connection failed.',
    requestId: extractUuidFromMessage(error.message),
  };
}

/* ── Relay file action parsing ───────────────────────────────────────────── */

export function parseRelayFileActions(rawInput: unknown): RelayFileAction[] {
  const hasUnsafePathChars = (value: string): boolean =>
    Array.from(value).some((char) => char.charCodeAt(0) < 32);

  const toObjectRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const parseJsonObject = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'string' || !value.trim()) {
      return {};
    }

    try {
      return toObjectRecord(JSON.parse(value));
    } catch {
      return {};
    }
  };

  const firstString = (...values: unknown[]): string => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  };

  const normalizeActionType = (rawType: string): string => {
    const normalizedType = rawType.toLowerCase().replace(/-/g, '_');

    if (normalizedType === 'list_files' || normalizedType === 'list_directory' || normalizedType === 'ls') {
      return 'list_dir';
    }
    if (normalizedType === 'read_text_file' || normalizedType === 'view_file') {
      return 'read_file';
    }
    if (normalizedType === 'write_file' || normalizedType === 'create_text_file' || normalizedType === 'create_or_update_file') {
      return 'create_file';
    }
    if (normalizedType === 'edit_file' || normalizedType === 'replace_text') {
      return 'replace_in_file';
    }

    return normalizedType;
  };

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
      const inputRecord = toObjectRecord(record.input);
      const paramsRecord = toObjectRecord(record.params);
      const payloadRecord = toObjectRecord(record.payload);
      const rawArgumentsRecord = toObjectRecord(record.arguments);
      const argumentsRecord =
        Object.keys(rawArgumentsRecord).length > 0
          ? rawArgumentsRecord
          : parseJsonObject(record.arguments);
      const mergedRecord: Record<string, unknown> = {
        ...inputRecord,
        ...paramsRecord,
        ...payloadRecord,
        ...argumentsRecord,
        ...record,
      };

      const rawType = firstString(mergedRecord.type, mergedRecord.action, mergedRecord.name, record.type, record.action, record.name);
      const type = normalizeActionType(rawType);
      if (
        type !== 'create_file' &&
        type !== 'append_file' &&
        type !== 'replace_in_file' &&
        type !== 'read_file' &&
        type !== 'list_dir' &&
        type !== 'exists' &&
        type !== 'rename' &&
        type !== 'delete'
      ) {
        return acc;
      }

      const id = firstString(mergedRecord.id);

      const filePath = firstString(
        mergedRecord.path,
        mergedRecord.filePath,
        mergedRecord.file_path,
        mergedRecord.relativePath,
        mergedRecord.relative_path,
        mergedRecord.targetPath,
        mergedRecord.target_path,
      );
      if (filePath && hasUnsafePathChars(filePath)) {
        return acc;
      }
      if ((type === 'create_file' || type === 'append_file' || type === 'replace_in_file' || type === 'read_file' || type === 'exists' || type === 'delete') && !filePath) {
        return acc;
      }

      if (type === 'read_file') {
        acc.push({ id: id || undefined, type: 'read_file' as const, path: filePath });
        return acc;
      }

      if (type === 'list_dir') {
        acc.push({ id: id || undefined, type: 'list_dir' as const, path: filePath || undefined });
        return acc;
      }

      if (type === 'exists') {
        acc.push({ id: id || undefined, type: 'exists' as const, path: filePath });
        return acc;
      }

      if (type === 'rename') {
        const newPath = firstString(
          mergedRecord.newPath,
          mergedRecord.new_path,
          mergedRecord.toPath,
          mergedRecord.to_path,
          mergedRecord.to,
          mergedRecord.destinationPath,
          mergedRecord.destination_path,
        );
        if ((filePath && hasUnsafePathChars(filePath)) || (newPath && hasUnsafePathChars(newPath))) {
          return acc;
        }
        if (!filePath || !newPath) {
          return acc;
        }
        acc.push({ id: id || undefined, type: 'rename' as const, path: filePath, newPath });
        return acc;
      }

      if (type === 'delete') {
        acc.push({ id: id || undefined, type: 'delete' as const, path: filePath });
        return acc;
      }

      const content = firstString(mergedRecord.content, mergedRecord.text, mergedRecord.body, mergedRecord.newContent, mergedRecord.new_content);
      const overwrite = typeof mergedRecord.overwrite === 'boolean' ? mergedRecord.overwrite : undefined;

      if (type === 'append_file') {
        acc.push({ id: id || undefined, type: 'append_file' as const, path: filePath, content });
        return acc;
      }

      if (type === 'replace_in_file') {
        const oldString = firstString(
          mergedRecord.oldString,
          mergedRecord.old_string,
          mergedRecord.search,
          mergedRecord.find,
          mergedRecord.oldText,
          mergedRecord.old_text,
        );
        const newString = firstString(
          mergedRecord.newString,
          mergedRecord.new_string,
          mergedRecord.replace,
          mergedRecord.replacement,
          mergedRecord.newText,
          mergedRecord.new_text,
          mergedRecord.with,
        );
        const replaceAll = typeof mergedRecord.replaceAll === 'boolean'
          ? mergedRecord.replaceAll
          : typeof mergedRecord.replace_all === 'boolean'
            ? mergedRecord.replace_all
            : typeof mergedRecord.all === 'boolean'
              ? mergedRecord.all
              : typeof mergedRecord.global === 'boolean'
                ? mergedRecord.global
                : undefined;

        if (!filePath || !oldString) {
          return acc;
        }

        acc.push({ id: id || undefined, type: 'replace_in_file' as const, path: filePath, oldString, newString, replaceAll });
        return acc;
      }

      acc.push({ id: id || undefined, type: 'create_file' as const, path: filePath, content, overwrite });
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
      const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions ?? parsed);
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
        const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions ?? parsed);
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
        const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions ?? parsed);
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
        const direct = normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions ?? parsed);
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
  const trimmed = rawText.trim();
  if (!trimmed) {
    return '';
  }

  if (parseRelayFileActions(trimmed).length > 0) {
    return '';
  }

  let sanitized = rawText;

  sanitized = sanitized.replace(/```json\s*[\s\S]*?"relay_actions"[\s\S]*?```/gi, '');
  sanitized = sanitized.replace(/```[\s\S]*?"relay_actions"[\s\S]*?```/gi, '');
  sanitized = sanitized.replace(/\{[\s\S]*?"relay_actions"[\s\S]*?\}/gi, '');

  sanitized = sanitized.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (match, payload: string) => {
    const candidate = typeof payload === 'string' ? payload.trim() : '';
    if (!candidate) {
      return match;
    }
    return parseRelayFileActions(candidate).length > 0 ? '' : match;
  });

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

