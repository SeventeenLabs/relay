import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

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
  LocalFileStatResult,
  GatewayDiscoveryResult,
} from '../src/app-types.js';

const execFileAsync = promisify(execFile);

const defaultConfig: AppConfig = {
  gatewayUrl: 'ws://127.0.0.1:18789',
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

const configPath = () => path.join(app.getPath('userData'), 'openclaw-config.json');

const isDev = !app.isPackaged;
const MAX_READ_FILE_BYTES = 256 * 1024;
const MAX_LIST_DIR_ITEMS = 200;
const BLOCKED_BASENAMES = new Set(['desktop.ini', 'thumbs.db']);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isLoopbackHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1';

function registerWebSocketOriginRewrite() {
  const filter = {
    urls: ['ws://*/*', 'wss://*/*'],
  };

  // Electron packaged builds run from file:// and may send an origin rejected by gateway allowlists.
  // Rewrite remote WS handshakes to the target host origin so gateway allowlist checks can pass.
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    try {
      const target = new URL(details.url);
      if (isLoopbackHost(target.hostname)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }

      const rewrittenOrigin = `${target.protocol === 'wss:' ? 'https:' : 'http:'}//${target.host}`;
      details.requestHeaders.Origin = rewrittenOrigin;
      details.requestHeaders.origin = rewrittenOrigin;
      callback({ requestHeaders: details.requestHeaders });
    } catch {
      callback({ requestHeaders: details.requestHeaders });
    }
  });
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
      await fs.access(resolvedTargetPath);
      throw new Error('A file already exists at that path.');
    } catch (error) {
      if (error instanceof Error && error.message === 'A file already exists at that path.') {
        throw error;
      }
    }
  }

  await fs.writeFile(resolvedTargetPath, content, 'utf8');
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
      (parsed.baseUrl
        ? parsed.baseUrl.replace(/^https?:\/\//, (value) => (value === 'https://' ? 'wss://' : 'ws://'))
        : defaultConfig.gatewayUrl);

    return {
      gatewayUrl: inferredGatewayUrl,
      gatewayToken: parsed.gatewayToken ?? defaultConfig.gatewayToken,
    };
  } catch {
    return defaultConfig;
  }
}

async function writeConfig(config: AppConfig): Promise<AppConfig> {
  const normalizedGatewayUrl = config.gatewayUrl.trim();

  const normalized = {
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
          message: `OpenClaw backend reachable at ${candidate}`,
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
    message: 'Unable to reach the OpenClaw backend. Check the URL, port, and network path.',
  };
}

// ---------------------------------------------------------------------------
// Gateway auto-discovery
// ---------------------------------------------------------------------------

const DEFAULT_PORTS = [18789, 18790];

async function probeGatewayHealth(port: number): Promise<boolean> {
  const candidates = [`http://127.0.0.1:${port}/health`, `http://127.0.0.1:${port}/`];
  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function getOpenClawBinaryCandidates(): string[] {
  const home = os.homedir();
  const isWindows = process.platform === 'win32';
  const bin = isWindows ? 'openclaw.exe' : 'openclaw';

  const paths: string[] = [
    // Standard install location
    path.join(home, '.openclaw', 'bin', bin),
    // Relay-managed location
    path.join(home, '.relay', 'openclaw', bin),
  ];

  if (!isWindows) {
    paths.push(
      path.join('/usr', 'local', 'bin', 'openclaw'),
      path.join(home, '.local', 'bin', 'openclaw'),
    );
  }

  return paths;
}

async function findBinaryOnPath(): Promise<string | null> {
  const command = process.platform === 'win32' ? 'where' : 'which';
  // On Windows, npm global binaries are .cmd wrappers — try that first
  const names = process.platform === 'win32' ? ['openclaw.cmd', 'openclaw'] : ['openclaw'];
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync(command, [name], { timeout: 3000 });
      const firstLine = stdout.trim().split(/\r?\n/)[0];
      if (firstLine) return firstLine;
    } catch {
      // not found, try next variant
    }
  }
  return null;
}

async function findBinaryOnDisk(): Promise<string | null> {
  for (const candidate of getOpenClawBinaryCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return findBinaryOnPath();
}

async function discoverGateway(): Promise<GatewayDiscoveryResult> {
  // Step 1: Probe default ports for a running gateway
  for (const port of DEFAULT_PORTS) {
    const alive = await probeGatewayHealth(port);
    if (alive) {
      return {
        found: true,
        gatewayUrl: `ws://127.0.0.1:${port}`,
        binaryFound: true,
        binaryPath: null,
        message: `OpenClaw gateway detected on port ${port}.`,
      };
    }
  }

  // Step 2: No running gateway — check if binary is installed
  const binaryPath = await findBinaryOnDisk();
  if (binaryPath) {
    return {
      found: false,
      gatewayUrl: null,
      binaryFound: true,
      binaryPath,
      message: `OpenClaw binary found at ${binaryPath} but no gateway is running.`,
    };
  }

  // Step 3: Nothing found
  return {
    found: false,
    gatewayUrl: null,
    binaryFound: false,
    binaryPath: null,
    message: 'No local OpenClaw installation detected.',
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
    frame: false,
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
  Menu.setApplicationMenu(null);
  registerWebSocketOriginRewrite();
  registerDevContentSecurityPolicy();
  registerProdContentSecurityPolicy();

  ipcMain.handle('config:get', async () => readConfig());
  ipcMain.handle('config:save', async (_event, config: AppConfig) => writeConfig(config));
  ipcMain.handle('backend:health-check', async (_event, baseUrl: string) => runHealthCheck(baseUrl));
  ipcMain.handle('gateway:discover', async () => discoverGateway());
  ipcMain.handle('plugin:check-workspace', async () => {
    const binaryPath = await findBinaryOnDisk();
    if (!binaryPath) return { installed: false, error: 'OpenClaw binary not found.' };
    try {
      const { stdout } = await execFileAsync(binaryPath, ['plugins', 'list'], {
        timeout: 10_000,
        shell: process.platform === 'win32',
      });
      return { installed: stdout.includes('openclaw-relay-workspace') };
    } catch {
      return { installed: false };
    }
  });
  ipcMain.handle('plugin:install-workspace', async () => {
    const binaryPath = await findBinaryOnDisk();
    if (!binaryPath) {
      return { ok: false as const, error: 'OpenClaw binary not found on this system.' };
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        binaryPath,
        ['plugins', 'install', '@seventeenlabs/openclaw-relay-workspace'],
        { timeout: 60_000, shell: process.platform === 'win32' },
      );
      return { ok: true as const, output: stdout || stderr };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error: msg };
    }
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