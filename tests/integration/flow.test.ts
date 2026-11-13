import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSession, login, registerUser } from '@/server/auth/service';
import type { Ctx } from '@/server/context';
import { encryptSecret } from '@/server/crypto';
import { closeDb, type DB } from '@/server/db';
import { auditLog, bexioConnections, journalEntries, transactions } from '@/server/db/schema';
import { BexioClient } from '@/integrations/bexio/client';
import { completeConnect, connectionTokenProvider, refreshBexioData, setMapping, startConnect, syncEntries } from '@/server/services/bexio';
import { listEntries, runCalculation, setEntriesValidated } from '@/server/services/calculation';
import { setManualClassification } from '@/server/services/classification';
import { createSource, importFile } from '@/server/services/imports';
import { importRates } from '@/server/services/valuation';
import { fakeBexio, resetDatabase } from './helpers';
import { D } from '@/core/decimal';

const fixture = (f: string) => readFileSync(path.join(import.meta.dirname, '..', 'fixtures', f), 'utf8');

let db: DB;
let ctx: Ctx;

beforeAll(async () => {
  db = await resetDatabase();
  const { userId, orgId } = await registerUser(db, {
    email: 'owner@example.test', password: 'correct horse battery', name: 'Owner', orgName: 'Test GmbH', orgKind: 'company', canton: 'ZG',
  });
  ctx = { db, userId, orgId, role: 'owner' };
});
afterAll(async () => closeDb());

describe('auth', () => {
  it('logs in and resolves the session with its organization', async () => {
    const { token } = await login(db, 'OWNER@example.test', 'correct horse battery');
    const s = await getSession(db, token);
    expect(s?.orgName).toBe('Test GmbH');
    expect(s?.role).toBe('owner');
    await expect(login(db, 'owner@example.test', 'wrong password!!')).rejects.toThrow('invalid_credentials');
  });
  it('refuses duplicate emails', async () => {
    await expect(registerUser(db, { email: 'owner@example.test', password: 'xxxxxxxxxxxx', name: 'X', orgName: 'Y', orgKind: 'private' })).rejects.toThrow('email_taken');
  });
});

