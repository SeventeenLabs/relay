import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type {
  AppConfig,
  ChatMessage,
  ChatModelOption,
  HealthCheckResult,
  LocalFilePlanAction,
  ScheduledJob,
} from './app-types';
import { AppSidebar } from './components/layout/app-sidebar';
import { AppTitlebar } from './components/layout/app-titlebar';
import { SidebarProvider } from './components/ui/sidebar';
import { ScrollArea } from './components/ui/scroll-area';
import { GatewayRequestError, OpenClawGatewayClient } from './lib/openclaw-gateway-client';
import { ChatPage } from './pages/chat-page';
import { CoworkPage } from './pages/cowork-page';
import { ScheduledPage } from './pages/scheduled-page';
import { SettingsPage } from './pages/settings-page';

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';

const DEFAULT_SESSION_KEY = 'main';
const LOCAL_CONFIG_KEY = 'relay.config';

const defaultConfig: AppConfig = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  gatewayToken: '',
};

type AppPage = 'chat' | 'cowork' | 'scheduled' | 'settings';

function extractChatText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const record = message as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) {
    return record.text;
  }
  if (typeof record.content === 'string' && record.content.trim()) {
    return record.content;
  }

  if (Array.isArray(record.content)) {
    const parts = record.content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }
        const part = item as Record<string, unknown>;
        if (part.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter((part) => part.length > 0);
    return parts.join('');
  }

  return '';
}

function extractChatRole(message: unknown): ChatMessage['role'] {
  if (!message || typeof message !== 'object') {
    return 'assistant';
  }

  const role = (message as Record<string, unknown>).role;
  return role === 'user' || role === 'assistant' || role === 'system' ? role : 'assistant';
}

