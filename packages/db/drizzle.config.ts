import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://proveria:proveria_dev@localhost:5432/proveria',
  },
  schemaFilter: ['public', 'audit'],
  strict: true,
  verbose: true,
});
