import { describe, expect, it } from 'vitest';
import { runAccounting, type AccountingTx } from '@/core/accounting/engine';
import { classifyTransactions, DEFAULT_CLASSIFICATION_OPTIONS } from '@/core/classification/engine';
import { D } from '@/core/decimal';
import { defiHint, DEFI_CONTRACTS } from '@/core/defi';
import { genericImporter } from '@/core/importers/generic';
import { valueTransaction, type RateLookup } from '@/core/valuation/value';
import { mapEthereum } from '@/integrations/sources/ethereum';

const me = '0x1111111111111111111111111111111111111111';
const pool = '0x9999999999999999999999999999999999999999';
const UNI_V2 = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const AAVE = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const base = { blockNumber: '1', timeStamp: '1700000000', gasPrice: '1000000000', gasUsed: '100000', isError: '0' };
const token = (hash: string, from: string, to: string, value: string, contract: string, symbol: string, dec = '6') =>
  ({ ...base, kind: 'tokentx', hash, from, to, value, contractAddress: contract, tokenSymbol: symbol, tokenDecimal: dec }) as never;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const classify = (t: ReturnType<typeof mapEthereum>['transactions'][number]) =>
  classifyTransactions([{ id: 't', sourceId: 's', provider: 'ethereum', occurredAt: t.occurredAt, rawType: t.rawType, txHash: t.txHash, movements: t.movements, hint: t.hint ?? null, manual: null }], [], DEFAULT_CLASSIFICATION_OPTIONS).get('t')!;

