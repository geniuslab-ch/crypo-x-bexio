import Image from 'next/image';
import Link from 'next/link';
import type { Locale } from '@/i18n/dictionaries';
import { LANDING, LANDING_SOURCES, LOCALE_NAMES } from '@/i18n/landing';
import './landing.css';

/** Public marketing page, one per language (/, /fr, /de, /it, /en). */
export function Landing({ locale, loggedIn }: { locale: Locale; loggedIn: boolean }) {
  const c = LANDING[locale];
  const year = new Date().getFullYear();
  const start = loggedIn ? '/dashboard' : '/register';
  const startLabel = loggedIn ? c.nav.open : c.hero.cta;
  return (
    <div className="lp" lang={locale}>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link href={`/${locale}`} className="lp-brand" aria-label="Crypto2Books">
            <Image src="/brand/crypto2books-mark.png" alt="" width={36} height={36} priority />
            <span>Crypto<b>2</b>Books</span>
          </Link>
          <nav className="lp-links" aria-label="Navigation">
            <a href="#features">{c.nav.features}</a>
            <a href="#fiduciaries">{c.nav.fiduciaries}</a>
            <a href="#how">{c.nav.how}</a>
            <a href="#faq">{c.nav.faq}</a>
          </nav>
          <div className="lp-nav-right">
            <LangSwitch locale={locale} />
            {loggedIn ? null : <Link href="/login" className="lp-link-login">{c.nav.login}</Link>}
            <Link href={start} className="lp-btn lp-btn-gold lp-btn-sm">{loggedIn ? c.nav.open : c.nav.trial}</Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <div className="lp-kicker"><span className="lp-cross" aria-hidden /> {c.hero.kicker}</div>
            <h1>{c.hero.title}<br /><span className="lp-gold">{c.hero.titleAccent}</span></h1>
            <p className="lp-lead">{c.hero.lead}</p>
            <div className="lp-ctas">
              <Link href={start} className="lp-btn lp-btn-gold">{startLabel}</Link>
              <a href="#how" className="lp-btn lp-btn-ghost">{c.hero.ctaSecondary}</a>
            </div>
            <p className="lp-note">{c.hero.note}</p>
          </div>
          <div className="lp-hero-shot">
            <Image src="/landing/dashboard.webp" alt={c.shots.dashboard} width={1360} height={900} priority sizes="(max-width: 900px) 100vw, 640px" />
          </div>
        </div>
        <div className="lp-wrap lp-sources" aria-label={c.sources.title}>
          {LANDING_SOURCES.map((s) => <span key={s}>{s}</span>)}
          <span className="lp-sources-bexio">→ bexio</span>
        </div>
      </section>

      <section className="lp-pains">
        <div className="lp-wrap">
          <h2>{c.pains.title}</h2>
          <div className="lp-pain-grid">
            {c.pains.items.map((p) => (
              <div key={p.bad} className="lp-pain">
                <p className="lp-bad"><span aria-hidden>✕</span> {p.bad}</p>
                <p className="lp-good"><span aria-hidden>✓</span> {p.good}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="lp-section">
        <div className="lp-wrap">
          <h2>{c.features.title}</h2>
          <p className="lp-sub">{c.features.lead}</p>
          <div className="lp-feat-grid">
            {c.features.items.map((f, i) => (
              <article key={f.title} className="lp-feat">
                <span className="lp-feat-n">{String(i + 1).padStart(2, '0')}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="lp-section lp-dark">
        <div className="lp-wrap">
          <h2>{c.how.title}</h2>
          <ol className="lp-steps">
            {c.how.steps.map((s, i) => (
              <li key={s.title}><span className="lp-step-n">{i + 1}</span><h3>{s.title}</h3><p>{s.text}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-wrap">
          <h2>{c.compare.title}</h2>
          <div className="lp-compare-wrap">
            <table className="lp-compare">
              <thead><tr><th /><th>{c.compare.colOld}</th><th className="lp-col-new">{c.compare.colNew}</th></tr></thead>
              <tbody>{c.compare.rows.map(([k, a, b]) => (
                <tr key={k}><th scope="row">{k}</th><td className="lp-old">{a}</td><td className="lp-new">{b}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="fiduciaries" className="lp-section lp-fid">
        <div className="lp-wrap lp-fid-in">
          <div>
            <div className="lp-kicker lp-kicker-dark">{c.fiduciary.kicker}</div>
            <h2>{c.fiduciary.title}</h2>
            <p>{c.fiduciary.text}</p>
            <ul className="lp-checks">{c.fiduciary.points.map((p) => <li key={p}>{p}</li>)}</ul>
            <Link href={start} className="lp-btn lp-btn-dark">{loggedIn ? c.nav.open : c.fiduciary.cta}</Link>
          </div>
          <div className="lp-fid-shot">
            <Image src="/landing/comptabilite.webp" alt={c.shots.accounting} width={1360} height={1227} sizes="(max-width: 900px) 100vw, 560px" />
          </div>
        </div>
      </section>

      <section className="lp-section lp-swiss">
        <div className="lp-wrap">
          <h2><span className="lp-cross lp-cross-lg" aria-hidden /> {c.swiss.title}</h2>
          <p className="lp-sub">{c.swiss.text}</p>
          <div className="lp-swiss-grid">
            <div><b>FR · DE · IT · EN</b><span>{c.swiss.langs}</span></div>
            <div><b>{c.swiss.cantons}</b><span>AG · AI · AR · BE · BL · BS · FR · GE · GL · GR · JU · LU · NE · NW · OW · SG · SH · SO · SZ · TG · TI · UR · VD · VS · ZG · ZH</span></div>
            <div><b>bexio</b><span>{c.swiss.forms}</span></div>
          </div>
        </div>
      </section>

      <section id="faq" className="lp-section">
        <div className="lp-wrap lp-faq">
          <h2>{c.faq.title}</h2>
          {c.faq.items.map((f) => (
            <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap">
          <h2>{c.final.title}</h2>
          <p>{c.final.text}</p>
          <Link href={start} className="lp-btn lp-btn-gold">{loggedIn ? c.nav.open : c.final.cta}</Link>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <div className="lp-brand"><Image src="/brand/crypto2books-mark.png" alt="" width={28} height={28} /><span>Crypto<b>2</b>Books</span></div>
          <p className="lp-disclaimer">{c.footer.disclaimer}</p>
          <div className="lp-footer-row">
            <span>© {year} Crypto2Books. {c.footer.rights}</span>
            <LangSwitch locale={locale} />
            <Link href="/login">{c.footer.login}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LangSwitch({ locale }: { locale: Locale }) {
  return (
    <span className="lp-lang">
      {(['fr', 'de', 'it', 'en'] as const).map((l) => (
        <a key={l} href={`/api/locale?l=${l}&next=/${l}`} hrefLang={l} lang={l} title={LOCALE_NAMES[l]} aria-current={l === locale ? 'true' : undefined} className={l === locale ? 'on' : ''}>
          {l.toUpperCase()}
        </a>
      ))}
    </span>
  );
}
