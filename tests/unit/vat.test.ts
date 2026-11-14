import { describe, expect, it } from 'vitest';
import { buildManualEntry, type MappedAccount } from '@/integrations/bexio/payload';

const years = [{ start: '2025-01-01', end: '2025-12-31', status: 'open' }];
const m = (id: number, taxId?: number): MappedAccount => ({ bexioAccountId: id, accountNo: String(id), isActive: true, taxId: taxId ?? null });
const entry = { entryDate: '2025-05-01', referenceNr: 'C2B-1', description: 'x', lines: [
  { debitKey: 'crypto_asset:BTC', creditKey: 'mining_income', amountChf: '100.00', description: 'x' },
  { debitKey: 'trading_fees', creditKey: 'fiat_clearing:CHF', amountChf: '1.00', description: 'x' },
] };

describe('VAT codes on bexio lines', () => {
  it('sets the VAT code of the account on either side, and none otherwise', () => {
    const r = buildManualEntry(entry, new Map([['crypto_asset:*', m(1)], ['mining_income', m(2, 31)], ['trading_fees', m(3)], ['fiat_clearing:*', m(4)]]), 1, years);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.entries[0]!.tax_id).toBe(31);
    expect('tax_id' in r.payload.entries[1]!).toBe(false);
  });

  it('refuses two different VAT codes on one line', () => {
    const r = buildManualEntry(entry, new Map([['crypto_asset:*', m(1, 5)], ['mining_income', m(2, 31)], ['trading_fees', m(3)], ['fiat_clearing:*', m(4)]]), 1, years);
    expect(r).toMatchObject({ ok: false });
  });
});
