import { and, eq } from 'drizzle-orm';
import Papa from 'papaparse';
import { parseAmount } from '@/core/decimal';
import type { Classification } from '@/core/types';
import { rateTableLookup, zurichDate, type StoredRate } from '@/core/valuation/rateTable';
import { valueTransaction } from '@/core/valuation/value';
import { coingeckoConfigured, fetchCoinGeckoChfRate } from '@/integrations/prices/coingecko';
import { audit } from '../audit';
import { AppError, assertCanWrite, type Ctx } from '../context';
import { movements, priceRates, taxValues, transactions } from '../db/schema';
import { effectiveClassification, loadTransactions, lockedTransactionIds, normalizeNumeric, toMovement } from './transactions';

async function loadRates(ctx: Ctx): Promise<StoredRate[]> {
  const rows = await ctx.db.select().from(priceRates).where(eq(priceRates.orgId, ctx.orgId));
  return rows.map((r) => ({ asset: r.asset, rateDate: r.rateDate, rate: normalizeNumeric(r.rate), source: r.source, sourceUrl: r.sourceUrl }));
}

/**
 * Values every unlocked transaction in CHF. With `fetchMissing`, documented rates are first fetched from the
 * configured provider and stored in the rate table (so every rate used remains visible and traceable).
 */
export async function revalue(ctx: Ctx, opts: { fetchMissing?: boolean; fetchImpl?: typeof fetch } = {}): Promise<{ missing: number; fetched: number; providerErrors: string[] }> {
  const loaded = await loadTransactions(ctx);
  const locked = await lockedTransactionIds(ctx);
  let rates = await loadRates(ctx);
  let fetched = 0;
  const providerErrors: string[] = [];

  const run = () => {
    const lookup = rateTableLookup(rates);
    return loaded.filter((l) => !locked.has(l.tx.id)).map((l) => ({
      l,
      v: valueTransaction({
        occurredAt: l.tx.occurredAt,
        classification: effectiveClassification(l.tx) as Classification,
        movements: l.movements.map(toMovement),
        sourceChfValue: l.tx.sourceChfValue ? normalizeNumeric(l.tx.sourceChfValue) : null,
      }, lookup),
    }));
  };

  let valued = run();
  if (opts.fetchMissing && coingeckoConfigured()) {
    const wanted = new Set<string>();
    for (const { l, v } of valued) for (const a of v.missing) wanted.add(`${a}|${zurichDate(l.tx.occurredAt)}`);
    for (const k of wanted) {
      const [asset, date] = k.split('|') as [string, string];
      try {
        const q = await fetchCoinGeckoChfRate(asset, date, opts.fetchImpl);
        if (!q) continue;
        await ctx.db.insert(priceRates).values({
          orgId: ctx.orgId, asset, rateDate: date, rate: q.rate, source: 'CoinGecko daily snapshot (00:00 UTC)', sourceUrl: q.sourceUrl,
        }).onConflictDoNothing();
        fetched++;
      } catch (e) {
        providerErrors.push(`${asset} ${date}: ${(e as Error).message}`);
      }
    }
    if (fetched > 0) {
      await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'rates.fetched', entity: 'price_rates', after: { provider: 'coingecko', fetched } });
      rates = await loadRates(ctx);
      valued = run();
    }
  }

  let missing = 0;
  await ctx.db.transaction(async (db) => {
    for (const { l, v } of valued) {
      if (v.missing.length) missing++;
      for (let i = 0; i < l.movements.length; i++) {
        const row = l.movements[i]!;
        const m = v.movements[i]!;
        await db.update(movements).set({
          chfRate: m.chfRate, chfValue: m.chfValue, rateSource: m.rateSource, rateRef: m.rateRef,
        }).where(eq(movements.id, row.id));
      }
      await db.update(transactions).set({ rateMissing: v.missing }).where(eq(transactions.id, l.tx.id));
    }
  });
  return { missing, fetched, providerErrors };
}

/**
 * Imports a CSV of documented CHF rates: asset,date,rate_chf,source,source_url
 * A rate already stored for the same asset and date is kept unless `replace` is set (the change is audited).
 */
