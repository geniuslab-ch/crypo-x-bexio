import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __c2bPool?: Pool; __c2bDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__c2bDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForDb.__c2bPool = new Pool({ connectionString: url, max: 10 });
    globalForDb.__c2bDb = drizzle(globalForDb.__c2bPool, { schema });
  }
  return globalForDb.__c2bDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__c2bPool?.end();
  globalForDb.__c2bPool = undefined;
  globalForDb.__c2bDb = undefined;
}

export { schema };
