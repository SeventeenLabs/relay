import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const ONBOARDING_COMPLETE_KEY = 'relay.onboarding.complete';
const USAGE_MODE_KEY = 'relay.usage.mode';
const RELAY_RECENTS_KEY = 'relay.recents.v1';
const COWORK_PROJECTS_KEY = 'relay.cowork.projects.v1';
const COWORK_ACTIVE_PROJECT_KEY = 'relay.cowork.projects.active.v1';
const USE_REAL_GATEWAY = process.env.RELAY_E2E_REAL_GATEWAY === '1';

test.describe.configure({ timeout: USE_REAL_GATEWAY ? 180000 : 120000 });

function pendingApprovalCards(page: Page) {
  return page.getByTestId(/^pending-approval-(?!s-card$)(?!approve-)(?!reject-)(?!reason-).+/);
}

async function sendCoworkPrompt(page: Page, prompt: string) {
  const promptInput = page.locator('[aria-label="Task prompt"]:visible').first();
  await expect(promptInput).toBeVisible();
  await promptInput.fill(prompt);

  const sendButton = page.locator('[aria-label="Send task"]:visible').first();
  if (await sendButton.isDisabled()) {
    const firstProject = page.locator('[data-testid^="project-select-"]').first();
    if (await firstProject.count()) {
      await firstProject.click();
    }
  }

  await sendButton.click();
}

