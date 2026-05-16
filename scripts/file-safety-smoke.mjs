import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const electronMainPath = path.join(repoRoot, 'electron', 'main.ts');
const chatUtilsPath = path.join(repoRoot, 'src', 'lib', 'chat-utils.ts');
const appStateHelpersPath = path.join(repoRoot, 'src', 'app', 'app-state-helpers.ts');
const safetyPolicyPath = path.join(repoRoot, 'src', 'lib', 'safety-policy.ts');
const filesystemConnectorPath = path.join(repoRoot, 'src', 'lib', 'connectors', 'filesystem.ts');

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludesAll(content, snippets, label) {
  const missing = snippets.filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    throw new Error(`Missing required safety snippets in ${label}: ${missing.join(', ')}`);
  }
}

function extractFunctionBlock(source, functionName) {
  const signatures = [`async function ${functionName}(`, `function ${functionName}(`];
  let start = -1;
  for (const signature of signatures) {
    start = source.indexOf(signature);
    if (start >= 0) {
      break;
    }
  }
  if (start < 0) {
    throw new Error(`Could not find function: ${functionName}`);
  }

  const nextAsync = source.indexOf('\nasync function ', start + 1);
  const nextSync = source.indexOf('\nfunction ', start + 1);
  const candidates = [nextAsync, nextSync].filter((index) => index >= 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function assertFunctionContains(source, functionName, snippets) {
  const block = extractFunctionBlock(source, functionName);
  assertIncludesAll(block, snippets, `function ${functionName}`);
}

async function run() {
  const [electronMain, chatUtils, appStateHelpers, safetyPolicy, filesystemConnector] = await Promise.all([
    readText(electronMainPath),
    readText(chatUtilsPath),
    readText(appStateHelpersPath),
    readText(safetyPolicyPath),
    readText(filesystemConnectorPath),
  ]);

  // Project-relative path validation utility is centralized in app-state-helpers.
  assertIncludesAll(appStateHelpers, [
    'function validateProjectRelativePath(inputPath: string',
    "return options?.allowEmpty ? { ok: true } : { ok: false, reason: 'Path is required.' };",
    "return { ok: false, reason: 'Path contains invalid control characters.' };",
    "return { ok: false, reason: 'Absolute paths are not allowed for project-bound actions.' };",
    "return { ok: false, reason: 'Parent directory traversal is not allowed.' };",
  ], 'src/app/app-state-helpers.ts');

  // Parsing-side guardrails for relay file actions.
  assertFunctionContains(chatUtils, 'parseRelayFileActions', [
    "type !== 'create_file'",
    "type !== 'append_file'",
    "type !== 'read_file'",
    "type !== 'list_dir'",
    "type !== 'exists'",
    "type !== 'rename'",
    "type !== 'delete'",
    'hasUnsafePathChars(filePath)',
    'mergedRecord.new_path',
    'mergedRecord.toPath',
    'mergedRecord.to',
  ]);

  // Safety policy includes all file handling scopes + action mapping.
  assertIncludesAll(
    safetyPolicy,
    [
      "id: 'file-read'",
      "id: 'file-list'",
      "id: 'file-create'",
      "id: 'file-modify'",
      "id: 'file-delete'",
      "id: 'file-move'",
      "create_file: 'file-create'",
      "append_file: 'file-modify'",
      "read_file: 'file-read'",
      "list_dir: 'file-list'",
      "exists: 'file-read'",
      "rename: 'file-move'",
      "delete: 'file-delete'",
    ],
    'src/lib/safety-policy.ts',
  );

  // Filesystem connector actions remain aligned with safety scopes.
  assertIncludesAll(
    filesystemConnector,
    [
      "id: 'filesystem.read_file'",
      "scopeId: 'file-read'",
      "id: 'filesystem.create_file'",
      "scopeId: 'file-create'",
      "id: 'filesystem.append_file'",
      "scopeId: 'file-modify'",
      "id: 'filesystem.list_dir'",
      "scopeId: 'file-list'",
      "id: 'filesystem.exists'",
      "id: 'filesystem.rename'",
      "scopeId: 'file-move'",
      "id: 'filesystem.delete'",
      "scopeId: 'file-delete'",
    ],
    'src/lib/connectors/filesystem.ts',
  );

  // Electron-side file operation safety checks.
  assertFunctionContains(electronMain, 'writeFileInFolder', [
    'normalizeRelativePath(relativePath)',
    'path.isAbsolute(normalizedRelative)',
    'isHiddenOrBlockedPath(normalizedRelative)',
    'isPathInside(root, resolvedTargetPath)',
    'assertTargetPathAllowed(root, resolvedTargetPath',
  ]);

  assertFunctionContains(electronMain, 'readFileInFolder', [
    'normalizeRelativePath(relativePath)',
    'path.isAbsolute(normalizedRelative)',
    'isPathInside(root, resolvedTargetPath)',
    'assertTargetPathAllowed(root, resolvedTargetPath',
    'isHiddenOrBlockedPath(normalizedRelative)',
    'stats.size > MAX_READ_FILE_BYTES',
  ]);

  assertFunctionContains(electronMain, 'appendFileInFolder', [
    'normalizeRelativePath(relativePath)',
    'path.isAbsolute(normalizedRelative)',
    'isHiddenOrBlockedPath(normalizedRelative)',
    'isPathInside(root, resolvedTargetPath)',
    'assertTargetPathAllowed(root, resolvedTargetPath',
  ]);

  assertFunctionContains(electronMain, 'listDirInFolder', [
    'normalizeRelativePath(relativePath ?? \'\')',
    'path.isAbsolute(normalizedRelative)',
    'isHiddenOrBlockedPath(normalizedRelative)',
    'isPathInside(root, targetPath)',
    'assertRealPathInsideRoot(rootRealPath, targetPath',
    'isHiddenOrBlockedPath(entryRelative)',
  ]);

  assertFunctionContains(electronMain, 'existsInFolder', [
    'normalizeRelativePath(relativePath)',
    'path.isAbsolute(normalizedRelative)',
    'isHiddenOrBlockedPath(normalizedRelative)',
    'isPathInside(root, resolvedTargetPath)',
    'assertTargetPathAllowed(root, resolvedTargetPath',
  ]);

  assertFunctionContains(electronMain, 'renameInFolder', [
    'normalizeRelativePath(oldRelative)',
    'normalizeRelativePath(newRelative)',
    'path.isAbsolute(normalizedOld) || path.isAbsolute(normalizedNew)',
    'isHiddenOrBlockedPath(normalizedOld) || isHiddenOrBlockedPath(normalizedNew)',
    'isPathInside(root, resolvedOld) || !isPathInside(root, resolvedNew)',
    'assertTargetPathAllowed(root, resolvedOld',
    'assertRealPathInsideRoot(rootRealPath, path.dirname(resolvedNew)',
    'A file or directory already exists at the destination path.',
  ]);

  assertFunctionContains(electronMain, 'deleteInFolder', [
    'normalizeRelativePath(relativePath)',
    'path.isAbsolute(normalized)',
    'isHiddenOrBlockedPath(normalized)',
    'isPathInside(root, resolved)',
    'assertTargetPathAllowed(root, resolved',
    'if (resolved === root)',
  ]);

  assertFunctionContains(electronMain, 'statInFolder', [
    'normalizeRelativePath(relativePath)',
    'path.isAbsolute(normalized)',
    'isHiddenOrBlockedPath(normalized)',
    'isPathInside(root, resolved)',
    'assertTargetPathAllowed(root, resolved',
  ]);

  // Shared helpers that support symlink / traversal protections.
  assertIncludesAll(
    electronMain,
    [
      'function isPathInside(rootPath: string, targetPath: string): boolean',
      'function isHiddenOrBlockedPath(targetPath: string): boolean',
      'async function assertRealPathInsideRoot(',
      'async function assertTargetPathAllowed(',
      "throw new Error('Symbolic links are blocked for local file actions.')",
    ],
    'electron/main.ts',
  );

  console.log('File handling and safety smoke checks passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
