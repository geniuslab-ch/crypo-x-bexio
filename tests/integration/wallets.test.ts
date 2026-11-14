import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser } from '@/server/auth/service';
import type { Ctx } from '@/server/context';
import { closeDb } from '@/server/db';
import { bexioAccounts, journalEntries, transactions } from '@/server/db/schema';
import { assetAccountKeys, setMapping } from '@/server/services/bexio';
import { listEntries, runCalculation, setEntriesValidated } from '@/server/services/calculation';
import { createSource, importFile } from '@/server/services/imports';
import { walletAccountKey } from '@/core/accounting/accountKeys';
import { resetDatabase } from './helpers';

const HEADER = 'date,type,in_asset,in_quantity,out_asset,out_quantity,fee_asset,fee_quantity,external_id,tx_hash,chf_value,note';
let ctx: Ctx;

beforeAll(async () => {
  const db = await resetDatabase();
  const { userId, orgId } = await registerUser(db, {
    email: 'wallets@example.test', password: 'correct horse battery', name: 'Fid', orgName: 'Origyn Test', orgKind: 'company', canton: 'ZG',
  });
  ctx = { db, userId, orgId, role: 'owner' };
  await db.insert(bexioAccounts).values([
    { orgId, bexioId: 17, accountNo: '12617', name: 'Treasury', isActive: true, isLocked: false },
    { orgId, bexioId: 26, accountNo: '12626', name: 'Liquidity Pool', isActive: true, isLocked: false },
  ]);
});
afterAll(async () => closeDb());

describe('per-wallet bexio accounts', () => {
  let treasury: string;
  let pool: string;

  it('books a transfer between two wallets that have their own account', async () => {
    treasury = await createSource(ctx, { provider: 'icp', label: 'Origyn Treasury', kind: 'wallet' });
    pool = await createSource(ctx, { provider: 'icp', label: 'Liquidity Pool', kind: 'wallet' });
    await importFile(ctx, { sourceId: treasury, fileName: 't.csv', content: [HEADER,
      '2025-01-01T10:00:00Z,buy,OGY,1000,CHF,100,,,t-1,,100,',
      '2025-01-05T10:00:00Z,,,,OGY,400,,,t-2,0xabc,,',
    ].join('\n') });
    await importFile(ctx, { sourceId: pool, fileName: 'p.csv', content: [HEADER, '2025-01-05T10:05:00Z,,OGY,400,,,,,p-1,0xabc,,'].join('\n') });
    // Each imported asset can get its own bexio account before any calculation.
    expect(await assetAccountKeys(ctx)).toEqual(['crypto_asset:OGY', 'fiat_clearing:CHF']);
    const txs = await ctx.db.select().from(transactions).where(eq(transactions.orgId, ctx.orgId));
    expect(txs.filter((t) => t.classification === 'internal_transfer')).toHaveLength(2);

    await setMapping(ctx, walletAccountKey(treasury), 17);
    await setMapping(ctx, walletAccountKey(pool), 26);
    const run = await runCalculation(ctx);
    expect(run.issues).toEqual([]);
    const entries = await listEntries(ctx, ['draft']);
    const lines = entries.flatMap((e) => e.lines.map((l) => [l.debitKey, l.creditKey, l.amountChf]));
    expect(lines).toContainEqual([`crypto_asset:OGY@${pool}`, `crypto_asset:OGY@${treasury}`, '40.00']);
    expect(lines).toContainEqual([`crypto_asset:OGY@${treasury}`, 'fiat_clearing:CHF', '100.00']);
  });

  it('refuses to add or remove a wallet account once entries are validated, but allows changing the account', async () => {
    const drafts = await listEntries(ctx, ['draft']);
    await setEntriesValidated(ctx, drafts.map((d) => d.id), true);
    await expect(setMapping(ctx, walletAccountKey(pool), null)).rejects.toThrow('wallet_accounts_locked_by_validated_entries');
    await setMapping(ctx, walletAccountKey(pool), 17);
    const [e] = await ctx.db.select().from(journalEntries).where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.status, 'validated')));
    expect(e).toBeDefined();
  });
});
