import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Code2, Folder, Globe, KeyRound, Link2, Shield, Terminal } from 'lucide-react';

import type { HealthCheckResult, UserPreferences } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
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
  draftGatewayUrl: string;
  draftGatewayToken: string;
  health: HealthCheckResult | null;
  status: string;
  saving: boolean;
  pairingRequestId: string | null;
  preferences: UserPreferences;
  onDraftGatewayUrlChange: (value: string) => void;
  onDraftGatewayTokenChange: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onResetPairing: () => void | Promise<void>;
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
    en: 'OpenClaw gateway connection and device authorization.',
    de: 'OpenClaw-Gateway-Verbindung und Geraeteautorisierung.',
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

function StylePreview({ style, dark }: { style: StyleOption; dark: boolean }) {
  const isRelay = style === 'relay';
  const id = isRelay ? 'relay' : 'claude';

  const colors = isRelay
    ? dark
      ? {
          top: '#090909',
          bottom: '#131313',
          surface: '#121212',
          surfaceBorder: '#2b2b2b',
          lineStrong: '#fafafa',
          lineSoft: '#a6a6a6',
          panel: '#1a1a1a',
          accentA: '#bbf451',
          accentB: '#a8df44',
        }
      : {
          top: '#ffffff',
          bottom: '#f4f8f1',
          surface: '#ffffff',
          surfaceBorder: '#e8e8e8',
          lineStrong: '#070707',
          lineSoft: '#666666',
          panel: '#f6f6f6',
          accentA: '#bbf451',
          accentB: '#a8df44',
        }
    : {
        top: dark ? '#1c1b18' : '#fbf5ea',
        bottom: dark ? '#2a2924' : '#f4e8d7',
        surface: dark ? '#242320' : '#fff9f2',
        surfaceBorder: dark ? '#3a3a36' : '#e4d4bd',
        lineStrong: dark ? '#e8e6e0' : '#9b806f',
        lineSoft: dark ? '#8a887e' : '#d8c3a7',
        panel: dark ? '#2a2924' : '#f4ecdf',
        accentA: '#df9a79',
        accentB: '#c47a5c',
      };

  return (
    <svg
      viewBox="0 0 320 140"
      className="block h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`${isRelay ? 'Relay' : 'Claude'} style preview`}
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={colors.top} />
          <stop offset="100%" stopColor={colors.bottom} />
        </linearGradient>
        <linearGradient id={`${id}-accent`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={colors.accentA} />
          <stop offset="100%" stopColor={colors.accentB} />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="320" height="140" fill={`url(#${id}-bg)`} />

      <rect x="0" y="0" width="96" height="140" fill={colors.surface} stroke={colors.surfaceBorder} />
      <rect x="12" y="16" width="64" height="8" rx="4" fill={colors.lineStrong} opacity="0.75" />
      <rect x="12" y="32" width="54" height="6" rx="3" fill={colors.lineSoft} />
      <rect x="12" y="44" width="60" height="6" rx="3" fill={colors.lineSoft} />
      <rect x="12" y="60" width="52" height="24" rx="7" fill={`url(#${id}-accent)`} />
      <rect x="12" y="92" width="72" height="18" rx="7" fill={colors.panel} stroke={colors.surfaceBorder} />

      <rect x="96" y="0" width="224" height="140" fill={colors.surface} stroke={colors.surfaceBorder} />
      <rect x="110" y="16" width="94" height="8" rx="4" fill={colors.lineStrong} opacity="0.72" />
      <rect x="110" y="32" width="176" height="6" rx="3" fill={colors.lineSoft} />
      <rect x="110" y="44" width="156" height="6" rx="3" fill={colors.lineSoft} />
      <rect x="110" y="60" width="82" height="28" rx="8" fill={colors.panel} stroke={colors.surfaceBorder} />
      <rect x="202" y="60" width="96" height="28" rx="8" fill={`url(#${id}-accent)`} opacity="0.18" />
      <rect x="110" y="96" width="184" height="8" rx="4" fill={colors.lineSoft} />
    </svg>
  );
}

function ThemePreview({ mode }: { mode: ThemeOption }) {
  if (mode === 'dark') {
    return (
      <svg viewBox="0 0 320 140" className="block h-full w-full" preserveAspectRatio="none" role="img" aria-label="Dark theme preview">
        <rect x="0" y="0" width="320" height="140" fill="#1c1b18" />
        <rect x="0" y="0" width="96" height="140" fill="#242320" stroke="#3a3a36" />
        <rect x="12" y="16" width="58" height="8" rx="4" fill="#e8e6e0" opacity="0.8" />
        <rect x="12" y="32" width="48" height="6" rx="3" fill="#8a887e" />
        <rect x="12" y="44" width="56" height="6" rx="3" fill="#8a887e" />
        <rect x="12" y="60" width="52" height="24" rx="7" fill="#4b4a45" />
        <rect x="96" y="0" width="224" height="140" fill="#242320" stroke="#3a3a36" />
        <rect x="110" y="16" width="92" height="8" rx="4" fill="#e8e6e0" opacity="0.76" />
        <rect x="110" y="32" width="166" height="6" rx="3" fill="#8a887e" />
        <rect x="110" y="44" width="148" height="6" rx="3" fill="#8a887e" />
        <rect x="110" y="60" width="74" height="28" rx="8" fill="#2f2e2a" stroke="#3a3a36" />
        <rect x="194" y="60" width="92" height="28" rx="8" fill="#e8e6e0" opacity="0.12" />
      </svg>
    );
  }

  if (mode === 'auto') {
    return (
      <svg viewBox="0 0 320 140" className="block h-full w-full" preserveAspectRatio="none" role="img" aria-label="Auto theme preview">
        <rect x="0" y="0" width="160" height="140" fill="#f4f3ee" />
        <rect x="160" y="0" width="160" height="140" fill="#1c1b18" />

        <rect x="12" y="14" width="64" height="112" rx="9" fill="#ffffff" stroke="#deddd4" />
        <rect x="20" y="24" width="42" height="6" rx="3" fill="#1f1f1c" opacity="0.7" />
        <rect x="20" y="37" width="34" height="5" rx="2.5" fill="#8d8b84" />
        <rect x="20" y="48" width="38" height="5" rx="2.5" fill="#8d8b84" />
        <rect x="20" y="61" width="36" height="18" rx="6" fill="#e5dfd2" />

        <rect x="84" y="14" width="64" height="112" rx="9" fill="#ffffff" stroke="#deddd4" />
        <rect x="92" y="24" width="42" height="6" rx="3" fill="#1f1f1c" opacity="0.7" />
        <rect x="92" y="37" width="34" height="5" rx="2.5" fill="#8d8b84" />
        <rect x="92" y="48" width="38" height="5" rx="2.5" fill="#8d8b84" />
        <rect x="92" y="61" width="36" height="18" rx="6" fill="#e5dfd2" />

        <rect x="172" y="14" width="64" height="112" rx="9" fill="#242320" stroke="#3a3a36" />
        <rect x="180" y="24" width="42" height="6" rx="3" fill="#e8e6e0" opacity="0.8" />
        <rect x="180" y="37" width="34" height="5" rx="2.5" fill="#8a887e" />
        <rect x="180" y="48" width="38" height="5" rx="2.5" fill="#8a887e" />
        <rect x="180" y="61" width="36" height="18" rx="6" fill="#34332f" />

        <rect x="244" y="14" width="64" height="112" rx="9" fill="#242320" stroke="#3a3a36" />
        <rect x="252" y="24" width="42" height="6" rx="3" fill="#e8e6e0" opacity="0.8" />
        <rect x="252" y="37" width="34" height="5" rx="2.5" fill="#8a887e" />
        <rect x="252" y="48" width="38" height="5" rx="2.5" fill="#8a887e" />
        <rect x="252" y="61" width="36" height="18" rx="6" fill="#34332f" />

        <line x1="160" y1="10" x2="160" y2="130" stroke="#9ca3af" strokeDasharray="4 4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 320 140" className="block h-full w-full" preserveAspectRatio="none" role="img" aria-label="Light theme preview">
      <rect x="0" y="0" width="320" height="140" fill="#f4f3ee" />
      <rect x="0" y="0" width="96" height="140" fill="#ffffff" stroke="#deddd4" />
      <rect x="12" y="16" width="58" height="8" rx="4" fill="#1f1f1c" opacity="0.72" />
      <rect x="12" y="32" width="48" height="6" rx="3" fill="#8d8b84" />
      <rect x="12" y="44" width="56" height="6" rx="3" fill="#8d8b84" />
      <rect x="12" y="60" width="50" height="24" rx="7" fill="#e5dfd2" />
      <rect x="96" y="0" width="224" height="140" fill="#ffffff" stroke="#deddd4" />
      <rect x="110" y="16" width="92" height="8" rx="4" fill="#1f1f1c" opacity="0.68" />
      <rect x="110" y="32" width="166" height="6" rx="3" fill="#8d8b84" />
      <rect x="110" y="44" width="148" height="6" rx="3" fill="#8d8b84" />
      <rect x="110" y="60" width="74" height="28" rx="8" fill="#f3efe6" stroke="#deddd4" />
      <rect x="194" y="60" width="92" height="28" rx="8" fill="#111827" opacity="0.08" />
    </svg>
  );
}

export function SettingsPage({
  activeSection,
  draftGatewayUrl,
  draftGatewayToken,
  health,
  status,
  saving,
  pairingRequestId,
  preferences,
  onDraftGatewayUrlChange,
  onDraftGatewayTokenChange,
  onSave,
  onResetPairing,
  onUpdatePreferences,
}: SettingsPageProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [prefersDarkSystem, setPrefersDarkSystem] = useState(false);
  const t = useCallback((en: string, de: string) => (preferences.language === 'de' ? de : en), [preferences.language]);

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

  const effectivePairingId = useMemo(() => {
    if (pairingRequestId) return pairingRequestId;
    if (health && !health.ok) {
      const match = health.message.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      return match?.[0] ?? null;
    }
    return null;
  }, [pairingRequestId, health]);

  const copyCommand = useCallback(() => {
    if (!effectivePairingId) return;
    const cmd = `openclaw devices approve ${effectivePairingId}`;
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [effectivePairingId]);

  const renderPlaceholder = (icon: ReactNode, hint: string) => (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-12 text-center">
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
    <section className="mx-auto w-full max-w-[720px] px-2">
      <div className="mb-6">
        <h1 className="mb-1 text-[clamp(1.55rem,2.4vw,2rem)] tracking-tight">
          {preferences.language === 'de'
            ? ({
                Profile: 'Profil',
                Appearance: 'Darstellung',
                'System Prompt': 'System-Prompt',
                Gateway: 'Gateway',
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
        <section className="pb-6">
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
        <div className="flex flex-col gap-6">
          <section>
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
                      ? 'border-[#d98765] bg-background text-foreground shadow-[0_0_0_1px_rgba(222,130,94,0.18)]'
                      : 'border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-muted/30'
                  }`}
                >
                  <div className="relative h-36 w-full overflow-hidden border-b border-border/70">
                    <div className="absolute inset-0">
                      <ThemePreview mode={value} />
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

          <Separator />

          <section>
            <div className="mb-3">
              <h2 className="text-base font-medium">{t('Style', 'Stil')}</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {([
                ['claude', t('Claude Cowork', 'Claude Cowork'), t('Warm editorial look', 'Warmer Editorial-Look')],
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

          <Separator />

          <section>
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

          <Separator />

          <section>
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
              <Separator />
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
        <section className="pb-6">
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
        <div className="flex flex-col gap-6">
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-medium">{t('Connection', 'Verbindung')}</h2>
              <Badge
                variant="outline"
                className={
                  health?.ok
                    ? 'rounded-full border border-[rgba(47,122,88,0.35)] bg-[rgba(47,122,88,0.08)] font-sans text-[11px] text-[#2f7a58]'
                    : 'rounded-full font-sans text-[11px]'
                }
              >
                {health?.ok ? t('Connected', 'Verbunden') : t('Not connected', 'Nicht verbunden')}
              </Badge>
            </div>
            <form className="grid gap-3" onSubmit={onSave}>
              <label className="grid gap-1">
                <span className="font-sans text-xs text-muted-foreground">Gateway URL (WebSocket)</span>
                <Input
                  value={draftGatewayUrl}
                  onChange={(event) => onDraftGatewayUrlChange(event.target.value)}
                  placeholder="ws://127.0.0.1:18789"
                  className="font-sans"
                />
              </label>

              <label className="grid gap-1">
                <span className="font-sans text-xs text-muted-foreground">Gateway token</span>
                <Input
                  type="password"
                  value={draftGatewayToken}
                  onChange={(event) => onDraftGatewayTokenChange(event.target.value)}
                  placeholder={t('Paste token from OpenClaw setup', 'Token aus dem OpenClaw-Setup einfuegen')}
                  className="font-sans"
                />
              </label>

              <Button
                className="w-full border-0 bg-[linear-gradient(120deg,#ea9f7d,#de825e)] text-[#fffefb]"
                type="submit"
                disabled={saving}
              >
                {saving ? t('Connecting...', 'Verbinde...') : t('Save and connect', 'Speichern und verbinden')}
              </Button>
            </form>

            {effectivePairingId ? (
              <div className="mt-3 rounded-lg border border-[rgba(222,130,94,0.35)] bg-[rgba(222,130,94,0.08)] p-3">
                <p className="font-sans text-xs font-medium text-[#7a4a38]">{t('Device pairing required', 'Geraete-Pairing erforderlich')}</p>
                <p className="mt-1 font-sans text-xs text-[#7a4a38]">
                  {t('Run this command on your gateway host:', 'Fuehre diesen Befehl auf deinem Gateway-Host aus:')}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <code className="flex-1 rounded bg-[rgba(0,0,0,0.05)] px-2 py-1 font-mono text-xs text-[#7a4a38] select-all">
                    openclaw devices approve {effectivePairingId}
                  </code>
                  <button
                    type="button"
                    className="shrink-0 rounded bg-[rgba(0,0,0,0.05)] px-2 py-1 font-sans text-[10px] text-[#7a4a38] hover:bg-[rgba(0,0,0,0.1)]"
                    onClick={copyCommand}
                  >
                    {copied ? t('Copied', 'Kopiert') : t('Copy', 'Kopieren')}
                  </button>
                </div>
                <p className="mt-2 font-sans text-xs text-[#7a4a38]/70">
                  {t('Click Save and connect again afterwards.', 'Klicke danach erneut auf Speichern und verbinden.')}
                </p>
              </div>
            ) : health && !health.ok ? (
              <div className="mt-3 rounded-lg border border-[rgba(180,80,50,0.25)] bg-[rgba(180,80,50,0.06)] p-3">
                <p className="font-sans text-xs font-medium text-[#7a4a38]">{t('Connection failed', 'Verbindung fehlgeschlagen')}</p>
                <p className="mt-1 font-sans text-xs text-[#7a4a38]/80">{health.message}</p>
              </div>
            ) : health?.ok ? (
              <p className="mt-3 font-sans text-xs text-[#2f7a58]">{status}</p>
            ) : status ? (
              <p className="mt-3 font-sans text-xs text-muted-foreground">{status}</p>
            ) : null}
          </section>

          <Separator />

          <section>
            <div className="mb-3">
              <h2 className="text-base font-medium">Routing</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('Configure how Relay connects to the OpenClaw backend.', 'Konfiguriere, wie Relay sich mit dem OpenClaw-Backend verbindet.')}</p>
            </div>
            <div className="grid gap-3">
              <div className="flex flex-col gap-2">
                {([
                  [t('Local', 'Lokal'), 'ws://127.0.0.1:18789', t('Gateway running on this machine', 'Gateway laeuft auf diesem Rechner')],
                  ['VPS / Remote', 'wss://gateway.example.com', t('Gateway on an external server', 'Gateway auf einem externen Server')],
                  [t('Custom', 'Benutzerdefiniert'), '', t('Enter your own URL', 'Eigene URL eingeben')],
                ] as const).map(([label, url, desc]) => {
                  const isSelected = url
                    ? draftGatewayUrl === url
                    : draftGatewayUrl !== 'ws://127.0.0.1:18789' && draftGatewayUrl !== 'wss://gateway.example.com';
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { if (url) onDraftGatewayUrlChange(url); }}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                        isSelected
                          ? 'border-[#d98765] bg-[rgba(222,130,94,0.08)]'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <div className={`mt-0.5 h-3 w-3 shrink-0 rounded-full border-2 ${isSelected ? 'border-[#d98765] bg-[#d98765]' : 'border-muted-foreground/40'}`} />
                      <div>
                        <p className="font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <Separator />

          <section>
            <div className="mb-3">
              <h2 className="text-base font-medium">{t('Device management', 'Geraeteverwaltung')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('Device identity and pairing status.', 'Geraeteidentitaet und Pairing-Status.')}</p>
            </div>
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{t('Reset device identity', 'Geraeteidentitaet zuruecksetzen')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('Resets Ed25519 keys. Pairing must be approved again afterwards.', 'Setzt die Ed25519-Schluessel zurueck. Danach muss Pairing erneut bestaetigt werden.')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="shrink-0 font-sans text-xs"
                  onClick={() => void onResetPairing()}
                >
                  {t('Reset', 'Zuruecksetzen')}
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          <section className="pb-2">
            <button
              type="button"
              className="font-sans text-xs text-muted-foreground/70 underline-offset-2 hover:text-muted-foreground hover:underline"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? t('Hide advanced options', 'Erweiterte Optionen ausblenden') : t('Advanced options', 'Erweiterte Optionen')}
            </button>

            {showAdvanced && (
              <div className="mt-3 grid gap-3">
                <label className="grid gap-1">
                  <span className="font-sans text-xs text-muted-foreground">{t('Reconnect attempts (max)', 'Reconnect-Versuche (max)')}</span>
                  <Input type="number" className="font-sans w-32" placeholder="6" defaultValue="6" />
                </label>
                <label className="grid gap-1">
                  <span className="font-sans text-xs text-muted-foreground">{t('Reconnect base interval (ms)', 'Reconnect-Basisintervall (ms)')}</span>
                  <Input type="number" className="font-sans w-32" placeholder="1000" defaultValue="1000" />
                </label>
                <label className="grid gap-1">
                  <span className="font-sans text-xs text-muted-foreground">WebSocket timeout (ms)</span>
                  <Input type="number" className="font-sans w-32" placeholder="30000" defaultValue="30000" />
                </label>
              </div>
            )}
          </section>
        </div>
      )}

      {activeSection === 'Connectors' && <ConnectorsSection language={preferences.language ?? 'en'} />}
      {activeSection === 'Account' && renderPlaceholder(<KeyRound className="size-5" />, t('Email, password, and two-factor authentication.', 'E-Mail, Passwort und Zwei-Faktor-Authentifizierung.'))}
      {activeSection === 'Privacy' && renderPlaceholder(<Shield className="size-5" />, t('Data sharing, retention, and deletion policies.', 'Datenfreigaben, Aufbewahrung und Loeschrichtlinien.'))}
      {activeSection === 'Developer' && renderPlaceholder(<Code2 className="size-5" />, t('API keys, logs, and debugging tools.', 'API-Schluessel, Logs und Debugging-Werkzeuge.'))}
    </section>
  );
}

/* ── Connectors settings section ─────────────────────────────────────────── */

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
    <div className="space-y-6">
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
                      ×
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
