import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AcpSupervisor } from '../acp/acp-supervisor.js';
import type { SessionStore } from '../sessions/session-store.js';
import type { WorkspaceGuard } from '../workspaces/workspace-guard.js';
import type { WsHub } from '../ws/ws-server.js';

const execFileAsync = promisify(execFile);

const CreateSessionSchema = z.object({
  workspace: z.string().min(1),
  label: z.string().optional(),
});

const SendInputSchema = z.object({
  text: z.string().min(1),
});

const ApprovalSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  approvalId: z.string().min(1),
  reason: z.string().optional(),
});

const WorkspaceReadSchema = z.object({
  path: z.string().min(1),
});

const WorkspaceWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const WorkspaceRenameSchema = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
});

const WorkspaceDeleteSchema = z.object({
  path: z.string().min(1),
});

const KanbanCreateSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  assignee: z.string().optional(),
  tenant: z.string().optional(),
  rootPath: z.string().optional(),
});

const KanbanCommentSchema = z.object({
  text: z.string().min(1),
  rootPath: z.string().optional(),
});

const CronCreateSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
});

const CronUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  schedule: z.string().optional(),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
});

function toHttpError(message: string) {
  return { error: { code: 'internal_error', message } };
}

async function runHermesCli(args: string[], cwd: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('hermes', ['--accept-hooks', ...args], {
      cwd,
      timeout: timeoutMs,
      env: {
        ...process.env,
        HERMES_ACCEPT_HOOKS: '1',
      },
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; message?: string };
    const stderr = (details.stderr ?? '').trim();
    const stdout = (details.stdout ?? '').trim();
    const message = stderr || stdout || details.message || 'Hermes CLI command failed.';
    throw new Error(message);
  }
}

function ensureWithinRoot(rootPath: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootPath);
  const target = path.resolve(normalizedRoot, relativePath || '.');
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('Path escapes workspace root.');
  }
  return target;
}

function relPathFromRoot(rootPath: string, absolutePath: string): string {
  const rel = path.relative(rootPath, absolutePath);
  if (!rel || rel === '.') return '';
  return rel.replace(/\\/g, '/');
}

function extractFirstLikelyId(text: string): string | null {
  const match = text.match(/\b([a-z0-9][a-z0-9_-]{5,}|[0-9a-f]{8}-[0-9a-f-]{27,})\b/i);
  return match?.[1] ?? null;
}

function parseCronList(stdout: string): Array<{ id: string; name: string; schedule: string; enabled: boolean; state: string; nextRunAt: string | null; lastRunAt: string | null }> {
  const normalized = stdout.trim();
  if (!normalized || /no scheduled jobs/i.test(normalized)) {
    return [];
  }

  const jobs: Array<{ id: string; name: string; schedule: string; enabled: boolean; state: string; nextRunAt: string | null; lastRunAt: string | null }> = [];
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (/^id\b/i.test(line) || /^name\b/i.test(line) || /^-+$/.test(line)) {
      continue;
    }
    const id = extractFirstLikelyId(line);
    if (!id) {
      continue;
    }
    const enabled = !/(disabled|paused)/i.test(line);
    const state = enabled ? 'enabled' : 'paused';
    const name = line.replace(id, '').trim() || id;
    jobs.push({
      id,
      name,
      schedule: 'unknown',
      enabled,
      state,
      nextRunAt: null,
      lastRunAt: null,
    });
  }

  return jobs;
}

