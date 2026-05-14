export type GatewayMode = 'local' | 'remote';

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
