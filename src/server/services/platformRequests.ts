import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../audit';
import { AppError, type Ctx } from '../context';
import { organizations, platformRequests, users } from '../db/schema';

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

/** All requests of these files grouped by platform name (case-insensitive, spelled as in the first request), most requested first. */
export async function requestTotals(ctx: Ctx, orgIds: string[]) {
  if (orgIds.length === 0) return [];
  const key = sql<string>`lower(trim(${platformRequests.platform}))`;
  const rows = await ctx.db.select({
    platform: sql<string>`(array_agg(trim(${platformRequests.platform}) order by ${platformRequests.createdAt}))[1]`, count: count(),
    open: sql<number>`count(*) filter (where ${platformRequests.status} in ('open', 'planned'))`,
  }).from(platformRequests).where(inArray(platformRequests.orgId, orgIds)).groupBy(key);
  return rows.map((r) => ({ platform: r.platform, count: Number(r.count), open: Number(r.open) }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
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

const KIND_FR: Record<string, string> = { exchange: 'Exchange', wallet: 'Wallet', blockchain: 'Blockchain' };
const WANTED_FR: Record<string, string> = { csv: 'Import CSV', api: 'Connexion API', either: 'CSV ou API' };

/** Where new platform requests are announced. PLATFORM_REQUEST_NOTIFY_TO overrides the default address. */
export function platformRequestRecipient(): string {
  return process.env.PLATFORM_REQUEST_NOTIFY_TO?.trim() || 'contact@crypto2books.ch';
}

/** Brevo refuses unknown extensions: keep .csv/.txt, otherwise send the example as .txt. */
export function attachmentName(name: string): string {
  const base = name.replace(/[\\/\r\n]/g, '_').trim() || 'exemple';
  return /\.(csv|txt)$/i.test(base) ? base : `${base}.txt`;
}

export interface PlatformRequestNotice {
  platform: string; kind: string; wanted: string; note: string | null;
  requesterName: string | null; requesterEmail: string; orgName: string;
  /** Requests for this platform name (case-insensitive) across all files, this one included. */
  total: number; createdAt: Date; sample: { name: string; content: string } | null;
}

/** French notification for the Crypto2Books team about one new request (the example export goes as an attachment). */
export function platformRequestMail(n: PlatformRequestNotice, to: string) {
  const who = n.requesterName ? `${n.requesterName} <${n.requesterEmail}>` : n.requesterEmail;
  const lines = [
    `Nouvelle demande de plateforme sur Crypto2Books.`, '',
    `Plateforme : ${n.platform}`,
    `Type : ${KIND_FR[n.kind] ?? n.kind}`,
    `Souhaité : ${WANTED_FR[n.wanted] ?? n.wanted}`,
    `Demandé par : ${who}`,
    `Dossier : ${n.orgName}`,
    `Date : ${n.createdAt.toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })}`,
    `Demandes pour cette plateforme à ce jour : ${n.total}`,
    `Fichier d'exemple : ${n.sample ? `${n.sample.name} (en pièce jointe)` : 'aucun'}`,
  ];
  if (n.note) lines.push('', 'Remarque :', n.note);
  return {
    to, replyTo: n.requesterEmail,
    subject: `Demande de plateforme : ${n.platform} (${n.total} demande${n.total > 1 ? 's' : ''})`,
    text: lines.join('\n'),
    attachments: n.sample ? [{ name: attachmentName(n.sample.name), content: n.sample.content }] : undefined,
  };
}

/** Everything the notification needs, read back from the stored request. */
export async function platformRequestNotice(db: Ctx['db'], requestId: string): Promise<PlatformRequestNotice | null> {
  const [r] = await db.select({
    platform: platformRequests.platform, kind: platformRequests.kind, wanted: platformRequests.wanted, note: platformRequests.note,
    sampleName: platformRequests.sampleName, sampleContent: platformRequests.sampleContent, createdAt: platformRequests.createdAt,
    requesterName: users.name, requesterEmail: users.email, orgName: organizations.name,
  }).from(platformRequests)
    .innerJoin(users, eq(users.id, platformRequests.userId))
    .innerJoin(organizations, eq(organizations.id, platformRequests.orgId))
    .where(eq(platformRequests.id, requestId));
  if (!r) return null;
  const [c] = await db.select({ n: count() }).from(platformRequests)
    .where(sql`lower(trim(${platformRequests.platform})) = lower(trim(${r.platform}))`);
  return {
    platform: r.platform.trim(), kind: r.kind, wanted: r.wanted, note: r.note, requesterName: r.requesterName, requesterEmail: r.requesterEmail,
    orgName: r.orgName, total: Number(c?.n ?? 1), createdAt: r.createdAt,
    sample: r.sampleName && r.sampleContent != null ? { name: r.sampleName, content: r.sampleContent } : null,
  };
}
