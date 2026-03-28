import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileWarning,
  Lock,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { SafetyPermissionScope, SafetyRiskLevel } from '@/app-types';
import { loadSafetyScopes, saveSafetyScopes } from '@/lib/safety-policy';

type SafetyPageProps = {
  gatewayConnected: boolean;
  projectId?: string;
  projectTitle?: string;
};

type PendingAction = {
  id: string;
  type: string;
  description: string;
  riskLevel: SafetyRiskLevel;
  agent: string;
  timestamp: number;
  preview?: string;
  status: 'pending' | 'approved' | 'rejected';
};

const RISK_CONFIG = {
  low: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/50', label: 'Low', badgeVariant: 'default' as const },
  medium: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800/50', label: 'Medium', badgeVariant: 'outline' as const },
  high: { color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200 dark:border-orange-800/50', label: 'High', badgeVariant: 'outline' as const },
  critical: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/50', label: 'Critical', badgeVariant: 'outline' as const },
} as const;

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function SafetyPage({ gatewayConnected, projectId, projectTitle }: SafetyPageProps) {
  const [scopes, setScopes] = useState<SafetyPermissionScope[]>(() => loadSafetyScopes(projectId));
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<SafetyRiskLevel | 'all'>('all');
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(new Set());

  const persistScopes = useCallback((updated: SafetyPermissionScope[]) => {
    setScopes(updated);
    saveSafetyScopes(updated, projectId);
  }, [projectId]);

  useEffect(() => {
    setScopes(loadSafetyScopes(projectId));
  }, [projectId]);

  const toggleScope = useCallback(
    (id: string) => {
      const updated = scopes.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      persistScopes(updated);
    },
    [scopes, persistScopes],
  );

  const toggleApproval = useCallback(
    (id: string) => {
      const updated = scopes.map((s) => (s.id === id ? { ...s, requiresApproval: !s.requiresApproval } : s));
      persistScopes(updated);
    },
    [scopes, persistScopes],
  );

  const handleActionDecision = useCallback(
    (id: string, decision: 'approved' | 'rejected') => {
      setPendingActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: decision } : a)));
    },
    [],
  );

  const stats = useMemo(() => {
    const enabled = scopes.filter((s) => s.enabled).length;
    const withApproval = scopes.filter((s) => s.requiresApproval).length;
    const highRisk = scopes.filter((s) => s.enabled && (s.riskLevel === 'high' || s.riskLevel === 'critical')).length;
    const pending = pendingActions.filter((a) => a.status === 'pending').length;
    return { enabled, withApproval, highRisk, pending };
  }, [scopes, pendingActions]);

  const filteredScopes = useMemo(() => {
    let result = scopes;
    if (riskFilter !== 'all') {
      result = result.filter((s) => s.riskLevel === riskFilter);
    }
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    return result;
  }, [scopes, riskFilter, filterQuery]);

  const groupedScopes = useMemo(() => {
    const groups: Record<SafetyRiskLevel, SafetyPermissionScope[]> = { low: [], medium: [], high: [], critical: [] };
    for (const scope of filteredScopes) {
      groups[scope.riskLevel].push(scope);
    }
    return groups;
  }, [filteredScopes]);

  const pendingCount = pendingActions.filter((a) => a.status === 'pending').length;

  return (
    <section className="mx-auto grid h-full w-full max-w-[1060px] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
      {/* Header */}
      <header>
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-blue-600" />
          <h1 className="text-xl font-semibold tracking-tight">Safety and approvals</h1>
        </div>
        <p className="mt-1 font-sans text-sm text-muted-foreground">
          Control what your agent is allowed to do. Require approvals for high-risk actions.
        </p>
        {projectId ? (
          <p className="mt-1 font-sans text-xs text-muted-foreground">
            Scope: {projectTitle?.trim() || 'Selected project'}
          </p>
        ) : null}
      </header>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          <span className="font-sans text-[12px] text-muted-foreground">{stats.enabled} active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Lock className="size-3.5 text-amber-500" />
          <span className="font-sans text-[12px] text-muted-foreground">{stats.withApproval} requiring approval</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        {stats.highRisk > 0 && (
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="size-3.5 text-red-500" />
            <span className="font-sans text-[12px] text-red-600">{stats.highRisk} high-risk active</span>
          </div>
        )}
        {pendingCount > 0 && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-amber-500" />
              <span className="font-sans text-[12px] font-medium text-amber-600">{pendingCount} pending</span>
            </div>
          </>
        )}
      </div>

      {/* Main content */}
      <div className="grid min-h-0 grid-cols-1 gap-3" style={{ gridTemplateColumns: pendingCount > 0 ? '1fr 320px' : '1fr' }}>
        {/* Permissions panel */}
        <div className="flex min-h-0 flex-col rounded-xl border border-border/60 bg-card">
          {/* Filter bar */}
          <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2">
            <Search className="size-3.5 text-muted-foreground/60" />
            <Input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search permissions..."
              className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
            />
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1">
              {(['all', 'low', 'medium', 'high', 'critical'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`rounded-md px-2 py-1 font-sans text-[11px] transition-colors ${
                    riskFilter === level ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                  }`}
                  onClick={() => setRiskFilter(level)}
                >
                  {level === 'all' ? 'All' : RISK_CONFIG[level].label}
                </button>
              ))}
            </div>
          </div>

          {/* Scopes list */}
          <ScrollArea className="flex-1">
            <div className="p-3">
              {(['critical', 'high', 'medium', 'low'] as const).map((riskLevel) => {
                const scopesInGroup = groupedScopes[riskLevel];
                if (scopesInGroup.length === 0) return null;
                const conf = RISK_CONFIG[riskLevel];

                return (
                  <div key={riskLevel} className="mb-3 last:mb-0">
                    <div className="mb-1.5 flex items-center gap-2 px-1">
                      <span className={`inline-block size-2 rounded-full ${conf.bg} ${conf.border} border`} />
                      <span className={`font-sans text-[11px] font-semibold uppercase tracking-wider ${conf.color}`}>
                        {conf.label} risk
                      </span>
                      <span className="font-sans text-[10px] text-muted-foreground">({scopesInGroup.length})</span>
                    </div>

                    <div className="grid gap-1">
                      {scopesInGroup.map((scope) => {
                        const isExpanded = expandedScopes.has(scope.id);
                        return (
                          <div
                            key={scope.id}
                            className={`rounded-lg border px-3 py-2 transition-colors ${
                              scope.enabled ? `${conf.border} ${conf.bg}` : 'border-border/40 bg-background opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="flex items-center gap-1"
                                onClick={() => {
                                  setExpandedScopes((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(scope.id)) next.delete(scope.id);
                                    else next.add(scope.id);
                                    return next;
                                  });
                                }}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="size-3 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="size-3 text-muted-foreground" />
                                )}
                              </button>
                              <span className="font-sans text-[13px] font-medium">{scope.name}</span>
                              {scope.requiresApproval && (
                                <Badge variant="outline" className="font-sans text-[9px] gap-0.5">
                                  <Lock className="size-2.5" />
                                  Approval
                                </Badge>
                              )}
                              <div className="ml-auto flex items-center gap-1">
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => toggleScope(scope.id)}
                                  title={scope.enabled ? 'Disable' : 'Enable'}
                                >
                                  {scope.enabled ? (
                                    <ToggleRight className="size-5 text-emerald-600" />
                                  ) : (
                                    <ToggleLeft className="size-5 text-muted-foreground/40" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="mt-2 pl-5">
                                <p className="font-sans text-[12px] text-muted-foreground">{scope.description}</p>
                                <div className="mt-2 flex items-center gap-3">
                                  <label className="flex cursor-pointer items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={scope.requiresApproval}
                                      onChange={() => toggleApproval(scope.id)}
                                      className="size-3.5 rounded border-border"
                                    />
                                    <span className="font-sans text-[11px] text-muted-foreground">
                                      Approval required (human in the loop)
                                    </span>
                                  </label>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Pending actions panel */}
        {pendingCount > 0 && (
          <div className="flex min-h-0 flex-col rounded-xl border border-amber-200 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/20">
            <div className="border-b border-amber-200/60 px-3 py-2.5 dark:border-amber-800/30">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-amber-600" />
                <span className="font-sans text-[12px] font-semibold text-amber-700 dark:text-amber-400">
                  Pending actions
                </span>
              </div>
              <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">
                Your agent is waiting for approval.
              </p>
            </div>
            <ScrollArea className="flex-1">
              <div className="grid gap-1.5 p-3">
                {pendingActions
                  .filter((a) => a.status === 'pending')
                  .map((action) => {
                    const conf = RISK_CONFIG[action.riskLevel];
                    return (
                      <div key={action.id} className="rounded-lg border border-border/60 bg-white p-2.5 dark:bg-background">
                        <div className="flex items-center gap-1.5">
                          <FileWarning className={`size-3.5 ${conf.color}`} />
                          <span className="font-sans text-[12px] font-medium">{action.type}</span>
                          <Badge variant={conf.badgeVariant} className="ml-auto font-sans text-[9px]">
                            {conf.label}
                          </Badge>
                        </div>
                        <p className="mt-1 font-sans text-[11px] text-muted-foreground">{action.description}</p>
                        {action.preview && (
                          <div className="mt-1.5 rounded border border-border/40 bg-muted/30 px-2 py-1">
                            <pre className="font-mono text-[10px] text-foreground/70">{action.preview}</pre>
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 text-[11px] text-emerald-600 hover:bg-emerald-50"
                            onClick={() => handleActionDecision(action.id, 'approved')}
                          >
                            <CheckCircle2 className="size-3" />
                            Approve
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 text-[11px] text-red-600 hover:bg-red-50"
                            onClick={() => handleActionDecision(action.id, 'rejected')}
                          >
                            <X className="size-3" />
                            Reject
                          </Button>
                          <button type="button" className="ml-auto" title="Preview">
                            <Eye className="size-3.5 text-muted-foreground hover:text-foreground" />
                          </button>
                        </div>
                        <span className="mt-1 block font-sans text-[10px] text-muted-foreground/60">
                          {timeAgo(action.timestamp)} · {action.agent}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </section>
  );
}
