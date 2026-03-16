import type { FormEvent } from 'react';

import type { AppConfig, BackendMode, HealthCheckResult } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type SettingsPageProps = {
  config: AppConfig;
  draftUrl: string;
  health: HealthCheckResult | null;
  status: string;
  saving: boolean;
  checking: boolean;
  hasBridge: boolean;
  onModeChange: (mode: BackendMode) => void;
  onDraftUrlChange: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onHealthCheck: () => void | Promise<void>;
};

export function SettingsPage({
  config,
  draftUrl,
  health,
  status,
  saving,
  checking,
  hasBridge,
  onModeChange,
  onDraftUrlChange,
  onSave,
  onHealthCheck,
}: SettingsPageProps) {
  return (
    <section className="mx-auto w-full max-w-[860px]">
      <div className="mb-4">
        <Badge variant="outline" className="mb-2 font-sans text-[11px] text-muted-foreground">
          Settings
        </Badge>
        <h1 className="mb-1 text-[clamp(1.55rem,2.4vw,2rem)] tracking-tight">Workspace settings</h1>
        <p className="font-sans text-sm text-muted-foreground">Configure backend routing, validate connectivity, and save your defaults.</p>
      </div>

      <Card className="rounded-xl border-border bg-card shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardHeader className="mb-1 flex flex-row items-center justify-between gap-2 border-b border-border/70 pb-3">
          <CardTitle>Backend routing</CardTitle>
          <Badge
            variant="outline"
            className={
              health?.ok
                ? 'rounded-full border border-[rgba(47,122,88,0.35)] bg-[rgba(47,122,88,0.08)] font-sans text-[11px] text-[#2f7a58]'
                : 'rounded-full font-sans text-[11px]'
            }
          >
            {health?.ok ? 'Connected' : 'Unchecked'}
          </Badge>
        </CardHeader>

        <CardContent className="pt-1">
          <form className="grid gap-3" onSubmit={onSave}>
            <label>
              <span className="mb-1 block font-sans text-xs text-muted-foreground">Backend mode</span>
              <div className="grid grid-cols-3 gap-2">
                {(['local', 'vps', 'custom'] as BackendMode[]).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant="outline"
                    className={mode === config.mode ? 'bg-muted' : ''}
                    onClick={() => onModeChange(mode)}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            </label>

            <label>
              <span className="mb-1 block font-sans text-xs text-muted-foreground">Base URL</span>
              <Input
                type="url"
                value={draftUrl}
                onChange={(event) => onDraftUrlChange(event.target.value)}
                placeholder="https://your-openclaw-host"
                className="font-sans"
              />
            </label>

            <div className="flex items-end gap-2 max-sm:flex-col max-sm:items-stretch">
              <Button className="flex-1 border-0 bg-[linear-gradient(120deg,#ea9f7d,#de825e)] text-[#fffefb]" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save configuration'}
              </Button>
              <Button className="flex-1" variant="outline" type="button" onClick={() => void onHealthCheck()} disabled={checking || !hasBridge}>
                {checking ? 'Checking...' : 'Test connection'}
              </Button>
            </div>
          </form>

          <div className="mt-3 grid gap-2 rounded-xl border border-dashed border-border p-3">
            <p className="font-sans text-sm text-muted-foreground">{status}</p>
            {!hasBridge && (
              <p className="font-sans text-sm text-muted-foreground">
                Bridge unavailable. Open in Electron to enable persistence and health checks.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
