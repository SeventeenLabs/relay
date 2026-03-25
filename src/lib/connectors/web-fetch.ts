import type { ConnectorDefinition, ConnectorActionResult, ConnectorExecutionContext } from './connector-types';

export type WebFetchResult = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
};

const WEB_FETCH_CONFIG_KEY = 'relay.connectors.web-fetch';
const MAX_BODY_LENGTH = 100_000;

const DEFAULT_ALLOWED_DOMAINS = [
  'api.github.com',
  'raw.githubusercontent.com',
  'jsonplaceholder.typicode.com',
];

export function loadAllowedDomains(): string[] {
  try {
    const raw = localStorage.getItem(WEB_FETCH_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { allowedDomains?: string[] };
      if (Array.isArray(parsed.allowedDomains)) return parsed.allowedDomains;
    }
  } catch { /* use defaults */ }
  return [...DEFAULT_ALLOWED_DOMAINS];
}

export function saveAllowedDomains(domains: string[]) {
  localStorage.setItem(WEB_FETCH_CONFIG_KEY, JSON.stringify({ allowedDomains: domains }));
}

function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return false;
  try {
    const parsed = new URL(url);
    return allowedDomains.some((domain) => {
      const normalized = domain.toLowerCase().trim();
      // Support wildcard: *.example.com
      if (normalized.startsWith('*.')) {
        const suffix = normalized.slice(2);
        return parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`);
      }
      return parsed.hostname === normalized;
    });
  } catch {
    return false;
  }
}

export function createWebFetchConnector(): ConnectorDefinition {
  const connector: ConnectorDefinition = {
    id: 'web-fetch',
    name: 'Web Fetch',
    description: 'Fetch content from allowed domains via HTTP.',
    icon: 'globe',
    status: 'inactive', // disabled by default — high risk
    config: {
      allowedDomains: loadAllowedDomains(),
    },
    actions: [
      {
        id: 'web-fetch.get',
        name: 'HTTP GET',
        description: 'Fetch a URL via HTTP GET (domain must be in allowlist)',
        scopeId: 'network-request',
        riskLevel: 'high',
        params: [{ name: 'url', description: 'URL to fetch', required: true, type: 'string' }],
      },
      {
        id: 'web-fetch.post',
        name: 'HTTP POST',
        description: 'Send an HTTP POST request (domain must be in allowlist)',
        scopeId: 'network-request',
        riskLevel: 'high',
        params: [
          { name: 'url', description: 'URL to post to', required: true, type: 'string' },
          { name: 'body', description: 'Request body', required: false, type: 'string' },
          { name: 'contentType', description: 'Content-Type header', required: false, type: 'string' },
        ],
      },
    ],
    test: async () => {
      return { ok: true, message: 'Web fetch connector ready (requests use domain allowlist).' };
    },
    execute: async (actionId: string, params: Record<string, unknown>, ctx: ConnectorExecutionContext): Promise<ConnectorActionResult> => {
      const { bridge } = ctx;

      if (actionId !== 'web-fetch.get' && actionId !== 'web-fetch.post') {
        return { ok: false, errorCode: 'UNKNOWN_ACTION', message: `Unknown action: ${actionId}` };
      }

      if (!bridge.webFetch) {
        return { ok: false, errorCode: 'UNAVAILABLE', message: 'Web fetch bridge unavailable.' };
      }

      const url = typeof params.url === 'string' ? params.url.trim() : '';
      if (!url) {
        return { ok: false, errorCode: 'INVALID_PARAMS', message: 'URL is required.' };
      }

      // Validate URL format
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, errorCode: 'INVALID_URL', message: 'Invalid URL format.' };
      }

      // Block non-HTTP(S) schemes
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, errorCode: 'BLOCKED_SCHEME', message: `Only http/https URLs are allowed, got: ${parsed.protocol}` };
      }

      // Domain allowlist check
      const allowedDomains = Array.isArray(connector.config.allowedDomains)
        ? (connector.config.allowedDomains as string[])
        : loadAllowedDomains();

      if (!isDomainAllowed(url, allowedDomains)) {
        return {
          ok: false,
          errorCode: 'DOMAIN_NOT_ALLOWED',
          message: `Domain "${parsed.hostname}" is not in the allowed domains list. Add it in Settings → Connectors.`,
        };
      }

      const method = actionId === 'web-fetch.post' ? 'POST' : 'GET';
      const headers: Record<string, string> = {};
      const body = typeof params.body === 'string' ? params.body : undefined;

      if (method === 'POST' && body) {
        headers['Content-Type'] = typeof params.contentType === 'string' ? params.contentType : 'application/json';
      }

      const result = await bridge.webFetch(url, { method, headers, body }) as WebFetchResult;
      return {
        ok: result.status >= 200 && result.status < 400,
        data: result,
        message: result.truncated ? `Response truncated to ${MAX_BODY_LENGTH} characters` : undefined,
      };
    },
  };

  return connector;
}
