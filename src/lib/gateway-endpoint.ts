export type GatewayMode = 'local' | 'remote';

function extractScheme(value: string): string | null {
  const match = value.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  return match ? match[1].toLowerCase() : null;
}

export function normalizeGatewayInput(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^ws:\/\//i.test(trimmed)) return `http://${trimmed.slice(5)}`;
  if (/^wss:\/\//i.test(trimmed)) return `https://${trimmed.slice(6)}`;
  return trimmed;
}

export function inferGatewayMode(url: string): GatewayMode {
  const normalized = normalizeGatewayInput(url);
  if (!normalized) return 'local';
  const scheme = extractScheme(normalized);
  if (scheme === 'ssh') {
    return 'remote';
  }
  const withProtocol = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
  try {
    const parsed = new URL(withProtocol);
    return /^(localhost|127\.0\.0\.1|::1)$/i.test(parsed.hostname) ? 'local' : 'remote';
  } catch {
    return 'remote';
  }
}

export function ensureGatewayApiBase(url: string): string {
  const normalized = normalizeGatewayInput(url);
  if (!normalized) return '';

  const scheme = extractScheme(normalized);
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    if (scheme === 'ssh') {
      throw new Error('SSH endpoints are not HTTP API bases. First open an SSH tunnel, then use http://127.0.0.1:<localPort>/v1.');
    }
    throw new Error(`Unsupported endpoint protocol "${scheme}". Use http:// or https://.`);
  }

  const withProtocol = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path || path === '/') {
    parsed.pathname = '/v1';
  } else if (!path.endsWith('/v1')) {
    parsed.pathname = `${path}/v1`;
  } else {
    parsed.pathname = path;
  }
  return parsed.toString().replace(/\/$/, '');
}

export function parseGatewayDetails(url: string): {
  endpoint: string;
  protocol: string;
  host: string;
  port: string;
  path: string;
} {
  const normalized = normalizeGatewayInput(url);
  if (!normalized) {
    return { endpoint: '(empty)', protocol: '-', host: '-', port: '-', path: '-' };
  }
  const scheme = extractScheme(normalized);
  if (scheme === 'ssh') {
    try {
      const parsed = new URL(normalized);
      return {
        endpoint: normalized,
        protocol: 'ssh',
        host: parsed.hostname || '-',
        port: parsed.port || '22',
        path: parsed.pathname || '/',
      };
    } catch {
      return { endpoint: normalized, protocol: 'ssh', host: 'invalid', port: '-', path: '-' };
    }
  }
  const withProtocol = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
  try {
    const parsed = new URL(withProtocol);
    return {
      endpoint: withProtocol,
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname || '-',
      port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
      path: parsed.pathname || '/',
    };
  } catch {
    return { endpoint: withProtocol, protocol: 'invalid', host: 'invalid', port: '-', path: '-' };
  }
}
