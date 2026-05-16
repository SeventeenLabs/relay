import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import './types';

let app: ElectronApplication;
let window: Page;

test.beforeEach(async () => {
  app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_ENABLE_LOGGING: '1',
      PLAYWRIGHT_TEST: '1',
    },
  });

  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.evaluate(async () => {
    const relay = window.relay;
    if (!relay) throw new Error('window.relay bridge unavailable');

    const cfg = await relay.loadConfig();
    await relay.saveConfig({
      ...cfg,
      backendType: 'hermes',
      transport: 'hermes_acp_stdio',
      gatewayUrl: 'ssh://localhost',
    });
  });
});

test.afterEach(async () => {
  if (app) {
    try {
      await app.close();
    } catch {
      // no-op for failed launch/close in CI
    }
  }
});

test('cowork selectors render stable labels and reasoning value updates', async () => {
  await window.getByRole('button', { name: /cowork/i }).click().catch(() => {});

  const modelLabel = window.getByTestId('cowork-model-label');
  await expect(modelLabel).toBeVisible();

  const reasoningValue = window.getByTestId('cowork-reasoning-value');
  await expect(reasoningValue).toHaveText(/Low|Medium|High/);

  await window.getByRole('button', { name: /Reasoning/i }).click();
  await window.getByRole('menuitem', { name: 'High' }).click();
  await expect(reasoningValue).toHaveText('High');

  await window.getByRole('button', { name: /Reasoning/i }).click();
  await window.getByRole('menuitem', { name: 'Low' }).click();
  await expect(reasoningValue).toHaveText('Low');

  await expect(modelLabel).not.toHaveText(/Loading models\.\.\./);
});