describe('import → classify → value → calculate → validate → bexio', () => {
  let sourceId: string;

  it('imports a Kraken ledger and detects duplicates', async () => {
    sourceId = await createSource(ctx, { provider: 'kraken', label: 'Kraken', kind: 'exchange' });
    const r = await importFile(ctx, { sourceId, fileName: 'ledgers.csv', content: fixture('kraken_ledgers.csv') });
    expect(r).toMatchObject({ parserId: 'kraken_ledger_v1', imported: 5, duplicates: 0 });
    await expect(importFile(ctx, { sourceId, fileName: 'again.csv', content: fixture('kraken_ledgers.csv') })).rejects.toThrow('file_already_imported');
    // Same rows in a different file (extra blank line) → rows deduplicated by fingerprint.
    const r2 = await importFile(ctx, { sourceId, fileName: 'again.csv', content: `${fixture('kraken_ledgers.csv')}\n` });
    expect(r2).toMatchObject({ imported: 0, duplicates: 5 });
  });

  it('blocks the calculation while transactions need review or rates are missing', async () => {
    const run = await runCalculation(ctx);
    expect(run.status).toBe('blocked');
    const codes = run.issues.map((i) => i.code).sort();
    expect(codes).toContain('needs_review'); // unmatched BTC withdrawal
    expect(codes).toContain('missing_rate'); // staking reward without a documented rate
    expect(run.created).toBe(0);
  });

  it('completes once the user confirms the withdrawal and documented rates are imported', async () => {
    const [w] = await db.select().from(transactions).where(eq(transactions.externalId, 'Q2AAAA-AAAAA-AAAAAA'));
    await setManualClassification(ctx, w!.id, 'withdrawal', false);
    const rates = await importRates(ctx, [
      'asset,date,rate_chf,source,source_url',
      'BTC,2024-03-01,55000,Test rate table,https://example.test/rates',
      'BTC,2024-03-02,56000,Test rate table,https://example.test/rates',
    ].join('\n'));
    expect(rates.inserted).toBe(2);
    const { revalue } = await import('@/server/services/valuation');
    await revalue(ctx);
    const run = await runCalculation(ctx);
    expect(run.issues).toEqual([]);
    expect(run.status).toBe('complete');
    expect(run.created).toBe(4); // fiat deposit, buy, staking reward, withdrawal (internal staking move has no booking)

    const entries = await listEntries(ctx, ['draft']);
    const withdrawal = entries.find((e) => e.transactionId === w!.id)!;
    expect(withdrawal.lines.map((l) => [l.debitKey, l.creditKey, l.amountChf])).toEqual([
      ['external_withdrawal_counterpart', 'crypto_asset:BTC', '804.09'],
      ['external_withdrawal_counterpart', 'realized_gain', '315.91'],
      ['network_fees', 'realized_gain', '2.80'],
    ]);
    const { latestRun } = await import('@/server/services/calculation');
    const ledger = (await latestRun(ctx))!.roundingLedger as { key: string; exactChf: string; bookedChf: string; carriedChf: string }[];
    expect(ledger.length).toBeGreaterThan(0);
    for (const r of ledger) expect(new D(r.exactChf).minus(r.bookedChf).toString()).toBe(new D(r.carriedChf).toString());
    // Re-running with identical inputs changes nothing.
    const again = await runCalculation(ctx);
    expect(again).toMatchObject({ created: 0, unchanged: 4, superseded: 0 });
  });

  it('builds the statement of securities with official tax values when entered', async () => {
    const { buildReport } = await import('@/server/services/reports');
    const { importTaxValues } = await import('@/server/services/valuation');
    const before = await buildReport(ctx, 'wealth', { year: 2024 });
    const btc = before.rows.find((r) => r[0] === 'BTC');
    expect(btc).toBeDefined();
    expect(String(btc![4])).not.toMatch(/^Valeur fiscale/);
    const r = await importTaxValues(ctx, ['asset,year,value_chf,source,source_url', 'BTC,2024,85000.5,Kursliste AFC 2024,https://www.ictax.admin.ch'].join('\n'));
    expect(r).toMatchObject({ inserted: 1, errors: [] });
    const after = await buildReport(ctx, 'wealth', { year: 2024 });
    const row = after.rows.find((x) => x[0] === 'BTC')!;
    expect(row[2]).toBe('85000.5');
    expect(row[3]).toBe(new D(85000.5).times(String(row[1])).toFixed(2));
    expect(row[4]).toBe('Valeur fiscale : Kursliste AFC 2024');
    // An existing value is kept unless replacement is asked.
    expect((await importTaxValues(ctx, 'asset,year,value_chf,source\nBTC,2024,1,x')).skipped).toBe(1);
  });

  it('syncs validated entries to bexio idempotently, recovering from an unknown outcome', async () => {
    await db.insert(bexioConnections).values({
      orgId: ctx.orgId, encryptedTokens: encryptSecret(JSON.stringify({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 })),
      scopes: 'openid offline_access accounting', connectedBy: ctx.userId,
    });
    const bexio = fakeBexio({ failNextPostWithNetworkError: true });
    const client = new BexioClient(connectionTokenProvider(db, ctx.orgId, bexio.fetchImpl), bexio.fetchImpl);
    await refreshBexioData(ctx, client);
    const map: [string, number][] = [
      ['crypto_asset:*', 1], ['fiat_clearing:*', 2], ['bank_clearing', 3], ['realized_gain', 4], ['network_fees', 5],
      ['staking_income', 6], ['external_withdrawal_counterpart', 7], ['realized_loss', 8], ['trading_fees', 8],
    ];
    for (const [k, id] of map) await setMapping(ctx, k, id);

    // Only validated entries are synced.
    const drafts = await listEntries(ctx, ['draft']);
    expect((await syncEntries(ctx, undefined, client)).results).toEqual([]);
    expect(await setEntriesValidated(ctx, drafts.map((d) => d.id), true)).toBe(4);

    const first = await syncEntries(ctx, undefined, client);
    expect(first.synced).toBe(3);
    expect(first.results.filter((r) => r.outcome === 'unknown')).toHaveLength(1);
    expect(bexio.created).toHaveLength(4); // bexio stored the 4th although the response was lost

    const second = await syncEntries(ctx, undefined, client);
    expect(second).toMatchObject({ synced: 0, recovered: 1, failed: 0 });
    expect(bexio.created).toHaveLength(4); // no duplicate created
    expect(bexio.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/manual_entries'))).toHaveLength(4);

    const all = await listEntries(ctx);
    expect(all.every((e) => e.status === 'synced' && e.bexioManualEntryId)).toBe(true);
    const post = bexio.calls.find((c) => c.method === 'POST' && c.url.endsWith('/manual_entries'))!;
    expect(post.body).toMatchObject({ date: expect.stringMatching(/^2024-/), reference_nr: expect.stringMatching(/^C2B-/) });
    expect((post.body as { entries: { currency_id: number; currency_factor: number }[] }).entries[0]).toMatchObject({ currency_id: 1, currency_factor: 1 });
  });

  it('never changes synced entries and refuses reclassifying locked transactions', async () => {
    const [w] = await db.select().from(transactions).where(eq(transactions.externalId, 'Q2AAAA-AAAAA-AAAAAA'));
    await expect(setManualClassification(ctx, w!.id, 'internal_transfer', false)).rejects.toThrow('transaction_locked_by_validated_entry');
    const run = await runCalculation(ctx);
    expect(run).toMatchObject({ created: 0, superseded: 0 });
  });

  it('does not store a rounding ledger when a kept validated entry no longer matches the calculation', async () => {
    // Earlier history imported late: a cheaper BTC lot changes the FIFO cost of the synced withdrawal.
    const generic = await createSource(ctx, { provider: 'generic', label: 'Ancien wallet', kind: 'wallet' });
    await importFile(ctx, { sourceId: generic, fileName: 'old.csv', content: [
      'date,type,in_asset,in_quantity,out_asset,out_quantity,fee_asset,fee_quantity,external_id,tx_hash,chf_value,note',
      '2023-12-01T10:00:00Z,buy,BTC,0.1,CHF,2000,,,old-001,,2000,',
    ].join('\n') });
    const run = await runCalculation(ctx);
    expect(run.issues.map((i) => i.code)).toContain('not_bookable');
    const { latestRun } = await import('@/server/services/calculation');
    expect((await latestRun(ctx))!.roundingLedger).toBeNull();
  });

  it('reports a definite bexio rejection as failed with the message', async () => {
    const [entry] = await db.select().from(journalEntries).limit(1);
    await db.update(journalEntries).set({ status: 'validated' }).where(eq(journalEntries.id, entry!.id));
    const bexio = fakeBexio({ reject422: true });
    const client = new BexioClient(connectionTokenProvider(db, ctx.orgId, bexio.fetchImpl), bexio.fetchImpl);
    const r = await syncEntries(ctx, [entry!.id], client);
    expect(r.results[0]).toMatchObject({ outcome: 'failed', message: expect.stringContaining('Validation error') });
  });

  it('writes an audit trail', async () => {
    const actions = (await db.select({ a: auditLog.action }).from(auditLog)).map((r) => r.a);
    for (const a of ['user.registered', 'import.completed', 'transaction.classified', 'rates.imported', 'calculation.run', 'entry.validated', 'mapping.updated', 'bexio.sync']) {
      expect(actions).toContain(a);
    }
  });
});

describe('bexio OAuth', () => {
  it('validates state, exchanges the code and stores encrypted tokens', async () => {
    process.env.BEXIO_CLIENT_ID = 'client';
    process.env.BEXIO_CLIENT_SECRET = 'secret';
    process.env.APP_URL = 'http://localhost:3000';
    const url = new URL(await startConnect(ctx));
    expect(url.origin + url.pathname).toBe('https://auth.bexio.com/realms/bexio/protocol/openid-connect/auth');
    expect(url.searchParams.get('scope')).toContain('accounting');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/bexio/callback');
    const state = url.searchParams.get('state')!;
    const bexio = fakeBexio();
    await expect(completeConnect(db, 'someone-else', state, 'code', bexio.fetchImpl)).rejects.toThrow('invalid_oauth_state');
    // The state is single-use: start again.
    const state2 = new URL(await startConnect(ctx)).searchParams.get('state')!;
    const orgId = await completeConnect(db, ctx.userId, state2, 'code', bexio.fetchImpl);
    expect(orgId).toBe(ctx.orgId);
    const [conn] = await db.select().from(bexioConnections).where(eq(bexioConnections.orgId, ctx.orgId));
    expect(conn!.encryptedTokens).not.toContain('access-2');
    const tokenCall = bexio.calls.find((c) => c.url.includes('/token'))!;
    expect(String(tokenCall.body)).toContain('grant_type=authorization_code');
  });
});

describe('legal forms', () => {
  it('creates a foundation, keeps endowments for foundations only and guards the switch back', async () => {
    const { getOrgProfile, updateOrgProfile } = await import('@/server/services/organization');
    const { userId, orgId } = await registerUser(db, {
      email: 'board@example.test', password: 'correct horse battery', name: 'Board', orgName: 'Stiftung Test', orgKind: 'foundation', canton: 'GE',
    });
    const f: Ctx = { db, userId, orgId, role: 'owner' };
    expect(await getOrgProfile(f)).toEqual({ kind: 'foundation', legalForm: 'foundation', taxStatus: 'ordinary' });
    await updateOrgProfile(f, 'foundation', 'exempt');
    expect((await getOrgProfile(f)).taxStatus).toBe('exempt');

    // The company file of the first user cannot classify an endowment.
    const [anyTx] = await db.select().from(transactions).where(eq(transactions.orgId, ctx.orgId)).limit(1);
    await expect(setManualClassification(ctx, anyTx!.id, 'endowment_received', false)).rejects.toThrow('classification_not_for_legal_form');
    await updateOrgProfile(ctx, 'sarl', 'ordinary');
    expect(await getOrgProfile(ctx)).toEqual({ kind: 'company', legalForm: 'sarl', taxStatus: 'ordinary' });
  });
});

describe('leaving the foundation form', () => {
  it('removes remembered endowment rules instead of blocking the change', async () => {
    const { updateOrgProfile } = await import('@/server/services/organization');
    const { classificationRules } = await import('@/server/db/schema');
    const { userId, orgId } = await registerUser(db, {
      email: 'switch@example.test', password: 'correct horse battery', name: 'S', orgName: 'Stiftung B', orgKind: 'foundation',
    });
    const f: Ctx = { db, userId, orgId, role: 'owner' };
    await db.insert(classificationRules).values({ orgId, provider: 'kraken', rawType: 'deposit', classification: 'endowment_received', createdBy: userId });
    await updateOrgProfile(f, 'sa', 'ordinary');
    expect(await db.select().from(classificationRules).where(eq(classificationRules.orgId, orgId))).toEqual([]);
  });
});
