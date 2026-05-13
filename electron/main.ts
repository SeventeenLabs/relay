import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { HermesAcpManager } from './hermes-acp-manager.js';

const execAsync = promisify(exec);
import type {
  AppConfig,
  HealthCheckResult,
  LocalFileApplyResult,
  LocalFileAppendResult,
  LocalFileCreateResult,
  LocalFileDeleteResult,
  LocalFileExistsResult,
  LocalFileListResult,
  LocalFilePlanAction,
  LocalFilePlanResult,
  LocalFileReadResult,
  LocalFileRenameResult,
  LocalFileReplaceResult,
  LocalFileStatResult,
} from '../src/app-types.js';
import {
  DEFAULT_HERMES_GATEWAY_URL,
  DEFAULT_HERMES_TRANSPORT,
  HERMES_DEFAULT_DASHBOARD_PORT,
  HERMES_DEFAULT_GATEWAY_PORT,
} from '../src/lib/hermes-constants.js';

const defaultConfig: AppConfig = {
  backendType: 'hermes',
  transport: DEFAULT_HERMES_TRANSPORT,
  gatewayUrl: DEFAULT_HERMES_GATEWAY_URL,
  gatewayToken: '',
};

const extensionCategories: Record<string, string> = {
  '.pdf': 'Documents',
  '.doc': 'Documents',
  '.docx': 'Documents',
  '.txt': 'Documents',
  '.rtf': 'Documents',
  '.md': 'Documents',
  '.xls': 'Spreadsheets',
  '.xlsx': 'Spreadsheets',
  '.csv': 'Spreadsheets',
  '.ppt': 'Presentations',
  '.pptx': 'Presentations',
  '.key': 'Presentations',
  '.png': 'Images',
  '.jpg': 'Images',
  '.jpeg': 'Images',
  '.gif': 'Images',
  '.webp': 'Images',
  '.svg': 'Images',
  '.bmp': 'Images',
  '.zip': 'Archives',
  '.rar': 'Archives',
  '.7z': 'Archives',
  '.tar': 'Archives',
  '.gz': 'Archives',
  '.mp3': 'Audio',
  '.wav': 'Audio',
  '.m4a': 'Audio',
  '.aac': 'Audio',
  '.flac': 'Audio',
  '.mp4': 'Video',
  '.mov': 'Video',
  '.mkv': 'Video',
  '.avi': 'Video',
  '.wmv': 'Video',
  '.js': 'Code',
  '.ts': 'Code',
  '.tsx': 'Code',
  '.jsx': 'Code',
  '.json': 'Code',
  '.py': 'Code',
  '.java': 'Code',
  '.cs': 'Code',
  '.cpp': 'Code',
  '.c': 'Code',
};

const configPath = () => path.join(app.getPath('userData'), 'relay-config.json');

const isDev = !app.isPackaged;
const WINDOWS_APP_ID = 'com.relay.app';
const WINDOW_ICON_CANDIDATES = [
  path.join(app.getAppPath(), 'assets', 'icons', 'icon.ico'),
  path.join(app.getAppPath(), 'assets', 'icons', 'icon.png'),
];
const windowIconPath = WINDOW_ICON_CANDIDATES.find((candidate) => existsSync(candidate));
const MAX_READ_FILE_BYTES = 256 * 1024;
const MAX_LIST_DIR_ITEMS = 200;
const BLOCKED_BASENAMES = new Set(['desktop.ini', 'thumbs.db']);
const HERMES_MAIN_LOG_PREFIX = '[Relay:HermesMain]';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hermesAcpManager = new HermesAcpManager();
hermesAcpManager.onLiveActivity((event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('acp:live-activity', event);
    }
  }
});

function logHermesMain(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  if (level === 'error') {
    console.error(HERMES_MAIN_LOG_PREFIX, message, meta ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(HERMES_MAIN_LOG_PREFIX, message, meta ?? '');
    return;
  }
  console.info(HERMES_MAIN_LOG_PREFIX, message, meta ?? '');
}

const isLoopbackHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1';

function registerDevContentSecurityPolicy() {
  if (!isDev) {
    return;
  }

  const filter = {
    urls: ['http://localhost:5173/*'],
  };

  const csp = [
    "default-src 'self' http://localhost:5173",
    "script-src 'self' 'unsafe-inline' http://localhost:5173",
    "style-src 'self' 'unsafe-inline' http://localhost:5173",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http: https: ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const responseHeaders = details.responseHeaders ?? {};
    responseHeaders['Content-Security-Policy'] = [csp];
    callback({ responseHeaders });
  });
}

function registerProdContentSecurityPolicy() {
  if (isDev) {
    return;
  }

  const filter = { urls: ['file://*/*'] };

  const csp = [
    "default-src 'self' file:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http: https: ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const responseHeaders = details.responseHeaders ?? {};
    responseHeaders['Content-Security-Policy'] = [csp];
    callback({ responseHeaders });
  });
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isHiddenOrBlockedPath(targetPath: string): boolean {
  const parts = targetPath.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.some((part) => part.startsWith('.') || BLOCKED_BASENAMES.has(part.toLowerCase()));
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').trim();
  if (!normalized || normalized === '.' || normalized === './') {
    return '';
  }
  return normalized;
}

