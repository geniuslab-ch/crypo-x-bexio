import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from '@/server/db';

export const TEST_DB = process.env.DATABASE_URL_TEST ?? 'postgres://c2b:c2b@localhost/crypto2books_test';

/** Points the app at the test database and recreates the schema from the committed migrations. */
export async function resetDatabase() {
  process.env.DATABASE_URL = TEST_DB;
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await migrate(db, { migrationsFolder: './drizzle' });
  return db;
}

/**
 * Test double for the bexio HTTP API. It records every request and answers like the documented endpoints.
 * Used only in tests; the application never fabricates bexio responses.
 */
export function fakeBexio(opts: { failNextPostWithNetworkError?: boolean; reject422?: boolean } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const created: Record<string, unknown>[] = [];
  let nextId = 100;
  let failNext = !!opts.failNextPostWithNetworkError;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body });
    if (url.includes('/openid-connect/token')) {
      return json(200, { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 300, scope: 'openid offline_access company_profile accounting' });
    }
    if (url.startsWith('https://api.bexio.com/2.0/accounts')) {
      return json(200, [
        { id: 1, account_no: '1091', name: 'Crypto assets', is_active: true, is_locked: false },
        { id: 2, account_no: '1092', name: 'Exchange CHF', is_active: true, is_locked: false },
        { id: 3, account_no: '1099', name: 'Transfer account', is_active: true, is_locked: false },
        { id: 4, account_no: '6950', name: 'Financial income', is_active: true, is_locked: false },
        { id: 5, account_no: '6940', name: 'Bank charges', is_active: true, is_locked: false },
        { id: 6, account_no: '7500', name: 'Staking income', is_active: true, is_locked: false },
        { id: 7, account_no: '2850', name: 'Private account', is_active: true, is_locked: false },
        { id: 8, account_no: '6900', name: 'Financial expenses', is_active: true, is_locked: false },
      ]);
    }
    if (url.startsWith('https://api.bexio.com/3.0/accounting/business_years')) {
      return json(200, [{ id: 1, start: '2024-01-01', end: '2024-12-31', status: 'open' }]);
    }
    if (url === 'https://api.bexio.com/3.0/currencies') return json(200, [{ id: 1, name: 'CHF' }, { id: 2, name: 'EUR' }]);
    if (url.startsWith('https://api.bexio.com/3.0/accounting/manual_entries') && method === 'GET') return json(200, created);
    if (url === 'https://api.bexio.com/3.0/accounting/manual_entries' && method === 'POST') {
      const req = body as { type: string; date: string; reference_nr: string; entries: Record<string, unknown>[] };
      if (opts.reject422) return json(422, { error_code: 422, message: 'Validation error' });
      const entry = { id: nextId++, ...req, entries: req.entries.map((e, i) => ({ id: 1000 + nextId * 10 + i, ...e })), is_locked: false, locked_info: null };
      created.push(entry);
      if (failNext) {
        failNext = false;
        throw new TypeError('fetch failed'); // bexio stored it, but the response never arrived
      }
      return json(201, entry);
    }
    return json(404, { message: `unexpected ${method} ${url}` });
  }) as typeof fetch;
  return { fetchImpl, calls, created };
}
