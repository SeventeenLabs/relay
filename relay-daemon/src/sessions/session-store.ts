import { nanoid } from 'nanoid';
import type { DaemonSessionStatus, SessionRecord } from '../types/protocol.js';

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  list(): SessionRecord[] {
    return Array.from(this.sessions.values());
  }

  create(input: { workspace: string; workspacePath: string; label?: string }): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: `rs_${nanoid(12)}`,
      workspace: input.workspace,
      workspacePath: input.workspacePath,
      status: 'starting',
      createdAt: now,
      updatedAt: now,
      label: input.label,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): SessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
  }

  updateStatus(sessionId: string, status: DaemonSessionStatus, patch?: Partial<SessionRecord>): SessionRecord {
    const current = this.sessions.get(sessionId);
    if (!current) throw new Error('session_not_found');
    const next: SessionRecord = {
      ...current,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}
