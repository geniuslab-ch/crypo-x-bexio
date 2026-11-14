import { requireCtx } from '@/server/auth/next';
import { audit } from '@/server/audit';
import { buildAuditFile } from '@/server/services/auditFile';

export async function GET(req: Request) {
  const { ctx } = await requireCtx();
  const y = new URL(req.url).searchParams.get('year');
  if (!y || !/^\d{4}$/.test(y)) return new Response('year required', { status: 400 });
  const year = Number(y);
  const pdf = await buildAuditFile(ctx, year);
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'report.exported', entity: 'report', entityId: 'audit_file', after: { year, format: 'pdf' } });
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="crypto2books-dossier-revision-${year}.pdf"` },
  });
}
