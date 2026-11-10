import { exampleCsv } from '@/core/importers/guides';
import { GENERIC_HEADERS } from '@/core/importers/generic';

/**
 * CSV template. Without `format`: the empty Crypto2Books template (header row only). With `format=<importer id>`:
 * the expected header row plus one fictitious example row for that format.
 */
export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get('format');
  const body = format ? exampleCsv(format) : `${GENERIC_HEADERS.join(',')}\n`;
  if (body === null) return new Response('Unknown format', { status: 404 });
  const name = format ? `exemple-${format}.csv` : 'crypto2books-template.csv';
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
}
