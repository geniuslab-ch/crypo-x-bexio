export function StatusBadge({ status, label }: { status: string; label: string }) {
  const cls = status === 'synced' || status === 'ok' || status === 'complete' || status === 'supported' ? 'badge-ok'
    : status === 'validated' || status === 'partial' ? 'badge-gold'
    : status === 'sync_failed' || status === 'blocked' || status === 'unavailable' ? 'badge-bad'
    : status === 'needs_review' || status === 'draft' ? 'badge-warn' : 'badge-grey';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Money({ value, signed }: { value: string | null | undefined; signed?: boolean }) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  const n = Number(value);
  const s = new Intl.NumberFormat('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return <span className={signed ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : ''}>CHF {signed && n > 0 ? '+' : ''}{s}</span>;
}

export function Qty({ value }: { value: string }) {
  return <span className="mono">{value}</span>;
}
