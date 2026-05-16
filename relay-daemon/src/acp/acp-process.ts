import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type AcpEventHandler = (event: { type: string; text?: string; raw?: string }) => void;

export class AcpProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';

  constructor(
    private readonly hermesBin: string,
    private readonly cwd: string,
    private readonly onEvent: AcpEventHandler,
  ) {}

  start(): number {
    if (this.child) {
      throw new Error('ACP process already started');
    }

    this.child = spawn(this.hermesBin, ['acp'], {
      cwd: this.cwd,
      stdio: 'pipe',
      env: process.env,
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      let idx = this.stdoutBuffer.indexOf('\n');
      while (idx >= 0) {
        const line = this.stdoutBuffer.slice(0, idx).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
        if (line) {
          this.onEvent({ type: 'acp_stdout', raw: line });
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const text = typeof parsed['text'] === 'string' ? parsed['text'] : undefined;
            this.onEvent({ type: 'acp_json', text, raw: line });
          } catch {
            // non-json line, keep raw
          }
        }
        idx = this.stdoutBuffer.indexOf('\\n');
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.onEvent({ type: 'acp_stderr', raw: chunk });
    });

    this.child.on('exit', (code, signal) => {
      this.onEvent({ type: 'acp_exit', raw: `code=${String(code)} signal=${String(signal)}` });
    });

    return this.child.pid ?? -1;
  }

  writeJson(payload: unknown) {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error('ACP process stdin is not writable');
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\\n`);
  }

  interrupt() {
    if (!this.child) return;
    this.child.kill('SIGINT');
  }

  stop() {
    if (!this.child) return;
    this.child.kill('SIGTERM');
    this.child = null;
  }
}
