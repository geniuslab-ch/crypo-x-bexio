import type { DB } from './db';
import { auditLog } from './db/schema';

export async function audit(
  db: Pick<DB, 'insert'>,
  e: { orgId: string | null; actorUserId: string | null; action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown },
): Promise<void> {
  await db.insert(auditLog).values({
    orgId: e.orgId,
    actorUserId: e.actorUserId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
  });
}
