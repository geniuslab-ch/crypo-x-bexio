import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { importRatesAction, runCalculationAction, validateEntriesAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { Money, StatusBadge } from '@/components/ui';
import { ACCOUNT_KEY_LABELS } from '@/i18n/dictionaries';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { priceRates } from '@/server/db/schema';
import { getPolicy, latestRun, listEntries, type RunIssue } from '@/server/services/calculation';
import { normalizeNumeric } from '@/server/services/transactions';

const keyLabel = (k: string) => ACCOUNT_KEY_LABELS[k]?.fr ?? (k.startsWith('crypto_asset:') ? `Crypto ${k.slice(13)}` : k.startsWith('fiat_clearing:') ? `Fiat ${k.slice(14)} (exchange)` : k);

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; show?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date } = await getI18n();
  const [policy, run, entries, rates] = await Promise.all([
    getPolicy(ctx), latestRun(ctx), listEntries(ctx),
    ctx.db.select().from(priceRates).where(eq(priceRates.orgId, ctx.orgId)).orderBy(desc(priceRates.rateDate)).limit(30),
  ]);
  const visible = entries.filter((e) => (sp.show === 'all' ? true : e.status !== 'superseded'));
  const issues = (run?.issues as RunIssue[] | undefined) ?? [];
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('acc.title')}</h1><p className="subtitle">{t('acc.method')} : <b>{policy.costBasisMethod.toUpperCase()}</b> · {t('acc.fees')} : {t(`acc.fees.${policy.tradingFeeTreatment}` as never)} · {' '}
          {policy.reviewedByFiduciaryAt ? <span className="badge badge-ok">{t('acc.reviewed')} {date(policy.reviewedByFiduciaryAt)}</span> : <span className="badge badge-warn">{t('acc.notReviewed')}</span>}</p></div>
        <form action={runCalculationAction}><button className="btn btn-primary" type="submit">{t('acc.run')}</button></form>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

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
            <Link className="small" href={sp.show === 'all' ? '/accounting' : '/accounting?show=all'}>{sp.show === 'all' ? 'Masquer les remplacées' : 'Afficher l’historique complet'}</Link>
            <button className="btn" type="submit" name="mode" value="unvalidate">{t('acc.unvalidateSelected')}</button>
            <button className="btn btn-primary" type="submit" name="mode" value="validate">{t('acc.validateSelected')}</button>
          </div>
        </div>
        {visible.length === 0 ? <p className="muted">{t('acc.noEntries')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th /><th>{t('common.date')}</th><th>Référence</th><th>Libellé</th><th>{t('acc.debit')}</th><th>{t('acc.credit')}</th><th className="num">{t('acc.amount')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>{visible.map((e) => e.lines.map((l, i) => (
              <tr key={l.id}>
                {i === 0 && <td rowSpan={e.lines.length}>{['draft', 'validated'].includes(e.status) && <input type="checkbox" name="entryId" value={e.id} defaultChecked={e.status === 'draft'} />}</td>}
                {i === 0 && <td rowSpan={e.lines.length} style={{ whiteSpace: 'nowrap' }}>{e.entryDate}</td>}
                {i === 0 && <td rowSpan={e.lines.length} className="mono small"><Link href={`/transactions/${e.transactionId}`}>{e.referenceNr}</Link></td>}
                {i === 0 && <td rowSpan={e.lines.length} className="small">{e.description}</td>}
                <td className="small">{keyLabel(l.debitKey)}</td><td className="small">{keyLabel(l.creditKey)}</td>
                <td className="num"><Money value={l.amountChf} /></td>
                {i === 0 && <td rowSpan={e.lines.length}><StatusBadge status={e.status} label={t(`status.${e.status}` as never)} />
                  {e.lastSyncError && <div className="small neg">{e.lastSyncError}</div>}</td>}
              </tr>
            )))}</tbody>
          </table></div>
        )}
        <p className="small muted">Seules les écritures validées peuvent être envoyées à bexio. Une écriture validée n’est jamais modifiée automatiquement.</p>
      </form>

      <div className="grid grid-2">
        <form action={importRatesAction} className="card stack">
          <h2>{t('acc.rates')}</h2>
          <p className="small muted">{t('acc.ratesIntro')}</p>
          <input type="file" name="file" accept=".csv,text/csv" required />
          <label className="inline"><input type="checkbox" name="replace" /> {t('acc.replace')}</label>
          <button className="btn" type="submit">{t('acc.ratesImport')}</button>
          <p className="small muted">CoinGecko : {process.env.COINGECKO_API_KEY ? 'configuré, les cours manquants sont récupérés automatiquement et enregistrés ici avec leur source.' : 'non configuré (COINGECKO_API_KEY). Aucun cours n’est inventé : importez vos cours documentés.'}</p>
        </form>
        <div className="card">
          <h2>{rates.length ? `${t('acc.rates')} (30 derniers)` : t('acc.rates')}</h2>
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
