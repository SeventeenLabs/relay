import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Code2, Folder, Globe, KeyRound, Link2, Shield, Terminal } from 'lucide-react';

import type { UserPreferences } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { listConnectors, persistConnectorConfig } from '@/lib/connectors';
import { loadAllowedDomains, saveAllowedDomains } from '@/lib/connectors/web-fetch';
import type { ConnectorDefinition } from '@/lib/connectors/connector-types';

type AppLanguage = 'en' | 'de';

type SettingsSection = 'Profile' | 'Appearance' | 'System Prompt' | 'Gateway' | 'Connectors' | 'Account' | 'Privacy' | 'Developer';

type StyleOption = UserPreferences['style'];
type ThemeOption = UserPreferences['theme'];

type SettingsPageProps = {
  activeSection: SettingsSection;
  preferences: UserPreferences;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
};

const sectionDescriptions: Record<SettingsSection, { en: string; de: string }> = {
  Profile: {
    en: 'Your name, role, and response preferences.',
    de: 'Dein Name, deine Rolle und Antwortspraeferenzen.',
  },
  Appearance: {
    en: 'Theme, language, and notifications.',
    de: 'Design, Sprache und Benachrichtigungen.',
  },
  'System Prompt': {
    en: 'Default instructions for every conversation.',
    de: 'Standardanweisungen fuer jede Konversation.',
  },
  Gateway: {
    en: 'Connection settings.',
    de: 'Verbindungseinstellungen.',
  },
  Connectors: {
    en: 'Connect external services to Relay.',
    de: 'Externe Dienste mit Relay verbinden.',
  },
  Account: {
    en: 'Email, password, and security settings.',
    de: 'E-Mail, Passwort und Sicherheitseinstellungen.',
  },
  Privacy: {
    en: 'Data sharing and retention policies.',
    de: 'Datenfreigaben und Aufbewahrungsrichtlinien.',
  },
  Developer: {
    en: 'Developer options and debugging tools.',
    de: 'Entwickleroptionen und Debugging-Tools.',
  },
};

type PreviewPalette = {
  bg: string;
  surface: string;
  border: string;
  lineStrong: string;
  lineSoft: string;
  lineMuted: string;
  panel: string;
  accentStrong: string;
  accentSoft: string;
};

const previewPaletteByStyle: Record<StyleOption, { light: PreviewPalette; dark: PreviewPalette }> = {
  relay: {
    light: {
      bg: 'var(--preview-relay-light-bg)',
      surface: 'var(--preview-relay-light-surface)',
      border: 'var(--preview-relay-light-border)',
      lineStrong: 'var(--preview-relay-light-line-strong)',
      lineSoft: 'var(--preview-relay-light-line-soft)',
      lineMuted: 'var(--preview-relay-light-line-muted)',
      panel: 'var(--preview-relay-light-panel)',
      accentStrong: 'var(--preview-relay-light-accent-strong)',
      accentSoft: 'var(--preview-relay-light-accent-soft)',
    },
    dark: {
      bg: 'var(--preview-relay-dark-bg)',
      surface: 'var(--preview-relay-dark-surface)',
      border: 'var(--preview-relay-dark-border)',
      lineStrong: 'var(--preview-relay-dark-line-strong)',
      lineSoft: 'var(--preview-relay-dark-line-soft)',
      lineMuted: 'var(--preview-relay-dark-line-muted)',
      panel: 'var(--preview-relay-dark-panel)',
      accentStrong: 'var(--preview-relay-dark-accent-strong)',
      accentSoft: 'var(--preview-relay-dark-accent-soft)',
    },
  },
  claude: {
    light: {
      bg: 'var(--preview-claude-light-bg)',
      surface: 'var(--preview-claude-light-surface)',
      border: 'var(--preview-claude-light-border)',
      lineStrong: 'var(--preview-claude-light-line-strong)',
      lineSoft: 'var(--preview-claude-light-line-soft)',
      lineMuted: 'var(--preview-claude-light-line-muted)',
      panel: 'var(--preview-claude-light-panel)',
      accentStrong: 'var(--preview-claude-light-accent-strong)',
      accentSoft: 'var(--preview-claude-light-accent-soft)',
    },
    dark: {
      bg: 'var(--preview-claude-dark-bg)',
      surface: 'var(--preview-claude-dark-surface)',
      border: 'var(--preview-claude-dark-border)',
      lineStrong: 'var(--preview-claude-dark-line-strong)',
      lineSoft: 'var(--preview-claude-dark-line-soft)',
      lineMuted: 'var(--preview-claude-dark-line-muted)',
      panel: 'var(--preview-claude-dark-panel)',
      accentStrong: 'var(--preview-claude-dark-accent-strong)',
      accentSoft: 'var(--preview-claude-dark-accent-soft)',
    },
  },
};

