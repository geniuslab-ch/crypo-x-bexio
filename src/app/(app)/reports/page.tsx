import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';

const REPORTS = [
  ['transactions', 'rep.transactions'], ['realized', 'rep.realized'], ['holdings', 'rep.holdings'],
  ['journal', 'rep.journal'], ['income', 'rep.income'], ['fees', 'rep.fees'],
] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  await requireCtx();
  const { t } = await getI18n();
  const now = new Date().getFullYear();
  const year = sp.year && /^\d{4}$/.test(sp.year) ? sp.year : String(now - 1);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('rep.title')}</h1><p className="subtitle">{t('set.disclaimer')}</p></div>
        <form method="get" className="row"><label>{t('rep.year')}<select name="year" defaultValue={year}>
          {Array.from({ length: 8 }, (_, i) => String(now - i)).map((y) => <option key={y} value={y}>{y}</option>)}<option value="all">{t('common.all')}</option>
        </select></label><button className="btn" type="submit">OK</button></form>
      </div>
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
      <div className="alert alert-info small">{t('rep.pdfNote')}</div>
    </div>
  );
}
