import { describe, expect, it } from 'vitest';
import {
  bookBalances, openingBalanceInstant, reversalLines, valuationLines, valuationRows, yearEndExclusive,
} from '@/core/accounting/closing';
import { runAccounting, type AccountingTx } from '@/core/accounting/engine';
import { zurichDate } from '@/core/valuation/rateTable';
import type { ValuedMovement } from '@/core/valuation/value';

const row = (key: string, quantity: string, bookValue: string, rate: string | null) => ({ key, asset: key.slice(13).split('@')[0]!, quantity, bookValue, rate, rateSource: rate ? 'test' : null });

describe('year-end valuation', () => {
  it('lower of cost writes down only', () => {
    const { rows, missing } = valuationRows([
      row('crypto_asset:BTC', '0.5', '25000.00', '40000'),
      row('crypto_asset:ETH', '2', '3000.00', '2000'),
    ], 'lower_of_cost');
    expect(missing).toEqual([]);
    expect(rows.map((r) => r.adjustment)).toEqual(['-5000.00', '0.00']);
    expect(rows[1]!.marketValue).toBe('4000.00');
    expect(valuationLines(rows)).toEqual([{ debitKey: 'valuation_loss', creditKey: 'crypto_asset:BTC', amount: '5000.00' }]);
  });

  it('market value adjusts both ways and the reversal swaps the sides', () => {
    const { rows } = valuationRows([
      row('crypto_asset:BTC', '0.5', '25000.00', '40000'),
      row('crypto_asset:ETH@w1', '2', '3000.00', '2000.004'),
    ], 'market');
    const lines = valuationLines(rows);
    expect(lines).toEqual([
      { debitKey: 'valuation_loss', creditKey: 'crypto_asset:BTC', amount: '5000.00' },
      { debitKey: 'crypto_asset:ETH@w1', creditKey: 'valuation_gain', amount: '1000.01' },
    ]);
    expect(reversalLines(lines)[1]).toEqual({ debitKey: 'valuation_gain', creditKey: 'crypto_asset:ETH@w1', amount: '1000.01' });
  });

  it('reports assets without a value at 31.12 instead of guessing', () => {
    const { rows, missing } = valuationRows([row('crypto_asset:OGY', '10', '5.00', null)], 'market');
    expect(missing).toEqual(['OGY']);
    expect(valuationLines(rows)).toEqual([]);
  });

  it('computes book balances from booked lines', () => {
    const b = bookBalances([
      { debitKey: 'crypto_asset:BTC', creditKey: 'fiat_clearing:CHF', amountChf: '100.00' },
      { debitKey: 'fiat_clearing:CHF', creditKey: 'crypto_asset:BTC', amountChf: '40.00' },
    ]);
    expect(b.get('crypto_asset:BTC')!.toFixed(2)).toBe('60.00');
  });

  it('dates the year bounds in Swiss time', () => {
    expect(yearEndExclusive(2025).toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(zurichDate(yearEndExclusive(2025))).toBe('2026-01-01');
    expect(zurichDate(openingBalanceInstant(2026))).toBe('2025-12-31');
  });
});

describe('opening balances in the engine', () => {
  const mv = (direction: ValuedMovement['direction'], asset: string, quantity: string, chfValue: string): ValuedMovement => ({
    direction, asset, quantity, chfValue, chfRate: null, rateSource: 'test', rateRef: 'test',
  });
  it('creates lots without postings and uses their cost for later disposals', () => {
    const txs: AccountingTx[] = [
      { id: 'o1', classification: 'opening_balance', occurredAt: openingBalanceInstant(2026), movements: [mv('in', 'BTC', '1', '10000')], wallet: 'w1' },
      { id: 's1', classification: 'sell', occurredAt: new Date('2026-02-01T10:00:00Z'), movements: [mv('out', 'BTC', '0.4', '20000'), mv('in', 'CHF', '20000', '20000')], wallet: 'w1' },
    ];
    const r = runAccounting(txs, { method: 'fifo', tradingFeeTreatment: 'expense' });
    expect(r.issues).toEqual([]);
    expect(r.results[0]!.postings).toEqual([]);
    expect(r.results[1]!.realizedGain.toString()).toBe('16000');
    expect(r.pools).toHaveLength(1);
    expect(r.pools[0]).toMatchObject({ key: 'crypto_asset:BTC@w1', asset: 'BTC', wallet: 'w1' });
    expect(r.pools[0]!.cost.toString()).toBe('6000');
  });
});
