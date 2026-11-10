import { isFiat } from '../assets';
import { D, type Dec } from '../decimal';
import type { Classification, Movement } from '../types';

export interface RateQuote {
  /** CHF per 1 unit of the asset. */
  rate: string;
  /** Machine-readable source, e.g. "rate_table:ESTV Kursliste", "coingecko". */
  source: string;
  /** Human reference: URL, document, date of the quote. */
  ref: string;
}

/** Synchronous lookup of a documented CHF rate for an asset at a point in time. Returns null if none is known. */
export type RateLookup = (asset: string, at: Date) => RateQuote | null;

export interface ValuedMovement extends Movement {
  chfRate: string | null;
  chfValue: string | null;
  rateSource: string | null;
  rateRef: string | null;
}

export interface ValuationResult {
  movements: ValuedMovement[];
  /** Assets for which no documented rate exists at this date. Entry generation is blocked until resolved. */
  missing: string[];
}

export interface ValuableTx {
  occurredAt: Date;
  classification: Classification;
  movements: Movement[];
  sourceChfValue?: string | null;
}

interface Val { rate: Dec; value: Dec; source: string; ref: string }

function fromQuote(q: RateQuote, qty: Dec): Val {
  const rate = new D(q.rate);
  return { rate, value: rate.times(qty), source: q.source, ref: q.ref };
}

/**
 * Determines the CHF value of every movement, in this order of evidence:
 *  1. CHF counter-leg of the same trade (exact, "trade_implied")
 *  2. CHF value stated in the source file ("source_file")
 *  3. Another fiat counter-leg converted with a documented fiat rate
 *  4. Documented crypto rate (rate table / provider)
 * Nothing is ever estimated: when no evidence exists the asset is reported as missing.
 */
export function valueTransaction(tx: ValuableTx, lookup: RateLookup): ValuationResult {
  const vals = new Map<Movement, Val>();
  const missing = new Set<string>();
  const at = tx.occurredAt;
  const ins = tx.movements.filter((m) => m.direction === 'in');
  const outs = tx.movements.filter((m) => m.direction === 'out');
  const fees = tx.movements.filter((m) => m.direction === 'fee');
  const qty = (m: Movement) => new D(m.quantity);

  const valueDirect = (m: Movement): Val | null => {
    if (m.asset === 'CHF') return { rate: new D(1), value: qty(m), source: 'fiat_chf', ref: 'CHF' };
    const q = lookup(m.asset, at);
    return q ? fromQuote(q, qty(m)) : null;
  };

  // Fiat legs first: they are the evidence for the crypto legs.
  for (const m of [...ins, ...outs]) {
    if (!isFiat(m.asset)) continue;
    const v = valueDirect(m);
    if (v) vals.set(m, v);
    else missing.add(m.asset);
  }

  const cryptoIns = ins.filter((m) => !isFiat(m.asset));
  const cryptoOuts = outs.filter((m) => !isFiat(m.asset));
  const fiatLegs = [...ins, ...outs].filter((m) => isFiat(m.asset));

  if (cryptoIns.length + cryptoOuts.length === 1 && fiatLegs.length === 1) {
    // Buy or sell: the fiat leg's CHF value is the crypto leg's CHF value.
    const crypto = (cryptoIns[0] ?? cryptoOuts[0])!;
    const fiatVal = vals.get(fiatLegs[0]!);
    if (fiatVal) {
      const fiatAsset = fiatLegs[0]!.asset;
      vals.set(crypto, {
        rate: fiatVal.value.div(qty(crypto)),
        value: fiatVal.value,
        source: fiatAsset === 'CHF' ? 'trade_implied' : `trade_implied_via_${fiatAsset}`,
        ref: fiatAsset === 'CHF' ? 'CHF amount of the same trade' : `${fiatAsset} amount of the same trade × ${fiatVal.source}`,
      });
    }
  } else if (cryptoIns.length + cryptoOuts.length >= 1) {
    const principal = cryptoIns.length === 1 ? cryptoIns[0]! : cryptoOuts.length === 1 && cryptoIns.length === 0 ? cryptoOuts[0]! : null;
    if (tx.sourceChfValue && principal) {
      const value = new D(tx.sourceChfValue);
      vals.set(principal, { rate: value.div(qty(principal)), value, source: 'source_file', ref: 'CHF value stated in the imported file' });
    }
    if (cryptoIns.length === 1 && cryptoOuts.length === 1) {
      // Swap: both legs carry the same CHF value. Prefer the received asset's rate, else the given asset's.
      const inLeg = cryptoIns[0]!;
      const outLeg = cryptoOuts[0]!;
      const anchor = vals.get(inLeg) ?? valueDirect(inLeg) ?? valueDirect(outLeg);
      if (anchor) {
        const v = anchor.value;
        const note = `swap valued at ${anchor.source}`;
        vals.set(inLeg, { rate: v.div(qty(inLeg)), value: v, source: anchor.source, ref: `${anchor.ref} (${note})` });
        vals.set(outLeg, { rate: v.div(qty(outLeg)), value: v, source: anchor.source, ref: `${anchor.ref} (${note})` });
      }
    } else {
      for (const m of [...cryptoIns, ...cryptoOuts]) {
        if (vals.has(m)) continue;
        const v = valueDirect(m);
        if (v) vals.set(m, v);
      }
    }
  }

  // Fees: reuse the implied rate of a leg in the same asset, else look up.
  for (const f of fees) {
    const sameAsset = [...ins, ...outs].find((m) => m.asset === f.asset && vals.has(m));
    if (sameAsset) {
      const base = vals.get(sameAsset)!;
      vals.set(f, { rate: base.rate, value: base.rate.times(qty(f)), source: base.source, ref: base.ref });
    } else {
      const v = valueDirect(f);
      if (v) vals.set(f, v);
    }
  }

  // Principal legs of an internal transfer need no value; everything else does.
  for (const m of tx.movements) {
    if (vals.has(m)) continue;
    if (tx.classification === 'internal_transfer' && m.direction !== 'fee') continue;
    missing.add(m.asset);
  }

  return {
    movements: tx.movements.map((m) => {
      const v = vals.get(m);
      return {
        ...m,
        chfRate: v ? v.rate.toString() : null,
        chfValue: v ? v.value.toString() : null,
        rateSource: v?.source ?? null,
        rateRef: v?.ref ?? null,
      };
    }),
    missing: [...missing],
  };
}
