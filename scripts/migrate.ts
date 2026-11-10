import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../src/server/db';

await migrate(getDb(), { migrationsFolder: './drizzle' });
await closeDb();
console.log('Migrations applied');
