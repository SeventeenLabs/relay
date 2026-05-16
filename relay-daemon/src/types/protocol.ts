export type DaemonSessionStatus = 'starting' | 'ready' | 'degraded' | 'dead' | 'closed';

export type SessionRecord = {
  id: string;
  workspace: string;
  workspacePath: string;
  status: DaemonSessionStatus;
  createdAt: string;
  updatedAt: string;
  label?: string;
  acpPid?: number;
};

export type WsEnvelope<T = unknown> = {
  type: string;
  requestId?: string;
  sessionId?: string;
  ts: string;
  payload: T;
};

export type CreateSessionInput = {
  workspace: string;
  label?: string;
};

export type SendInput = {
  text: string;
};

export type ApprovalDecision = {
  decision: 'approve' | 'deny';
  approvalId: string;
  reason?: string;
};
