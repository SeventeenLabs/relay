import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const ONBOARDING_COMPLETE_KEY = 'relay.onboarding.complete';
const USAGE_MODE_KEY = 'relay.usage.mode';

test.describe.configure({ timeout: 120000 });

test.describe('Local file ops hardening', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await electron.launch({ args: ['.'] });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(([onboardingKey, usageModeKey]) => {
      localStorage.setItem(onboardingKey, 'true');
      localStorage.setItem(usageModeKey, 'guest');
      sessionStorage.clear();
    }, [ONBOARDING_COMPLETE_KEY, USAGE_MODE_KEY]);
  });

  test.afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  test('local bridge rejects windows absolute path strings for file reads', async () => {
    const result = await page.evaluate(async () => {
      const bridge = (window as unknown as { relay?: {
        getDownloadsPath?: () => Promise<string>;
        createFileInFolder?: (rootPath: string, relativePath: string, content: string, overwrite?: boolean) => Promise<unknown>;
        readFileInFolder?: (rootPath: string, relativePath: string) => Promise<{ content: string }>;
        listDirInFolder?: (rootPath: string, relativePath?: string) => Promise<unknown>;
      } }).relay;
      if (!bridge?.getDownloadsPath || !bridge.readFileInFolder || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge unavailable.');
      }

      const downloads = await bridge.getDownloadsPath();
      const rootName = `relay-local-file-ops-${Date.now()}`;
      await bridge.createFileInFolder(downloads, `${rootName}/seed.txt`, 'seed', true);
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${rootName}`;

      try {
        await bridge.readFileInFolder(root, 'C:\\Windows\\System32\\drivers\\etc\\hosts');
        return { ok: true, message: '' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message };
      }
    });

    expect(result.ok).toBeFalsy();
    expect(result.message.toLowerCase()).toContain('relative');
  });

  test('local bridge rejects windows absolute path strings for list dir', async () => {
    const result = await page.evaluate(async () => {
      const bridge = (window as unknown as { relay?: {
        getDownloadsPath?: () => Promise<string>;
        createFileInFolder?: (rootPath: string, relativePath: string, content: string, overwrite?: boolean) => Promise<unknown>;
        readFileInFolder?: (rootPath: string, relativePath: string) => Promise<{ content: string }>;
        listDirInFolder?: (rootPath: string, relativePath?: string) => Promise<unknown>;
      } }).relay;
      if (!bridge?.getDownloadsPath || !bridge.listDirInFolder || !bridge.createFileInFolder) {
        throw new Error('Desktop bridge unavailable.');
      }

      const downloads = await bridge.getDownloadsPath();
      const rootName = `relay-local-list-${Date.now()}`;
      await bridge.createFileInFolder(downloads, `${rootName}/seed.txt`, 'seed', true);
      const root = `${downloads}${downloads.endsWith('\\') ? '' : '\\'}${rootName}`;

      try {
        await bridge.listDirInFolder(root, 'D:\\private');
        return { ok: true, message: '' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message };
      }
    });

    expect(result.ok).toBeFalsy();
    expect(result.message.toLowerCase()).toContain('relative');
  });
});
