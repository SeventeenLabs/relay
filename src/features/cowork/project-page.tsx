import { useEffect, useState } from 'react';
import { AlertTriangle, Brain, CalendarClock, CheckCircle2, Clock3, FileText, FolderOpen, ListChecks, Pencil, Play, Search, Shield, Sparkles, Trash2, XCircle, Zap } from 'lucide-react';

import type { CoworkArtifact, CoworkProject, CoworkProjectTask, ProjectKnowledgeItem } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ProjectPageTarget = 'cowork' | 'files' | 'local-files' | 'activity' | 'memory' | 'scheduled' | 'safety';

type ProjectPageProps = {
  project: CoworkProject | null;
  tasks: CoworkProjectTask[];
  scheduledCount: number;
  pendingApprovalsCount: number;
  artifacts: CoworkArtifact[];
  projectKnowledge: ProjectKnowledgeItem[];
  webSearchEnabled: boolean;
  onPickFolder: () => Promise<string | undefined>;
  onUpdateProject: (projectId: string, name: string, workspaceFolder: string, description?: string, instructions?: string) => void;
  onOpenArtifact: (artifact: CoworkArtifact) => void;
  onAddKnowledge: (projectId: string, title: string, content: string) => void;
  onDeleteKnowledge: (knowledgeId: string) => void;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  onSelectPage: (page: ProjectPageTarget) => void;
};

const projectActions: Array<{
  label: string;
  description: string;
  page: ProjectPageTarget;
  icon: typeof FolderOpen;
}> = [
  {
    label: 'Project Folder',
    description: 'Open the mapped local project folder.',
    page: 'local-files',
    icon: FolderOpen,
  },
  {
    label: 'Activity',
    description: 'Review task and tool activity for this project.',
    page: 'activity',
    icon: Zap,
  },
  {
    label: 'Memory',
    description: 'Manage notes and operating context.',
    page: 'memory',
    icon: Brain,
  },
  {
    label: 'Schedule',
    description: 'Inspect and manage scheduled jobs.',
    page: 'scheduled',
    icon: CalendarClock,
  },
  {
    label: 'Safety',
    description: 'Configure approvals, risk rules, and guardrails.',
    page: 'safety',
    icon: Shield,
  },
];

function formatStatusLabel(value: CoworkProjectTask['status']): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusBadgeClass(status: CoworkProjectTask['status']): string {
  if (status === 'completed') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (status === 'running' || status === 'queued') {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300';
  }
  if (status === 'needs_approval' || status === 'approved') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }
  if (status === 'failed' || status === 'rejected') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  }
  return 'border-border bg-muted text-muted-foreground';
}

