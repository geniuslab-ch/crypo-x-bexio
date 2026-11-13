import { describe, expect, it } from 'vitest';
import { runAccounting, type AccountingTx } from '@/core/accounting/engine';
import { postingsToLines } from '@/core/accounting/journal';
import { D } from '@/core/decimal';
import { classificationAllowed, kindOfLegalForm, legalFormOf, taxNotes } from '@/core/legalForms';
import type { ValuedMovement } from '@/core/valuation/value';

const mv = (direction: ValuedMovement['direction'], asset: string, quantity: string, chfValue: string): ValuedMovement => ({
  direction, asset, quantity, chfValue, chfRate: new D(chfValue).div(quantity).toString(), rateSource: 'test', rateRef: 'test',
});
const tx = (id: string, classification: AccountingTx['classification'], movements: ValuedMovement[], day: number): AccountingTx => ({
  id, classification, movements, occurredAt: new Date(Date.UTC(2025, 0, day)),
});
const POLICY = { method: 'fifo', tradingFeeTreatment: 'expense' } as const;

describe('legal forms', () => {
  it('stores SA and Sàrl as companies and keeps foundations apart', () => {
    expect(kindOfLegalForm('sa')).toBe('company');
    expect(kindOfLegalForm('sarl')).toBe('company');
    expect(kindOfLegalForm('foundation')).toBe('foundation');
    expect(legalFormOf('company', null)).toBe('company');
    expect(legalFormOf('company', 'sarl')).toBe('sarl');
    expect(legalFormOf('foundation', null)).toBe('foundation');
  });

  it('offers endowments only to foundations', () => {
    expect(classificationAllowed('foundation', 'endowment_received')).toBe(true);
    expect(classificationAllowed('company', 'endowment_received')).toBe(false);
    expect(classificationAllowed('company', 'donation_received')).toBe(true);
    expect(classificationAllowed('company', 'grant_paid')).toBe(true);
  });

  it('gives tax notes by legal form and tax status', () => {
    expect(taxNotes('company', 'ordinary').map((n) => n.text).join(' ')).toContain('8,5 %');
    const taxed = taxNotes('foundation', 'ordinary').map((n) => n.text).join(' ');
    expect(taxed).toContain('4,25 %');
    expect(taxed).toContain('CHF 5 000');
    expect(taxed).toContain('LIFD art. 66');
    expect(taxed).toContain('LHID art. 29 al. 2 let. c');
    const exempt = taxNotes('foundation', 'exempt').map((n) => n.text).join(' ');
    expect(exempt).toContain('LIFD art. 56 let. g');
    expect(exempt).not.toContain('4,25 %');
    expect(taxNotes('private', 'ordinary')).toEqual([]);
  });
});

describe('donations, endowments and grants', () => {
  it('books a received endowment to the foundation capital at market value and creates a lot', () => {
    const r = runAccounting([tx('e1', 'endowment_received', [mv('in', 'BTC', '1', '50000')], 1)], POLICY);
    expect(r.issues).toEqual([]);
    expect(r.results[0]!.acquisitions[0]).toMatchObject({ asset: 'BTC', costChf: '50000' });
    expect(postingsToLines(r.results[0]!.postings)).toEqual([{ debitKey: 'crypto_asset:BTC', creditKey: 'foundation_capital', amount: '50000.00' }]);
  });

  it('books a donation received as income', () => {
    const r = runAccounting([tx('d1', 'donation_received', [mv('in', 'ETH', '2', '6000')], 1)], POLICY);
    expect(postingsToLines(r.results[0]!.postings)).toEqual([{ debitKey: 'crypto_asset:ETH', creditKey: 'donation_income', amount: '6000.00' }]);
  });

  it('books a grant paid in crypto as an expense at market value and realises the gain', () => {
    const r = runAccounting([
      tx('e1', 'endowment_received', [mv('in', 'BTC', '1', '50000')], 1),
      tx('g1', 'grant_paid', [mv('out', 'BTC', '0.5', '30000'), mv('fee', 'BTC', '0.0001', '6')], 2),
    ], POLICY);
    expect(r.issues).toEqual([]);
    const grant = r.results[1]!;
    expect(grant.disposals[0]).toMatchObject({ proceedsChf: '30000', costChf: '25000', gainChf: '5000' });
    const byKey = (k: string) => grant.postings.filter((p) => p.key === k).reduce((a, p) => a.plus(p.amount), new D(0)).toString();
    expect(byKey('grants_expense')).toBe('30000');
    expect(byKey('crypto_asset:BTC')).toBe('-25005');
    // Realised gain: 5000 on the grant + 1 on the fee paid in BTC (6 CHF value, 5 CHF cost).
    expect(byKey('realized_gain')).toBe('-5001');
    // The on-chain fee of a grant is a network fee.
    expect(grant.postings.some((p) => p.key === 'network_fees')).toBe(true);
  });
});