async function waitForFirstApproval(page: Page, timeout = 20000) {
  const approvalCard = pendingApprovalCards(page).first();
  await expect(approvalCard).toBeVisible({ timeout });

  const approvalTestIdAttr = (await approvalCard.getAttribute('data-testid')) || '';
  const approvalId = approvalTestIdAttr.replace('pending-approval-', '');
  expect(approvalId).not.toBe('');

  return { approvalCard, approvalId };
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

async function seedActiveE2EProject(page: Page) {
  await page.evaluate(async ([projectsKey, activeKey]) => {
    const bridge = window.relay;
    const downloadsPath = (await bridge?.getDownloadsPath?.()) || '/Downloads';
    const now = Date.now();
    const project = {
      id: 'e2e-project-default',
      name: 'E2E Default Project',
      workspaceFolder: downloadsPath,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem(projectsKey, JSON.stringify([project]));
    localStorage.setItem(activeKey, project.id);
  }, [COWORK_PROJECTS_KEY, COWORK_ACTIVE_PROJECT_KEY]);
}

test.describe('Cowork approval flow', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await electron.launch({
      args: ['.'],
    });

    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(([onboardingKey, usageModeKey, recentsKey]) => {
      localStorage.setItem(onboardingKey, 'true');
      localStorage.setItem(usageModeKey, 'guest');
      localStorage.removeItem(recentsKey);
      sessionStorage.clear();
    }, [ONBOARDING_COMPLETE_KEY, USAGE_MODE_KEY, RELAY_RECENTS_KEY]);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    if (!USE_REAL_GATEWAY) {
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
      await seedActiveE2EProject(page);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await ensureE2ESafetyPolicy(page);
    } else {
      await page.evaluate(async () => {
        if (!window.relay?.saveConfig) {
          return;
        }

        const raw = localStorage.getItem('relay.config');
        if (!raw) {
          return;
        }

        try {
          const parsed = JSON.parse(raw) as { gatewayUrl?: string; gatewayToken?: string };
          const gatewayUrl = typeof parsed.gatewayUrl === 'string' ? parsed.gatewayUrl.trim() : '';
          const gatewayToken = typeof parsed.gatewayToken === 'string' ? parsed.gatewayToken : '';
          if (!gatewayUrl) {
            return;
          }

          await window.relay.saveConfig({
            gatewayUrl,
            gatewayToken,
          });
        } catch {
          // Ignore malformed local fallback config.
        }
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await seedActiveE2EProject(page);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await ensureE2ESafetyPolicy(page);
    }
  });

  test.afterEach(async () => {
    await app.close();
  });

  if (USE_REAL_GATEWAY) {
    test('real gateway: operator can approve a live relay_actions request', async () => {
      await page.getByPlaceholder('How can I help you today?').fill(
        'Return ONLY one JSON code block with relay_actions containing exactly one append_file action for path relay-e2e/mock-approval.txt and content "line from real gateway". No prose.',
      );
      await page.locator('[aria-label="Send task"]:visible').first().click();

      const { approvalCard, approvalId } = await waitForFirstApproval(page, 90000);

      await page.getByTestId(`pending-approval-approve-${approvalId}`).click();
      await expect(approvalCard).toHaveCount(0);

      await expect(page.getByText(/Done\.\s+append_file\s+.*mock-approval\.txt/i)).toBeVisible({ timeout: 45000 });
    });
  } else {
    test('mock gateway: operator can reject then approve requests from live chat events', async () => {
      await sendCoworkPrompt(
        page,
        'Run 1: Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "line from run 1".',
      );

      const { approvalCard, approvalId } = await waitForFirstApproval(page);

      const rejectReason = page.getByTestId(`pending-approval-reason-${approvalId}`);
      const rejectButton = page.getByTestId(`pending-approval-reject-${approvalId}`);
      await rejectReason.fill('Operator rejected via E2E');
      await expect(rejectButton).toBeEnabled();
      await rejectButton.click();
      await expect(approvalCard).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Appended failed:\s+relay-e2e\/mock-approval\.txt/i })).toBeVisible();

      await sendCoworkPrompt(
        page,
        'Run 2: Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "line from run 2".',
      );

      const { approvalCard: approvalCard2, approvalId: approvalId2 } = await waitForFirstApproval(page);
      await page.getByTestId(`pending-approval-approve-${approvalId2}`).click();
      await expect(approvalCard2).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Appended:\s+.*mock-approval\.txt/i })).toBeVisible();
    });

    test('mock gateway: reject stays disabled until reason is provided and approved action writes file content', async () => {
      await sendCoworkPrompt(
        page,
        'Run 3: Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "line from run 3".',
      );

      const { approvalCard, approvalId } = await waitForFirstApproval(page);
      const rejectButton = page.getByTestId(`pending-approval-reject-${approvalId}`);
      await expect(rejectButton).toBeDisabled();

      await page.getByTestId(`pending-approval-approve-${approvalId}`).click();
      await expect(approvalCard).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Appended:\s+.*mock-approval\.txt/i })).toBeVisible();

      const fileContent = await page.evaluate(async () => {
        const bridge = window.relay;
        if (!bridge?.getDownloadsPath || !bridge.readFileInFolder) {
          return '';
        }

        const root = await bridge.getDownloadsPath();
        const read = await bridge.readFileInFolder(root, 'relay-e2e/mock-approval.txt');
        return read.content;
      });

      expect(fileContent).toContain('line from run 3');
    });

    test('mock gateway: disabled file-modify policy blocks append without approval card', async () => {
      await page.evaluate(() => {
        const activeProjectId = (localStorage.getItem('relay.cowork.projects.active.v1') || '').trim();
        const scopedKey = activeProjectId ? `relay.safety.scopes.project.${activeProjectId}` : 'relay.safety.scopes';
        const raw = localStorage.getItem(scopedKey) || localStorage.getItem('relay.safety.scopes');

        const scopes = (raw ? JSON.parse(raw) : []) as Array<{
          id: string;
          name?: string;
          description?: string;
          riskLevel?: 'low' | 'medium' | 'high' | 'critical';
          enabled: boolean;
          requiresApproval: boolean;
        }>;

        let next = scopes.map((scope) =>
          scope.id === 'file-modify'
            ? {
                ...scope,
                enabled: false,
                requiresApproval: false,
              }
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
              enabled: false,
              requiresApproval: false,
            },
          ];
        }

        localStorage.setItem('relay.safety.scopes', JSON.stringify(next));
        if (activeProjectId) {
          localStorage.setItem(scopedKey, JSON.stringify(next));
        }
      });

      await sendCoworkPrompt(
        page,
        'Run 4: Return one relay_actions append_file action for relay-e2e/mock-approval.txt with content "line from run 4".',
      );

      await expect(pendingApprovalCards(page)).toHaveCount(0, { timeout: 12000 });
      await expect(page.getByRole('button', { name: /Appended failed:\s+relay-e2e\/mock-approval\.txt/i })).toBeVisible({ timeout: 20000 });
    });
  }
});
