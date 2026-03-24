import { useCallback, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Code2, KeyRound, Link2, Shield } from 'lucide-react';

import type { HealthCheckResult } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

type AppLanguage = 'en' | 'de';

type UserPreferences = {
  fullName: string;
  displayName: string;
  role: string;
  responsePreferences: string;
  systemPrompt: string;
  theme: 'light' | 'auto' | 'dark';
  style: 'claude' | 'relay';
  language: AppLanguage;
};

type SettingsSection = 'Profile' | 'Appearance' | 'System Prompt' | 'Gateway' | 'Connectors' | 'Account' | 'Privacy' | 'Developer';

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
  const t = useCallback((en: string, de: string) => (preferences.language === 'de' ? de : en), [preferences.language]);

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
                  className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-sm transition ${
                    preferences.theme === value
                      ? 'border-[#d98765] bg-[rgba(222,130,94,0.08)] text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <div className={`h-16 w-full rounded-lg border border-border ${value === 'dark' ? 'bg-[#2a2a28]' : 'bg-muted'}`} />
                  {label}
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
                  className={`rounded-xl border px-3 py-3 text-left transition ${
                    preferences.style === value
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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

      {activeSection === 'Connectors' && renderPlaceholder(<Link2 className="size-5" />, t('Connect CRM, calendar, knowledge bases, and more.', 'Verbinde CRM, Kalender, Wissensdatenbanken und mehr.'))}
      {activeSection === 'Account' && renderPlaceholder(<KeyRound className="size-5" />, t('Email, password, and two-factor authentication.', 'E-Mail, Passwort und Zwei-Faktor-Authentifizierung.'))}
      {activeSection === 'Privacy' && renderPlaceholder(<Shield className="size-5" />, t('Data sharing, retention, and deletion policies.', 'Datenfreigaben, Aufbewahrung und Loeschrichtlinien.'))}
      {activeSection === 'Developer' && renderPlaceholder(<Code2 className="size-5" />, t('API keys, logs, and debugging tools.', 'API-Schluessel, Logs und Debugging-Werkzeuge.'))}
    </section>
  );
}