export default function App() {
  const bridge = window.relay;
  const gatewayClientRef = useRef<OpenClawGatewayClient | null>(null);

  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [draftGatewayUrl, setDraftGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [draftGatewayToken, setDraftGatewayToken] = useState('');
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [status, setStatus] = useState('Loading configuration...');
  const [sendingChat, setSendingChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pairingRequestId, setPairingRequestId] = useState<string | null>(null);
  const [activeMenuItem, setActiveMenuItem] = useState('New task');
  const [activePage, setActivePage] = useState<AppPage>('cowork');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [workingFolder, setWorkingFolder] = useState('/Downloads');
  const [taskState, setTaskState] = useState<'idle' | 'planned'>('idle');
  const [localPlanActions, setLocalPlanActions] = useState<LocalFilePlanAction[]>([]);
  const [localPlanLoading, setLocalPlanLoading] = useState(false);
  const [localApplyLoading, setLocalApplyLoading] = useState(false);
  const [localPlanRootPath, setLocalPlanRootPath] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeSessionKey, setActiveSessionKey] = useState(DEFAULT_SESSION_KEY);
  const [chatModels, setChatModels] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);

  const ensureActiveSession = async (client: OpenClawGatewayClient) => {
    await client.connect({
      gatewayUrl: draftGatewayUrl,
      token: draftGatewayToken,
    });
    const sessionKey = await client.resolveSessionKey(activeSessionKey || DEFAULT_SESSION_KEY);
    setActiveSessionKey(sessionKey);
    return sessionKey;
  };

  const loadModelsForSession = async (client: OpenClawGatewayClient, sessionKey: string) => {
    setModelsLoading(true);
    try {
      const [choices, currentModel] = await Promise.all([
        client.listModels(),
        client.getSessionModel(sessionKey).catch(() => null),
      ]);

      setChatModels(choices.map((model) => ({ value: model.value, label: model.label })));
      setSelectedModel(currentModel ?? '');
    } catch {
      setChatModels([]);
      setSelectedModel('');
    } finally {
      setModelsLoading(false);
    }
  };

  const loadLocalConfig = () => {
    try {
      const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        gatewayUrl: parsed.gatewayUrl?.trim() || DEFAULT_GATEWAY_URL,
        gatewayToken: parsed.gatewayToken ?? '',
      } satisfies AppConfig;
    } catch {
      return null;
    }
  };

  const persistLocalConfig = (nextConfig: AppConfig) => {
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(nextConfig));
  };

  useEffect(() => {
    if (!bridge) {
      const localConfig = loadLocalConfig();
      if (localConfig) {
        setConfig(localConfig);
        setDraftGatewayUrl(localConfig.gatewayUrl);
        setDraftGatewayToken(localConfig.gatewayToken);
        setStatus('Loaded local configuration (bridge unavailable).');
      } else {
        setStatus('Electron bridge unavailable. Configuration will be saved locally for this browser profile.');
      }
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
        setDraftGatewayUrl(storedConfig.gatewayUrl);
        setDraftGatewayToken(storedConfig.gatewayToken);
        setStatus('Configuration loaded.');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        const localConfig = loadLocalConfig();
        if (localConfig) {
          setConfig(localConfig);
          setDraftGatewayUrl(localConfig.gatewayUrl);
          setDraftGatewayToken(localConfig.gatewayToken);
          setStatus('Loaded local fallback configuration.');
        } else {
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

  useEffect(() => {
    if (!bridge?.getDownloadsPath) {
      return;
    }

    let cancelled = false;
    bridge
      .getDownloadsPath()
      .then((downloadsPath) => {
        if (!cancelled && typeof downloadsPath === 'string' && downloadsPath.trim()) {
          setWorkingFolder(downloadsPath);
        }
      })
      .catch(() => {
        // keep existing default
      });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    const client = new OpenClawGatewayClient();
    client.setConnectionHandler((_connected, message) => {
      setStatus(message);
    });
    client.setEventHandler((event) => {
      if (event.type === 'event' && event.event === 'chat') {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const runId = typeof payload.runId === 'string' ? payload.runId : `evt-${Date.now()}`;
        const state = typeof payload.state === 'string' ? payload.state : 'final';
        const message = payload.message ?? payload;
        const text = extractChatText(message);
        const role = extractChatRole(message);

        if (state === 'error') {
          const errorMessage =
            typeof payload.errorMessage === 'string' && payload.errorMessage.trim()
              ? payload.errorMessage
              : 'Chat stream failed.';
          setStatus(errorMessage);
          return;
        }

        if (state === 'delta' && text) {
          const streamId = `stream-${runId}`;
          setChatMessages((current) => {
            const index = current.findIndex((entry) => entry.id === streamId);
            if (index >= 0) {
              const next = [...current];
              next[index] = { ...next[index], text, role };
              return next;
            }
            return [...current, { id: streamId, role, text }];
          });
          return;
        }

        if ((state === 'final' || state === 'aborted') && text) {
          const streamId = `stream-${runId}`;
          const finalId = `final-${runId}`;
          setChatMessages((current) => {
            const withoutStream = current.filter((entry) => entry.id !== streamId);
            if (withoutStream.some((entry) => entry.id === finalId)) {
              return withoutStream;
            }
            return [...withoutStream, { id: finalId, role, text }];
          });
        }
      }
    });

    gatewayClientRef.current = client;
    return () => {
      gatewayClientRef.current?.disconnect();
      gatewayClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activePage !== 'chat') {
      return;
    }

    let cancelled = false;
    const loadChatWindowData = async () => {
      const client = gatewayClientRef.current;
      if (!client) {
        return;
      }

      try {
        const sessionKey = await ensureActiveSession(client);
        const [history] = await Promise.all([
          client.getHistory(sessionKey, 30),
          loadModelsForSession(client, sessionKey),
        ]);

        if (!cancelled && history.length > 0) {
          setChatMessages(history);
        }
      } catch {
        // keep existing UI state until the user runs explicit health check
      }
    };

    void loadChatWindowData();
    return () => {
      cancelled = true;
    };
  }, [activePage]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();

    const nextConfig: AppConfig = {
      gatewayUrl: draftGatewayUrl.trim() || DEFAULT_GATEWAY_URL,
      gatewayToken: draftGatewayToken,
    };

    if (!bridge) {
      setConfig(nextConfig);
      persistLocalConfig(nextConfig);
      setStatus('Bridge unavailable. Configuration saved locally for this browser profile.');
      return;
    }

    setSaving(true);
    setStatus('Saving backend configuration...');

    try {
      const savedConfig = await bridge.saveConfig(nextConfig);
      setConfig(savedConfig);
      setDraftGatewayUrl(savedConfig.gatewayUrl);
      setDraftGatewayToken(savedConfig.gatewayToken);
      persistLocalConfig(savedConfig);
      setStatus('Backend configuration saved.');
    } catch {
      setStatus('Failed to save backend configuration.');
    } finally {
      setSaving(false);
    }
  };

  const readGatewayError = (error: unknown): { message: string; code?: string; requestId?: string } => {
    if (!(error instanceof Error)) {
      return { message: 'Gateway connection failed.' };
    }

    if (error instanceof GatewayRequestError) {
      const requestId =
        typeof error.details?.requestId === 'string'
          ? error.details.requestId
          : undefined;
      return {
        message: error.message,
        code: error.code,
        requestId,
      };
    }

    return { message: error.message || 'Gateway connection failed.' };
  };

  const handleHealthCheck = async () => {
    setChecking(true);
    setPairingRequestId(null);
    setStatus('Checking OpenClaw Gateway connection...');

    try {
      const client = gatewayClientRef.current;
      if (!client) {
        throw new Error('Gateway client not initialized.');
      }

      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      const sessionKey = await client.resolveSessionKey(activeSessionKey || DEFAULT_SESSION_KEY);
      setActiveSessionKey(sessionKey);
      void loadModelsForSession(client, sessionKey);

      setHealth({ ok: true, message: `Connected to ${draftGatewayUrl}` });
      setStatus('Gateway connection successful.');
    } catch (error) {
      const info = readGatewayError(error);
      if (info.code === 'PAIRING_REQUIRED') {
        setPairingRequestId(info.requestId ?? null);
        const approvalHint = info.requestId
          ? ` Approve with: openclaw devices approve ${info.requestId}`
          : ' Approve the pending request with: openclaw devices list then openclaw devices approve <requestId>.';
        setHealth({ ok: false, message: `Pairing required.${approvalHint}` });
        setStatus(`Pairing required.${approvalHint}`);
      } else {
        setHealth({ ok: false, message: info.message || 'Gateway connection failed. Check URL and token.' });
        setStatus(info.message || 'Gateway connection failed.');
      }
    } finally {
      setChecking(false);
    }
  };

  const handleRequestPairing = async () => {
    setChecking(true);
    setPairingRequestId(null);
    setStatus('Requesting device pairing from OpenClaw Gateway...');

    try {
      const client = gatewayClientRef.current;
      if (!client) {
        throw new Error('Gateway client not initialized.');
      }

      client.disconnect();
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      setHealth({ ok: true, message: `Connected to ${draftGatewayUrl}` });
      setStatus('Already paired and connected.');
    } catch (error) {
      const info = readGatewayError(error);
      if (info.code === 'PAIRING_REQUIRED') {
        setPairingRequestId(info.requestId ?? null);
        const approvalHint = info.requestId
          ? `openclaw devices approve ${info.requestId}`
          : 'openclaw devices list then openclaw devices approve <requestId>';
        setHealth({ ok: false, message: 'Pairing request created. Approve it on the gateway host.' });
        setStatus(`Pairing request created. Run: ${approvalHint}`);
      } else {
        setHealth({ ok: false, message: info.message || 'Unable to request pairing.' });
        setStatus(info.message || 'Unable to request pairing.');
      }
    } finally {
      setChecking(false);
    }
  };

  const handleResetPairing = async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setChecking(true);
    setPairingRequestId(null);
    setStatus('Resetting local device identity and requesting fresh pairing...');

    try {
      client.disconnect();
      const clientWithReset = client as OpenClawGatewayClient & {
        resetDeviceIdentity?: () => void;
      };
      if (typeof clientWithReset.resetDeviceIdentity === 'function') {
        clientWithReset.resetDeviceIdentity();
      } else {
        // Fallback for stale runtime instances that predate resetDeviceIdentity().
        localStorage.removeItem('openclaw-device-identity-v1');
      }
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });

      const sessionKey = await client.resolveSessionKey(activeSessionKey || DEFAULT_SESSION_KEY);
      setActiveSessionKey(sessionKey);
      setHealth({ ok: true, message: `Re-paired and connected to ${draftGatewayUrl}` });
      setStatus('Re-pair complete. If operator.admin is still missing, approve the new request with admin scope on the gateway host.');
    } catch (error) {
      const info = readGatewayError(error);
      if (info.code === 'PAIRING_REQUIRED') {
        setPairingRequestId(info.requestId ?? null);
        const approvalHint = info.requestId
          ? `openclaw devices approve ${info.requestId}`
          : 'openclaw devices list then openclaw devices approve <requestId>';
        setHealth({ ok: false, message: 'New pairing request created. Approve it with admin scope.' });
        setStatus(`New pairing request created. Approve with admin scope: ${approvalHint}`);
      } else {
        setHealth({ ok: false, message: info.message || 'Failed to reset pairing.' });
        setStatus(info.message || 'Failed to reset pairing.');
      }
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

  const handleCreateLocalPlan = async () => {
    if (!bridge?.planOrganizeFolder) {
      setStatus('Local file organizer is available in the Electron desktop app only.');
      return;
    }

    const rootPath = workingFolder.trim();
    if (!rootPath) {
      setStatus('Select a working folder first.');
      return;
    }

    setLocalPlanLoading(true);
    try {
      const plan = await bridge.planOrganizeFolder(rootPath);
      setLocalPlanActions(plan.actions);
      setLocalPlanRootPath(plan.rootPath);
      setStatus(`Plan ready: ${plan.actions.length} file action${plan.actions.length === 1 ? '' : 's'} in ${plan.rootPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create local file plan.';
      setStatus(message);
      setLocalPlanActions([]);
      setLocalPlanRootPath('');
    } finally {
      setLocalPlanLoading(false);
    }
  };

  const handlePickWorkingFolder = async () => {
    if (!bridge?.selectFolder) {
      const input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');

      input.onchange = () => {
        const selected = input.files?.[0]?.webkitRelativePath?.split('/')[0] ?? '';
        if (!selected) {
          setStatus('No folder selected.');
          return;
        }

        setWorkingFolder(selected);
        setStatus(
          `Folder selected in browser sandbox: ${selected}. To apply local file changes, run the Electron desktop app (npm run dev).`,
        );
      };

      input.click();
      return;
    }

    try {
      const selected = await bridge.selectFolder(workingFolder);
      if (selected && selected.trim()) {
        setWorkingFolder(selected);
        setStatus(`Working folder selected: ${selected}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open folder picker.';
      setStatus(message);
    }
  };

  const handleApplyLocalPlan = async () => {
    if (!bridge?.applyOrganizeFolderPlan) {
      setStatus('Local file organizer is available in the Electron desktop app only.');
      return;
    }

    if (!localPlanRootPath || localPlanActions.length === 0) {
      setStatus('Create a plan before applying changes.');
      return;
    }

    setLocalApplyLoading(true);
    try {
      const result = await bridge.applyOrganizeFolderPlan(localPlanRootPath, localPlanActions);
      setStatus(
        `Applied ${result.applied} action${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}. ${
          result.errors.length > 0 ? 'Some items had errors.' : 'Done.'
        }`,
      );
      setLocalPlanActions([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply local file plan.';
      setStatus(message);
    } finally {
      setLocalApplyLoading(false);
    }
  };

  const handleSendChat = async (event: FormEvent) => {
    event.preventDefault();

    const text = taskPrompt.trim();
    if (!text) {
      setStatus('Type a message before sending.');
      return;
    }

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setSendingChat(true);
    setChatMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        text,
      },
    ]);
    setTaskPrompt('');

    try {
      const sessionKey = await ensureActiveSession(client);
      setActiveSessionKey(sessionKey);

      await client.sendChat(sessionKey, text);
      setStatus(`Message sent to OpenClaw Gateway (session: ${sessionKey}). Waiting for streaming events...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send chat message.';
      if (message.includes('missing scope: operator.write')) {
        setStatus(
          'Connected without operator.write. Approve this paired device with write scope and reconnect (openclaw devices list, then openclaw devices approve <requestId> or rotate token scopes).',
        );
      } else {
        setStatus(message);
      }
    } finally {
      setSendingChat(false);
    }
  };

  const handleModelChange = async (nextModelValue: string) => {
    const previousModel = selectedModel;
    setSelectedModel(nextModelValue);

    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      setSelectedModel(previousModel);
      return;
    }

    setChangingModel(true);
    try {
      const sessionKey = await ensureActiveSession(client);
      await client.setSessionModel(sessionKey, nextModelValue || null);
      setStatus(
        nextModelValue
          ? `Model updated for session ${sessionKey}: ${nextModelValue}`
          : `Model reset to default for session ${sessionKey}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update model.';
      if (message.includes('missing scope: operator.admin')) {
        setStatus('Missing operator.admin. Use Settings > Reset pairing, then approve the new request with admin scope.');
      } else {
        setStatus(message);
      }
      setSelectedModel(previousModel);
    } finally {
      setChangingModel(false);
    }
  };

  const loadScheduledJobs = async () => {
    const client = gatewayClientRef.current;
    if (!client) {
      setStatus('Gateway client not initialized.');
      return;
    }

    setScheduledLoading(true);
    try {
      await client.connect({
        gatewayUrl: draftGatewayUrl,
        token: draftGatewayToken,
      });
      const rows = await client.listCronJobs();
      setScheduledJobs(rows);
      setStatus(`Loaded ${rows.length} scheduled job${rows.length === 1 ? '' : 's'} from OpenClaw.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load scheduled jobs.';
      setStatus(message || 'Unable to load scheduled jobs.');
      setScheduledJobs([]);
    } finally {
      setScheduledLoading(false);
    }
  };

  useEffect(() => {
    if (activePage !== 'scheduled') {
      return;
    }

    void loadScheduledJobs();
  }, [activePage]);

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
    <div className="grid h-full grid-rows-[44px_minmax(0,1fr)] overflow-hidden">
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
          onSelectPage={setActivePage}
          onOpenSettings={() => setActivePage('settings')}
        />

        <main className="relative min-h-0 overflow-hidden p-5">
          <ScrollArea className="h-full">
            {activePage === 'chat' && (
              <ChatPage
                taskPrompt={taskPrompt}
                messages={chatMessages}
                sending={sendingChat}
                sessionKey={activeSessionKey}
                models={chatModels}
                selectedModel={selectedModel}
                modelsLoading={modelsLoading}
                changingModel={changingModel}
                status={status}
                onTaskPromptChange={setTaskPrompt}
                onModelChange={handleModelChange}
                onSubmit={handleSendChat}
              />
            )}

            {activePage === 'cowork' && (
              <CoworkPage
                taskPrompt={taskPrompt}
                workingFolder={workingFolder}
                taskState={taskState}
                status={status}
                desktopBridgeAvailable={Boolean(bridge)}
                localPlanActions={localPlanActions}
                localPlanLoading={localPlanLoading}
                localApplyLoading={localApplyLoading}
                onTaskPromptChange={setTaskPrompt}
                onWorkingFolderChange={setWorkingFolder}
                onPickWorkingFolder={handlePickWorkingFolder}
                onSubmit={handlePlanTask}
                onCreateLocalPlan={handleCreateLocalPlan}
                onApplyLocalPlan={handleApplyLocalPlan}
              />
            )}

            {activePage === 'scheduled' && (
              <ScheduledPage jobs={scheduledJobs} loading={scheduledLoading} status={status} onRefresh={loadScheduledJobs} />
            )}

            {activePage === 'settings' && (
              <SettingsPage
                draftGatewayUrl={draftGatewayUrl}
                draftGatewayToken={draftGatewayToken}
                health={health}
                status={status}
                saving={saving}
                checking={checking}
                pairingRequestId={pairingRequestId}
                onDraftGatewayUrlChange={setDraftGatewayUrl}
                onDraftGatewayTokenChange={setDraftGatewayToken}
                onSave={handleSave}
                onHealthCheck={handleHealthCheck}
                onRequestPairing={handleRequestPairing}
                onResetPairing={handleResetPairing}
              />
            )}
          </ScrollArea>
        </main>
      </SidebarProvider>
    </div>
  );
}
