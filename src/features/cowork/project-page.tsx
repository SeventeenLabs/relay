import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock3, FileText, FolderOpen, Pencil, Play, Search, Shield, Sparkles, Zap } from 'lucide-react';

import type { CoworkArtifact, CoworkProject, CoworkProjectTask, OperatorDefinition, OperatorRun, OutcomePipeline, ProjectKnowledgeItem } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ProjectPageTarget = 'cowork' | 'files' | 'local-files' | 'activity' | 'memory' | 'scheduled' | 'approvals' | 'safety';

type ProjectPageProps = {
  project: CoworkProject | null;
  tasks: CoworkProjectTask[];
  scheduledCount: number;
  pipelineCount: number;
  pipelines: OutcomePipeline[];
  operators: OperatorDefinition[];
  operatorRuns: OperatorRun[];
  pendingApprovalsCount: number;
  artifacts: CoworkArtifact[];
  projectKnowledge: ProjectKnowledgeItem[];
  webSearchEnabled: boolean;
  onPickFolder: () => Promise<string | undefined>;
  onUpdateProject: (projectId: string, name: string, workspaceFolder: string, description?: string, instructions?: string) => void;
  onCreatePipeline: (
    projectId: string,
    input: {
      name: string;
      description?: string;
      triggerKind?: OutcomePipeline['triggerKind'];
      triggerValue?: string;
      sessionTarget?: OutcomePipeline['sessionTarget'];
      delivery?: OutcomePipeline['delivery'];
      webhookUrl?: string;
      agentId?: string;
      prompt: string;
    },
  ) => void;
  onUpdatePipeline: (
    pipelineId: string,
    input: {
      name?: string;
      description?: string;
      triggerKind?: OutcomePipeline['triggerKind'];
      triggerValue?: string;
      sessionTarget?: OutcomePipeline['sessionTarget'];
      delivery?: OutcomePipeline['delivery'];
      webhookUrl?: string;
      agentId?: string;
      prompt?: string;
    },
  ) => void;
  onTogglePipeline: (pipelineId: string, enabled: boolean) => void;
  onDeletePipeline: (pipelineId: string) => void;
  onToggleOperator: (operatorId: string, enabled: boolean) => void;
  onRunResearchOperator: (input: {
    operatorId: string;
    topic: string;
    depth: 'light' | 'standard' | 'deep';
    deliverBy?: string;
  }) => Promise<void> | void;
  onOpenArtifact: (artifact: CoworkArtifact) => void;
  onAddKnowledge: (projectId: string, title: string, content: string) => void;
  onDeleteKnowledge: (knowledgeId: string) => void;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  onSelectPage: (page: ProjectPageTarget) => void;
};

const navItems: Array<{ label: string; page: ProjectPageTarget; icon: typeof FolderOpen }> = [
  { label: 'Project Folder', page: 'local-files', icon: FolderOpen },
  { label: 'Activity', page: 'activity', icon: Zap },
  { label: 'Memory', page: 'memory', icon: Search },
  { label: 'Schedule', page: 'scheduled', icon: CalendarClock },
  { label: 'Approvals', page: 'approvals', icon: AlertTriangle },
  { label: 'Safety', page: 'safety', icon: Shield },
];

function statusLabel(value: CoworkProjectTask['status']): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(status: CoworkProjectTask['status']): string {
  if (status === 'completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'running' || status === 'queued') return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300';
  if (status === 'needs_approval' || status === 'approved') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'failed' || status === 'rejected') return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return 'border-border bg-muted text-muted-foreground';
}

