import { resolveMapping } from '@/core/accounting/accountKeys';
import type { ManualEntryRequest } from './client';

export interface EntryForSync {
  entryDate: string;
  referenceNr: string;
  description: string;
  lines: { debitKey: string; creditKey: string; amountChf: string; description: string }[];
}

export interface MappedAccount {
  bexioAccountId: number;
  isActive: boolean;
  accountNo: string;
  /** VAT code chosen for this account (optional). */
  taxId?: number | null;
  /** The VAT code is no longer active in bexio (deleted or deactivated). */
  taxInactive?: boolean;
}

export interface BusinessYear {
  start: string;
  end: string;
  status: string;
}

export type PayloadResult = { ok: true; payload: ManualEntryRequest } | { ok: false; reason: string };

/**
 * Builds the bexio manual-entry request for one Crypto2Books entry.
 * All amounts are posted in CHF (company base currency, currency_factor 1). A line gets a VAT code only when the
 * account on one of its sides has one in the mapping (the company's own bexio codes); otherwise none is set.
 */
export function buildManualEntry(
  entry: EntryForSync,
  mappings: Map<string, MappedAccount>,
  chfCurrencyId: number,
  businessYears: BusinessYear[],
): PayloadResult {
  const year = businessYears.find((y) => y.start <= entry.entryDate && entry.entryDate <= y.end);
  if (!year) return { ok: false, reason: `No bexio business year covers ${entry.entryDate}` };
  if (year.status !== 'open') return { ok: false, reason: `bexio business year ${year.start}–${year.end} is "${year.status}"` };

  const missing = new Set<string>();
  const inactive = new Set<string>();
  const resolve = (key: string) => {
    const m = resolveMapping(key, mappings);
    if (!m) missing.add(key);
    else if (!m.isActive) inactive.add(`${key} → ${m.accountNo}`);
    return m;
  };
  const vatConflicts: string[] = [];
  const vatInactive = new Set<string>();
  const entries = entry.lines.map((l) => {
    const d = resolve(l.debitKey);
    const c = resolve(l.creditKey);
    for (const m of [d, c]) if (m?.taxId != null && m.taxInactive) vatInactive.add(m.accountNo);
    const taxes = [...new Set([d?.taxId, c?.taxId].filter((x): x is number => typeof x === 'number'))];
    if (taxes.length > 1) vatConflicts.push(`${d?.accountNo} / ${c?.accountNo}`);
    return {
      debit_account_id: d?.bexioAccountId ?? 0,
      credit_account_id: c?.bexioAccountId ?? 0,
      amount: Number(l.amountChf),
      description: l.description,
      currency_id: chfCurrencyId,
      currency_factor: 1,
      ...(taxes.length === 1 ? { tax_id: taxes[0] } : {}),
    };
  });
  if (vatConflicts.length) return { ok: false, reason: `Two different VAT codes on one line (accounts ${vatConflicts.join(', ')}): keep a VAT code on one side only` };
  if (vatInactive.size) return { ok: false, reason: `VAT code no longer active in bexio for account(s) ${[...vatInactive].join(', ')}: choose another code or none on the bexio page` };
  if (missing.size) return { ok: false, reason: `Account mapping missing for: ${[...missing].join(', ')}` };
  if (inactive.size) return { ok: false, reason: `Mapped bexio account inactive: ${[...inactive].join(', ')}` };
  if (entries.some((e) => !(e.amount > 0))) return { ok: false, reason: 'Entry contains a non-positive amount' };
  if (entry.referenceNr.length > 80) return { ok: false, reason: 'reference_nr longer than 80 characters' };
  return {
    ok: true,
    payload: {
      type: entries.length === 1 ? 'manual_single_entry' : 'manual_group_entry',
      date: entry.entryDate,
      reference_nr: entry.referenceNr,
      entries,
    },
  };
}
