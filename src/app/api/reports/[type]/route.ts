import { requireCtx } from '@/server/auth/next';
import { audit } from '@/server/audit';
import { buildReport, REPORT_TYPES, reportToCsv, reportToXlsx, type ReportType } from '@/server/services/reports';

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!(REPORT_TYPES as readonly string[]).includes(type)) return new Response('Unknown report', { status: 404 });
  const { ctx } = await requireCtx();
  const url = new URL(req.url);
  const y = url.searchParams.get('year');
  const year = y && /^\d{4}$/.test(y) ? Number(y) : null;
  const report = await buildReport(ctx, type as ReportType, { year });
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'report.exported', entity: 'report', entityId: type, after: { year, format: url.searchParams.get('format') } });
  const name = `crypto2books-${type}-${year ?? 'all'}`;
  if (url.searchParams.get('format') === 'xlsx') {
    return new Response(new Uint8Array(await reportToXlsx(report)), {
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${name}.xlsx"` },
    });
  }
  return new Response(reportToCsv(report), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"` } });
}
