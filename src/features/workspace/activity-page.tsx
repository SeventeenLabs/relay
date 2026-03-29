import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Info,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { ChatMessage, ChatActivityItem } from '@/app-types';

type ActivityPageProps = {
  chatMessages: ChatMessage[];
  coworkMessages: ChatMessage[];
  activeSessionKey: string;
  coworkSessionKey: string;
  gatewayConnected: boolean;
};

type ActivityEntry = {
  id: string;
  timestamp: number;
  source: 'chat' | 'cowork';
  sessionKey: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  activities: ChatActivityItem[];
};

type ToneFilter = 'all' | 'success' | 'danger' | 'neutral';

function extractActivities(msg: ChatMessage): ChatActivityItem[] {
  if (msg.meta?.kind === 'activity' && Array.isArray(msg.meta.items)) {
    return msg.meta.items;
  }
  return [];
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const TONE_CONFIG = {
  success: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/50', label: 'Success' },
  danger: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/50', label: 'Error' },
  neutral: { icon: Info, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800/50', label: 'Info' },
} as const;

export function ActivityPage({
  chatMessages,
  coworkMessages,
  activeSessionKey,
  coworkSessionKey,
  gatewayConnected,
}: ActivityPageProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [toneFilter, setToneFilter] = useState<ToneFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'chat' | 'cowork'>('all');
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const entries = useMemo(() => {
    const all: ActivityEntry[] = [];
    let counter = 0;

    const processMessages = (messages: ChatMessage[], source: 'chat' | 'cowork', sessionKey: string) => {
      for (const msg of messages) {
        counter++;
        const activities = extractActivities(msg);
        all.push({
          id: `${source}-${counter}`,
          timestamp: Date.now() - (messages.length - counter) * 60_000,
          source,
          sessionKey,
          role: msg.role,
          text: msg.text,
          activities,
        });
      }
    };

    processMessages(chatMessages, 'chat', activeSessionKey);
    counter = 0;
    processMessages(coworkMessages, 'cowork', coworkSessionKey);

    return all.sort((a, b) => b.timestamp - a.timestamp);
  }, [chatMessages, coworkMessages, activeSessionKey, coworkSessionKey]);

  const filteredEntries = useMemo(() => {
    let result = entries;

    if (sourceFilter !== 'all') {
      result = result.filter((e) => e.source === sourceFilter);
    }
    if (toneFilter !== 'all') {
      result = result.filter((e) => e.activities.some((a) => a.tone === toneFilter));
    }
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.text.toLowerCase().includes(q) ||
          e.activities.some((a) => a.label.toLowerCase().includes(q) || a.details?.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [entries, sourceFilter, toneFilter, filterQuery]);

  const stats = useMemo(() => {
    const total = entries.length;
    const withActivity = entries.filter((e) => e.activities.length > 0).length;
    const successes = entries.filter((e) => e.activities.some((a) => a.tone === 'success')).length;
    const errors = entries.filter((e) => e.activities.some((a) => a.tone === 'danger')).length;
    return { total, withActivity, successes, errors };
  }, [entries]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <section className="grid h-full w-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4">
      {/* Header */}
      <header>
        <div className="flex items-center gap-2">
          <Zap className="size-5 text-amber-600" />
          <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
          <Badge variant="outline" className="ml-2 font-sans text-[11px]">
            {gatewayConnected ? 'Live' : 'Offline'}
          </Badge>
        </div>
        <p className="mt-1 font-sans text-sm text-muted-foreground">
          Real-time overview of all agent actions, tool calls, and system events.
        </p>
      </header>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-muted-foreground/60" />
          <span className="font-sans text-[12px] text-muted-foreground">{stats.total} events</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-emerald-600" />
          <span className="font-sans text-[12px] text-muted-foreground">{stats.successes} success</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="size-3.5 text-red-500" />
          <span className="font-sans text-[12px] text-muted-foreground">{stats.errors} errors</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-1.5">
          <Zap className="size-3.5 text-amber-500" />
          <span className="font-sans text-[12px] text-muted-foreground">{stats.withActivity} with tool calls</span>
        </div>
      </div>

      {/* Filter bar + timeline */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border/60 bg-card">
        {/* Filters */}
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2">
          <Search className="size-3.5 text-muted-foreground/60" />
          <Input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Search activity..."
            className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
          />
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1">
            {(['all', 'chat', 'cowork'] as const).map((src) => (
              <button
                key={src}
                type="button"
                className={`rounded-md px-2 py-1 font-sans text-[11px] transition-colors ${
                  sourceFilter === src ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                }`}
                onClick={() => setSourceFilter(src)}
              >
                {src === 'all' ? 'All' : src === 'chat' ? 'Chat' : 'Cowork'}
              </button>
            ))}
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1">
            {(['all', 'success', 'danger', 'neutral'] as const).map((tone) => (
              <button
                key={tone}
                type="button"
                className={`rounded-md px-2 py-1 font-sans text-[11px] transition-colors ${
                  toneFilter === tone ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                }`}
                onClick={() => setToneFilter(tone)}
              >
                {tone === 'all' ? 'All' : TONE_CONFIG[tone].label}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <ScrollArea className="flex-1">
          {filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Zap className="mb-3 size-8 text-muted-foreground/30" />
              <p className="font-sans text-sm text-muted-foreground">
                {filterQuery || toneFilter !== 'all' || sourceFilter !== 'all'
                  ? 'No matches for this filter.'
                  : 'No activity yet. Start a chat or a cowork task.'}
              </p>
            </div>
          ) : (
            <div className="relative px-4 py-3">
              {/* Vertical timeline line */}
              <div className="absolute left-[27px] top-3 bottom-3 w-px bg-border/50" />

              <div className="grid gap-1">
                {filteredEntries.map((entry) => {
                  const hasActivities = entry.activities.length > 0;
                  const isExpanded = expandedEntries.has(entry.id);
                  const primaryTone = entry.activities.find((a) => a.tone === 'danger')?.tone
                    || entry.activities.find((a) => a.tone === 'success')?.tone
                    || 'neutral';
                  const ToneIcon = entry.role === 'user' ? Play : (hasActivities ? TONE_CONFIG[primaryTone].icon : Clock);

                  return (
                    <div key={entry.id} className="relative flex gap-3 py-1.5">
                      {/* Timeline dot */}
                      <div
                        className={`relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                          entry.role === 'user'
                            ? 'border-amber-300 bg-amber-50'
                            : hasActivities
                              ? `${TONE_CONFIG[primaryTone].border} ${TONE_CONFIG[primaryTone].bg}`
                              : 'border-border bg-background'
                        }`}
                      >
                        <ToneIcon className={`size-2.5 ${entry.role === 'user' ? 'text-amber-600' : hasActivities ? TONE_CONFIG[primaryTone].color : 'text-muted-foreground/60'}`} />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-sans text-[10px] uppercase">
                            {entry.source}
                          </Badge>
                          <span className="font-sans text-[10px] text-muted-foreground">
                            {entry.role === 'user' ? 'You' : 'Agent'}
                          </span>
                          <span className="font-sans text-[10px] text-muted-foreground/60">
                            {timeAgo(entry.timestamp)}
                          </span>
                        </div>

                        <p className="mt-0.5 line-clamp-2 font-sans text-[12px] text-foreground/80">
                          {entry.text.slice(0, 200)}
                          {entry.text.length > 200 ? '…' : ''}
                        </p>

                        {/* Activity items */}
                        {hasActivities && (
                          <div className="mt-1.5">
                            <button
                              type="button"
                              className="flex items-center gap-1 font-sans text-[11px] text-muted-foreground hover:text-foreground"
                              onClick={() => toggleExpand(entry.id)}
                            >
                              {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                              {entry.activities.length} action{entry.activities.length > 1 ? 's' : ''}
                            </button>

                            {isExpanded && (
                              <div className="mt-1 grid gap-1 pl-1">
                                {entry.activities.map((activity) => {
                                  const aConf = TONE_CONFIG[activity.tone];
                                  const AIcon = aConf.icon;
                                  return (
                                    <div
                                      key={activity.id}
                                      className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${aConf.border} ${aConf.bg}`}
                                    >
                                      <AIcon className={`mt-0.5 size-3.5 shrink-0 ${aConf.color}`} />
                                      <div className="min-w-0">
                                        <p className="font-sans text-[12px] font-medium">{activity.label}</p>
                                        {activity.details && (
                                          <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">
                                            {activity.details}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </section>
  );
}
