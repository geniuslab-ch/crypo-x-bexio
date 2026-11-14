import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser } from '@/server/auth/service';
import type { Ctx } from '@/server/context';
import { closeDb } from '@/server/db';
import { runCalculation } from '@/server/services/calculation';
import { reclassify } from '@/server/services/classification';
import { createSource, importFile } from '@/server/services/imports';
import { buildReport } from '@/server/services/reports';
import { importRates, revalue } from '@/server/services/valuation';
import { resetDatabase } from './helpers';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'defi', name), 'utf8');
let ctx: Ctx;

beforeAll(async () => {
  const db = await resetDatabase();
  const { userId, orgId } = await registerUser(db, { email: 'defi@example.test', password: 'correct horse battery', name: 'Fid', orgName: 'DeFi SA', orgKind: 'sa', canton: 'ZG' });
  ctx = { db, userId, orgId, role: 'owner' };
});
afterAll(async () => closeDb());

describe('DeFi test files', () => {
  it('imports, values and books liquidity and lending operations', async () => {
    const src = await createSource(ctx, { provider: 'generic', label: 'DeFi TEST', kind: 'wallet' });
    const res = await importFile(ctx, { sourceId: src, fileName: '7_defi_TEST.csv', content: fixture('7_defi_TEST.csv') });
    expect(res.issues).toEqual([]);
    expect(res.imported).toBe(6);
    expect((await importRates(ctx, fixture('8_cours_DeFi_TEST.csv'))).errors).toEqual([]);
    expect((await reclassify(ctx)).needsReview).toBe(0);
    await revalue(ctx);
    const run = await runCalculation(ctx);
    expect(run.issues).toEqual([]);
    const realized = await buildReport(ctx, 'realized', { year: 2025 });
    const holdings = await buildReport(ctx, 'holdings', { year: 2025 });
    // LP token at the value of what was given (1400 + 1620 + capitalised gas 2.80), sold for what came back (3850).
    expect(realized.rows.find((r) => r[1] === 'UNI-V2-ETH-USDC')?.slice(4, 7)).toEqual(['3850.00', '3022.80', '827.20']);
    expect(realized.rows.at(-1)?.[6]).toBe('651.00');
    expect(holdings.rows.map((r) => [r[0], r[1]])).toEqual([['ETH', '1.898'], ['USDC', '3230'], ['TOTAL', '']]);
  });
});
