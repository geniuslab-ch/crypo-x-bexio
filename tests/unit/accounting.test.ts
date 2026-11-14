import { describe, expect, it } from 'vitest';
import { runAccounting, type AccountingTx, type AccountingPolicy } from '@/core/accounting/engine';
import { postingsToLines } from '@/core/accounting/journal';
import { D, type Dec } from '@/core/decimal';
import type { ValuedMovement } from '@/core/valuation/value';

const mv = (direction: ValuedMovement['direction'], asset: string, quantity: string, chfValue: string | null): ValuedMovement => ({
  direction, asset, quantity, chfValue, chfRate: chfValue === null ? null : new D(chfValue).div(quantity).toString(), rateSource: 'test', rateRef: 'test',
});
let n = 0;
const tx = (classification: AccountingTx['classification'], movements: ValuedMovement[], day: number): AccountingTx => ({
  id: `t${String(++n).padStart(3, '0')}`, classification, movements, occurredAt: new Date(Date.UTC(2024, 0, day)),
});
const FIFO: AccountingPolicy = { method: 'fifo', tradingFeeTreatment: 'expense' };
const WAC: AccountingPolicy = { method: 'wac', tradingFeeTreatment: 'expense' };

function scenario() {
  return [
    tx('buy', [mv('in', 'BTC', '1', '10000'), mv('out', 'CHF', '10000', '10000')], 1),
    tx('buy', [mv('in', 'BTC', '1', '20000'), mv('out', 'CHF', '20000', '20000')], 2),
    tx('sell', [mv('out', 'BTC', '1.5', '45000'), mv('in', 'CHF', '45000', '45000')], 3),
  ];
}

function balanced(postings: { amount: Dec }[]) {
  return postings.reduce((a, p) => a.plus(p.amount), new D(0)).isZero();
}

describe('cost basis', () => {
  it('FIFO consumes the oldest lots first', () => {
    const r = runAccounting(scenario(), FIFO);
    expect(r.issues).toEqual([]);
    const sale = r.results[2]!;
    expect(sale.disposals[0]).toMatchObject({ costChf: '20000', proceedsChf: '45000', gainChf: '25000' });
    expect(sale.disposals[0]!.allocations.map((a) => a.quantity)).toEqual(['1', '0.5']);
    expect(r.holdings.get('BTC')!.quantity.toString()).toBe('0.5');
    expect(r.holdings.get('BTC')!.cost.toString()).toBe('10000');
    for (const res of r.results) expect(balanced(res.postings)).toBe(true);
  });

  it('weighted average cost uses the pooled average', () => {
    const r = runAccounting(scenario(), WAC);
    expect(r.results[2]!.disposals[0]).toMatchObject({ costChf: '22500', gainChf: '22500' });
    expect(r.holdings.get('BTC')!.cost.toString()).toBe('7500');
  });

  it('flags disposals without enough acquisition history instead of assuming zero cost', () => {
    const r = runAccounting([tx('sell', [mv('out', 'ETH', '1', '2000'), mv('in', 'CHF', '2000', '2000')], 5)], FIFO);
    expect(r.issues[0]).toMatchObject({ code: 'insufficient_lots' });
    expect(r.results).toHaveLength(0);
  });

  it('blocks transactions without a CHF value', () => {
    const r = runAccounting([tx('staking_reward', [mv('in', 'DOT', '1', null)], 5)], FIFO);
    expect(r.issues[0]).toMatchObject({ code: 'missing_rate' });
  });

  it('refuses classifications that Phase 1 cannot book', () => {
    const r = runAccounting([tx('nft_purchase', [mv('in', 'ETH', '1', '1')], 5)], FIFO);
    expect(r.issues[0]).toMatchObject({ code: 'not_bookable' });
    // A DeFi operation must be an exchange.
    expect(runAccounting([tx('defi', [mv('in', 'ETH', '1', '1')], 5)], FIFO).issues[0]).toMatchObject({ code: 'not_bookable' });
  });
});

