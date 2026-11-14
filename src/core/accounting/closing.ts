import { D, ZERO, type Dec } from '../decimal';
import type { JournalLine } from './journal';

/**
 * Year-end valuation of crypto assets (pure).
 *
 * - `lower_of_cost`: lowest value principle (CO art. 960 al. 2): an asset whose market value at the balance sheet date
 *   is below its book value is written down; nothing is booked when the market value is higher.
 * - `market`: valuation at the observable market price (CO art. 960b, assets with a quoted price on an active market):
 *   the book value is adjusted up or down to the market value.
 *
 * The valuation entry is dated on the closing date and reversed on the first day of the next year, so that the cost
 * basis used for realised results stays the acquisition cost and the next closing starts again from cost.
 */
export const VALUATION_METHODS = ['lower_of_cost', 'market'] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

/** Which CHF value per unit is used at 31.12: the documented market rate, or the official ESTV/AFC tax value. */
export const RATE_BASES = ['market_rate', 'tax_value'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

export interface ValuationInput {
  key: string;
  asset: string;
  /** Quantity held on this account at the closing date. */
  quantity: string;
  /** Balance of the account in the books at the closing date (CHF, as booked). */
  bookValue: string;
  /** CHF per unit at the closing date, or null when no documented value exists. */
  rate: string | null;
  rateSource: string | null;
}

export interface ValuationRow extends ValuationInput {
  marketValue: string | null;
  /** Positive = write-up, negative = write-down, 2 decimals. */
  adjustment: string;
}

export function valuationRows(inputs: ValuationInput[], method: ValuationMethod): { rows: ValuationRow[]; missing: string[] } {
  const rows: ValuationRow[] = [];
  const missing: string[] = [];
  for (const i of inputs) {
    if (i.rate === null) {
      missing.push(i.asset);
      rows.push({ ...i, marketValue: null, adjustment: '0.00' });
      continue;
    }
    const market = new D(i.rate).times(i.quantity).toDecimalPlaces(2, D.ROUND_HALF_UP);
    const book = new D(i.bookValue);
    let adj = market.minus(book);
    if (method === 'lower_of_cost' && adj.isPositive()) adj = ZERO;
    rows.push({ ...i, marketValue: market.toFixed(2), adjustment: adj.toFixed(2) });
  }
  return { rows, missing: [...new Set(missing)].sort() };
}

/** Lines of the valuation entry (31.12). The reversal (1.1) uses the same lines with debit and credit swapped. */
export function valuationLines(rows: ValuationRow[]): JournalLine[] {
  const lines: JournalLine[] = [];
  for (const r of rows) {
    const a: Dec = new D(r.adjustment);
    if (a.isZero()) continue;
    if (a.isNegative()) lines.push({ debitKey: 'valuation_loss', creditKey: r.key, amount: a.neg().toFixed(2) });
    else lines.push({ debitKey: r.key, creditKey: 'valuation_gain', amount: a.toFixed(2) });
  }
  return lines;
}

export function reversalLines(lines: JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ debitKey: l.creditKey, creditKey: l.debitKey, amount: l.amount }));
}

/**
 * Book value per crypto account at a date, from booked journal lines (what bexio holds when everything is synced).
 * `lines` are the lines of all non-superseded entries dated on or before that date.
 */
export function bookBalances(lines: { debitKey: string; creditKey: string; amountChf: string }[]): Map<string, Dec> {
  const m = new Map<string, Dec>();
  const add = (k: string, v: Dec) => m.set(k, (m.get(k) ?? ZERO).plus(v));
  for (const l of lines) {
    add(l.debitKey, new D(l.amountChf));
    add(l.creditKey, new D(l.amountChf).neg());
  }
  return m;
}

/** End of a calendar year in Switzerland (exclusive bound: 1 January of the next year, 00:00 Europe/Zurich). */
export function yearEndExclusive(year: number): Date {
  // 1 January is always in winter time (UTC+1).
  return new Date(Date.UTC(year + 1, 0, 1, -1, 0, 0));
}

/**
 * Timestamp of an opening balance carried forward into `year`: the last instant of 31.12 of the previous year
 * (Europe/Zurich), so it is booked before every transaction of the new year.
 */
export function openingBalanceInstant(year: number): Date {
  return new Date(yearEndExclusive(year - 1).getTime() - 1);
}

export function isValuationMethod(v: unknown): v is ValuationMethod {
  return typeof v === 'string' && (VALUATION_METHODS as readonly string[]).includes(v);
}

export function isRateBasis(v: unknown): v is RateBasis {
  return typeof v === 'string' && (RATE_BASES as readonly string[]).includes(v);
}
