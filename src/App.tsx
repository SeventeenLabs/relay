import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppConfig, BackendMode, HealthCheckResult } from './app-types';

const navItems = [
  'New task',
  'Search',
  'Scheduled',
  'Ideas',
  'Customize',
];

const recentTasks = [
  'Run SEO audit for benai.co',
  'Analyze YouTube Studio data structure',
  'Curate newsletter ideas from AI source docs',
  'Create Google Doc with campaign brief',
  'Convert LinkedIn post to infographic outline',
  'Build newsletter writer skill from examples',
  'Review sales pipeline and next actions',
];

const quickActions = [
  'Explore marketing skills',
  'Repurpose content for social',
  'Create case study presentation',
];

const executionTimeline = [
  {
    label: 'Scope and access',
    detail: 'Confirm folder and backend route before touching files.',
  },
  {
    label: 'Plan generation',
    detail: 'Draft a multi-step plan and wait for approval.',
  },
  {
    label: 'Execution',
    detail: 'Run steps with periodic checkpoints and artifact previews.',
  },
];

const presetUrls: Record<BackendMode, string> = {
  local: 'http://127.0.0.1:3000',
  vps: 'https://your-openclaw-vps.example.com',
  custom: '',
};

export default function App() {
  const bridge = window.openClawCowork;
  const hasBridge = Boolean(bridge);
  const hasWindowControls =
    Boolean(bridge?.minimizeWindow) &&
    Boolean(bridge?.toggleMaximizeWindow) &&
    Boolean(bridge?.isWindowMaximized) &&
    Boolean(bridge?.closeWindow);

  const [config, setConfig] = useState<AppConfig>({ mode: 'local', baseUrl: presetUrls.local });
  const [draftUrl, setDraftUrl] = useState(presetUrls.local);
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [status, setStatus] = useState('Loading configuration...');

  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'cowork' | 'code'>('cowork');
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
  }, []);

  useEffect(() => {
    if (!hasWindowControls || !bridge) {
      return;
    }

    bridge
      .isWindowMaximized()
      .then((value) => setIsMaximized(value))
      .catch(() => {
        setIsMaximized(false);
      });
  }, [bridge, hasWindowControls]);

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
      return;
    }

    await bridge.minimizeWindow();
  };

  const handleToggleMaximize = async () => {
    if (!bridge?.toggleMaximizeWindow) {
      return;
    }

    const nextState = await bridge.toggleMaximizeWindow();
    setIsMaximized(nextState);
  };

  const handleClose = async () => {
    if (!bridge?.closeWindow) {
      return;
    }

    await bridge.closeWindow();
  };

  return (
    <div className="app-frame">
      <header className="window-titlebar">
        <div className="titlebar-left no-drag">
          <button type="button" className="titlebar-nav-button" aria-label="Back">
            ←
          </button>
          <button type="button" className="titlebar-nav-button" aria-label="Forward">
            →
          </button>
        </div>

        <div className="titlebar-center titlebar-drag-region">
          <div className="titlebar-mode-switch no-drag" role="tablist" aria-label="workspace mode">
            {(['chat', 'cowork', 'code'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={mode === activeView}
                className={mode === activeView ? 'mode-pill active' : 'mode-pill'}
                onClick={() => setActiveView(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="titlebar-controls">
          <button
            type="button"
            className="titlebar-button symbol"
            onClick={handleMinimize}
            disabled={!hasWindowControls}
            aria-label="Minimize"
          >
            −
          </button>
          <button
            type="button"
            className="titlebar-button symbol"
            onClick={handleToggleMaximize}
            disabled={!hasWindowControls}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? '❐' : '□'}
          </button>
          <button
            type="button"
            className="titlebar-button symbol close"
            onClick={handleClose}
            disabled={!hasWindowControls}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </header>

      <div className="cowork-shell">
        <aside className="left-rail">
        <header className="brand-box">
          <p className="brand-title">OpenClawCowork</p>
          <p className="brand-subtitle">Agentic desktop workbench</p>
        </header>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button key={item} type="button" className="nav-item">
              {item}
            </button>
          ))}
        </nav>

        <section className="recent-list">
          <p className="section-label">Recents</p>
          {recentTasks.map((task) => (
            <button key={task} type="button" className="recent-item">
              {task}
            </button>
          ))}
        </section>

        <footer className="left-footer">
          <button type="button" className="invite-button">
            Invite team members
          </button>
          <p className="identity">Ben AI</p>
        </footer>
        </aside>

        <main className="cowork-main">

        <section className="hero">
          <div className="hero-badge">OpenClaw Agent</div>
          <h1>Let&apos;s knock something off your list</h1>
          <p>
            Describe your objective, select a working folder, and OpenClaw will draft a plan for approval before execution.
          </p>

          <form className="prompt-card" onSubmit={handlePlanTask}>
            <label>
              <span className="field-label">What can I help you with today?</span>
              <textarea
                value={taskPrompt}
                onChange={(event) => setTaskPrompt(event.target.value)}
                placeholder="Help me organize my Downloads folder, draft naming conventions, and wait for approval before changes."
                rows={3}
              />
            </label>

            <div className="prompt-row">
              <label className="folder-input">
                <span>Working folder</span>
                <input
                  value={workingFolder}
                  onChange={(event) => setWorkingFolder(event.target.value)}
                  placeholder="/Downloads"
                />
              </label>

              <button className="plan-button" type="submit">
                Plan with OpenClaw
              </button>
            </div>
          </form>
        </section>

        <section className="suggestions">
          <p className="section-label">Get to work with Marketing</p>
          <div className="action-list">
            {quickActions.map((action) => (
              <button key={action} className="action-item" type="button">
                {action}
              </button>
            ))}
          </div>
        </section>

        <section className="timeline">
          <div className="timeline-head">
            <h2>Task flow</h2>
            <span className={taskState === 'planned' ? 'state-pill planned' : 'state-pill'}>
              {taskState === 'planned' ? 'Plan ready' : 'Awaiting prompt'}
            </span>
          </div>
          <ol>
            {executionTimeline.map((step) => (
              <li key={step.label}>
                <h3>{step.label}</h3>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>
        </main>

        <aside className="inspector">
          <section className="inspector-card">
          <div className="inspector-head">
            <h2>Backend routing</h2>
            <span className={health?.ok ? 'health-pill good' : 'health-pill'}>
              {health?.ok ? 'Connected' : 'Unchecked'}
            </span>
          </div>

          <form className="settings-form" onSubmit={handleSave}>
            <label>
              <span>Mode</span>
              <div className="mode-switches">
                {(['local', 'vps', 'custom'] as BackendMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={mode === config.mode ? 'mode-button active' : 'mode-button'}
                    onClick={() => handleModeChange(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </label>

            <label>
              <span>Base URL</span>
              <input
                type="url"
                value={draftUrl}
                onChange={(event) => setDraftUrl(event.target.value)}
                placeholder="https://your-openclaw-host"
              />
            </label>

            <div className="settings-actions">
              <button className="plan-button" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save configuration'}
              </button>
              <button className="secondary-button" type="button" onClick={handleHealthCheck} disabled={checking || !hasBridge}>
                {checking ? 'Checking...' : 'Test connection'}
              </button>
            </div>
          </form>

          <div className="status-box">
            <p>{status}</p>
            {!hasBridge && <p>Bridge unavailable. Open in Electron to enable persistence and health checks.</p>}
          </div>

          <div className="access-box">
            <h3>Access controls</h3>
            <ul>
              <li>Folder scope: {workingFolder || '/Downloads'}</li>
              <li>Backend: {config.baseUrl}</li>
              <li>Approval gate before execution</li>
            </ul>
          </div>
          </section>
        </aside>
      </div>
    </div>
  );
}