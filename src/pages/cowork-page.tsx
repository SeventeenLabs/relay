import type { FormEvent } from 'react';

import type { LocalFilePlanAction } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

type TaskState = 'idle' | 'planned';

type CoworkPageProps = {
  taskPrompt: string;
  workingFolder: string;
  taskState: TaskState;
  status: string;
  desktopBridgeAvailable: boolean;
  localPlanActions: LocalFilePlanAction[];
  localPlanLoading: boolean;
  localApplyLoading: boolean;
  onTaskPromptChange: (value: string) => void;
  onWorkingFolderChange: (value: string) => void;
  onPickWorkingFolder: () => void | Promise<void>;
  onSubmit: (event: FormEvent) => void;
  onCreateLocalPlan: () => void | Promise<void>;
  onApplyLocalPlan: () => void | Promise<void>;
};

const quickActions = ['Explore marketing skills', 'Repurpose content for social', 'Create case study presentation'];

const executionTimeline = [
  {
    label: 'Share objective and scope',
    detail: 'Give OpenClaw your task, constraints, and folder access boundaries.',
  },
  {
    label: 'Plan first, approve second',
    detail: 'OpenClaw drafts steps and waits for approval before significant actions.',
  },
  {
    label: 'Execute with checkpoints',
    detail: 'Track progress in real time, refine direction, and continue without losing context.',
  },
  {
    label: 'Schedule recurring workflows',
    detail: 'Reuse a proven task prompt for daily, weekly, or monthly runs.',
  },
];

const accessSurfaces = ['Desktop files', 'Gateway tools', 'Connectors (Slack, Notion, GitHub)', 'Web research in browser'];

const useCaseCards = [
  {
    title: 'Organize files',
    detail: 'Clean and rename cluttered folders with consistent naming and category structure.',
  },
  {
    title: 'Build reports',
    detail: 'Turn notes and datasets into concise deliverables with an approval checkpoint.',
  },
  {
    title: 'Daily briefings',
    detail: 'Summarize priorities across tools and deliver one focused update.',
  },
  {
    title: 'Feedback synthesis',
    detail: 'Aggregate customer signals from multiple sources into ranked action items.',
  },
];

