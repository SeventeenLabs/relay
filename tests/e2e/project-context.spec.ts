import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const ONBOARDING_COMPLETE_KEY = 'relay.onboarding.complete';
const USAGE_MODE_KEY = 'relay.usage.mode';
const RELAY_RECENTS_KEY = 'relay.recents.v1';
const COWORK_PROJECTS_KEY = 'relay.cowork.projects.v1';
const COWORK_ACTIVE_PROJECT_KEY = 'relay.cowork.projects.active.v1';
const USE_REAL_GATEWAY = process.env.RELAY_E2E_REAL_GATEWAY === '1';

test.describe.configure({ timeout: 120000 });

async function sendCoworkPrompt(page: Page, prompt: string) {
  await page.getByPlaceholder('How can I help you today?').fill(prompt);
  await page.getByLabel('Send task').click();
}

async function waitForFirstApproval(page: Page, timeout = 25000) {
  const approvalCard = page.locator('[data-testid^="pending-approval-"]').first();
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

async function createProjectFromSidebar(page: Page, project: { title: string; description: string; rootFolder: string }) {
  await page.getByTitle('Add project').click();
  await page.getByPlaceholder('Project title (example: Client Alpha Website)').fill(project.title);
  await page
    .getByPlaceholder('Description (optional: goals, owner, constraints)')
    .fill(project.description);
  await page
    .getByPlaceholder('Workspace folder path (example: C:/Projects/client-alpha)')
    .fill(project.rootFolder);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.locator('button[data-slot="sidebar-menu-button"]', { hasText: project.title })).toBeVisible();
}

async function ensureE2ESafetyPolicy(page: Page) {
  await page.evaluate(() => {
    const raw = localStorage.getItem('relay.safety.scopes');
    if (!raw) {
      return;
    }

    try {
      const scopes = JSON.parse(raw) as Array<{
        id: string;
        enabled: boolean;
        requiresApproval: boolean;
      }>;

      const next = scopes.map((scope) => {
        if (scope.id === 'file-modify' || scope.id === 'file-create') {
          return {
            ...scope,
            enabled: true,
            requiresApproval: true,
          };
        }
        return scope;
      });

      localStorage.setItem('relay.safety.scopes', JSON.stringify(next));
    } catch {
      // Ignore malformed stored safety policy; app defaults will apply.
    }
  });
}