function getPreviewPalette(style: StyleOption, dark: boolean): PreviewPalette {
  return dark ? previewPaletteByStyle[style].dark : previewPaletteByStyle[style].light;
}

function StylePreview({ style, dark }: { style: StyleOption; dark: boolean }) {
  const isRelay = style === 'relay';
  const colors = getPreviewPalette(style, dark);

  return (
    <svg viewBox="0 0 320 140" className="block h-full w-full" preserveAspectRatio="none" role="img" aria-label={`${isRelay ? 'Relay' : 'Claude'} style preview`}>
      <rect x="0" y="0" width="320" height="140" fill={colors.bg} />
      <rect x="10" y="10" width="98" height="120" rx="10" fill={colors.surface} stroke={colors.border} />
      <rect x="22" y="22" width="48" height="8" rx="4" fill={colors.accentStrong} opacity="0.85" />
      <rect x="22" y="36" width="34" height="5" rx="2.5" fill={colors.lineSoft} />
      <rect x="22" y="46" width="40" height="5" rx="2.5" fill={colors.lineMuted} />
      <rect x="22" y="58" width="74" height="24" rx="7" fill={colors.accentSoft} />

      <rect x="118" y="10" width="192" height="120" rx="10" fill={colors.surface} stroke={colors.border} />
      <rect x="132" y="22" width="96" height="8" rx="4" fill={colors.lineStrong} />
      <rect x="132" y="36" width="152" height="5" rx="2.5" fill={colors.lineSoft} />
      <rect x="132" y="46" width="132" height="5" rx="2.5" fill={colors.lineMuted} />
      <rect x="132" y="62" width="78" height="30" rx="8" fill={colors.panel} stroke={colors.border} />
      <rect x="220" y="62" width="76" height="30" rx="8" fill={colors.accentSoft} />
    </svg>
  );
}

function ThemePreview({ mode, style }: { mode: ThemeOption; style: StyleOption }) {
  const modeLabel = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Auto';
  const light = getPreviewPalette(style, false);
  const dark = getPreviewPalette(style, true);

  const active = mode === 'dark' ? dark : light;
  return (
    <svg viewBox="0 0 320 140" className="block h-full w-full" preserveAspectRatio="none" role="img" aria-label={`${modeLabel} theme preview`}>
      <rect x="0" y="0" width="320" height="140" fill={mode === 'auto' ? light.bg : active.bg} />
      {mode === 'auto' ? <rect x="160" y="0" width="160" height="140" fill={dark.bg} /> : null}
      <rect
        x="14"
        y="14"
        width={mode === 'auto' ? 140 : 292}
        height="112"
        rx="10"
        fill={mode === 'auto' ? light.surface : active.surface}
        stroke={mode === 'auto' ? light.border : active.border}
      />
      <rect
        x={mode === 'auto' ? 166 : 26}
        y="14"
        width={mode === 'auto' ? 140 : 0}
        height="112"
        rx="10"
        fill={mode === 'auto' ? dark.surface : active.surface}
        stroke={mode === 'auto' ? dark.border : 'transparent'}
      />

      <rect x={mode === 'auto' ? 28 : 30} y="30" width="56" height="7" rx="3.5" fill={mode === 'auto' ? light.lineStrong : active.lineStrong} />
      <rect x={mode === 'auto' ? 28 : 30} y="43" width="86" height="5" rx="2.5" fill={mode === 'auto' ? light.lineSoft : active.lineSoft} />
      <rect x={mode === 'auto' ? 28 : 30} y="54" width="70" height="5" rx="2.5" fill={mode === 'auto' ? light.lineMuted : active.lineMuted} />
      <rect x={mode === 'auto' ? 28 : 30} y="66" width="66" height="24" rx="7" fill={mode === 'auto' ? light.panel : active.panel} />

      {mode === 'auto' ? (
        <>
          <rect x="180" y="30" width="56" height="7" rx="3.5" fill={dark.lineStrong} />
          <rect x="180" y="43" width="86" height="5" rx="2.5" fill={dark.lineSoft} />
          <rect x="180" y="54" width="70" height="5" rx="2.5" fill={dark.lineMuted} />
          <rect x="180" y="66" width="66" height="24" rx="7" fill={dark.panel} />
          <line x1="160" y1="14" x2="160" y2="126" stroke={dark.border} strokeDasharray="4 4" />
        </>
      ) : null}
    </svg>
  );
}

