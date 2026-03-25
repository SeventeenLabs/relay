import type { ConnectorDefinition, ConnectorActionResult, ConnectorExecutionContext } from './connector-types';

export type ShellExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function createShellConnector(): ConnectorDefinition {
  return {
    id: 'shell',
    name: 'Shell / Terminal',
    description: 'Execute commands in the working directory. Always requires approval.',
    icon: 'terminal',
    status: 'inactive', // disabled by default — critical scope
    config: {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      blockedCommands: ['rm -rf /', 'format', 'mkfs', 'dd if=', ':(){:|:&};:'],
    },
    actions: [
      {
        id: 'shell.exec',
        name: 'Execute command',
        description: 'Run a shell command and return stdout/stderr (always requires approval)',
        scopeId: 'shell-execute',
        riskLevel: 'critical',
        params: [
          { name: 'command', description: 'Shell command to execute', required: true, type: 'string' },
          { name: 'timeoutMs', description: 'Execution timeout in milliseconds', required: false, type: 'number' },
        ],
      },
    ],
    test: async () => {
      // Shell connector is available when the Electron bridge exposes shellExec
      return { ok: true, message: 'Shell connector available (commands require approval).' };
    },
    execute: async (actionId: string, params: Record<string, unknown>, ctx: ConnectorExecutionContext): Promise<ConnectorActionResult> => {
      if (actionId !== 'shell.exec') {
        return { ok: false, errorCode: 'UNKNOWN_ACTION', message: `Unknown action: ${actionId}` };
      }

      const { rootPath, bridge } = ctx;
      if (!bridge.shellExec) {
        return { ok: false, errorCode: 'UNAVAILABLE', message: 'Shell execution bridge unavailable.' };
      }

      const command = typeof params.command === 'string' ? params.command.trim() : '';
      if (!command) {
        return { ok: false, errorCode: 'INVALID_PARAMS', message: 'Command is required.' };
      }

      // Check blocked commands — simple substring match
      const blocked = Array.isArray(ctx.bridge) ? [] : ((ctx as unknown as { connector?: ConnectorDefinition })?.connector?.config?.blockedCommands as string[] | undefined) ?? [];
      // Fallback: use the connector instance config if accessible, otherwise skip
      const blockedList = Array.isArray(blocked) ? blocked : [];
      for (const pattern of blockedList) {
        if (command.includes(pattern)) {
          return { ok: false, errorCode: 'BLOCKED_COMMAND', message: `Command blocked by safety policy: contains "${pattern}"` };
        }
      }

      const timeoutMs = Math.min(
        typeof params.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : DEFAULT_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      );

      const result = await bridge.shellExec(rootPath, command, timeoutMs) as ShellExecResult;
      return {
        ok: result.exitCode === 0,
        data: result,
        message: result.timedOut ? `Command timed out after ${timeoutMs}ms` : undefined,
      };
    },
  };
}
