import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

let sqlClient: ReturnType<typeof postgres> | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function getDb(): Db {
  if (!dbInstance) {
    sqlClient = postgres(env.DATABASE_URL, { max: 10 });
    dbInstance = drizzle(sqlClient, { schema });
  }
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = undefined;
    dbInstance = undefined;
  }
}
