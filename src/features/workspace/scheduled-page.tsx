import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { ScheduledJob } from '@/app-types';

type ScheduledPageProps = {
  jobs: ScheduledJob[];
  projectId?: string;
  projectTitle?: string;
  draftPrompt?: string;
  jobProjectLinks: Record<string, string>;
  loading: boolean;
  status: string;
  onAssignJobToProject: (jobId: string, projectId?: string | null) => void;
  onCreateJob: (input: { name: string; schedule: string; prompt: string; projectId?: string }) => Promise<void>;
  onUpdateJob: (input: { id: string; name?: string; schedule?: string; prompt?: string; enabled?: boolean }) => Promise<void>;
  onDeleteJob: (id: string) => Promise<void>;
  onRefresh: () => void | Promise<void>;
};

type ViewMode = 'timeline' | 'calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SCHEDULE_PRESETS = [
  { key: 'hourly', label: 'Hourly', cron: '0 * * * *' },
  { key: 'daily', label: 'Daily (9:00)', cron: '0 9 * * *' },
  { key: 'weekly', label: 'Weekly (Mon 9:00)', cron: '0 9 * * 1' },
  { key: 'custom', label: 'Custom cron', cron: '' },
] as const;
type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]['key'];

function formatTime(value: string | null): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function formatTimeShort(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function titleCase(value: string): string {
  if (!value.trim()) return 'Unknown';
  const lower = value.trim().toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
}

function getRelativeTimeLabel(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = d.getTime() - now;
  const absDiff = Math.abs(diff);
  if (absDiff < 60_000) return diff > 0 ? 'Soon' : 'Just now';
  if (absDiff < 3_600_000) {
    const mins = Math.floor(absDiff / 60_000);
    return diff > 0 ? `in ${mins} min` : `${mins} min ago`;
  }
  if (absDiff < 86_400_000) {
    const hrs = Math.floor(absDiff / 3_600_000);
    return diff > 0 ? `in ${hrs} hr` : `${hrs} hr ago`;
  }
  const days = Math.floor(absDiff / 86_400_000);
  return diff > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'} ago`;
}

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
  return days;
}

function jobMatchesDate(job: ScheduledJob, date: Date): boolean {
  const cronOccurrences = getCronOccurrencesForDay(job.schedule, date);
  if (cronOccurrences.length > 0) {
    return true;
  }

  if (job.nextRunAt) {
    const next = new Date(job.nextRunAt);
    if (next.toDateString() === date.toDateString()) return true;
  }
  if (job.lastRunAt) {
    const last = new Date(job.lastRunAt);
    if (last.toDateString() === date.toDateString()) return true;
  }
  return false;
}

function isCronExpressionValid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('@')) {
    return ['@hourly', '@daily', '@weekly', '@monthly', '@yearly', '@annually', '@reboot'].includes(trimmed.toLowerCase());
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.length >= 5 && parts.length <= 6;
}

function parseCronNumericSet(field: string, min: number, max: number): Set<number> | undefined | null {
  const value = field.trim();
  if (!value || value === '*') {
    return undefined;
  }

  const out = new Set<number>();
  const segments = value.split(',');
  for (const raw of segments) {
    const segment = raw.trim();
    if (!segment) continue;

    const [rangePart, stepPart] = segment.split('/');
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) {
      return null;
    }

    if (rangePart === '*') {
      for (let n = min; n <= max; n += step) out.add(n);
      continue;
    }

    if (rangePart.includes('-')) {
      const [startRaw, endRaw] = rangePart.split('-');
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      if (start < min || end > max || end < start) return null;
      for (let n = start; n <= end; n += step) out.add(n);
      continue;
    }

    const single = Number.parseInt(rangePart, 10);
    if (!Number.isFinite(single) || single < min || single > max) {
      return null;
    }
    out.add(single);
  }

  return out;
}

function normalizeCronDow(dow: number): number {
  return dow === 7 ? 0 : dow;
}

