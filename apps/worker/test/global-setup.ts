// vitest globalSetup — workspace-wide integration-test serialization.
// See apps/api/test/global-setup.ts for the full rationale. The advisory
// lock id MUST match across every workspace integration suite.

import { createClient } from '@proveria/db';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';

const INTEGRATION_LOCK_ID = 727274;

export default async function globalSetup(): Promise<() => Promise<void>> {
  const handle = createClient({ url: DATABASE_URL, max: 1 });
  await handle.sql`SELECT pg_advisory_lock(${INTEGRATION_LOCK_ID})`;
  return async () => {
    await handle.sql`SELECT pg_advisory_unlock(${INTEGRATION_LOCK_ID})`;
    await handle.close();
  };
}
