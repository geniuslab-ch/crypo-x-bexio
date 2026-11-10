import { isFiat } from '../assets';
import { D } from '../decimal';
import type { Classification, Movement } from '../types';

export const REVIEW_THRESHOLD = 0.8;

export interface ClassifiableTx {
  id: string;
  sourceId: string;
  provider: string;
  occurredAt: Date;
  rawType: string;
  movements: Movement[];
  txHash?: string | null;
  hint?: { classification: Classification; confidence: number; reason: string } | null;
  /** Classification set by a person for this exact transaction. Always wins. */
  manual?: Classification | null;
}

export interface UserRule {
  id: string;
  provider: string;
  rawType: string;
  /** Optional: restrict to transactions involving this asset. */
  asset?: string | null;
  classification: Classification;
}

export type ClassificationOrigin = 'user' | 'user_rule' | 'transfer_match' | 'source_hint' | 'structure';

export interface ClassificationResult {
  id: string;
  classification: Classification;
  confidence: number;
  origin: ClassificationOrigin;
  reasons: string[];
  needsReview: boolean;
  transferGroupId?: string | null;
  /** Quantity lost between a matched withdrawal and deposit, booked as a network fee on the withdrawal. */
  implicitFee?: { asset: string; quantity: string } | null;
}

export interface ClassificationOptions {
  transferWindowHours: number;
  /** Max relative difference between withdrawn and received quantity to accept a transfer match. */
  transferTolerance: number;
}

export const DEFAULT_CLASSIFICATION_OPTIONS: ClassificationOptions = {
  transferWindowHours: 48,
  transferTolerance: 0.01,
};

function principal(tx: ClassifiableTx): { ins: Movement[]; outs: Movement[]; fees: Movement[] } {
  return {
    ins: tx.movements.filter((m) => m.direction === 'in'),
    outs: tx.movements.filter((m) => m.direction === 'out'),
    fees: tx.movements.filter((m) => m.direction === 'fee'),
  };
}

/** Classification from the shape of the movements alone. */
export function structuralClassification(tx: ClassifiableTx): { c: Classification; conf: number; reason: string } {
  const { ins, outs, fees } = principal(tx);
  const cryptoIn = ins.filter((m) => !isFiat(m.asset));
  const fiatIn = ins.filter((m) => isFiat(m.asset));
  const cryptoOut = outs.filter((m) => !isFiat(m.asset));
  const fiatOut = outs.filter((m) => isFiat(m.asset));

  if (ins.length === 0 && outs.length === 0) {
    if (fees.length > 0) return { c: 'trading_fee', conf: 0.7, reason: 'Uniquement un mouvement de frais' };
    return { c: 'internal_transfer', conf: 0.9, reason: 'Les mouvements s’annulent au sein de la même source' };
  }
  if (ins.length === 1 && outs.length === 1) {
    const i = ins[0]!;
    const o = outs[0]!;
    if (i.asset === o.asset) return { c: 'internal_transfer', conf: 0.85, reason: 'Même actif en entrée et en sortie' };
    if (!isFiat(i.asset) && isFiat(o.asset)) return { c: 'buy', conf: 0.95, reason: `${i.asset} reçu contre ${o.asset}` };
    if (isFiat(i.asset) && !isFiat(o.asset)) return { c: 'sell', conf: 0.95, reason: `${o.asset} vendu contre ${i.asset}` };
    if (!isFiat(i.asset) && !isFiat(o.asset)) return { c: 'swap', conf: 0.9, reason: `${o.asset} échangé contre ${i.asset}` };
    return { c: 'unknown', conf: 0.3, reason: 'Conversion fiat-fiat non traitée en phase 1' };
  }
  if (ins.length === 1 && outs.length === 0) {
    if (fiatIn.length === 1) return { c: 'fiat_deposit', conf: 0.9, reason: `Dépôt de ${fiatIn[0]!.asset}` };
    return {
      c: 'deposit',
      conf: 0.5,
      reason: `${cryptoIn[0]!.asset} reçu de l’extérieur de cette source : votre propre wallet, un achat ailleurs ou un revenu ? Merci de confirmer`,
    };
  }
  if (outs.length === 1 && ins.length === 0) {
    if (fiatOut.length === 1) return { c: 'fiat_withdrawal', conf: 0.9, reason: `Retrait de ${fiatOut[0]!.asset}` };
    return {
      c: 'withdrawal',
      conf: 0.5,
      reason: `${cryptoOut[0]!.asset} envoyé hors de cette source : vers votre propre wallet, un paiement ou une vente ? Merci de confirmer`,
    };
  }
  return { c: 'unknown', conf: 0.2, reason: 'Plusieurs actifs en entrée ou en sortie : non traité automatiquement' };
}

function ruleMatches(rule: UserRule, tx: ClassifiableTx): boolean {
  if (rule.provider !== tx.provider) return false;
  if (rule.rawType.toLowerCase() !== tx.rawType.toLowerCase()) return false;
  if (rule.asset && !tx.movements.some((m) => m.asset === rule.asset)) return false;
  return true;
}

/**
 * Classifies a set of transactions belonging to one organisation.
 * Order of precedence: manual classification > user rule > own-wallet transfer match > source hint / structure.
 */
