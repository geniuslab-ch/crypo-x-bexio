import Link from 'next/link';
import { Money, StatusBadge } from './ui';
import type { LoadedTx } from '@/server/services/transactions';
import { effectiveClassification, normalizeNumeric } from '@/server/services/transactions';

export function TxTable({ rows, t, cls, date, selectable }: {
  rows: LoadedTx[];
  t: (k: never) => string;
  cls: (c: string) => string;
  date: (d: Date) => string;
  selectable?: boolean;
}) {
  const tt = t as unknown as (k: string) => string;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr>
        {selectable && <th />}
        <th>{tt('common.date')}</th><th>{tt('common.source')}</th><th>{tt('tx.type')}</th><th>{tt('tx.legs')}</th>
        <th className="num">{tt('common.valueChf')}</th><th>{tt('tx.fees')}</th><th>{tt('tx.classification')}</th><th>{tt('common.status')}</th>
      </tr></thead>
      <tbody>{rows.map((l) => {
        const main = l.movements.filter((m) => m.direction !== 'fee');
        const fees = l.movements.filter((m) => m.direction === 'fee');
        const value = main.find((m) => m.chfValue)?.chfValue ?? null;
        const missing = Array.isArray(l.tx.rateMissing) && (l.tx.rateMissing as string[]).length > 0;
        return (
          <tr key={l.tx.id}>
            {selectable && <td><input type="checkbox" name="txId" value={l.tx.id} defaultChecked={Number(l.tx.confidence) >= 0.5} /></td>}
            <td style={{ whiteSpace: 'nowrap' }}><Link href={`/transactions/${l.tx.id}`}>{date(l.tx.occurredAt)}</Link></td>
            <td>{l.sourceLabel}</td>
            <td className="mono">{l.tx.rawType}</td>
            <td>{main.length === 0 ? <span className="muted">—</span> : main.map((m) => (
              <div key={m.id} className="mono">{m.direction === 'in' ? '+' : '−'}{normalizeNumeric(m.quantity)} {m.asset}</div>
            ))}</td>
            <td className="num">{value ? <Money value={value} /> : '—'}</td>
            <td>{fees.map((f) => <div key={f.id} className="mono small">{normalizeNumeric(f.quantity)} {f.asset}{f.derived ? ' *' : ''}</div>)}</td>
            <td>{cls(effectiveClassification(l.tx))}<div className="small muted">{Math.round(Number(l.tx.confidence) * 100)}%{l.tx.manualClassification ? ' · ✎' : ''}</div></td>
            <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <StatusBadge status={l.tx.reviewStatus} label={l.tx.reviewStatus === 'ok' ? tt('tx.ok') : tt('tx.needsReview')} />
              {missing && <StatusBadge status="sync_failed" label={tt('tx.rateMissing')} />}
            </td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}
