import { confirmClassificationsAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { TxTable } from '@/components/TxTable';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { loadTransactions } from '@/server/services/transactions';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, cls, date } = await getI18n();
  const all = await loadTransactions(ctx);
  const review = all.filter((l) => l.tx.reviewStatus === 'needs_review');
  const missing = all.filter((l) => l.tx.reviewStatus === 'ok' && (l.tx.rateMissing as string[]).length > 0);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('tx.reviewTitle')}</h1><p className="subtitle">{review.length}</p></div></div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="alert alert-info">{t('tx.reviewIntro')}</div>
      <form action={confirmClassificationsAction} className="card stack">
        {review.length === 0 ? <p className="muted">{t('tx.empty')}</p> : <>
          <TxTable rows={review} t={t as never} cls={cls} date={date} selectable />
          <div className="row">
            <button className="btn btn-primary" type="submit">{t('tx.confirm')}</button>
            <span className="small muted">Confirme la classification proposée pour les lignes cochées. Pour la modifier, ouvrez la transaction.</span>
          </div>
        </>}
      </form>
      {missing.length > 0 && (
        <div className="card stack">
          <h2>{t('dash.rateMissing')} ({missing.length})</h2>
          <p className="small muted">{t('acc.ratesIntro')}</p>
          <TxTable rows={missing} t={t as never} cls={cls} date={date} />
        </div>
      )}
    </div>
  );
}
