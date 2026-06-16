// Proveria API — Fastify 5 REST server.
// See docs/v1 §6.2.

import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';

import { adminPlugin } from './admin/routes.js';
import { apiKeyPlugin } from './api-keys/routes.js';
import { attestationPlugin } from './attestations/routes.js';
import { authPlugin } from './auth/routes.js';
import { config } from './config.js';
import { closeDb, getDb } from './db.js';
import { devicePlugin } from './devices/routes.js';
import { linkPlugin } from './links/routes.js';
import {
  fastifyLoggerOptions,
  generateRequestId,
} from './logging.js';
import { mePlugin } from './me/routes.js';
import { LogNotificationProvider } from './notifications/provider.js';
import { probeMinio, probePostgres, probeRedis } from './probes.js';
import { projectPlugin } from './projects/routes.js';
import { publicV1Plugin } from './public-v1/routes.js';
import { closeQueues } from './queues/producer.js';
import { tenantPlugin } from './tenants/routes.js';

const app = Fastify({
  logger: fastifyLoggerOptions(),
  genReqId: generateRequestId,
  requestIdHeader: 'x-request-id',
  // Reflect the request id back to the caller so client logs can be
  // correlated against server logs without server-side lookups.
  disableRequestLogging: false,
});

// Echo the request id in the response so clients can correlate.
app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', req.id);
});

await app.register(sensible);
await app.register(cookie, { secret: config.sessionSecret });

const { db, sql } = getDb();
// LogNotificationProvider runs in dev only (refuses in production). Feed it
// the Fastify logger so dev notification lines carry the same service /
// env / requestId fields as every other log line. M15 adds a real
// EmailNotificationProvider for pilot; this surface is the dev sink.
const notifications = new LogNotificationProvider(app.log);

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
});
redis.on('error', (err: Error) => {
  app.log.warn({ err }, 'redis client error (probes may report degraded)');
});

await app.register(authPlugin, { db, notifications });
await app.register(tenantPlugin, { db, notifications });
await app.register(devicePlugin, { db });
await app.register(projectPlugin, { db });
await app.register(attestationPlugin, {
  db,
  rateLimitRedis: redis,
  notifications,
});
await app.register(linkPlugin, { db });
await app.register(mePlugin, { db });
await app.register(adminPlugin, { db, redis });
await app.register(apiKeyPlugin, { db });
await app.register(publicV1Plugin, { db });

const sqlForProbes = postgres(config.databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 5,
});

app.get('/healthz', async () => {
  return { status: 'ok', service: 'api', version: '0.0.0' };
});

app.get('/readyz', async (_req, reply) => {
  const [pg, rd, mn] = await Promise.all([
    probePostgres(sqlForProbes),
    probeRedis(redis),
    probeMinio(config.s3Endpoint),
  ]);
  const ok = pg.ok && rd.ok && mn.ok;
  reply.code(ok ? 200 : 503);
  return {
    status: ok ? 'ok' : 'degraded',
    service: 'api',
    version: '0.0.0',
    checks: { postgres: pg, redis: rd, s3: mn },
  };
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    redis.disconnect();
    await sqlForProbes.end({ timeout: 2 });
    await closeQueues();
    await closeDb();
  } catch (err) {
    app.log.error({ err }, 'shutdown error');
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Suppress unused warning on db (consumed by authPlugin already).
void db;
void sql;

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`api listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