function getCronOccurrencesForDay(schedule: string, day: Date): string[] {
  const raw = schedule.trim();
  if (!raw) return [];

  const normalized = raw.startsWith('@')
    ? raw.toLowerCase() === '@hourly'
      ? '0 * * * *'
      : raw.toLowerCase() === '@daily'
        ? '0 0 * * *'
        : raw.toLowerCase() === '@weekly'
          ? '0 0 * * 0'
          : raw.toLowerCase() === '@monthly'
            ? '0 0 1 * *'
            : raw.toLowerCase() === '@yearly' || raw.toLowerCase() === '@annually'
              ? '0 0 1 1 *'
              : ''
    : raw;
  if (!normalized) return [];

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length < 5) return [];
  const [minuteField, hourField, domField, monthField, dowField] = parts;

  const minutes = parseCronNumericSet(minuteField, 0, 59);
  const hours = parseCronNumericSet(hourField, 0, 23);
  const dom = parseCronNumericSet(domField, 1, 31);
  const months = parseCronNumericSet(monthField, 1, 12);
  const dow = parseCronNumericSet(dowField, 0, 7);
  if ([minutes, hours, dom, months, dow].some((entry) => entry === null)) {
    return [];
  }

  const month = day.getMonth() + 1;
  if (months && !months.has(month)) {
    return [];
  }

  const dayOfMonth = day.getDate();
  const dayOfWeek = day.getDay();
  const matchesDom = dom ? dom.has(dayOfMonth) : true;
  const matchesDow = dow ? Array.from(dow).map(normalizeCronDow).includes(dayOfWeek) : true;
  if (!(matchesDom && matchesDow)) {
    return [];
  }

  const minuteValues = minutes ? Array.from(minutes).sort((a, b) => a - b) : [0];
  const hourValues = hours ? Array.from(hours).sort((a, b) => a - b) : Array.from({ length: 24 }, (_, i) => i);

  const times: string[] = [];
  for (const hour of hourValues) {
    for (const minute of minuteValues) {
      const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      times.push(new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(dt));
      if (times.length >= 8) {
        return times;
      }
    }
  }
  return times;
}

