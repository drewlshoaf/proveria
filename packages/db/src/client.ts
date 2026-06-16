// Drizzle + postgres-js client factory.
//
// Callers construct one client per process (api, worker, scripts) and reuse it.
// Connection pooling is handled by the postgres driver.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type DrizzleClient = ReturnType<typeof createClient>['db'];
export type ClientHandle = ReturnType<typeof createClient>;

export interface CreateClientOptions {
  /** Postgres connection string. Defaults to `DATABASE_URL` env. */
  url?: string;
  /** Max pooled connections. Defaults to 10. */
  max?: number;
  /** Idle timeout in seconds. Defaults to 30. */
  idleTimeoutSeconds?: number;
}

export const createClient = (options: CreateClientOptions = {}) => {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (or pass `url` to createClient).',
    );
  }
  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    onnotice: () => {
      /* swallow NOTICE-level chatter from migrations etc. */
    },
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
};
