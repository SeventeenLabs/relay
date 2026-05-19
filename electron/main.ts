import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
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
  HERMES_DEFAULT_DASHBOARD_PORT,
  HERMES_DEFAULT_GATEWAY_PORT,
} from '../src/lib/hermes-constants.js';
import { HermesAcpBridge } from './hermes-acp-bridge.js';

const defaultConfig: AppConfig = {
  backendType: 'hermes',
  transport: 'relay_daemon',
  gatewayUrl: 'http://127.0.0.1:8787',
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

function describeFetchFailure(error: unknown, targetUrl: string): string {
  const fallback = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string; errno?: number; syscall?: string; address?: string; port?: number; message?: string } })?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  if (code === 'ECONNREFUSED') {
    return `Connection refused to ${targetUrl}. SSH tunnel may be closed or remote Hermes is not listening.`;
  }
  if (code === 'ETIMEDOUT') {
    return `Connection timed out reaching ${targetUrl}. Check tunnel/network/firewall.`;
  }
  if (code === 'ENOTFOUND') {
    return `Host not found for ${targetUrl}. Check hostname/IP and DNS.`;
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return `Network unreachable for ${targetUrl}.`;
  }
  if (fallback.toLowerCase().includes('aborted') || fallback.toLowerCase().includes('timeout')) {
    return `Request timed out reaching ${targetUrl}.`;
  }
  if (cause?.message) {
    return `${fallback}. Cause: ${cause.message}`;
  }
  return fallback;
}

const isLoopbackHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1';

const normalizeGatewayHttpBase = (value: string) => {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const withoutTrailing = withProtocol.replace(/\/+$/, '');
  return withoutTrailing.endsWith('/v1') ? withoutTrailing : `${withoutTrailing}/v1`;
};

const resolveGatewayBaseForMain = async (baseUrl: string): Promise<string> => {
  return normalizeGatewayHttpBase(baseUrl.trim());
};

const normalizeStoredTransport = (
  transport: unknown,
  gatewayUrl: string,
): AppConfig['transport'] => {
  if (transport === 'hermes_http' || transport === 'hermes_acp_stdio' || transport === 'relay_daemon') {
    return transport;
  }

  // Backward compatibility: older configs may not have an explicit transport.
  const normalizedGateway = gatewayUrl.trim().toLowerCase();
  if (normalizedGateway.startsWith('ssh://') || normalizedGateway.startsWith('acp://')) {
    return 'hermes_acp_stdio';
  }
  return 'relay_daemon';
};

type GatewayMode = 'local' | 'remote';

const resolveGatewayMode = (gatewayUrl: string): GatewayMode => {
  const trimmed = gatewayUrl.trim();
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(normalized);
  return isLoopbackHost(parsed.hostname) ? 'local' : 'remote';
};

const spawnDetached = (command: string, args: string[]) =>
  new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (ok) child.unref();
      resolve(ok);
    };
    child.once('error', () => finish(false));
    child.once('spawn', () => finish(true));
  });

async function startHermesDashboardProcess(port: number): Promise<'wsl' | 'windows' | null> {
  const wslCmd = `nohup hermes dashboard --no-open --host 127.0.0.1 --port ${port} >/tmp/hermes-dashboard.log 2>&1 &`;
  if (await spawnDetached('wsl', ['bash', '-lc', wslCmd])) {
    return 'wsl';
  }
  const windowsCmd = `start "" /b hermes dashboard --no-open --host 127.0.0.1 --port ${port}`;
  if (await spawnDetached('cmd.exe', ['/d', '/s', '/c', windowsCmd])) {
    return 'windows';
  }
  return null;
}

