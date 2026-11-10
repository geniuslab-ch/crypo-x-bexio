import Link from 'next/link';
import { registerAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { translator } from '@/i18n/dictionaries';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const t = translator('fr');
  return (
    <div className="card stack" style={{ padding: 28 }}>
      <div>
        <h1>{t('auth.register')}</h1>
        <p className="subtitle">{t('auth.trial')}</p>
      </div>
      <Flash error={sp.error} />
      <form action={registerAction} className="stack">
        <label>{t('auth.name')}<input name="name" required maxLength={120} autoComplete="name" /></label>
        <label>{t('auth.email')}<input name="email" type="email" required autoComplete="email" /></label>
        <label>{t('auth.password')}<input name="password" type="password" minLength={10} required autoComplete="new-password" />
          <span className="muted small">{t('auth.passwordHint')}</span></label>
        <label>{t('auth.orgName')}<input name="orgName" required maxLength={160} /></label>
        <div className="grid grid-2">
          <label>{t('auth.orgKind')}
            <select name="orgKind" defaultValue="company">
              <option value="company">{t('auth.kind.company')}</option>
              <option value="sole_trader">{t('auth.kind.sole_trader')}</option>
              <option value="private">{t('auth.kind.private')}</option>
            </select>
          </label>
          <label>{t('auth.canton')}<input name="canton" maxLength={2} /></label>
        </div>
        <label>Langue / Language / Sprache
          <select name="locale" defaultValue="fr"><option value="fr">Français</option><option value="en">English</option><option value="de">Deutsch</option></select>
        </label>
        <button className="btn btn-primary" type="submit">{t('auth.register')}</button>
      </form>
      <p className="small muted">{t('auth.haveAccount')} <Link href="/login">{t('auth.login')}</Link></p>
    </div>
  );
}
