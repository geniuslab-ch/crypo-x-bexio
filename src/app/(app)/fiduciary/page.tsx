import { createClientOrgAction, switchOrgAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';

export default async function FiduciaryPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session } = await requireCtx();
  const { t } = await getI18n();
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('fid.title')}</h1><p className="subtitle">{t('fid.intro')}</p></div></div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-2">
        <div className="card">
          <h2>{t('fid.clients')} ({session.orgs.length})</h2>
          <table className="table"><tbody>{session.orgs.map((o) => (
            <tr key={o.id}><td><b>{o.name}</b>{o.id === session.orgId && <span className="badge badge-gold" style={{ marginLeft: 8 }}>actif</span>}</td><td className="small muted">{o.role}</td>
              <td>{o.id !== session.orgId && <form action={switchOrgAction}><input type="hidden" name="orgId" value={o.id} /><button className="btn" type="submit">{t('fid.switch')}</button></form>}</td></tr>
          ))}</tbody></table>
          <p className="small muted">Les données de chaque dossier sont strictement séparées : chaque requête est filtrée par dossier et par droits d’accès.</p>
        </div>
        <form action={createClientOrgAction} className="card stack">
          <h2>{t('fid.addClient')}</h2>
          <label>{t('auth.orgName')}<input name="name" required maxLength={160} /></label>
          <label>{t('auth.orgKind')}<select name="kind"><option value="company">{t('auth.kind.company')}</option><option value="sole_trader">{t('auth.kind.sole_trader')}</option><option value="private">{t('auth.kind.private')}</option></select></label>
          <label>{t('auth.canton')}<input name="canton" maxLength={2} /></label>
          <button className="btn btn-primary" type="submit">{t('fid.addClient')}</button>
        </form>
      </div>
    </div>
  );
}
