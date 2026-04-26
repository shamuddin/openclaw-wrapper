import { defineConfig } from 'drizzle-kit';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55433/openclaw';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: DATABASE_URL },
  verbose: true,
  strict: true,
});