export function registerHttpRoutes(app: FastifyInstance, deps: {
  sessions: SessionStore;
  workspaces: WorkspaceGuard;
  acp: AcpSupervisor;
  wsHub: WsHub;
  startedAtMs: number;
}) {
  app.get('/health', async () => {
    return {
      ok: true,
      service: 'relay-daemon',
      uptimeSec: Math.floor((Date.now() - deps.startedAtMs) / 1000),
      version: '0.1.0',
    };
  });

  app.get('/v1/models', async () => {
    const envModel = process.env.HERMES_INFERENCE_MODEL?.trim();
    const fallbackModel = envModel || 'hermes-agent';
    return {
      data: [{ id: fallbackModel }],
    };
  });

  app.get('/v1/workspaces', async () => {
    return { workspaces: deps.workspaces.list() };
  });

  app.post('/v1/sessions', async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }

    try {
      const workspacePath = await deps.workspaces.resolveWorkspacePath(parsed.data.workspace);
      const session = deps.sessions.create({
        workspace: parsed.data.workspace,
        workspacePath,
        label: parsed.data.label,
      });

      const pid = deps.acp.attach(session, (eventType, payload) => {
        if (eventType === 'process_exit') {
          const next = deps.sessions.updateStatus(session.id, 'dead');
          deps.wsHub.broadcastSession(next);
        }
        deps.wsHub.broadcast(eventType, payload, { sessionId: session.id });
      });

      const ready = deps.sessions.updateStatus(session.id, 'ready', { acpPid: pid > 0 ? pid : undefined });
      deps.wsHub.broadcastSession(ready, 'session_created');
      return { session: ready };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('workspace_not_found:')) {
        return reply.status(404).send({ error: { code: 'workspace_not_found', message } });
      }
      return reply.status(500).send({ error: { code: 'internal_error', message } });
    }
  });

  app.get('/v1/sessions', async () => ({ sessions: deps.sessions.list() }));

  app.get('/v1/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }
    return { session };
  });

  app.post('/v1/sessions/:id/input', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SendInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    try {
      deps.acp.sendInput(id, parsed.data.text);
      return { accepted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'session_not_found') {
        return reply.status(404).send({ error: { code: message, message } });
      }
      return reply.status(500).send({ error: { code: 'acp_write_failed', message } });
    }
  });

  app.post('/v1/sessions/:id/approval', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ApprovalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    try {
      deps.acp.sendApproval(id, parsed.data.decision, parsed.data.approvalId, parsed.data.reason);
      deps.wsHub.broadcast('approval_resolved', parsed.data, { sessionId: id });
      return { accepted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'session_not_found') {
        return reply.status(404).send({ error: { code: message, message } });
      }
      return reply.status(500).send({ error: { code: 'acp_write_failed', message } });
    }
  });

  app.post('/v1/sessions/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      deps.acp.interrupt(id);
      deps.wsHub.broadcast('run_activity', { detail: 'interrupt_requested' }, { sessionId: id });
      return { accepted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'session_not_found') {
        return reply.status(404).send({ error: { code: message, message } });
      }
      return reply.status(500).send({ error: { code: 'internal_error', message } });
    }
  });

  app.delete('/v1/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }

    deps.acp.close(id);
    deps.sessions.updateStatus(id, 'closed');
    deps.sessions.remove(id);
    deps.wsHub.broadcast('session_closed', { id }, { sessionId: id });
    return { deleted: true };
  });

  app.get('/v1/sessions/:id/workspace/list', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as Record<string, unknown>;
    const rel = typeof query.path === 'string' ? query.path.trim() : '';
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }
    try {
      const root = session.workspacePath;
      const target = ensureWithinRoot(root, rel || '.');
      const entries = await fs.readdir(target, { withFileTypes: true });
      const items = await Promise.all(
        entries.map(async (entry) => {
          const absolute = path.join(target, entry.name);
          const stats = await fs.stat(absolute);
          return {
            path: relPathFromRoot(root, absolute),
            kind: entry.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modifiedMs: stats.mtimeMs,
          };
        }),
      );
      return { items, truncated: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.get('/v1/sessions/:id/workspace/read', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as Record<string, unknown>;
    const parsed = WorkspaceReadSchema.safeParse({ path: query.path });
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }
    try {
      const target = ensureWithinRoot(session.workspacePath, parsed.data.path);
      const content = await fs.readFile(target, 'utf8');
      return { content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.get('/v1/sessions/:id/workspace/stat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as Record<string, unknown>;
    const parsed = WorkspaceReadSchema.safeParse({ path: query.path });
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }
    try {
      const target = ensureWithinRoot(session.workspacePath, parsed.data.path);
      const stats = await fs.stat(target);
      return {
        kind: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        createdMs: stats.ctimeMs,
        modifiedMs: stats.mtimeMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.post('/v1/sessions/:id/workspace/write', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = WorkspaceWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }
    try {
      const target = ensureWithinRoot(session.workspacePath, parsed.data.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, parsed.data.content, 'utf8');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.post('/v1/sessions/:id/workspace/rename', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = WorkspaceRenameSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }
    try {
      const source = ensureWithinRoot(session.workspacePath, parsed.data.oldPath);
      const target = ensureWithinRoot(session.workspacePath, parsed.data.newPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(source, target);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.post('/v1/sessions/:id/workspace/delete', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = WorkspaceDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: { code: 'session_not_found', message: `Session not found: ${id}` } });
    }
    try {
      const target = ensureWithinRoot(session.workspacePath, parsed.data.path);
      await fs.rm(target, { recursive: true, force: true });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.get('/v1/kanban/tasks', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const rootPath = typeof query.rootPath === 'string' && query.rootPath.trim()
      ? query.rootPath.trim()
      : deps.workspaces.list()[0]?.path ?? process.cwd();

    const args = ['kanban', 'list', '--json'];
    if (typeof query.assignee === 'string' && query.assignee.trim()) args.push('--assignee', query.assignee.trim());
    if (typeof query.status === 'string' && query.status.trim()) args.push('--status', query.status.trim());
    if (typeof query.tenant === 'string' && query.tenant.trim()) args.push('--tenant', query.tenant.trim());
    if (query.archived === true || query.archived === 'true' || query.archived === '1') args.push('--archived');

    try {
      const { stdout } = await runHermesCli(args, rootPath, 30_000);
      const parsed = JSON.parse(stdout) as unknown;
      const tasks = Array.isArray(parsed) ? parsed : [];
      return { tasks };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.post('/v1/kanban/tasks', async (req, reply) => {
    const parsed = KanbanCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const rootPath = parsed.data.rootPath?.trim() || deps.workspaces.list()[0]?.path || process.cwd();
    const args = ['kanban', 'create', parsed.data.title.trim(), '--json'];
    if (parsed.data.body?.trim()) args.push('--body', parsed.data.body.trim());
    if (parsed.data.assignee?.trim()) args.push('--assignee', parsed.data.assignee.trim());
    if (parsed.data.tenant?.trim()) args.push('--tenant', parsed.data.tenant.trim());

    try {
      const { stdout } = await runHermesCli(args, rootPath, 30_000);
      const data = JSON.parse(stdout) as Record<string, unknown>;
      const taskId = typeof data.task_id === 'string'
        ? data.task_id.trim()
        : typeof data.id === 'string'
          ? data.id.trim()
          : '';
      return { id: taskId || null, raw: data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.get('/v1/kanban/tasks/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const query = req.query as Record<string, unknown>;
    const rootPath = typeof query.rootPath === 'string' && query.rootPath.trim()
      ? query.rootPath.trim()
      : deps.workspaces.list()[0]?.path ?? process.cwd();
    try {
      const { stdout } = await runHermesCli(['kanban', 'show', taskId.trim(), '--json'], rootPath, 30_000);
      const task = JSON.parse(stdout) as unknown;
      return { task };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.post('/v1/kanban/tasks/:taskId/comment', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const parsed = KanbanCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const rootPath = parsed.data.rootPath?.trim() || deps.workspaces.list()[0]?.path || process.cwd();
    try {
      await runHermesCli(['kanban', 'comment', taskId.trim(), parsed.data.text.trim()], rootPath, 30_000);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.get('/v1/cron/jobs', async (_req, reply) => {
    try {
      const { stdout } = await runHermesCli(['cron', 'list', '--all'], process.cwd(), 30_000);
      const jobs = parseCronList(stdout);
      return { jobs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.post('/v1/cron/jobs', async (req, reply) => {
    const parsed = CronCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }
    const prompt = parsed.data.prompt?.trim() ?? '';
    const args = ['cron', 'create', parsed.data.schedule.trim()];
    if (prompt) args.push(prompt);
    args.push('--name', parsed.data.name.trim());
    if (parsed.data.enabled === false) {
      args.push('--repeat', '0');
    }

    try {
      const { stdout, stderr } = await runHermesCli(args, process.cwd(), 30_000);
      const id = extractFirstLikelyId(`${stdout}\n${stderr}`);
      return { id, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.patch('/v1/cron/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CronUpdateSchema.safeParse({ ...(req.body as Record<string, unknown>), id });
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    }

    const args = ['cron', 'edit', parsed.data.id.trim()];
    if (parsed.data.name?.trim()) args.push('--name', parsed.data.name.trim());
    if (parsed.data.schedule?.trim()) args.push('--schedule', parsed.data.schedule.trim());
    if (typeof parsed.data.prompt === 'string') args.push('--prompt', parsed.data.prompt);
    if (parsed.data.enabled === true) args.push('--agent');
    if (parsed.data.enabled === false) args.push('--no-agent');

    try {
      await runHermesCli(args, process.cwd(), 30_000);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });

  app.delete('/v1/cron/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await runHermesCli(['cron', 'remove', id.trim()], process.cwd(), 30_000);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(toHttpError(message));
    }
  });
}
