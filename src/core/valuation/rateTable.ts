import type { RateLookup, RateQuote } from './value';

export interface StoredRate {
  asset: string;
  /** Calendar date (Europe/Zurich) the rate applies to, YYYY-MM-DD. */
  rateDate: string;
  rate: string;
  source: string;
  sourceUrl: string | null;
}

const zurichFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date in Switzerland for a timestamp. Booking dates and daily rates use this date. */
export function zurichDate(d: Date): string {
  return zurichFmt.format(d);
}

/** Lookup over documented daily rates. Only an exact date match is used: no interpolation, no carrying forward. */
export function rateTableLookup(rates: StoredRate[]): RateLookup {
  const index = new Map<string, StoredRate>();
  for (const r of rates) index.set(`${r.asset}|${r.rateDate}`, r);
  return (asset, at): RateQuote | null => {
    const r = index.get(`${asset}|${zurichDate(at)}`);
    if (!r) return null;
    return { rate: r.rate, source: `rate_table:${r.source}`, ref: [r.source, r.rateDate, r.sourceUrl].filter(Boolean).join(' · ') };
  };
}

export function combineLookups(...lookups: RateLookup[]): RateLookup {
  return (asset, at) => {
    for (const l of lookups) {
      const q = l(asset, at);
      if (q) return q;
    }
    return null;
  };
}
