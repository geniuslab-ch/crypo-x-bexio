import { describe, expect, it } from 'vitest';
import { cardanoConnector, epochStart, mapCardano } from '@/integrations/sources/cardano';
import { solanaConnector } from '@/integrations/sources/solana';
import type { FetchContext } from '@/integrations/sources/types';

function fx(handler: (url: string, body: any) => unknown, clock = { t: Date.UTC(2026, 10, 10) }): FetchContext {
  return {
    fetch: (async (url: string, init?: RequestInit) => { clock.t += 50; return new Response(JSON.stringify(handler(String(url), init?.body ? JSON.parse(String(init.body)) : null))); }) as typeof fetch,
    deadline: clock.t + 10_000_000, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, env: {},
  };
}

const STAKE = 'stake1uyrx65wjqjgeeksd8hptmcgl5jfyrqkfq0xe8xlp367kphsckq250';

describe('Cardano staking', () => {
  it('dates epochs from the Koios reference (epoch 0 = 1506203091, 5 days)', () => {
    expect(epochStart(0).getTime() / 1000).toBe(1506203091);
    expect(epochStart(208).getTime() / 1000).toBe(1596059091);
  });

  it('maps delegation rewards in ADA and leaves other payments for review', () => {
    const r = mapCardano([
      { stake_address: STAKE, earned_epoch: 500, spendable_epoch: 502, amount: '1234567', type: 'member', pool_id_bech32: 'pool1x' },
      { stake_address: STAKE, earned_epoch: 501, spendable_epoch: 503, amount: '2000000', type: 'refund', pool_id_bech32: null },
      { stake_address: STAKE, earned_epoch: 9999, spendable_epoch: 10001, amount: '1', type: 'member' },
    ], Date.UTC(2026, 10, 10));
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]!.movements).toEqual([{ direction: 'in', asset: 'ADA', quantity: '1.234567' }]);
    expect(r.transactions[0]!.hint?.classification).toBe('staking_reward');
    expect(r.transactions[1]!.hint?.classification).toBe('unknown');
  });

  it('resolves a payment address to its stake address', async () => {
    const calls: string[] = [];
    const r = await cardanoConnector.sync({ addresses: 'addr1q9ld26v2lv8wvrxxmvg90pn8n8n5k6tdst06q2s856rwmvnueldzuuqmnsye359fqrk8hwvenjnqultn7djtrlft7jnq7dy7wv' }, {}, fx((url, body) => {
      calls.push(url);
      if (url.endsWith('/address_info')) return [{ address: body._addresses[0], stake_address: STAKE }];
      return [{ stake_address: STAKE, earned_epoch: 500, spendable_epoch: 502, amount: '5000000', type: 'member', pool_id_bech32: 'pool1x' }];
    }));
    expect(calls[1]).toContain('/account_reward_history');
    expect(r.transactions[0]!.movements[0]!.quantity).toBe('5');
  });
});

describe('Solana staking', () => {
  const A = '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2';
  it('reads epochs backwards, stops after empty epochs and resumes from the last imported epoch', async () => {
    const handler = (top: number) => (_url: string, body: any) => {
      if (body.method === 'getEpochInfo') return { result: { epoch: top } };
      if (body.method === 'getBlockTime') return { result: 1_700_000_000 + body.params[0] };
      const e = body.params[1].epoch;
      return { result: [e >= 95 ? { epoch: e, effectiveSlot: e * 1000, amount: 2_500_000, postBalance: 10, commission: 5 } : null] };
    };
    const first = await solanaConnector.sync({ addresses: A }, {}, fx(handler(100)));
    expect(first.complete).toBe(true);
    expect(first.transactions).toHaveLength(5); // epochs 95..99
    expect(first.transactions[0]!.movements[0]).toEqual({ direction: 'in', asset: 'SOL', quantity: '0.0025' });
    const asked: number[] = [];
    const second = await solanaConnector.sync({ addresses: A }, first.state, fx((u, b) => { if (b.method === 'getInflationReward') asked.push(b.params[1].epoch); return handler(102)(u, b); }));
    expect(asked).toEqual([101, 100]);
    expect(second.transactions).toHaveLength(2);
  });
});
