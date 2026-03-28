import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const ONBOARDING_COMPLETE_KEY = 'relay.onboarding.complete';
const USAGE_MODE_KEY = 'relay.usage.mode';
const RELAY_RECENTS_KEY = 'relay.recents.v1';
const COWORK_PROJECTS_KEY = 'relay.cowork.projects.v1';
const COWORK_ACTIVE_PROJECT_KEY = 'relay.cowork.projects.active.v1';
const COWORK_TASKS_KEY = 'relay.cowork.tasks.v1';
const USE_REAL_GATEWAY = process.env.RELAY_E2E_REAL_GATEWAY === '1';

test.describe.configure({ timeout: 120000 });

type ProjectSeed = { title: string; description: string; rootFolder: string };

function pendingApprovalCards(page: Page) {
  return page.getByTestId(/^pending-approval-(?!s-card$)(?!approve-)(?!reject-)(?!reason-).+/);
}

async function ensureE2ESafetyPolicy(page: Page) {
  await page.evaluate(() => {
    const activeProjectId = (localStorage.getItem('relay.cowork.projects.active.v1') || '').trim();
    const scopedKey = activeProjectId ? `relay.safety.scopes.project.${activeProjectId}` : '';

    const parseScopes = (key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return [] as Array<{
          id: string;
          name?: string;
          description?: string;
          riskLevel?: 'low' | 'medium' | 'high' | 'critical';
          enabled: boolean;
          requiresApproval: boolean;
        }>;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
          ? (parsed as Array<{
              id: string;
              name?: string;
              description?: string;
              riskLevel?: 'low' | 'medium' | 'high' | 'critical';
              enabled: boolean;
              requiresApproval: boolean;
            }>)
          : [];
      } catch {
        return [] as Array<{
          id: string;
          name?: string;
          description?: string;
          riskLevel?: 'low' | 'medium' | 'high' | 'critical';
          enabled: boolean;
          requiresApproval: boolean;
        }>;
      }
    };

    const ensureFileApproval = (
      input: Array<{
        id: string;
        name?: string;
        description?: string;
        riskLevel?: 'low' | 'medium' | 'high' | 'critical';
        enabled: boolean;
        requiresApproval: boolean;
      }>,
    ) => {
      let next = input.map((scope) =>
        scope.id === 'file-modify' || scope.id === 'file-create'
          ? { ...scope, enabled: true, requiresApproval: true }
          : scope,
      );
      if (!next.some((scope) => scope.id === 'file-modify')) {
        next = [
          ...next,
          {
            id: 'file-modify',
            name: 'Modify files',
            description: 'Agent can modify existing files',
            riskLevel: 'medium',
            enabled: true,
            requiresApproval: true,
          },
        ];
      }
      if (!next.some((scope) => scope.id === 'file-create')) {
        next = [
          ...next,
          {
            id: 'file-create',
            name: 'Create files',
            description: 'Agent can create files',
            riskLevel: 'medium',
            enabled: true,
            requiresApproval: true,
          },
        ];
      }
      return next;
    };

    const globalScopes = ensureFileApproval(parseScopes('relay.safety.scopes'));
    localStorage.setItem('relay.safety.scopes', JSON.stringify(globalScopes));
    if (scopedKey) {
      const projectScopes = ensureFileApproval(parseScopes(scopedKey));
      localStorage.setItem(scopedKey, JSON.stringify(projectScopes));
    }
  });
}

async function sendCoworkPrompt(page: Page, prompt: string) {
  const visibleComposer = page.locator('[aria-label="Task prompt"]:visible').first();
  if (!(await visibleComposer.count())) {
    const backToCowork = page.getByRole('button', { name: 'Back to Cowork' });
    if (await backToCowork.count()) {
      await backToCowork.first().click();
    }

    const runTaskButton = page.getByRole('button', { name: 'Run Task' });
    if (await runTaskButton.count()) {
      await runTaskButton.first().click();
    }
  }

  const promptBox = page.locator('[aria-label="Task prompt"]:visible').first();
  await expect(promptBox).toBeVisible();
  await promptBox.fill(prompt);

  const sendButton = page.locator('[aria-label="Send task"]:visible').first();
  if (await sendButton.isDisabled()) {
    const firstProject = page.locator('[data-testid^="project-select-"]').first();
    if (await firstProject.count()) {
      await firstProject.click();
    }
  }

  await expect(sendButton).toBeEnabled();
  await sendButton.click();
}

