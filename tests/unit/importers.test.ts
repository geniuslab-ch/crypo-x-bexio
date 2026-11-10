import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAmount } from '@/core/decimal';
import { coinbaseImporter } from '@/core/importers/coinbase';
import { genericImporter } from '@/core/importers/generic';
import { detectImporter } from '@/core/importers';
import { krakenLedgerImporter } from '@/core/importers/kraken';

const fixture = (f: string) => readFileSync(path.join(import.meta.dirname, '..', 'fixtures', f), 'utf8');

describe('parseAmount', () => {
  it.each([
    ['1234.5', '1234.5'],
    ["1'234.50", '1234.5'],
    ['1,234.50', '1234.5'],
    ['1,234', '1234'],
    ['12,5', '12.5'],
    ['CHF2000.00', '2000'],
    ['$-3.10', '-3.1'],
    ['-0.0001', '-0.0001'],
  ])('%s → %s', (input, out) => {
    expect(parseAmount(input)!.toString()).toBe(out);
  });
  it('rejects garbage', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('generic importer', () => {
  const csv = [
    'date,type,in_asset,in_quantity,out_asset,out_quantity,fee_asset,fee_quantity,external_id,tx_hash,chf_value,note',
    '2024-01-01T10:00:00Z,buy,BTC,0.5,CHF,20000,CHF,20,g1,,,first buy',
    '2024-01-02,,eth,1,,,,,g2,0xabc,,',
    'not-a-date,buy,BTC,1,CHF,1,,,g3,,,',
    '2024-01-03,teleport,BTC,1,,,,,g4,,,',
  ].join('\n');
  it('parses valid rows and reports invalid ones', () => {
    const r = genericImporter.parse(csv);
    expect(r.transactions).toHaveLength(2);
    expect(r.issues.map((i) => i.rowNumber)).toEqual([4, 5]);
    const [t1, t2] = r.transactions;
    expect(t1!.movements).toEqual([
      { direction: 'in', asset: 'BTC', quantity: '0.5' },
      { direction: 'out', asset: 'CHF', quantity: '20000' },
      { direction: 'fee', asset: 'CHF', quantity: '20' },
    ]);
    expect(t1!.hint?.classification).toBe('buy');
    expect(t2!.movements[0]!.asset).toBe('ETH');
    expect(t2!.occurredAt.toISOString()).toBe('2024-01-02T00:00:00.000Z');
  });
  it('is detected by header', () => {
    expect(detectImporter(csv)?.id).toBe('generic_v1');
  });
});

describe('kraken ledger importer', () => {
  const r = krakenLedgerImporter.parse(fixture('kraken_ledgers.csv'));
  it('groups by refid and normalises assets', () => {
    const trade = r.transactions.find((t) => t.externalId === 'T1AAAA-AAAAA-AAAAAA')!;
    expect(trade.movements).toEqual([
      { direction: 'out', asset: 'CHF', quantity: '4000' },
      { direction: 'in', asset: 'BTC', quantity: '0.1' },
      { direction: 'fee', asset: 'CHF', quantity: '10.4' },
    ]);
    expect(trade.rowNumbers).toEqual([3, 4]);
    expect(trade.raw).toHaveLength(2);
  });
  it('treats spot↔staking moves as internal and staking credits as rewards', () => {
    const move = r.transactions.find((t) => t.externalId === 'S1AAAA-AAAAA-AAAAAA')!;
    expect(move.movements).toEqual([]);
    expect(move.hint?.classification).toBe('internal_transfer');
    const reward = r.transactions.find((t) => t.externalId === 'R1AAAA-AAAAA-AAAAAA')!;
    expect(reward.hint?.classification).toBe('staking_reward');
    expect(reward.movements).toEqual([{ direction: 'in', asset: 'BTC', quantity: '0.0001' }]);
  });
  it('skips pending rows without txid and reports them', () => {
    const w = r.transactions.filter((t) => t.externalId === 'Q2AAAA-AAAAA-AAAAAA');
    expect(w).toHaveLength(1);
    expect(w[0]!.movements).toEqual([
      { direction: 'out', asset: 'BTC', quantity: '0.02' },
      { direction: 'fee', asset: 'BTC', quantity: '0.00005' },
    ]);
    expect(r.issues.some((i) => i.message.includes('sans txid'))).toBe(true);
  });
  it('is not detected as generic', () => {
    expect(detectImporter(fixture('kraken_ledgers.csv'))?.id).toBe('kraken_ledger_v1');
  });
});

describe('coinbase importer', () => {
  const r = coinbaseImporter.parse(fixture('coinbase_history.csv'));
  it('skips the preamble and parses buys, sells and converts', () => {
    expect(r.issues).toEqual([]);
    const byId = Object.fromEntries(r.transactions.map((t) => [t.externalId, t]));
    expect(byId['cb-1']!.movements).toEqual([
      { direction: 'in', asset: 'ETH', quantity: '1.5' },
      { direction: 'out', asset: 'CHF', quantity: '3000' },
      { direction: 'fee', asset: 'CHF', quantity: '29.85' },
    ]);
    expect(byId['cb-2']!.movements).toEqual([
      { direction: 'out', asset: 'ETH', quantity: '0.5' },
      { direction: 'in', asset: 'CHF', quantity: '1250' },
      { direction: 'fee', asset: 'CHF', quantity: '12.5' },
    ]);
    expect(byId['cb-3']!.movements).toEqual([
      { direction: 'out', asset: 'ETH', quantity: '0.2' },
      { direction: 'in', asset: 'BTC', quantity: '0.01' },
    ]);
    expect(byId['cb-4']!.hint?.classification).toBe('staking_reward');
    expect(byId['cb-4']!.sourceChfValue).toBe('2.6');
    expect(byId['cb-5']!.hint?.classification).toBe('unknown');
  });
});
