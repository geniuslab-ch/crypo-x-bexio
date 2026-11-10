import { isFiat } from '../assets';
import { D, ZERO, type Dec } from '../decimal';
import { BOOKABLE_CLASSIFICATIONS, type Classification } from '../types';
import type { ValuedMovement } from '../valuation/value';
import { cryptoAssetKey, fiatClearingKey } from './accountKeys';

export type CostBasisMethod = 'fifo' | 'wac';
export type FeeTreatment = 'capitalize' | 'expense';

export interface AccountingPolicy {
  method: CostBasisMethod;
  /** Trading fees on buys/swaps/sells: added to acquisition cost / deducted from proceeds, or expensed. */
  tradingFeeTreatment: FeeTreatment;
}

export interface AccountingTx {
  id: string;
  occurredAt: Date;
  classification: Classification;
  movements: ValuedMovement[];
}

export interface LotAllocation {
  lotId: string;
  quantity: string;
  cost: string;
}

export interface Disposal {
  txId: string;
  asset: string;
  quantity: string;
  proceedsChf: string;
  costChf: string;
  gainChf: string;
  kind: 'principal' | 'fee';
  allocations: LotAllocation[];
}

export interface Acquisition {
  txId: string;
  lotId: string;
  asset: string;
  quantity: string;
  costChf: string;
  acquiredAt: Date;
}

export interface Posting {
  key: string;
  /** Positive = debit, negative = credit. Full precision. */
  amount: Dec;
}

export interface TxResult {
  txId: string;
  acquisitions: Acquisition[];
  disposals: Disposal[];
  postings: Posting[];
  realizedGain: Dec;
}

export type IssueCode = 'insufficient_lots' | 'missing_rate' | 'not_bookable' | 'needs_review';

export interface EngineIssue {
  txId: string;
  code: IssueCode;
  message: string;
}

export interface HoldingLot {
  lotId: string;
  asset: string;
  acquiredAt: Date;
  quantity: Dec;
  remaining: Dec;
  cost: Dec;
  /** Remaining cost (FIFO: proportional to remaining quantity; WAC: pooled). */
  remainingCost: Dec;
}

export interface EngineResult {
  results: TxResult[];
  issues: EngineIssue[];
  holdings: Map<string, { quantity: Dec; cost: Dec; lots: HoldingLot[] }>;
}

const FEE_CAPITALIZABLE = new Set<Classification>(['buy', 'swap', 'sell']);
const NETWORK_FEE_CONTEXT = new Set<Classification>(['deposit', 'withdrawal', 'internal_transfer', 'network_fee']);

const COUNTERPART: Partial<Record<Classification, { key: string; side: 'in' | 'out' }>> = {
  fiat_deposit: { key: 'bank_clearing', side: 'in' },
  fiat_withdrawal: { key: 'bank_clearing', side: 'out' },
  deposit: { key: 'external_deposit_counterpart', side: 'in' },
  withdrawal: { key: 'external_withdrawal_counterpart', side: 'out' },
  staking_reward: { key: 'staking_income', side: 'in' },
  mining_reward: { key: 'mining_income', side: 'in' },
  airdrop: { key: 'airdrop_income', side: 'in' },
  lending_interest: { key: 'lending_income', side: 'in' },
};

interface Pool {
  lots: HoldingLot[];
}

/**
 * Runs the cost-basis engine over transactions in chronological order and produces balanced postings.
 * Pure and deterministic: the same input always yields the same output.
 * Pooling: one pool per asset across all sources (own-wallet transfers do not change the pool).
 */
