import Link from 'next/link';
import { addOpeningBalancesAction, closeYearAction, deleteOpeningBalanceAction, reopenYearAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { Money, StatusBadge } from '@/components/ui';
import { isRateBasis, isValuationMethod, RATE_BASES, VALUATION_METHODS } from '@/core/accounting/closing';
import { ACCOUNT_KEY_LABELS } from '@/i18n/dictionaries';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/ui';
import { requireCtx } from '@/server/auth/next';
import { calculationIsExcluding, listClosings, listOpeningBalances, previewClosing } from '@/server/services/closing';
import { listSources } from '@/server/services/imports';

export default async function ClosingPage({ searchParams }: {
  searchParams: Promise<{ year?: string; method?: string; basis?: string; preview?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date, locale } = await getI18n();
  const now = new Date().getFullYear();
  const year = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : now - 1;
  const method = isValuationMethod(sp.method) ? sp.method : 'lower_of_cost';
  const basis = isRateBasis(sp.basis) ? sp.basis : 'market_rate';
  const [closings, openings, srcs, excluded] = await Promise.all([listClosings(ctx), listOpeningBalances(ctx), listSources(ctx), calculationIsExcluding(ctx)]);
  const preview = await previewClosing(ctx, year, method, basis, { fetchMissing: sp.preview === '1' && ctx.role !== 'viewer' });
  const sourceName = new Map(srcs.map((s) => [s.id, s.label]));
  const keyLabel = (k: string) => {
    const at = k.indexOf('@');
    const base = at === -1 ? k : k.slice(0, at);
    const label = ACCOUNT_KEY_LABELS[base]?.[locale] ?? (base.startsWith('crypto_asset:') ? `Crypto ${base.slice(13)}` : base);
    return at === -1 ? label : `${label} · ${sourceName.get(k.slice(at + 1)) ?? 'wallet'}`;
  };
  const lastClosed = closings.find((c) => c.status === 'closed')?.year ?? null;
  const openingYear = openings[0] ? Number(openings[0].occurredAt.toISOString().slice(0, 4)) + 1 : now;

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('clo.title')}</h1><p className="subtitle">{t('clo.subtitle')}</p></div>
      </div>
      <Flash ok={sp.ok} error={sp.error} locale={locale} />

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('clo.years')}</h2>
        {closings.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('rep.year')}</th><th>{t('common.status')}</th><th>{t('clo.method')}</th><th>{t('clo.basis')}</th><th>{t('common.date')}</th><th /></tr></thead>
            <tbody>{closings.map((c) => (
              <tr key={c.id}>
                <td><b>{c.year}</b></td>
                <td><StatusBadge status={c.status === 'closed' ? 'synced' : 'draft'} label={c.status === 'closed' ? t('clo.closed') : t('clo.reopened')} /></td>
                <td className="small">{isValuationMethod(c.valuationMethod) ? t(`clo.method.${c.valuationMethod}`) : c.valuationMethod}</td>
                <td className="small">{isRateBasis(c.rateBasis) ? t(`clo.basis.${c.rateBasis}`) : c.rateBasis}</td>
                <td className="small">{date(c.closedAt)}</td>
                <td className="row">
                  {c.status === 'closed' && <a className="btn" href={`/api/reports/closing?format=xlsx&year=${c.year}`}>Excel</a>}
                  {c.status === 'closed' && c.year === lastClosed && (
                    <form action={reopenYearAction}><input type="hidden" name="year" value={c.year} /><button className="btn" type="submit">{t('clo.reopen')}</button></form>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted">{t('clo.lockNote')}</p>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('clo.prepare')}</h2>
        <form method="get" className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="preview" value="1" />
          <label>{t('rep.year')}<select name="year" defaultValue={String(year)}>
            {Array.from({ length: 8 }, (_, i) => now - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select></label>
          <label>{t('clo.method')}<select name="method" defaultValue={method}>
            {VALUATION_METHODS.map((m) => <option key={m} value={m}>{t(`clo.method.${m}`)}</option>)}
          </select></label>
          <label>{t('clo.basis')}<select name="basis" defaultValue={basis}>
            {RATE_BASES.map((b) => <option key={b} value={b}>{t(`clo.basis.${b}`)}</option>)}
          </select></label>
          <button className="btn" type="submit">{t('clo.preview')}</button>
        </form>
        <p className="small muted">{t('clo.methodHelp')}</p>

        <div className={`alert ${preview.blockers.length ? 'alert-warn' : 'alert-ok'}`}>
          <b>{preview.blockers.length ? t('clo.blocked') : t('clo.ready')}</b>
          {preview.blockers.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{preview.blockers.map((b) => <li key={b} className="small">{b}</li>)}</ul>}
        </div>

        {preview.rows.length === 0 ? <p className="muted">{fill(t('clo.noHoldings'), { year })}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.asset')}</th><th>{t('acc.col.account')}</th><th className="num">{t('common.quantity')}</th><th className="num">{t('clo.colBook')}</th><th className="num">{t('clo.perUnit')}</th>
              <th className="num">{t('clo.colMarket')}</th><th className="num">{t('clo.colAdj')}</th><th>{t('common.source')}</th></tr></thead>
            <tbody>{preview.rows.map((r) => (
              <tr key={r.key}>
                <td>{r.asset}</td><td className="small">{keyLabel(r.key)}</td><td className="num mono small">{r.quantity}</td>
                <td className="num"><Money value={r.bookValue} /></td><td className="num mono small">{r.rate ?? '—'}</td>
                <td className="num"><Money value={r.marketValue} /></td><td className="num"><Money value={r.adjustment} signed /></td>
                <td className="small">{r.rateSource ?? <span className="neg">{t('clo.missing')}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}

        {preview.lines.length > 0 && (
          <div className="small">
            <b>{t('clo.generated')}</b> {t('clo.generatedNote')}
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {preview.lines.map((l) => <li key={`${l.debitKey}${l.creditKey}`}>31.12.{year} · {keyLabel(l.debitKey)} {t('clo.to')} {keyLabel(l.creditKey)} · CHF {l.amount}</li>)}
              <li>01.01.{year + 1} · {t('clo.reversal')}</li>
            </ul>
            {t('clo.mapFirst')} <Link href="/bexio">{t('nav.bexio')}</Link>.
          </div>
        )}

        {ctx.role !== 'viewer' && preview.blockers.length === 0 && (
          <form action={closeYearAction}>
            <input type="hidden" name="year" value={year} /><input type="hidden" name="method" value={method} /><input type="hidden" name="basis" value={basis} />
            <button className="btn btn-primary" type="submit">{t('clo.close')} {year}</button>
          </form>
        )}
      </div>

      <div className="card stack" id="opening">
        <h2 style={{ margin: 0 }}>{t('clo.opening')}</h2>
        <p className="small muted">{t('clo.openingHelp')}</p>
        {excluded > 0 && <div className="alert alert-info small">{fill(t('clo.excluded'), { n: excluded })}</div>}
        {openings.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.date')}</th><th>{t('common.source')}</th><th>{t('common.asset')}</th><th className="num">{t('common.quantity')}</th><th className="num">{t('clo.costChf')}</th><th /></tr></thead>
            <tbody>{openings.map((o) => (
              <tr key={o.id}>
                <td>01.01.{Number(o.occurredAt.toISOString().slice(0, 4)) + 1}</td><td className="small">{o.sourceLabel}</td><td>{o.asset}</td>
                <td className="num mono small">{o.quantity}</td><td className="num"><Money value={o.costChf} /></td>
                <td>{ctx.role !== 'viewer' && <form action={deleteOpeningBalanceAction}><input type="hidden" name="txId" value={o.id} /><button className="btn" type="submit">{t('clo.delete')}</button></form>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {ctx.role !== 'viewer' && (srcs.length === 0 ? <p className="muted small">{t('clo.addSourcesFirst')} <Link href="/sources">{t('nav.sources')}</Link>.</p> : (
          <form action={addOpeningBalancesAction} className="stack">
            <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label>{t('clo.atJan1')}<select name="openingYear" defaultValue={String(openingYear)}>
                {Array.from({ length: 8 }, (_, i) => now + 1 - i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select></label>
              <label>{t('common.source')}<select name="sourceId">{srcs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
              <label>{t('common.asset')}<input name="asset" placeholder="BTC" style={{ width: 90 }} /></label>
              <label>{t('common.quantity')}<input name="quantity" inputMode="decimal" placeholder="0.5" style={{ width: 130 }} /></label>
              <label>{t('clo.acqCost')}<input name="costChf" inputMode="decimal" placeholder="12000.00" style={{ width: 140 }} /></label>
            </div>
            <label className="small">{t('clo.csvHint')} <span className="mono">source,asset,quantity,cost_chf</span>, {t('clo.csvHint2')} <input type="file" name="file" accept=".csv,text/csv" /></label>
            <div><button className="btn btn-primary" type="submit">{t('clo.openingAdd')}</button></div>
          </form>
        ))}
      </div>
    </div>
  );
}
