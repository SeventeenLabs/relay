import { useEffect, useMemo, useState } from 'react';
import { FolderKanban, MessageSquarePlus, Plus, RefreshCw } from 'lucide-react';

import type { CoworkProject } from '@/app-types';
import type { HermesKanbanTask, HermesKanbanTaskDetail } from '@/lib/agent-backend-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type KanbanPageTarget = 'cowork' | 'project' | 'kanban' | 'settings';

type KanbanPageProps = {
  project: CoworkProject | null;
  tasks: HermesKanbanTask[];
  taskDetail: HermesKanbanTaskDetail | null;
  loading: boolean;
  creating: boolean;
  commenting: boolean;
  onSelectPage: (page: KanbanPageTarget) => void;
  onRefresh: () => void;
  onCreateTask: (input: { title: string; body?: string; assignee?: string }) => Promise<void>;
  onSelectTask: (taskId: string) => Promise<void>;
  onCommentTask: (taskId: string, text: string) => Promise<void>;
};

const laneOrder = ['triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived'];

function toLaneLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function KanbanPage(props: KanbanPageProps) {
  const {
    project,
    tasks,
    taskDetail,
    loading,
    creating,
    commenting,
    onSelectPage,
    onRefresh,
    onCreateTask,
    onSelectTask,
    onCommentTask,
  } = props;

  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftAssignee, setDraftAssignee] = useState('');
  const [commentDraft, setCommentDraft] = useState('');

  useEffect(() => {
    setCommentDraft('');
  }, [taskDetail?.id]);

  const tasksByLane = useMemo(() => {
    const grouped = new Map<string, HermesKanbanTask[]>();
    for (const task of tasks) {
      const lane = task.status?.trim().toLowerCase() || 'unknown';
      const bucket = grouped.get(lane) ?? [];
      bucket.push(task);
      grouped.set(lane, bucket);
    }
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => {
        const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return right - left;
      });
    }
    return grouped;
  }, [tasks]);

  const orderedLanes = useMemo(() => {
    const dynamic = Array.from(tasksByLane.keys()).filter((lane) => !laneOrder.includes(lane));
    return [...laneOrder, ...dynamic].filter((lane) => tasksByLane.has(lane));
  }, [tasksByLane]);

  const handleCreateTask = async () => {
    const title = draftTitle.trim();
    if (!title) {
      return;
    }
    await onCreateTask({
      title,
      body: draftBody.trim() || undefined,
      assignee: draftAssignee.trim() || undefined,
    });
    setDraftTitle('');
    setDraftBody('');
    setDraftAssignee('');
  };

  const handleComment = async () => {
    const taskId = taskDetail?.id?.trim() ?? '';
    const text = commentDraft.trim();
    if (!taskId || !text) {
      return;
    }
    await onCommentTask(taskId, text);
    setCommentDraft('');
  };

  if (!project) {
    return (
      <section className="grid h-full w-full place-items-center p-6">
        <div className="w-full max-w-xl rounded-2xl border border-border/60 bg-card p-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">No project selected</h1>
          <p className="mt-2 font-sans text-sm text-muted-foreground">
            Select a project from the sidebar to view its Kanban board.
          </p>
          <Button type="button" className="mt-4" onClick={() => onSelectPage('project')}>
            Open Project Home
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full w-full min-h-0 flex-col gap-3 overflow-y-auto p-4 pb-8">
      <header className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
              <Badge variant="secondary" className="h-6 gap-1 px-2 text-[11px]">
                <FolderKanban className="size-3" />
                Kanban
              </Badge>
            </div>
            <p className="mt-1 max-w-4xl font-sans text-sm text-muted-foreground">
              Project-scoped Hermes Kanban board. Create tasks, inspect status lanes, and add task comments.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={() => onSelectPage('project')}>
              Project Home
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => onSelectPage('cowork')}>
              Cowork
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="rounded-2xl border border-border/60 bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <Plus className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Create task</h2>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="Task title"
          />
          <Input
            value={draftAssignee}
            onChange={(event) => setDraftAssignee(event.target.value)}
            placeholder="Assignee profile (optional)"
          />
        </div>
        <Textarea
          value={draftBody}
          onChange={(event) => setDraftBody(event.target.value)}
          placeholder="Task body (optional)"
          rows={3}
          className="mt-2"
        />
        <div className="mt-2">
          <Button type="button" onClick={() => void handleCreateTask()} disabled={creating || !draftTitle.trim()}>
            {creating ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border/60 bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Board</h2>
            <Badge variant="outline" className="text-[10px]">{tasks.length} tasks</Badge>
          </div>

          {orderedLanes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
              No Kanban tasks yet.
            </p>
          ) : (
            <div className="grid gap-3">
              {orderedLanes.map((lane) => {
                const laneTasks = tasksByLane.get(lane) ?? [];
                return (
                  <div key={lane} className="rounded-xl border border-border/60 bg-background p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{toLaneLabel(lane)}</h3>
                      <Badge variant="outline" className="text-[10px]">{laneTasks.length}</Badge>
                    </div>
                    <div className="grid gap-1.5">
                      {laneTasks.map((task) => {
                        const active = taskDetail?.id === task.id;
                        return (
                          <button
                            key={task.id}
                            type="button"
                            className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                              active
                                ? 'border-blue-500/40 bg-blue-500/10'
                                : 'border-border/60 bg-card hover:bg-accent/30'
                            }`}
                            onClick={() => void onSelectTask(task.id)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-medium">{task.title}</p>
                              <span className="text-[10px] font-mono text-muted-foreground">{task.id}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                              {task.assignee ? <span>assignee: {task.assignee}</span> : null}
                              {task.updatedAt ? <span>updated: {new Date(task.updatedAt).toLocaleString()}</span> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-border/60 bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Task detail</h2>
            {taskDetail ? <Badge variant="outline" className="text-[10px]">{toLaneLabel(taskDetail.status)}</Badge> : null}
          </div>

          {!taskDetail ? (
            <p className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
              Select a task to inspect details and comments.
            </p>
          ) : (
            <div className="grid gap-3">
              <div className="rounded-xl border border-border/60 bg-background px-3 py-2.5">
                <p className="text-xs font-semibold">{taskDetail.title}</p>
                {taskDetail.body ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{taskDetail.body}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">No body.</p>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <MessageSquarePlus className="size-3.5" />
                  Comments
                </div>
                {(taskDetail.comments ?? []).length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
                    No comments yet.
                  </p>
                ) : (
                  <div className="grid gap-1.5">
                    {(taskDetail.comments ?? []).map((comment, index) => (
                      <div key={`${comment.createdAt ?? 'comment'}-${index}`} className="rounded-lg border border-border/60 bg-background px-2.5 py-2">
                        <p className="whitespace-pre-wrap text-xs">{comment.text}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {(comment.author ?? 'unknown')}
                          {comment.createdAt ? ` · ${new Date(comment.createdAt).toLocaleString()}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add comment"
                rows={3}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleComment()}
                disabled={commenting || !commentDraft.trim()}
              >
                {commenting ? 'Posting…' : 'Post comment'}
              </Button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
