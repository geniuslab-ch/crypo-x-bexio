import { isFiat } from '../assets';
import { D, ZERO, type Dec } from '../decimal';
import { DEFI_EXCHANGE_CLASSIFICATIONS } from '../defi';
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
  /**
   * Wallet (source id) when the source has its own crypto account; empty = the common pool. Only set when the user
   * chose per-wallet accounts, so existing calculations are unchanged otherwise.
   */
  wallet?: string | null;
  /** Sending side of a matched transfer to another of the user's wallets: where the units go and how many arrive. */
  transferTo?: { wallet: string | null; receivedQuantity: string } | null;
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

export type IssueCode = 'insufficient_lots' | 'missing_rate' | 'not_bookable' | 'needs_review' | 'period_closed';

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
  /** Holdings per crypto account key (crypto_asset:BTC or crypto_asset:BTC@<wallet>), for year-end valuation. */
  pools: PoolHolding[];
}

export interface PoolHolding {
  key: string;
  asset: string;
  wallet: string | null;
  quantity: Dec;
  cost: Dec;
}

const FEE_CAPITALIZABLE = new Set<Classification>(['buy', 'swap', 'sell', 'defi', 'liquidity_pool']);
const NETWORK_FEE_CONTEXT = new Set<Classification>(['deposit', 'withdrawal', 'internal_transfer', 'network_fee', 'donation_received', 'endowment_received', 'grant_paid']);

const COUNTERPART: Partial<Record<Classification, { key: string; side: 'in' | 'out' }>> = {
  fiat_deposit: { key: 'bank_clearing', side: 'in' },
  fiat_withdrawal: { key: 'bank_clearing', side: 'out' },
  deposit: { key: 'external_deposit_counterpart', side: 'in' },
  withdrawal: { key: 'external_withdrawal_counterpart', side: 'out' },
  staking_reward: { key: 'staking_income', side: 'in' },
  mining_reward: { key: 'mining_income', side: 'in' },
  airdrop: { key: 'airdrop_income', side: 'in' },
  lending_interest: { key: 'lending_income', side: 'in' },
  // Gifts are valued at the market value of the day: a donation received creates a lot at that value; a grant paid
  // in crypto is a disposal at market value (realised gain/loss) and an expense of the same amount.
  donation_received: { key: 'donation_income', side: 'in' },
  endowment_received: { key: 'foundation_capital', side: 'in' },
  grant_paid: { key: 'grants_expense', side: 'out' },
};

interface Pool {
  lots: HoldingLot[];
  asset: string;
  wallet: string | null;
}

/**
 * Runs the cost-basis engine over transactions in chronological order and produces balanced postings.
 * Pure and deterministic: the same input always yields the same output.
 * Pooling: one pool per asset across all sources (own-wallet transfers do not change the pool), except for sources
 * with their own crypto account: they keep their own lots, and a transfer between two pools moves the lots (at their
 * cost and acquisition date) and books the cost from one wallet account to the other. No gain arises on a transfer.
 */
