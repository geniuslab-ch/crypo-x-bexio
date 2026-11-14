import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser } from '@/server/auth/service';
import type { Ctx } from '@/server/context';
import { closeDb } from '@/server/db';
import { createSource, importFile } from '@/server/services/imports';
import { createPlatformRequest, groupRequests, listPlatformRequests } from '@/server/services/platformRequests';
import { importReportedBalances, reconcile } from '@/server/services/reconciliation';
import { resetDatabase } from './helpers';

const HEADER = 'date,type,in_asset,in_quantity,out_asset,out_quantity,fee_asset,fee_quantity,external_id,tx_hash,chf_value,note';
let ctx: Ctx;

beforeAll(async () => {
  const db = await resetDatabase();
  const { userId, orgId } = await registerUser(db, { email: 'rec@example.test', password: 'correct horse battery', name: 'Fid', orgName: 'Rec SA', orgKind: 'sa', canton: 'GE' });
  ctx = { db, userId, orgId, role: 'owner' };
});
afterAll(async () => closeDb());

describe('reconciliation', () => {
  it('compares computed balances per source with the balances stated by the platforms', async () => {
    const ex = await createSource(ctx, { provider: 'generic', label: 'Exchange A', kind: 'exchange' });
    await importFile(ctx, { sourceId: ex, fileName: 'a.csv', content: [HEADER,
      '2025-03-01T10:00:00Z,buy,BTC,1,CHF,50000,BTC,0.001,b-1,,,',
      '2025-06-01T10:00:00Z,sell,CHF,30000,BTC,0.5,,,s-1,,,',
      '2025-12-31T23:30:00Z,buy,ETH,1,CHF,3000,,,late,,,',
      '2026-01-02T10:00:00Z,buy,ETH,1,CHF,3000,,,e-1,,,',
    ].join('\n') });
    const r = await importReportedBalances(ctx, [
      'source,asset,date,balance,evidence',
      'Exchange A,BTC,2025-12-31,0.499,Relevé annuel',
      'exchange a,ETH,2025-12-31,0.9,Relevé annuel',
      'Inconnu,BTC,2025-12-31,1,',
    ].join('\n'));
    expect(r.saved).toBe(2);
    expect(r.errors).toHaveLength(1);
    const rows = await reconcile(ctx, '2025-12-31');
    // 23:30 UTC on 31.12 is already 1 January in Switzerland: not part of the 2025 balance.
    expect(rows.map((x) => [x.asset, x.computed, x.reported, x.difference, x.status])).toEqual([
      ['BTC', '0.499', '0.499', '0', 'ok'],
      ['CHF', '-20000', null, null, 'not_reported'],
      ['ETH', '0', '0.9', '0.9', 'gap'],
    ]);
    const summer = await reconcile(ctx, '2025-06-01');
    expect(summer.map((x) => [x.asset, x.computed, x.status])).toEqual([['BTC', '0.499', 'not_reported'], ['CHF', '-20000', 'not_reported']]);
  });
});

describe('platform requests', () => {
  it('records requests and groups them by platform', async () => {
    await createPlatformRequest(ctx, { platform: 'SwissBorg', kind: 'exchange', wanted: 'csv', note: 'Earn' }, { name: 'sb.csv', content: 'a,b\n1,2' });
    await createPlatformRequest(ctx, { platform: 'swissborg ', kind: 'exchange', wanted: 'either' });
    await createPlatformRequest(ctx, { platform: 'Bitpanda', kind: 'exchange', wanted: 'api' });
    const rows = await listPlatformRequests(ctx, [ctx.orgId]);
    expect(rows).toHaveLength(3);
    expect(groupRequests(rows)).toEqual([
      { platform: 'SwissBorg', count: 2, open: 2 },
      { platform: 'Bitpanda', count: 1, open: 1 },
    ]);
    await expect(createPlatformRequest(ctx, { platform: 'x', kind: 'exchange', wanted: 'csv' })).rejects.toThrow();
  });
});