export function runAccounting(txsIn: AccountingTx[], policy: AccountingPolicy): EngineResult {
  const txs = [...txsIn].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const pools = new Map<string, Pool>();
  const results: TxResult[] = [];
  const issues: EngineIssue[] = [];
  const blockedAssets = new Set<string>();
  let lotSeq = 0;

  const pool = (asset: string) => {
    let p = pools.get(asset);
    if (!p) {
      p = { lots: [] };
      pools.set(asset, p);
    }
    return p;
  };

  for (const tx of txs) {
    if (!BOOKABLE_CLASSIFICATIONS.has(tx.classification)) {
      issues.push({ txId: tx.id, code: 'not_bookable', message: `"${tx.classification}" transactions are not booked automatically in Phase 1` });
      continue;
    }
    const isTransfer = tx.classification === 'internal_transfer';
    const needed = tx.movements.filter((m) => !(isTransfer && m.direction !== 'fee'));
    const unvalued = needed.filter((m) => m.chfValue === null);
    if (unvalued.length > 0) {
      issues.push({ txId: tx.id, code: 'missing_rate', message: `No documented CHF rate for ${[...new Set(unvalued.map((m) => m.asset))].join(', ')}` });
      continue;
    }

    const capitalize = policy.tradingFeeTreatment === 'capitalize' && FEE_CAPITALIZABLE.has(tx.classification);
    const feeKey = NETWORK_FEE_CONTEXT.has(tx.classification) ? 'network_fees' : 'trading_fees';
    const fees = tx.movements.filter((m) => m.direction === 'fee');
    const feeTotal = fees.reduce((a, m) => a.plus(m.chfValue!), ZERO);
    const postings: Posting[] = [];
    const acquisitions: Acquisition[] = [];
    const disposals: Disposal[] = [];
    let txBlocked = false;

    // 1. Fiat legs move fiat clearing balances.
    for (const m of tx.movements) {
      if (!isFiat(m.asset)) continue;
      const v = new D(m.chfValue!);
      if (m.direction === 'in') postings.push({ key: fiatClearingKey(m.asset), amount: v });
      else postings.push({ key: fiatClearingKey(m.asset), amount: v.neg() });
    }

    // 2. Acquisitions (crypto in), before disposals so a fee paid in the acquired asset can use the new lot.
    if (!isTransfer) {
      const cryptoIns = tx.movements.filter((m) => m.direction === 'in' && !isFiat(m.asset));
      cryptoIns.forEach((m, idx) => {
        let cost = new D(m.chfValue!);
        if (capitalize && tx.classification !== 'sell' && idx === 0) cost = cost.plus(feeTotal);
        const lotId = `${tx.id}#${++lotSeq}`;
        const qty = new D(m.quantity);
        addLot(pool(m.asset), { lotId, asset: m.asset, acquiredAt: tx.occurredAt, quantity: qty, remaining: qty, cost, remainingCost: cost }, policy.method);
        acquisitions.push({ txId: tx.id, lotId, asset: m.asset, quantity: qty.toString(), costChf: cost.toString(), acquiredAt: tx.occurredAt });
        postings.push({ key: cryptoAssetKey(m.asset), amount: cost });
      });
    }

    // 3. Disposals: principal crypto out legs, then crypto fee legs.
    const disposeLegs: { m: ValuedMovement; kind: 'principal' | 'fee'; proceeds: Dec }[] = [];
    if (!isTransfer) {
      const cryptoOuts = tx.movements.filter((m) => m.direction === 'out' && !isFiat(m.asset));
      cryptoOuts.forEach((m, idx) => {
        let proceeds = new D(m.chfValue!);
        if (capitalize && tx.classification === 'sell' && idx === 0) proceeds = proceeds.minus(feeTotal);
        disposeLegs.push({ m, kind: 'principal', proceeds });
      });
    }
    for (const f of fees) if (!isFiat(f.asset)) disposeLegs.push({ m: f, kind: 'fee', proceeds: new D(f.chfValue!) });

    for (const { m, kind, proceeds } of disposeLegs) {
      if (blockedAssets.has(m.asset)) {
        issues.push({ txId: tx.id, code: 'insufficient_lots', message: `${m.asset}: earlier history is incomplete, results for this asset are blocked` });
        txBlocked = true;
        continue;
      }
      const qty = new D(m.quantity);
      const taken = takeFromPool(pool(m.asset), qty, policy.method);
      if (!taken) {
        const available = pool(m.asset).lots.reduce((a, l) => a.plus(l.remaining), ZERO);
        issues.push({
          txId: tx.id,
          code: 'insufficient_lots',
          message: `${m.asset}: disposing ${qty.toString()} but only ${available.toString()} acquired before this date. An earlier purchase or transfer is probably missing from the imports.`,
        });
        blockedAssets.add(m.asset);
        txBlocked = true;
        continue;
      }
      const gain = proceeds.minus(taken.cost);
      disposals.push({
        txId: tx.id, asset: m.asset, quantity: qty.toString(), proceedsChf: proceeds.toString(), costChf: taken.cost.toString(),
        gainChf: gain.toString(), kind, allocations: taken.allocations,
      });
      postings.push({ key: cryptoAssetKey(m.asset), amount: taken.cost.neg() });
    }
    if (txBlocked) continue;

    // 4. Fee expense (unless capitalised).
    if (!capitalize) for (const f of fees) postings.push({ key: feeKey, amount: new D(f.chfValue!) });

    // 5. Counterpart for one-sided transactions.
    const cp = COUNTERPART[tx.classification];
    if (cp) {
      const legs = tx.movements.filter((m) => m.direction === cp.side);
      const total = legs.reduce((a, m) => a.plus(m.chfValue!), ZERO);
      postings.push({ key: cp.key, amount: cp.side === 'in' ? total.neg() : total });
    }

    // 6. Realised result balances the entry. It must equal the sum of disposal gains (self-check).
    const realizedGain = disposals.reduce((a, d) => a.plus(d.gainChf), ZERO);
    const imbalance = postings.reduce((a, p) => a.plus(p.amount), ZERO);
    if (!imbalance.plus(realizedGain.neg()).abs().lte('1e-18')) {
      throw new Error(`Accounting invariant violated for ${tx.id}: postings ${imbalance.toString()} vs gain ${realizedGain.toString()}`);
    }
    if (!realizedGain.isZero()) {
      postings.push({ key: realizedGain.isPositive() ? 'realized_gain' : 'realized_loss', amount: realizedGain.neg() });
    }
    results.push({ txId: tx.id, acquisitions, disposals, postings, realizedGain });
  }

  const holdings = new Map<string, { quantity: Dec; cost: Dec; lots: HoldingLot[] }>();
  for (const [asset, p] of pools) {
    const lots = p.lots.filter((l) => l.remaining.gt(0));
    holdings.set(asset, {
      quantity: lots.reduce((a, l) => a.plus(l.remaining), ZERO),
      cost: lots.reduce((a, l) => a.plus(l.remainingCost), ZERO),
      lots,
    });
  }
  return { results, issues, holdings };
}

