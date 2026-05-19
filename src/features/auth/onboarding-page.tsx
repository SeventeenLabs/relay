import { type ComponentProps, useState } from 'react';
import type { FormEvent } from 'react';

import type { HealthCheckResult, HermesTransport } from '@/app-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import relayLogo from '@/assets/relay-logo.png';

type OnboardingStep = 'welcome' | 'connect' | 'ready';

type OnboardingPageProps = {
  draftHermesEndpoint: string;
  draftHermesToken: string;
  transport: HermesTransport;
  health: HealthCheckResult | null;
  saving: boolean;
  ondraftHermesEndpointChange: (value: string) => void;
  ondraftHermesTokenChange: (value: string) => void;
  onTransportChange: (value: HermesTransport) => void;
  onSave: (event: FormEvent) => void;
  onTestConnection: () => void | Promise<void>;
  testingConnection: boolean;
  onQuickConnectHermes: () => void | Promise<void>;
  onOpenSettings: () => void;
  onComplete: () => void;
};

function RelayMark({ size = 48 }: { size?: number }) {
  return <img src={relayLogo} alt="Relay logo" width={size} height={size} className="rounded-2xl" style={{ width: size, height: size }} />;
}

const STEP_LABELS = ['Welcome', 'Connect', 'Ready'] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-10 flex items-center justify-center gap-1">
      {STEP_LABELS.map((label, i) => {
        const isActive = i === current;
        const isDone = i < current;
        return (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && <div className={`mx-1 h-px w-6 transition-colors duration-300 ${isDone ? 'bg-primary' : 'bg-border'}`} />}
            <div className="flex items-center gap-1.5">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300 ${isActive ? 'bg-primary text-primary-foreground shadow-[0_0_0_3px_hsl(var(--primary)/0.2)]' : isDone ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground/50'}`}>
                {isDone ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`font-sans text-xs font-medium transition-colors duration-300 ${isActive ? 'text-foreground' : isDone ? 'text-primary' : 'text-muted-foreground/50'}`}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PrimaryButton({ children, disabled, className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button disabled={disabled} className={cn('h-11 w-full border-0 bg-primary font-sans text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50', className)} {...props}>
      {children}
    </Button>
  );
}

export function OnboardingPage({
  draftHermesEndpoint,
  draftHermesToken,
  transport,
  health,
  saving,
  ondraftHermesEndpointChange,
  ondraftHermesTokenChange,
  onTransportChange,
  onSave,
  onTestConnection,
  testingConnection,
  onQuickConnectHermes,
  onOpenSettings,
  onComplete,
}: OnboardingPageProps) {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [connectAttempted, setConnectAttempted] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const handleConnect = (event: FormEvent) => {
    event.preventDefault();
    setConnectAttempted(true);
    onSave(event);
  };

  const isConnected = health?.ok === true;
  const visibleStep: OnboardingStep = isConnected ? 'ready' : step === 'welcome' ? 'welcome' : 'connect';
  const stepIndex = { welcome: 0, connect: 1, ready: 2 }[visibleStep];

  return (
    <main className="relative grid h-full place-items-center overflow-auto">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-32 -top-32 h-[480px] w-[480px] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-[360px] w-[360px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-[480px] px-6">
        <StepIndicator current={stepIndex} />

        {visibleStep === 'welcome' && (
          <div className="flex flex-col items-center text-center">
            <div className="mb-6"><RelayMark size={64} /></div>
            <h1 className="mb-2 font-sans text-[28px] font-bold leading-tight tracking-tight text-foreground">Welcome to Relay</h1>
            <p className="mb-2 max-w-[340px] font-sans text-[15px] leading-relaxed text-muted-foreground">AI operations with human control.<br />Connect to Hermes to get started.</p>
            <div className="mb-8 mt-4 w-full max-w-[360px] rounded-xl border border-primary/25 bg-primary/5 px-5 py-3.5 text-left">
              <p className="font-sans text-[13px] font-semibold text-foreground">Hermes connection</p>
              <p className="mt-0.5 font-sans text-[12px] leading-relaxed text-muted-foreground">Enter your Hermes endpoint and token below.</p>
            </div>
            <div className="w-full max-w-[360px]">
              <PrimaryButton type="button" disabled={saving} onClick={() => { setConnectAttempted(true); void onQuickConnectHermes(); }}>
                {saving ? 'Connecting…' : 'Connect Hermes'}
              </PrimaryButton>
              <button type="button" className="mt-3 inline-flex items-center gap-1.5 font-sans text-[13px] font-medium text-foreground/70 underline underline-offset-4 decoration-foreground/30 transition-colors hover:text-foreground hover:decoration-foreground" onClick={() => setStep('connect')}>
                Advanced manual setup
              </button>
              <button type="button" className="mt-2 block font-sans text-[12px] text-muted-foreground underline underline-offset-4" onClick={onOpenSettings}>
                Open app settings
              </button>
            </div>
            {connectAttempted && !saving && health && !health.ok && (
              <div className="mt-4 w-full max-w-[360px] rounded-xl border border-destructive/20 bg-destructive/[0.04] px-4 py-3 text-left">
                <p className="font-sans text-[13px] font-semibold text-destructive">Connection failed</p>
                <p className="mt-1 font-sans text-[12px] leading-relaxed text-destructive/70">{health.message}</p>
              </div>
            )}
          </div>
        )}

        {visibleStep === 'connect' && (
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="mb-6">
              <h2 className="font-sans text-lg font-bold tracking-tight text-foreground">Connect to your backend</h2>
              <p className="mt-1 font-sans text-[13px] leading-relaxed text-muted-foreground">Enter your Hermes endpoint and optional token.</p>
            </div>
            <form className="grid gap-4" onSubmit={handleConnect}>
                <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-sans text-[12px] font-medium text-foreground">Transport</label>
                <Input
                  className="h-10 font-sans text-[13px]"
                  value="Local Hermes (auto-detect Windows/WSL)"
                  readOnly
                />
                </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-sans text-[12px] font-medium text-foreground">Hermes endpoint</label>
                <Input
                  value={draftHermesEndpoint}
                  onChange={(event) => ondraftHermesEndpointChange(event.target.value)}
                    placeholder={'http://127.0.0.1:8642/v1'}
                  className="h-10 font-mono text-[13px]"
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-sans text-[12px] font-medium text-foreground">Access token <span className="font-normal text-muted-foreground">(optional)</span></label>
                <div className="relative">
                  <Input type={showToken ? 'text' : 'password'} value={draftHermesToken} onChange={(event) => ondraftHermesTokenChange(event.target.value)} placeholder="Paste your access token" className="h-10 pr-10 font-mono text-[13px]" />
                  <button type="button" tabIndex={-1} onClick={() => setShowToken((v) => !v)} className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground" aria-label={showToken ? 'Hide token' : 'Show token'}>
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {connectAttempted && !saving && health && !health.ok && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/[0.04] px-4 py-3">
                  <p className="font-sans text-[13px] font-semibold text-destructive">Connection failed</p>
                  <p className="mt-1 font-sans text-[12px] leading-relaxed text-destructive/70">{health.message}</p>
                </div>
              )}
              <div className="mt-2 flex gap-2.5">
                <Button type="button" variant="outline" className="h-10 flex-none px-5 font-sans text-[13px]" onClick={() => { setStep('welcome'); setConnectAttempted(false); }}>Back</Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-none px-5 font-sans text-[13px]"
                  disabled={saving || testingConnection}
                  onClick={() => {
                    setConnectAttempted(true);
                    void onTestConnection();
                  }}
                >
                  {testingConnection ? 'Testing…' : 'Test'}
                </Button>
                <PrimaryButton type="submit" disabled={saving || testingConnection} className="h-10 flex-1 w-auto">{saving ? 'Connecting…' : 'Connect'}</PrimaryButton>
              </div>
            </form>
          </div>
        )}

        {visibleStep === 'ready' && (
          <div className="flex flex-col items-center text-center">
            <h2 className="mb-2 font-sans text-[28px] font-bold leading-tight tracking-tight text-foreground">You're all set</h2>
            <p className="mb-2 font-sans text-[15px] leading-relaxed text-muted-foreground">Relay is connected to your backend.</p>
            {health?.message && <div className="mb-8 mt-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5"><span className="font-mono text-[11px] text-primary">{health.message}</span></div>}
            <div className="mt-4 w-full max-w-[320px]"><PrimaryButton onClick={onComplete}>Start using Relay</PrimaryButton></div>
          </div>
        )}
      </div>
    </main>
  );
}


