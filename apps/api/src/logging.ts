// Centralized pino config for the API process (M15/C55).
//
// Goals:
//   - One consistent set of base fields (service, version, env) on every
//     log line so incident grep is uniform across api + worker.
//   - One generator for request IDs (UUIDs) so the same value can flow
//     from the request hook to enqueued jobs, then to worker log lines.
//   - Sensible defaults that hide noise (request bodies, auth headers)
//     but keep the hooks for verbose dev when needed.
//
// Used by:
//   - apps/api/src/server.ts when configuring the Fastify logger
//   - apps/api/src/queues/producer.ts when stamping jobs with the
//     originating request_id

import { randomUUID } from 'node:crypto';

import type { FastifyServerOptions } from 'fastify';

import { config } from './config.js';

export const SERVICE_NAME = 'api';
export const SERVICE_VERSION = '0.0.0';

/** Pino base fields applied to every line emitted by this process. */
export const baseLogFields = (): Record<string, string> => ({
  service: SERVICE_NAME,
  version: SERVICE_VERSION,
  env: process.env.NODE_ENV ?? 'development',
});

/** Generator Fastify hands to each incoming request. UUIDv4. */
export const generateRequestId = (): string => randomUUID();

/**
 * The Fastify logger config the API uses. Centralized here so the test
 * harness and the production process stay in lockstep.
 */
export const fastifyLoggerOptions =
  (): FastifyServerOptions['logger'] => ({
    level: config.logLevel,
    base: baseLogFields(),
    // Keep request/response lines compact. Body + headers are explicitly
    // off to avoid leaking auth cookies / device signatures into logs.
    serializers: {
      req(req: {
        id?: string;
        method?: string;
        url?: string;
        remoteAddress?: string;
      }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },
  });
