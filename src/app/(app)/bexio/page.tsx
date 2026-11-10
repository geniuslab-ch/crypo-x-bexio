import { disconnectBexioAction, refreshBexioAction, saveMappingsAction, syncBexioAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { StatusBadge } from '@/components/ui';
import { ACCOUNT_KEYS } from '@/core/accounting/accountKeys';
import { ACCOUNT_KEY_LABELS } from '@/i18n/dictionaries';
import { getI18n } from '@/i18n/server';
import { bexioConfig } from '@/integrations/bexio/oauth';
import { requireCtx } from '@/server/auth/next';
import { getConnection, listBexioAccounts, listMappings, listSyncAttempts } from '@/server/services/bexio';
import { listEntries } from '@/server/services/calculation';

export default async function BexioPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date } = await getI18n();
  const [conn, accounts, mappings, attempts, entries] = await Promise.all([
    getConnection(ctx), listBexioAccounts(ctx), listMappings(ctx), listSyncAttempts(ctx), listEntries(ctx, ['validated', 'sync_failed', 'synced']),
  ]);
  const configured = !!bexioConfig();
  const mapped = new Map(mappings.map((m) => [m.key, m.bexioAccountId]));
  // Asset-specific keys that already exist in entries can be mapped individually.
  const usedKeys = new Set(entries.flatMap((e) => e.lines.flatMap((l) => [l.debitKey, l.creditKey])));
  const keys = [...new Set([...ACCOUNT_KEYS, ...[...usedKeys].filter((k) => k.includes(':')), ...mappings.map((m) => m.key)])].sort();
  const pending = entries.filter((e) => e.status !== 'synced').length;
  const label = (k: string) => ACCOUNT_KEY_LABELS[k]?.fr ?? (k.startsWith('crypto_asset:') ? `Crypto ${k.slice(13)} (spécifique)` : k.startsWith('fiat_clearing:') ? `Fiat ${k.slice(14)} sur exchange (spécifique)` : k);
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('bx.title')}</h1><p className="subtitle">{conn ? `${t('bx.connected')}${conn.companyName ? ` · ${conn.companyName}` : ''} · ${t('bx.lastSync')} : ${conn.lastSyncAt ? date(conn.lastSyncAt) : t('common.never')}` : t('bx.notConnected')}</p></div>
        {conn ? <StatusBadge status="ok" label={t('bx.connected')} /> : <StatusBadge status="draft" label={t('bx.notConnected')} />}
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="card stack">
        {!configured && <div className="alert alert-warn">{t('bx.notConfigured')}</div>}
        <div className="alert alert-info small">{t('bx.scopeNote')}</div>
        <div className="row">
          {configured && <a className="btn btn-primary" href="/api/bexio/connect">{conn ? 'Reconnecter bexio' : t('bx.connect')}</a>}
          {conn && <form action={refreshBexioAction}><button className="btn" type="submit">{t('bx.refresh')}</button></form>}
          {conn && <form action={disconnectBexioAction}><button className="btn btn-danger" type="submit">{t('bx.disconnect')}</button></form>}
        </div>
        {conn && <p className="small muted">{accounts.length} comptes chargés · devise CHF bexio : {conn.chfCurrencyId ?? 'non chargée'}</p>}
      </div>

      <form action={saveMappingsAction} className="card stack">
        <h2>{t('bx.mapping')}</h2>
        <p className="small muted">{t('bx.mappingIntro')}</p>
        {accounts.length === 0 ? <p className="muted">{t('bx.noAccounts')}</p> : <>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Catégorie Crypto2Books</th><th>Exemple</th><th>Compte bexio</th></tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k}><td><b>{label(k)}</b><div className="mono small muted">{k}</div></td><td className="small muted">{ACCOUNT_KEY_LABELS[k]?.example ?? (k.endsWith(':*') ? '' : 'sinon : compte générique')}</td>
                <td><select name={`map:${k}`} defaultValue={mapped.get(k)?.toString() ?? ''} style={{ minWidth: 260 }}>
                  <option value="">—</option>
                  {accounts.filter((a) => a.isActive || mapped.get(k) === a.bexioId).map((a) => <option key={a.bexioId} value={a.bexioId}>{a.accountNo} · {a.name}{a.isActive ? '' : ' (inactif)'}</option>)}
                </select></td></tr>
            ))}</tbody>
          </table></div>
          <button className="btn" type="submit">{t('common.save')}</button>
        </>}
      </form>

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{t('bx.sync')} ({pending})</h2>
          <form action={syncBexioAction}><button className="btn btn-primary" type="submit" disabled={!conn || pending === 0}>{t('bx.sync')}</button></form>
        </div>
        <p className="small muted">Chaque écriture porte une référence unique (C2B-…). En cas de réponse perdue, Crypto2Books vérifie d’abord dans bexio si l’écriture existe avant de renvoyer : pas de doublon. Une écriture n’est marquée « synchronisée » qu’après confirmation de bexio.</p>
        <h3>{t('bx.attempts')}</h3>
        {attempts.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.date')}</th><th>Référence</th><th>HTTP</th><th>Résultat</th><th>Message</th></tr></thead>
            <tbody>{attempts.map((a) => <tr key={a.id}><td>{date(a.createdAt)}</td><td className="mono small">{a.referenceNr}</td><td>{a.httpStatus ?? '—'}</td>
              <td><StatusBadge status={a.outcome === 'success' ? 'ok' : a.outcome === 'failed' ? 'sync_failed' : 'draft'} label={a.outcome} /></td><td className="small">{a.errorMessage ?? ''}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
