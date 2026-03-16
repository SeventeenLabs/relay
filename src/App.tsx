import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import type { AppConfig, BackendMode, HealthCheckResult } from './app-types';
import { AppSidebar } from './components/layout/app-sidebar';
import { AppTitlebar } from './components/layout/app-titlebar';
import { SidebarProvider } from './components/ui/sidebar';
import { ScrollArea } from './components/ui/scroll-area';
import { ChatPage } from './pages/chat-page';
import { CoworkPage } from './pages/cowork-page';
import { SettingsPage } from './pages/settings-page';

const presetUrls: Record<BackendMode, string> = {
  local: 'http://127.0.0.1:3000',
  vps: 'https://your-openclaw-vps.example.com',
  custom: '',
};

type AppPage = 'chat' | 'cowork' | 'settings';

export default function App() {
  const bridge = window.openClawCowork;
  const hasBridge = Boolean(bridge);

  const [config, setConfig] = useState<AppConfig>({ mode: 'local', baseUrl: presetUrls.local });
  const [draftUrl, setDraftUrl] = useState(presetUrls.local);
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [status, setStatus] = useState('Loading configuration...');

  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [activeMenuItem, setActiveMenuItem] = useState('New task');
  const [activePage, setActivePage] = useState<AppPage>('cowork');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [workingFolder, setWorkingFolder] = useState('/Downloads');
  const [taskState, setTaskState] = useState<'idle' | 'planned'>('idle');
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!bridge) {
      setStatus('Electron bridge unavailable. Run this UI inside the desktop app to enable saved config and health checks.');
      return;
    }

    let cancelled = false;

    bridge
      .getConfig()
      .then((storedConfig) => {
        if (cancelled) {
          return;
        }

        setConfig(storedConfig);
        setDraftUrl(storedConfig.baseUrl);
        setStatus('Configuration loaded.');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('Unable to load config. Using defaults.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.isWindowMaximized) {
      return;
    }

    bridge
      .isWindowMaximized()
      .then((value) => setIsMaximized(value))
      .catch(() => {
        setIsMaximized(false);
      });
  }, [bridge]);

  const handleModeChange = (mode: BackendMode) => {
    setConfig((current) => ({
      ...current,
      mode,
      baseUrl: mode === 'custom' ? current.baseUrl : presetUrls[mode],
    }));
    setDraftUrl((current) => (mode === 'custom' ? current : presetUrls[mode]));
    setHealth(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();

    if (!bridge) {
      setConfig((current) => ({ ...current, baseUrl: draftUrl }));
      setStatus('Bridge unavailable. Applied URL only for this session.');
      return;
    }

    setSaving(true);
    setStatus('Saving backend configuration...');

    try {
      const nextConfig: AppConfig = {
        mode: config.mode,
        baseUrl: draftUrl,
      };
      const savedConfig = await bridge.saveConfig(nextConfig);
      setConfig(savedConfig);
      setDraftUrl(savedConfig.baseUrl);
      setStatus('Backend configuration saved.');
    } catch {
      setStatus('Failed to save backend configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleHealthCheck = async () => {
    if (!bridge) {
      setHealth({ ok: false, message: 'Bridge unavailable. Health checks require the Electron desktop runtime.' });
      setStatus('Bridge unavailable. Start OpenClawCowork via Electron to test backend connectivity.');
      return;
    }

    setChecking(true);
    setStatus('Checking backend health...');

    try {
      const result = await bridge.healthCheck(draftUrl);
      setHealth(result);
      setStatus(result.message);
    } catch {
      setHealth({ ok: false, message: 'Health check failed before a response was received.' });
      setStatus('Health check failed.');
    } finally {
      setChecking(false);
    }
  };

  const handlePlanTask = (event: FormEvent) => {
    event.preventDefault();

    if (!taskPrompt.trim()) {
      setStatus('Describe the outcome first so OpenClaw can plan the work.');
      return;
    }

    setTaskState('planned');
    setStatus('Plan drafted. Review and approve before execution.');
  };

  const handleMinimize = async () => {
    if (!bridge?.minimizeWindow) {
      setStatus('Window controls are available only in the Electron desktop app.');
      return;
    }

    try {
      await bridge.minimizeWindow();
    } catch {
      setStatus('Unable to minimize window.');
    }
  };

  const handleToggleMaximize = async () => {
    if (!bridge?.toggleMaximizeWindow) {
      setStatus('Window controls are available only in the Electron desktop app.');
      return;
    }

    try {
      const nextState = await bridge.toggleMaximizeWindow();
      setIsMaximized(nextState);
    } catch {
      setStatus('Unable to resize window.');
    }
  };

  const handleClose = async () => {
    if (bridge?.closeWindow) {
      try {
        await bridge.closeWindow();
        return;
      } catch {
        setStatus('Unable to close window from bridge.');
      }
    }

    window.close();
  };

  const handleShowSystemMenu = async (x: number, y: number) => {
    if (!bridge?.showSystemMenu) {
      return;
    }

    try {
      await bridge.showSystemMenu(x, y);
    } catch {
      setStatus('Unable to open system menu.');
    }
  };

  return (
    <div className="grid h-full grid-rows-[34px_minmax(0,1fr)] overflow-hidden">
      <AppTitlebar
        sidebarOpen={sidebarOpen}
        activePage={activePage}
        isMaximized={isMaximized}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onSelectPage={setActivePage}
        onMinimize={handleMinimize}
        onToggleMaximize={handleToggleMaximize}
        onClose={handleClose}
        onShowSystemMenu={handleShowSystemMenu}
      />

      <SidebarProvider
        className={`grid h-full overflow-hidden transition-[grid-template-columns] duration-200 ${
          sidebarOpen ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-[0px_minmax(0,1fr)]'
        }`}
      >
        <AppSidebar
          sidebarOpen={sidebarOpen}
          activeMenuItem={activeMenuItem}
          activePage={activePage}
          onSelectMenuItem={setActiveMenuItem}
          onOpenSettings={() => setActivePage('settings')}
        />

        <main className="relative min-h-0 overflow-hidden p-5">
          <ScrollArea className="h-full">
            {activePage === 'chat' && (
              <ChatPage taskPrompt={taskPrompt} onTaskPromptChange={setTaskPrompt} onSubmit={handlePlanTask} />
            )}

            {activePage === 'cowork' && (
              <CoworkPage
                taskPrompt={taskPrompt}
                workingFolder={workingFolder}
                taskState={taskState}
                onTaskPromptChange={setTaskPrompt}
                onWorkingFolderChange={setWorkingFolder}
                onSubmit={handlePlanTask}
              />
            )}

            {activePage === 'settings' && (
              <SettingsPage
                config={config}
                draftUrl={draftUrl}
                health={health}
                status={status}
                saving={saving}
                checking={checking}
                hasBridge={hasBridge}
                onModeChange={handleModeChange}
                onDraftUrlChange={setDraftUrl}
                onSave={handleSave}
                onHealthCheck={handleHealthCheck}
              />
            )}
          </ScrollArea>
        </main>
      </SidebarProvider>
    </div>
  );
}
