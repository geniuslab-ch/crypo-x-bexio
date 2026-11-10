import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { classifyAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { Money, StatusBadge } from '@/components/ui';
import { CLASSIFICATIONS } from '@/core/types';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { auditLog, journalEntries } from '@/server/db/schema';
import { effectiveClassification, loadTransactions, lockedTransactionIds, normalizeNumeric } from '@/server/services/transactions';

export default async function TxDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, cls, date } = await getI18n();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [l] = await loadTransactions(ctx, [id]);
  if (!l) notFound();
  const locked = (await lockedTransactionIds(ctx)).has(id);
  const entries = await ctx.db.select().from(journalEntries).where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.transactionId, id)));
  const history = await ctx.db.select().from(auditLog).where(and(eq(auditLog.orgId, ctx.orgId), eq(auditLog.entityId, id)));
  const reasons = (l.tx.classificationReasons as string[]) ?? [];
  const current = effectiveClassification(l.tx);
  return (
    <div className="stack">
      <div className="page-head">
        <div><Link href="/transactions" className="small muted">← {t('tx.title')}</Link>
          <h1>{cls(current)}</h1><p className="subtitle">{date(l.tx.occurredAt)} · {l.sourceLabel} · <span className="mono">{l.tx.externalId ?? '—'}</span></p></div>
        <StatusBadge status={l.tx.reviewStatus} label={l.tx.reviewStatus === 'ok' ? t('tx.ok') : t('tx.needsReview')} />
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-2">
        <div className="card stack">
          <h2>{t('tx.legs')}</h2>
          <div className="table-wrap"><table className="table">
            <thead><tr><th /><th>{t('common.asset')}</th><th className="num">{t('common.quantity')}</th><th className="num">{t('tx.rate')}</th><th className="num">{t('common.valueChf')}</th><th>{t('tx.rateSource')}</th></tr></thead>
            <tbody>{l.movements.map((m) => (
              <tr key={m.id}>
                <td>{m.direction === 'in' ? '↓ in' : m.direction === 'out' ? '↑ out' : 'fee'}{m.derived ? ' *' : ''}</td>
                <td><b>{m.asset}</b></td><td className="num mono">{normalizeNumeric(m.quantity)}</td>
                <td className="num mono">{m.chfRate ? Number(m.chfRate).toLocaleString('fr-CH', { maximumFractionDigits: 6 }) : '—'}</td>
                <td className="num"><Money value={m.chfValue} /></td>
                <td className="small">{m.rateRef ?? (l.tx.classification === 'internal_transfer' && m.direction !== 'fee' ? 'non requis (transfert interne)' : <span className="badge badge-bad">{t('tx.rateMissing')}</span>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {l.tx.txHash && <p className="small">Hash : <span className="mono">{l.tx.txHash}</span></p>}
          {l.tx.transferGroupId && <p className="small muted">Transfert apparié · groupe <span className="mono">{l.tx.transferGroupId}</span></p>}
        </div>
        <div className="card stack">
          <h2>{t('tx.why')}</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="small muted">{t('tx.confidence')} : {Math.round(Number(l.tx.confidence) * 100)}% · origine : {l.tx.manualClassification ? 'manuelle' : l.tx.classificationOrigin}</p>
          <h3>{t('tx.correct')}</h3>
          {locked ? <div className="alert alert-warn">{t('tx.locked')}</div> : (
            <form action={classifyAction} className="stack">
              <input type="hidden" name="txId" value={id} />
              <select name="classification" defaultValue={current}>
                {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{cls(c)}</option>)}
              </select>
              <label className="inline"><input type="checkbox" name="remember" /> {t('tx.remember')} (<span className="mono">{l.tx.rawType}</span>)</label>
              <div className="row">
                <button className="btn btn-primary" type="submit">{t('tx.confirm')}</button>
                {l.tx.manualClassification && <button className="btn" type="submit" name="classification" value="">{t('tx.reset')}</button>}
              </div>
            </form>
          )}
        </div>
      </div>
      <div className="card stack">
        <h2>{t('tx.evidence')}</h2>
        <p className="small muted">Lignes {(l.tx.rowNumbers as number[]).join(', ')} du fichier importé.</p>
        <pre className="evidence">{JSON.stringify(l.tx.raw, null, 2)}</pre>
      </div>
      {entries.length > 0 && (
        <div className="card"><h2>{t('acc.entries')}</h2>
          {entries.map((e) => <div key={e.id} className="row"><span className="mono">{e.referenceNr}</span><StatusBadge status={e.status} label={t(`status.${e.status}` as never)} />{e.bexioManualEntryId && <span className="small muted">bexio #{e.bexioManualEntryId}</span>}</div>)}
        </div>
      )}
      {history.length > 0 && (
        <div className="card"><h2>Historique</h2>
          {history.map((h) => <div key={h.id} className="small">{date(h.createdAt)} · {h.action} · {JSON.stringify(h.before)} → {JSON.stringify(h.after)}</div>)}
        </div>
      )}
    </div>
  );
}