async function startHermesGatewayAndDashboardProcesses(dashboardPort: number): Promise<'wsl' | 'windows' | null> {
  const wslCmd = `nohup hermes gateway > /tmp/hermes-gateway.log 2>&1 & nohup hermes dashboard --no-open --host 127.0.0.1 --port ${dashboardPort} > /tmp/hermes-dashboard.log 2>&1 &`;
  if (await spawnDetached('wsl', ['bash', '-lc', wslCmd])) {
    return 'wsl';
  }
  const windowsCmd = `start "" /b hermes gateway && start "" /b hermes dashboard --no-open --host 127.0.0.1 --port ${dashboardPort}`;
  if (await spawnDetached('cmd.exe', ['/d', '/s', '/c', windowsCmd])) {
    return 'windows';
  }
  return null;
}

const runWslPython = async (script: string): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync('wsl', ['python3', '-c', script]);
};

async function fetchHermesModelOptionsViaWsl(dashboardPort: number): Promise<{
  providers?: Array<{ slug?: string; name?: string; is_current?: boolean; models?: string[] }>;
  model?: string;
  provider?: string;
}> {
  const script = [
    'import json',
    'import re',
    'import sys',
    'import urllib.request',
    `port = ${dashboardPort}`,
    'base = f"http://127.0.0.1:{port}"',
    'html = urllib.request.urlopen(f"{base}/", timeout=5).read().decode("utf-8", errors="replace")',
    'm = re.search(r\'__HERMES_SESSION_TOKEN__="([^"]+)"\', html)',
    'if not m:',
    '    raise RuntimeError("Hermes dashboard token missing")',
    'token = m.group(1).strip()',
    'req = urllib.request.Request(f"{base}/api/model/options", headers={"Content-Type": "application/json", "X-Hermes-Session-Token": token})',
    'body = urllib.request.urlopen(req, timeout=5).read().decode("utf-8", errors="replace")',
    'sys.stdout.write(body)',
  ].join('\n');
  const { stdout } = await runWslPython(script);
  return JSON.parse(stdout) as {
    providers?: Array<{ slug?: string; name?: string; is_current?: boolean; models?: string[] }>;
    model?: string;
    provider?: string;
  };
}

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

