import { disconnectBexioAction, refreshBexioAction, saveMappingsAction, syncBexioAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { StatusBadge } from '@/components/ui';
import { ACCOUNT_KEYS, walletAccountKey } from '@/core/accounting/accountKeys';
import { ACCOUNT_KEY_LABELS } from '@/i18n/dictionaries';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/ui';
import { bexioConfig } from '@/integrations/bexio/oauth';
import { requireCtx } from '@/server/auth/next';
import { assetAccountKeys, getConnection, listBexioAccounts, listBexioTaxes, listMappings, listSyncAttempts } from '@/server/services/bexio';
import { listEntries } from '@/server/services/calculation';
import { listSources } from '@/server/services/imports';
import { getOrgProfile } from '@/server/services/organization';

export default async function BexioPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date, locale } = await getI18n();
  const [conn, accounts, mappings, attempts, entries, org, srcs, taxes, assetKeys] = await Promise.all([
    getConnection(ctx), listBexioAccounts(ctx), listMappings(ctx), listSyncAttempts(ctx), listEntries(ctx, ['validated', 'sync_failed', 'synced']), getOrgProfile(ctx), listSources(ctx),
    listBexioTaxes(ctx), assetAccountKeys(ctx),
  ]);
  const vatOf = new Map(mappings.map((m) => [m.key, m.bexioTaxId]));
  // VAT is booked on income and expense accounts only, never on crypto, exchange or transfer accounts.
  const vatKey = (k: string) => !/^(crypto_asset|fiat_clearing):|^bank_clearing$|^external_|^foundation_capital$/.test(k);
  const configured = !!bexioConfig();
  const mapped = new Map(mappings.map((m) => [m.key, m.bexioAccountId]));
  // One line per asset of the file (from its imported transactions, before any calculation), plus any key already used
  // in entries or mapped: each crypto can get its own account up front; an unmapped one uses the general account.
  const usedKeys = new Set(entries.flatMap((e) => e.lines.flatMap((l) => [l.debitKey, l.creditKey])));
  // The foundation capital account only exists for foundations (unless already used or mapped).
  const baseKeys = ACCOUNT_KEYS.filter((k) => k !== 'foundation_capital' || org.kind === 'foundation');
  // Per-wallet keys are set in their own section below.
  const keys = [...new Set([...baseKeys, ...assetKeys, ...[...usedKeys].filter((k) => k.includes(':')), ...mappings.map((m) => m.key)])].filter((k) => !k.includes('@')).sort();
  const locked = entries.length > 0;
  const accountOptions = (k: string) => accounts.filter((a) => a.isActive || mapped.get(k) === a.bexioId)
    .map((a) => <option key={a.bexioId} value={a.bexioId}>{a.accountNo} · {a.name}{a.isActive ? '' : ` ${t('bx.inactive')}`}</option>);
  const pending = entries.filter((e) => e.status !== 'synced').length;
  const label = (k: string) => ACCOUNT_KEY_LABELS[k]?.[locale] ?? (k.startsWith('crypto_asset:') ? fill(t('bx.specificCrypto'), { x: k.slice(13) }) : k.startsWith('fiat_clearing:') ? fill(t('bx.specificFiat'), { x: k.slice(14) }) : k);
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('bx.title')}</h1><p className="subtitle">{conn ? `${t('bx.connected')}${conn.companyName ? ` · ${conn.companyName}` : ''} · ${t('bx.lastSync')} : ${conn.lastSyncAt ? date(conn.lastSyncAt) : t('common.never')}` : t('bx.notConnected')}</p></div>
        {conn ? <StatusBadge status="ok" label={t('bx.connected')} /> : <StatusBadge status="draft" label={t('bx.notConnected')} />}
      </div>
      <Flash ok={sp.ok} error={sp.error} locale={locale} />

      <div className="card stack">
        {!configured && <div className="alert alert-warn">{t('bx.notConfigured')}</div>}
        <div className="alert alert-info small">{t('bx.scopeNote')}</div>
        <div className="row">
          {configured && <a className="btn btn-primary" href="/api/bexio/connect">{conn ? t('bx.reconnect') : t('bx.connect')}</a>}
          {conn && <form action={refreshBexioAction}><button className="btn" type="submit">{t('bx.refresh')}</button></form>}
          {conn && <form action={disconnectBexioAction}><button className="btn btn-danger" type="submit">{t('bx.disconnect')}</button></form>}
        </div>
        {configured && <p className="small muted">{t('bx.redirectUrl')} <span className="mono">{bexioConfig()!.redirectUri}</span></p>}
        {conn && <p className="small muted">{fill(t('bx.accountsLoaded'), { n: accounts.length, id: conn.chfCurrencyId ?? t('bx.notLoaded') })}</p>}
      </div>

      <form action={saveMappingsAction} className="card stack">
        <h2>{t('bx.mapping')}</h2>
        <p className="small muted">{t('bx.mappingIntro')}</p>
        {accounts.length === 0 ? <p className="muted">{t('bx.noAccounts')}</p> : <>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('bx.col.category')}</th><th>{t('bx.col.example')}</th><th>{t('bx.col.account')}</th>{taxes.length > 0 && <th>{t('bx.col.vat')}</th>}</tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k}><td><b>{label(k)}</b><div className="mono small muted">{k}</div></td><td className="small muted">{ACCOUNT_KEY_LABELS[k]?.example[locale] ?? (k.endsWith(':*') ? '' : t('bx.genericFallback'))}</td>
                <td><select name={`map:${k}`} defaultValue={mapped.get(k)?.toString() ?? ''} style={{ minWidth: 260 }}>
                  <option value="">—</option>
                  {accountOptions(k)}
                </select></td>
                {taxes.length > 0 && <td>{vatKey(k) && <select name={`vat:${k}`} defaultValue={vatOf.get(k)?.toString() ?? ''} style={{ minWidth: 200 }}>
                  <option value="">{t('bx.noVat')}</option>
                  {taxes.filter((x) => x.isActive || vatOf.get(k) === x.bexioId).map((x) => <option key={x.bexioId} value={x.bexioId}>{x.code} · {x.name} · {Number(x.value)} %{x.type === 'pre_tax' ? ` ${t('bx.preTax')}` : ''}</option>)}
                </select>}</td>}</tr>
            ))}</tbody>
          </table></div>
          {taxes.length > 0 && <p className="small muted">{fill(t('bx.vatHelp'), { n: taxes.length })}</p>}
          {srcs.length > 0 && <>
            <h3 style={{ marginBottom: 0 }}>{t('bx.walletAccounts')}</h3>
            <p className="small muted">{t('bx.walletIntro')} {locked ? t('bx.walletLocked') : t('bx.walletDecide')}</p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('bx.col.wallet')}</th><th>{t('bx.col.account')}</th></tr></thead>
              <tbody>{srcs.map((s) => {
                const k = walletAccountKey(s.id);
                return (
                  <tr key={s.id}><td><b>{s.label}</b> <span className="small muted">({s.provider})</span></td>
                    <td><select name={`map:${k}`} defaultValue={mapped.get(k)?.toString() ?? ''} style={{ minWidth: 260 }}>
                      <option value="">{t('bx.perCrypto')}</option>{accountOptions(k)}
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
        <p className="small muted">{t('bx.syncNote')}</p>
        <h3>{t('bx.attempts')}</h3>
        {attempts.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.date')}</th><th>{t('acc.reference')}</th><th>HTTP</th><th>{t('bx.col.result')}</th><th>{t('bx.col.message')}</th></tr></thead>
            <tbody>{attempts.map((a) => <tr key={a.id}><td>{date(a.createdAt)}</td><td className="mono small">{a.referenceNr}</td><td>{a.httpStatus ?? '—'}</td>
              <td><StatusBadge status={a.outcome === 'success' ? 'ok' : a.outcome === 'failed' ? 'sync_failed' : 'draft'} label={a.outcome} /></td><td className="small">{a.errorMessage ?? ''}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
