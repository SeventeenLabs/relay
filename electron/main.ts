import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';

type BackendMode = 'local' | 'vps' | 'custom';

type AppConfig = {
  mode: BackendMode;
  baseUrl: string;
};

type HealthCheckResult = {
  ok: boolean;
  status?: number;
  message: string;
};

const defaultConfig: AppConfig = {
  mode: 'local',
  baseUrl: 'http://127.0.0.1:3000',
};

const configPath = () => path.join(app.getPath('userData'), 'openclaw-config.json');

const isDev = !app.isPackaged;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;

    return {
      mode: parsed.mode ?? defaultConfig.mode,
      baseUrl: parsed.baseUrl ?? defaultConfig.baseUrl,
    };
  } catch {
    return defaultConfig;
  }
}

async function writeConfig(config: AppConfig): Promise<AppConfig> {
  const normalized = {
    mode: config.mode,
    baseUrl: config.baseUrl.trim().replace(/\/$/, ''),
  };

  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function runHealthCheck(baseUrl: string): Promise<HealthCheckResult> {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '');
  const candidates = ['/health', '/api/health', '/'];

  for (const candidate of candidates) {
    try {
      const response = await fetch(`${normalizedBaseUrl}${candidate}`);
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          message: `OpenClaw backend reachable at ${candidate}`,
        };
      }

      return {
        ok: false,
        status: response.status,
        message: `Backend responded with status ${response.status} at ${candidate}`,
      };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    message: 'Unable to reach the OpenClaw backend. Check the URL, port, and network path.',
  };
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#f4f3ee',
    title: 'OpenClawCowork',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setMenuBarVisibility(false);
  window.removeMenu();

  if (isDev) {
    const devUrl = 'http://localhost:5173';
    let lastError: unknown;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await window.loadURL(devUrl);
        window.webContents.openDevTools({ mode: 'detach' });
        return;
      } catch (error) {
        lastError = error;
        await delay(350);
      }
    }

    throw lastError;
  }

  await window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  ipcMain.handle('config:get', async () => readConfig());
  ipcMain.handle('config:save', async (_event, config: AppConfig) => writeConfig(config));
  ipcMain.handle('backend:health-check', async (_event, baseUrl: string) => runHealthCheck(baseUrl));
  ipcMain.handle('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });
  ipcMain.handle('window:is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return Boolean(window?.isMaximized());
  });
  ipcMain.handle('window:show-system-menu', (event, position: { x: number; y: number }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    const menu = Menu.buildFromTemplate([
      {
        label: 'Restore',
        enabled: window.isMaximized(),
        click: () => window.unmaximize(),
      },
      {
        label: 'Minimize',
        click: () => window.minimize(),
      },
      {
        label: window.isMaximized() ? 'Unmaximize' : 'Maximize',
        click: () => {
          if (window.isMaximized()) {
            window.unmaximize();
            return;
          }
          window.maximize();
        },
      },
      { type: 'separator' },
      {
        label: 'Close',
        click: () => window.close(),
      },
    ]);

    menu.popup({
      window,
      x: Math.round(position.x),
      y: Math.round(position.y),
    });
  });
  ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
  });

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});