describe('DeFi recognition from documented contracts', () => {
  it('only lists lower-case Ethereum addresses', () => {
    for (const a of Object.keys(DEFI_CONTRACTS)) expect(a).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('books a swap through the Uniswap router as a swap without review', () => {
    const r = mapEthereum([me], [
      { ...base, kind: 'txlist', hash: '0xs', from: me, to: UNI_V2, value: '1000000000000000000' } as never,
      token('0xs', pool, me, '2500000000', USDC, 'USDC'),
    ]);
    const t = r.transactions[0]!;
    expect(t.hint?.classification).toBe('swap');
    expect(t.hint?.reason).toContain('Uniswap V2 Router');
    expect(classify(t).needsReview).toBe(false);
  });

  it('sends an Aave deposit to review as a DeFi operation, even with an unknown receipt token', () => {
    const r = mapEthereum([me], [
      { ...base, kind: 'txlist', hash: '0xa', from: me, to: AAVE, value: '0' } as never,
      token('0xa', me, AAVE, '1000000000', USDC, 'USDC'),
      token('0xa', '0x0000000000000000000000000000000000000000', me, '1000000000', '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c', 'aEthUSDC'),
    ]);
    const t = r.transactions[0]!;
    expect(t.hint?.classification).toBe('defi');
    const c = classify(t);
    expect(c.classification).toBe('defi');
    expect(c.needsReview).toBe(true);
  });

  it('keeps a router swap with an unrecognised token in review', () => {
    const r = mapEthereum([me], [
      { ...base, kind: 'txlist', hash: '0xz', from: me, to: UNI_V2, value: '1000000000000000000' } as never,
      token('0xz', pool, me, '5', '0x5555555555555555555555555555555555555555', 'SCAM', '0'),
    ]);
    expect(classify(r.transactions[0]!).needsReview).toBe(true);
  });

  it('names liquidity added and removed', () => {
    const p = DEFI_CONTRACTS['0xc36442b4a4522e871399cd717abdd847ab11fe88']!;
    expect(defiHint(p, [{ direction: 'out', asset: 'ETH', quantity: '1' }, { direction: 'out', asset: 'USDC', quantity: '2500' }, { direction: 'in', asset: 'NFT.c36442#1', quantity: '1' }])?.reason).toContain('apport');
    expect(defiHint(p, [{ direction: 'in', asset: 'ETH', quantity: '1' }, { direction: 'in', asset: 'USDC', quantity: '2500' }, { direction: 'out', asset: 'NFT.c36442#1', quantity: '1' }])?.reason).toContain('retrait');
  });
});

describe('DeFi valuation and booking', () => {
  const rates: Record<string, string> = { ETH: '2000', USDC: '0.9' };
  const lookup: RateLookup = (asset) => (rates[asset] ? { rate: rates[asset]!, source: 'test', ref: 'test' } : null);

  it('values an LP token at the value of the assets given', () => {
    const v = valueTransaction({ occurredAt: new Date(), classification: 'liquidity_pool', movements: [
      { direction: 'out', asset: 'ETH', quantity: '1' }, { direction: 'out', asset: 'USDC', quantity: '2000' }, { direction: 'in', asset: 'UNI-V2.b4e16d', quantity: '0.05' },
    ] }, lookup);
    expect(v.missing).toEqual([]);
    const lp = v.movements.find((m) => m.asset === 'UNI-V2.b4e16d')!;
    expect(lp.chfValue).toBe('3800');
    expect(lp.rateSource).toBe('exchange_implied');
  });

  it('does not derive a value when two legs have no rate', () => {
    const v = valueTransaction({ occurredAt: new Date(), classification: 'liquidity_pool', movements: [
      { direction: 'out', asset: 'ETH', quantity: '1' }, { direction: 'out', asset: 'FOO', quantity: '5' }, { direction: 'in', asset: 'LP', quantity: '1' },
    ] }, lookup);
    expect(v.missing.sort()).toEqual(['FOO', 'LP']);
  });

  it('books adding and removing liquidity as exchanges at market value', () => {
    const at = (day: number) => new Date(Date.UTC(2025, 0, day));
    const mv = (direction: 'in' | 'out', asset: string, quantity: string, chf: string) => ({ direction, asset, quantity, chfValue: chf, chfRate: new D(chf).div(quantity).toString(), rateSource: 't', rateRef: 't' });
    const txs: AccountingTx[] = [
      { id: 'a', classification: 'buy', occurredAt: at(1), movements: [mv('in', 'ETH', '1', '1500'), mv('out', 'CHF', '1500', '1500')] },
      { id: 'b', classification: 'buy', occurredAt: at(1), movements: [mv('in', 'USDC', '2000', '1800'), mv('out', 'CHF', '1800', '1800')] },
      { id: 'c', classification: 'liquidity_pool', occurredAt: at(2), movements: [mv('out', 'ETH', '1', '2000'), mv('out', 'USDC', '2000', '1800'), mv('in', 'LP', '0.05', '3800')] },
      { id: 'd', classification: 'liquidity_pool', occurredAt: at(3), movements: [mv('out', 'LP', '0.05', '3990'), mv('in', 'ETH', '0.9', '2000'), mv('in', 'USDC', '2200', '2000')] },
      { id: 'e', classification: 'buy', occurredAt: at(4), movements: [mv('in', 'ETH', '1', '1000'), mv('in', 'BTC', '1', '1000'), mv('out', 'CHF', '2000', '2000')] },
      { id: 'f', classification: 'defi', occurredAt: at(5), movements: [mv('out', 'ETH', '0.7', '1400.33'), mv('out', 'BTC', '1', '700.17'), mv('in', 'STETH', '1', '2100')] },
    ];
    const r = runAccounting(txs, { method: 'fifo', tradingFeeTreatment: 'expense' });
    expect(r.issues).toEqual([]);
    const gain = (id: string) => r.results.find((x) => x.txId === id)!.realizedGain.toString();
    expect(gain('c')).toBe('500');
    expect(gain('d')).toBe('200');
    expect(r.holdings.get('LP')?.quantity.toString() ?? '0').toBe('0');
    // Legs valued separately: the proceeds follow the value received (4000, not 3990; 2100, not 2100.50).
    expect(r.results.find((x) => x.txId === 'f')!.disposals.reduce((a, d) => a.plus(d.proceedsChf), new D(0)).toString()).toBe('2100');
  });
});

describe('generic CSV: DeFi operations over several rows', () => {
  const H = 'date,type,in_asset,in_quantity,out_asset,out_quantity,fee_asset,fee_quantity,external_id,tx_hash,chf_value,note';
  it('joins the legs of one liquidity operation and keeps other rows apart', () => {
    const r = genericImporter.parse([H,
      '2025-02-01T10:00:00Z,liquidity_pool,UNI-V2,0.05,ETH,1,ETH,0.002,lp-1,0xabc,,apport',
      '2025-02-01T10:00:00Z,liquidity_pool,,,USDC,2000,,,lp-1,0xabc,,',
      '2025-02-01T10:00:00Z,swap,USDC,10,ETH,0.005,,,lp-1b,,,',
      '2025-03-01T10:00:00Z,liquidity_pool,ETH,1,UNI-V2,0.05,,,lp-2,,,',
      '2025-03-02T10:00:00Z,liquidity_pool,USDC,2100,,,,,lp-2,,,',
    ].join('\n'));
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[0]!.movements.map((m) => `${m.direction}:${m.asset}`)).toEqual(['in:UNI-V2', 'out:ETH', 'fee:ETH', 'out:USDC']);
    expect(r.issues).toHaveLength(1);
  });
});
