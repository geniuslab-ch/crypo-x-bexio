import { GENERIC_HEADERS } from '@/core/importers/generic';

/** Empty Crypto2Books CSV template (header row only). Column meanings: src/core/importers/generic.ts and the README. */
export async function GET() {
  const body = `${GENERIC_HEADERS.join(',')}\n`;
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="crypto2books-template.csv"' } });
}
