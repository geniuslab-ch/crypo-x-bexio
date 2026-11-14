import { deleteReportedBalanceAction, saveReportedBalancesAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { StatusBadge } from '@/components/ui';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/ui';
import { requireCtx } from '@/server/auth/next';
import { listSources } from '@/server/services/imports';
import { defaultReconciliationDate, isCalendarDate, reconcile } from '@/server/services/reconciliation';

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ date?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, locale } = await getI18n();
  const date = sp.date && isCalendarDate(sp.date) ? sp.date : defaultReconciliationDate();
  const [rows, srcs] = await Promise.all([reconcile(ctx, date), listSources(ctx)]);
  const gaps = rows.filter((r) => r.status === 'gap').length;
  const missing = rows.filter((r) => r.status === 'not_reported').length;
  const status = (s: string) => (s === 'ok' ? <StatusBadge status="ok" label={t('rec.ok')} />
    : s === 'gap' ? <StatusBadge status="sync_failed" label={t('rec.gap')} /> : <StatusBadge status="draft" label={t('rec.notReported')} />);
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('rec.title')}</h1><p className="subtitle">{t('rec.subtitle')}</p></div>
        <form method="get" className="row"><label>{t('common.date')}<input type="date" name="date" defaultValue={date} /></label><button className="btn" type="submit">OK</button></form>
      </div>
      <Flash ok={sp.ok} error={sp.error} locale={locale} />

      <div className={`alert ${gaps ? 'alert-bad' : missing ? 'alert-warn' : 'alert-ok'}`}>
        <b>{gaps ? `${gaps} ${t('rec.gaps')}` : missing ? `${missing} ${t('rec.missing')}` : t('rec.allOk')}</b>
        <div className="small">{t('rec.gapHint')}</div>
      </div>

      <div className="card">
        {rows.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.source')}</th><th>{t('common.asset')}</th><th className="num">{t('rec.computed')}</th><th className="num">{t('rec.reported')}</th>
              <th className="num">{t('rec.difference')}</th><th>{t('common.status')}</th><th>{t('rec.evidence')}</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.sourceId}${r.asset}`}>
                <td className="small">{r.sourceLabel}</td><td>{r.asset}</td><td className="num mono small">{r.computed}</td>
                <td className="num mono small">{r.reported ?? '—'}</td>
                <td className={`num mono small ${r.status === 'gap' ? 'neg' : ''}`}>{r.difference ?? '—'}</td>
                <td>{status(r.status)}</td><td className="small">{r.evidence ?? ''}</td>
                <td>{r.reportedId && ctx.role !== 'viewer' && (
                  <form action={deleteReportedBalanceAction}><input type="hidden" name="id" value={r.reportedId} /><input type="hidden" name="date" value={date} /><button className="btn" type="submit">×</button></form>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted">{fill(t('rec.calcNote'), { date })}</p>
      </div>

      {ctx.role !== 'viewer' && srcs.length > 0 && (
        <form action={saveReportedBalancesAction} className="card stack">
          <h2 style={{ margin: 0 }}>{t('rec.add')}</h2>
          <input type="hidden" name="date" value={date} />
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label>{t('common.source')}<select name="sourceId">{srcs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            <label>{t('common.asset')}<input name="asset" placeholder="BTC" style={{ width: 90 }} /></label>
            <label>{t('rec.reported')} ({date})<input name="quantity" inputMode="decimal" placeholder="0.029985" style={{ width: 160 }} /></label>
            <label>{t('rec.evidence')}<input name="evidence" maxLength={200} placeholder={t('rec.evidencePh')} /></label>
          </div>
          <label className="small">Ou un fichier CSV (colonnes <span className="mono">source,asset,date,balance,evidence</span>, « source » = nom du wallet ou de l’exchange dans Crypto2Books) <input type="file" name="file" accept=".csv,text/csv" /></label>
          <div><button className="btn btn-primary" type="submit">{t('rec.save')}</button></div>
        </form>
      )}
    </div>
  );
}
