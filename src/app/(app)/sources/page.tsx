import { connectSourceAction, createSourceAction, disconnectSourceAction, importFileAction, syncSourceAction } from '@/app/actions';
import { Flash, flashText } from '@/components/Flash';
import { StatusBadge } from '@/components/ui';
import { IMPORTERS, INTEGRATIONS } from '@/core/importers';
import { localizedGuides } from '@/core/importers/guides';
import { connectorText, integrationLabel, integrationNote } from '@/i18n/content';
import { FormatPicker } from '@/components/FormatPicker';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { connectorFor } from '@/integrations/sources';
import { listBatches, listSources } from '@/server/services/imports';
import { maskedCredentials } from '@/server/services/sync';

/** A sync run may take up to ~45 s against the provider's API. */
export const maxDuration = 60;

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date, locale } = await getI18n();
  const [sources, batches] = await Promise.all([listSources(ctx), listBatches(ctx)]);
  const label = (id: string) => sources.find((s) => s.id === id)?.label ?? '—';
  const sl = (s: string) => t(`support.${s}` as never);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('src.title')}</h1><p className="subtitle">{t('src.security')}</p></div></div>
      <Flash ok={sp.ok} error={sp.error} locale={locale} />

      <div className="grid grid-2">
        <form action={importFileAction} className="card stack">
          <h2>{t('src.import')}</h2>
          {sources.length === 0 ? <p className="muted">{t('src.add')} ↓</p> : <>
            <label>{t('common.source')}<select name="sourceId" required>{sources.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.provider})</option>)}</select></label>
            <FormatPicker label={t('src.parser')} autoLabel={t('src.autodetect')} guides={localizedGuides(locale)}
              texts={{ columns: t('fmt.columns'), example: t('fmt.example'), auto: t('fmt.auto') }}
              options={IMPORTERS.map((i) => ({ id: i.id, label: `${i.label} — ${sl(i.support)}` }))} />
            <label>{t('src.file')}<input type="file" name="file" accept=".csv,text/csv" required /></label>
            <button className="btn btn-primary" type="submit">{t('src.import')}</button>
          </>}
          <p className="small muted"><a href="/api/template">{t('src.template')}</a> · {t('src.templateNote')}</p>
        </form>

        <form action={createSourceAction} className="card stack">
          <h2>{t('src.add')}</h2>
          <label>{t('src.provider')}<select name="provider" required>{INTEGRATIONS.map((i) => <option key={i.provider} value={i.provider}>{integrationLabel(i.label, locale)}</option>)}</select></label>
          <label>{t('src.label')}<input name="label" required maxLength={120} placeholder={t('src.labelPlaceholder')} /></label>
          <label>{t('src.type')}<select name="kind"><option value="exchange">{t('src.kind.exchange')}</option><option value="wallet">{t('src.kind.wallet')}</option></select></label>
          <button className="btn" type="submit">{t('src.add')}</button>
          <p className="small muted">{t('src.addHint')}</p>
        </form>
      </div>

      {sources.length > 0 && (
        <div className="card stack">
          <h2>{t('src.yours')}</h2>
          {sources.map((s) => {
            const base = connectorFor(s.provider);
            const c = base ? connectorText(base, locale) : undefined;
            const masked = c ? maskedCredentials(c, s.encryptedCredentials) : [];
            const connected = masked.length > 0;
            return (
              <div key={s.id} className="source-row">
                <div className="source-head">
                  <div><b>{s.label}</b> <span className="muted small">({s.provider}) · {t('src.lastSync')} : {s.lastSyncedAt ? date(s.lastSyncedAt) : t('common.never')}</span></div>
                  {connected ? <span className="badge badge-ok">{c!.kind === 'wallet' ? t('src.addressesTracked') : t('src.apiConnected')}</span>
                    : c ? <span className="badge">{t('src.notConnected')}</span> : <span className="badge">{t('src.csvImport')}</span>}
                </div>
                {s.syncNote ? (
                  <p className={`small ${s.syncNote.startsWith('failed:') ? 'neg' : 'muted'}`} style={{ margin: '4px 0 0' }}>
                    {s.syncNote.startsWith('failed:') ? `${t('src.syncFailed')} ${flashText(s.syncNote.slice(7), locale)}` : s.syncNote}
                  </p>
                ) : null}
                {c && connected ? (
                  <div className="source-actions">
                    <div className="small">{masked.map((m) => <div key={m.label}><span className="muted">{m.label} :</span> <span className="mono">{m.value}</span></div>)}</div>
                    <form action={syncSourceAction}><input type="hidden" name="sourceId" value={s.id} /><button className="btn btn-primary" type="submit">{t('src.sync')}</button></form>
                    <form action={disconnectSourceAction}><input type="hidden" name="sourceId" value={s.id} /><button className="btn" type="submit">{t('src.disconnect')}</button></form>
                  </div>
                ) : c ? (
                  <details className="source-connect" open>
                    <summary>{c.kind === 'wallet' ? t('src.addAddresses') : t('src.connectApi')}</summary>
                    <form action={connectSourceAction} className="stack" style={{ marginTop: 10 }}>
                      <input type="hidden" name="sourceId" value={s.id} />
                      <p className="small">{c.help}</p>
                      {c.fields.map((f) => (
                        <label key={f.name}>{f.label}
                          {f.multiline
                            ? <textarea name={`cred_${f.name}`} required={!f.optional} rows={f.secret ? 5 : 3} placeholder={f.placeholder} autoComplete="off" spellCheck={false} className="mono" />
                            : <input name={`cred_${f.name}`} type={f.secret ? 'password' : 'text'} required={!f.optional} placeholder={f.placeholder} autoComplete="off" spellCheck={false} />}
                        </label>
                      ))}
                      <p className="small muted">{c.limits} {t('src.keysEncrypted')}</p>
                      <button className="btn btn-primary" type="submit">{t('src.verifySave')}</button>
                    </form>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

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
            <tr key={i.provider}><td><b>{integrationLabel(i.label, locale)}</b></td><td><StatusBadge status={i.csv} label={sl(i.csv)} /></td><td><StatusBadge status={i.api} label={sl(i.api)} /></td><td className="small muted">{integrationNote(i.provider, i.note, locale)}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
