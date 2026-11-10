import { Flash } from '@/components/Flash';
import { TxTable } from '@/components/TxTable';
import { CLASSIFICATIONS } from '@/core/types';
import { zurichDate } from '@/core/valuation/rateTable';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { listSources } from '@/server/services/imports';
import { effectiveClassification, loadTransactions } from '@/server/services/transactions';

type SP = { q?: string; source?: string; cls?: string; status?: string; from?: string; to?: string; ok?: string; error?: string };
const PAGE = 500;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, cls, date } = await getI18n();
  const [all, sources] = await Promise.all([loadTransactions(ctx), listSources(ctx)]);
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = all.filter((l) => {
    if (sp.source && l.tx.sourceId !== sp.source) return false;
    if (sp.cls && effectiveClassification(l.tx) !== sp.cls) return false;
    if (sp.status === 'needs_review' && l.tx.reviewStatus !== 'needs_review') return false;
    if (sp.status === 'rate_missing' && !((l.tx.rateMissing as string[]).length > 0)) return false;
    const d = zurichDate(l.tx.occurredAt);
    if (sp.from && d < sp.from) return false;
    if (sp.to && d > sp.to) return false;
    if (q) {
      const hay = [l.tx.externalId, l.tx.txHash, l.tx.rawType, l.sourceLabel, ...l.movements.map((m) => m.asset)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).reverse();
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !['ok', 'error'].includes(k)) as [string, string][]).toString();
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('tx.title')}</h1><p className="subtitle">{rows.length} / {all.length}</p></div>
        <a className="btn" href={`/api/reports/transactions?format=csv&${qs}`}>{t('tx.export')}</a>
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <form className="card form-grid" method="get">
        <label>{t('common.search')}<input name="q" defaultValue={sp.q} placeholder="BTC, ID, hash…" /></label>
        <label>{t('common.source')}<select name="source" defaultValue={sp.source ?? ''}><option value="">{t('common.all')}</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>{t('tx.classification')}<select name="cls" defaultValue={sp.cls ?? ''}><option value="">{t('common.all')}</option>
          {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{cls(c)}</option>)}</select></label>
        <label>{t('common.status')}<select name="status" defaultValue={sp.status ?? ''}><option value="">{t('common.all')}</option>
          <option value="needs_review">{t('tx.needsReview')}</option><option value="rate_missing">{t('tx.rateMissing')}</option></select></label>
        <label>{t('common.from')}<input type="date" name="from" defaultValue={sp.from} /></label>
        <label>{t('common.to')}<input type="date" name="to" defaultValue={sp.to} /></label>
        <button className="btn btn-dark" type="submit">{t('common.filter')}</button>
      </form>
      <div className="card">
        {rows.length === 0 ? <p className="muted">{t('tx.empty')}</p> : <TxTable rows={rows.slice(0, PAGE)} t={t as never} cls={cls} date={date} />}
        {rows.length > PAGE && <p className="small muted">{PAGE} / {rows.length} — affinez les filtres ou exportez en CSV.</p>}
        <p className="small muted">* frais dérivé : écart entre le montant retiré et le montant reçu lors d’un transfert entre vos comptes.</p>
      </div>
    </div>
  );
}