export async function importRates(ctx: Ctx, csv: string, replace = false): Promise<{ inserted: number; replaced: number; skipped: number; errors: string[] }> {
  assertCanWrite(ctx);
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const errors: string[] = [];
  let inserted = 0;
  let replaced = 0;
  let skipped = 0;
  for (const [i, row] of parsed.data.entries()) {
    const line = i + 2;
    const asset = (row.asset ?? '').trim().toUpperCase();
    const date = (row.date ?? '').trim();
    const rate = parseAmount(row.rate_chf);
    const source = (row.source ?? '').trim();
    if (!asset || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !rate || !rate.isPositive() || !source) {
      errors.push(`Line ${line}: asset, date (YYYY-MM-DD), positive rate_chf and source are required`);
      continue;
    }
    const [existing] = await ctx.db.select().from(priceRates)
      .where(and(eq(priceRates.orgId, ctx.orgId), eq(priceRates.asset, asset), eq(priceRates.rateDate, date)));
    if (existing) {
      if (!replace || normalizeNumeric(existing.rate) === rate.toString()) {
        skipped++;
        continue;
      }
      await ctx.db.update(priceRates).set({ rate: rate.toString(), source, sourceUrl: row.source_url?.trim() || null, createdBy: ctx.userId })
        .where(eq(priceRates.id, existing.id));
      await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'rate.replaced', entity: 'price_rate', entityId: existing.id,
        before: { rate: existing.rate, source: existing.source }, after: { rate: rate.toString(), source } });
      replaced++;
      continue;
    }
    await ctx.db.insert(priceRates).values({ orgId: ctx.orgId, asset, rateDate: date, rate: rate.toString(), source, sourceUrl: row.source_url?.trim() || null, createdBy: ctx.userId });
    inserted++;
  }
  if (inserted + replaced > 0) {
    await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'rates.imported', entity: 'price_rates', after: { inserted, replaced } });
  }
  if (inserted + replaced + skipped === 0 && errors.length === 0) throw new AppError('invalid', 'empty_file');
  return { inserted, replaced, skipped, errors };
}

/**
 * Imports official tax values (CSV: asset, year, value_chf, source[, source_url]), e.g. copied from the ESTV/AFC
 * Kursliste ICTax. Existing values are only replaced when asked, with an audit entry.
 */
export async function importTaxValues(ctx: Ctx, csv: string, replace = false): Promise<{ inserted: number; replaced: number; skipped: number; errors: string[] }> {
  assertCanWrite(ctx);
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const errors: string[] = [];
  let inserted = 0;
  let replaced = 0;
  let skipped = 0;
  for (const [i, row] of parsed.data.entries()) {
    const line = i + 2;
    const asset = (row.asset ?? '').trim().toUpperCase();
    const year = Number((row.year ?? '').trim());
    const value = parseAmount(row.value_chf);
    const source = (row.source ?? '').trim();
    if (!asset || !Number.isInteger(year) || year < 2009 || year > 2100 || !value || !value.isPositive() || !source) {
      errors.push(`Ligne ${line} : asset, year (AAAA), value_chf positif et source sont obligatoires`);
      continue;
    }
    const [existing] = await ctx.db.select().from(taxValues)
      .where(and(eq(taxValues.orgId, ctx.orgId), eq(taxValues.asset, asset), eq(taxValues.taxYear, year)));
    if (existing) {
      if (!replace || normalizeNumeric(existing.valueChf) === value.toString()) { skipped++; continue; }
      await ctx.db.update(taxValues).set({ valueChf: value.toString(), source, sourceUrl: row.source_url?.trim() || null, createdBy: ctx.userId })
        .where(eq(taxValues.id, existing.id));
      await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'tax_value.replaced', entity: 'tax_value', entityId: existing.id,
        before: { value: existing.valueChf, source: existing.source }, after: { value: value.toString(), source } });
      replaced++;
      continue;
    }
    await ctx.db.insert(taxValues).values({ orgId: ctx.orgId, asset, taxYear: year, valueChf: value.toString(), source, sourceUrl: row.source_url?.trim() || null, createdBy: ctx.userId });
    inserted++;
  }
  if (inserted + replaced > 0) {
    await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'tax_values.imported', entity: 'tax_values', after: { inserted, replaced } });
  }
  if (inserted + replaced + skipped === 0 && errors.length === 0) throw new AppError('invalid', 'empty_file');
  return { inserted, replaced, skipped, errors };
}