export function runAccounting(txsIn: AccountingTx[], policy: AccountingPolicy): EngineResult {
  const txs = [...txsIn].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const pools = new Map<string, Pool>();
  const results: TxResult[] = [];
  const issues: EngineIssue[] = [];
  const blockedAssets = new Set<string>();
  let lotSeq = 0;

  const pool = (asset: string, wallet?: string | null) => {
    const k = `${asset}\u0000${wallet ?? ''}`;
    let p = pools.get(k);
    if (!p) {
      p = { lots: [], asset, wallet: wallet ?? null };
      pools.set(k, p);
    }
    return p;
  };

  for (const tx of txs) {
    if (!BOOKABLE_CLASSIFICATIONS.has(tx.classification)) {
      issues.push({ txId: tx.id, code: 'not_bookable', message: `Les transactions « ${tx.classification} » ne sont pas comptabilisées automatiquement en phase 1` });
      continue;
    }
    if (tx.classification === 'opening_balance') {
      // Balance carried forward from books kept before Crypto2Books: it is already in the opening balance sheet in
      // bexio, so it creates lots (quantity and acquisition cost) but no booking.
      const acquisitions: Acquisition[] = [];
      let missing = false;
      for (const m of tx.movements) {
        if (m.direction !== 'in' || isFiat(m.asset)) continue;
        if (m.chfValue === null) { missing = true; continue; }
        const lotId = `${tx.id}#${++lotSeq}`;
        const qty = new D(m.quantity);
        const cost = new D(m.chfValue);
        addLot(pool(m.asset, tx.wallet), { lotId, asset: m.asset, acquiredAt: tx.occurredAt, quantity: qty, remaining: qty, cost, remainingCost: cost }, policy.method);
        acquisitions.push({ txId: tx.id, lotId, asset: m.asset, quantity: qty.toString(), costChf: cost.toString(), acquiredAt: tx.occurredAt });
      }
      if (missing) issues.push({ txId: tx.id, code: 'missing_rate', message: 'Solde d’ouverture sans coût d’acquisition CHF' });
      results.push({ txId: tx.id, acquisitions, disposals: [], postings: [], realizedGain: ZERO });
      continue;
    }
    const isExchange = DEFI_EXCHANGE_CLASSIFICATIONS.has(tx.classification);
    if (isExchange && !(tx.movements.some((m) => m.direction === 'in') && tx.movements.some((m) => m.direction === 'out' && !isFiat(m.asset)))) {
      issues.push({ txId: tx.id, code: 'not_bookable', message: 'Une opération DeFi est un échange : il faut au moins un actif remis et un actif reçu. Reclassez-la (récompense, dépôt, retrait...)' });
      continue;
    }
    const isTransfer = tx.classification === 'internal_transfer';
    const needed = tx.movements.filter((m) => !(isTransfer && m.direction !== 'fee'));
    const unvalued = needed.filter((m) => m.chfValue === null);
    if (unvalued.length > 0) {
      issues.push({ txId: tx.id, code: 'missing_rate', message: `Aucun cours CHF documenté pour ${[...new Set(unvalued.map((m) => m.asset))].join(', ')}` });
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
        addLot(pool(m.asset, tx.wallet), { lotId, asset: m.asset, acquiredAt: tx.occurredAt, quantity: qty, remaining: qty, cost, remainingCost: cost }, policy.method);
        acquisitions.push({ txId: tx.id, lotId, asset: m.asset, quantity: qty.toString(), costChf: cost.toString(), acquiredAt: tx.occurredAt });
        postings.push({ key: cryptoAssetKey(m.asset, tx.wallet), amount: cost });
      });
    }

    // 2b. Transfer to another pool (per-wallet accounts): move lots at cost, no gain.
    if (isTransfer && tx.transferTo && (tx.transferTo.wallet ?? '') !== (tx.wallet ?? '')) {
      const outs = tx.movements.filter((m) => m.direction === 'out' && !isFiat(m.asset));
      for (const m of outs) {
        if (blockedAssets.has(m.asset)) {
          issues.push({ txId: tx.id, code: 'insufficient_lots', message: `${m.asset} : historique antérieur incomplet, résultats bloqués pour cet actif` });
          txBlocked = true;
          continue;
        }
        // Only what arrives is moved. The rest of the sent quantity is the transfer fee (recorded by the source or
        // derived from the gap), which is disposed from the sending wallet with the other fee legs below.
        const sent = new D(m.quantity);
        const qty = D.min(new D(tx.transferTo.receivedQuantity), sent);
        const from = pool(m.asset, tx.wallet);
        const moved = takeLots(from, qty);
        if (!moved) {
          const available = from.lots.reduce((a, l) => a.plus(l.remaining), ZERO);
          issues.push({ txId: tx.id, code: 'insufficient_lots', message: `${m.asset} : transfert de ${qty.toString()} depuis un wallet qui n’en détient que ${available.toString()} à cette date. Un achat ou un transfert antérieur vers ce wallet manque probablement.` });
          blockedAssets.add(m.asset);
          txBlocked = true;
          continue;
        }
        const to = pool(m.asset, tx.transferTo.wallet);
        let cost = ZERO;
        for (const part of moved) {
          addLot(to, { lotId: `${part.lotId}>${tx.id}`, asset: m.asset, acquiredAt: part.acquiredAt, quantity: part.quantity, remaining: part.quantity, cost: part.cost, remainingCost: part.cost }, policy.method);
          cost = cost.plus(part.cost);
        }
        postings.push({ key: cryptoAssetKey(m.asset, tx.transferTo.wallet), amount: cost });
        postings.push({ key: cryptoAssetKey(m.asset, tx.wallet), amount: cost.neg() });
      }
    }

    // 3. Disposals: principal crypto out legs, then crypto fee legs.
    const disposeLegs: { m: ValuedMovement; kind: 'principal' | 'fee'; proceeds: Dec }[] = [];
    if (!isTransfer) {
      const cryptoOuts = tx.movements.filter((m) => m.direction === 'out' && !isFiat(m.asset));
      // DeFi exchange: the assets given are disposed of at the value of what is received (each leg valued on its
      // own may differ slightly), shared in proportion of their own values.
      const sum = (ms: ValuedMovement[]) => ms.reduce((a, m) => a.plus(m.chfValue!), ZERO);
      const outValue = sum(cryptoOuts);
      const target = isExchange ? sum(tx.movements.filter((m) => m.direction === 'in')).minus(sum(tx.movements.filter((m) => m.direction === 'out' && isFiat(m.asset)))) : null;
      let allocated = ZERO;
      cryptoOuts.forEach((m, idx) => {
        let proceeds = new D(m.chfValue!);
        if (target) {
          proceeds = idx === cryptoOuts.length - 1 ? target.minus(allocated)
            : outValue.isZero() ? ZERO : target.times(m.chfValue!).div(outValue).toDecimalPlaces(10);
          allocated = allocated.plus(proceeds);
        }
        if (capitalize && tx.classification === 'sell' && idx === 0) proceeds = proceeds.minus(feeTotal);
        disposeLegs.push({ m, kind: 'principal', proceeds });
      });
    }
    for (const f of fees) if (!isFiat(f.asset)) disposeLegs.push({ m: f, kind: 'fee', proceeds: new D(f.chfValue!) });

    for (const { m, kind, proceeds } of disposeLegs) {
      if (blockedAssets.has(m.asset)) {
        issues.push({ txId: tx.id, code: 'insufficient_lots', message: `${m.asset} : historique antérieur incomplet, résultats bloqués pour cet actif` });
        txBlocked = true;
        continue;
      }
      const qty = new D(m.quantity);
      const taken = takeFromPool(pool(m.asset, tx.wallet), qty, policy.method);
      if (!taken) {
        const available = pool(m.asset, tx.wallet).lots.reduce((a, l) => a.plus(l.remaining), ZERO);
        issues.push({
          txId: tx.id,
          code: 'insufficient_lots',
          message: `${m.asset} : cession de ${qty.toString()} alors que seuls ${available.toString()} ont été acquis avant cette date. Un achat ou un transfert antérieur manque probablement dans les imports.`,
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
      postings.push({ key: cryptoAssetKey(m.asset, tx.wallet), amount: taken.cost.neg() });
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
  const poolHoldings: PoolHolding[] = [];
  for (const p of pools.values()) {
    const lots = p.lots.filter((l) => l.remaining.gt(0));
    if (lots.length > 0) {
      poolHoldings.push({
        key: cryptoAssetKey(p.asset, p.wallet), asset: p.asset, wallet: p.wallet,
        quantity: lots.reduce((a, l) => a.plus(l.remaining), ZERO), cost: lots.reduce((a, l) => a.plus(l.remainingCost), ZERO),
      });
    }
    const h = holdings.get(p.asset) ?? { quantity: ZERO, cost: ZERO, lots: [] };
    holdings.set(p.asset, {
      quantity: lots.reduce((a, l) => a.plus(l.remaining), h.quantity),
      cost: lots.reduce((a, l) => a.plus(l.remainingCost), h.cost),
      lots: [...h.lots, ...lots],
    });
  }
  poolHoldings.sort((a, b) => a.key.localeCompare(b.key));
  return { results, issues, holdings, pools: poolHoldings };
}

function addLot(p: Pool, lot: HoldingLot, method: CostBasisMethod) {
  if (method === 'fifo' && p.lots.length > 0 && p.lots[p.lots.length - 1]!.acquiredAt > lot.acquiredAt) {
    // A lot moved in from another wallet keeps its acquisition date: insert it in date order.
    const i = p.lots.findIndex((l) => l.acquiredAt > lot.acquiredAt);
    p.lots.splice(i, 0, lot);
    return;
  }
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

/** Takes lots out of a pool without realising anything (transfer between wallets). */
function takeLots(p: Pool, qty: Dec): { lotId: string; acquiredAt: Date; quantity: Dec; cost: Dec }[] | null {
  const available = p.lots.reduce((a, l) => a.plus(l.remaining), ZERO);
  if (available.lt(qty)) return null;
  let left = qty;
  const out: { lotId: string; acquiredAt: Date; quantity: Dec; cost: Dec }[] = [];
  for (const lot of p.lots) {
    if (left.isZero()) break;
    if (lot.remaining.isZero()) continue;
    const take = D.min(left, lot.remaining);
    const partCost = take.eq(lot.remaining) ? lot.remainingCost : lot.remainingCost.times(take).div(lot.remaining);
    lot.remaining = lot.remaining.minus(take);
    lot.remainingCost = lot.remainingCost.minus(partCost);
    left = left.minus(take);
    out.push({ lotId: lot.lotId, acquiredAt: lot.acquiredAt, quantity: take, cost: partCost });
  }
  return out;
}
