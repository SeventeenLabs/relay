import type { FormEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type ChatPageProps = {
  taskPrompt: string;
  onTaskPromptChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
};

export function ChatPage({ taskPrompt, onTaskPromptChange, onSubmit }: ChatPageProps) {
  return (
    <section className="mx-auto grid h-full w-full max-w-[960px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
      <div>
        <Badge variant="outline" className="mb-2 font-sans text-[11px] text-muted-foreground">
          Chat
        </Badge>
        <h1 className="mb-1 text-[clamp(1.55rem,2.4vw,2rem)] tracking-tight">OpenClaw Chat</h1>
        <p className="font-sans text-sm text-muted-foreground">Talk through strategy, ask questions, and draft content before execution.</p>
      </div>

      <Card className="rounded-xl border-border bg-card p-0 shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardContent className="grid h-full gap-3 p-4">
          <div className="rounded-lg border border-border bg-background p-3 font-sans text-sm text-muted-foreground">
            Start a conversation. Your chat history will appear here.
          </div>
          <div className="rounded-lg border border-border bg-background p-3 font-sans text-sm text-muted-foreground">
            Tip: switch to Cowork when you want structured planning and approvals.
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border bg-card shadow-[0_8px_22px_rgba(51,43,30,0.06)]">
        <CardContent className="p-4">
          <form className="grid gap-3" onSubmit={onSubmit}>
            <Textarea
              value={taskPrompt}
              onChange={(event) => onTaskPromptChange(event.target.value)}
              placeholder="Ask OpenClaw to brainstorm, summarize, or draft your next move."
              rows={3}
              className="font-sans"
            />
            <div className="flex justify-end">
              <Button className="border-0 bg-[linear-gradient(120deg,#ea9f7d,#de825e)] text-[#fffefb]" type="submit">
                Send to OpenClaw
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
