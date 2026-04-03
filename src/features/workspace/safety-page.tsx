import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Search, Shield, ShieldAlert, ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';

import type { SafetyPermissionScope, SafetyRiskLevel } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { loadSafetyScopes, saveSafetyScopes } from '@/lib/safety-policy';

type SafetyPageProps = {
  gatewayConnected: boolean;
  projectId?: string;
  projectTitle?: string;
};

const RISK_META: Record<SafetyRiskLevel, { label: string; badge: string; section: string }> = {
  low: {
    label: 'Low',
    badge: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    section: 'text-emerald-700 dark:text-emerald-300',
  },
  medium: {
    label: 'Medium',
    badge: 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300',
    section: 'text-amber-700 dark:text-amber-300',
  },
  high: {
    label: 'High',
    badge: 'border-orange-500/35 bg-orange-500/12 text-orange-700 dark:text-orange-300',
    section: 'text-orange-700 dark:text-orange-300',
  },
  critical: {
    label: 'Critical',
    badge: 'border-destructive/35 bg-destructive/10 text-destructive',
    section: 'text-destructive',
  },
};

const RISK_ORDER: SafetyRiskLevel[] = ['critical', 'high', 'medium', 'low'];

export function SafetyPage({ gatewayConnected, projectId, projectTitle }: SafetyPageProps) {
  const [scopes, setScopes] = useState<SafetyPermissionScope[]>(() => loadSafetyScopes(projectId));
  const [filterQuery, setFilterQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<SafetyRiskLevel | 'all'>('all');

  useEffect(() => {
    setScopes(loadSafetyScopes(projectId));
  }, [projectId]);

  const persistScopes = useCallback(
    (updated: SafetyPermissionScope[]) => {
      setScopes(updated);
      saveSafetyScopes(updated, projectId);
    },
    [projectId],
  );

  const toggleScopeEnabled = useCallback(
    (id: string) => {
      const updated = scopes.map((scope) => (scope.id === id ? { ...scope, enabled: !scope.enabled } : scope));
      persistScopes(updated);
    },
    [persistScopes, scopes],
  );

  const toggleScopeApproval = useCallback(
    (id: string) => {
      const updated = scopes.map((scope) => (scope.id === id ? { ...scope, requiresApproval: !scope.requiresApproval } : scope));
      persistScopes(updated);
    },
    [persistScopes, scopes],
  );

  const stats = useMemo(() => {
    const enabled = scopes.filter((scope) => scope.enabled).length;
    const approvals = scopes.filter((scope) => scope.enabled && scope.requiresApproval).length;
    const highRiskEnabled = scopes.filter((scope) => scope.enabled && (scope.riskLevel === 'high' || scope.riskLevel === 'critical')).length;
    return { enabled, approvals, highRiskEnabled };
  }, [scopes]);

  const filteredScopes = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    return scopes
      .filter((scope) => (riskFilter === 'all' ? true : scope.riskLevel === riskFilter))
      .filter((scope) => {
        if (!query) {
          return true;
        }
        return scope.name.toLowerCase().includes(query) || scope.description.toLowerCase().includes(query);
      });
  }, [filterQuery, riskFilter, scopes]);

  const groupedScopes = useMemo(() => {
    const groups: Record<SafetyRiskLevel, SafetyPermissionScope[]> = {
      low: [],
      medium: [],
      high: [],
      critical: [],
    };
    for (const scope of filteredScopes) {
      groups[scope.riskLevel].push(scope);
    }
    return groups;
  }, [filteredScopes]);

  return (
    <section className="mx-auto grid h-full w-full max-w-[1100px] min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-3 p-4">
      <header className="rounded-2xl border border-border/60 bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Shield className="size-5 text-blue-600" />
          <h1 className="text-xl font-semibold tracking-tight">Safety and approvals</h1>
          <Badge variant="outline" className="rounded-full text-[10px]">
            {projectId ? projectTitle?.trim() || 'Selected project' : 'Global'}
          </Badge>
          <Badge
            variant="outline"
            className={`rounded-full text-[10px] ${
              gatewayConnected
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300'
            }`}
          >
            {gatewayConnected ? 'Gateway connected' : 'Gateway offline'}
          </Badge>
        </div>
        <p className="mt-1 font-sans text-sm text-muted-foreground">
          Define exactly what the agent can do, and whether each action runs automatically or needs human approval.
        </p>
      </header>

      <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
        <p className="font-sans text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">Rule behavior:</span> Enabled + Automatic = executes immediately. Enabled + Approval required = asks first. Disabled = blocked.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-border/60 bg-card p-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/50 bg-background px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-emerald-600" />
            <span className="font-sans text-[11px] text-muted-foreground">Enabled rules</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground">{stats.enabled}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <Lock className="size-3.5 text-amber-500" />
            <span className="font-sans text-[11px] text-muted-foreground">Need approval</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground">{stats.approvals}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="size-3.5 text-destructive" />
            <span className="font-sans text-[11px] text-muted-foreground">High/critical enabled</span>
          </div>
          <p className={`mt-1 text-sm font-semibold ${stats.highRiskEnabled > 0 ? 'text-destructive' : 'text-foreground'}`}>{stats.highRiskEnabled}</p>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3">
        <div className="flex min-h-0 flex-col rounded-xl border border-border/60 bg-card">
          <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
            <Search className="size-3.5 text-muted-foreground/60" />
            <Input
              type="text"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Search permissions..."
              className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
            />
            {filterQuery.trim() ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setFilterQuery('')}>
                Clear
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {(['all', 'low', 'medium', 'high', 'critical'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`rounded-md px-2 py-1 font-sans text-[11px] transition-colors ${
                    riskFilter === level ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                  }`}
                  onClick={() => setRiskFilter(level)}
                >
                  {level === 'all' ? 'All' : RISK_META[level].label}
                </button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3">
              {filteredScopes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background px-3 py-8 text-center">
                  <p className="font-sans text-sm text-muted-foreground">No permissions match your current filter.</p>
                </div>
              ) : null}

              {RISK_ORDER.map((riskLevel) => {
                const scopesInGroup = groupedScopes[riskLevel];
                if (scopesInGroup.length === 0) {
                  return null;
                }
                const risk = RISK_META[riskLevel];
                return (
                  <div key={riskLevel} className="mb-3 last:mb-0">
                    <div className="mb-1.5 flex items-center gap-2 px-1">
                      <span className={`font-sans text-[11px] font-semibold uppercase tracking-wider ${risk.section}`}>{risk.label} risk</span>
                      <span className="font-sans text-[10px] text-muted-foreground">({scopesInGroup.length})</span>
                    </div>

                    <div className="grid gap-1.5">
                      {scopesInGroup.map((scope) => (
                        <div
                          key={scope.id}
                          className={`rounded-lg border px-3 py-2 ${
                            scope.enabled ? 'border-border/60 bg-background' : 'border-border/40 bg-background opacity-65'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-sans text-[13px] font-medium text-foreground">{scope.name}</p>
                              <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">{scope.description}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={`font-sans text-[9px] ${
                                    scope.enabled
                                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                      : 'border-border bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {scope.enabled ? 'Enabled' : 'Disabled'}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`font-sans text-[9px] ${
                                    scope.requiresApproval
                                      ? 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300'
                                      : 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                                  }`}
                                >
                                  {scope.requiresApproval ? 'Approval required' : 'Automatic'}
                                </Badge>
                                <Badge variant="outline" className={`font-sans text-[9px] ${risk.badge}`}>
                                  {risk.label}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={scope.enabled ? 'outline' : 'default'}
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => toggleScopeEnabled(scope.id)}
                                >
                                  {scope.enabled ? <ToggleRight className="mr-1 size-3.5 text-emerald-600" /> : <ToggleLeft className="mr-1 size-3.5" />}
                                  {scope.enabled ? 'Disable' : 'Enable'}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => toggleScopeApproval(scope.id)}
                                  disabled={!scope.enabled}
                                  title={!scope.enabled ? 'Enable this rule first' : undefined}
                                >
                                  <Lock className="mr-1 size-3.5" />
                                  {scope.requiresApproval ? 'Set automatic' : 'Require approval'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

      </div>
    </section>
  );
}
