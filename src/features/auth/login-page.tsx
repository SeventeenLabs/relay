import { useState } from 'react';
import type { FormEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type LoginCredentials = {
  email: string;
  password: string;
  rememberMe: boolean;
};

type LoginPageProps = {
  authenticating: boolean;
  errorMessage: string;
  onLogin: (credentials: LoginCredentials) => void | Promise<void>;
  onContinueAsGuest: () => void;
};

export function LoginPage({ authenticating, errorMessage, onLogin, onContinueAsGuest }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void onLogin({
      email: email.trim(),
      password,
      rememberMe,
    });
  };

  return (
    <main className="grid h-full place-items-center overflow-auto p-6">
      <Card className="w-full max-w-[480px] rounded-2xl border-border bg-card shadow-2xl">
        <CardHeader className="space-y-2 border-b border-border/70 pb-4">
          <Badge variant="outline" className="w-fit font-sans text-[11px] text-muted-foreground">
            Relay Login
          </Badge>
          <CardTitle className="text-[1.8rem] tracking-tight">Sign in to Relay</CardTitle>
          <p className="font-sans text-sm text-muted-foreground">Sign in with your workspace account (Supabase auth).</p>
        </CardHeader>

        <CardContent className="pt-4">
          <form className="grid gap-3" onSubmit={handleSubmit}>
            <label>
              <span className="mb-1 block font-sans text-xs text-muted-foreground">Work email</span>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="finance@company.com"
                autoComplete="email"
                className="font-sans"
              />
            </label>

            <label>
              <span className="mb-1 block font-sans text-xs text-muted-foreground">Password</span>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="font-sans"
              />
            </label>

            <label className="mt-1 inline-flex items-center gap-2 font-sans text-sm text-foreground">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-4 w-4 rounded border border-border accent-primary"
              />
              Remember me on this device
            </label>

            {errorMessage ? (
              <p className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 font-sans text-xs text-destructive">
                {errorMessage}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={authenticating}
              className="mt-1 h-10 border-0 font-sans text-sm"
            >
              {authenticating ? 'Signing in...' : 'Login'}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={authenticating}
              onClick={onContinueAsGuest}
              className="h-10 font-sans text-sm"
            >
              Continue in local mode
            </Button>

            <p className="text-center font-sans text-xs text-muted-foreground">
              Open-source mode works without an account. Sign in only for hosted cloud features.
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}