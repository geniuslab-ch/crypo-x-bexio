import { createSourceAction, importFileAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { StatusBadge } from '@/components/ui';
import { IMPORTERS, INTEGRATIONS } from '@/core/importers';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { listBatches, listSources } from '@/server/services/imports';

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date } = await getI18n();
  const [sources, batches] = await Promise.all([listSources(ctx), listBatches(ctx)]);
  const label = (id: string) => sources.find((s) => s.id === id)?.label ?? '—';
  const sl = (s: string) => t(`support.${s}` as never);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('src.title')}</h1><p className="subtitle">{t('src.security')}</p></div></div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-2">
        <form action={importFileAction} className="card stack">
          <h2>{t('src.import')}</h2>
          {sources.length === 0 ? <p className="muted">{t('src.add')} ↓</p> : <>
            <label>{t('common.source')}<select name="sourceId" required>{sources.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.provider})</option>)}</select></label>
            <label>{t('src.parser')}<select name="parserId" defaultValue="">
              <option value="">{t('src.autodetect')}</option>
              {IMPORTERS.map((i) => <option key={i.id} value={i.id}>{i.label} — {sl(i.support)}</option>)}
            </select></label>
            <label>{t('src.file')}<input type="file" name="file" accept=".csv,text/csv" required /></label>
            <button className="btn btn-primary" type="submit">{t('src.import')}</button>
          </>}
          <p className="small muted"><a href="/api/template">{t('src.template')}</a> · CSV, UTF-8. Les formats « partiels » refusent un fichier non reconnu au lieu de deviner.</p>
        </form>

        <form action={createSourceAction} className="card stack">
          <h2>{t('src.add')}</h2>
          <label>{t('src.provider')}<select name="provider" required>{INTEGRATIONS.map((i) => <option key={i.provider} value={i.provider}>{i.label}</option>)}</select></label>
          <label>{t('src.label')}<input name="label" required maxLength={120} placeholder="Kraken – compte société" /></label>
          <label>Type<select name="kind"><option value="exchange">{t('src.kind.exchange')}</option><option value="wallet">{t('src.kind.wallet')}</option></select></label>
          <button className="btn" type="submit">{t('src.add')}</button>
          {sources.length > 0 && <div className="small">{sources.map((s) => <div key={s.id}>• {s.label} <span className="muted">({s.provider}) · {s.lastSyncedAt ? date(s.lastSyncedAt) : t('common.never')}</span></div>)}</div>}
        </form>
      </div>

      <div className="card">
        <h2>{t('src.batches')}</h2>
        {batches.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.date')}</th><th>{t('common.source')}</th><th>{t('src.file')}</th><th>{t('src.parser')}</th><th className="num">{t('src.imported')}</th><th className="num">{t('src.duplicates')}</th><th>{t('src.issues')}</th></tr></thead>
            <tbody>{batches.map((b) => {
              const issues = b.issues as { rowNumber: number; message: string }[];
              return (
                <tr key={b.id}><td>{date(b.createdAt)}</td><td>{label(b.sourceId)}</td><td className="mono">{b.fileName}</td><td className="mono small">{b.parserId}</td>
                  <td className="num">{b.importedCount}</td><td className="num">{b.duplicateCount}</td>
                  <td>{issues.length === 0 ? '—' : <details><summary>{issues.length}</summary>{issues.map((i) => <div key={`${i.rowNumber}${i.message}`} className="small">L{i.rowNumber} : {i.message}</div>)}</details>}</td></tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>{t('src.matrix')}</h2>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('src.provider')}</th><th>{t('src.csv')}</th><th>{t('src.api')}</th><th /></tr></thead>
          <tbody>{INTEGRATIONS.map((i) => (
            <tr key={i.provider}><td><b>{i.label}</b></td><td><StatusBadge status={i.csv} label={sl(i.csv)} /></td><td><StatusBadge status={i.api} label={sl(i.api)} /></td><td className="small muted">{i.note}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
