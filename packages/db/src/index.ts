// @proveria/db — Drizzle schema, client factory, and migration runner.
//
// public.* schemas: identity (tenants, users, memberships, sessions), devices,
// pairing attempts, one-time tokens. audit.* schema: audit events.
// See docs/v1 §7 and §19.1.

export * from './schema/index.js';
export {
  createClient,
  type CreateClientOptions,
  type DrizzleClient,
  type ClientHandle,
} from './client.js';

export const DB_PACKAGE_VERSION = '0.0.0';
