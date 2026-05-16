import { AcpProcess } from './acp-process.js';
import type { SessionRecord } from '../types/protocol.js';

export class AcpSupervisor {
  private readonly bySession = new Map<string, AcpProcess>();

  constructor(private readonly hermesBin: string) {}

  attach(session: SessionRecord, onEvent: (eventType: string, payload: Record<string, unknown>) => void) {
    const proc = new AcpProcess(this.hermesBin, session.workspacePath, (event) => {
      if (event.type === 'acp_exit') {
        onEvent('process_exit', { detail: event.raw ?? '' });
        return;
      }
      if (event.type === 'acp_json') {
        onEvent('stream_delta', { text: event.text ?? '', raw: event.raw ?? '' });
        return;
      }
      onEvent('run_activity', { detail: event.raw ?? '', source: event.type });
    });

    const pid = proc.start();
    this.bySession.set(session.id, proc);
    return pid;
  }

  sendInput(sessionId: string, text: string) {
    const proc = this.bySession.get(sessionId);
    if (!proc) {
      throw new Error('session_not_found');
    }
    proc.writeJson({ method: 'session/input', params: { text } });
  }

  sendApproval(sessionId: string, decision: 'approve' | 'deny', approvalId: string, reason?: string) {
    const proc = this.bySession.get(sessionId);
    if (!proc) throw new Error('session_not_found');
    proc.writeJson({ method: 'session/approval', params: { decision, approvalId, reason } });
  }

  interrupt(sessionId: string) {
    const proc = this.bySession.get(sessionId);
    if (!proc) throw new Error('session_not_found');
    proc.interrupt();
  }

  close(sessionId: string) {
    const proc = this.bySession.get(sessionId);
    if (!proc) return;
    proc.stop();
    this.bySession.delete(sessionId);
  }
}