async function waitForFirstApproval(page: Page, timeout = 25000) {
  const approvalCard = pendingApprovalCards(page).first();
  await expect(approvalCard).toBeVisible({ timeout });

  const approvalTestIdAttr = (await approvalCard.getAttribute('data-testid')) || '';
  const approvalId = approvalTestIdAttr.replace('pending-approval-', '');
  expect(approvalId).not.toBe('');

  return { approvalCard, approvalId };
}

async function approveFirstPendingAction(page: Page, timeout = 25000) {
  const { approvalCard, approvalId } = await waitForFirstApproval(page, timeout);
  await page.getByTestId(`pending-approval-approve-${approvalId}`).click();
  await expect(approvalCard).toHaveCount(0);
}

async function rejectFirstPendingAction(page: Page, reason: string, timeout = 25000) {
  const { approvalCard, approvalId } = await waitForFirstApproval(page, timeout);
  const rejectReason = page.getByTestId(`pending-approval-reason-${approvalId}`);
  const rejectButton = page.getByTestId(`pending-approval-reject-${approvalId}`);
  await rejectReason.fill(reason);
  await expect(rejectButton).toBeEnabled();
  await rejectButton.click();
  await expect(approvalCard).toHaveCount(0);
}

async function createProjectFromSidebar(page: Page, project: ProjectSeed) {
  await page.getByTitle('Add project').click();
  await page.getByTestId('create-project-mode-existing').click();
  await page.getByPlaceholder('Project name').fill(project.title);
  await page.getByPlaceholder('Project description (what this project is about)').fill(project.description);
  await page.getByPlaceholder('Choose project location').fill(project.rootFolder);
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.locator('[data-testid^="project-select-"]', { hasText: project.title })).toBeVisible();
}

async function selectProjectByTitle(page: Page, title: string) {
  await page.locator('[data-testid^="project-select-"]', { hasText: title }).first().click();
}

async function waitForPromptStatus(page: Page, promptTag: string, status: 'completed' | 'failed') {
  await expect
    .poll(
      async () =>
        page.evaluate(([tasksKey, tag]) => {
          const raw = localStorage.getItem(tasksKey);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as Array<{ prompt?: string; status?: string }>;
            const match = parsed.find((entry) => typeof entry.prompt === 'string' && entry.prompt.includes(tag));
            return match?.status ?? null;
          } catch {
            return null;
          }
        }, [COWORK_TASKS_KEY, promptTag] as [string, string]),
      { timeout: 45000 },
    )
    .toBe(status);
}

