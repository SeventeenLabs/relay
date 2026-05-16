import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { RelayWindowBridge } from './types';

test.describe('transport config persistence parity', () => {
  let app: ElectronApplication;
  let page: Page;

  const getRelayBridge = (targetWindow: Window): RelayWindowBridge => {
    const relay = targetWindow.relay;
    if (!relay || !relay.saveConfig || !relay.getConfig) {
      throw new Error('Relay bridge unavailable');
    }
    return relay;
  };

  test.beforeEach(async () => {
    app = await electron.launch({
      args: ['.'],
    });

    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  test('preserves explicit hermes_http transport for ssh:// endpoints', async () => {
    const config = await page.evaluate(async ({ bridgeFactorySource }) => {
      const bridgeFactory = Function(`return (${bridgeFactorySource});`)() as (targetWindow: Window) => RelayWindowBridge;
      const relay = bridgeFactory(window);

      await relay.saveConfig({
        backendType: 'hermes',
        transport: 'hermes_http',
        gatewayUrl: 'ssh://user@example.com:22',
        gatewayToken: '',
      });

      return relay.getConfig();
    }, {
      bridgeFactorySource: getRelayBridge.toString(),
    });

    expect(config.transport).toBe('hermes_http');
    expect(config.gatewayUrl).toBe('ssh://user@example.com:22');
  });

  test('infers hermes_acp_stdio when transport is omitted for ssh:// endpoints', async () => {
    const config = await page.evaluate(async ({ bridgeFactorySource }) => {
      const bridgeFactory = Function(`return (${bridgeFactorySource});`)() as (targetWindow: Window) => RelayWindowBridge;
      const relay = bridgeFactory(window);

      await relay.saveConfig({
        backendType: 'hermes',
        gatewayUrl: 'ssh://user@example.com:22',
        gatewayToken: '',
      });

      return relay.getConfig();
    }, {
      bridgeFactorySource: getRelayBridge.toString(),
    });

    expect(config.transport).toBe('hermes_acp_stdio');
  });
});
