import Link from 'next/link';
import { addOpeningBalancesAction, closeYearAction, deleteOpeningBalanceAction, reopenYearAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { Money, StatusBadge } from '@/components/ui';
import { isRateBasis, isValuationMethod, RATE_BASES, VALUATION_METHODS } from '@/core/accounting/closing';
import { ACCOUNT_KEY_LABELS } from '@/i18n/dictionaries';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { calculationIsExcluding, listClosings, listOpeningBalances, previewClosing } from '@/server/services/closing';
import { listSources } from '@/server/services/imports';

export default async function ClosingPage({ searchParams }: {
  searchParams: Promise<{ year?: string; method?: string; basis?: string; preview?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { ctx } = await requireCtx();
  const { t, date } = await getI18n();
  const now = new Date().getFullYear();
  const year = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : now - 1;
  const method = isValuationMethod(sp.method) ? sp.method : 'lower_of_cost';
  const basis = isRateBasis(sp.basis) ? sp.basis : 'market_rate';
  const [closings, openings, srcs, excluded] = await Promise.all([listClosings(ctx), listOpeningBalances(ctx), listSources(ctx), calculationIsExcluding(ctx)]);
  const preview = await previewClosing(ctx, year, method, basis, { fetchMissing: sp.preview === '1' && ctx.role !== 'viewer' });
  const sourceName = new Map(srcs.map((s) => [s.id, s.label]));
  const keyLabel = (k: string) => {
    const at = k.indexOf('@');
    const base = at === -1 ? k : k.slice(0, at);
    const label = ACCOUNT_KEY_LABELS[base]?.fr ?? (base.startsWith('crypto_asset:') ? `Crypto ${base.slice(13)}` : base);
    return at === -1 ? label : `${label} · ${sourceName.get(k.slice(at + 1)) ?? 'wallet'}`;
  };
  const lastClosed = closings.find((c) => c.status === 'closed')?.year ?? null;
  const openingYear = openings[0] ? Number(openings[0].occurredAt.toISOString().slice(0, 4)) + 1 : now;

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{t('clo.title')}</h1><p className="subtitle">{t('clo.subtitle')}</p></div>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('clo.years')}</h2>
        {closings.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('rep.year')}</th><th>{t('common.status')}</th><th>{t('clo.method')}</th><th>{t('clo.basis')}</th><th>{t('common.date')}</th><th /></tr></thead>
            <tbody>{closings.map((c) => (
              <tr key={c.id}>
                <td><b>{c.year}</b></td>
                <td><StatusBadge status={c.status === 'closed' ? 'synced' : 'draft'} label={c.status === 'closed' ? t('clo.closed') : t('clo.reopened')} /></td>
                <td className="small">{isValuationMethod(c.valuationMethod) ? t(`clo.method.${c.valuationMethod}`) : c.valuationMethod}</td>
                <td className="small">{isRateBasis(c.rateBasis) ? t(`clo.basis.${c.rateBasis}`) : c.rateBasis}</td>
                <td className="small">{date(c.closedAt)}</td>
                <td className="row">
                  {c.status === 'closed' && <a className="btn" href={`/api/reports/closing?format=xlsx&year=${c.year}`}>Excel</a>}
                  {c.status === 'closed' && c.year === lastClosed && (
                    <form action={reopenYearAction}><input type="hidden" name="year" value={c.year} /><button className="btn" type="submit">{t('clo.reopen')}</button></form>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted">Un exercice clôturé est verrouillé : plus d’import, de reclassement, de réévaluation ni de modification d’écriture pour cette année et les précédentes. La réouverture retire les écritures de clôture tant qu’elles ne sont pas dans bexio.</p>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('clo.prepare')}</h2>
        <form method="get" className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="preview" value="1" />
          <label>{t('rep.year')}<select name="year" defaultValue={String(year)}>
            {Array.from({ length: 8 }, (_, i) => now - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select></label>
          <label>{t('clo.method')}<select name="method" defaultValue={method}>
            {VALUATION_METHODS.map((m) => <option key={m} value={m}>{t(`clo.method.${m}`)}</option>)}
          </select></label>
          <label>{t('clo.basis')}<select name="basis" defaultValue={basis}>
            {RATE_BASES.map((b) => <option key={b} value={b}>{t(`clo.basis.${b}`)}</option>)}
          </select></label>
          <button className="btn" type="submit">{t('clo.preview')}</button>
        </form>
        <p className="small muted">
          Principe de la valeur la plus basse (CO art. 960 al. 2) : une crypto dont la valeur au 31.12 est inférieure à sa valeur comptable est dépréciée ; une hausse n’est pas comptabilisée.
          Valeur de marché (CO art. 960b) : possible pour les actifs cotés sur un marché actif ; la valeur comptable est ajustée à la hausse comme à la baisse. La méthode choisie doit rester la même d’une année à l’autre.
          L’écriture est datée du 31.12 et extournée le 1.1 suivant : le coût d’acquisition reste la base des gains et pertes réalisés.
        </p>

        <div className={`alert ${preview.blockers.length ? 'alert-warn' : 'alert-ok'}`}>
          <b>{preview.blockers.length ? t('clo.blocked') : t('clo.ready')}</b>
          {preview.blockers.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{preview.blockers.map((b) => <li key={b} className="small">{b}</li>)}</ul>}
        </div>

        {preview.rows.length === 0 ? <p className="muted">Aucun avoir crypto au 31.12.{year}.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.asset')}</th><th>Compte</th><th className="num">Quantité</th><th className="num">{t('clo.colBook')}</th><th className="num">CHF / unité</th>
              <th className="num">{t('clo.colMarket')}</th><th className="num">{t('clo.colAdj')}</th><th>{t('common.source')}</th></tr></thead>
            <tbody>{preview.rows.map((r) => (
              <tr key={r.key}>
                <td>{r.asset}</td><td className="small">{keyLabel(r.key)}</td><td className="num mono small">{r.quantity}</td>
                <td className="num"><Money value={r.bookValue} /></td><td className="num mono small">{r.rate ?? '—'}</td>
                <td className="num"><Money value={r.marketValue} /></td><td className="num"><Money value={r.adjustment} signed /></td>
                <td className="small">{r.rateSource ?? <span className="neg">manquant</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}

        {preview.lines.length > 0 && (
          <div className="small">
            <b>Écritures générées</b> (validées à la clôture, à envoyer ensuite à bexio depuis « Intégration bexio ») :
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {preview.lines.map((l) => <li key={`${l.debitKey}${l.creditKey}`}>31.12.{year} · {keyLabel(l.debitKey)} à {keyLabel(l.creditKey)} · CHF {l.amount}</li>)}
              <li>01.01.{year + 1} · extourne des mêmes montants</li>
            </ul>
            Mappez d’abord les comptes « Corrections de valeur » et « Réévaluation » dans <Link href="/bexio">Intégration bexio</Link>.
          </div>
        )}

        {ctx.role !== 'viewer' && preview.blockers.length === 0 && (
          <form action={closeYearAction}>
            <input type="hidden" name="year" value={year} /><input type="hidden" name="method" value={method} /><input type="hidden" name="basis" value={basis} />
            <button className="btn btn-primary" type="submit">{t('clo.close')} {year}</button>
          </form>
        )}
      </div>

      <div className="card stack" id="opening">
        <h2 style={{ margin: 0 }}>{t('clo.opening')}</h2>
        <p className="small muted">
          Pour un dossier repris en cours de route : saisissez, par wallet ou exchange, la quantité et le coût d’acquisition CHF de chaque crypto au 1er janvier.
          Ces soldes figurent déjà au bilan d’ouverture dans bexio : ils ne créent aucune écriture, mais servent de base FIFO / prix moyen pour les ventes suivantes.
          Les transactions antérieures à cette date sont alors ignorées par le calcul.
        </p>
        {excluded > 0 && <div className="alert alert-info small">{excluded} transaction(s) antérieure(s) aux soldes d’ouverture sont ignorées par le calcul.</div>}
        {openings.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('common.date')}</th><th>{t('common.source')}</th><th>{t('common.asset')}</th><th className="num">Quantité</th><th className="num">Coût CHF</th><th /></tr></thead>
            <tbody>{openings.map((o) => (
              <tr key={o.id}>
                <td>01.01.{Number(o.occurredAt.toISOString().slice(0, 4)) + 1}</td><td className="small">{o.sourceLabel}</td><td>{o.asset}</td>
                <td className="num mono small">{o.quantity}</td><td className="num"><Money value={o.costChf} /></td>
                <td>{ctx.role !== 'viewer' && <form action={deleteOpeningBalanceAction}><input type="hidden" name="txId" value={o.id} /><button className="btn" type="submit">Supprimer</button></form>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {ctx.role !== 'viewer' && (srcs.length === 0 ? <p className="muted small">Ajoutez d’abord vos wallets et exchanges dans <Link href="/sources">Wallets & exchanges</Link>.</p> : (
          <form action={addOpeningBalancesAction} className="stack">
            <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label>Au 1er janvier<select name="openingYear" defaultValue={String(openingYear)}>
                {Array.from({ length: 8 }, (_, i) => now + 1 - i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select></label>
              <label>{t('common.source')}<select name="sourceId">{srcs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
              <label>{t('common.asset')}<input name="asset" placeholder="BTC" style={{ width: 90 }} /></label>
              <label>Quantité<input name="quantity" inputMode="decimal" placeholder="0.5" style={{ width: 130 }} /></label>
              <label>Coût d’acquisition CHF<input name="costChf" inputMode="decimal" placeholder="12000.00" style={{ width: 140 }} /></label>
            </div>
            <label className="small">Ou un fichier CSV (colonnes <span className="mono">source,asset,quantity,cost_chf</span>, « source » = nom du wallet ou de l’exchange) <input type="file" name="file" accept=".csv,text/csv" /></label>
            <div><button className="btn btn-primary" type="submit">{t('clo.openingAdd')}</button></div>
          </form>
        ))}
      </div>
    </div>
  );
}
