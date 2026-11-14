import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser } from '@/server/auth/service';
import type { Ctx } from '@/server/context';
import { closeDb, type DB } from '@/server/db';
import { fiscalClosings, journalEntries, transactions } from '@/server/db/schema';
import { listEntries, runCalculation, setEntriesValidated } from '@/server/services/calculation';
import { addOpeningBalances, closeYear, deleteOpeningBalance, listOpeningBalances, previewClosing, reopenYear } from '@/server/services/closing';
import { createSource, importFile } from '@/server/services/imports';
import { buildReport } from '@/server/services/reports';
import { importRates, revalue } from '@/server/services/valuation';
import { resetDatabase } from './helpers';

const HEADER = 'date,type,in_asset,in_quantity,out_asset,out_quantity,fee_asset,fee_quantity,external_id,tx_hash,chf_value,note';
let db: DB;

async function newOrg(email: string): Promise<Ctx> {
  const { userId, orgId } = await registerUser(db, { email, password: 'correct horse battery', name: 'Fid', orgName: email, orgKind: 'sa', canton: 'VD' });
  return { db, userId, orgId, role: 'owner' };
}

async function calcAndValidate(ctx: Ctx) {
  await revalue(ctx);
  const run = await runCalculation(ctx);
  const drafts = await listEntries(ctx, ['draft']);
  await setEntriesValidated(ctx, drafts.map((d) => d.id), true);
  return run;
}

beforeAll(async () => {
  db = await resetDatabase();
});
afterAll(async () => closeDb());

describe('year-end closing', () => {
  let ctx: Ctx;
  let source: string;

  it('values holdings at 31.12 with the lowest value principle and books the entry and its reversal', async () => {
    ctx = await newOrg('closing@example.test');
    source = await createSource(ctx, { provider: 'generic', label: 'Exchange', kind: 'exchange' });
    await importFile(ctx, { sourceId: source, fileName: 'a.csv', content: [HEADER,
      '2025-03-01T10:00:00Z,buy,BTC,1,CHF,50000,,,b-1,,,',
      '2025-06-01T10:00:00Z,sell,CHF,30000,BTC,0.5,,,s-1,,,',
    ].join('\n') });
    await importRates(ctx, 'asset,date,rate_chf,source,source_url\nBTC,2025-12-31,40000,Test close,https://example.test\n');
    const run = await calcAndValidate(ctx);
    expect(run.issues).toEqual([]);

    const p = await previewClosing(ctx, 2025, 'lower_of_cost', 'market_rate');
    expect(p.blockers).toEqual([]);
    expect(p.rows).toMatchObject([{ key: 'crypto_asset:BTC', quantity: '0.5', bookValue: '25000.00', marketValue: '20000.00', adjustment: '-5000.00' }]);
    expect((await previewClosing(ctx, 2025, 'market', 'tax_value')).blockers.join(' ')).toContain('Valeur fiscale 2025 manquante pour BTC');

    expect(await closeYear(ctx, 2025, 'lower_of_cost', 'market_rate')).toEqual({ entries: 2 });
    const closingEntries = (await listEntries(ctx, ['validated'])).filter((e) => e.kind !== 'transaction');
    expect(closingEntries.map((e) => [e.kind, e.entryDate, e.lines.map((l) => [l.debitKey, l.creditKey, l.amountChf])])).toEqual([
      ['year_end_valuation', '2025-12-31', [['valuation_loss', 'crypto_asset:BTC', '5000.00']]],
      ['year_end_reversal', '2026-01-01', [['crypto_asset:BTC', 'valuation_loss', '5000.00']]],
    ]);
    const report = await buildReport(ctx, 'closing', { year: 2025 });
    expect(report.rows.at(-1)).toEqual(['TOTAL', '', '', '25000.00', '', '20000.00', '-5000.00', '20000.00', '']);
  });

  it('locks the closed year', async () => {
    const res = await importFile(ctx, { sourceId: source, fileName: 'late.csv', content: [HEADER,
      '2025-11-01T10:00:00Z,buy,BTC,0.1,CHF,7000,,,late-1,,,',
      '2026-02-01T10:00:00Z,buy,BTC,0.1,CHF,8000,,,b-2,,,',
    ].join('\n') });
    expect(res.imported).toBe(1);
    expect(res.issues[0]?.message).toContain('exercice clôturé');
    const run = await calcAndValidate(ctx);
    expect(run.issues).toEqual([]);
    const y2025 = (await listEntries(ctx, ['validated'])).find((e) => e.entryDate.startsWith('2025') && e.kind === 'transaction')!;
    await expect(setEntriesValidated(ctx, [y2025.id], false)).rejects.toThrow('period_closed');
    // The calculation leaves year-end entries alone.
    const kept = await ctx.db.select().from(journalEntries).where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.kind, 'year_end_valuation')));
    expect(kept[0]!.status).toBe('validated');
    expect((await previewClosing(ctx, 2025, 'lower_of_cost', 'market_rate')).blockers[0]).toContain('déjà clôturé');
  });

  it('reopens the last closed year and withdraws its entries while they are not in bexio', async () => {
    await reopenYear(ctx, 2025);
    const [c] = await ctx.db.select().from(fiscalClosings).where(eq(fiscalClosings.orgId, ctx.orgId));
    expect(c!.status).toBe('reopened');
    const closing = await ctx.db.select().from(journalEntries).where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.closingYear, 2025)));
    expect(closing.every((e) => e.status === 'superseded')).toBe(true);
    // Closing again with the market method writes the book value down as well (market below cost).
    expect(await closeYear(ctx, 2025, 'market', 'market_rate')).toEqual({ entries: 2 });
  });
});

