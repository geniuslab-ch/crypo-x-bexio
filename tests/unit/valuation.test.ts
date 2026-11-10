import { describe, expect, it } from 'vitest';
import { rateTableLookup, zurichDate } from '@/core/valuation/rateTable';
import { valueTransaction } from '@/core/valuation/value';

const lookup = rateTableLookup([
  { asset: 'EUR', rateDate: '2024-01-10', rate: '0.94', source: 'Test table', sourceUrl: null },
  { asset: 'ETH', rateDate: '2024-01-10', rate: '2000', source: 'Test table', sourceUrl: 'https://example.test' },
]);
const at = new Date('2024-01-10T10:00:00Z');

describe('valuation', () => {
  it('uses the CHF leg of a trade as exact evidence', () => {
    const r = valueTransaction({ occurredAt: at, classification: 'buy', movements: [
      { direction: 'in', asset: 'BTC', quantity: '0.1' }, { direction: 'out', asset: 'CHF', quantity: '4000' }, { direction: 'fee', asset: 'CHF', quantity: '10' },
    ] }, lookup);
    expect(r.missing).toEqual([]);
    expect(r.movements[0]).toMatchObject({ chfValue: '4000', chfRate: '40000', rateSource: 'trade_implied' });
    expect(r.movements[2]).toMatchObject({ chfValue: '10' });
  });

  it('converts through a documented fiat rate', () => {
    const r = valueTransaction({ occurredAt: at, classification: 'buy', movements: [
      { direction: 'in', asset: 'ETH', quantity: '1' }, { direction: 'out', asset: 'EUR', quantity: '2000' },
    ] }, lookup);
    expect(r.movements[0]).toMatchObject({ chfValue: '1880', rateSource: 'trade_implied_via_EUR' });
  });

  it('reports missing rates instead of guessing', () => {
    const r = valueTransaction({ occurredAt: at, classification: 'staking_reward', movements: [{ direction: 'in', asset: 'DOT', quantity: '3' }] }, lookup);
    expect(r.missing).toEqual(['DOT']);
    expect(r.movements[0]!.chfValue).toBeNull();
  });

  it('values both legs of a swap identically', () => {
    const r = valueTransaction({ occurredAt: at, classification: 'swap', movements: [
      { direction: 'out', asset: 'ETH', quantity: '2' }, { direction: 'in', asset: 'BTC', quantity: '0.1' },
    ] }, lookup);
    expect(r.movements.map((m) => m.chfValue)).toEqual(['4000', '4000']);
  });

  it('does not need values for internal transfer principal legs', () => {
    const r = valueTransaction({ occurredAt: at, classification: 'internal_transfer', movements: [{ direction: 'out', asset: 'DOT', quantity: '3' }] }, lookup);
    expect(r.missing).toEqual([]);
  });

  it('uses the Swiss calendar date', () => {
    expect(zurichDate(new Date('2024-01-09T23:30:00Z'))).toBe('2024-01-10');
  });
});
