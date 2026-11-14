import { desc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../audit';
import { AppError, type Ctx } from '../context';
import { platformRequests } from '../db/schema';

const MAX_SAMPLE_BYTES = 1024 * 1024;

export const platformRequestSchema = z.object({
  platform: z.string().trim().min(2).max(80),
  kind: z.enum(['exchange', 'wallet', 'blockchain']),
  wanted: z.enum(['csv', 'api', 'either']),
  note: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Any member of a file can ask for a platform (exchange, wallet app or blockchain) to be connected, optionally with an
 * example export. Requests are reviewed by the Crypto2Books team, which adds the connector.
 */
export async function createPlatformRequest(ctx: Ctx, input: z.input<typeof platformRequestSchema>, sample?: { name: string; content: string } | null): Promise<string> {
  const data = platformRequestSchema.parse(input);
  if (sample && Buffer.byteLength(sample.content, 'utf8') > MAX_SAMPLE_BYTES) throw new AppError('invalid', 'file_too_large');
  const [r] = await ctx.db.insert(platformRequests).values({
    orgId: ctx.orgId, userId: ctx.userId, platform: data.platform, kind: data.kind, wanted: data.wanted, note: data.note || null,
    sampleName: sample?.name.slice(0, 200) ?? null, sampleContent: sample?.content ?? null,
  }).returning({ id: platformRequests.id });
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'platform.requested', entity: 'platform_request', entityId: r!.id,
    after: { platform: data.platform, kind: data.kind, wanted: data.wanted, sample: !!sample } });
  return r!.id;
}

/** Requests of the files the user belongs to, newest first (without the sample content). */
export async function listPlatformRequests(ctx: Ctx, orgIds: string[]) {
  if (orgIds.length === 0) return [];
  return ctx.db.select({
    id: platformRequests.id, orgId: platformRequests.orgId, platform: platformRequests.platform, kind: platformRequests.kind, wanted: platformRequests.wanted,
    note: platformRequests.note, sampleName: platformRequests.sampleName, status: platformRequests.status, createdAt: platformRequests.createdAt,
  }).from(platformRequests).where(inArray(platformRequests.orgId, orgIds)).orderBy(desc(platformRequests.createdAt)).limit(200);
}

/** Requests grouped by platform name (case-insensitive), most requested first. `rows` are newest first. */
export function groupRequests<T extends { platform: string; status: string }>(rows: T[]) {
  const m = new Map<string, { platform: string; count: number; open: number }>();
  for (const r of rows) {
    const k = r.platform.trim().toLowerCase();
    const g = m.get(k) ?? { platform: r.platform.trim(), count: 0, open: 0 };
    g.count++;
    g.platform = r.platform.trim(); // rows are newest first: keep the spelling of the first request
    if (r.status === 'open' || r.status === 'planned') g.open++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
}
