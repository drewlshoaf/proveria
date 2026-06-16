// Migration runner. Invoked via `pnpm --filter @proveria/db db:migrate`.
//
// Applies every pending SQL file under packages/db/migrations/ in order, using
// drizzle-orm's bundled migrator (which tracks applied migrations in
// drizzle.__drizzle_migrations).

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '..', 'migrations');

// Redact the password before logging.
const redactedUrl = DATABASE_URL.replace(/:[^:@]+@/, ':***@');

const main = async (): Promise<void> => {
  console.log(`[migrate] connecting to ${redactedUrl}`);
  console.log(`[migrate] migrations folder: ${migrationsFolder}`);

  const sql = postgres(DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });

  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder });
    console.log('[migrate] done');
  } finally {
    await sql.end({ timeout: 5 });
  }
};

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
