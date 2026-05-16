import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  RELAY_DAEMON_TOKEN: z.string().min(1).default('change-me'),
  WORKSPACE_MAP: z.string().default('relay=/projects/relay'),
  HERMES_BIN: z.string().default('hermes'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type WorkspaceMap = Record<string, string>;

export type DaemonConfig = {
  port: number;
  host: string;
  token: string;
  workspaces: WorkspaceMap;
  hermesBin: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
};

function parseWorkspaceMap(raw: string): WorkspaceMap {
  const map: WorkspaceMap = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || !value) continue;
    map[key] = value;
  }
  return map;
}

export function loadConfig(): DaemonConfig {
  const parsed = EnvSchema.parse(process.env);
  const workspaces = parseWorkspaceMap(parsed.WORKSPACE_MAP);
  if (Object.keys(workspaces).length === 0) {
    throw new Error('WORKSPACE_MAP must define at least one workspace, e.g. relay=/projects/relay');
  }

  return {
    port: parsed.PORT,
    host: parsed.HOST,
    token: parsed.RELAY_DAEMON_TOKEN,
    workspaces,
    hermesBin: parsed.HERMES_BIN,
    logLevel: parsed.LOG_LEVEL,
  };
}
