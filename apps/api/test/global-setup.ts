// vitest globalSetup — workspace-wide integration-test serialization.
//
// apps/api and apps/worker integration tests both hit the same dev Postgres
// and truncate the same tables. turbo runs the two packages' test suites as
// separate processes, concurrently. fileParallelism:false only serializes
// files *within* one process; it does nothing across processes.
//
// This setup grabs a Postgres advisory lock before any test file runs and
// releases it after. The lock is session-scoped and cross-process: whichever
// vitest process acquires it first runs to completion; the other blocks in
// its own globalSetup until the lock frees. Non-DB packages (crypto-core, ui,
// shared-types) don't load this setup, so they still run fully in parallel.

import { createClient } from '@proveria/db';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';

// Arbitrary fixed lock id, shared by every workspace integration suite.
const INTEGRATION_LOCK_ID = 727274;
const ALLOW_DESTRUCTIVE_TEST_DB =
  process.env.PROVERIA_ALLOW_DESTRUCTIVE_TEST_DB === '1';

const assertSafeTestDatabase = (): void => {
  if (ALLOW_DESTRUCTIVE_TEST_DB || process.env.GITHUB_ACTIONS === 'true') {
    return;
  }

  const databaseName = new URL(DATABASE_URL).pathname.replace(/^\/+/, '');
  if (/(^|[_-])(test|ci)([_-]|$)/i.test(databaseName)) return;

  throw new Error(
    `Refusing to run destructive integration tests against database ` +
      `"${databaseName}". Set DATABASE_URL to a dedicated test database, ` +
      `or set PROVERIA_ALLOW_DESTRUCTIVE_TEST_DB=1 if you intentionally ` +
      `want tests to truncate this database.`,
  );
};

export default async function globalSetup(): Promise<() => Promise<void>> {
  assertSafeTestDatabase();
  const handle = createClient({ url: DATABASE_URL, max: 1 });
  await handle.sql`SELECT pg_advisory_lock(${INTEGRATION_LOCK_ID})`;
  return async () => {
    await handle.sql`SELECT pg_advisory_unlock(${INTEGRATION_LOCK_ID})`;
    await handle.close();
  };
}