test.describe('Cowork project runtime rules', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    test.skip(USE_REAL_GATEWAY, 'Project context suite runs against mock gateway only.');

    app = await electron.launch({
      args: ['.'],
    });

    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(([onboardingKey, usageModeKey, recentsKey, projectsKey, activeProjectKey]) => {
      localStorage.setItem(onboardingKey, 'true');
      localStorage.setItem(usageModeKey, 'guest');
      localStorage.removeItem(recentsKey);
      localStorage.removeItem(projectsKey);
      localStorage.removeItem(activeProjectKey);
      sessionStorage.clear();
    }, [ONBOARDING_COMPLETE_KEY, USAGE_MODE_KEY, RELAY_RECENTS_KEY, COWORK_PROJECTS_KEY, COWORK_ACTIVE_PROJECT_KEY]);

    await page.evaluate(async () => {
      if (!window.relay?.saveConfig) {
        return;
      }

      await window.relay.saveConfig({
        gatewayUrl: 'ws://127.0.0.1:18789',
        gatewayToken: '',
      });
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ensureE2ESafetyPolicy(page);
  });

  test.afterEach(async () => {
    await app.close();
  });

  test('write action is blocked when no active project context exists', async () => {
    await page.getByPlaceholder('How can I help you today?').fill(
      'Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "no project".',
    );
    await page.getByLabel('Send task').click();

    await expect(page.locator('[data-testid^="pending-approval-"]')).toHaveCount(0, { timeout: 12000 });
    await expect(page.getByText('append_file â€¢ error')).toBeVisible({ timeout: 20000 });
  });

  test('run keeps its original project root when active project changes mid-run', async () => {
    const roots = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for project test setup.');
      }

      const downloads = await bridge.getDownloadsPath();
      const projectARoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}relay-e2e-project-a`;
      const projectBRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}relay-e2e-project-b`;

      await bridge.createFileInFolder(downloads, 'relay-e2e-project-a/seed.txt', 'seed', true);
      await bridge.createFileInFolder(downloads, 'relay-e2e-project-b/seed.txt', 'seed', true);

      return {
        projectARoot,
        projectBRoot,
      };
    });

    const now = Date.now();
    await page.evaluate(([projectsKey, activeProjectKey, projectARoot, projectBRoot, nowValue]) => {
      const projects = [
        {
          id: 'e2e-project-a',
          name: 'E2E Project A',
          workspaceFolder: projectARoot,
          createdAt: nowValue,
          updatedAt: nowValue,
        },
        {
          id: 'e2e-project-b',
          name: 'E2E Project B',
          workspaceFolder: projectBRoot,
          createdAt: nowValue,
          updatedAt: nowValue,
        },
      ];

      localStorage.setItem(projectsKey, JSON.stringify(projects));
      localStorage.setItem(activeProjectKey, 'e2e-project-a');
    }, [COWORK_PROJECTS_KEY, COWORK_ACTIVE_PROJECT_KEY, roots.projectARoot, roots.projectBRoot, now] as [string, string, string, string, number]);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.getByPlaceholder('How can I help you today?').fill(
      'DELAY_LONG Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "run uses project A snapshot".',
    );
    await page.getByLabel('Send task').click();

    await page.getByTestId('project-select-e2e-project-b').click();

    const approvalCard = page.locator('[data-testid^="pending-approval-"]').first();
    await expect(approvalCard).toBeVisible({ timeout: 25000 });

    const approvalTestIdAttr = (await approvalCard.getAttribute('data-testid')) || '';
    const approvalId = approvalTestIdAttr.replace('pending-approval-', '');
    await page.getByTestId(`pending-approval-approve-${approvalId}`).click();

    await expect(page.getByText('append_file â€¢ ok')).toBeVisible({ timeout: 30000 });

    const fileLocations = await page.evaluate(async ({ projectARoot, projectBRoot }) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) {
        throw new Error('Desktop bridge is unavailable for verification.');
      }

      const relPath = 'relay-e2e/mock-approval.txt';
      const inA = await bridge.existsInFolder(projectARoot, relPath);
      const inB = await bridge.existsInFolder(projectBRoot, relPath);

      return {
        inA: inA.exists,
        inB: inB.exists,
      };
    }, roots);

    expect(fileLocations.inA).toBeTruthy();
    expect(fileLocations.inB).toBeFalsy();
  });

  test('traversal path is blocked with PROJECT_BOUNDARY_BLOCK and no approval card', async () => {
    const root = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for project setup.');
      }

      const downloads = await bridge.getDownloadsPath();
      const workspaceRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}relay-e2e-traversal-root`;
      await bridge.createFileInFolder(downloads, 'relay-e2e-traversal-root/seed.txt', 'seed', true);
      return {
        workspaceRoot,
        downloads,
      };
    });

    const now = Date.now();
    await page.evaluate(([projectsKey, activeProjectKey, workspaceRoot, nowValue]) => {
      const projects = [
        {
          id: 'e2e-project-traversal',
          name: 'E2E Traversal Guard',
          workspaceFolder: workspaceRoot,
          createdAt: nowValue,
          updatedAt: nowValue,
        },
      ];

      localStorage.setItem(projectsKey, JSON.stringify(projects));
      localStorage.setItem(activeProjectKey, 'e2e-project-traversal');
    }, [COWORK_PROJECTS_KEY, COWORK_ACTIVE_PROJECT_KEY, root.workspaceRoot, now] as [string, string, string, number]);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await sendCoworkPrompt(
      page,
      'Return one relay_actions append_file action for ../relay-e2e-traversal-leak.txt with content "must be blocked".',
    );

    await expect(page.locator('[data-testid^="pending-approval-"]')).toHaveCount(0, { timeout: 12000 });
    await expect(page.getByText('append_file â€¢ error')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('PROJECT_BOUNDARY_BLOCK')).toBeVisible({ timeout: 20000 });

    const escapedExists = await page.evaluate(async (downloadsRoot) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) {
        throw new Error('Desktop bridge is unavailable for verification.');
      }

      const result = await bridge.existsInFolder(downloadsRoot, 'relay-e2e-traversal-leak.txt');
      return result.exists;
    }, root.downloads);

    expect(escapedExists).toBeFalsy();
  });

  test('realistic flow: create a docs-maintenance project from sidebar and execute an approved write', async () => {
    const workspaceRoot = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for realistic project setup.');
      }

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
      'Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "docs maintenance run".',
    );

    const { approvalCard } = await waitForFirstApproval(page);
    await expect(approvalCard.getByText('Project: Relay Docs Maintenance')).toBeVisible();

    await approveFirstPendingAction(page);

    await expect(page.getByText('append_file â€¢ ok')).toBeVisible({ timeout: 30000 });

    const result = await page.evaluate(async (root) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder || !bridge.readFileInFolder) {
        throw new Error('Desktop bridge is unavailable for verification.');
      }

      const relPath = 'relay-e2e/mock-approval.txt';
      const exists = await bridge.existsInFolder(root, relPath);
      const content = exists.exists ? (await bridge.readFileInFolder(root, relPath)).content : '';

      return {
        exists: exists.exists,
        content,
      };
    }, workspaceRoot);

    expect(result.exists).toBeTruthy();
    expect(result.content).toContain('docs maintenance run');
  });

  test('realistic flow: two projects stay isolated across approved writes', async () => {
    const roots = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for realistic isolation setup.');
      }

      const downloads = await bridge.getDownloadsPath();
      const runTag = Date.now();
      const docsFolderName = `relay-client-docs-ops-${runTag}`;
      const supportFolderName = `relay-client-support-ops-${runTag}`;
      const docsRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${docsFolderName}`;
      const supportRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${supportFolderName}`;

      await bridge.createFileInFolder(downloads, `${docsFolderName}/README.md`, '# Docs Ops\n', true);
      await bridge.createFileInFolder(downloads, `${supportFolderName}/README.md`, '# Support Ops\n', true);

      return {
        docsRoot,
        supportRoot,
      };
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

    await page.locator('button[data-slot="sidebar-menu-button"]', { hasText: 'Client Docs Ops' }).click();
    await sendCoworkPrompt(
      page,
      'Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "docs project write".',
    );
    await approveFirstPendingAction(page);
    await expect(page.getByText('append_file â€¢ ok')).toBeVisible({ timeout: 30000 });

    const afterFirstWrite = await page.evaluate(async ({ docsRoot, supportRoot }) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) {
        throw new Error('Desktop bridge is unavailable for verification.');
      }

      const relPath = 'relay-e2e/mock-approval.txt';
      const docs = await bridge.existsInFolder(docsRoot, relPath);
      const support = await bridge.existsInFolder(supportRoot, relPath);
      return {
        docs: docs.exists,
        support: support.exists,
      };
    }, roots);

    expect(afterFirstWrite.docs).toBeTruthy();
    expect(afterFirstWrite.support).toBeFalsy();

    await page.locator('button[data-slot="sidebar-menu-button"]', { hasText: 'Client Support Ops' }).click();
    await sendCoworkPrompt(
      page,
      'Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "support project write".',
    );
    await approveFirstPendingAction(page);
    await expect(page.locator('p', { hasText: 'append_file â€¢ ok' }).first()).toBeVisible({ timeout: 30000 });

    const afterSecondWrite = await page.evaluate(async ({ docsRoot, supportRoot }) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) {
        throw new Error('Desktop bridge is unavailable for verification.');
      }

      const relPath = 'relay-e2e/mock-approval.txt';
      const docs = await bridge.existsInFolder(docsRoot, relPath);
      const support = await bridge.existsInFolder(supportRoot, relPath);
      return {
        docs: docs.exists,
        support: support.exists,
      };
    }, roots);

    expect(afterSecondWrite.docs).toBeTruthy();
    expect(afterSecondWrite.support).toBeTruthy();
  });

  test('realistic flow: one project executes a multi-task sprint with approvals', async () => {
    const project = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for multi-task sprint setup.');
      }

      const downloads = await bridge.getDownloadsPath();
      const runTag = Date.now();
      const folderName = `relay-product-launch-${runTag}`;
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${folderName}`;

      await bridge.createFileInFolder(downloads, `${folderName}/README.md`, '# Product Launch Sprint\n', true);

      return {
        root,
        folderName,
      };
    });

    const projectTitle = 'Product Launch Sprint';
    await createProjectFromSidebar(page, {
      title: projectTitle,
      description: 'Coordinate launch planning, QA checks, and status updates.',
      rootFolder: project.root,
    });

    const tasks = [
      {
        relPath: 'plans/sprint-brief.md',
        content: 'Task 1: defined sprint brief with goals and scope.',
      },
      {
        relPath: 'plans/qa-checklist.md',
        content: 'Task 2: prepared QA checklist for release validation.',
      },
      {
        relPath: 'reports/day-1-status.md',
        content: 'Task 3: logged day one launch status and blockers.',
      },
    ];

    for (const [index, task] of tasks.entries()) {
      await sendCoworkPrompt(
        page,
        `Sprint task ${index + 1}: Return one relay_actions append_file action for ${task.relPath} with content "${task.content}".`,
      );

      const { approvalCard } = await waitForFirstApproval(page);
      await expect(approvalCard.getByText(`Project: ${projectTitle}`)).toBeVisible();

      await approveFirstPendingAction(page);
      await expect(page.locator('p', { hasText: 'append_file â€¢ ok' }).first()).toBeVisible({ timeout: 30000 });
    }

    const verification = await page.evaluate(async ({ root, tasks }) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder || !bridge.readFileInFolder) {
        throw new Error('Desktop bridge is unavailable for multi-task sprint verification.');
      }

      const results = [] as Array<{ relPath: string; exists: boolean; content: string }>;

      for (const task of tasks) {
        const existsResult = await bridge.existsInFolder(root, task.relPath);
        const content = existsResult.exists ? (await bridge.readFileInFolder(root, task.relPath)).content : '';

        results.push({
          relPath: task.relPath,
          exists: existsResult.exists,
          content,
        });
      }

      return results;
    }, { root: project.root, tasks });

    for (const result of verification) {
      const expectedTask = tasks.find((task) => task.relPath === result.relPath);
      expect(expectedTask).toBeDefined();
      expect(result.exists).toBeTruthy();
      expect(result.content).toContain(expectedTask?.content ?? '');
    }
  });

  test('realistic flow: one rejected task does not write while approved tasks persist', async () => {
    const project = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for mixed approval sprint setup.');
      }

      const downloads = await bridge.getDownloadsPath();
      const runTag = Date.now();
      const folderName = `relay-release-ops-${runTag}`;
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${folderName}`;

      await bridge.createFileInFolder(downloads, `${folderName}/README.md`, '# Release Ops Sprint\n', true);

      return {
        root,
      };
    });

    const projectTitle = 'Release Ops Sprint';
    await createProjectFromSidebar(page, {
      title: projectTitle,
      description: 'Test mixed approval outcomes in a realistic project sprint.',
      rootFolder: project.root,
    });

    const tasks = [
      {
        relPath: 'plans/release-brief.md',
        content: 'Task A: release brief approved and persisted.',
        shouldApprove: true,
      },
      {
        relPath: 'plans/rejected-risky-change.md',
        content: 'Task B: this content should never be written due to rejection.',
        shouldApprove: false,
      },
      {
        relPath: 'reports/release-status.md',
        content: 'Task C: release status approved and persisted.',
        shouldApprove: true,
      },
    ];

    for (const [index, task] of tasks.entries()) {
      await sendCoworkPrompt(
        page,
        `Sprint task ${index + 1}: Return one relay_actions append_file action for ${task.relPath} with content "${task.content}".`,
      );

      const { approvalCard, approvalId } = await waitForFirstApproval(page);
      await expect(approvalCard.getByText(`Project: ${projectTitle}`)).toBeVisible();

      if (task.shouldApprove) {
        await page.getByTestId(`pending-approval-approve-${approvalId}`).click();
        await expect(approvalCard).toHaveCount(0);
        await expect(page.locator('p', { hasText: 'append_file â€¢ ok' }).first()).toBeVisible({ timeout: 30000 });
      } else {
        const rejectReason = page.getByTestId(`pending-approval-reason-${approvalId}`);
        const rejectButton = page.getByTestId(`pending-approval-reject-${approvalId}`);

        await expect(rejectButton).toBeDisabled();
        await rejectReason.fill('Rejected by operator during mixed sprint E2E.');
        await expect(rejectButton).toBeEnabled();
        await rejectButton.click();
        await expect(approvalCard).toHaveCount(0);
        await expect(page.locator('p', { hasText: 'append_file â€¢ error' }).first()).toBeVisible({ timeout: 30000 });
      }
    }

    const verification = await page.evaluate(async ({ root, tasks }) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder || !bridge.readFileInFolder) {
        throw new Error('Desktop bridge is unavailable for mixed sprint verification.');
      }

      const results = [] as Array<{ relPath: string; shouldApprove: boolean; exists: boolean; content: string }>;

      for (const task of tasks) {
        const existsResult = await bridge.existsInFolder(root, task.relPath);
        const content = existsResult.exists ? (await bridge.readFileInFolder(root, task.relPath)).content : '';

        results.push({
          relPath: task.relPath,
          shouldApprove: task.shouldApprove,
          exists: existsResult.exists,
          content,
        });
      }

      return results;
    }, { root: project.root, tasks });

    for (const result of verification) {
      const expectedTask = tasks.find((task) => task.relPath === result.relPath);
      expect(expectedTask).toBeDefined();

      if (result.shouldApprove) {
        expect(result.exists).toBeTruthy();
        expect(result.content).toContain(expectedTask?.content ?? '');
      } else {
        expect(result.exists).toBeFalsy();
        expect(result.content).toBe('');
      }
    }
  });

  test('task queue statuses reflect approval and rejection outcomes', async () => {
    const project = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for task queue status setup.');
      }

      const downloads = await bridge.getDownloadsPath();
      const runTag = Date.now();
      const folderName = `relay-task-queue-status-${runTag}`;
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${folderName}`;

      await bridge.createFileInFolder(downloads, `${folderName}/README.md`, '# Task Queue Status\n', true);

      return {
        root,
      };
    });

    await createProjectFromSidebar(page, {
      title: 'Task Queue Status Project',
      description: 'Verify task queue status transitions for approvals and rejections.',
      rootFolder: project.root,
    });

    await expect(page.getByTestId('project-tasks-card')).toBeVisible();

    const approvedPrompt = 'QUEUE-STATUS-APPROVED: Return one relay_actions append_file action for queue/approved.md with content "approved task".';
    await sendCoworkPrompt(page, approvedPrompt);

    const approvedTaskItem = page.locator('[data-testid^="project-task-"]', {
      hasText: 'QUEUE-STATUS-APPROVED',
    }).first();
    await expect(approvedTaskItem).toBeVisible({ timeout: 20000 });
    await expect(approvedTaskItem).toContainText(/needs approval|running/i);

    const { approvalCard: approvedCard, approvalId: approvedApprovalId } = await waitForFirstApproval(page);
    await page.getByTestId(`pending-approval-approve-${approvedApprovalId}`).click();
    await expect(approvedCard).toHaveCount(0);
    await expect(page.locator('p', { hasText: 'append_file â€¢ ok' }).first()).toBeVisible({ timeout: 30000 });
    await expect(approvedTaskItem).toContainText(/completed/i);

    const rejectedPrompt = 'QUEUE-STATUS-REJECTED: Return one relay_actions append_file action for queue/rejected.md with content "rejected task".';
    await sendCoworkPrompt(page, rejectedPrompt);

    const rejectedTaskItem = page.locator('[data-testid^="project-task-"]', {
      hasText: 'QUEUE-STATUS-REJECTED',
    }).first();
    await expect(rejectedTaskItem).toBeVisible({ timeout: 20000 });
    await expect(rejectedTaskItem).toContainText(/needs approval|running/i);

    const { approvalCard: rejectedCard, approvalId: rejectedApprovalId } = await waitForFirstApproval(page);
    const rejectReason = page.getByTestId(`pending-approval-reason-${rejectedApprovalId}`);
    await rejectReason.fill('Reject queue status task in E2E.');
    await page.getByTestId(`pending-approval-reject-${rejectedApprovalId}`).click();
    await expect(rejectedCard).toHaveCount(0);
    await expect(page.locator('p', { hasText: 'append_file â€¢ error' }).first()).toBeVisible({ timeout: 30000 });
    await expect(rejectedTaskItem).toContainText(/failed|rejected/i);

    const fileCheck = await page.evaluate(async (root) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) {
        throw new Error('Desktop bridge is unavailable for queue status verification.');
      }

      const approved = await bridge.existsInFolder(root, 'queue/approved.md');
      const rejected = await bridge.existsInFolder(root, 'queue/rejected.md');

      return {
        approved: approved.exists,
        rejected: rejected.exists,
      };
    }, project.root);

    expect(fileCheck.approved).toBeTruthy();
    expect(fileCheck.rejected).toBeFalsy();
  });

  test('long realistic flow: multi-project operations week with mixed outcomes and persistence', async () => {
    test.setTimeout(240000);

    const roots = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for long realistic setup.');
      }

      const downloads = await bridge.getDownloadsPath();
      const runTag = Date.now();
      const opsFolder = `relay-ops-week-${runTag}`;
      const supportFolder = `relay-support-week-${runTag}`;
      const opsRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${opsFolder}`;
      const supportRoot = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${supportFolder}`;

      await bridge.createFileInFolder(downloads, `${opsFolder}/README.md`, '# Ops Week\n', true);
      await bridge.createFileInFolder(downloads, `${supportFolder}/README.md`, '# Support Week\n', true);

      return {
        opsRoot,
        supportRoot,
      };
    });

    await createProjectFromSidebar(page, {
      title: 'Ops Week Project',
      description: 'Daily operations planning and reporting.',
      rootFolder: roots.opsRoot,
    });

    await createProjectFromSidebar(page, {
      title: 'Support Week Project',
      description: 'Support escalations and customer follow-up.',
      rootFolder: roots.supportRoot,
    });

    await page.locator('button[data-slot="sidebar-menu-button"]', { hasText: 'Ops Week Project' }).click();

    const runCoworkTask = async (args: {
      tag: string;
      prompt: string;
      expectsApproval: boolean;
      approve?: boolean;
      rejectReason?: string;
      expectedStatusPattern: RegExp;
    }) => {
      await sendCoworkPrompt(page, args.prompt);

      const taskItem = page.locator('[data-testid^="project-task-"]', { hasText: args.tag }).first();
      await expect(taskItem).toBeVisible({ timeout: 25000 });

      if (args.expectsApproval) {
        const { approvalCard, approvalId } = await waitForFirstApproval(page, 30000);

        if (args.approve === false) {
          const reason = args.rejectReason || 'Rejected by long realistic E2E flow.';
          const rejectReasonInput = page.getByTestId(`pending-approval-reason-${approvalId}`);
          const rejectButton = page.getByTestId(`pending-approval-reject-${approvalId}`);
          await rejectReasonInput.fill(reason);
          await expect(rejectButton).toBeEnabled();
          await rejectButton.click();
          await expect(approvalCard).toHaveCount(0);
          await expect(page.locator('p', { hasText: 'append_file â€¢ error' }).first()).toBeVisible({ timeout: 30000 });
        } else {
          await page.getByTestId(`pending-approval-approve-${approvalId}`).click();
          await expect(approvalCard).toHaveCount(0);
          await expect(page.locator('p', { hasText: 'append_file â€¢ ok' }).first()).toBeVisible({ timeout: 30000 });
        }
      } else {
        await expect(page.locator('[data-testid^="pending-approval-"]')).toHaveCount(0, { timeout: 15000 });
      }

      await expect(taskItem).toContainText(args.expectedStatusPattern, { timeout: 30000 });
    };

    await runCoworkTask({
      tag: 'LONG-OPS-A1',
      prompt: 'LONG-OPS-A1: Return one relay_actions append_file action for ops/day1-plan.md with content "day1 plan approved".',
      expectsApproval: true,
      approve: true,
      expectedStatusPattern: /completed/i,
    });

    await runCoworkTask({
      tag: 'LONG-OPS-A2',
      prompt: 'LONG-OPS-A2: Return one relay_actions append_file action for ops/day1-standup.md with content "standup notes approved".',
      expectsApproval: true,
      approve: true,
      expectedStatusPattern: /completed/i,
    });

    await runCoworkTask({
      tag: 'LONG-OPS-A3',
      prompt: 'LONG-OPS-A3: Return one relay_actions append_file action for ops/risky-change.md with content "this must be rejected".',
      expectsApproval: true,
      approve: false,
      rejectReason: 'Risky change rejected in long realistic E2E.',
      expectedStatusPattern: /failed|rejected/i,
    });

    await runCoworkTask({
      tag: 'LONG-OPS-A4',
      prompt: 'LONG-OPS-A4: Provide a plain text operations summary only. Do not return relay_actions or JSON.',
      expectsApproval: true,
      approve: true,
      expectedStatusPattern: /completed/i,
    });

    await runCoworkTask({
      tag: 'LONG-OPS-A5',
      prompt: 'LONG-OPS-A5: Return one relay_actions append_file action for reports/day1-closeout.md with content "closeout approved".',
      expectsApproval: true,
      approve: true,
      expectedStatusPattern: /completed/i,
    });

    await page.locator('button[data-slot="sidebar-menu-button"]', { hasText: 'Support Week Project' }).click();

    await runCoworkTask({
      tag: 'LONG-OPS-B1',
      prompt: 'LONG-OPS-B1: Return one relay_actions append_file action for support/escalation-log.md with content "escalation logged".',
      expectsApproval: true,
      approve: true,
      expectedStatusPattern: /completed/i,
    });

    const fileCheck = await page.evaluate(async ({ opsRoot, supportRoot }) => {
      const bridge = window.relay;
      if (!bridge?.existsInFolder) {
        throw new Error('Desktop bridge is unavailable for long realistic verification.');
      }

      const checks = {
        opsPlan: await bridge.existsInFolder(opsRoot, 'ops/day1-plan.md'),
        opsStandup: await bridge.existsInFolder(opsRoot, 'ops/day1-standup.md'),
        opsRisky: await bridge.existsInFolder(opsRoot, 'ops/risky-change.md'),
        opsCloseout: await bridge.existsInFolder(opsRoot, 'reports/day1-closeout.md'),
        supportEscalation: await bridge.existsInFolder(supportRoot, 'support/escalation-log.md'),
      };

      return {
        opsPlan: checks.opsPlan.exists,
        opsStandup: checks.opsStandup.exists,
        opsRisky: checks.opsRisky.exists,
        opsCloseout: checks.opsCloseout.exists,
        supportEscalation: checks.supportEscalation.exists,
      };
    }, roots);

    expect(fileCheck.opsPlan).toBeTruthy();
    expect(fileCheck.opsStandup).toBeTruthy();
    expect(fileCheck.opsRisky).toBeFalsy();
    expect(fileCheck.opsCloseout).toBeTruthy();
    expect(fileCheck.supportEscalation).toBeTruthy();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.locator('button[data-slot="sidebar-menu-button"]', { hasText: 'Ops Week Project' }).click();
    await expect(page.getByTestId('project-tasks-card')).toContainText('LONG-OPS-A1');
    await expect(page.getByTestId('project-tasks-card')).toContainText('LONG-OPS-A3');

    await page.locator('button[data-slot="sidebar-menu-button"]', { hasText: 'Support Week Project' }).click();
    await expect(page.getByTestId('project-tasks-card')).toContainText('LONG-OPS-B1');
  });

  test('projects can be renamed and deleted from sidebar with persistence', async () => {
    const workspaceRoot = await page.evaluate(async () => {
      const bridge = window.relay;
      if (!bridge?.getDownloadsPath || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge is unavailable for rename/delete setup.');
      }

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

    await page.locator('button[data-slot="sidebar-menu-button"]', { hasText: 'Ops Inbox' }).hover();
    await page.getByTitle('Rename project Ops Inbox').click();
    await page.getByPlaceholder('Project title').fill('Ops Inbox Renamed');
    await page.getByPlaceholder('Description (optional)').fill('Renamed for operations triage.');
    await page.getByTestId('rename-project-confirm').click();

    await expect(page.getByRole('button', { name: /^Ops Inbox Renamed$/, exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ops Inbox$/, exact: false })).toHaveCount(0);

    await page.getByRole('button', { name: /^Ops Inbox Renamed$/, exact: false }).hover();
    await page.getByTitle('Delete project Ops Inbox Renamed').click();
    await page.getByTestId('delete-project-confirm').click();

    await expect(page.getByRole('button', { name: /^Ops Inbox Renamed$/, exact: false })).toHaveCount(0);
    await expect(page.getByText('No projects yet')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('No projects yet')).toBeVisible();

    const persistedProjects = await page.evaluate((projectsKey) => {
      const raw = localStorage.getItem(projectsKey);
      if (!raw) {
        return [] as Array<{ id: string; name: string }>;
      }
      try {
        return JSON.parse(raw) as Array<{ id: string; name: string }>;
      } catch {
        return [] as Array<{ id: string; name: string }>;
      }
    }, COWORK_PROJECTS_KEY);

    expect(persistedProjects).toHaveLength(0);
  });
});
