import type { FormEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type TaskState = 'idle' | 'planned';

type CoworkPageProps = {
  taskPrompt: string;
  workingFolder: string;
  taskState: TaskState;
  onTaskPromptChange: (value: string) => void;
  onWorkingFolderChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
};

const quickActions = ['Explore marketing skills', 'Repurpose content for social', 'Create case study presentation'];

const executionTimeline = [
  {
    label: 'Scope and access',
    detail: 'Confirm folder and backend route before touching files.',
  },
  {
    label: 'Plan generation',
    detail: 'Draft a multi-step plan and wait for approval.',
  },
  {
    label: 'Execution',
    detail: 'Run steps with periodic checkpoints and artifact previews.',
  },
];

export function CoworkPage({
  taskPrompt,
  workingFolder,
  taskState,
  onTaskPromptChange,
  onWorkingFolderChange,
  onSubmit,
}: CoworkPageProps) {
  return (
    <>
      <section className="mx-auto mb-4 w-full max-w-[860px]">
        <Badge variant="outline" className="mb-3 font-sans text-[11px] text-muted-foreground">
          OpenClaw Agent
        </Badge>
        <h1 className="mb-2 text-[clamp(1.7rem,2.6vw,2.35rem)] tracking-tight">Let&apos;s knock something off your list</h1>
        <p className="font-sans text-sm text-muted-foreground">
          Describe your objective, select a working folder, and OpenClaw will draft a plan for approval before execution.
        </p>

        <Card className="mt-4 rounded-xl border-border bg-card shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
          <CardContent>
            <form className="grid gap-3" onSubmit={onSubmit}>
              <label>
                <span className="mb-1 block font-sans text-xs text-muted-foreground">What can I help you with today?</span>
                <Textarea
                  value={taskPrompt}
                  onChange={(event) => onTaskPromptChange(event.target.value)}
                  placeholder="Help me organize my Downloads folder, draft naming conventions, and wait for approval before changes."
                  rows={3}
                  className="font-sans"
                />
              </label>

              <div className="flex items-end gap-2 max-sm:flex-col max-sm:items-stretch">
                <label className="flex-1">
                  <span className="mb-1 block font-sans text-xs text-muted-foreground">Working folder</span>
                  <Input
                    value={workingFolder}
                    onChange={(event) => onWorkingFolderChange(event.target.value)}
                    placeholder="/Downloads"
                    className="font-sans"
                  />
                </label>

                <Button className="border-0 bg-[linear-gradient(120deg,#ea9f7d,#de825e)] text-[#fffefb]" type="submit">
                  Plan with OpenClaw
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>

      <Card className="mx-auto mb-2 w-full max-w-[860px] rounded-xl border-border bg-card p-4 shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardContent>
          <p className="mb-2 font-sans text-xs tracking-wide text-muted-foreground uppercase">Get to work with Marketing</p>
          <div className="grid gap-2">
            {quickActions.map((action) => (
              <Button key={action} variant="outline" className="justify-start" type="button">
                {action}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mx-auto w-full max-w-[860px] rounded-xl border-border bg-card p-4 shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardHeader className="mb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle>Task flow</CardTitle>
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
    </>
  );
}
