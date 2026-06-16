import { defineConfig } from 'vitest/config';

// apps/worker's attestation-validation integration test hits the shared dev
// Postgres. Same two-layer serialization as apps/api — see
// apps/api/vitest.config.ts and apps/worker/test/global-setup.ts.
export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
  },
});
