import type { ConnectorDefinition } from './connector-types';

const CONNECTOR_CONFIG_KEY = 'relay.connectors.config';

/* ── Registry ────────────────────────────────────────────────────────────── */

const connectors = new Map<string, ConnectorDefinition>();

export function registerConnector(connector: ConnectorDefinition) {
  connectors.set(connector.id, connector);
}

export function getConnector(id: string): ConnectorDefinition | undefined {
  return connectors.get(id);
}

export function listConnectors(): ConnectorDefinition[] {
  return Array.from(connectors.values());
}

/* ── Persisted config ────────────────────────────────────────────────────── */

type SavedConnectorConfigs = Record<string, { enabled: boolean; config: Record<string, unknown> }>;

function loadSavedConfigs(): SavedConnectorConfigs {
  try {
    const raw = localStorage.getItem(CONNECTOR_CONFIG_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as SavedConnectorConfigs;
  } catch {
    return {};
  }
}

function saveSavedConfigs(configs: SavedConnectorConfigs) {
  localStorage.setItem(CONNECTOR_CONFIG_KEY, JSON.stringify(configs));
}

/** Apply stored config + status to all registered connectors. */
export function hydrateConnectors() {
  const saved = loadSavedConfigs();
  for (const connector of connectors.values()) {
    const entry = saved[connector.id];
    if (entry) {
      connector.config = { ...connector.config, ...entry.config };
      connector.status = entry.enabled ? 'active' : 'inactive';
    }
  }
}

/** Persist a connector's current config and status. */
export function persistConnectorConfig(id: string) {
  const connector = connectors.get(id);
  if (!connector) return;
  const saved = loadSavedConfigs();
  saved[id] = { enabled: connector.status === 'active', config: connector.config };
  saveSavedConfigs(saved);
}

/** Build a system prompt fragment listing available connector actions. */
export function buildConnectorPromptFragment(): string {
  const active = listConnectors().filter((c) => c.status === 'active');
  if (active.length === 0) return '';

  const lines = ['## Available connector actions', ''];
  for (const c of active) {
    lines.push(`### ${c.name}`);
    for (const action of c.actions) {
      const params = action.params.map((p) => `${p.name}${p.required ? '' : '?'}: ${p.type}`).join(', ');
      lines.push(`- \`${action.id}(${params})\` — ${action.description} [${action.riskLevel}]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
