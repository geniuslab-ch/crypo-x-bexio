import { describe, expect, it } from 'vitest';
import { accountIdOfPrincipal, icpConnector, mapIcp } from '@/integrations/sources/icp';
import type { FetchContext } from '@/integrations/sources/types';

const ME = 'b6d226cf41e36807f656193fc9c7332ab38c1c9cd262d24ab6416a587bd49c0d';
const OTHER = '2e7b15ff00000000000000000000000000000000000000000000000000000000';
const P = 'k2z6y-mxm3k-qvz5j-x2vin-jzjdo-upzjc-pwckm-g7346-yzd5k-6ppj2-gae';

describe('Internet Computer', () => {
  it('maps ICP sends, receipts, NNS mints and OGY transfers from e8s', () => {
    const r = mapIcp([{ kind: 'icp', id: ME }, { kind: 'ogy', id: P }], [
      { kind: 'icp', rec: { block_height: '1', transaction_hash: 'h1', from_account_identifier: ME, to_account_identifier: OTHER, transfer_type: 'send', amount: '150000000', fee: '10000', created_at: 1_700_000_000 } },
      { kind: 'icp', rec: { block_height: '2', transaction_hash: 'h2', from_account_identifier: null, to_account_identifier: ME, transfer_type: 'mint', amount: '12345678', fee: null, created_at: 1_700_000_100 } },
      { kind: 'ogy', rec: { index: 9, kind: 'transfer', from_owner: 'other-aaaaa', to_owner: P, amount: '500000000000', fee: '200000', timestamp: '1700000200123456789' } },
    ]);
    expect(r.transactions.map((t) => t.movements)).toEqual([
      [{ direction: 'out', asset: 'ICP', quantity: '1.5' }, { direction: 'fee', asset: 'ICP', quantity: '0.0001' }],
      [{ direction: 'in', asset: 'ICP', quantity: '0.12345678' }],
      [{ direction: 'in', asset: 'OGY', quantity: '5000' }],
    ]);
    expect(r.transactions[1]!.hint?.classification).toBe('staking_reward');
    expect(r.transactions[1]!.hint!.confidence).toBeLessThan(0.8);
    expect(r.transactions[2]!.occurredAt.toISOString()).toBe('2023-11-14T22:16:40.123Z');
  });

  it('pages through both APIs and accepts account IDs and principals', async () => {
    const urls: string[] = [];
    const fx: FetchContext = {
      fetch: (async (url: string) => {
        urls.push(String(url));
        if (String(url).includes('ledger-api')) return new Response(JSON.stringify({ total: 1, blocks: [{ block_height: '5', transaction_hash: 'x', from_account_identifier: OTHER, to_account_identifier: ME, transfer_type: 'send', amount: '100000000', fee: '10000', created_at: 1_700_000_000 }] }));
        return new Response(JSON.stringify({ data: [], total_transactions: 0 }));
      }) as typeof fetch,
      deadline: 10_000_000, now: () => 0, sleep: async () => {}, env: {},
    };
    const r = await icpConnector.sync({ addresses: `${ME}\n${P}` }, {}, fx);
    expect(urls[0]).toBe(`https://ledger-api.internetcomputer.org/accounts/${ME}/transactions?limit=100&offset=0`);
    expect(urls[1]).toContain('/ledgers/lkwrt-vyaaa-aaaaq-aadhq-cai/accounts/');
    expect(r.transactions).toHaveLength(1);
    await expect(icpConnector.verify({ addresses: 'not-an-address' }, fx)).rejects.toThrow('invalid_address');
    // A principal is also read on the ICP ledger through its default Account ID.
    expect(urls).toContain(`https://ledger-api.internetcomputer.org/accounts/${accountIdOfPrincipal(P)}/transactions?limit=100&offset=0`);
  });

  it('derives the default Account ID of a principal (ICP ledger spec vector)', () => {
    expect(accountIdOfPrincipal('2vxsx-fae')).toBe('1c7a48ba6a562aa9eaa2481a9049cdf0433b9738c992d698c31d8abf89cadc79');
  });
});
