import { and, eq } from 'drizzle-orm';
import {
  classifyTransactions, DEFAULT_CLASSIFICATION_OPTIONS, type ClassifiableTx, type UserRule,
} from '@/core/classification/engine';
import { classificationAllowed } from '@/core/legalForms';
import { CLASSIFICATIONS, type Classification } from '@/core/types';
import { audit } from '../audit';
import { AppError, assertCanWrite, type Ctx } from '../context';
import { accountingPolicies, classificationRules, movements, transactions } from '../db/schema';
import { assertClassificationAllowed, getOrgProfile } from './organization';
import { loadTransactions, lockedTransactionIds, normalizeNumeric, toMovement } from './transactions';

/**
 * Re-classifies every transaction of the organisation. Transactions with a validated or synced entry are left
 * untouched (their classification is part of an accepted booking).
 */
export async function reclassify(ctx: Ctx): Promise<{ changed: number; needsReview: number }> {
  const loaded = await loadTransactions(ctx);
  const rules: UserRule[] = (await ctx.db.select().from(classificationRules).where(eq(classificationRules.orgId, ctx.orgId)))
    .map((r) => ({ id: r.id, provider: r.provider, rawType: r.rawType, asset: r.asset, classification: r.classification as Classification }));
  const [policy] = await ctx.db.select().from(accountingPolicies).where(eq(accountingPolicies.orgId, ctx.orgId));
  const locked = await lockedTransactionIds(ctx);

  const input: ClassifiableTx[] = loaded.map((l) => ({
    id: l.tx.id,
    sourceId: l.tx.sourceId,
    provider: l.provider,
    occurredAt: l.tx.occurredAt,
    rawType: l.tx.rawType,
    txHash: l.tx.txHash,
    // Derived movements (implicit transfer fees) are recomputed, so classification only sees source movements.
    movements: l.movements.filter((m) => !m.derived).map(toMovement),
    hint: (l.tx.hint as ClassifiableTx['hint']) ?? null,
    manual: (l.tx.manualClassification as Classification | null) ?? null,
  }));
  const results = classifyTransactions(input, rules, {
    transferWindowHours: policy?.transferWindowHours ?? DEFAULT_CLASSIFICATION_OPTIONS.transferWindowHours,
    transferTolerance: policy ? Number(policy.transferTolerance) : DEFAULT_CLASSIFICATION_OPTIONS.transferTolerance,
  });

  // A classification reserved to foundations (endowment) coming from a file hint is never booked for another legal form.
  const { kind } = await getOrgProfile(ctx);
  for (const r of results.values()) {
    if (classificationAllowed(kind, r.classification)) continue;
    r.reasons = [...r.reasons, `« ${r.classification} » n’existe que pour une fondation : à classer manuellement`];
    r.classification = 'unknown';
    r.needsReview = true;
  }

  let changed = 0;
  let needsReview = 0;
  await ctx.db.transaction(async (db) => {
    for (const l of loaded) {
      const r = results.get(l.tx.id);
      if (!r || locked.has(l.tx.id)) continue;
      if (r.needsReview) needsReview++;
      const next = {
        classification: r.classification,
        confidence: r.confidence.toFixed(3),
        classificationOrigin: r.origin,
        classificationReasons: r.reasons,
        reviewStatus: r.needsReview ? ('needs_review' as const) : ('ok' as const),
        transferGroupId: r.transferGroupId ?? null,
      };
      const prevFee = l.movements.find((m) => m.derived);
      const feeChanged = (prevFee ? `${prevFee.asset}:${normalizeNumeric(prevFee.quantity)}` : '')
        !== (r.implicitFee ? `${r.implicitFee.asset}:${r.implicitFee.quantity}` : '');
      const same = l.tx.classification === next.classification && l.tx.reviewStatus === next.reviewStatus
        && l.tx.transferGroupId === next.transferGroupId && Number(l.tx.confidence) === r.confidence && !feeChanged;
      if (same) continue;
      changed++;
      await db.update(transactions).set(next).where(eq(transactions.id, l.tx.id));
      if (feeChanged) {
        await db.delete(movements).where(and(eq(movements.transactionId, l.tx.id), eq(movements.derived, true)));
        if (r.implicitFee) {
          await db.insert(movements).values({
            orgId: ctx.orgId, transactionId: l.tx.id, direction: 'fee', asset: r.implicitFee.asset, quantity: r.implicitFee.quantity, derived: true,
          });
        }
      }
    }
    if (changed > 0) await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'classification.run', entity: 'organization', entityId: ctx.orgId, after: { changed, needsReview } });
  });
  return { changed, needsReview };
}

/** A person sets the classification of one transaction, optionally remembering it as a rule. */
export async function setManualClassification(
  ctx: Ctx,
  txId: string,
  classification: Classification | null,
  remember: boolean,
): Promise<void> {
  assertCanWrite(ctx);
  if (classification && !CLASSIFICATIONS.includes(classification)) throw new AppError('invalid', 'invalid_classification');
  if (classification) await assertClassificationAllowed(ctx, classification);
  const locked = await lockedTransactionIds(ctx);
  if (locked.has(txId)) throw new AppError('conflict', 'transaction_locked_by_validated_entry');
  const [l] = await loadTransactions(ctx, [txId]);
  if (!l) throw new AppError('not_found', 'transaction_not_found');
  await ctx.db.transaction(async (db) => {
    await db.update(transactions).set({ manualClassification: classification }).where(eq(transactions.id, txId));
    await audit(db, {
      orgId: ctx.orgId, actorUserId: ctx.userId, action: 'transaction.classified', entity: 'transaction', entityId: txId,
      before: { classification: l.tx.manualClassification ?? l.tx.classification }, after: { classification, remember },
    });
    if (remember && classification) {
      await db.insert(classificationRules).values({
        orgId: ctx.orgId, provider: l.provider, rawType: l.tx.rawType, classification, createdBy: ctx.userId,
      });
      await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'rule.created', entity: 'classification_rule', after: { provider: l.provider, rawType: l.tx.rawType, classification } });
    }
  });
}
