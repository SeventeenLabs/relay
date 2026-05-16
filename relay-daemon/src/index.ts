import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { loadConfig } from './config.js';
import { enforceToken } from './auth/token-auth.js';
import { WorkspaceGuard } from './workspaces/workspace-guard.js';
import { SessionStore } from './sessions/session-store.js';
import { AcpSupervisor } from './acp/acp-supervisor.js';
import { WsHub } from './ws/ws-server.js';
import { registerHttpRoutes } from './http/routes.js';

async function main() {
  const config = loadConfig();
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  const startedAtMs = Date.now();
  const sessions = new SessionStore();
  const workspaces = new WorkspaceGuard(config.workspaces);
  const acp = new AcpSupervisor(config.hermesBin);
  const wsHub = new WsHub();

  await app.register(websocket);

  app.addHook('onRequest', enforceToken(config.token));

  wsHub.registerRoutes(app);
  registerHttpRoutes(app, {
    sessions,
    workspaces,
    acp,
    wsHub,
    startedAtMs,
  });

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, 'relay-daemon listening');
}

main().catch((error) => {
  console.error('[relay-daemon] fatal startup error', error);
  process.exit(1);
});
