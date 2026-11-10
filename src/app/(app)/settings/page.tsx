import { markPolicyReviewedAction, setLocaleAction, updatePolicyAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { getPolicy } from '@/server/services/calculation';

const REFERENCES = [
  { label: 'AFC/ESTV — Arbeitspapier Kryptowährungen und ICO/ITO (version du 03.08.2022)', url: 'https://www.estv.admin.ch/de/kryptowaehrungen-besteuerung' },
  { label: 'AFC/ESTV — Kursliste / ICTax (valeurs fiscales de fin d’année)', url: 'https://www.ictax.admin.ch/' },
  { label: 'Code des obligations, art. 957–960e (comptabilité et présentation des comptes)', url: 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/fr' },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx, session } = await requireCtx();
  const { t, date } = await getI18n();
  const p = await getPolicy(ctx);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('set.title')}</h1></div></div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="alert alert-warn small">{t('set.disclaimer')}</div>
      <div className="grid grid-2">
        <form action={updatePolicyAction} className="card stack">
          <h2>{t('acc.policy')}</h2>
          <label>{t('acc.method')}<select name="costBasisMethod" defaultValue={p.costBasisMethod}><option value="fifo">FIFO (premier entré, premier sorti)</option><option value="wac">Coût moyen pondéré</option></select></label>
          <label>{t('acc.fees')}<select name="tradingFeeTreatment" defaultValue={p.tradingFeeTreatment}><option value="capitalize">{t('acc.fees.capitalize')}</option><option value="expense">{t('acc.fees.expense')}</option></select></label>
          <label>{t('set.window')}<input type="number" name="transferWindowHours" min={1} max={720} defaultValue={p.transferWindowHours} /></label>
          <button className="btn btn-primary" type="submit">{t('common.save')}</button>
          <p className="small muted">Toutes les méthodes ne sont pas admises dans toutes les situations. Choisissez-la avec votre fiduciaire et gardez-la d’un exercice à l’autre. Modifier la politique annule sa validation fiduciaire.</p>
          <div className="row">{p.reviewedByFiduciaryAt ? <span className="badge badge-ok">{t('acc.reviewed')} {date(p.reviewedByFiduciaryAt)}</span> : <span className="badge badge-warn">{t('acc.notReviewed')}</span>}</div>
        </form>
        <div className="stack">
          <form action={setLocaleAction} className="card stack">
            <h2>{t('set.language')}</h2>
            <select name="locale" defaultValue={session.locale}><option value="fr">Français</option><option value="en">English</option><option value="de">Deutsch</option></select>
            <button className="btn" type="submit">{t('common.save')}</button>
          </form>
          {(ctx.role === 'fiduciary' || ctx.role === 'accountant') && (
            <form action={markPolicyReviewedAction} className="card"><button className="btn btn-dark" type="submit">{t('set.markReviewed')}</button></form>
          )}
          <div className="card">
            <h2>{t('set.references')}</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{REFERENCES.map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.label}</a></li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}
