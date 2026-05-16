import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { SessionRecord } from '../types/protocol.js';

export class WsHub {
  private readonly sockets = new Set<WebSocket>();

  registerRoutes(app: FastifyInstance) {
    app.get('/v1/ws', { websocket: true }, (socket) => {
      this.sockets.add(socket);

      socket.on('message', (buf) => {
        const raw = String(buf ?? '');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          this.send(socket, { type: 'error', ts: new Date().toISOString(), payload: { code: 'invalid_request', message: 'Invalid JSON' } });
          return;
        }

        const msg = parsed as { type?: string; requestId?: string };
        if (msg.type === 'ping') {
          this.send(socket, {
            type: 'pong',
            requestId: msg.requestId,
            ts: new Date().toISOString(),
            payload: {},
          });
        }
      });

      socket.on('close', () => {
        this.sockets.delete(socket);
      });
    });
  }

  send(socket: WebSocket, envelope: Record<string, unknown>) {
    socket.send(JSON.stringify(envelope));
  }

  broadcast(type: string, payload: Record<string, unknown>, opts?: { sessionId?: string; requestId?: string }) {
    const envelope = {
      type,
      ts: new Date().toISOString(),
      sessionId: opts?.sessionId,
      requestId: opts?.requestId,
      payload,
    };
    const serialized = JSON.stringify(envelope);
    for (const socket of this.sockets) {
      socket.send(serialized);
    }
  }

  broadcastSession(session: SessionRecord, type: 'session_created' | 'session_updated' | 'session_closed' = 'session_updated') {
    this.broadcast(type, { session }, { sessionId: session.id });
  }
}
