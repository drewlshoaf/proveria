import { defineConfig } from 'vitest/config';

// apps/api's integration tests share a single Postgres database (the dev DB)
// and truncate identity-side tables between runs.
//
//  - fileParallelism: false  — serializes files *within* this vitest process.
//  - globalSetup advisory lock — serializes this whole process against any
//    other workspace package's integration suite sharing the DB (apps/worker).
//
// Until per-package test databases exist, both layers are required.
export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
  },
});