export function SettingsPage({
  activeSection,
  preferences,
  onUpdatePreferences,
}: SettingsPageProps) {
  const [prefersDarkSystem, setPrefersDarkSystem] = useState(false);
  const t = useCallback((en: string, de: string) => (preferences.language === 'de' ? de : en), [preferences.language]);
  const settingsCardClass = 'max-w-[980px] rounded-2xl border border-border/60 bg-card p-4';

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyPreference = () => setPrefersDarkSystem(media.matches);
    applyPreference();

    media.addEventListener('change', applyPreference);
    return () => media.removeEventListener('change', applyPreference);
  }, []);

  const useDarkPreview =
    preferences.theme === 'dark' || (preferences.theme === 'auto' && prefersDarkSystem);
  const renderPlaceholder = (icon: ReactNode, hint: string) => (
    <div className="max-w-[980px] flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">{t('Not available yet', 'Noch nicht verfuegbar')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground/70">{hint}</p>
      </div>
    </div>
  );

  return (
    <section className="h-full w-full overflow-y-auto bg-background p-4 pb-8">
      <div className="mb-4">
        <h1 className="mb-1 text-[clamp(1.55rem,2.4vw,2rem)] tracking-tight">
          {preferences.language === 'de'
            ? ({
                Profile: 'Profil',
                Appearance: 'Darstellung',
                'System Prompt': 'System-Prompt',
                Gateway: 'Connection',
                Connectors: 'Konnektoren',
                Account: 'Konto',
                Privacy: 'Datenschutz',
                Developer: 'Entwickler',
              } as const)[activeSection]
            : activeSection}
        </h1>
        <p className="font-sans text-sm text-muted-foreground">{sectionDescriptions[activeSection][preferences.language]}</p>
      </div>

      {activeSection === 'Profile' && (
        <section className={settingsCardClass}>
          <div className="mb-3">
            <h2 className="text-base font-medium">{t('Personal details', 'Persoenliche Daten')}</h2>
          </div>
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <label className="grid gap-1">
                <span className="font-sans text-xs text-muted-foreground">{t('Full name', 'Vollstaendiger Name')}</span>
                <Input className="font-sans" placeholder="Christian Lutz" value={preferences.fullName} onChange={(e) => onUpdatePreferences({ fullName: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="font-sans text-xs text-muted-foreground">{t('How should Relay address you?', 'Wie soll Relay dich nennen?')}</span>
                <Input className="font-sans" placeholder="Christian" value={preferences.displayName} onChange={(e) => onUpdatePreferences({ displayName: e.target.value })} />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="font-sans text-xs text-muted-foreground">{t('Role', 'Arbeitsfunktion')}</span>
              <Input className="font-sans" placeholder={t('e.g. Founder, Engineer, Designer', 'z. B. Gruender, Entwickler, Designer')} value={preferences.role} onChange={(e) => onUpdatePreferences({ role: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="font-sans text-xs text-muted-foreground">{t('Response preferences', 'Antwortspraeferenzen')}</span>
              <Textarea className="font-sans" placeholder={t('e.g. I mainly code in Python.', 'z. B. Ich programmiere hauptsaechlich in Python.')} value={preferences.responsePreferences} onChange={(e) => onUpdatePreferences({ responsePreferences: e.target.value })} />
            </label>
          </div>
        </section>
      )}

      {activeSection === 'Appearance' && (
        <div className="flex flex-col gap-4">
          <section className={settingsCardClass}>
            <div className="mb-3">
              <h2 className="text-base font-medium">{t('Theme', 'Theme')}</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {([
                [t('Light', 'Hell'), 'light'],
                [t('Auto', 'Auto'), 'auto'],
                [t('Dark', 'Dunkel'), 'dark'],
              ] as const).map(([label, value]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onUpdatePreferences({ theme: value })}
                  className={`overflow-hidden rounded-xl border p-0 text-left transition-colors ${
                    preferences.theme === value
                      ? 'border-primary/50 bg-background text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
                      : 'border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-muted/30'
                  }`}
                >
                  <div className="relative h-36 w-full overflow-hidden border-b border-border/70">
                    <div className="absolute inset-0">
                      <ThemePreview mode={value} style={preferences.style} />
                    </div>
                  </div>
                  <div className="flex min-h-[92px] flex-col px-3 py-3">
                    <p className="text-[1rem] font-medium leading-none text-foreground">{label}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {value === 'light'
                        ? t('Always use light surfaces', 'Immer helle Oberflaechen verwenden')
                        : value === 'dark'
                          ? t('Always use dark surfaces', 'Immer dunkle Oberflaechen verwenden')
                          : t('Follow system appearance', 'Systemdarstellung uebernehmen')}
                    </p>
                    <p className="mt-auto pt-2 text-[11px] font-medium text-muted-foreground/85">
                      {value === 'auto'
                        ? `${t('Currently:', 'Aktuell:')} ${prefersDarkSystem ? t('Dark', 'Dunkel') : t('Light', 'Hell')}`
                        : '\u00a0'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className={settingsCardClass}>
            <div className="mb-3">
              <h2 className="text-base font-medium">{t('Style', 'Stil')}</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {([
                ['claude', t('Cowork', 'Cowork'), t('Warm editorial look', 'Warmer Editorial-Look')],
                ['relay', t('Relay', 'Relay'), t('Crisp product look', 'Klarer Produkt-Look')],
              ] as const).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onUpdatePreferences({ style: value })}
                  className={`overflow-hidden rounded-xl border p-0 text-left transition ${
                    preferences.style === value
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <div className="relative h-36 w-full overflow-hidden border-b border-border/70">
                    <div className="absolute inset-0">
                      <StylePreview style={value} dark={useDarkPreview} />
                    </div>
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className={settingsCardClass}>
            <div className="mb-3">
              <h2 className="text-base font-medium">{t('Language', 'Sprache')}</h2>
            </div>
            <label className="grid gap-1">
              <span className="font-sans text-xs text-muted-foreground">{t('UI language', 'UI-Sprache')}</span>
              <select
                value={preferences.language}
                onChange={(event) => onUpdatePreferences({ language: event.target.value as AppLanguage })}
                className="h-9 rounded-md border border-border bg-background px-2 font-sans text-sm"
              >
                <option value="en">English (primary)</option>
                <option value="de">Deutsch (secondary)</option>
              </select>
            </label>
          </section>

          <section className={settingsCardClass}>
            <div className="mb-3">
              <h2 className="text-base font-medium">{t('Notifications', 'Benachrichtigungen')}</h2>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t('Response completions', 'Antwort-Vervollstaendigungen')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('Get notified when a response has completed.', 'Benachrichtige mich, wenn eine Antwort abgeschlossen ist.')}
                  </p>
                </div>
                <Button variant="outline" size="sm">{t('Enable', 'Aktivieren')}</Button>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t('System alerts', 'Systemhinweise')}</p>
                  <p className="text-xs text-muted-foreground">{t('Updates about scheduled tasks and status.', 'Updates zu geplanten Tasks und Status.')}</p>
                </div>
                <Button variant="outline" size="sm">{t('Manage', 'Verwalten')}</Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeSection === 'System Prompt' && (
        <section className={settingsCardClass}>
          <div className="mb-3">
            <h2 className="text-base font-medium">{t('Default system prompt', 'Standard System-Prompt')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('Prepended as context to every conversation.', 'Wird jeder Konversation als Kontext vorangestellt.')}</p>
          </div>
          <Textarea
            className="min-h-[180px] font-sans text-sm"
            placeholder={t('e.g. You are a helpful SeventeenLabs assistant. Reply in English.', 'z. B. Du bist ein hilfreicher Assistent von SeventeenLabs. Antworte immer auf Deutsch.')}
            value={preferences.systemPrompt}
            onChange={(e) => onUpdatePreferences({ systemPrompt: e.target.value })}
          />
          <p className="mt-2 font-sans text-[11px] text-muted-foreground/60">
            {preferences.systemPrompt.length} {t('characters', 'Zeichen')}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={preferences.injectMemory}
              onClick={() => onUpdatePreferences({ injectMemory: !preferences.injectMemory })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                preferences.injectMemory ? 'bg-primary' : 'bg-input'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  preferences.injectMemory ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <button
              type="button"
              className="font-sans text-sm text-foreground/80 cursor-pointer select-none text-left"
              onClick={() => onUpdatePreferences({ injectMemory: !preferences.injectMemory })}
            >
              {t('Inject memory into conversations', 'Erinnerungen in Konversationen einbetten')}
            </button>
          </div>
        </section>
      )}

      {activeSection === 'Gateway' && (
        <section className={settingsCardClass}>
          <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
            <p className="font-sans text-sm text-muted-foreground">
              {t(
                'Connection management has been removed from Settings.',
                'Die Verbindungsverwaltung wurde aus den Einstellungen entfernt.',
              )}
            </p>
          </div>
        </section>
      )}

      {activeSection === 'Connectors' && <ConnectorsSection language={preferences.language ?? 'en'} />}
      {activeSection === 'Account' && renderPlaceholder(<KeyRound className="size-5" />, t('Email, password, and two-factor authentication.', 'E-Mail, Passwort und Zwei-Faktor-Authentifizierung.'))}
      {activeSection === 'Privacy' && renderPlaceholder(<Shield className="size-5" />, t('Data sharing, retention, and deletion policies.', 'Datenfreigaben, Aufbewahrung und Loeschrichtlinien.'))}
      {activeSection === 'Developer' && renderPlaceholder(<Code2 className="size-5" />, t('API keys, logs, and debugging tools.', 'API-Schluessel, Logs und Debugging-Werkzeuge.'))}
    </section>
  );
}

/* â”€â”€ Connectors settings section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const connectorIcons: Record<string, ReactNode> = {
  folder: <Folder className="size-4" />,
  terminal: <Terminal className="size-4" />,
  globe: <Globe className="size-4" />,
};

function ConnectorsSection({ language }: { language: 'en' | 'de' }) {
  const t = (en: string, de: string) => (language === 'de' ? de : en);
  const [connectors, setConnectors] = useState<ConnectorDefinition[]>([]);
  const [domainDraft, setDomainDraft] = useState('');
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);

  useEffect(() => {
    setConnectors(listConnectors());
    setAllowedDomains(loadAllowedDomains());
  }, []);

  const toggleConnector = (id: string) => {
    setConnectors((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, status: c.status === 'active' ? 'inactive' as const : 'active' as const };
        // Mutate the actual registry object
        const original = listConnectors().find((o) => o.id === id);
        if (original) {
          original.status = next.status;
          persistConnectorConfig(id);
        }
        return next;
      }),
    );
  };

  const addDomain = () => {
    const d = domainDraft.trim().toLowerCase();
    if (!d || allowedDomains.includes(d)) return;
    const next = [...allowedDomains, d];
    setAllowedDomains(next);
    saveAllowedDomains(next);
    setDomainDraft('');
    // Update the web-fetch connector config
    const wf = listConnectors().find((c) => c.id === 'web-fetch');
    if (wf) {
      wf.config.allowedDomains = next;
      persistConnectorConfig('web-fetch');
    }
  };

  const removeDomain = (domain: string) => {
    const next = allowedDomains.filter((d) => d !== domain);
    setAllowedDomains(next);
    saveAllowedDomains(next);
    const wf = listConnectors().find((c) => c.id === 'web-fetch');
    if (wf) {
      wf.config.allowedDomains = next;
      persistConnectorConfig('web-fetch');
    }
  };

  return (
    <div className="max-w-[980px] space-y-4">
      {connectors.map((connector) => (
        <div
          key={connector.id}
          className="rounded-xl border border-border/60 bg-card p-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {connectorIcons[connector.icon] ?? <Link2 className="size-4" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{connector.name}</span>
                <Badge variant={connector.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                  {connector.status === 'active' ? t('Active', 'Aktiv') : t('Inactive', 'Inaktiv')}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{connector.description}</p>
            </div>
            <Button
              variant={connector.status === 'active' ? 'secondary' : 'default'}
              size="sm"
              onClick={() => toggleConnector(connector.id)}
            >
              {connector.status === 'active' ? t('Disable', 'Deaktivieren') : t('Enable', 'Aktivieren')}
            </Button>
          </div>

          {/* Actions list */}
          <div className="mt-3 space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {t('Actions', 'Aktionen')}
            </p>
            {connector.actions.map((action) => (
              <div key={action.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono text-[11px]">{action.id}</span>
                <Badge variant="outline" className="text-[9px]">{action.riskLevel}</Badge>
              </div>
            ))}
          </div>

          {/* Web-fetch domain allowlist config */}
          {connector.id === 'web-fetch' && connector.status === 'active' && (
            <div className="mt-4 space-y-2 border-t border-border/40 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t('Allowed domains', 'Erlaubte Domains')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allowedDomains.map((domain) => (
                  <Badge key={domain} variant="secondary" className="gap-1 text-[11px]">
                    {domain}
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() => removeDomain(domain)}
                    >
                      Ã—
                    </button>
                  </Badge>
                ))}
                {allowedDomains.length === 0 && (
                  <span className="text-[11px] text-muted-foreground/60">{t('No domains configured', 'Keine Domains konfiguriert')}</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. api.example.com"
                  value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }}
                />
                <Button size="sm" variant="secondary" onClick={addDomain}>
                  {t('Add', 'Hinzufuegen')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}



