import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const chatUtilsPath = path.join(repoRoot, 'src', 'lib', 'chat-utils.ts');
const appPath = path.join(repoRoot, 'src', 'App.tsx');

async function assertIncludes(filePath, snippets) {
  const content = await readFile(filePath, 'utf8');
  const missing = snippets.filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    throw new Error(`Missing required snippets in ${filePath}: ${missing.join(', ')}`);
  }
}

async function assertExcludes(filePath, snippets) {
  const content = await readFile(filePath, 'utf8');
  const found = snippets.filter((snippet) => content.includes(snippet));
  if (found.length > 0) {
    throw new Error(`Found forbidden snippets in ${filePath}: ${found.join(', ')}`);
  }
}

async function run() {
  await assertIncludes(chatUtilsPath, [
    "normalizedType === 'list_files'",
    "normalizedType === 'write_file'",
    "normalizedType === 'edit_file'",
    "mergedRecord.relativePath",
    "mergedRecord.targetPath",
    "mergedRecord.search",
    "mergedRecord.replacement",
    "normalizeRelayActions(parsed.relay_actions ?? parsed.relayActions ?? parsed)",
    'if (parseRelayFileActions(trimmed).length > 0) {',
  ]);

  await assertExcludes(appPath, [
    "Blocked: write actions require an active project context.",
  ]);

  console.log('Structured action execution parity smoke checks passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
