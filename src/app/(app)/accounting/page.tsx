import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { importRatesAction, runCalculationAction, validateEntriesAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { Money, StatusBadge } from '@/components/ui';
import { ACCOUNT_KEY_LABELS, type Locale } from '@/i18n/dictionaries';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/ui';
import { requireCtx } from '@/server/auth/next';
import { priceRates } from '@/server/db/schema';
import { getPolicy, latestRun, listEntries, type RunIssue } from '@/server/services/calculation';
import { listSources } from '@/server/services/imports';
import { normalizeNumeric } from '@/server/services/transactions';

const baseLabel = (k: string, l: Locale) => ACCOUNT_KEY_LABELS[k]?.[l] ?? (k.startsWith('crypto_asset:') ? `Crypto ${k.slice(13)}` : k.startsWith('fiat_clearing:') ? `Fiat ${k.slice(14)} (exchange)` : k);

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; show?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date, locale } = await getI18n();
  const [policy, run, entries, rates, srcs] = await Promise.all([
    getPolicy(ctx), latestRun(ctx), listEntries(ctx),
    ctx.db.select().from(priceRates).where(eq(priceRates.orgId, ctx.orgId)).orderBy(desc(priceRates.rateDate)).limit(30),
    listSources(ctx),
  ]);
  // Per-wallet keys (crypto_asset:OGY@<source>) are shown with the wallet's name.
  const sourceName = new Map(srcs.map((s) => [s.id, s.label]));
  const keyLabel = (k: string) => {
    const at = k.indexOf('@');
    return at === -1 ? baseLabel(k, locale) : `${baseLabel(k.slice(0, at), locale)} · ${sourceName.get(k.slice(at + 1)) ?? 'wallet'}`;
  };
  const visible = entries.filter((e) => (sp.show === 'all' ? true : e.status !== 'superseded'));
  const issues = (run?.issues as RunIssue[] | undefined) ?? [];
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('acc.title')}</h1><p className="subtitle">{t('acc.method')} : <b>{policy.costBasisMethod.toUpperCase()}</b> · {t('acc.fees')} : {t(`acc.fees.${policy.tradingFeeTreatment}` as never)} · {' '}
          {policy.reviewedByFiduciaryAt ? <span className="badge badge-ok">{t('acc.reviewed')} {date(policy.reviewedByFiduciaryAt)}</span> : <span className="badge badge-warn">{t('acc.notReviewed')}</span>}</p></div>
        <form action={runCalculationAction}><button className="btn btn-primary" type="submit">{t('acc.run')}</button></form>
      </div>
      <Flash ok={sp.ok} error={sp.error} locale={locale} />

      {run && (
        <div className={`alert ${run.status === 'complete' && issues.length === 0 ? 'alert-ok' : 'alert-warn'}`}>
          <b>{t('acc.lastRun')} · {date(run.createdAt)} · {run.status === 'complete' ? t('acc.complete') : t('acc.blocked')}</b>
          {issues.length > 0 && <div style={{ marginTop: 8 }}>
            <div className="small">{t('acc.issues')} ({issues.length}) :</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {issues.slice(0, 50).map((i) => <li key={`${i.txId}${i.code}${i.message}`} className="small"><Link href={`/transactions/${i.txId}`}>{i.occurredAt ? date(i.occurredAt) : i.txId}</Link> · <code>{i.code}</code> · {i.message}</li>)}
            </ul>
          </div>}
        </div>
      )}

      <form action={validateEntriesAction} className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{t('acc.entries')} ({visible.length})</h2>
          <div className="row">
            <Link className="small" href={sp.show === 'all' ? '/accounting' : '/accounting?show=all'}>{sp.show === 'all' ? t('acc.hideSuperseded') : t('acc.showHistory')}</Link>
            <button className="btn" type="submit" name="mode" value="unvalidate">{t('acc.unvalidateSelected')}</button>
            <button className="btn btn-primary" type="submit" name="mode" value="validate">{t('acc.validateSelected')}</button>
          </div>
        </div>
        {visible.length === 0 ? <p className="muted">{t('acc.noEntries')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th /><th>{t('common.date')}</th><th>{t('acc.reference')}</th><th>{t('acc.label')}</th><th>{t('acc.debit')}</th><th>{t('acc.credit')}</th><th className="num">{t('acc.amount')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>{visible.map((e) => e.lines.map((l, i) => (
              <tr key={l.id}>
                {i === 0 && <td rowSpan={e.lines.length}>{['draft', 'validated'].includes(e.status) && e.kind === 'transaction' && <input type="checkbox" name="entryId" value={e.id} defaultChecked={e.status === 'draft'} />}</td>}
                {i === 0 && <td rowSpan={e.lines.length} style={{ whiteSpace: 'nowrap' }}>{e.entryDate}</td>}
                {i === 0 && <td rowSpan={e.lines.length} className="mono small">{e.transactionId ? <Link href={`/transactions/${e.transactionId}`}>{e.referenceNr}</Link> : <Link href="/closing">{e.referenceNr}</Link>}</td>}
                {i === 0 && <td rowSpan={e.lines.length} className="small">{e.description}</td>}
                <td className="small">{keyLabel(l.debitKey)}</td><td className="small">{keyLabel(l.creditKey)}</td>
                <td className="num"><Money value={l.amountChf} /></td>
                {i === 0 && <td rowSpan={e.lines.length}><StatusBadge status={e.status} label={t(`status.${e.status}` as never)} />
                  {e.lastSyncError && <div className="small neg">{e.lastSyncError}</div>}</td>}
              </tr>
            )))}</tbody>
          </table></div>
        )}
        <p className="small muted">{t('acc.validatedOnly')}</p>
      </form>

      {run?.status === 'complete' && Array.isArray(run.roundingLedger) && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t('acc.rounding')}</h2>
          <p className="small muted">{fill(t('acc.roundingIntro'), { date: date(run.createdAt) })}</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('acc.col.account')}</th><th className="num">{t('acc.col.exact')}</th><th className="num">{t('acc.col.booked')}</th><th className="num">{t('acc.col.carried')}</th></tr></thead>
            <tbody>{(run.roundingLedger as { key: string; exactChf: string; bookedChf: string; carriedChf: string }[]).map((r) => (
              <tr key={r.key}><td className="small">{keyLabel(r.key)}</td><td className="num mono small">{r.exactChf}</td><td className="num"><Money value={r.bookedChf} /></td>
                <td className="num mono small">{r.carriedChf === '0' ? '0' : r.carriedChf}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {run?.status === 'complete' && !Array.isArray(run.roundingLedger) && issues.some((i) => i.code === 'not_bookable') && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t('acc.rounding')}</h2>
          <p className="small muted">{t('acc.roundingUnavailable')}</p>
        </div>
      )}

      <div className="grid grid-2">
        <form action={importRatesAction} className="card stack">
          <h2>{t('acc.rates')}</h2>
          <p className="small muted">{t('acc.ratesIntro')}</p>
          <input type="file" name="file" accept=".csv,text/csv" required />
          <label className="inline"><input type="checkbox" name="replace" /> {t('acc.replace')}</label>
          <button className="btn" type="submit">{t('acc.ratesImport')}</button>
          <p className="small muted">{process.env.COINGECKO_API_KEY ? t('acc.coingeckoOn') : t('acc.coingeckoOff')}</p>
        </form>
        <div className="card">
          <h2>{rates.length ? fill(t('acc.last30'), { title: t('acc.rates') }) : t('acc.rates')}</h2>
          {rates.length === 0 ? <p className="muted">{t('common.none')}</p> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.asset')}</th><th>{t('common.date')}</th><th className="num">CHF</th><th>{t('common.source')}</th></tr></thead>
              <tbody>{rates.map((r) => <tr key={r.id}><td>{r.asset}</td><td>{r.rateDate}</td><td className="num mono">{normalizeNumeric(r.rate)}</td>
                <td className="small">{r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.source}</a> : r.source}</td></tr>)}</tbody></table></div>
          )}
        </div>
      </div>
    </div>
  );
}
