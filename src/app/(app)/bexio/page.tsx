import { disconnectBexioAction, refreshBexioAction, saveMappingsAction, syncBexioAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { StatusBadge } from '@/components/ui';
import { ACCOUNT_KEYS, walletAccountKey } from '@/core/accounting/accountKeys';
import { ACCOUNT_KEY_LABELS } from '@/i18n/dictionaries';
import { getI18n } from '@/i18n/server';
import { bexioConfig } from '@/integrations/bexio/oauth';
import { requireCtx } from '@/server/auth/next';
import { getConnection, listBexioAccounts, listMappings, listSyncAttempts } from '@/server/services/bexio';
import { listEntries } from '@/server/services/calculation';
import { listSources } from '@/server/services/imports';
import { getOrgProfile } from '@/server/services/organization';

export default async function BexioPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date } = await getI18n();
  const [conn, accounts, mappings, attempts, entries, org, srcs] = await Promise.all([
    getConnection(ctx), listBexioAccounts(ctx), listMappings(ctx), listSyncAttempts(ctx), listEntries(ctx, ['validated', 'sync_failed', 'synced']), getOrgProfile(ctx), listSources(ctx),
  ]);
  const configured = !!bexioConfig();
  const mapped = new Map(mappings.map((m) => [m.key, m.bexioAccountId]));
  // Asset-specific keys that already exist in entries can be mapped individually.
  const usedKeys = new Set(entries.flatMap((e) => e.lines.flatMap((l) => [l.debitKey, l.creditKey])));
  // The foundation capital account only exists for foundations (unless already used or mapped).
  const baseKeys = ACCOUNT_KEYS.filter((k) => k !== 'foundation_capital' || org.kind === 'foundation');
  // Per-wallet keys are set in their own section below.
  const keys = [...new Set([...baseKeys, ...[...usedKeys].filter((k) => k.includes(':')), ...mappings.map((m) => m.key)])].filter((k) => !k.includes('@')).sort();
  const locked = entries.length > 0;
  const accountOptions = (k: string) => accounts.filter((a) => a.isActive || mapped.get(k) === a.bexioId)
    .map((a) => <option key={a.bexioId} value={a.bexioId}>{a.accountNo} · {a.name}{a.isActive ? '' : ' (inactif)'}</option>);
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
        {configured && <p className="small muted">URL de redirection à enregistrer dans le portail développeur bexio : <span className="mono">{bexioConfig()!.redirectUri}</span></p>}
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
          {srcs.length > 0 && <>
            <h3 style={{ marginBottom: 0 }}>Comptes par wallet (facultatif)</h3>
            <p className="small muted">Par défaut, chaque crypto va sur un seul compte. Si le plan comptable a un sous-compte par wallet (par exemple 12617 Treasury, 12626 Liquidity Pool), choisissez-le ici. Le wallet garde alors ses propres lots (coût et date d’acquisition), et un transfert vers un autre wallet passe une écriture entre les deux comptes, au coût, sans gain ni perte. Laissez « — » pour garder le compte par crypto.
              {locked ? ' Des écritures sont déjà validées : un wallet ne peut plus recevoir ou perdre son propre compte (seul le numéro de compte peut changer), pour ne pas modifier des écritures acceptées.' : ' À décider avant de valider les premières écritures.'}</p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Wallet / source</th><th>Compte bexio</th></tr></thead>
              <tbody>{srcs.map((s) => {
                const k = walletAccountKey(s.id);
                return (
                  <tr key={s.id}><td><b>{s.label}</b> <span className="small muted">({s.provider})</span></td>
                    <td><select name={`map:${k}`} defaultValue={mapped.get(k)?.toString() ?? ''} style={{ minWidth: 260 }}>
                      <option value="">— compte par crypto</option>{accountOptions(k)}
                    </select></td></tr>
                );
              })}</tbody>
            </table></div>
          </>}
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
