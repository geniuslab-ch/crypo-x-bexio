import { createClientOrgAction, switchOrgAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { orgProfiles } from '@/server/services/organization';
import { requestTotals } from '@/server/services/platformRequests';
import { fiduciaryOverview } from '@/server/services/dashboard';
import { LEGAL_FORMS } from '@/core/legalForms';

export default async function FiduciaryPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, ctx } = await requireCtx();
  const { t } = await getI18n();
  const profiles = await orgProfiles(ctx.db, session.orgs.map((o) => o.id));
  const overview = await fiduciaryOverview(ctx.db, ctx.userId, session.orgs.map((o) => ({ id: o.id, name: o.name, role: o.role })));
  const requests = await requestTotals(ctx, session.orgs.map((o) => o.id));
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('fid.title')}</h1><p className="subtitle">{t('fid.intro')}</p></div></div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-2">
        <div className="card">
          <h2>{t('fid.clients')} ({session.orgs.length})</h2>
          <table className="table"><tbody>{session.orgs.map((o) => (
            <tr key={o.id}><td><b>{o.name}</b>{o.id === session.orgId && <span className="badge badge-gold" style={{ marginLeft: 8 }}>actif</span>}</td><td className="small muted">{profiles.get(o.id) && t(`auth.kind.${profiles.get(o.id)!.legalForm}`)}</td><td className="small muted">{o.role}</td>
              <td>{o.id !== session.orgId && <form action={switchOrgAction}><input type="hidden" name="orgId" value={o.id} /><button className="btn" type="submit">{t('fid.switch')}</button></form>}</td></tr>
          ))}</tbody></table>
          <p className="small muted">Les données de chaque dossier sont strictement séparées : chaque requête est filtrée par dossier et par droits d’accès.</p>
        </div>
        <form action={createClientOrgAction} className="card stack">
          <h2>{t('fid.addClient')}</h2>
          <label>{t('auth.orgName')}<input name="name" required maxLength={160} /></label>
          <label>{t('auth.orgKind')}<select name="kind" defaultValue="sa">{LEGAL_FORMS.map((f) => <option key={f} value={f}>{t(`auth.kind.${f}`)}</option>)}</select></label>
          <label>{t('set.taxStatus')}<select name="taxStatus" defaultValue="ordinary">
            <option value="ordinary">{t('set.tax.ordinary')}</option><option value="exempt">{t('set.tax.exempt')}</option><option value="partial">{t('set.tax.partial')}</option>
          </select><span className="small muted">SA, Sàrl et fondation uniquement ; ignoré pour un indépendant ou un particulier.</span></label>
          <label>{t('auth.canton')}<input name="canton" maxLength={2} /></label>
          <button className="btn btn-primary" type="submit">{t('fid.addClient')}</button>
        </form>
      </div>
      <div className="card">
        <h2>{t('fid.overview')}</h2>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('fid.clients')}</th><th className="num">{t('fid.col.review')}</th><th className="num">{t('fid.col.drafts')}</th><th className="num">{t('fid.col.toSync')}</th>
            <th className="num">{t('fid.col.failed')}</th><th className="num">{t('fid.col.gaps')}</th><th>{t('fid.col.closed')}</th></tr></thead>
          <tbody>{overview.map((o) => (
            <tr key={o.orgId}>
              <td><b>{o.name}</b></td>
              <td className={`num ${o.toReview ? 'neg' : ''}`}>{o.toReview}</td><td className="num">{o.drafts}</td><td className="num">{o.toSync}</td>
              <td className={`num ${o.syncFailed ? 'neg' : ''}`}>{o.syncFailed}</td><td className={`num ${o.reconciliationGaps ? 'neg' : ''}`}>{o.reconciliationGaps}</td>
              <td>{o.lastClosedYear ?? '—'} {o.previousYearClosed ? '✓' : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>{t('req.list')}</h2>
        {requests.length === 0 ? <p className="muted">{t('common.none')}</p> : (
          <table className="table"><thead><tr><th>{t('req.platform')}</th><th className="num">Demandes</th><th className="num">En attente</th></tr></thead>
            <tbody>{requests.map((r) => <tr key={r.platform}><td><b>{r.platform}</b></td><td className="num">{r.count}</td><td className="num">{r.open}</td></tr>)}</tbody></table>
        )}
        <p className="small muted">Demandes envoyées depuis « Wallets & exchanges » par vos dossiers clients. L’équipe Crypto2Books les reçoit et ajoute les plateformes les plus demandées en premier.</p>
      </div>
    </div>
  );
}
