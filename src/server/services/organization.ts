import { and, eq, inArray, or } from 'drizzle-orm';
import {
  classificationAllowed, hasTaxStatus, isTaxStatus, kindOfLegalForm, legalFormOf,
  type LegalForm, type OrgKind, type TaxStatus,
} from '@/core/legalForms';
import type { Classification } from '@/core/types';
import { audit } from '../audit';
import { AppError, assertCanWrite, type Ctx } from '../context';
import type { DB } from '../db';
import { classificationRules, organizations, transactions } from '../db/schema';

export interface OrgProfile {
  kind: OrgKind;
  legalForm: LegalForm | 'company';
  taxStatus: TaxStatus;
}

function toProfile(o: { kind: OrgKind; legalForm: string | null; taxStatus: string }): OrgProfile {
  return {
    kind: o.kind,
    legalForm: legalFormOf(o.kind, o.legalForm),
    // The tax status only applies to legal entities; natural persons are always "ordinary".
    taxStatus: hasTaxStatus(o.kind) && isTaxStatus(o.taxStatus) ? o.taxStatus : 'ordinary',
  };
}

export async function getOrgProfile(ctx: Ctx): Promise<OrgProfile> {
  const [o] = await ctx.db.select({ kind: organizations.kind, legalForm: organizations.legalForm, taxStatus: organizations.taxStatus })
    .from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!o) throw new AppError('not_found', 'organization_not_found');
  return toProfile(o);
}

/** Legal forms of several organisations (for lists the user already has access to). */
export async function orgProfiles(db: DB, orgIds: string[]): Promise<Map<string, OrgProfile>> {
  if (orgIds.length === 0) return new Map();
  const rows = await db.select({ id: organizations.id, kind: organizations.kind, legalForm: organizations.legalForm, taxStatus: organizations.taxStatus })
    .from(organizations).where(inArray(organizations.id, orgIds));
  return new Map(rows.map((r) => [r.id, toProfile(r)]));
}

/** Values to store for a legal form chosen in a form. */
export function legalFormColumns(form: LegalForm, taxStatus: TaxStatus = 'ordinary') {
  const kind = kindOfLegalForm(form);
  return { kind, legalForm: kind === 'company' ? form : null, taxStatus: hasTaxStatus(kind) ? taxStatus : 'ordinary' };
}

export async function assertClassificationAllowed(ctx: Ctx, c: Classification): Promise<void> {
  const { kind } = await getOrgProfile(ctx);
  if (!classificationAllowed(kind, c)) throw new AppError('invalid', 'classification_not_for_legal_form');
}

/**
 * Changes the legal form and tax status of the active client file. Bookings do not depend on them, but a file that
 * stops being a foundation must not keep endowments (foundation-only) in its transactions or rules.
 */
export async function updateOrgProfile(ctx: Ctx, form: LegalForm, taxStatus: TaxStatus): Promise<void> {
  assertCanWrite(ctx);
  const before = await getOrgProfile(ctx);
  const next = legalFormColumns(form, taxStatus);
  if (next.kind !== 'foundation') {
    const [used] = await ctx.db.select({ id: transactions.id }).from(transactions)
      .where(and(eq(transactions.orgId, ctx.orgId), or(eq(transactions.manualClassification, 'endowment_received'), eq(transactions.classification, 'endowment_received'))))
      .limit(1);
    const [rule] = await ctx.db.select({ id: classificationRules.id }).from(classificationRules)
      .where(and(eq(classificationRules.orgId, ctx.orgId), eq(classificationRules.classification, 'endowment_received'))).limit(1);
    if (used || rule) throw new AppError('conflict', 'endowments_require_foundation');
  }
  await ctx.db.transaction(async (db) => {
    await db.update(organizations).set(next).where(eq(organizations.id, ctx.orgId));
    await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'organization.legal_form_changed', entity: 'organization', entityId: ctx.orgId, before, after: next });
  });
}