export function ScheduledPage({
  jobs,
  projectId,
  projectTitle,
  draftPrompt,
  jobProjectLinks,
  loading,
  status,
  onAssignJobToProject,
  onCreateJob,
  onUpdateJob,
  onDeleteJob,
  onRefresh,
}: ScheduledPageProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('daily');
  const [customSchedule, setCustomSchedule] = useState('');
  const [jobName, setJobName] = useState(projectTitle?.trim() ? `${projectTitle.trim()} run` : '');
  const [jobPrompt, setJobPrompt] = useState(draftPrompt?.trim() ?? '');
  const [saving, setSaving] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  useEffect(() => {
    setShowAllJobs(false);
  }, [projectId]);

  useEffect(() => {
    if (!jobPrompt.trim() && draftPrompt?.trim()) {
      setJobPrompt(draftPrompt.trim());
    }
  }, [draftPrompt, jobPrompt]);

  const resolvedSchedule = useMemo(() => {
    if (schedulePreset === 'custom') return customSchedule.trim();
    return SCHEDULE_PRESETS.find((preset) => preset.key === schedulePreset)?.cron ?? '';
  }, [customSchedule, schedulePreset]);

  const now = new Date();
  const projectScopedJobs = useMemo(() => {
    const normalizedProjectId = projectId?.trim() ?? '';
    const normalizedProjectTitle = projectTitle?.trim().toLowerCase() ?? '';
    if (!normalizedProjectId) {
      return jobs;
    }
    return jobs.filter((job) => {
      const linked = jobProjectLinks[job.id];
      if (linked && linked === normalizedProjectId) {
        return true;
      }
      if (linked && linked !== normalizedProjectId) {
        return false;
      }
      if (normalizedProjectTitle && job.name.toLowerCase().includes(normalizedProjectTitle)) {
        return true;
      }
      return false;
    });
  }, [jobProjectLinks, jobs, projectId, projectTitle]);

  const displayJobs = useMemo(() => {
    if (!projectId || showAllJobs) {
      return jobs;
    }
    return projectScopedJobs;
  }, [jobs, projectId, projectScopedJobs, showAllJobs]);

  const sortedJobs = useMemo(() => {
    return [...displayJobs].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      const aNext = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
      const bNext = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
      return aNext - bNext;
    });
  }, [displayJobs]);

  const upcomingJobs = useMemo(() => sortedJobs.filter((j) => j.enabled && j.nextRunAt), [sortedJobs]);
  const enabledCount = displayJobs.filter((j) => j.enabled).length;
  const disabledCount = displayJobs.length - enabledCount;

  const calDays = useMemo(() => getCalendarDays(calYear, calMonth), [calYear, calMonth]);
  const jobsByDate = useMemo(() => {
    const map = new Map<string, ScheduledJob[]>();
    for (const day of calDays) {
      if (!day) continue;
      const key = day.toDateString();
      const matches = displayJobs.filter((j) => jobMatchesDate(j, day));
      if (matches.length > 0) map.set(key, matches);
    }
    return map;
  }, [calDays, displayJobs]);

  const selectedDateJobs = useMemo(() => {
    if (!selectedDate) return [];
    return jobsByDate.get(selectedDate.toDateString()) || [];
  }, [selectedDate, jobsByDate]);

  const selectedDateJobOccurrences = useMemo(() => {
    if (!selectedDate) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const job of selectedDateJobs) {
      map.set(job.id, getCronOccurrencesForDay(job.schedule, selectedDate));
    }
    return map;
  }, [selectedDate, selectedDateJobs]);

  const canSubmit = jobName.trim().length > 1 && jobPrompt.trim().length > 2 && isCronExpressionValid(resolvedSchedule);

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      if (editingJobId) {
        await onUpdateJob({
          id: editingJobId,
          name: jobName.trim(),
          schedule: resolvedSchedule,
          prompt: jobPrompt.trim(),
        });
      } else {
        await onCreateJob({
          name: jobName.trim(),
          schedule: resolvedSchedule,
          prompt: jobPrompt.trim(),
          projectId: projectId?.trim() || undefined,
        });
      }

      setEditingJobId(null);
      setJobName(projectTitle?.trim() ? `${projectTitle.trim()} run` : '');
      setJobPrompt(draftPrompt?.trim() ?? '');
      setSchedulePreset('daily');
      setCustomSchedule('');
    } finally {
      setSaving(false);
    }
  };

  const handleEditJob = (job: ScheduledJob) => {
    setEditingJobId(job.id);
    setJobName(job.name);
    setJobPrompt(draftPrompt?.trim() || job.name);
    const matchingPreset = SCHEDULE_PRESETS.find((preset) => preset.cron === job.schedule);
    if (matchingPreset && matchingPreset.key !== 'custom') {
      setSchedulePreset(matchingPreset.key);
      setCustomSchedule('');
    } else {
      setSchedulePreset('custom');
      setCustomSchedule(job.schedule);
    }
  };

  return (
    <section className="grid h-full w-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-amber-600" />
            <h1 className="text-xl font-semibold tracking-tight">Schedule</h1>
            <Badge variant="outline" className="ml-2 font-sans text-[11px]">
              {displayJobs.length} {displayJobs.length === 1 ? 'Job' : 'Jobs'}
            </Badge>
            {projectId ? (
              <Badge variant="outline" className="ml-1 font-sans text-[11px]">
                {projectTitle?.trim() || 'Project'}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            {projectId
              ? 'Project-based schedule view from your OpenClaw gateway.'
              : 'Overview of all scheduled jobs from your OpenClaw gateway.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {projectId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAllJobs((current) => !current)}>
              {showAllJobs ? 'Show project only' : 'Show all jobs'}
            </Button>
          ) : null}
          <div className="flex rounded-lg border border-border">
            {(['timeline', 'calendar'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`px-3 py-1.5 font-sans text-[11px] transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  viewMode === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                }`}
                onClick={() => setViewMode(mode)}
              >
                {mode === 'timeline' ? 'Timeline' : 'Calendar'}
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh()} disabled={loading} className="gap-1.5">
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="font-sans text-sm font-semibold">
              {editingJobId ? 'Edit scheduled task' : 'Create scheduled task'}
            </p>
            <p className="font-sans text-[12px] text-muted-foreground">
              Define a cron schedule and a prompt to run automatically.
            </p>
          </div>
          {editingJobId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingJobId(null);
                setJobName(projectTitle?.trim() ? `${projectTitle.trim()} run` : '');
                setJobPrompt(draftPrompt?.trim() ?? '');
                setSchedulePreset('daily');
                setCustomSchedule('');
              }}
            >
              Cancel edit
            </Button>
          ) : null}
        </div>

        <div className="grid gap-2 md:grid-cols-[1fr_190px]">
          <Input
            value={jobName}
            onChange={(event) => setJobName(event.target.value)}
            placeholder="Task name"
            className="h-9 text-sm"
          />
          <select
            value={schedulePreset}
            onChange={(event) => setSchedulePreset(event.target.value as SchedulePreset)}
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {SCHEDULE_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        {schedulePreset === 'custom' ? (
          <Input
            value={customSchedule}
            onChange={(event) => setCustomSchedule(event.target.value)}
            placeholder="Cron expression (e.g. 0 9 * * 1)"
            className="mt-2 h-9 font-mono text-xs"
          />
        ) : null}

        <Textarea
          value={jobPrompt}
          onChange={(event) => setJobPrompt(event.target.value)}
          placeholder="Prompt to run on schedule"
          rows={3}
          className="mt-2 min-h-[88px] text-sm"
        />

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className={`font-sans text-[11px] ${isCronExpressionValid(resolvedSchedule) ? 'text-muted-foreground' : 'text-destructive'}`}>
            {isCronExpressionValid(resolvedSchedule)
              ? `Schedule: ${resolvedSchedule}`
              : 'Provide a valid cron expression (5-6 parts) or a supported @preset.'}
          </p>
          <Button type="button" size="sm" onClick={() => void handleSubmit()} disabled={!canSubmit || saving} className="gap-1.5">
            <Plus className="size-3.5" />
            {saving ? 'Saving...' : editingJobId ? 'Update task' : 'Create task'}
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Play className="size-3.5 text-emerald-600" />
          <span className="font-sans text-[12px] text-muted-foreground">{enabledCount} active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Pause className="size-3.5 text-muted-foreground/50" />
          <span className="font-sans text-[12px] text-muted-foreground">{disabledCount} paused</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        {upcomingJobs.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Timer className="size-3.5 text-amber-500" />
            <span className="font-sans text-[12px] text-muted-foreground">
              Next: {getRelativeTimeLabel(upcomingJobs[0].nextRunAt)}
            </span>
          </div>
        )}
        <span className="ml-auto font-sans text-[11px] text-muted-foreground/60">
          {status.trim() || 'Connected.'}
        </span>
      </div>

      {/* Main content */}
      <div className="min-h-0 rounded-xl border border-border/60 bg-card">
        {viewMode === 'timeline' ? (
          /* ── Timeline view ── */
          <ScrollArea className="h-full">
            {sortedJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CalendarDays className="mb-3 size-8 text-muted-foreground/30" />
                <p className="font-sans text-sm text-muted-foreground">
                  {projectId && !showAllJobs
                    ? 'No scheduled jobs linked to this project yet.'
                    : 'No scheduled jobs. Make sure your gateway is configured.'}
                </p>
              </div>
            ) : (
              <div className="relative px-4 py-3">
                <div className="absolute left-[27px] top-3 bottom-3 w-px bg-border/50" />
                <div className="grid gap-2">
                  {sortedJobs.map((job) => {
                    const isEnabled = job.enabled;
                    const nextLabel = getRelativeTimeLabel(job.nextRunAt);

                    return (
                      <div key={job.id} className="relative flex gap-3 py-1.5">
                        <div
                          className={`relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                            isEnabled
                              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
                              : 'border-border bg-background'
                          }`}
                        >
                          {isEnabled ? (
                            <Play className="size-2.5 text-emerald-600" />
                          ) : (
                            <Pause className="size-2.5 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-sans text-[13px] font-medium">{job.name}</span>
                            <Badge variant={isEnabled ? 'default' : 'outline'} className="font-sans text-[10px]">
                              {isEnabled ? 'Active' : 'Paused'}
                            </Badge>
                            <Badge variant="outline" className="font-sans text-[10px]">
                              {titleCase(job.state)}
                            </Badge>
                            {nextLabel && (
                              <span className="ml-auto font-sans text-[11px] text-amber-600 font-medium">
                                {nextLabel}
                              </span>
                            )}
                          </div>
                          {projectId ? (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <Badge variant="outline" className="font-sans text-[10px]">
                                {jobProjectLinks[job.id] === projectId ? 'Linked to project' : 'Not linked'}
                              </Badge>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px]"
                                onClick={() =>
                                  onAssignJobToProject(job.id, jobProjectLinks[job.id] === projectId ? null : projectId)
                                }
                              >
                                {jobProjectLinks[job.id] === projectId ? 'Unlink' : 'Link to project'}
                              </Button>
                            </div>
                          ) : null}
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{job.schedule}</p>
                          <div className="mt-1.5 flex gap-4 font-sans text-[11px] text-muted-foreground">
                            <span>Next run: {formatTime(job.nextRunAt)}</span>
                            <span>Last run: {formatTime(job.lastRunAt)}</span>
                          </div>
                          <div className="mt-2 flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-[11px]"
                              onClick={() => handleEditJob(job)}
                            >
                              <Pencil className="size-3" />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-[11px]"
                              onClick={() => void onUpdateJob({ id: job.id, enabled: !job.enabled })}
                            >
                              {job.enabled ? <Pause className="size-3" /> : <Play className="size-3" />}
                              {job.enabled ? 'Pause' : 'Enable'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="ml-auto h-7 gap-1 px-2 text-[11px]"
                              disabled={deletingJobId === job.id}
                              onClick={async () => {
                                setDeletingJobId(job.id);
                                try {
                                  await onDeleteJob(job.id);
                                } finally {
                                  setDeletingJobId(null);
                                }
                              }}
                            >
                              <Trash2 className="size-3" />
                              {deletingJobId === job.id ? 'Deleting...' : 'Delete'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ScrollArea>
        ) : (
          /* ── Calendar view ── */
          <div className="grid min-h-0 grid-cols-1 gap-0" style={{ gridTemplateColumns: selectedDate ? '1fr 280px' : '1fr' }}>
            <div className="p-4">
              {/* Month header */}
              <div className="mb-3 flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    if (calMonth === 0) {
                      setCalMonth(11);
                      setCalYear((y) => y - 1);
                    } else {
                      setCalMonth((m) => m - 1);
                    }
                  }}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="font-sans text-[14px] font-semibold">
                  {MONTH_NAMES[calMonth]} {calYear}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    if (calMonth === 11) {
                      setCalMonth(0);
                      setCalYear((y) => y + 1);
                    } else {
                      setCalMonth((m) => m + 1);
                    }
                  }}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              {/* Weekday headers */}
              <div className="mb-1 grid grid-cols-7 gap-0">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="py-1 text-center font-sans text-[11px] font-medium text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-0">
                {calDays.map((day, i) => {
                  if (!day) {
                    return <div key={`empty-${i}`} className="h-16" />;
                  }
                  const dayKey = day.toDateString();
                  const dayJobs = jobsByDate.get(dayKey) || [];
                  const isToday = day.toDateString() === now.toDateString();
                  const isSelected = selectedDate?.toDateString() === dayKey;

                  return (
                    <button
                      key={dayKey}
                      type="button"
                      className={`relative flex h-16 flex-col items-start rounded-lg border p-1 text-left transition-colors ${
                        isSelected
                          ? 'border-foreground/20 bg-accent'
                          : isToday
                            ? 'border-amber-300/50 bg-amber-50/50 dark:border-amber-800/30 dark:bg-amber-950/20'
                            : 'border-transparent hover:bg-accent/30'
                      }`}
                      onClick={() => setSelectedDate(isSelected ? null : day)}
                    >
                      <span
                        className={`font-sans text-[11px] ${
                          isToday ? 'font-bold text-amber-700 dark:text-amber-400' : 'text-foreground/70'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                      {dayJobs.length > 0 && (
                        <div className="mt-auto flex flex-wrap gap-0.5">
                          {dayJobs.slice(0, 3).map((j) => (
                            <span
                              key={j.id}
                              className={`inline-block size-1.5 rounded-full ${j.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}
                            />
                          ))}
                          {dayJobs.length > 3 && (
                            <span className="font-sans text-[8px] text-muted-foreground">+{dayJobs.length - 3}</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Day detail panel */}
            {selectedDate && (
              <div className="flex min-h-0 flex-col border-l border-border/60">
                <div className="border-b border-border/40 px-3 py-2.5">
                  <p className="font-sans text-[12px] font-medium">
                    {selectedDate.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </p>
                  <p className="font-sans text-[11px] text-muted-foreground">
                    {selectedDateJobs.length} {selectedDateJobs.length === 1 ? 'Job' : 'Jobs'}
                  </p>
                </div>
                <ScrollArea className="flex-1">
                  {selectedDateJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Clock className="mb-2 size-6 text-muted-foreground/30" />
                      <p className="font-sans text-[12px] text-muted-foreground">No jobs on this day.</p>
                    </div>
                  ) : (
                    <div className="grid gap-1.5 p-3">
                      {selectedDateJobs.map((job) => (
                        <div key={job.id} className="rounded-lg border border-border/60 bg-background px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            {job.enabled ? (
                              <Play className="size-3 text-emerald-600" />
                            ) : (
                              <Pause className="size-3 text-muted-foreground/50" />
                            )}
                            <span className="font-sans text-[12px] font-medium">{job.name}</span>
                          </div>
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{job.schedule}</p>
                          <p className="mt-0.5 font-sans text-[10px] text-muted-foreground">
                            {(selectedDateJobOccurrences.get(job.id) || []).slice(0, 3).join(', ') || formatTimeShort(job.nextRunAt)}
                          </p>
                          {(selectedDateJobOccurrences.get(job.id) || []).length > 3 ? (
                            <p className="mt-0.5 font-sans text-[10px] text-muted-foreground">
                              +{(selectedDateJobOccurrences.get(job.id) || []).length - 3} more times
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
