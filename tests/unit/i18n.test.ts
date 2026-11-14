import { describe, expect, it } from 'vitest';
import { flashText } from '@/components/Flash';
import { taxNotes } from '@/core/legalForms';
import { localizedGuides } from '@/core/importers/guides';
import { LOCALES, translator } from '@/i18n/dictionaries';
import { LANDING } from '@/i18n/landing';
import { fromAcceptLanguage } from '@/i18n/negotiate';
import { fill } from '@/i18n/ui';

describe('language negotiation', () => {
  it('picks the best supported browser language', () => {
    expect(fromAcceptLanguage('de-CH,de;q=0.9,en;q=0.8')).toBe('de');
    expect(fromAcceptLanguage('es-ES,it;q=0.7,fr;q=0.5')).toBe('it');
    expect(fromAcceptLanguage('en;q=0.4,fr-CH;q=0.9')).toBe('fr');
  });
  it('falls back to French', () => {
    expect(fromAcceptLanguage('ja,zh;q=0.8')).toBe('fr');
    expect(fromAcceptLanguage(undefined)).toBe('fr');
    expect(fromAcceptLanguage('de;q=0')).toBe('fr');
  });
});

describe('translations', () => {
  it('translates interface strings and fills placeholders', () => {
    expect(translator('de')('nav.dashboard')).not.toBe(translator('fr')('nav.dashboard'));
    expect(fill(translator('it')('dash.nTransactions'), { n: 3 })).toBe('3 transazioni');
  });
  it('translates flash messages and keeps French as the default', () => {
    expect(flashText('saved', 'de')).toBe('Gespeichert.');
    expect(flashText('imported:4|duplicates:1', 'en')).toBe('4 imported · 1 duplicates');
    expect(flashText('saved')).toBe('Enregistré.');
    expect(flashText('unknown_code', 'it')).toBe('unknown_code');
  });
  it('has the same landing page structure in every language', () => {
    const shape = (l: (typeof LOCALES)[number]) => [LANDING[l].features.items.length, LANDING[l].how.steps.length, LANDING[l].compare.rows.length, LANDING[l].faq.items.length, LANDING[l].pains.items.length];
    for (const l of LOCALES) expect(shape(l)).toEqual(shape('fr'));
  });
  it('translates tax notes with the cantonal and federal references of each language', () => {
    expect(taxNotes('company', 'ordinary', 'de').map((n) => n.text).join(' ')).toContain('DBG Art. 58');
    expect(taxNotes('foundation', 'exempt', 'it')).toHaveLength(2);
    expect(taxNotes('company', 'exempt', 'en').map((n) => n.label)).toEqual(['Profit tax', 'Capital tax', 'Tax status']);
  });
  it('localizes CSV format help but keeps the columns', () => {
    const de = localizedGuides('de');
    expect(de.kraken_ledger_v1!.where).toContain('Ledgers');
    expect(de.kraken_ledger_v1!.columns).toEqual(localizedGuides('fr').kraken_ledger_v1!.columns);
  });
});