export function ProjectPage({
  project,
  tasks,
  scheduledCount,
  pendingApprovalsCount,
  artifacts,
  projectKnowledge,
  webSearchEnabled,
  onPickFolder,
  onUpdateProject,
  onOpenArtifact,
  onAddKnowledge,
  onDeleteKnowledge,
  onWebSearchEnabledChange,
  onSelectPage,
}: ProjectPageProps) {
  const [editingProject, setEditingProject] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftInstructions, setDraftInstructions] = useState('');
  const [draftFolder, setDraftFolder] = useState('');
  const [folderBrowsing, setFolderBrowsing] = useState(false);
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeContent, setKnowledgeContent] = useState('');

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
      <section className="mx-auto grid h-full w-full max-w-[980px] place-items-center p-6">
        <div className="w-full max-w-xl rounded-2xl border border-border/60 bg-card p-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">No project selected</h1>
          <p className="mt-2 font-sans text-sm text-muted-foreground">
            Select a project from the sidebar or create one to open the full project page.
          </p>
          <Button type="button" className="mt-4" onClick={() => onSelectPage('cowork')}>
            Open Cowork
          </Button>
        </div>
      </section>
    );
  }

  const runningTasks = tasks.filter((task) => task.status === 'running').length;
  const queuedTasks = tasks.filter((task) => task.status === 'queued').length;
  const needsApprovalTasks = tasks.filter((task) => task.status === 'needs_approval').length;
  const completedTasks = tasks.filter((task) => task.status === 'completed').length;
  const failedTasks = tasks.filter((task) => task.status === 'failed' || task.status === 'rejected').length;
  const readinessScore = tasks.length === 0 ? 0 : Math.round((completedTasks / tasks.length) * 100);
  const recentTasks = tasks.slice(0, 8);

  const hasProjectChanges =
    draftName.trim() !== project.name.trim() ||
    draftDescription.trim() !== (project.description ?? '').trim() ||
    draftInstructions.trim() !== (project.instructions ?? '').trim() ||
    draftFolder.trim() !== project.workspaceFolder.trim();

  const handleBrowseFolder = async () => {
    setFolderBrowsing(true);
    try {
      const selected = await onPickFolder();
      if (selected?.trim()) {
        setDraftFolder(selected.trim());
      }
    } finally {
      setFolderBrowsing(false);
    }
  };

  const handleSaveProjectSettings = () => {
    const normalizedName = draftName.trim();
    const normalizedFolder = draftFolder.trim();
    if (!normalizedName || !normalizedFolder) {
      return;
    }

    onUpdateProject(project.id, normalizedName, normalizedFolder, draftDescription.trim() || undefined, draftInstructions.trim() || undefined);
    setEditingProject(false);
  };

  const handleCancelProjectSettings = () => {
    setDraftName(project.name);
    setDraftDescription(project.description ?? '');
    setDraftInstructions(project.instructions ?? '');
    setDraftFolder(project.workspaceFolder);
    setEditingProject(false);
  };

  const handleAddKnowledge = () => {
    if (!project) {
      return;
    }
    onAddKnowledge(project.id, knowledgeTitle, knowledgeContent);
    setKnowledgeTitle('');
    setKnowledgeContent('');
  };

  const artifactDisplayName = (artifact: CoworkArtifact) => {
    const normalizedPath = artifact.path.replace(/\\/g, '/');
    const fileName = normalizedPath.split('/').filter(Boolean).pop();
    if (fileName) {
      return fileName;
    }
    return artifact.label;
  };

  return (
    <section className="mx-auto grid h-full w-full max-w-[1180px] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4">
      <header className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5">
        <div className="pointer-events-none absolute -right-24 -top-28 h-56 w-56 rounded-full bg-[radial-gradient(circle_at_center,rgba(229,164,138,0.35),transparent_72%)]" />
        <div className="pointer-events-none absolute -bottom-20 -left-24 h-52 w-52 rounded-full bg-[radial-gradient(circle_at_center,rgba(217,135,101,0.22),transparent_72%)]" />

        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="size-3" />
              Project Home
            </Badge>
          </div>
          {project.description ? (
            <p className="mt-2 max-w-3xl font-sans text-sm text-muted-foreground">{project.description}</p>
          ) : (
            <p className="mt-2 max-w-3xl font-sans text-sm text-muted-foreground">
              Add a project description so the cowork agent gets better planning context.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" className="gap-2" onClick={() => onSelectPage('cowork')}>
              <Play className="size-3.5" />
              Run Task
            </Button>
            <Button
              type="button"
              variant={webSearchEnabled ? 'default' : 'outline'}
              className="gap-2"
              onClick={() => onWebSearchEnabledChange(!webSearchEnabled)}
            >
              <Search className="size-3.5" />
              {webSearchEnabled ? 'Web Search On' : 'Web Search Off'}
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => onSelectPage('local-files')}>
              <FolderOpen className="size-3.5" />
              Open Project Folder
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => onSelectPage('safety')}>
              <Shield className="size-3.5" />
              Review Safety
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => setEditingProject((current) => !current)}>
              <Pencil className="size-3.5" />
              {editingProject ? 'Close Settings' : 'Project Settings'}
            </Button>
          </div>
          <p className="mt-3 rounded-lg border border-border/50 bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
            {project.workspaceFolder}
          </p>

          {editingProject ? (
            <div className="mt-3 rounded-xl border border-border/60 bg-background/90 p-3">
              <p className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project Settings</p>
              <div className="grid gap-2">
                <Input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="Project name"
                />
                <Textarea
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  placeholder="Project description (optional)"
                  rows={2}
                />
                <Textarea
                  value={draftInstructions}
                  onChange={(event) => setDraftInstructions(event.target.value)}
                  placeholder="Cowork instructions (role, tone, constraints, output format)"
                  rows={4}
                />
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    value={draftFolder}
                    onChange={(event) => setDraftFolder(event.target.value)}
                    placeholder="Project folder"
                  />
                  <Button type="button" variant="outline" onClick={() => void handleBrowseFolder()} disabled={folderBrowsing}>
                    {folderBrowsing ? 'Browsing...' : 'Browse'}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    onClick={handleSaveProjectSettings}
                    disabled={!draftName.trim() || !draftFolder.trim() || !hasProjectChanges}
                  >
                    Save changes
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCancelProjectSettings}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid gap-2 md:grid-cols-6">
        <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Tasks</p>
          <p className="mt-1 text-lg font-semibold">{tasks.length}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Running</p>
          <p className="mt-1 text-lg font-semibold">{runningTasks}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Queued</p>
          <p className="mt-1 text-lg font-semibold">{queuedTasks}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Needs Approval</p>
          <p className="mt-1 text-lg font-semibold">{needsApprovalTasks + pendingApprovalsCount}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Completed</p>
          <p className="mt-1 text-lg font-semibold">{completedTasks}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Readiness</p>
          <p className="mt-1 text-lg font-semibold">{readinessScore}%</p>
        </div>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-h-0 gap-3">
          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock3 className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Recent Tasks</h2>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onSelectPage('cowork')}>
                Open Cowork
              </Button>
            </div>
            {recentTasks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-4 font-sans text-sm text-muted-foreground">
                No recent tasks yet. Start a task run to build project history.
              </p>
            ) : (
              <div className="grid gap-2">
                {recentTasks.map((task) => (
                  <div key={task.id} className="rounded-xl border border-border/60 bg-background px-3 py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate font-sans text-[13px] font-medium text-foreground">{task.prompt}</p>
                      <Badge variant="outline" className={statusBadgeClass(task.status)}>
                        {formatStatusLabel(task.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 font-sans text-[11px] text-muted-foreground">
                      Updated {new Date(task.updatedAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <ListChecks className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Project Sections</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {projectActions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="rounded-xl border border-border/60 bg-background px-3 py-3 text-left transition-colors hover:bg-accent/40"
                  onClick={() => onSelectPage(item.page)}
                >
                  <div className="flex items-center gap-2">
                    <item.icon className="size-4 text-muted-foreground" />
                    <p className="font-sans text-sm font-medium">{item.label}</p>
                  </div>
                  <p className="mt-1.5 font-sans text-xs text-muted-foreground">{item.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <Brain className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Project Knowledge</h2>
            </div>
            <div className="grid gap-2">
              <Input
                value={knowledgeTitle}
                onChange={(event) => setKnowledgeTitle(event.target.value)}
                placeholder="Knowledge title"
              />
              <Textarea
                value={knowledgeContent}
                onChange={(event) => setKnowledgeContent(event.target.value)}
                placeholder="Facts, rules, context, terminology..."
                rows={3}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleAddKnowledge}
                  disabled={!knowledgeTitle.trim() || !knowledgeContent.trim()}
                >
                  Add Knowledge
                </Button>
              </div>
              {projectKnowledge.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-3 font-sans text-xs text-muted-foreground">
                  No project knowledge yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {projectKnowledge.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border/60 bg-background px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold">{item.title}</p>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => onDeleteKnowledge(item.id)}
                          aria-label={`Delete knowledge ${item.title}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-muted-foreground">{item.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="grid min-h-0 gap-3">
          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" />
              <h2 className="text-sm font-semibold">Project Health</h2>
            </div>
            <div className="grid gap-2">
              <div className="rounded-lg border border-border/60 bg-background px-2.5 py-2">
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Approvals</p>
                <p className="mt-1 text-sm font-semibold">{needsApprovalTasks + pendingApprovalsCount} pending</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background px-2.5 py-2">
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Schedule</p>
                <p className="mt-1 text-sm font-semibold">{scheduledCount} configured job{scheduledCount === 1 ? '' : 's'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background px-2.5 py-2">
                <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Failures</p>
                <p className="mt-1 text-sm font-semibold">{failedTasks} recent fail/reject</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Artifact Workspace</h2>
            </div>
            {artifacts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-3 font-sans text-xs text-muted-foreground">
                No artifacts for this project yet.
              </p>
            ) : (
              <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1">
                {artifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    className="rounded-lg border border-border/60 bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent/40"
                    onClick={() => onOpenArtifact(artifact)}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate font-sans text-xs font-medium text-foreground">{artifactDisplayName(artifact)}</p>
                      <Badge variant="outline" className="text-[10px]">{artifact.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <h2 className="text-sm font-semibold">Next Best Actions</h2>
            </div>
            <div className="grid gap-2">
              <Button type="button" className="justify-start gap-2" onClick={() => onSelectPage('cowork')}>
                <Play className="size-3.5" />
                Start Another Task
              </Button>
              <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => onSelectPage('safety')}>
                <Shield className="size-3.5" />
                Clear Pending Approvals
              </Button>
              <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => onSelectPage('scheduled')}>
                <CalendarClock className="size-3.5" />
                Tune Scheduled Jobs
              </Button>
              <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => onSelectPage('memory')}>
                <Brain className="size-3.5" />
                Update Project Memory
              </Button>
              <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => onSelectPage('activity')}>
                <Zap className="size-3.5" />
                Inspect Activity Trail
              </Button>
              <Button type="button" variant="outline" className="justify-start gap-2" onClick={() => onSelectPage('local-files')}>
                <FolderOpen className="size-3.5" />
                Open Project Folder
              </Button>
            </div>
          </div>

          {failedTasks > 0 && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
              <div className="flex items-center gap-2">
                <XCircle className="size-4 text-rose-600" />
                <h2 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Attention Needed</h2>
              </div>
              <p className="mt-1.5 font-sans text-xs text-rose-700/90 dark:text-rose-300/90">
                This project has failed or rejected tasks. Review activity and safety settings before the next run.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
