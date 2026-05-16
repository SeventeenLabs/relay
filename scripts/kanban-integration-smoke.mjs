import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const appPath = path.join(repoRoot, 'src', 'App.tsx');
const sidebarPath = path.join(repoRoot, 'src', 'components', 'layout', 'app-sidebar.tsx');
const backendClientPath = path.join(repoRoot, 'src', 'lib', 'agent-backend-client.ts');
const acpClientPath = path.join(repoRoot, 'src', 'lib', 'hermes-acp-client.ts');

function assertIncludesAll(content, snippets, label) {
  const missing = snippets.filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    throw new Error(`Missing required kanban snippets in ${label}: ${missing.join(', ')}`);
  }
}

async function run() {
  const [appSource, sidebarSource, backendSource, acpSource] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(sidebarPath, 'utf8'),
    readFile(backendClientPath, 'utf8'),
    readFile(acpClientPath, 'utf8'),
  ]);

  assertIncludesAll(appSource, [
    "type AppPage = 'chat' | 'cowork' | 'project' | 'kanban' | 'settings'",
    "activePage === 'kanban'",
    'onSelectPage={(page) => setActivePage(page)}',
  ], 'src/App.tsx');

  assertIncludesAll(sidebarSource, [
    "type AppPage = 'chat' | 'cowork' | 'project' | 'kanban' | 'settings'",
    "{ id: 'kanban', label: 'Kanban', page: 'kanban', icon: FolderKanban }",
  ], 'src/components/layout/app-sidebar.tsx');

  assertIncludesAll(backendSource, [
    'listKanbanTasks',
    'createKanbanTask',
    'getKanbanTask',
    'commentKanbanTask',
  ], 'src/lib/agent-backend-client.ts');

  assertIncludesAll(acpSource, [
    'async listKanbanTasks(',
    'async createKanbanTask(',
    'async getKanbanTask(',
    'async commentKanbanTask(',
    'acpKanbanExec',
    "['kanban', 'list', '--json']",
  ], 'src/lib/hermes-acp-client.ts');

  console.log('Kanban integration smoke checks passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
