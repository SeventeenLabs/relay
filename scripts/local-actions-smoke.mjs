import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const preloadPath = path.join(repoRoot, 'dist-electron', 'electron', 'preload.cjs');
const appPath = path.join(repoRoot, 'src', 'App.tsx');
const safetyPolicyPath = path.join(repoRoot, 'src', 'lib', 'safety-policy.ts');
const coworkPagePath = path.join(repoRoot, 'src', 'features', 'cowork', 'cowork-page.tsx');

async function assertIncludes(filePath, requiredSnippets) {
  const content = await readFile(filePath, 'utf8');
  const missing = requiredSnippets.filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    throw new Error(`Missing snippets in ${filePath}: ${missing.join(', ')}`);
  }
}

async function run() {
  await assertIncludes(preloadPath, [
    'createFileInFolder',
    'appendFileInFolder',
    'readFileInFolder',
    'listDirInFolder',
    'existsInFolder',
  ]);

  await assertIncludes(appPath, [
    'type: \'create_file\'',
    'type: \'append_file\'',
    'type: \'read_file\'',
    'type: \'list_dir\'',
    'type: \'exists\'',
  ]);

  await assertIncludes(safetyPolicyPath, [
    'SAFETY_STORAGE_KEY',
    'DEFAULT_SAFETY_SCOPES',
    'resolveLocalActionPolicy',
    'create_file',
    'append_file',
    'read_file',
    'list_dir',
    'exists',
  ]);

  await assertIncludes(appPath, [
    'pendingApprovals',
    'requestActionApproval',
    'resolvePendingApproval',
    'Blocked by safety policy',
    'Awaiting approval for',
    'REJECTED_BY_OPERATOR',
    'APPROVAL_TIMEOUT',
  ]);

  await assertIncludes(coworkPagePath, [
    'pending-approvals-card',
    'onApprovePendingAction',
    'onRejectPendingAction',
  ]);

  console.log('Local action + approval smoke checks passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
