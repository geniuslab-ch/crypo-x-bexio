import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser } from '@/server/auth/service';
import type { Ctx } from '@/server/context';
import { closeDb } from '@/server/db';
import { buildAuditFile } from '@/server/services/auditFile';
import { createSource, importFile } from '@/server/services/imports';
import { resetDatabase } from './helpers';

const HEADER = 'date,type,in_asset,in_quantity,out_asset,out_quantity,fee_asset,fee_quantity,external_id,tx_hash,chf_value,note';
let ctx: Ctx;

beforeAll(async () => {
  const db = await resetDatabase();
  const { userId, orgId } = await registerUser(db, { email: 'audit@example.test', password: 'correct horse battery', name: 'Fid', orgName: 'Révision Sàrl → Test ≤', orgKind: 'sarl', canton: 'VD' });
  ctx = { db, userId, orgId, role: 'owner' };
});
afterAll(async () => closeDb());

describe('audit file', () => {
  it('builds a multi-page PDF from the year reports, even with characters outside WinAnsi', async () => {
    const ex = await createSource(ctx, { provider: 'generic', label: 'Börse ✓ 交易所', kind: 'exchange' });
    const rows = [HEADER];
    for (let i = 0; i < 120; i++) rows.push(`2025-0${(i % 9) + 1}-1${i % 9}T10:00:00Z,buy,BTC,0.01,CHF,${500 + i},,,b-${i},,,note ${i} → ok`);
    await importFile(ctx, { sourceId: ex, fileName: 'gros fichier.csv', content: rows.join('\n') });
    const bytes = await buildAuditFile(ctx, 2025);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    if (process.env.AUDIT_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.AUDIT_PDF_OUT, bytes);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(9);
    expect(doc.getTitle()).toContain('Dossier de révision 2025');
  });
});
