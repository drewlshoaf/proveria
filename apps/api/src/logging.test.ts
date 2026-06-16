// Verifies the request-id contract M15/C55 promises: a caller-supplied
// X-Request-Id header is honored as the request id and echoed back on the
// response. When the caller doesn't supply one, the server generates a
// UUID and echoes that.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fastifyLoggerOptions, generateRequestId } from './logging.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({
    logger: fastifyLoggerOptions(),
    genReqId: generateRequestId,
    requestIdHeader: 'x-request-id',
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.get('/echo', async (req) => {
    return { id: req.id };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('request-id contract (M15/C55)', () => {
  it('honors X-Request-Id from the caller and echoes it back', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-request-id': 'incident-2026-05-18-001' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe('incident-2026-05-18-001');
    expect((res.json() as { id: string }).id).toBe('incident-2026-05-18-001');
  });

  it('generates a UUID when X-Request-Id is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/echo' });
    expect(res.statusCode).toBe(200);
    const id = res.headers['x-request-id'];
    expect(typeof id).toBe('string');
    // RFC 4122 v4 UUID shape (case-insensitive hex with dashes).
    expect(id as string).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect((res.json() as { id: string }).id).toBe(id);
  });
});