function addLot(p: Pool, lot: HoldingLot, method: CostBasisMethod) {
  if (method === 'wac' && p.lots.length > 0) {
    // Weighted average: a single pooled lot per asset.
    const pooled = p.lots[0]!;
    pooled.remaining = pooled.remaining.plus(lot.quantity);
    pooled.quantity = pooled.quantity.plus(lot.quantity);
    pooled.remainingCost = pooled.remainingCost.plus(lot.cost);
    pooled.cost = pooled.cost.plus(lot.cost);
    return;
  }
  p.lots.push(lot);
}

function takeFromPool(p: Pool, qty: Dec, method: CostBasisMethod): { cost: Dec; allocations: LotAllocation[] } | null {
  const available = p.lots.reduce((a, l) => a.plus(l.remaining), ZERO);
  if (available.lt(qty)) return null;
  let left = qty;
  let cost = ZERO;
  const allocations: LotAllocation[] = [];
  for (const lot of p.lots) {
    if (left.isZero()) break;
    if (lot.remaining.isZero()) continue;
    const take = D.min(left, lot.remaining);
    // Cost of the part taken, proportional to the lot's remaining cost (FIFO) or the pool average (WAC).
    const partCost = take.eq(lot.remaining) ? lot.remainingCost : lot.remainingCost.times(take).div(lot.remaining);
    lot.remaining = lot.remaining.minus(take);
    lot.remainingCost = lot.remainingCost.minus(partCost);
    cost = cost.plus(partCost);
    left = left.minus(take);
    allocations.push({ lotId: lot.lotId, quantity: take.toString(), cost: partCost.toString() });
    if (method === 'wac') break;
  }
  return { cost, allocations };
}
