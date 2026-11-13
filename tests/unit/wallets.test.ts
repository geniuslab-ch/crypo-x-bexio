import { describe, expect, it } from 'vitest';
import { keyFallbacks, resolveMapping } from '@/core/accounting/accountKeys';
import { runAccounting, type AccountingPolicy, type AccountingTx } from '@/core/accounting/engine';
import { D, type Dec } from '@/core/decimal';
import type { ValuedMovement } from '@/core/valuation/value';

const mv = (direction: ValuedMovement['direction'], asset: string, quantity: string, chfValue: string | null): ValuedMovement => ({
  direction, asset, quantity, chfValue, chfRate: chfValue === null ? null : new D(chfValue).div(quantity).toString(), rateSource: 'test', rateRef: 'test',
});
let n = 0;
const tx = (classification: AccountingTx['classification'], movements: ValuedMovement[], day: number, extra: Partial<AccountingTx> = {}): AccountingTx => ({
  id: `w${String(++n).padStart(3, '0')}`, classification, movements, occurredAt: new Date(Date.UTC(2025, 0, day)), ...extra,
});
const FIFO: AccountingPolicy = { method: 'fifo', tradingFeeTreatment: 'expense' };
const WAC: AccountingPolicy = { method: 'wac', tradingFeeTreatment: 'expense' };
const sum = (ps: { key: string; amount: Dec }[], key: string) => ps.filter((p) => p.key === key).reduce((a, p) => a.plus(p.amount), new D(0)).toString();

describe('per-wallet accounts', () => {
  it('moves lots at cost between wallet accounts, without gain, and sells from the receiving wallet', () => {
    const r = runAccounting([
      tx('buy', [mv('in', 'OGY', '1000', '100'), mv('out', 'CHF', '100', '100')], 1, { wallet: 'treasury' }),
      tx('buy', [mv('in', 'OGY', '1000', '300'), mv('out', 'CHF', '300', '300')], 2, { wallet: 'treasury' }),
      // Sender side of a matched transfer: 1500 OGY leave the treasury, 1500 arrive in the pool wallet.
      tx('internal_transfer', [mv('out', 'OGY', '1500', '600')], 3, { wallet: 'treasury', transferTo: { wallet: 'pool', receivedQuantity: '1500' } }),
      tx('internal_transfer', [mv('in', 'OGY', '1500', '600')], 3, { wallet: 'pool' }),
      tx('sell', [mv('out', 'OGY', '1200', '480'), mv('in', 'CHF', '480', '480')], 4, { wallet: 'pool' }),
    ], FIFO);
    expect(r.issues).toEqual([]);
    const transfer = r.results[2]!;
    expect(transfer.realizedGain.isZero()).toBe(true);
    // 1000 at 0.10 + 500 at 0.30 = 250 CHF moved at cost.
    expect(sum(transfer.postings, 'crypto_asset:OGY@pool')).toBe('250');
    expect(sum(transfer.postings, 'crypto_asset:OGY@treasury')).toBe('-250');
    // FIFO inside the receiving wallet keeps the original acquisition dates: 1000 at 0.10 then 200 at 0.30.
    const sale = r.results[4]!;
    expect(sale.disposals[0]).toMatchObject({ costChf: '160', gainChf: '320' });
    expect(sum(sale.postings, 'crypto_asset:OGY@pool')).toBe('-160');
    // Holdings stay per asset: 500 left in the treasury (cost 150) + 300 in the pool (cost 90).
    expect(r.holdings.get('OGY')!.quantity.toString()).toBe('800');
  });

  it('blocks a transfer from a wallet that does not hold the units', () => {
    const r = runAccounting([
      tx('buy', [mv('in', 'ICP', '10', '50'), mv('out', 'CHF', '50', '50')], 1, { wallet: null }),
      tx('internal_transfer', [mv('out', 'ICP', '5', '25')], 2, { wallet: 'staking', transferTo: { wallet: null, receivedQuantity: '5' } }),
    ], FIFO);
    expect(r.issues.map((i) => i.code)).toEqual(['insufficient_lots']);
  });

  it('moves the average cost under WAC', () => {
    const r = runAccounting([
      tx('buy', [mv('in', 'OGY', '100', '10'), mv('out', 'CHF', '10', '10')], 1, { wallet: 'a' }),
      tx('buy', [mv('in', 'OGY', '100', '30'), mv('out', 'CHF', '30', '30')], 2, { wallet: 'a' }),
      tx('internal_transfer', [mv('out', 'OGY', '50', '10')], 3, { wallet: 'a', transferTo: { wallet: 'b', receivedQuantity: '50' } }),
    ], WAC);
    expect(sum(r.results[2]!.postings, 'crypto_asset:OGY@b')).toBe('10');
  });

  it('keeps the historical behaviour when no wallet has its own account', () => {
    const r = runAccounting([
      tx('buy', [mv('in', 'OGY', '100', '10'), mv('out', 'CHF', '10', '10')], 1),
      tx('internal_transfer', [mv('out', 'OGY', '100', '10')], 2),
    ], FIFO);
    expect(r.results[1]!.postings).toEqual([]);
    expect(r.results[0]!.postings.map((p) => p.key)).toContain('crypto_asset:OGY');
  });

  it('resolves a wallet key to the wallet account, then to the crypto accounts', () => {
    expect(keyFallbacks('crypto_asset:OGY@s1')).toEqual(['crypto_asset:OGY@s1', 'crypto_asset:*@s1', 'crypto_asset:OGY', 'crypto_asset:*']);
    expect(resolveMapping('crypto_asset:OGY@s1', new Map([['crypto_asset:*@s1', 12617], ['crypto_asset:*', 1090]]))).toBe(12617);
    expect(resolveMapping('crypto_asset:OGY@s2', new Map([['crypto_asset:*@s1', 12617], ['crypto_asset:*', 1090]]))).toBe(1090);
  });
});
