'use client';

import { usePathname } from 'next/navigation';

const LANGS = [['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['en', 'English']] as const;

/** FR · DE · IT · EN switch that keeps the current page. */
export function LangLinks({ current, className }: { current: string; className?: string }) {
  const path = usePathname() || '/';
  return (
    <span className={`lang-links ${className ?? ''}`}>
      {LANGS.map(([l, name]) => (
        <a key={l} href={`/api/locale?l=${l}&next=${encodeURIComponent(path)}`} hrefLang={l} lang={l} title={name}
          aria-current={l === current ? 'true' : undefined} className={l === current ? 'on' : ''}>{l.toUpperCase()}</a>
      ))}
    </span>
  );
}
