import { D, ZERO, type Dec } from './decimal';
import type { Direction } from './types';

/**
 * Reconciliation (pure): balance per source and asset computed from the imported movements, compared with the balance
 * the platform or wallet states itself. Derived movements (implicit transfer fees computed by Crypto2Books) are left
 * out: the sent quantity already contains them.
 */
export interface BalanceMovement {
  sourceId: string;
  occurredAt: Date;
  direction: Direction;
  asset: string;
  quantity: string;
  derived?: boolean;
}

export function computedBalances(movements: BalanceMovement[], until: Date): Map<string, Dec> {
  const m = new Map<string, Dec>();
  for (const mv of movements) {
    if (mv.derived || mv.occurredAt >= until) continue;
    const k = balanceKey(mv.sourceId, mv.asset);
    const q = new D(mv.quantity);
    m.set(k, (m.get(k) ?? ZERO).plus(mv.direction === 'in' ? q : q.neg()));
  }
  return m;
}

export function balanceKey(sourceId: string, asset: string): string {
  return `${sourceId}|${asset}`;
}

/** Differences up to this many units are rounding noise from the platform's own display (e.g. 1 satoshi = 1e-8). */
export const RECONCILIATION_TOLERANCE = '0.00000001';

export type ReconciliationStatus = 'ok' | 'gap' | 'not_reported';

export function reconcileOne(computed: Dec | undefined, reported: string | null): { difference: string | null; status: ReconciliationStatus } {
  if (reported === null) return { difference: null, status: 'not_reported' };
  const diff = new D(reported).minus(computed ?? ZERO);
  return { difference: diff.toString(), status: diff.abs().lte(RECONCILIATION_TOLERANCE) ? 'ok' : 'gap' };
}
