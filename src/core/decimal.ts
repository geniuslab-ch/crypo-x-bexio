import Decimal from 'decimal.js';

/** Dedicated Decimal constructor for accounting: high precision, half-up rounding to cents at the edges. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);

/** Parses a decimal string from a source file. Accepts "1'234.50", "1,234.50", "CHF 12.00", "$12.00", "-0.5". */
export function parseAmount(input: string | null | undefined): Dec | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === '') return null;
  // Remove currency symbols/codes and spaces, Swiss apostrophe thousands separators.
  s = s.replace(/[A-Za-z$€£¥\s']/g, '');
  // If both comma and dot exist, comma is a thousands separator.
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (s.includes(',')) {
    // Single comma: treat as decimal separator only when it looks like one ("12,5"), else thousands ("1,234").
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  return new D(s);
}

export function chf(d: Dec): string {
  return d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
}

export function sum(values: Dec[]): Dec {
  return values.reduce((a, b) => a.plus(b), ZERO);
}
