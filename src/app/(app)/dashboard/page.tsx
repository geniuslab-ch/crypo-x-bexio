import Link from 'next/link';
import { Money } from '@/components/ui';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { dashboardStats } from '@/server/services/dashboard';

export default async function Dashboard() {
  const { ctx } = await requireCtx();
  const { t, date } = await getI18n();
  const s = await dashboardStats(ctx);
  const steps = [
    { label: t('step.import'), done: s.transactions > 0, href: '/sources', note: `${s.transactions} transactions` },
    { label: t('step.classify'), done: s.transactions > 0 && s.awaitingReview === 0 && s.rateMissing === 0, href: '/review', note: `${s.awaitingReview} ${t('tx.needsReview').toLowerCase()}` },
    { label: t('step.calculate'), done: s.run?.status === 'complete', href: '/accounting', note: s.run ? (s.run.status === 'complete' ? t('acc.complete') : t('acc.blocked')) : '—' },
    { label: t('step.validate'), done: s.entries.draft === 0 && s.entries.validated + s.entries.synced > 0, href: '/accounting', note: `${s.entries.draft} ${t('status.draft').toLowerCase()}` },
    { label: t('step.sync'), done: s.entries.synced > 0 && s.entries.validated === 0 && s.entries.failed === 0, href: '/bexio', note: `${s.entries.synced} ${t('status.synced').toLowerCase()}` },
  ];
  const maxCost = Math.max(1, ...s.assets.map((a) => Number(a.cost)));
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('dash.title')}</h1><p className="subtitle">{t('app.tagline')}</p></div>
        <Link href="/sources" className="btn btn-primary">{t('src.import')}</Link>
      </div>

      {s.transactions === 0 && <div className="alert alert-info">{t('dash.empty')}</div>}

      <div className="card">
        <h2>{t('dash.workflow')}</h2>
        <div className="steps">
          {steps.map((st, i) => (
            <Link key={st.label} href={st.href} className={`step ${st.done ? 'done' : s.transactions ? 'todo' : ''}`} style={{ textDecoration: 'none' }}>
              <b>{i + 1}. {st.label} {st.done ? '✓' : ''}</b><span className="muted">{st.note}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="label">{t('dash.value')}</div><div className="value">{s.totalValue ? <Money value={s.totalValue} /> : '—'}</div>
          <div className="hint">{s.totalValue ? '' : t('dash.missingPrice')}</div></div>
        <div className="card kpi"><div className="label">{t('dash.cost')}</div><div className="value"><Money value={s.totalCost} /></div></div>
        <div className="card kpi"><div className="label">{t('dash.realized')} {s.year}</div><div className="value">{s.realizedYtd ? <Money value={s.realizedYtd} signed /> : '—'}</div>
          <div className="hint">{s.realizedYtd ? '' : t('acc.blocked')}</div></div>
        <div className="card kpi"><div className="label">{t('dash.unrealized')}</div><div className="value">{s.totalUnrealized ? <Money value={s.totalUnrealized} signed /> : '—'}</div></div>
      </div>

      <div className="grid grid-4">
        <Link href="/review" className="card kpi" style={{ textDecoration: 'none' }}><div className="label">{t('dash.review')}</div><div className="value">{s.awaitingReview}</div>
          <div className="hint">{s.rateMissing} · {t('dash.rateMissing')}</div></Link>
        <Link href="/accounting" className="card kpi" style={{ textDecoration: 'none' }}><div className="label">{t('dash.toValidate')}</div><div className="value">{s.entries.draft}</div>
          <div className="hint">{s.entries.failed ? `${s.entries.failed} ${t('status.sync_failed').toLowerCase()}` : ''}</div></Link>
        <div className="card kpi"><div className="label">{t('dash.lastImport')}</div><div className="value" style={{ fontSize: 16 }}>{s.lastImportAt ? date(s.lastImportAt) : t('common.never')}</div></div>
        <Link href="/bexio" className="card kpi" style={{ textDecoration: 'none' }}><div className="label">{t('dash.lastBexio')}</div>
          <div className="value" style={{ fontSize: 16 }}>{s.bexio.connected ? (s.bexio.lastSyncAt ? date(s.bexio.lastSyncAt) : t('common.never')) : t('bx.notConnected')}</div>
          <div className="hint">{s.bexio.company ?? ''}</div></Link>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="label">{t('dash.income')} {s.year}</div><div className="value"><Money value={s.incomeYtd} /></div></div>
        <Link href={`/reconciliation?date=${s.reconciliation.date}`} className="card kpi" style={{ textDecoration: 'none' }}>
          <div className="label">{t('dash.reconciliation')} {s.reconciliation.date.split('-').reverse().join('.')}</div>
          <div className="value">{s.reconciliation.gaps ? <span className="neg">{s.reconciliation.gaps} {t('rec.gap').toLowerCase()}</span> : s.reconciliation.ok ? '✓' : '—'}</div>
          <div className="hint">{s.reconciliation.ok} {t('rec.ok').toLowerCase()} · {s.reconciliation.notReported} {t('rec.notReported').toLowerCase()}</div></Link>
        <Link href="/closing" className="card kpi" style={{ textDecoration: 'none' }}><div className="label">{t('dash.closing')} {s.year - 1}</div>
          <div className="value" style={{ fontSize: 16 }}>{s.closedYear !== null && s.closedYear >= s.year - 1 ? `✓ ${t('clo.closed').toLowerCase()}` : t('dash.notClosed')}</div></Link>
      </div>

      <div className="card">
        <h2>{t('dash.holdings')}</h2>
        {s.assets.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.asset')}</th><th className="num">{t('common.quantity')}</th><th className="num">{t('dash.cost')}</th><th style={{ width: '30%' }} />
              <th className="num">{t('common.valueChf')}</th><th className="num">{t('dash.unrealized')}</th></tr></thead>
            <tbody>{s.assets.map((a) => (
              <tr key={a.asset}>
                <td><b>{a.asset}</b></td><td className="num mono">{a.quantity}</td><td className="num"><Money value={a.cost} /></td>
                <td><div className="bar"><span style={{ width: `${(Number(a.cost) / maxCost) * 100}%` }} /></div></td>
                <td className="num">{a.value ? <Money value={a.value} /> : <span className="badge badge-warn">{t('tx.rateMissing')}</span>}</td>
                <td className="num">{a.unrealized ? <Money value={a.unrealized} signed /> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>{t('set.disclaimer')}</p>
      </div>
    </div>
  );
}
