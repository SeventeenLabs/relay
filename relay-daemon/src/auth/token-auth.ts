import type { FastifyReply, FastifyRequest } from 'fastify';

export function extractBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value.trim();
}

export function enforceToken(expectedToken: string) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply) {
    const fromHeader = extractBearerToken(req);
    const fromQuery = typeof (req.query as { token?: unknown })?.token === 'string'
      ? String((req.query as { token?: unknown }).token)
      : null;
    const token = fromHeader ?? fromQuery;

    if (!token || token !== expectedToken) {
      return reply.status(401).send({
        error: {
          code: 'unauthorized',
          message: 'Missing or invalid bearer token',
        },
      });
    }
  };
}