describe('opening balances', () => {
  it('replace the earlier history and give the cost basis of later sales, without any booking', async () => {
    const ctx = await newOrg('opening@example.test');
    const wallet = await createSource(ctx, { provider: 'generic', label: 'Ledger', kind: 'wallet' });
    await importFile(ctx, { sourceId: wallet, fileName: 'w.csv', content: [HEADER,
      '2025-05-01T10:00:00Z,buy,BTC,3,CHF,1,,,old-1,,,',
      '2026-02-01T10:00:00Z,sell,CHF,20000,BTC,0.4,,,s-1,,,',
    ].join('\n') });
    const added = await addOpeningBalances(ctx, 2026, [{ sourceId: wallet, asset: 'btc', quantity: '1', costChf: '10000' }]);
    expect(added).toEqual({ added: 1, duplicates: 0, errors: [] });
    expect((await addOpeningBalances(ctx, 2026, [{ sourceId: wallet, asset: 'BTC', quantity: '1', costChf: '10000' }])).duplicates).toBe(1);
    await expect(addOpeningBalances(ctx, 2025, [{ sourceId: wallet, asset: 'ETH', quantity: '1', costChf: '1' }])).rejects.toThrow('opening_balances_other_year');

    const run = await calcAndValidate(ctx);
    expect(run.issues).toEqual([]);
    const entries = await listEntries(ctx, ['validated']);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.lines.map((l) => [l.debitKey, l.creditKey, l.amountChf])).toEqual([
      ['fiat_clearing:CHF', 'crypto_asset:BTC', '4000.00'],
      ['fiat_clearing:CHF', 'realized_gain', '16000.00'],
    ]);

    await importRates(ctx, 'asset,date,rate_chf,source,source_url\nBTC,2026-12-31,50000,Test close,\n');
    const p = await previewClosing(ctx, 2026, 'lower_of_cost', 'market_rate');
    expect(p.rows).toMatchObject([{ quantity: '0.6', bookValue: '6000.00', marketValue: '30000.00', adjustment: '0.00' }]);

    const [o] = await listOpeningBalances(ctx);
    const [tx] = await ctx.db.select().from(transactions).where(eq(transactions.id, o!.id));
    expect(tx!.reviewStatus).toBe('ok');
    await deleteOpeningBalance(ctx, o!.id);
    expect(await listOpeningBalances(ctx)).toHaveLength(0);
  });
});
