import { and, eq } from 'drizzle-orm';
import { importTaxValuesAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/ui';
import { requireCtx } from '@/server/auth/next';
import { taxValues } from '@/server/db/schema';
import { normalizeNumeric } from '@/server/services/transactions';

const REPORTS = [
  ['transactions', 'rep.transactions'], ['realized', 'rep.realized'], ['holdings', 'rep.holdings'], ['wealth', 'rep.wealth'],
  ['closing', 'rep.closing'], ['reconciliation', 'rep.reconciliation'], ['journal', 'rep.journal'], ['income', 'rep.income'], ['donations', 'rep.donations'], ['fees', 'rep.fees'],
] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, locale } = await getI18n();
  const now = new Date().getFullYear();
  const year = sp.year && /^\d{4}$/.test(sp.year) ? sp.year : String(now - 1);
  const values = await ctx.db.select().from(taxValues).where(and(eq(taxValues.orgId, ctx.orgId), eq(taxValues.taxYear, Number(year))));
  return (
    <div className="stack">
      <Flash ok={sp.ok} error={sp.error} locale={locale} />
      <div className="page-head"><div><h1>{t('rep.title')}</h1><p className="subtitle">{t('set.disclaimer')}</p></div>
        <form method="get" className="row"><label>{t('rep.year')}<select name="year" defaultValue={year}>
          {Array.from({ length: 8 }, (_, i) => String(now - i)).map((y) => <option key={y} value={y}>{y}</option>)}<option value="all">{t('common.all')}</option>
        </select></label><button className="btn" type="submit">OK</button></form>
      </div>
      {year !== 'all' && (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <div><h3>{t('rep.auditFile')} {year}</h3><p className="small muted">{t('rep.auditFileHint')}</p></div>
          <a className="btn btn-primary" href={`/api/audit-file?year=${year}`}>PDF</a>
        </div>
      )}
      <div className="grid grid-3">
        {REPORTS.map(([type, key]) => (
          <div key={type} className="card stack">
            <h3>{t(key)}</h3>
            <div className="row">
              <a className="btn btn-primary" href={`/api/reports/${type}?format=xlsx&year=${year}`}>Excel</a>
              <a className="btn" href={`/api/reports/${type}?format=csv&year=${year}`}>CSV</a>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-2">
        <form action={importTaxValuesAction} className="card stack">
          <h2>{fill(t('rep.taxValuesTitle'), { year })}</h2>
          <p className="small muted">{t('rep.taxValuesIntro1')} (<a href={locale === 'fr' ? 'https://www.ictax.admin.ch/extern/fr.html#/ratelist' : 'https://www.ictax.admin.ch/'} target="_blank" rel="noreferrer">ictax.admin.ch</a>). {t('rep.taxValuesIntro2')} <span className="mono">asset,year,value_chf,source,source_url</span>. {t('rep.example')} <span className="mono">BTC,{year},…,{t('rep.kursliste')} {year},https://www.ictax.admin.ch</span>. {t('rep.taxValuesIntro3')}</p>
          <input type="hidden" name="year" value={year} />
          <input type="file" name="file" accept=".csv,text/csv" required />
          <label className="inline"><input type="checkbox" name="replace" /> {t('rep.replaceValues')}</label>
          <button className="btn" type="submit">{t('rep.importValues')}</button>
        </form>
        <div className="card">
          <h2>{fill(t('rep.valuesFor'), { year })}</h2>
          {values.length === 0 ? <p className="muted">{t('common.none')}</p> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.asset')}</th><th className="num">CHF</th><th>{t('common.source')}</th></tr></thead>
              <tbody>{values.map((v) => <tr key={v.id}><td>{v.asset}</td><td className="num mono">{normalizeNumeric(v.valueChf)}</td>
                <td className="small">{v.sourceUrl ? <a href={v.sourceUrl} target="_blank" rel="noreferrer">{v.source}</a> : v.source}</td></tr>)}</tbody></table></div>
          )}
        </div>
      </div>
      <div className="alert alert-info small">{t('rep.pdfNote')}</div>
    </div>
  );
}