export function ProjectPage(props: ProjectPageProps) {
  const { project, tasks } = props;

  const [editingProject, setEditingProject] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftInstructions, setDraftInstructions] = useState('');
  const [draftFolder, setDraftFolder] = useState('');
  const [folderBrowsing, setFolderBrowsing] = useState(false);

  useEffect(() => {
    if (!project) {
      setDraftName('');
      setDraftDescription('');
      setDraftInstructions('');
      setDraftFolder('');
      setEditingProject(false);
      return;
    }
    setDraftName(project.name);
    setDraftDescription(project.description ?? '');
    setDraftInstructions(project.instructions ?? '');
    setDraftFolder(project.workspaceFolder);
  }, [project]);

  if (!project) {
    return (
      <section className="grid h-full w-full place-items-center p-6">
        <div className="w-full max-w-xl rounded-2xl border border-border/60 bg-card p-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">No project selected</h1>
          <p className="mt-2 font-sans text-sm text-muted-foreground">
            Select a project from the sidebar or create one to open the project home.
          </p>
          <Button type="button" className="mt-4" onClick={() => props.onSelectPage('cowork')}>
            Open Cowork
          </Button>
        </div>
      </section>
    );
  }

  const runningTasks = tasks.filter((task) => task.status === 'running').length;
  const needsApprovalTasks = tasks.filter((task) => task.status === 'needs_approval').length;
  const completedTasks = tasks.filter((task) => task.status === 'completed').length;
  const readiness = tasks.length === 0 ? 0 : Math.round((completedTasks / tasks.length) * 100);
  const recentTasks = tasks.slice(0, 5);

  const hasProjectChanges =
    draftName.trim() !== project.name.trim() ||
    draftDescription.trim() !== (project.description ?? '').trim() ||
    draftInstructions.trim() !== (project.instructions ?? '').trim() ||
    draftFolder.trim() !== project.workspaceFolder.trim();

  const handleBrowseFolder = async () => {
    setFolderBrowsing(true);
    try {
      const selected = await props.onPickFolder();
      if (selected?.trim()) setDraftFolder(selected.trim());
    } finally {
      setFolderBrowsing(false);
    }
  };

  const handleSaveProjectSettings = () => {
    if (!draftName.trim() || !draftFolder.trim()) return;
    props.onUpdateProject(project.id, draftName.trim(), draftFolder.trim(), draftDescription.trim() || undefined, draftInstructions.trim() || undefined);
    setEditingProject(false);
  };

  return (
    <section className="flex h-full w-full min-h-0 flex-col gap-3 overflow-y-auto p-4 pb-8">
      <header className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
              <Badge variant="secondary" className="h-6 gap-1 px-2 text-[11px]">
                <Sparkles className="size-3" />
                Project Home
              </Badge>
            </div>
            <p className="mt-1 max-w-4xl font-sans text-sm text-muted-foreground">
              {project.description || 'Use this page to quickly understand project status and jump into work.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="gap-2" onClick={() => props.onSelectPage('cowork')}>
              <Play className="size-3.5" />
              Run Task
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => props.onSelectPage('local-files')}>
              <FolderOpen className="size-3.5" />
              Files
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => props.onSelectPage('approvals')}>
              <AlertTriangle className="size-3.5" />
              Approvals
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => setEditingProject((value) => !value)}>
              <Pencil className="size-3.5" />
              {editingProject ? 'Close Settings' : 'Settings'}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">{project.workspaceFolder}</Badge>
          <Badge variant="outline" className="text-[11px]">{props.scheduledCount} scheduled</Badge>
          <Badge variant="outline" className="text-[11px]">{props.pipelineCount} pipelines</Badge>
          <Badge variant="outline" className="text-[11px]">{props.operatorRuns.length} operator runs</Badge>
          <Badge variant="outline" className="text-[11px]">{needsApprovalTasks + props.pendingApprovalsCount} approvals</Badge>
        </div>

        {editingProject ? (
          <div className="mt-3 rounded-xl border border-border/60 bg-background p-3">
            <p className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project Settings</p>
            <div className="grid gap-2 md:grid-cols-2">
              <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Project name" />
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Input value={draftFolder} onChange={(event) => setDraftFolder(event.target.value)} placeholder="Project folder" />
                <Button type="button" variant="outline" onClick={() => void handleBrowseFolder()} disabled={folderBrowsing}>
                  {folderBrowsing ? 'Browsing...' : 'Browse'}
                </Button>
              </div>
            </div>
            <Textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="Project description (optional)" rows={2} className="mt-2" />
            <Textarea value={draftInstructions} onChange={(event) => setDraftInstructions(event.target.value)} placeholder="Cowork instructions (optional)" rows={3} className="mt-2" />
            <div className="mt-2 flex gap-2">
              <Button type="button" onClick={handleSaveProjectSettings} disabled={!draftName.trim() || !draftFolder.trim() || !hasProjectChanges}>Save</Button>
              <Button type="button" variant="outline" onClick={() => setEditingProject(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </header>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border/60 bg-card px-3 py-3"><p className="text-[11px] text-muted-foreground">Tasks</p><p className="text-lg font-semibold">{tasks.length}</p></div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-3"><p className="text-[11px] text-muted-foreground">Running</p><p className="text-lg font-semibold">{runningTasks}</p></div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-3"><p className="text-[11px] text-muted-foreground">Completed</p><p className="text-lg font-semibold">{completedTasks}</p></div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-3"><p className="text-[11px] text-muted-foreground">Readiness</p><p className="text-lg font-semibold">{readiness}%</p></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-3">
          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <h2 className="text-sm font-semibold">What this page is for</h2>
            <p className="mt-1 text-sm text-muted-foreground">This page is your project home. Check status, review recent work, and navigate to the right workspace area.</p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Clock3 className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold">Recent Tasks</h2></div>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => props.onSelectPage('cowork')}>Open Cowork</Button>
            </div>
            {recentTasks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground">No recent tasks yet.</p>
            ) : (
              <div className="grid gap-2">
                {recentTasks.map((task) => (
                  <div key={task.id} className="rounded-xl border border-border/60 bg-background px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.prompt}</p>
                      <Badge variant="outline" className={statusClass(task.status)}>{statusLabel(task.status)}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Updated {new Date(task.updatedAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center gap-2"><FileText className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold">Recent Artifacts</h2></div>
            {props.artifacts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">No artifacts yet.</p>
            ) : (
              <div className="grid gap-1.5">
                {props.artifacts.slice(0, 5).map((artifact) => (
                  <button key={artifact.id} type="button" className="rounded-lg border border-border/60 bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent/30" onClick={() => props.onOpenArtifact(artifact)}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{artifact.label}</p>
                      <Badge variant="outline" className="text-[10px]">{artifact.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="grid gap-3">
          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-600" /><h2 className="text-sm font-semibold">Quick Navigation</h2></div>
            <div className="grid gap-1.5">
              {navItems.map((item) => (
                <button key={item.label} type="button" onClick={() => props.onSelectPage(item.page)} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent/30">
                  <item.icon className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{item.label}</span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Project Options</h2>
              <Badge variant="outline" className="text-[10px]">Simple mode</Badge>
            </div>
            <Button type="button" variant={props.webSearchEnabled ? 'default' : 'outline'} className="w-full gap-2" onClick={() => props.onWebSearchEnabledChange(!props.webSearchEnabled)}>
              <Search className="size-3.5" />
              {props.webSearchEnabled ? 'Web Search On' : 'Web Search Off'}
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}