export function CoworkPage({
  taskPrompt,
  workingFolder,
  taskState,
  status,
  desktopBridgeAvailable,
  localPlanActions,
  localPlanLoading,
  localApplyLoading,
  onTaskPromptChange,
  onWorkingFolderChange,
  onPickWorkingFolder,
  onSubmit,
  onCreateLocalPlan,
  onApplyLocalPlan,
}: CoworkPageProps) {
  return (
    <>
      <section className="mx-auto mb-4 w-full max-w-[860px]">
        <Badge variant="outline" className="mb-3 font-sans text-[11px] text-muted-foreground">
          OpenClaw Cowork
        </Badge>
        <h1 className="mb-2 text-[clamp(1.7rem,2.6vw,2.35rem)] tracking-tight">Agentic desktop work, with approvals</h1>
        <p className="font-sans text-sm text-muted-foreground">
          Describe your goal, grant access to the right context, and run structured tasks with plan-first execution.
        </p>

        <Card className="mt-4 rounded-xl border-border bg-card shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
          <CardContent>
            <form className="grid gap-3" onSubmit={onSubmit}>
              <label>
                <span className="mb-1 block font-sans text-xs text-muted-foreground">Goal and constraints</span>
                <Textarea
                  value={taskPrompt}
                  onChange={(event) => onTaskPromptChange(event.target.value)}
                  placeholder="Organize my Downloads folder by type, suggest naming conventions, flag duplicates, and wait for approval before file changes."
                  rows={3}
                  className="font-sans"
                />
              </label>

              <div className="flex items-end gap-2 max-sm:flex-col max-sm:items-stretch">
                <label className="flex-1">
                  <span className="mb-1 block font-sans text-xs text-muted-foreground">Working folder</span>
                  <div className="flex items-center gap-2">
                    <Input
                      value={workingFolder}
                      onChange={(event) => onWorkingFolderChange(event.target.value)}
                      placeholder="/Downloads"
                      className="font-sans"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onPickWorkingFolder()}
                    >
                      Browse
                    </Button>
                  </div>
                </label>

                <Button className="border-0 bg-[linear-gradient(120deg,#ea9f7d,#de825e)] text-[#fffefb]" type="submit">
                  Draft plan
                </Button>
              </div>
            </form>

            <div className="mt-3 grid gap-2 rounded-lg border border-border/70 bg-background p-3">
              <p className="font-sans text-xs uppercase tracking-wide text-muted-foreground">Context surfaces</p>
              <div className="flex flex-wrap gap-1.5">
                {accessSurfaces.map((surface) => (
                  <Badge key={surface} variant="outline" className="font-sans text-[11px]">
                    {surface}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="mx-auto mb-2 w-full max-w-[860px] rounded-xl border-border bg-card p-4 shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardContent>
          <p className="mb-2 font-sans text-xs tracking-wide text-muted-foreground uppercase">Common cowork outcomes</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {useCaseCards.map((card) => (
              <div key={card.title} className="rounded-lg border border-border/70 bg-background p-3">
                <h3 className="text-sm font-medium text-foreground">{card.title}</h3>
                <p className="mt-1 font-sans text-xs text-muted-foreground">{card.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mx-auto w-full max-w-[860px] rounded-xl border-border bg-card p-4 shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardHeader className="mb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle>Cowork execution model</CardTitle>
          <Badge
            variant="outline"
            className={
              taskState === 'planned'
                ? 'rounded-full border border-[rgba(47,122,88,0.35)] bg-[rgba(47,122,88,0.08)] font-sans text-[11px] text-[#2f7a58]'
                : 'rounded-full font-sans text-[11px]'
            }
          >
            {taskState === 'planned' ? 'Plan ready' : 'Awaiting prompt'}
          </Badge>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 pl-5">
            {executionTimeline.map((step) => (
              <li key={step.label}>
                <h3 className="text-sm font-medium">{step.label}</h3>
                <p className="mt-1 font-sans text-sm text-muted-foreground">{step.detail}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="mx-auto mt-2 w-full max-w-[860px] rounded-xl border-border bg-card p-4 shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardHeader className="mb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle>Desktop local files</CardTitle>
          <Badge variant="outline" className="font-sans text-[11px]">
            Plan then approve
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="font-sans text-xs text-muted-foreground">{status}</p>
          {!desktopBridgeAvailable && (
            <div className="rounded-lg border border-dashed border-border p-3 font-sans text-xs text-muted-foreground">
              Local file actions require the Electron desktop app. The web preview cannot open native folder pickers.
            </div>
          )}
          <p className="font-sans text-sm text-muted-foreground">
            This runs on your computer folder, not on the OpenClaw host. Generate a plan first, then approve changes.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void onCreateLocalPlan()}
              disabled={localPlanLoading}
            >
              {localPlanLoading ? 'Planning...' : 'Generate plan'}
            </Button>
            <Button
              type="button"
              className="border-0 bg-[linear-gradient(120deg,#ea9f7d,#de825e)] text-[#fffefb]"
              onClick={() => void onApplyLocalPlan()}
              disabled={localApplyLoading || localPlanActions.length === 0}
            >
              {localApplyLoading ? 'Applying...' : `Apply ${localPlanActions.length} actions`}
            </Button>
          </div>

          <div className="rounded-lg border border-border/80 bg-background p-2">
            {localPlanActions.length === 0 ? (
              <p className="font-sans text-xs text-muted-foreground">No local changes planned yet.</p>
            ) : (
              <ScrollArea className="h-[200px]">
                <ul className="grid gap-1 pr-2">
                  {localPlanActions.map((action) => (
                    <li key={action.id} className="rounded-md border border-border/70 p-2">
                      <p className="font-sans text-xs text-muted-foreground">{action.category}</p>
                      <p className="truncate font-mono text-xs text-foreground">{action.fromPath}</p>
                      <p className="truncate font-mono text-xs text-foreground">{action.toPath}</p>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