describe('fees', () => {
  const buyWithFee = () => tx('buy', [mv('in', 'BTC', '1', '10000'), mv('out', 'CHF', '10000', '10000'), mv('fee', 'CHF', '50', '50')], 1);
  const sellWithFee = () => tx('sell', [mv('out', 'BTC', '1', '12000'), mv('in', 'CHF', '12000', '12000'), mv('fee', 'CHF', '60', '60')], 2);

  it('expense mode books fees as expenses', () => {
    const r = runAccounting([buyWithFee(), sellWithFee()], FIFO);
    expect(r.results[1]!.disposals[0]).toMatchObject({ costChf: '10000', gainChf: '2000' });
    expect(r.results[0]!.postings.find((p) => p.key === 'trading_fees')!.amount.toString()).toBe('50');
  });

  it('capitalize mode adds buy fees to cost and deducts sell fees from proceeds', () => {
    const r = runAccounting([buyWithFee(), sellWithFee()], { method: 'fifo', tradingFeeTreatment: 'capitalize' });
    expect(r.results[1]!.disposals[0]).toMatchObject({ costChf: '10050', proceedsChf: '11940', gainChf: '1890' });
    expect(r.results.every((x) => !x.postings.some((p) => p.key === 'trading_fees'))).toBe(true);
    for (const res of r.results) expect(balanced(res.postings)).toBe(true);
  });

  it('a fee paid in crypto is a disposal of that crypto', () => {
    const r = runAccounting([
      tx('buy', [mv('in', 'BTC', '1', '10000'), mv('out', 'CHF', '10000', '10000')], 1),
      tx('internal_transfer', [mv('out', 'BTC', '0.5', null), mv('fee', 'BTC', '0.001', '30')], 2),
    ], FIFO);
    expect(r.issues).toEqual([]);
    const t = r.results[1]!;
    expect(t.disposals[0]).toMatchObject({ kind: 'fee', costChf: '10', proceedsChf: '30', gainChf: '20' });
    expect(t.postings.find((p) => p.key === 'network_fees')!.amount.toString()).toBe('30');
    expect(r.holdings.get('BTC')!.quantity.toString()).toBe('0.999');
  });
});

describe('postings and journal lines', () => {
  it('swap with a loss produces balanced debit/credit pairs', () => {
    const r = runAccounting([
      tx('buy', [mv('in', 'ETH', '2', '6000'), mv('out', 'CHF', '6000', '6000')], 1),
      tx('swap', [mv('out', 'ETH', '2', '5000'), mv('in', 'BTC', '0.1', '5000')], 2),
    ], FIFO);
    const lines = postingsToLines(r.results[1]!.postings);
    expect(lines).toEqual([
      { debitKey: 'crypto_asset:BTC', creditKey: 'crypto_asset:ETH', amount: '5000.00' },
      { debitKey: 'realized_loss', creditKey: 'crypto_asset:ETH', amount: '1000.00' },
    ]);
  });

  it('income is booked at fair value against the income account', () => {
    const r = runAccounting([tx('staking_reward', [mv('in', 'ETH', '0.01', '25.55')], 1)], FIFO);
    expect(postingsToLines(r.results[0]!.postings)).toEqual([
      { debitKey: 'crypto_asset:ETH', creditKey: 'staking_income', amount: '25.55' },
    ]);
  });

  it('rounds to cents and still balances', () => {
    const r = runAccounting([
      tx('buy', [mv('in', 'BTC', '3', '100'), mv('out', 'CHF', '100', '100')], 1),
      tx('sell', [mv('out', 'BTC', '1', '50.005'), mv('in', 'CHF', '50.005', '50.005')], 2),
    ], FIFO);
    const lines = postingsToLines(r.results[1]!.postings);
    const debits = lines.reduce((a, l) => a.plus(l.amount), new D(0));
    expect(debits.toFixed(2)).toBe('50.01');
    expect(lines.every((l) => /^\d+\.\d{2}$/.test(l.amount))).toBe(true);
  });

  it('a sale with a gain', () => {
    const r = runAccounting(scenario(), FIFO);
    expect(postingsToLines(r.results[2]!.postings)).toEqual([
      { debitKey: 'fiat_clearing:CHF', creditKey: 'crypto_asset:BTC', amount: '20000.00' },
      { debitKey: 'fiat_clearing:CHF', creditKey: 'realized_gain', amount: '25000.00' },
    ]);
  });
});

describe('cumulative rounding', () => {
  it('books 1000 rewards of 0.004 CHF as 4.00 CHF in total, every entry balanced', async () => {
    const { D } = await import('@/core/decimal');
    const carry = new Map();
    let crypto = new D(0);
    let income = new D(0);
    for (let i = 0; i < 1000; i++) {
      const lines = postingsToLines([{ key: 'crypto_asset:ADA', amount: new D('0.004') }, { key: 'staking_income', amount: new D('-0.004') }], carry);
      for (const l of lines) {
        if (l.debitKey === 'crypto_asset:ADA') crypto = crypto.plus(l.amount);
        if (l.creditKey === 'staking_income') income = income.plus(l.amount);
      }
    }
    expect(crypto.toFixed(2)).toBe('4.00');
    expect(income.toFixed(2)).toBe('4.00');
    // Without the carry every entry rounds to zero and nothing is booked.
    expect(postingsToLines([{ key: 'crypto_asset:ADA', amount: new D('0.004') }, { key: 'staking_income', amount: new D('-0.004') }])).toEqual([]);
  });
});