function isAbsoluteLikePath(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('/') || value.startsWith('\\\\')) return true;
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function isHiddenOrBlockedPath(targetPath: string): boolean {
  const parts = targetPath.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.some((part) => part.startsWith('.') || BLOCKED_BASENAMES.has(part.toLowerCase()));
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.split('\\').join('/').trim();
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

  if (isAbsoluteLikePath(normalizedRelative)) {
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

  if (isAbsoluteLikePath(normalizedRelative)) {
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

  if (isAbsoluteLikePath(normalizedRelative)) {
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
  if (isAbsoluteLikePath(normalizedRelative)) {
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
  if (normalizedRelative && isAbsoluteLikePath(normalizedRelative)) {
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

  if (isAbsoluteLikePath(normalizedRelative)) {
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
  if (isAbsoluteLikePath(normalizedOld) || isAbsoluteLikePath(normalizedNew)) throw new Error('Use relative paths.');
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
  if (isAbsoluteLikePath(normalized)) throw new Error('Use a relative path.');
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
  if (isAbsoluteLikePath(normalized)) throw new Error('Use a relative path.');
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
    const transport = normalizeStoredTransport(parsed.transport, normalizedStoredGatewayUrl);

    const fallbackGatewayUrl = DEFAULT_HERMES_GATEWAY_URL;
    const gatewayUrl = normalizedStoredGatewayUrl || fallbackGatewayUrl;
    console.info('[Relay][Main][Config] readConfig', {
      requestedTransport: typeof parsed.transport === 'string' ? parsed.transport : '(none)',
      resolvedTransport: transport,
      gatewayUrl,
      path: configPath(),
    });
    return {
      backendType,
      transport,
      gatewayUrl,
      gatewayToken: parsed.gatewayToken ?? defaultConfig.gatewayToken,
    };
  } catch {
    console.info('[Relay][Main][Config] readConfig fallback default', {
      transport: defaultConfig.transport,
      gatewayUrl: defaultConfig.gatewayUrl,
      path: configPath(),
    });
    return defaultConfig;
  }
}

async function writeConfig(config: AppConfig): Promise<AppConfig> {
  const normalizedBackendType: AppConfig['backendType'] = 'hermes';
  const normalizedGatewayUrlInput = config.gatewayUrl.trim();
  const normalizedTransport = normalizeStoredTransport(config.transport, normalizedGatewayUrlInput);
  const fallbackGatewayUrl = DEFAULT_HERMES_GATEWAY_URL;
  const normalizedGatewayUrl = normalizedGatewayUrlInput || fallbackGatewayUrl;

  const normalized: AppConfig = {
    backendType: normalizedBackendType,
    transport: normalizedTransport,
    gatewayUrl: normalizedGatewayUrl,
    gatewayToken: config.gatewayToken.trim(),
  };

  console.info('[Relay][Main][Config] writeConfig', {
    requestedTransport: config.transport ?? '(none)',
    resolvedTransport: normalizedTransport,
    gatewayUrl: normalizedGatewayUrl,
    path: configPath(),
  });
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function runHealthCheck(gatewayUrl: string): Promise<HealthCheckResult> {
  const normalizedBaseUrl = await resolveGatewayBaseForMain(
    gatewayUrl
      .trim()
      .replace(/^wss?:\/\//, (value) => (value === 'wss://' ? 'https://' : 'http://')),
  );
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
  const acpBridge = new HermesAcpBridge();
  acpBridge.setUpdateCallback((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('acp:event', event);
    }
  });

  app.setAppUserModelId(WINDOWS_APP_ID);
  Menu.setApplicationMenu(null);
  registerDevContentSecurityPolicy();
  registerProdContentSecurityPolicy();

  ipcMain.handle('config:get', async () => readConfig());
  ipcMain.handle('config:save', async (_event, config: AppConfig) => writeConfig(config));
  ipcMain.handle(
    'acp:connect',
    async (
      _event,
      payload?: {
        gatewayUrl?: string;
        cwd?: string;
      },
    ) => {
      return acpBridge.connect({
        gatewayUrl: typeof payload?.gatewayUrl === 'string' ? payload.gatewayUrl : undefined,
        cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
      });
    },
  );
  ipcMain.handle('acp:disconnect', async () => acpBridge.disconnect());
  ipcMain.handle('acp:create-session', async (_event, payload?: { cwd?: string }) =>
    acpBridge.createSession({
      cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
    }),
  );
  ipcMain.handle(
    'acp:prompt',
    async (
      _event,
      payload: {
        sessionId: string;
        text: string;
      },
    ) =>
      acpBridge.prompt({
        sessionId: payload.sessionId,
        text: payload.text,
      }),
  );
  ipcMain.handle('acp:list-sessions', async () => acpBridge.listSessions());
  ipcMain.handle('acp:list-models', async (_event, payload?: { sessionId?: string }) =>
    acpBridge.listModels({
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
    }),
  );
  ipcMain.handle(
    'acp:set-session-model',
    async (
      _event,
      payload: {
        sessionId: string;
        model: string;
      },
    ) =>
      acpBridge.setSessionModel({
        sessionId: payload.sessionId,
        model: payload.model,
      }),
  );
  ipcMain.handle('acp:cancel', async (_event, payload: { sessionId: string }) =>
    acpBridge.cancel({ sessionId: payload.sessionId }),
  );
  ipcMain.handle('acp:workspace-list', async (_event, payload?: { sessionId?: string; path?: string }) =>
    acpBridge.workspaceList({
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      path: typeof payload?.path === 'string' ? payload.path : undefined,
    }),
  );
  ipcMain.handle('acp:workspace-read', async (_event, payload: { sessionId?: string; path: string }) =>
    acpBridge.workspaceRead({
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      path: payload.path,
    }),
  );
  ipcMain.handle('acp:workspace-stat', async (_event, payload: { sessionId?: string; path: string }) =>
    acpBridge.workspaceStat({
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      path: payload.path,
    }),
  );
  ipcMain.handle('acp:workspace-rename', async (_event, payload: { sessionId?: string; oldPath: string; newPath: string }) =>
    acpBridge.workspaceRename({
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      oldPath: payload.oldPath,
      newPath: payload.newPath,
    }),
  );
  ipcMain.handle('acp:workspace-delete', async (_event, payload: { sessionId?: string; path: string }) =>
    acpBridge.workspaceDelete({
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      path: payload.path,
    }),
  );
  ipcMain.handle('acp:workspace-write', async (_event, payload: { sessionId?: string; path: string; content: string }) =>
    acpBridge.workspaceWrite({
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      path: payload.path,
      content: payload.content,
    }),
  );
  ipcMain.handle(
    'acp:kanban-exec',
    async (
      _event,
      payload: {
        sessionId?: string;
        args: string[];
        timeoutMs?: number;
        requireJsonOutput?: boolean;
      },
    ) =>
      acpBridge.kanbanExec({
        sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
        args: Array.isArray(payload?.args) ? payload.args : [],
        timeoutMs: typeof payload?.timeoutMs === 'number' ? payload.timeoutMs : undefined,
        requireJsonOutput: Boolean(payload?.requireJsonOutput),
      }),
  );
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

      const normalizedBaseUrl = baseUrl
        .replace(/^wss:\/\//i, 'https://')
        .replace(/^ws:\/\//i, 'http://')
        .replace(/\/+$/, '');
      const requestUrl = `${normalizedBaseUrl}${path}`;
      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method,
          headers,
          body: typeof payload?.body === 'string' ? payload.body : undefined,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        const detail = describeFetchFailure(error, requestUrl);
        logHermesMain('warn', 'backend:http-request failed', { method, requestUrl, detail });
        throw new Error(detail);
      }

      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: text,
      };
    },
  );
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
      if (!rawGatewayUrl) {
        throw new Error('hermes:model-options requires explicit gatewayUrl. Refusing implicit local/default fallback.');
      }
      const parsedGatewayUrl = rawGatewayUrl;
      const mode = resolveGatewayMode(parsedGatewayUrl);
      const normalized = /^https?:\/\//i.test(parsedGatewayUrl) ? parsedGatewayUrl : `http://${parsedGatewayUrl}`;
      const gateway = new URL(normalized);
      const gatewayApiBase = `${gateway.protocol}//${gateway.host}${gateway.pathname.replace(/\/+$/, '')}`;
      const dashboardBaseUrl = `${gateway.protocol}//${gateway.hostname}:${HERMES_DEFAULT_DASHBOARD_PORT}`;
      const isLocalGateway = mode === 'local';
      const storedConfig = await readConfig();
      const gatewayToken = storedConfig.gatewayToken?.trim() || '';

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

      const fetchRemoteGatewayModelOptions = async () => {
        const response = await fetch(`${gatewayApiBase}/models`, {
          method: 'GET',
          headers: gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : undefined,
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Hermes gateway /models failed (${response.status}): ${body || response.statusText}`);
        }
        const data = await response.json() as { data?: Array<{ id?: string }> };
        const models = Array.isArray(data.data)
          ? data.data.map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : '')).filter(Boolean)
          : [];
        const grouped = new Map<string, string[]>();
        for (const modelId of models) {
          const [providerMaybe, modelMaybe] = modelId.includes('::') ? modelId.split('::', 2) : ['remote', modelId];
          const provider = providerMaybe.trim() || 'remote';
          const model = modelMaybe.trim();
          if (!model) continue;
          const next = grouped.get(provider) ?? [];
          if (!next.includes(model)) {
            next.push(model);
          }
          grouped.set(provider, next);
        }
        return normalizeModelOptionsResponse({
          providers: Array.from(grouped.entries()).map(([provider, providerModels]) => ({
            slug: provider,
            name: provider,
            models: providerModels,
          })),
        });
      };

      const fetchModelOptionsWithFallback = async () => {
        if (!isLocalGateway) {
          return fetchRemoteGatewayModelOptions();
        }
        try {
          return await fetchModelOptions();
        } catch (error) {
          logHermesMain('warn', 'Dashboard HTTP model-options fetch failed; trying WSL-local API', {
            error: error instanceof Error ? error.message : String(error),
          });
          const data = await fetchHermesModelOptionsViaWsl(HERMES_DEFAULT_DASHBOARD_PORT);
          return normalizeModelOptionsResponse(data);
        }
      };

      try {
        const result = await fetchModelOptionsWithFallback();
        logHermesMain('info', 'Model options fetched', { providers: result.providers.length });
        return result;
      } catch (initialError) {
        if (!isLocalGateway) {
          const detail = initialError instanceof Error ? initialError.message : String(initialError);
          logHermesMain('error', 'Unable to read remote gateway model options', { detail, gatewayApiBase });
          throw new Error(`Unable to read remote Hermes model options from ${gatewayApiBase}. ${detail}`);
        }
        let lastError: unknown = initialError;
        logHermesMain('warn', 'Model options fetch failed; attempting dashboard auto-start');
        const launcher = await startHermesDashboardProcess(HERMES_DEFAULT_DASHBOARD_PORT);
        logHermesMain('info', 'Dashboard startup attempt completed', { launcher: launcher ?? 'none' });

        for (let attempt = 0; attempt < 12; attempt += 1) {
          await delay(500);
          try {
            const result = await fetchModelOptionsWithFallback();
            logHermesMain('info', 'Model options fetched after retry', { attempt: attempt + 1, providers: result.providers.length });
            return result;
          } catch (attemptError) {
            lastError = attemptError;
            logHermesMain('warn', 'Model options retry failed', {
              attempt: attempt + 1,
              error: attemptError instanceof Error ? attemptError.message : String(attemptError),
            });
          }
        }

        const detail = lastError instanceof Error ? lastError.message : String(lastError);
        logHermesMain('error', 'Unable to read model options after retries', { detail });
        throw new Error(`Unable to read Hermes model options. ${detail}`);
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
      if (!rawGatewayUrl) {
        throw new Error('hermes:model-set-main requires explicit gatewayUrl. Refusing implicit local/default fallback.');
      }
      const parsedGatewayUrl = rawGatewayUrl;
      const mode = resolveGatewayMode(parsedGatewayUrl);
      const normalized = /^https?:\/\//i.test(parsedGatewayUrl) ? parsedGatewayUrl : `http://${parsedGatewayUrl}`;
      const gateway = new URL(normalized);
      const isLocalGateway = mode === 'local';
      const dashboardBaseUrl = `${gateway.protocol}//${gateway.hostname}:${HERMES_DEFAULT_DASHBOARD_PORT}`;

      if (!isLocalGateway) {
        throw new Error('Remote model switching is not available via Relay dashboard bridge. Change the model on your VPS Hermes instance (`hermes model`) or use ACP session model switching.');
      }

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
        const launcher = await startHermesDashboardProcess(HERMES_DEFAULT_DASHBOARD_PORT);
        logHermesMain('info', 'Dashboard startup attempt completed', { launcher: launcher ?? 'none', provider, model });
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
        throw new Error('Unable to set Hermes main model. Install/configure WSL or ensure `hermes` is available in your Windows PATH.');
      }
    },
  );
  ipcMain.handle('hermes:service-status', async () => {
    const currentConfig = await readConfig();
    const mode = resolveGatewayMode(currentConfig.gatewayUrl);
    if (mode !== 'local') {
      return { gateway: false, apiServer: false, dashboard: false };
    }

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
    const currentConfig = await readConfig();
    const mode = resolveGatewayMode(currentConfig.gatewayUrl);
    if (mode !== 'local') {
      return { ok: false, gateway: false, apiServer: false, dashboard: false, message: 'Local Hermes services are disabled while using a remote gateway URL.' };
    }

    logHermesMain('info', 'Starting Hermes services');
    const launcher = await startHermesGatewayAndDashboardProcesses(HERMES_DEFAULT_DASHBOARD_PORT);
    logHermesMain('info', 'Hermes services launch attempt completed', { launcher: launcher ?? 'none' });
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
