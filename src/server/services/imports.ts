import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { sha256, transactionFingerprint } from '@/core/fingerprint';
import { detectImporter, getImporter, INTEGRATIONS } from '@/core/importers';
import type { ParseResult } from '@/core/types';
import { connectorFor } from '@/integrations/sources';
import { audit } from '../audit';
import { AppError, assertCanWrite, type Ctx } from '../context';
import { importBatches, movements, sources, transactions } from '../db/schema';
import { reclassify } from './classification';
import { revalue } from './valuation';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const sourceSchema = z.object({
  provider: z.enum(INTEGRATIONS.map((i) => i.provider) as [string, ...string[]]),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(['exchange', 'wallet']),
});

export async function createSource(ctx: Ctx, input: z.input<typeof sourceSchema>): Promise<string> {
  assertCanWrite(ctx);
  const data = sourceSchema.parse(input);
  // Blockchain sources are wallets by definition.
  const connector = connectorFor(data.provider);
  if (connector?.kind === 'wallet') data.kind = 'wallet';
  const [s] = await ctx.db.insert(sources).values({ orgId: ctx.orgId, ...data, connectionType: 'csv' }).returning({ id: sources.id });
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'source.created', entity: 'source', entityId: s!.id, after: data });
  return s!.id;
}

export async function listSources(ctx: Ctx) {
  return ctx.db.select().from(sources).where(eq(sources.orgId, ctx.orgId)).orderBy(sources.label);
}

export async function listBatches(ctx: Ctx) {
  return ctx.db.select({
    id: importBatches.id, sourceId: importBatches.sourceId, parserId: importBatches.parserId, fileName: importBatches.fileName,
    rowCount: importBatches.rowCount, importedCount: importBatches.importedCount, duplicateCount: importBatches.duplicateCount,
    issues: importBatches.issues, createdAt: importBatches.createdAt,
  }).from(importBatches).where(eq(importBatches.orgId, ctx.orgId)).orderBy(desc(importBatches.createdAt));
}

export interface ImportResult {
  batchId: string;
  parserId: string;
  imported: number;
  duplicates: number;
  issues: { rowNumber: number; message: string }[];
}

/**
 * Imports one CSV file into a source: parse → deduplicate → persist raw evidence and normalised movements
 * → re-run classification and CHF valuation.
 */
export async function importFile(
  ctx: Ctx,
  input: { sourceId: string; fileName: string; content: string; parserId?: string | null },
): Promise<ImportResult> {
  assertCanWrite(ctx);
  if (Buffer.byteLength(input.content, 'utf8') > MAX_FILE_BYTES) throw new AppError('invalid', 'file_too_large');
  const [source] = await ctx.db.select().from(sources).where(and(eq(sources.id, input.sourceId), eq(sources.orgId, ctx.orgId)));
  if (!source) throw new AppError('not_found', 'source_not_found');

  const importer = input.parserId ? getImporter(input.parserId) : detectImporter(input.content);
  if (!importer) throw new AppError('invalid', 'format_not_recognised');
  if (importer.provider !== 'generic' && importer.provider !== source.provider) throw new AppError('invalid', 'parser_does_not_match_source');

  const fileSha = sha256(input.content);
  const [dupFile] = await ctx.db.select({ id: importBatches.id }).from(importBatches)
    .where(and(eq(importBatches.sourceId, source.id), eq(importBatches.fileSha256, fileSha)));
  if (dupFile) throw new AppError('conflict', 'file_already_imported');

  const parsed = importer.parse(input.content);
  if (parsed.transactions.length === 0 && parsed.issues.length > 0 && parsed.issues[0]?.rowNumber === 0) {
    throw new AppError('invalid', parsed.issues[0].message);
  }

  const result = await persistBatch(ctx, source.id, {
    parserId: importer.id, parserVersion: importer.version, fileName: input.fileName, content: input.content, fileSha, parsed,
  });
  await reclassify(ctx);
  await revalue(ctx, { fetchMissing: true });
  return result;
}

/**
 * Stores one batch of parsed transactions with its raw evidence (file content or API responses), skipping
 * transactions already known for this source (fingerprint). Shared by file imports and API/address syncs.
 */
export async function persistBatch(
  ctx: Ctx,
  sourceId: string,
  input: { parserId: string; parserVersion: number; fileName: string; content: string; fileSha: string; parsed: ParseResult },
): Promise<ImportResult> {
  const { parsed } = input;
  return ctx.db.transaction(async (db) => {
    const [batch] = await db.insert(importBatches).values({
      orgId: ctx.orgId, sourceId, parserId: input.parserId, parserVersion: input.parserVersion, fileName: input.fileName.slice(0, 255),
      fileSha256: input.fileSha, fileContent: input.content, rowCount: parsed.transactions.reduce((a, t) => a + t.rowNumbers.length, 0) + parsed.issues.length,
      importedCount: 0, duplicateCount: 0, issues: parsed.issues, createdBy: ctx.userId,
    }).returning({ id: importBatches.id });
    let imported = 0;
    let duplicates = 0;
    for (const t of parsed.transactions) {
      const [row] = await db.insert(transactions).values({
        orgId: ctx.orgId, sourceId, batchId: batch!.id, externalId: t.externalId, txHash: t.txHash ?? null,
        occurredAt: t.occurredAt, rawType: t.rawType, raw: t.raw, rowNumbers: t.rowNumbers, note: t.note ?? null,
        fingerprint: transactionFingerprint(sourceId, t), hint: t.hint ?? null, sourceChfValue: t.sourceChfValue ?? null,
      }).onConflictDoNothing().returning({ id: transactions.id });
      if (!row) {
        duplicates++;
        continue;
      }
      imported++;
      if (t.movements.length > 0) {
        await db.insert(movements).values(t.movements.map((m) => ({
          orgId: ctx.orgId, transactionId: row.id, direction: m.direction, asset: m.asset, quantity: m.quantity, derived: false,
        })));
      }
    }
    await db.update(importBatches).set({ importedCount: imported, duplicateCount: duplicates }).where(eq(importBatches.id, batch!.id));
    await db.update(sources).set({ lastSyncedAt: new Date() }).where(eq(sources.id, sourceId));
    await audit(db, {
      orgId: ctx.orgId, actorUserId: ctx.userId, action: 'import.completed', entity: 'import_batch', entityId: batch!.id,
      after: { parser: input.parserId, file: input.fileName, imported, duplicates, issues: parsed.issues.length },
    });
    return { batchId: batch!.id, parserId: input.parserId, imported, duplicates, issues: parsed.issues };
  });
}
