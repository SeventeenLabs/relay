import { useState, useCallback, useMemo, useEffect } from 'react';
import type { FormEvent } from 'react';

import type { GatewayDiscoveryResult, HealthCheckResult } from '@/app-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type OnboardingStep = 'welcome' | 'connect' | 'pairing' | 'ready';

type DiscoveryState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'done'; result: GatewayDiscoveryResult };

type OnboardingPageProps = {
  draftGatewayUrl: string;
  draftGatewayToken: string;
  health: HealthCheckResult | null;
  saving: boolean;
  pairingRequestId: string | null;
  onDraftGatewayUrlChange: (value: string) => void;
  onDraftGatewayTokenChange: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onComplete: () => void;
};

/* ── Inline brand mark (track logo from branding system) ── */
function RelayMark({ size = 48 }: { size?: number }) {
  const primary = 'var(--app-primary)';
  const primaryForeground = 'var(--app-primary-foreground)';
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <rect width="256" height="256" rx="58" fill={primary} />
      <rect x="44" y="54" width="56" height="120" rx="28" fill={primaryForeground} />
      <rect x="156" y="54" width="56" height="120" rx="28" fill={primaryForeground} />
      <rect x="98" y="88" width="68" height="52" rx="24" fill={primaryForeground} />
      <path d="M118 114H182" stroke={primary} strokeWidth="9" strokeLinecap="round" />
      <path d="M170 102L186 114L170 126" stroke={primary} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Step indicator ── */
const STEP_LABELS = ['Welcome', 'Connect', 'Ready'] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-10 flex items-center justify-center gap-1">
      {STEP_LABELS.map((label, i) => {
        const isActive = i === current;
        const isDone = i < current;
        return (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && (
              <div className={`mx-1 h-px w-6 transition-colors duration-300 ${isDone ? 'bg-primary' : 'bg-border'}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-[0_0_0_3px_hsl(var(--primary)/0.2)]'
                    : isDone
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground/50'
                }`}
              >
                {isDone ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`font-sans text-xs font-medium transition-colors duration-300 ${
                  isActive ? 'text-foreground' : isDone ? 'text-primary' : 'text-muted-foreground/50'
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Primary CTA button ── */
function PrimaryButton({
  children,
  disabled,
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      disabled={disabled}
      className={cn(
        'h-11 w-full border-0 bg-primary font-sans text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function OnboardingPage({
  draftGatewayUrl,
  draftGatewayToken,
  health,
  saving,
  pairingRequestId,
  onDraftGatewayUrlChange,
  onDraftGatewayTokenChange,
  onSave,
  onComplete,
}: OnboardingPageProps) {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [copied, setCopied] = useState(false);
  const [connectAttempted, setConnectAttempted] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryState>({ status: 'idle' });
  const [showToken, setShowToken] = useState(false);

  // Auto-discover gateway on mount
  useEffect(() => {
    const bridge = window.relay;
    if (!bridge?.discoverGateway) return;

    let cancelled = false;
    setDiscovery({ status: 'scanning' });

    bridge.discoverGateway().then((result) => {
      if (cancelled) return;
      setDiscovery({ status: 'done', result });

      if (result.found && result.gatewayUrl) {
        onDraftGatewayUrlChange(result.gatewayUrl);
      }
    }).catch(() => {
      if (!cancelled) setDiscovery({ status: 'idle' });
    });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleConnect = (event: FormEvent) => {
    event.preventDefault();
    setConnectAttempted(true);
    onSave(event);
  };

  const needsPairing = connectAttempted && !saving && health && !health.ok && effectivePairingId;
  const isConnected = health?.ok === true;

  const visibleStep: OnboardingStep = (() => {
    if (isConnected) return 'ready';
    if (needsPairing) return 'pairing';
    if (step === 'welcome') return 'welcome';
    return 'connect';
  })();

  const stepIndex = { welcome: 0, connect: 1, pairing: 1, ready: 2 }[visibleStep];

  return (
    <main className="relative grid h-full place-items-center overflow-auto">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-32 -top-32 h-[480px] w-[480px] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-[360px] w-[360px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-[480px] px-6">
        <StepIndicator current={stepIndex} />

        {/* ── Welcome ── */}
        {visibleStep === 'welcome' && (
          <div className="flex flex-col items-center text-center">
            <div className="mb-6">
              <RelayMark size={64} />
            </div>

            <h1 className="mb-2 font-sans text-[28px] font-bold leading-tight tracking-tight text-foreground">
              Welcome to Relay
            </h1>
            <p className="mb-2 max-w-[340px] font-sans text-[15px] leading-relaxed text-muted-foreground">
              AI operations with human control.
              <br />
              Connect your OpenClaw gateway to get started.
            </p>

            {/* Discovery states */}
            <div className="mb-8 mt-4 w-full max-w-[360px]">
              {discovery.status === 'scanning' && (
                <div className="flex items-center justify-center gap-2.5 rounded-xl border border-border bg-muted/30 px-5 py-3">
                  <svg className="h-4 w-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <span className="font-sans text-[13px] text-muted-foreground">
                    Looking for OpenClaw on your machine…
                  </span>
                </div>
              )}

              {discovery.status === 'done' && discovery.result.found && (
                <div className="rounded-xl border border-primary/30 bg-primary/10 px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <p className="font-sans text-[13px] font-semibold text-foreground">
                        Gateway detected
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {discovery.result.gatewayUrl}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {discovery.status === 'done' && !discovery.result.found && discovery.result.binaryFound && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                        <path d="M12 9v4m0 4h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <p className="font-sans text-[13px] font-semibold text-foreground">
                        OpenClaw installed but not running
                      </p>
                      <p className="mt-0.5 font-sans text-[12px] leading-relaxed text-muted-foreground">
                        Start it with{' '}
                        <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">openclaw</code>
                        {' '}or connect to a remote gateway.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {(discovery.status === 'idle' ||
                (discovery.status === 'done' && !discovery.result.found && !discovery.result.binaryFound)) && (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 px-5 py-3">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-muted-foreground/60">
                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 16v-4m0-4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="font-sans text-[13px] text-muted-foreground">
                    Enter your gateway details to connect.
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="w-full max-w-[320px]">
              {discovery.status === 'done' && discovery.result.found ? (
                <>
                  <PrimaryButton
                    onClick={(e) => {
                      setConnectAttempted(true);
                      onSave(e as unknown as FormEvent);
                    }}
                    disabled={saving}
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                        Connecting…
                      </span>
                    ) : (
                      'Connect now'
                    )}
                  </PrimaryButton>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1.5 font-sans text-[13px] font-medium text-foreground/70 underline underline-offset-4 decoration-foreground/30 transition-colors hover:text-foreground hover:decoration-foreground"
                    onClick={() => setStep('connect')}
                  >
                    Use a different gateway
                  </button>
                </>
              ) : (
                <PrimaryButton
                  disabled={discovery.status === 'scanning'}
                  onClick={() => setStep('connect')}
                >
                  {discovery.status === 'scanning' ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                      Scanning…
                    </span>
                  ) : (
                    'Get started'
                  )}
                </PrimaryButton>
              )}
            </div>

            {connectAttempted && !saving && health && !health.ok && !effectivePairingId && (
              <div className="mt-4 w-full max-w-[360px] rounded-xl border border-destructive/20 bg-destructive/[0.04] px-4 py-3 text-left">
                <p className="font-sans text-[13px] font-semibold text-destructive">Connection failed</p>
                <p className="mt-1 font-sans text-[12px] leading-relaxed text-destructive/70">
                  {health.message}
                </p>
              </div>
            )}

            <p className="mt-6 font-sans text-[11px] text-muted-foreground/40">
              Settings can be changed anytime from Preferences.
            </p>
          </div>
        )}

        {/* ── Connect ── */}
        {visibleStep === 'connect' && (
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="mb-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
                  <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="font-sans text-lg font-bold tracking-tight text-foreground">
                Connect to your gateway
              </h2>
              <p className="mt-1 font-sans text-[13px] leading-relaxed text-muted-foreground">
                Enter your OpenClaw gateway URL and optional access token.
              </p>
            </div>

            <form className="grid gap-4" onSubmit={handleConnect}>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-sans text-[12px] font-medium text-foreground">
                  Gateway URL
                  <span className="relative ml-0.5 inline-flex group">
                    <span className="flex h-4 w-4 cursor-default items-center justify-center rounded-full border border-muted-foreground/30 bg-muted text-[10px] font-semibold text-muted-foreground select-none">
                      ?
                    </span>
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2.5 font-normal text-[12px] leading-relaxed text-popover-foreground shadow-md opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      The URL of your running OpenClaw gateway. Use <code className="rounded bg-muted px-1 font-mono text-[11px]">http://localhost:18789</code> for a local instance, or your VPS/server address for a remote one.
                    </span>
                  </span>
                </label>
                <Input
                  value={draftGatewayUrl}
                  onChange={(event) => onDraftGatewayUrlChange(event.target.value)}
                  placeholder="e.g. http://localhost:18789 or https://your-vps.com"
                  className="h-10 font-mono text-[13px]"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-sans text-[12px] font-medium text-foreground">
                  Access token
                  <span className="font-normal text-muted-foreground">(optional)</span>
                  <span className="relative ml-0.5 inline-flex group">
                    <span className="flex h-4 w-4 cursor-default items-center justify-center rounded-full border border-muted-foreground/30 bg-muted text-[10px] font-semibold text-muted-foreground select-none">
                      ?
                    </span>
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2.5 font-normal text-[12px] leading-relaxed text-popover-foreground shadow-md opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      Found in your <code className="rounded bg-muted px-1 font-mono text-[11px]">openclaw.json</code> file under <code className="rounded bg-muted px-1 font-mono text-[11px]">gateway → auth → token</code>. Leave blank if your gateway has no token auth enabled.
                    </span>
                  </span>
                </label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={draftGatewayToken}
                    onChange={(event) => onDraftGatewayTokenChange(event.target.value)}
                    placeholder="Paste your access token"
                    className="h-10 pr-10 font-mono text-[13px]"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                  >
                    {showToken ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Connection error */}
              {connectAttempted && !saving && health && !health.ok && !effectivePairingId && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/[0.04] px-4 py-3">
                  <p className="font-sans text-[13px] font-semibold text-destructive">Connection failed</p>
                  <p className="mt-1 font-sans text-[12px] leading-relaxed text-destructive/70">
                    {health.message}
                  </p>
                </div>
              )}

              <div className="mt-2 flex gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-none px-5 font-sans text-[13px]"
                  onClick={() => {
                    setStep('welcome');
                    setConnectAttempted(false);
                  }}
                >
                  Back
                </Button>
                <PrimaryButton type="submit" disabled={saving} className="h-10 flex-1 w-auto">
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                      Connecting…
                    </span>
                  ) : (
                    'Connect'
                  )}
                </PrimaryButton>
              </div>
            </form>
          </div>
        )}

        {/* ── Pairing ── */}
        {visibleStep === 'pairing' && (
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="mb-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
                  <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="16" r="1" fill="currentColor" />
                </svg>
              </div>
              <h2 className="font-sans text-lg font-bold tracking-tight text-foreground">
                Approve this device
              </h2>
              <p className="mt-1 font-sans text-[13px] leading-relaxed text-muted-foreground">
                Your gateway requires device approval. Run this command on your gateway host:
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-1">
              <div className="flex items-center justify-between rounded-lg bg-background px-4 py-3">
                <code className="font-mono text-[12px] leading-none text-foreground select-all">
                  openclaw devices approve {effectivePairingId}
                </code>
                <button
                  type="button"
                  className="ml-3 shrink-0 rounded-lg border border-border bg-background px-2.5 py-1.5 font-sans text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={copyCommand}
                >
                  {copied ? (
                    <span className="flex items-center gap-1 text-primary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Copied
                    </span>
                  ) : (
                    'Copy'
                  )}
                </button>
              </div>
            </div>

            <p className="mt-4 font-sans text-[12px] leading-relaxed text-muted-foreground">
              After running the command, click below to reconnect.
            </p>

            <div className="mt-5 flex gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-10 flex-none px-5 font-sans text-[13px]"
                onClick={() => {
                  setStep('connect');
                  setConnectAttempted(false);
                }}
              >
                Back
              </Button>
              <PrimaryButton
                type="button"
                disabled={saving}
                className="h-10 flex-1 w-auto"
                onClick={(e) => handleConnect(e as unknown as FormEvent)}
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    Reconnecting…
                  </span>
                ) : (
                  'Reconnect'
                )}
              </PrimaryButton>
            </div>
          </div>
        )}

        {/* ── Ready ── */}
        {visibleStep === 'ready' && (
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            <h2 className="mb-2 font-sans text-[28px] font-bold leading-tight tracking-tight text-foreground">
              You're all set
            </h2>
            <p className="mb-2 font-sans text-[15px] leading-relaxed text-muted-foreground">
              Relay is connected to your OpenClaw gateway.
            </p>

            {health?.message && (
              <div className="mb-8 mt-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="font-mono text-[11px] text-primary">
                  {health.message}
                </span>
              </div>
            )}

            <div className="mt-4 w-full max-w-[320px]">
              <PrimaryButton onClick={onComplete}>
                Start using Relay
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