function slugifyName(value: string): string {
  const collapsed = value.trim().replace(/[\s_]+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').replace(/-+/g, '-');
  return collapsed.replace(/^-|-$/g, '').toLowerCase() || 'file';
}

function formatDatePrefix(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveCategory(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return extensionCategories[extension] ?? 'Other';
}

async function ensurePathAllowed(rootPath: string): Promise<string> {
  const resolved = path.resolve(rootPath);
  const stats = await fs.stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error('Root path must be a directory.');
  }

  return resolved;
}

async function assertRealPathInsideRoot(rootRealPath: string, candidatePath: string, message: string): Promise<void> {
  const candidateRealPath = await fs.realpath(candidatePath);
  if (!isPathInside(rootRealPath, candidateRealPath)) {
    throw new Error(message);
  }
}

async function resolveNearestExistingAncestorPath(startPath: string): Promise<string> {
  let current = path.resolve(startPath);

  while (true) {
    try {
      await fs.access(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}

async function assertTargetPathAllowed(rootPath: string, targetPath: string, message: string): Promise<void> {
  const rootRealPath = await fs.realpath(rootPath);
  const parentDir = path.dirname(targetPath);
  const nearestExistingParent = await resolveNearestExistingAncestorPath(parentDir);
  await assertRealPathInsideRoot(rootRealPath, nearestExistingParent, message);

  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error('Symbolic links are blocked for local file actions.');
    }
    await assertRealPathInsideRoot(rootRealPath, targetPath, message);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function planFolderOrganization(rootPath: string): Promise<LocalFilePlanResult> {
  const root = await ensurePathAllowed(rootPath);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const actions: LocalFilePlanAction[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const currentPath = path.join(root, entry.name);
    const stat = await fs.stat(currentPath);
    const extension = path.extname(entry.name);
    const baseName = path.basename(entry.name, extension);
    const datePrefix = formatDatePrefix(stat.mtimeMs);
    const slug = slugifyName(baseName);
    const normalizedFileName = `${datePrefix}_${slug}${extension.toLowerCase()}`;
    const category = resolveCategory(entry.name);
    const targetPath = path.join(root, category, normalizedFileName);

    if (path.resolve(currentPath) === path.resolve(targetPath)) {
      continue;
    }

    actions.push({
      id: `${entry.name}-${actions.length + 1}`,
      fromPath: currentPath,
      toPath: targetPath,
      category,
      operation: 'move',
    });
  }

  return {
    rootPath: root,
    actions,
  };
}

async function uniqueDestinationPath(destinationPath: string): Promise<string> {
  let candidate = destinationPath;
  let counter = 1;

  while (true) {
    try {
      await fs.access(candidate);
      const parsed = path.parse(destinationPath);
      counter += 1;
      candidate = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
    } catch {
      return candidate;
    }
  }
}

async function applyFolderOrganizationPlan(rootPath: string, actions: LocalFilePlanAction[]): Promise<LocalFileApplyResult> {
  const root = await ensurePathAllowed(rootPath);
  const result: LocalFileApplyResult = {
    applied: 0,
    skipped: 0,
    errors: [],
  };

  for (const action of actions) {
    const fromPath = path.resolve(action.fromPath);
    const toPath = path.resolve(action.toPath);

    if (!isPathInside(root, fromPath) || !isPathInside(root, toPath)) {
      result.skipped += 1;
      result.errors.push(`Skipped out-of-scope action: ${action.fromPath}`);
      continue;
    }

    try {
      await fs.access(fromPath);
    } catch {
      result.skipped += 1;
      continue;
    }

    try {
      await fs.mkdir(path.dirname(toPath), { recursive: true });
      const finalToPath = await uniqueDestinationPath(toPath);
      await fs.rename(fromPath, finalToPath);
      result.applied += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown file operation error.');
      result.skipped += 1;
    }
  }

  return result;
}

async function writeFileInFolder(
  rootPath: string,
  relativePath: string,
  content: string,
  options?: { overwrite?: boolean },
): Promise<LocalFileCreateResult> {
  const root = await ensurePathAllowed(rootPath);

  const normalizedRelative = normalizeRelativePath(relativePath);
  if (!normalizedRelative) {
    throw new Error('A file path is required.');
  }

  if (path.isAbsolute(normalizedRelative)) {
    throw new Error('Use a path relative to the working folder.');
  }

  if (isHiddenOrBlockedPath(normalizedRelative)) {
    throw new Error('Target path is blocked by local safety rules.');
  }

  const resolvedTargetPath = path.resolve(root, normalizedRelative);
  if (!isPathInside(root, resolvedTargetPath)) {
    throw new Error('Target file must remain inside the working folder.');
  }

  await assertTargetPathAllowed(root, resolvedTargetPath, 'Target file must remain inside the working folder.');

  await fs.mkdir(path.dirname(resolvedTargetPath), { recursive: true });

  const overwrite = Boolean(options?.overwrite);
  if (!overwrite) {
    try {
      await fs.writeFile(resolvedTargetPath, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'EEXIST') {
        throw new Error('A file already exists at that path.');
      }
      throw error;
    }
  } else {
    await fs.writeFile(resolvedTargetPath, content, 'utf8');
  }

  return {
    filePath: resolvedTargetPath,
    created: true,
  };
}

async function readFileInFolder(rootPath: string, relativePath: string): Promise<LocalFileReadResult> {
  const root = await ensurePathAllowed(rootPath);

  const normalizedRelative = normalizeRelativePath(relativePath);
  if (!normalizedRelative) {
    throw new Error('A file path is required.');
  }

  if (path.isAbsolute(normalizedRelative)) {
    throw new Error('Use a path relative to the working folder.');
  }

  const resolvedTargetPath = path.resolve(root, normalizedRelative);
  if (!isPathInside(root, resolvedTargetPath)) {
    throw new Error('Target file must remain inside the working folder.');
  }

  await assertTargetPathAllowed(root, resolvedTargetPath, 'Target file must remain inside the working folder.');

  if (isHiddenOrBlockedPath(normalizedRelative)) {
    throw new Error('Target path is blocked by local safety rules.');
  }

  let stats;
  try {
    stats = await fs.stat(resolvedTargetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      throw new Error(`File not found: ${resolvedTargetPath}`);
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error('Target path is not a file.');
  }

  if (stats.size > MAX_READ_FILE_BYTES) {
    throw new Error(`File exceeds ${MAX_READ_FILE_BYTES} byte safety limit.`);
  }

  const content = await fs.readFile(resolvedTargetPath, 'utf8');
  return {
    filePath: resolvedTargetPath,
    content,
  };
}

async function appendFileInFolder(rootPath: string, relativePath: string, content: string): Promise<LocalFileAppendResult> {
  const root = await ensurePathAllowed(rootPath);

  const normalizedRelative = normalizeRelativePath(relativePath);
  if (!normalizedRelative) {
    throw new Error('A file path is required.');
  }

  if (path.isAbsolute(normalizedRelative)) {
    throw new Error('Use a path relative to the working folder.');
  }

  if (isHiddenOrBlockedPath(normalizedRelative)) {
    throw new Error('Target path is blocked by local safety rules.');
  }

  const resolvedTargetPath = path.resolve(root, normalizedRelative);
  if (!isPathInside(root, resolvedTargetPath)) {
    throw new Error('Target file must remain inside the working folder.');
  }

  await assertTargetPathAllowed(root, resolvedTargetPath, 'Target file must remain inside the working folder.');

  await fs.mkdir(path.dirname(resolvedTargetPath), { recursive: true });
  await fs.appendFile(resolvedTargetPath, content, 'utf8');
  return {
    filePath: resolvedTargetPath,
    appended: true,
    bytesAppended: Buffer.byteLength(content, 'utf8'),
  };
}

async function replaceInFile(
  rootPath: string,
  relativePath: string,
  oldString: string,
  newString: string,
  options?: { replaceAll?: boolean },
): Promise<LocalFileReplaceResult> {
  const root = await ensurePathAllowed(rootPath);

  const normalizedRelative = normalizeRelativePath(relativePath);
  if (!normalizedRelative) {
    throw new Error('A file path is required.');
  }
  if (path.isAbsolute(normalizedRelative)) {
    throw new Error('Use a path relative to the working folder.');
  }
  if (isHiddenOrBlockedPath(normalizedRelative)) {
    throw new Error('Target path is blocked by local safety rules.');
  }

  const resolvedTargetPath = path.resolve(root, normalizedRelative);
  if (!isPathInside(root, resolvedTargetPath)) {
    throw new Error('Target file must remain inside the working folder.');
  }

  await assertTargetPathAllowed(root, resolvedTargetPath, 'Target file must remain inside the working folder.');

  if (!oldString) {
    throw new Error('oldString is required for replace_in_file.');
  }

  const fileContent = await fs.readFile(resolvedTargetPath, 'utf8');
  const replaceAll = Boolean(options?.replaceAll);
  const occurrences = fileContent.split(oldString).length - 1;

  if (occurrences === 0) {
    throw new Error('oldString was not found in file.');
  }

  if (!replaceAll && occurrences > 1) {
    throw new Error('oldString is not unique. Pass replaceAll=true to replace all occurrences.');
  }

  const nextContent = replaceAll
    ? fileContent.split(oldString).join(newString)
    : fileContent.replace(oldString, newString);

  await fs.writeFile(resolvedTargetPath, nextContent, 'utf8');

  return {
    filePath: resolvedTargetPath,
    replaced: true,
    replacedCount: replaceAll ? occurrences : 1,
  };
}

async function resolveExistingPathWithOptionalExtension(requestedPath: string): Promise<string | null> {
  try {
    await fs.access(requestedPath);
    return requestedPath;
  } catch {
    // continue with extension-based lookup
  }

  if (path.extname(requestedPath)) {
    return null;
  }

  const parentDir = path.dirname(requestedPath);
  const requestedBase = path.basename(requestedPath);

  let entries;
  try {
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && path.parse(entry.name).name === requestedBase)
    .map((entry) => path.join(parentDir, entry.name));

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous path "${requestedPath}". Multiple files match this base name: ${candidates
        .map((candidate) => path.basename(candidate))
        .join(', ')}`,
    );
  }

  return null;
}

async function listDirInFolder(rootPath: string, relativePath?: string): Promise<LocalFileListResult> {
  const root = await ensurePathAllowed(rootPath);
  const rootRealPath = await fs.realpath(root);
  const normalizedRelative = normalizeRelativePath(relativePath ?? '');
  if (normalizedRelative && path.isAbsolute(normalizedRelative)) {
    throw new Error('Use a path relative to the working folder.');
  }

  if (normalizedRelative && isHiddenOrBlockedPath(normalizedRelative)) {
    return {
      rootPath: root,
      items: [],
      truncated: false,
    };
  }

  const targetPath = normalizedRelative ? path.resolve(root, normalizedRelative) : root;
  if (!isPathInside(root, targetPath)) {
    throw new Error('Target directory must remain inside the working folder.');
  }

  await assertRealPathInsideRoot(rootRealPath, targetPath, 'Target directory must remain inside the working folder.');

  const stat = await fs.stat(targetPath);
  if (!stat.isDirectory()) {
    throw new Error('Target path is not a directory.');
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const items: LocalFileListResult['items'] = [];

  for (const entry of entries) {
    const entryRelative = normalizeRelativePath(path.relative(root, path.join(targetPath, entry.name)));
    if (isHiddenOrBlockedPath(entryRelative)) {
      continue;
    }

    if (items.length >= MAX_LIST_DIR_ITEMS) {
      break;
    }

    const absolute = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      items.push({
        path: entryRelative,
        kind: 'directory',
      });
      continue;
    }

    if (entry.isFile()) {
      const fileStat = await fs.stat(absolute);
      items.push({
        path: entryRelative,
        kind: 'file',
        size: fileStat.size,
        modifiedMs: fileStat.mtimeMs,
      });
    }
  }

  return {
    rootPath: root,
    items,
    truncated: entries.length > items.length,
  };
}

async function existsInFolder(rootPath: string, relativePath: string): Promise<LocalFileExistsResult> {
  const root = await ensurePathAllowed(rootPath);
  const rootRealPath = await fs.realpath(root);
  const normalizedRelative = normalizeRelativePath(relativePath);
  if (!normalizedRelative) {
    throw new Error('A file path is required.');
  }

  if (path.isAbsolute(normalizedRelative)) {
    throw new Error('Use a path relative to the working folder.');
  }

  if (isHiddenOrBlockedPath(normalizedRelative)) {
    throw new Error('Target path is blocked by local safety rules.');
  }

  const resolvedTargetPath = path.resolve(root, normalizedRelative);
  if (!isPathInside(root, resolvedTargetPath)) {
    throw new Error('Target path must remain inside the working folder.');
  }

  await assertTargetPathAllowed(root, resolvedTargetPath, 'Target path must remain inside the working folder.');

  try {
    const stat = await fs.stat(resolvedTargetPath);
    await assertRealPathInsideRoot(rootRealPath, resolvedTargetPath, 'Target path must remain inside the working folder.');
    return {
      path: resolvedTargetPath,
      exists: true,
      kind: stat.isDirectory() ? 'directory' : 'file',
    };
  } catch {
    return {
      path: resolvedTargetPath,
      exists: false,
      kind: 'none',
    };
  }
}

async function renameInFolder(rootPath: string, oldRelative: string, newRelative: string): Promise<LocalFileRenameResult> {
  const root = await ensurePathAllowed(rootPath);
  const rootRealPath = await fs.realpath(root);
  const normalizedOld = normalizeRelativePath(oldRelative);
  const normalizedNew = normalizeRelativePath(newRelative);
  if (!normalizedOld || !normalizedNew) throw new Error('Both old and new paths are required.');
  if (path.isAbsolute(normalizedOld) || path.isAbsolute(normalizedNew)) throw new Error('Use relative paths.');
  if (isHiddenOrBlockedPath(normalizedOld) || isHiddenOrBlockedPath(normalizedNew)) throw new Error('Path blocked by safety rules.');
  const resolvedOld = path.resolve(root, normalizedOld);
  const resolvedNew = path.resolve(root, normalizedNew);
  if (!isPathInside(root, resolvedOld) || !isPathInside(root, resolvedNew)) throw new Error('Paths must remain inside working folder.');
  await assertTargetPathAllowed(root, resolvedOld, 'Paths must remain inside working folder.');
  await assertRealPathInsideRoot(rootRealPath, path.dirname(resolvedNew), 'Paths must remain inside working folder.');
  await fs.access(resolvedOld);

  // Prevent silent destination clobber; overwrite must be an explicit delete/create sequence.
  if (path.resolve(resolvedOld) !== path.resolve(resolvedNew)) {
    try {
      await fs.access(resolvedNew);
      throw new Error('A file or directory already exists at the destination path.');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  await fs.mkdir(path.dirname(resolvedNew), { recursive: true });
  await fs.rename(resolvedOld, resolvedNew);
  return { oldPath: resolvedOld, newPath: resolvedNew, renamed: true };
}

async function deleteInFolder(rootPath: string, relativePath: string): Promise<LocalFileDeleteResult> {
  const root = await ensurePathAllowed(rootPath);
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new Error('A path is required.');
  if (path.isAbsolute(normalized)) throw new Error('Use a relative path.');
  if (isHiddenOrBlockedPath(normalized)) throw new Error('Path blocked by safety rules.');
  const resolved = path.resolve(root, normalized);
  if (!isPathInside(root, resolved)) throw new Error('Path must remain inside working folder.');
  await assertTargetPathAllowed(root, resolved, 'Path must remain inside working folder.');
  if (resolved === root) throw new Error('Cannot delete the root folder.');
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    await fs.rm(resolved, { recursive: true });
  } else {
    await fs.unlink(resolved);
  }
  return { path: resolved, deleted: true };
}

async function statInFolder(rootPath: string, relativePath: string): Promise<LocalFileStatResult> {
  const root = await ensurePathAllowed(rootPath);
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new Error('A path is required.');
  if (path.isAbsolute(normalized)) throw new Error('Use a relative path.');
  if (isHiddenOrBlockedPath(normalized)) throw new Error('Path blocked by safety rules.');
  const resolved = path.resolve(root, normalized);
  if (!isPathInside(root, resolved)) throw new Error('Path must remain inside working folder.');
  await assertTargetPathAllowed(root, resolved, 'Path must remain inside working folder.');
  const stat = await fs.stat(resolved);
  return {
    path: resolved,
    kind: stat.isDirectory() ? 'directory' : 'file',
    size: stat.size,
    createdMs: stat.birthtimeMs,
    modifiedMs: stat.mtimeMs,
  };
}

async function openLocalPath(targetPath: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!normalized) {
    throw new Error('A path is required.');
  }

  const resolved = path.resolve(normalized);
  await fs.access(resolved);

  const openError = await shell.openPath(resolved);
  if (openError) {
    return { ok: false, error: openError };
  }

  return { ok: true };
}

async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppConfig> & { baseUrl?: string; mode?: string };
    const inferredGatewayUrl =
      parsed.gatewayUrl ??
      (parsed.baseUrl ? parsed.baseUrl : defaultConfig.gatewayUrl);

    const backendType: AppConfig['backendType'] = 'hermes';
    const normalizedStoredGatewayUrl = inferredGatewayUrl.trim();
    const fallbackGatewayUrl = DEFAULT_HERMES_GATEWAY_URL;
    const gatewayUrl = normalizedStoredGatewayUrl || fallbackGatewayUrl;
    return {
      backendType,
      gatewayUrl,
      gatewayToken: parsed.gatewayToken ?? defaultConfig.gatewayToken,
    };
  } catch {
    return defaultConfig;
  }
}

async function writeConfig(config: AppConfig): Promise<AppConfig> {
  const normalizedBackendType: AppConfig['backendType'] = 'hermes';
  const normalizedGatewayUrlInput = config.gatewayUrl.trim();
  const fallbackGatewayUrl = DEFAULT_HERMES_GATEWAY_URL;
  const normalizedGatewayUrl = normalizedGatewayUrlInput || fallbackGatewayUrl;

  const normalized: AppConfig = {
    backendType: normalizedBackendType,
    gatewayUrl: normalizedGatewayUrl,
    gatewayToken: config.gatewayToken.trim(),
  };

  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function runHealthCheck(gatewayUrl: string): Promise<HealthCheckResult> {
  const normalizedBaseUrl = gatewayUrl
    .trim()
    .replace(/^wss?:\/\//, (value) => (value === 'wss://' ? 'https://' : 'http://'))
    .replace(/\/$/, '');
  const candidates = ['/health', '/api/health', '/'];

  for (const candidate of candidates) {
    try {
      const response = await fetch(`${normalizedBaseUrl}${candidate}`);
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          message: `Hermes backend reachable at ${candidate}`,
        };
      }

      return {
        ok: false,
        status: response.status,
        message: `Backend responded with status ${response.status} at ${candidate}`,
      };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    message: 'Unable to reach the Hermes backend. Check the URL, port, and network path.',
  };
}

async function createWindow() {
  const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url));

  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#f4f3ee',
    title: 'Relay',
    icon: windowIconPath,
    frame: false,
    roundedCorners: true,
    thickFrame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.removeMenu();

  if (isDev) {
    const devUrl = 'http://localhost:5173';
    let lastError: unknown;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await window.loadURL(devUrl);
        window.webContents.openDevTools({ mode: 'detach' });
        return;
      } catch (error) {
        lastError = error;
        await delay(350);
      }
    }

    throw lastError;
  }

  await window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  app.setAppUserModelId(WINDOWS_APP_ID);
  Menu.setApplicationMenu(null);
  registerDevContentSecurityPolicy();
  registerProdContentSecurityPolicy();

  ipcMain.handle('config:get', async () => readConfig());
  ipcMain.handle('config:save', async (_event, config: AppConfig) => writeConfig(config));
  ipcMain.handle('backend:health-check', async (_event, baseUrl: string) => runHealthCheck(baseUrl));
  ipcMain.handle(
    'backend:http-request',
    async (
      _event,
      payload: {
        baseUrl: string;
        path: string;
        method?: string;
        token?: string;
        body?: string;
      },
    ) => {
      const method = (payload?.method ?? 'GET').toUpperCase();
      const baseUrl = typeof payload?.baseUrl === 'string' ? payload.baseUrl.trim() : '';
      const path = typeof payload?.path === 'string' ? payload.path : '';
      if (!baseUrl) {
        throw new Error('Base URL is required.');
      }
      if (!path.startsWith('/')) {
        throw new Error('Path must start with "/".');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (typeof payload?.token === 'string' && payload.token.trim()) {
        headers.Authorization = `Bearer ${payload.token.trim()}`;
      }

      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: typeof payload?.body === 'string' ? payload.body : undefined,
      });

      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: text,
      };
    },
  );
  ipcMain.handle('acp:ensure-agent', async () => {
    return hermesAcpManager.ensureAgent();
  });
  ipcMain.handle('acp:new-session', async (_event, payload: { cwd: string }) => {
    return hermesAcpManager.newSession(payload);
  });
  ipcMain.handle('acp:prompt', async (_event, payload: { sessionId: string; text: string }) => {
    return hermesAcpManager.prompt(payload);
  });
  ipcMain.handle('acp:cancel', async (_event, payload: { sessionId: string }) => {
    return hermesAcpManager.cancel(payload);
  });
  ipcMain.handle('acp:close-session', async (_event, payload: { sessionId: string }) => {
    return hermesAcpManager.closeSession(payload);
  });
  ipcMain.handle('acp:list-sessions', async (_event, payload?: { limit?: number }) => {
    return hermesAcpManager.listSessions(typeof payload?.limit === 'number' ? payload.limit : 200);
  });
  ipcMain.handle('acp:get-history', async (_event, payload: { sessionId: string; limit?: number }) => {
    return hermesAcpManager.getHistory(payload.sessionId, typeof payload?.limit === 'number' ? payload.limit : 50);
  });
  ipcMain.handle('acp:set-session-model', async (_event, payload: { sessionId: string; modelValue: string | null }) => {
    return hermesAcpManager.setSessionModel(payload);
  });
  ipcMain.handle('acp:get-session-model', async (_event, payload: { sessionId: string }) => {
    return { model: hermesAcpManager.getSessionModel(payload.sessionId) };
  });
  ipcMain.handle('acp:list-models', async () => {
    return hermesAcpManager.listModels();
  });
  ipcMain.handle(
    'hermes:model-options',
    async (
      _event,
      payload?: {
        gatewayUrl?: string;
      },
    ) => {
      logHermesMain('info', 'IPC hermes:model-options called', { hasGatewayUrl: Boolean(payload?.gatewayUrl) });
      const rawGatewayUrl = typeof payload?.gatewayUrl === 'string' ? payload.gatewayUrl.trim() : '';
      const parsedGatewayUrl = rawGatewayUrl || defaultConfig.gatewayUrl;
      const normalized = /^https?:\/\//i.test(parsedGatewayUrl) ? parsedGatewayUrl : `http://${parsedGatewayUrl}`;
      const gateway = new URL(normalized);
      const dashboardBaseUrl = `${gateway.protocol}//${gateway.hostname}:${HERMES_DEFAULT_DASHBOARD_PORT}`;

      const normalizeModelOptionsResponse = (data: {
        providers?: Array<{ slug?: string; name?: string; is_current?: boolean; models?: string[] }>;
        model?: string;
        provider?: string;
      }) => ({
        providers: Array.isArray(data.providers)
          ? data.providers
              .map((provider) => ({
                slug: provider.slug?.trim() || 'unknown',
                name: provider.name?.trim() || provider.slug?.trim() || 'Unknown',
                is_current: Boolean(provider.is_current),
                models: Array.isArray(provider.models)
                  ? provider.models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0).map((model) => model.trim())
                  : [],
              }))
              .filter((provider) => provider.models.length > 0)
          : [],
        model: typeof data.model === 'string' ? data.model : undefined,
        provider: typeof data.provider === 'string' ? data.provider : undefined,
      });

      const fetchModelOptions = async () => {
        const dashboardHtml = await fetch(`${dashboardBaseUrl}/`).then(async (response) => {
          if (!response.ok) {
            throw new Error(`Hermes dashboard unavailable (${response.status}).`);
          }
          return response.text();
        });

        const tokenMatch = dashboardHtml.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
        const sessionToken = tokenMatch?.[1]?.trim();
        if (!sessionToken) {
          throw new Error('Hermes dashboard token missing.');
        }

        const response = await fetch(`${dashboardBaseUrl}/api/model/options`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Token': sessionToken,
          },
        });
        if (!response.ok) {
          throw new Error(`Hermes model options request failed (${response.status}).`);
        }

        const data = await response.json() as {
          providers?: Array<{ slug?: string; name?: string; is_current?: boolean; models?: string[] }>;
          model?: string;
          provider?: string;
        };
        return normalizeModelOptionsResponse(data);
      };

      try {
        const result = await fetchModelOptions();
        logHermesMain('info', 'Model options fetched', { providers: result.providers.length });
        return result;
      } catch {
        logHermesMain('warn', 'Model options fetch failed; attempting dashboard auto-start');
        spawn('wsl', ['bash', '-lc', `nohup hermes dashboard --no-open --host 127.0.0.1 --port ${HERMES_DEFAULT_DASHBOARD_PORT} >/tmp/hermes-dashboard.log 2>&1 &`], {
          detached: true,
          stdio: 'ignore',
        }).unref();

        for (let attempt = 0; attempt < 12; attempt += 1) {
          await delay(500);
          try {
            const result = await fetchModelOptions();
            logHermesMain('info', 'Model options fetched after retry', { attempt: attempt + 1, providers: result.providers.length });
            return result;
          } catch {
            // Retry until timeout.
          }
        }

        logHermesMain('error', 'Unable to read model options after retries');
        throw new Error('Unable to read Hermes model options. Make sure `hermes dashboard` can run locally.');
      }
    },
  );
  ipcMain.handle(
    'hermes:model-set-main',
    async (
      _event,
      payload: {
        gatewayUrl?: string;
        provider: string;
        model: string;
      },
    ) => {
      const provider = typeof payload?.provider === 'string' ? payload.provider.trim() : '';
      const model = typeof payload?.model === 'string' ? payload.model.trim() : '';
      if (!provider || !model) {
        throw new Error('Provider and model are required.');
      }
      logHermesMain('info', 'IPC hermes:model-set-main called', { provider, model, hasGatewayUrl: Boolean(payload?.gatewayUrl) });

      const rawGatewayUrl = typeof payload?.gatewayUrl === 'string' ? payload.gatewayUrl.trim() : '';
      const parsedGatewayUrl = rawGatewayUrl || defaultConfig.gatewayUrl;
      const normalized = /^https?:\/\//i.test(parsedGatewayUrl) ? parsedGatewayUrl : `http://${parsedGatewayUrl}`;
      const gateway = new URL(normalized);
      const dashboardBaseUrl = `${gateway.protocol}//${gateway.hostname}:${HERMES_DEFAULT_DASHBOARD_PORT}`;

      const ensureToken = async () => {
        const dashboardHtml = await fetch(`${dashboardBaseUrl}/`).then(async (response) => {
          if (!response.ok) {
            throw new Error(`Hermes dashboard unavailable (${response.status}).`);
          }
          return response.text();
        });
        const tokenMatch = dashboardHtml.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
        const sessionToken = tokenMatch?.[1]?.trim();
        if (!sessionToken) {
          throw new Error('Hermes dashboard token missing.');
        }
        return sessionToken;
      };

      const postSetMain = async () => {
        const sessionToken = await ensureToken();
        const response = await fetch(`${dashboardBaseUrl}/api/model/set`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Token': sessionToken,
          },
          body: JSON.stringify({
            scope: 'main',
            provider,
            model,
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Hermes model set failed (${response.status}): ${body || response.statusText}`);
        }
        const verify = await fetch(`${dashboardBaseUrl}/api/model/auxiliary`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Token': sessionToken,
          },
        });
        if (!verify.ok) {
          return { confirmedProvider: undefined, confirmedModel: undefined };
        }
        const verifyData = await verify.json() as { main?: { provider?: string; model?: string } };
        return {
          confirmedProvider: typeof verifyData.main?.provider === 'string' ? verifyData.main.provider : undefined,
          confirmedModel: typeof verifyData.main?.model === 'string' ? verifyData.main.model : undefined,
        };
      };

      try {
        const confirmed = await postSetMain();
        logHermesMain('info', 'Main model set succeeded', { provider, model, confirmedProvider: confirmed.confirmedProvider, confirmedModel: confirmed.confirmedModel });
        return { ok: true, provider, model, ...confirmed };
      } catch {
        logHermesMain('warn', 'Model set failed; attempting dashboard auto-start', { provider, model });
        spawn('wsl', ['bash', '-lc', `nohup hermes dashboard --no-open --host 127.0.0.1 --port ${HERMES_DEFAULT_DASHBOARD_PORT} >/tmp/hermes-dashboard.log 2>&1 &`], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await delay(500);
          try {
            const confirmed = await postSetMain();
            logHermesMain('info', 'Main model set succeeded after retry', { attempt: attempt + 1, provider, model, confirmedProvider: confirmed.confirmedProvider, confirmedModel: confirmed.confirmedModel });
            return { ok: true, provider, model, ...confirmed };
          } catch {
            // Retry until timeout.
          }
        }
        logHermesMain('error', 'Unable to set main model after retries', { provider, model });
        throw new Error('Unable to set Hermes main model. Make sure `hermes dashboard` can run locally.');
      }
    },
  );
  ipcMain.handle('hermes:service-status', async () => {
    const checkApi = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${HERMES_DEFAULT_GATEWAY_PORT}/v1/models`);
        return response.ok;
      } catch {
        return false;
      }
    };
    const checkDashboard = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${HERMES_DEFAULT_DASHBOARD_PORT}/`);
        return response.ok;
      } catch {
        return false;
      }
    };
    const [apiServer, dashboard] = await Promise.all([checkApi(), checkDashboard()]);
    logHermesMain('info', 'Service status checked', { apiServer, dashboard });
    return {
      gateway: apiServer,
      apiServer,
      dashboard,
    };
  });
  ipcMain.handle('hermes:start-all-services', async () => {
    logHermesMain('info', 'Starting Hermes services');
    const startCmd = `nohup hermes gateway > /tmp/hermes-gateway.log 2>&1 & nohup hermes dashboard --no-open --host 127.0.0.1 --port ${HERMES_DEFAULT_DASHBOARD_PORT} > /tmp/hermes-dashboard.log 2>&1 &`;
    spawn('wsl', ['bash', '-lc', startCmd], { detached: true, stdio: 'ignore' }).unref();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(500);
      try {
        const [apiResp, dashResp] = await Promise.all([
          fetch(`http://127.0.0.1:${HERMES_DEFAULT_GATEWAY_PORT}/v1/models`),
          fetch(`http://127.0.0.1:${HERMES_DEFAULT_DASHBOARD_PORT}/`),
        ]);
        if (apiResp.ok && dashResp.ok) {
          logHermesMain('info', 'Hermes services are up', { attempt: attempt + 1 });
          return { ok: true, gateway: true, apiServer: true, dashboard: true };
        }
      } catch {
        // keep polling
      }
    }
    const [apiServer, dashboard] = await Promise.all([
      (async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${HERMES_DEFAULT_GATEWAY_PORT}/v1/models`);
          return response.ok;
        } catch {
          return false;
        }
      })(),
      (async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${HERMES_DEFAULT_DASHBOARD_PORT}/`);
          return response.ok;
        } catch {
          return false;
        }
      })(),
    ]);
    logHermesMain('warn', 'Hermes services start finished with partial availability', { apiServer, dashboard });
    return {
      ok: apiServer || dashboard,
      gateway: apiServer,
      apiServer,
      dashboard,
      message: 'Started available Hermes services. Check local logs in /tmp/hermes-gateway.log and /tmp/hermes-dashboard.log.',
    };
  });
  ipcMain.handle('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });
  ipcMain.handle('window:is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return Boolean(window?.isMaximized());
  });
  ipcMain.handle('window:show-system-menu', (event, position: { x: number; y: number }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    const menu = Menu.buildFromTemplate([
      {
        label: 'Restore',
        enabled: window.isMaximized(),
        click: () => window.unmaximize(),
      },
      {
        label: 'Minimize',
        click: () => window.minimize(),
      },
      {
        label: window.isMaximized() ? 'Unmaximize' : 'Maximize',
        click: () => {
          if (window.isMaximized()) {
            window.unmaximize();
            return;
          }
          window.maximize();
        },
      },
      { type: 'separator' },
      {
        label: 'Close',
        click: () => window.close(),
      },
    ]);

    menu.popup({
      window,
      x: Math.round(position.x),
      y: Math.round(position.y),
    });
  });
  ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
  });
  ipcMain.handle('local:downloads-path', () => app.getPath('downloads'));
  ipcMain.handle('local:select-folder', async (_event, initialPath?: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Select working folder',
      defaultPath: typeof initialPath === 'string' && initialPath.trim() ? initialPath : app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
  ipcMain.handle('local:plan-organize-folder', async (_event, rootPath: string) => {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
      throw new Error('A folder path is required.');
    }

    return planFolderOrganization(rootPath);
  });
  ipcMain.handle('local:apply-organize-folder-plan', async (_event, payload: { rootPath: string; actions: LocalFilePlanAction[] }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid apply payload.');
    }

    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    if (!rootPath.trim()) {
      throw new Error('A folder path is required.');
    }

    return applyFolderOrganizationPlan(rootPath, actions);
  });
  ipcMain.handle('local:create-file-in-folder', async (_event, payload: { rootPath: string; relativePath: string; content: string; overwrite?: boolean }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid create-file payload.');
    }

    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
    const content = typeof payload.content === 'string' ? payload.content : '';
    const overwrite = typeof payload.overwrite === 'boolean' ? payload.overwrite : false;

    if (!rootPath.trim()) {
      throw new Error('A folder path is required.');
    }

    return writeFileInFolder(rootPath, relativePath, content, { overwrite });
  });
  ipcMain.handle('local:append-file-in-folder', async (_event, payload: { rootPath: string; relativePath: string; content: string }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid append-file payload.');
    }

    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
    const content = typeof payload.content === 'string' ? payload.content : '';

    if (!rootPath.trim()) {
      throw new Error('A folder path is required.');
    }

    return appendFileInFolder(rootPath, relativePath, content);
  });
  ipcMain.handle(
    'local:replace-in-file',
    async (
      _event,
      payload: { rootPath: string; relativePath: string; oldString: string; newString: string; replaceAll?: boolean },
    ) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid replace-in-file payload.');
      }

      const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
      const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
      const oldString = typeof payload.oldString === 'string' ? payload.oldString : '';
      const newString = typeof payload.newString === 'string' ? payload.newString : '';
      const replaceAll = typeof payload.replaceAll === 'boolean' ? payload.replaceAll : false;

      if (!rootPath.trim()) {
        throw new Error('A folder path is required.');
      }

      return replaceInFile(rootPath, relativePath, oldString, newString, { replaceAll });
    },
  );
  ipcMain.handle('local:read-file-in-folder', async (_event, payload: { rootPath: string; relativePath: string }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid read-file payload.');
    }

    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';

    if (!rootPath.trim()) {
      throw new Error('A folder path is required.');
    }

    return readFileInFolder(rootPath, relativePath);
  });
  ipcMain.handle('local:list-dir-in-folder', async (_event, payload: { rootPath: string; relativePath?: string }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid list-dir payload.');
    }

    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
    if (!rootPath.trim()) {
      throw new Error('A folder path is required.');
    }

    return listDirInFolder(rootPath, relativePath);
  });
  ipcMain.handle('local:exists-in-folder', async (_event, payload: { rootPath: string; relativePath: string }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid exists payload.');
    }

    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
    if (!rootPath.trim()) {
      throw new Error('A folder path is required.');
    }

    return existsInFolder(rootPath, relativePath);
  });
  ipcMain.handle('local:rename-in-folder', async (_event, payload: { rootPath: string; oldRelative: string; newRelative: string }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid rename payload.');
    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const oldRelative = typeof payload.oldRelative === 'string' ? payload.oldRelative : '';
    const newRelative = typeof payload.newRelative === 'string' ? payload.newRelative : '';
    if (!rootPath.trim()) throw new Error('A folder path is required.');
    return renameInFolder(rootPath, oldRelative, newRelative);
  });
  ipcMain.handle('local:delete-in-folder', async (_event, payload: { rootPath: string; relativePath: string }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid delete payload.');
    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
    if (!rootPath.trim()) throw new Error('A folder path is required.');
    return deleteInFolder(rootPath, relativePath);
  });
  ipcMain.handle('local:stat-in-folder', async (_event, payload: { rootPath: string; relativePath: string }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid stat payload.');
    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath : '';
    const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
    if (!rootPath.trim()) throw new Error('A folder path is required.');
    return statInFolder(rootPath, relativePath);
  });
  ipcMain.handle('local:open-path', async (_event, payload: { targetPath: string }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid open-path payload.');
    }

    const targetPath = typeof payload.targetPath === 'string' ? payload.targetPath : '';
    return openLocalPath(targetPath);
  });

  /* ── Shell exec IPC ─────────────────────────────────────────────────────── */
  ipcMain.handle('local:shell-exec', async (_event, payload: { rootPath: string; command: string; timeoutMs?: number }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid shell-exec payload.');
    const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath.trim() : '';
    const command = typeof payload.command === 'string' ? payload.command.trim() : '';
    const timeoutMs = typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0 ? payload.timeoutMs : 30_000;

    if (!rootPath) throw new Error('A folder path is required.');
    if (!command) throw new Error('A command is required.');

    // Validate rootPath exists
    const rootStat = await fs.stat(rootPath).catch(() => null);
    if (!rootStat?.isDirectory()) throw new Error('Root path is not a valid directory.');

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: rootPath,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1 MB
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });

      return { stdout: stdout || '', stderr: stderr || '', exitCode: 0, timedOut: false };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; signal?: string };
      const timedOut = execErr.killed === true || execErr.signal === 'SIGTERM';
      return {
        stdout: typeof execErr.stdout === 'string' ? execErr.stdout : '',
        stderr: typeof execErr.stderr === 'string' ? execErr.stderr : '',
        exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
        timedOut,
      };
    }
  });

  /* ── Web fetch IPC ──────────────────────────────────────────────────────── */
  ipcMain.handle('local:web-fetch', async (_event, payload: { url: string; options?: { method?: string; headers?: Record<string, string>; body?: string } }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid web-fetch payload.');
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) throw new Error('URL is required.');

    const opts = payload.options ?? {};
    const method = typeof opts.method === 'string' ? opts.method.toUpperCase() : 'GET';

    const fetchOptions: RequestInit = {
      method,
      headers: opts.headers ?? {},
      signal: AbortSignal.timeout(30_000),
    };

    if (method !== 'GET' && method !== 'HEAD' && typeof opts.body === 'string') {
      fetchOptions.body = opts.body;
    }

    const response = await fetch(url, fetchOptions);
    const bodyText = await response.text();
    const maxLen = 100_000;
    const truncated = bodyText.length > maxLen;
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => { headersObj[key] = value; });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: headersObj,
      body: truncated ? bodyText.slice(0, maxLen) : bodyText,
      truncated,
    };
  });

  /* ── Notification IPC ───────────────────────────────────────────────────── */
  ipcMain.handle('notify', async (_event, payload: { title: string; body?: string }) => {
    if (!payload || typeof payload !== 'object') return { ok: false };
    const title = typeof payload.title === 'string' ? payload.title : 'Relay';
    const body = typeof payload.body === 'string' ? payload.body : '';

    if (Notification.isSupported()) {
      const notification = new Notification({ title, body });
      notification.show();
      return { ok: true };
    }
    return { ok: false, message: 'Notifications not supported on this platform.' };
  });

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });

});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
