import { D, ZERO, type Dec } from '../decimal';
import type { Posting } from './engine';

export interface JournalLine {
  debitKey: string;
  creditKey: string;
  /** CHF, 2 decimals, always positive. */
  amount: string;
}

const RESULT_KEYS = new Set(['realized_gain', 'realized_loss']);

/**
 * Turns balanced postings into debit/credit pairs (one bexio line each), rounded to CHF cents.
 * Postings for the same key are netted first. After rounding, any cent difference is absorbed by the
 * realised gain/loss posting if present, otherwise by the largest posting — so every entry balances exactly.
 *
 * Cumulative rounding: when a `carry` map is passed (one per calculation, entries in chronological order), the
 * part lost to rounding on each account is carried into that account's next entry. The amounts booked on an
 * account then always add up to its exact full-precision total rounded to the cent (difference < 0.005 CHF
 * plus at most the cents moved to balance an entry), instead of drifting by up to half a cent per entry.
 * Example: 1000 staking rewards of 0.004 CHF are booked as 4.00 CHF in total, not 0.00. The map is updated.
 */
export function postingsToLines(postings: Posting[], carry?: Map<string, Dec>): JournalLine[] {
  const net = new Map<string, Dec>();
  for (const p of postings) net.set(p.key, (net.get(p.key) ?? ZERO).plus(p.amount));
  if (carry) for (const k of net.keys()) net.set(k, net.get(k)!.plus(carry.get(k) ?? ZERO));
  const rounded = new Map<string, Dec>();
  for (const [k, v] of net) {
    const r = v.toDecimalPlaces(2, D.ROUND_HALF_UP);
    if (!r.isZero()) rounded.set(k, r);
  }
  let diff = [...rounded.values()].reduce((a, b) => a.plus(b), ZERO);
  if (!diff.isZero()) {
    const target = [...rounded.keys()].find((k) => RESULT_KEYS.has(k))
      ?? [...rounded.entries()].sort((a, b) => b[1].abs().comparedTo(a[1].abs()))[0]?.[0];
    if (target) {
      const nv = rounded.get(target)!.minus(diff);
      if (nv.isZero()) rounded.delete(target);
      else rounded.set(target, nv);
      diff = ZERO;
    }
  }
  if (carry) for (const [k, v] of net) carry.set(k, v.minus(rounded.get(k) ?? ZERO));
  const debits = [...rounded.entries()].filter(([, v]) => v.isPositive()).map(([k, v]) => ({ k, v })).sort((a, b) => a.k.localeCompare(b.k));
  const credits = [...rounded.entries()].filter(([, v]) => v.isNegative()).map(([k, v]) => ({ k, v: v.neg() })).sort((a, b) => a.k.localeCompare(b.k));
  const lines: JournalLine[] = [];
  let i = 0;
  let j = 0;
  while (i < debits.length && j < credits.length) {
    const d = debits[i]!;
    const c = credits[j]!;
    const amt = D.min(d.v, c.v);
    lines.push({ debitKey: d.k, creditKey: c.k, amount: amt.toFixed(2) });
    d.v = d.v.minus(amt);
    c.v = c.v.minus(amt);
    if (d.v.isZero()) i++;
    if (c.v.isZero()) j++;
  }
  return lines;
}
