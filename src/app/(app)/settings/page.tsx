import { markPolicyReviewedAction, setLocaleAction, updateLegalFormAction, updatePolicyAction } from '@/app/actions';
import { LEGAL_FORMS, taxNotes } from '@/core/legalForms';
import { Flash } from '@/components/Flash';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { getPolicy } from '@/server/services/calculation';
import { getOrgProfile } from '@/server/services/organization';

/** Official sources. Fedlex is published in fr/de/it (and en for some acts); the ESTV paper is in German. */
const REFERENCES: Record<string, { label: string; url: string }[]> = {
  fr: [
    { label: 'AFC/ESTV — Arbeitspapier Kryptowährungen und ICO/ITO (version du 03.08.2022)', url: 'https://www.estv.admin.ch/de/kryptowaehrungen-besteuerung' },
    { label: 'AFC/ESTV — Kursliste / ICTax (valeurs fiscales de fin d’année)', url: 'https://www.ictax.admin.ch/' },
    { label: 'Code des obligations, art. 957–960e (comptabilité et présentation des comptes)', url: 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/fr' },
    { label: 'Code civil, art. 83a (comptabilité des fondations)', url: 'https://www.fedlex.admin.ch/eli/cc/24/233_245_233/fr#art_83_a' },
    { label: 'LIFD, art. 56 let. g, 66, 68 et 71 (exonération, apports aux fondations, taux)', url: 'https://www.fedlex.admin.ch/eli/cc/1991/1184_1184_1184/fr' },
    { label: 'AFC/ESTV — Imposition des personnes morales (fondations, impôt sur le capital)', url: 'https://www.estv2.admin.ch/stp/ds/d-besteuerung-juristischen-personen-gesamter-text-fr.pdf' },
  ],
  de: [
    { label: 'ESTV — Arbeitspapier Kryptowährungen und ICO/ITO (Stand 03.08.2022)', url: 'https://www.estv.admin.ch/de/kryptowaehrungen-besteuerung' },
    { label: 'ESTV — Kursliste / ICTax (Steuerwerte per Jahresende)', url: 'https://www.ictax.admin.ch/' },
    { label: 'Obligationenrecht, Art. 957–960e (Buchführung und Rechnungslegung)', url: 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de' },
    { label: 'Zivilgesetzbuch, Art. 83a (Buchführung der Stiftungen)', url: 'https://www.fedlex.admin.ch/eli/cc/24/233_245_233/de#art_83_a' },
    { label: 'DBG, Art. 56 Bst. g, 66, 68 und 71 (Steuerbefreiung, Zuwendungen an Stiftungen, Steuersätze)', url: 'https://www.fedlex.admin.ch/eli/cc/1991/1184_1184_1184/de' },
    { label: 'ESTV — Besteuerung der juristischen Personen (Stiftungen, Kapitalsteuer; französische Fassung)', url: 'https://www.estv2.admin.ch/stp/ds/d-besteuerung-juristischen-personen-gesamter-text-fr.pdf' },
  ],
  it: [
    { label: 'AFC/ESTV — Arbeitspapier Kryptowährungen und ICO/ITO (versione del 03.08.2022, in tedesco)', url: 'https://www.estv.admin.ch/de/kryptowaehrungen-besteuerung' },
    { label: 'AFC — Listino dei corsi / ICTax (valori fiscali di fine anno)', url: 'https://www.ictax.admin.ch/' },
    { label: 'Codice delle obbligazioni, art. 957–960e (contabilità e presentazione dei conti)', url: 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/it' },
    { label: 'Codice civile, art. 83a (contabilità delle fondazioni)', url: 'https://www.fedlex.admin.ch/eli/cc/24/233_245_233/it#art_83_a' },
    { label: 'LIFD, art. 56 lett. g, 66, 68 e 71 (esenzione, apporti alle fondazioni, aliquote)', url: 'https://www.fedlex.admin.ch/eli/cc/1991/1184_1184_1184/it' },
    { label: 'AFC — Imposizione delle persone giuridiche (fondazioni, imposta sul capitale; versione francese)', url: 'https://www.estv2.admin.ch/stp/ds/d-besteuerung-juristischen-personen-gesamter-text-fr.pdf' },
  ],
  en: [
    { label: 'Federal Tax Administration — Arbeitspapier Kryptowährungen und ICO/ITO (version of 03.08.2022, in German)', url: 'https://www.estv.admin.ch/de/kryptowaehrungen-besteuerung' },
    { label: 'Federal Tax Administration — Kursliste / ICTax (year-end tax values)', url: 'https://www.ictax.admin.ch/' },
    { label: 'Code of Obligations, art. 957–960e (accounting and financial reporting)', url: 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/en' },
    { label: 'Civil Code, art. 83a (bookkeeping of foundations)', url: 'https://www.fedlex.admin.ch/eli/cc/24/233_245_233/en#art_83_a' },
    { label: 'Federal Act on Direct Federal Tax (DBG), art. 56 let. g, 66, 68 and 71 (exemption, contributions to foundations, rates)', url: 'https://www.fedlex.admin.ch/eli/cc/1991/1184_1184_1184/de' },
    { label: 'Federal Tax Administration — Taxation of legal entities (foundations, capital tax; French version)', url: 'https://www.estv2.admin.ch/stp/ds/d-besteuerung-juristischen-personen-gesamter-text-fr.pdf' },
  ],
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { ctx, session } = await requireCtx();
  const { t, date, locale } = await getI18n();
  const p = await getPolicy(ctx);
  const org = await getOrgProfile(ctx);
  const notes = taxNotes(org.kind, org.taxStatus, locale);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{t('set.title')}</h1></div></div>
      <Flash ok={sp.ok} error={sp.error} locale={locale} />
      <div className="alert alert-warn small">{t('set.disclaimer')}</div>
      <div className="grid grid-2">
        <form action={updatePolicyAction} className="card stack">
          <h2>{t('acc.policy')}</h2>
          <label>{t('acc.method')}<select name="costBasisMethod" defaultValue={p.costBasisMethod}><option value="fifo">{t('set.fifo')}</option><option value="wac">{t('set.wac')}</option></select></label>
          <label>{t('acc.fees')}<select name="tradingFeeTreatment" defaultValue={p.tradingFeeTreatment}><option value="capitalize">{t('acc.fees.capitalize')}</option><option value="expense">{t('acc.fees.expense')}</option></select></label>
          <label>{t('set.window')}<input type="number" name="transferWindowHours" min={1} max={720} defaultValue={p.transferWindowHours} /></label>
          <button className="btn btn-primary" type="submit">{t('common.save')}</button>
          <p className="small muted">{t('set.policyHint')}</p>
          <div className="row">{p.reviewedByFiduciaryAt ? <span className="badge badge-ok">{t('acc.reviewed')} {date(p.reviewedByFiduciaryAt)}</span> : <span className="badge badge-warn">{t('acc.notReviewed')}</span>}</div>
        </form>
        <div className="stack">
          <form action={updateLegalFormAction} className="card stack">
            <h2>{t('set.legal')}</h2>
            <label>{t('auth.orgKind')}<select name="legalForm" defaultValue={org.legalForm === 'company' ? '' : org.legalForm}>
              {org.legalForm === 'company' && <option value="" disabled>{t('auth.kind.company')}</option>}
              {LEGAL_FORMS.map((f) => <option key={f} value={f}>{t(`auth.kind.${f}`)}</option>)}
            </select></label>
            <label>{t('set.taxStatus')}<select name="taxStatus" defaultValue={org.taxStatus}>
              <option value="ordinary">{t('set.tax.ordinary')}</option><option value="exempt">{t('set.tax.exempt')}</option><option value="partial">{t('set.tax.partial')}</option>
            </select></label>
            <button className="btn" type="submit">{t('common.save')}</button>
            <p className="small muted">{t('set.legalHelp')}</p>
            {notes.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{notes.map((n) => <li key={n.label}><b>{n.label}</b> : {n.text}</li>)}</ul>}
          </form>
          <form action={setLocaleAction} className="card stack">
            <h2>{t('set.language')}</h2>
            <select name="locale" defaultValue={session.locale}><option value="fr">Français</option><option value="en">English</option><option value="de">Deutsch</option><option value="it">Italiano</option></select>
            <button className="btn" type="submit">{t('common.save')}</button>
          </form>
          {(ctx.role === 'fiduciary' || ctx.role === 'accountant') && (
            <form action={markPolicyReviewedAction} className="card"><button className="btn btn-dark" type="submit">{t('set.markReviewed')}</button></form>
          )}
          <div className="card">
            <h2>{t('set.references')}</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{(REFERENCES[locale] ?? REFERENCES.fr!).map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.label}</a></li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}