test.describe('Cowork project runtime rules', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    test.skip(USE_REAL_GATEWAY, 'Project context suite runs against mock gateway only.');

    app = await electron.launch({ args: ['.'] });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(([onboardingKey, usageModeKey, recentsKey, projectsKey, activeProjectKey, tasksKey]) => {
      localStorage.setItem(onboardingKey, 'true');
      localStorage.setItem(usageModeKey, 'guest');
      localStorage.removeItem(recentsKey);
      localStorage.removeItem(projectsKey);
      localStorage.removeItem(activeProjectKey);
      localStorage.removeItem(tasksKey);
      sessionStorage.clear();
    }, [ONBOARDING_COMPLETE_KEY, USAGE_MODE_KEY, RELAY_RECENTS_KEY, COWORK_PROJECTS_KEY, COWORK_ACTIVE_PROJECT_KEY, COWORK_TASKS_KEY]);

    await page.evaluate(async () => {
      if (!window.relay?.saveConfig) return;
      await window.relay.saveConfig({ gatewayUrl: 'ws://127.0.0.1:18789', gatewayToken: '' });
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ensureE2ESafetyPolicy(page);
  });

  test.afterEach(async () => {
    await app.close();
  });

  test('write action is blocked when no active project context exists', async () => {
    await page.locator('[aria-label="Task prompt"]:visible').first().fill(
      'Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "no project".',
    );

    await expect(page.locator('[aria-label="Send task"]:visible').first()).toBeDisabled();
    await expect(pendingApprovalCards(page)).toHaveCount(0);
  });

  test('realistic flow: create a docs-maintenance project from sidebar and execute an approved write', async () => {
    const workspaceRoot = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) throw new Error('Desktop bridge unavailable.');
      const downloads = await bridge.getDownloadsPath();
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}relay-docs-maintenance`;
      await bridge.createFileInFolder(downloads, 'relay-docs-maintenance/README.md', '# Docs Maintenance\n', true);
      return root;
    });

    await createProjectFromSidebar(page, {
      title: 'Relay Docs Maintenance',
      description: 'Maintain release notes and operational docs for Relay.',
      rootFolder: workspaceRoot,
    });

    await sendCoworkPrompt(
      page,
      'DOCS-RUN-1: Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "docs maintenance run".',
    );

    const { approvalCard } = await waitForFirstApproval(page);
    await expect(approvalCard).toContainText('Relay Docs Maintenance');
    await expect(approvalCard).toContainText('Append relay-e2e/mock-approval.txt');

    await approveFirstPendingAction(page);
    await expect(page.getByRole('button', { name: /Appended:\s+.*mock-approval\.txt/i })).toBeVisible({ timeout: 30000 });
    await waitForPromptStatus(page, 'DOCS-RUN-1', 'completed');

    const result = await page.evaluate(async (root) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder || !bridge.readFileInFolder) throw new Error('Desktop bridge unavailable.');
      const relPath = 'relay-e2e/mock-approval.txt';
      const exists = await bridge.existsInFolder(root, relPath);
      const content = exists.exists ? (await bridge.readFileInFolder(root, relPath)).content : '';
      return { exists: exists.exists, content };
    }, workspaceRoot);

    expect(result.exists).toBeTruthy();
    expect(result.content).toContain('docs maintenance run');
  });

  test('traversal path is blocked with no approval card', async () => {
    const setup = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) throw new Error('Desktop bridge unavailable.');
      const downloads = await bridge.getDownloadsPath();
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}relay-e2e-traversal-root`;
      await bridge.createFileInFolder(downloads, 'relay-e2e-traversal-root/seed.txt', 'seed', true);
      return { root, downloads };
    });

    await createProjectFromSidebar(page, {
      title: 'Traversal Guard Project',
      description: 'Protect project boundary from traversal writes.',
      rootFolder: setup.root,
    });

    await sendCoworkPrompt(
      page,
      'TRAVERSAL-RUN: Return one relay_actions append_file action for ../relay-e2e-traversal-leak.txt with content "must be blocked".',
    );

    await expect(pendingApprovalCards(page)).toHaveCount(0, { timeout: 12000 });
    await expect(page.getByRole('button', { name: /Appended failed:\s+\.\.\/relay-e2e-traversal-leak\.txt/i })).toBeVisible({ timeout: 20000 });
    await waitForPromptStatus(page, 'TRAVERSAL-RUN', 'failed');

    const escapedExists = await page.evaluate(async (downloadsRoot) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) throw new Error('Desktop bridge unavailable.');
      return (await bridge.existsInFolder(downloadsRoot, 'relay-e2e-traversal-leak.txt')).exists;
    }, setup.downloads);

    expect(escapedExists).toBeFalsy();
  });

  test('realistic flow: two projects stay isolated across approved writes', async () => {
    const roots = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) throw new Error('Desktop bridge unavailable.');

      const downloads = await bridge.getDownloadsPath();
      const runTag = Date.now();
      const docsFolderName = `relay-client-docs-ops-${runTag}`;
      const supportFolderName = `relay-client-support-ops-${runTag}`;
      const docsRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${docsFolderName}`;
      const supportRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${supportFolderName}`;

      await bridge.createFileInFolder(downloads, `${docsFolderName}/README.md`, '# Docs Ops\n', true);
      await bridge.createFileInFolder(downloads, `${supportFolderName}/README.md`, '# Support Ops\n', true);

      return { docsRoot, supportRoot };
    });

    await createProjectFromSidebar(page, {
      title: 'Client Docs Ops',
      description: 'Maintain deliverables and release documentation.',
      rootFolder: roots.docsRoot,
    });

    await createProjectFromSidebar(page, {
      title: 'Client Support Ops',
      description: 'Maintain support playbooks and escalation docs.',
      rootFolder: roots.supportRoot,
    });

    await selectProjectByTitle(page, 'Client Docs Ops');
    await sendCoworkPrompt(
      page,
      'ISO-DOCS-1: Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "docs project write".',
    );
    await approveFirstPendingAction(page);
    await waitForPromptStatus(page, 'ISO-DOCS-1', 'completed');

    await selectProjectByTitle(page, 'Client Support Ops');
    await sendCoworkPrompt(
      page,
      'ISO-SUPPORT-1: Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "support project write".',
    );
    await approveFirstPendingAction(page);
    await waitForPromptStatus(page, 'ISO-SUPPORT-1', 'completed');

    const check = await page.evaluate(async ({ docsRoot, supportRoot }) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) throw new Error('Desktop bridge unavailable.');
      const relPath = 'relay-e2e/mock-approval.txt';
      return {
        docs: (await bridge.existsInFolder(docsRoot, relPath)).exists,
        support: (await bridge.existsInFolder(supportRoot, relPath)).exists,
      };
    }, roots);

    expect(check.docs).toBeTruthy();
    expect(check.support).toBeTruthy();
  });

  test('task statuses reflect approval and rejection outcomes', async () => {
    const root = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) throw new Error('Desktop bridge unavailable.');
      const downloads = await bridge.getDownloadsPath();
      const folderName = `relay-task-queue-status-${Date.now()}`;
      const projectRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${folderName}`;
      await bridge.createFileInFolder(downloads, `${folderName}/README.md`, '# Queue Status\n', true);
      return projectRoot;
    });

    await createProjectFromSidebar(page, {
      title: 'Task Queue Status Project',
      description: 'Verify task status transitions for approvals and rejections.',
      rootFolder: root,
    });

    await sendCoworkPrompt(page, 'QUEUE-STATUS-APPROVED: Return one relay_actions append_file action for queue/approved.md with content "approved task".');
    await approveFirstPendingAction(page);
    await waitForPromptStatus(page, 'QUEUE-STATUS-APPROVED', 'completed');

    await sendCoworkPrompt(page, 'QUEUE-STATUS-REJECTED: Return one relay_actions append_file action for queue/rejected.md with content "rejected task".');
    await rejectFirstPendingAction(page, 'Reject queue status task in E2E.');
    await waitForPromptStatus(page, 'QUEUE-STATUS-REJECTED', 'failed');

    const fileCheck = await page.evaluate(async (projectRoot) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) throw new Error('Desktop bridge unavailable.');
      return {
        approved: (await bridge.existsInFolder(projectRoot, 'queue/approved.md')).exists,
        rejected: (await bridge.existsInFolder(projectRoot, 'queue/rejected.md')).exists,
      };
    }, root);

    expect(fileCheck.approved).toBeTruthy();
    expect(fileCheck.rejected).toBeFalsy();
  });

  test('projects can be renamed and deleted from sidebar with persistence', async () => {
    const workspaceRoot = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) throw new Error('Desktop bridge unavailable.');

      const downloads = await bridge.getDownloadsPath();
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}relay-ops-inbox`;
      await bridge.createFileInFolder(downloads, 'relay-ops-inbox/README.md', '# Ops Inbox\n', true);
      return root;
    });

    await createProjectFromSidebar(page, {
      title: 'Ops Inbox',
      description: 'Initial queue workspace.',
      rootFolder: workspaceRoot,
    });

    const projectId = await page.evaluate((projectsKey) => {
      const raw = localStorage.getItem(projectsKey);
      if (!raw) return '';
      try {
        const projects = JSON.parse(raw) as Array<{ id: string; name: string }>;
        return projects.find((project) => project.name === 'Ops Inbox')?.id || '';
      } catch {
        return '';
      }
    }, COWORK_PROJECTS_KEY);

    expect(projectId).not.toBe('');

    await page.getByTestId(`project-rename-${projectId}`).click();
    await page.getByPlaceholder('Project title').fill('Ops Inbox Renamed');
    await page.getByPlaceholder('Description (optional)').fill('Renamed for operations triage.');
    await page.getByTestId('rename-project-confirm').click();

    await expect(page.locator('[data-testid^="project-select-"]', { hasText: 'Ops Inbox Renamed' })).toBeVisible();

    await page.getByTestId(`project-delete-${projectId}`).click();
    await page.getByTestId('delete-project-confirm').click();

    await expect(page.locator('[data-testid^="project-select-"]', { hasText: 'Ops Inbox Renamed' })).toHaveCount(0);
    await expect(page.getByText('No projects yet')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('No projects yet')).toBeVisible();

    const persistedProjects = await page.evaluate((projectsKey) => {
      const raw = localStorage.getItem(projectsKey);
      if (!raw) return [] as Array<{ id: string; name: string }>;
      try {
        return JSON.parse(raw) as Array<{ id: string; name: string }>;
      } catch {
        return [] as Array<{ id: string; name: string }>;
      }
    }, COWORK_PROJECTS_KEY);

    expect(persistedProjects).toHaveLength(0);
  });
});
