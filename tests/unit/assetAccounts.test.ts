import { describe, expect, it } from 'vitest';
import { buildManualEntry, type MappedAccount } from '@/integrations/bexio/payload';

const years = [{ start: '2025-01-01', end: '2025-12-31', status: 'open' }];
const m = (id: number, no: string): MappedAccount => ({ bexioAccountId: id, accountNo: no, isActive: true, taxId: null });
// Chart: 1090 general crypto account, 1091 Bitcoin, 1092 Ether (lines added with « Ajouter une crypto »).
const mappings = new Map([
  ['crypto_asset:*', m(10, '1090')], ['crypto_asset:BTC', m(11, '1091')], ['crypto_asset:ETH', m(12, '1092')],
  ['fiat_clearing:*', m(20, '1029')], ['realized_gain', m(30, '6950')], ['staking_income', m(31, '7500')],
]);

describe('one bexio account per crypto', () => {
  it('books each crypto on its own account and the others on the general account', () => {
    const r = buildManualEntry({ entryDate: '2025-05-01', referenceNr: 'C2B-1', description: 'x', lines: [
      { debitKey: 'fiat_clearing:CHF', creditKey: 'crypto_asset:BTC', amountChf: '900.00', description: 'Vente BTC (coût)' },
      { debitKey: 'fiat_clearing:CHF', creditKey: 'realized_gain', amountChf: '100.00', description: 'Gain' },
      { debitKey: 'crypto_asset:ETH', creditKey: 'staking_income', amountChf: '5.00', description: 'Staking ETH' },
      { debitKey: 'crypto_asset:ADA', creditKey: 'staking_income', amountChf: '2.00', description: 'Staking ADA' },
    ] }, mappings, 1, years);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [btc, , eth, ada] = r.payload.entries;
    expect(btc!.credit_account_id).toBe(11); // 1091 Bitcoin
    expect(eth!.debit_account_id).toBe(12); // 1092 Ether
    expect(ada!.debit_account_id).toBe(10); // no ADA line: general 1090
  });

  it('uses the crypto account for a wallet without its own account', () => {
    const r = buildManualEntry({ entryDate: '2025-05-01', referenceNr: 'C2B-2', description: 'x', lines: [
      { debitKey: 'crypto_asset:BTC@0b6f6c6e-0000-4000-8000-000000000001', creditKey: 'staking_income', amountChf: '1.00', description: 'x' },
    ] }, mappings, 1, years);
    expect(r.ok && r.payload.entries[0]!.debit_account_id).toBe(11);
  });

  it('refuses to send when neither the crypto nor the general account is mapped', () => {
    const r = buildManualEntry({ entryDate: '2025-05-01', referenceNr: 'C2B-3', description: 'x', lines: [
      { debitKey: 'crypto_asset:SOL', creditKey: 'staking_income', amountChf: '1.00', description: 'x' },
    ] }, new Map([['staking_income', m(31, '7500')]]), 1, years);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('crypto_asset:SOL') });
  });
});