export function classifyTransactions(
  txs: ClassifiableTx[],
  rules: UserRule[],
  options: ClassificationOptions = DEFAULT_CLASSIFICATION_OPTIONS,
): Map<string, ClassificationResult> {
  const results = new Map<string, ClassificationResult>();

  for (const tx of txs) {
    if (tx.manual) {
      results.set(tx.id, {
        id: tx.id, classification: tx.manual, confidence: 1, origin: 'user', reasons: ['Classée manuellement'], needsReview: false,
      });
      continue;
    }
    const rule = rules.find((r) => ruleMatches(r, tx));
    if (rule) {
      results.set(tx.id, {
        id: tx.id, classification: rule.classification, confidence: 1, origin: 'user_rule',
        reasons: [`Votre règle : ${tx.provider} « ${rule.rawType} » → ${rule.classification}`], needsReview: false,
      });
      continue;
    }
    const s = structuralClassification(tx);
    const hint = tx.hint;
    // A source hint is used when it is more confident than structure, or when structure is ambiguous.
    const useHint = hint && (hint.confidence >= s.conf || s.c === 'deposit' || s.c === 'withdrawal' || s.c === 'unknown');
    const c = useHint ? hint.classification : s.c;
    const conf = useHint ? hint.confidence : s.conf;
    const hasNft = tx.movements.some((m) => m.asset.startsWith('NFT.'));
    const reasons = [useHint ? hint.reason : s.reason, ...(hasNft && !useHint ? ['NFT : pas de cours de marché, valeur à vérifier'] : [])];
    results.set(tx.id, {
      id: tx.id, classification: c, confidence: conf, origin: useHint ? 'source_hint' : 'structure', reasons,
      // NFTs have no market price feed: their value always needs a human check.
      needsReview: conf < REVIEW_THRESHOLD || hasNft,
    });
  }

  matchOwnTransfers(txs, results, options);
  return results;
}

/** Pairs crypto withdrawals with deposits of the same asset at another of the user's sources. */
function matchOwnTransfers(
  txs: ClassifiableTx[],
  results: Map<string, ClassificationResult>,
  options: ClassificationOptions,
): void {
  const eligible = (tx: ClassifiableTx, kind: 'withdrawal' | 'deposit') => {
    const r = results.get(tx.id);
    return r && r.classification === kind && (r.origin === 'structure' || r.origin === 'source_hint');
  };
  const withdrawals = txs.filter((t) => eligible(t, 'withdrawal'));
  const deposits = txs.filter((t) => eligible(t, 'deposit'));
  const usedDeposits = new Set<string>();
  const windowMs = options.transferWindowHours * 3600_000;
  const skewMs = 10 * 60_000; // tolerate 10 minutes of clock difference between sources

  type Candidate = { w: ClassifiableTx; d: ClassifiableTx; score: number; gap: InstanceType<typeof D>; byHash: boolean };
  const candidates: Candidate[] = [];
  for (const w of withdrawals) {
    const wOut = w.movements.find((m) => m.direction === 'out');
    if (!wOut) continue;
    const wQty = new D(wOut.quantity);
    // Fees the source already records in the same asset are not part of the unexplained gap.
    const knownFee = w.movements.filter((m) => m.direction === 'fee' && m.asset === wOut.asset).reduce((a, m) => a.plus(m.quantity), new D(0));
    for (const d of deposits) {
      if (d.sourceId === w.sourceId) continue;
      const dIn = d.movements.find((m) => m.direction === 'in');
      if (!dIn || dIn.asset !== wOut.asset) continue;
      const dt = d.occurredAt.getTime() - w.occurredAt.getTime();
      const byHash = !!w.txHash && !!d.txHash && w.txHash.toLowerCase() === d.txHash.toLowerCase();
      if (!byHash && (dt < -skewMs || dt > windowMs)) continue;
      const dQty = new D(dIn.quantity);
      if (dQty.gt(wQty)) continue;
      const gap = D.max(wQty.minus(dQty).minus(knownFee), 0);
      if (!byHash && gap.div(wQty).gt(options.transferTolerance)) continue;
      candidates.push({ w, d, gap, byHash, score: (byHash ? 1e15 : 0) - Math.abs(dt) - gap.div(wQty).toNumber() * 1e9 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedW = new Set<string>();
  for (const c of candidates) {
    if (usedW.has(c.w.id) || usedDeposits.has(c.d.id)) continue;
    usedW.add(c.w.id);
    usedDeposits.add(c.d.id);
    const group = `tg_${c.w.id}`;
    const conf = c.byHash ? 0.99 : 0.9;
    const reason = c.byHash
      ? 'Apparié à un dépôt portant le même hash de transaction sur une autre de vos sources'
      : `Apparié à un dépôt du même actif sur une autre de vos sources dans les ${options.transferWindowHours} h`;
    const asset = c.w.movements.find((m) => m.direction === 'out')!.asset;
    results.set(c.w.id, {
      id: c.w.id, classification: 'internal_transfer', confidence: conf, origin: 'transfer_match', reasons: [reason],
      needsReview: false, transferGroupId: group,
      implicitFee: c.gap.isZero() ? null : { asset, quantity: c.gap.toString() },
    });
    results.set(c.d.id, {
      id: c.d.id, classification: 'internal_transfer', confidence: conf, origin: 'transfer_match', reasons: [reason],
      needsReview: false, transferGroupId: group,
    });
  }
}
