import type { Locale } from './dictionaries';

/**
 * Public landing page copy (www.crypto2books.ch). Every claim here must match what the app really does:
 * no invented customers, figures or certifications.
 */
export interface LandingCopy {
  meta: { title: string; description: string };
  nav: { features: string; fiduciaries: string; how: string; faq: string; login: string; trial: string; open: string };
  hero: { kicker: string; title: string; titleAccent: string; lead: string; cta: string; ctaSecondary: string; note: string };
  pains: { title: string; items: { bad: string; good: string }[] };
  features: { title: string; lead: string; items: { title: string; text: string }[] };
  how: { title: string; steps: { title: string; text: string }[] };
  compare: { title: string; colOld: string; colNew: string; rows: [string, string, string][] };
  fiduciary: { kicker: string; title: string; text: string; points: string[]; cta: string };
  swiss: { title: string; text: string; langs: string; forms: string; cantons: string };
  sources: { title: string; text: string };
  faq: { title: string; items: { q: string; a: string }[] };
  final: { title: string; text: string; cta: string };
  footer: { disclaimer: string; rights: string; login: string };
  shots: { dashboard: string; accounting: string };
}

const fr: LandingCopy = {
  meta: {
    title: 'Crypto2Books · Comptabilité crypto suisse, directement dans bexio',
    description: 'Importez vos exchanges et wallets, calculez en CHF (FIFO ou coût moyen pondéré) et envoyez des écritures validées dans bexio. Pour fiduciaires, SA, Sàrl et fondations.',
  },
  nav: { features: 'Fonctionnalités', fiduciaries: 'Fiduciaires', how: 'Comment ça marche', faq: 'FAQ', login: 'Se connecter', trial: 'Essai gratuit', open: 'Ouvrir mon espace' },
  hero: {
    kicker: 'Fait pour la comptabilité suisse',
    title: 'Vos cryptos dans bexio.',
    titleAccent: 'Sans tableur. Sans ressaisie.',
    lead: 'Crypto2Books lit vos exchanges et wallets, convertit chaque opération en CHF avec un cours documenté, calcule vos gains en FIFO ou au coût moyen pondéré, puis envoie des écritures validées dans bexio. Votre fiduciaire garde la main à chaque étape.',
    cta: 'Démarrer l’essai gratuit',
    ctaSecondary: 'Voir comment ça marche',
    note: 'Sans carte de crédit · Interface FR · DE · IT · EN',
  },
  pains: {
    title: 'Le bouclement crypto ne devrait plus vous coûter un week-end.',
    items: [
      { bad: 'Des exports CSV qui ne se ressemblent jamais.', good: 'Kraken, Coinbase, Binance, Bitcoin, Ethereum, ICP, OGY… lus par API ou par CSV, dans un seul format.' },
      { bad: 'Des cours CHF cherchés un par un.', good: 'Chaque montant en CHF garde sa source. Aucun cours n’est inventé : sans source, la transaction est signalée.' },
      { bad: 'Des écritures recopiées à la main dans bexio.', good: 'Des écritures équilibrées débit/crédit, envoyées dans bexio avec une référence unique. Jamais de doublon.' },
    ],
  },
  features: {
    title: 'Tout ce qu’il faut pour passer de la blockchain au grand livre',
    lead: 'Pensé pour les fiduciaires suisses et des dossiers qui doivent tenir face à une révision.',
    items: [
      { title: 'Intégration bexio native', text: 'Connexion OAuth officielle, plan comptable chargé depuis bexio, correspondance de vos comptes, envoi des écritures validées. Une écriture n’est marquée « synchronisée » qu’après confirmation de bexio.' },
      { title: 'FIFO ou coût moyen pondéré', text: 'Lots suivis par actif et, si vous le souhaitez, par wallet. Gains et pertes réalisés et latents en CHF. Les arrondis au centime sont reportés : le total comptabilisé correspond au total exact.' },
      { title: 'Multi-dossiers pour fiduciaires', text: 'Un seul compte pour tous vos clients. Changez de dossier depuis la barre du haut ; les données de chaque client restent strictement séparées.' },
      { title: 'SA, Sàrl, fondation, indépendant', text: 'Les classifications suivent la forme juridique : dotation, don reçu, subvention versée pour les fondations. Notes fiscales (LIFD, LHID) dans les rapports, selon le statut fiscal.' },
      { title: 'Imports par API et CSV', text: 'API en lecture seule pour Kraken, Coinbase et Binance. Adresses publiques pour Bitcoin (xpub), Ethereum, Solana, Cardano, ICP et OGY. Un modèle CSV universel pour tout le reste.' },
      { title: 'Bouclement de fin d’année', text: 'Valeurs fiscales AFC (Kursliste) au 31.12, état des titres, journal, gains réalisés, revenus de staking et frais : rapports Excel et CSV prêts pour la fiduciaire.' },
      { title: 'Classification avec contrôle', text: 'Achats, ventes, échanges, staking, airdrops, transferts entre vos comptes : classés automatiquement. Les cas incertains passent en revue et bloquent le calcul jusqu’à vérification.' },
      { title: 'Piste d’audit complète', text: 'Chaque transaction garde ses lignes d’origine, sa justification et son historique. Une écriture validée n’est jamais modifiée automatiquement.' },
      { title: 'Sécurité des accès', text: 'Seules les clés API en lecture seule sont acceptées : une clé qui permet le trading ou les retraits est refusée. Les clés sont chiffrées (AES-256). Jamais de phrase de récupération.' },
    ],
  },
  how: {
    title: 'Cinq étapes, de l’exchange à bexio',
    steps: [
      { title: 'Importer', text: 'Connectez une API en lecture seule, ajoutez des adresses publiques ou déposez un CSV.' },
      { title: 'Classer', text: 'Les transactions sont classées automatiquement ; vous confirmez les cas incertains.' },
      { title: 'Calculer', text: 'Conversion en CHF, FIFO ou coût moyen pondéré, gains réalisés, frais.' },
      { title: 'Valider', text: 'Vous ou votre fiduciaire validez les écritures proposées.' },
      { title: 'Synchroniser', text: 'Les écritures validées partent dans bexio, sans doublon.' },
    ],
  },
  compare: {
    title: 'Le tableur contre Crypto2Books',
    colOld: 'Tableur + ressaisie',
    colNew: 'Crypto2Books',
    rows: [
      ['Collecte des transactions', 'Exports manuels, formats différents', 'API en lecture seule et CSV reconnus'],
      ['Cours CHF', 'Copiés à la main, sans source', 'Documentés et sourcés, aucun cours inventé'],
      ['Coût d’acquisition', 'Formules fragiles', 'FIFO ou coût moyen pondéré, par lot'],
      ['Transferts entre wallets', 'Comptés comme ventes par erreur', 'Appariés, au coût, sans gain fictif'],
      ['Saisie dans bexio', 'Écriture par écriture', 'Envoi groupé, référence unique, sans doublon'],
      ['Contrôle fiduciaire', 'Fichiers par e-mail', 'Revue, validation et piste d’audit dans l’outil'],
    ],
  },
  fiduciary: {
    kicker: 'Pour les fiduciaires',
    title: 'Vos clients ont des cryptos. Vous avez enfin un process.',
    text: 'Crypto2Books s’adresse d’abord aux fiduciaires qui tiennent la comptabilité de leurs clients dans bexio. Chaque dossier a sa forme juridique, son canton, sa méthode d’évaluation et sa connexion bexio.',
    points: [
      'Tous vos dossiers clients dans un seul compte, avec recherche',
      'Méthode d’évaluation validée par la fiduciaire, figée une fois les écritures validées',
      'Correspondance des comptes bexio par dossier, y compris un compte par wallet',
      'Rapports pour le bouclement et la déclaration d’impôt',
    ],
    cta: 'Créer mon espace fiduciaire',
  },
  swiss: {
    title: 'Pour toute la Suisse',
    text: 'Du Léman au Bodan, de Bâle au Tessin : chaque dossier indique son canton, et l’interface parle la langue de votre client.',
    langs: 'Français, Deutsch, Italiano, English',
    forms: 'SA, Sàrl, fondation, indépendant, particulier',
    cantons: '26 cantons',
  },
  sources: { title: 'Sources prises en charge', text: 'API en lecture seule ou adresses publiques. Pour les autres plateformes : le modèle CSV universel.' },
  faq: {
    title: 'Questions fréquentes',
    items: [
      { q: 'Dois-je donner ma phrase de récupération ou une clé privée ?', a: 'Jamais. Crypto2Books utilise uniquement des clés API en lecture seule ou des adresses publiques (xpub, adresses). Une clé qui permet le trading, les transferts ou les retraits est refusée.' },
      { q: 'Qu’est-ce qui arrive dans bexio ?', a: 'Des écritures manuelles en CHF, équilibrées débit/crédit, sur les comptes que vous avez choisis dans votre plan comptable bexio. Seules les écritures validées sont envoyées.' },
      { q: 'FIFO ou coût moyen pondéré ?', a: 'Les deux sont disponibles. Choisissez la méthode avec votre fiduciaire et gardez-la d’un exercice à l’autre ; elle est verrouillée dès que des écritures sont validées.' },
      { q: 'Ma plateforme n’est pas dans la liste.', a: 'Utilisez le modèle CSV Crypto2Books : une ligne par opération, avec un exemple téléchargeable. Les nouvelles intégrations sont ajoutées au fil des demandes.' },
      { q: 'Crypto2Books remplace-t-il ma fiduciaire ?', a: 'Non. C’est un outil d’aide à la comptabilité. Il prépare et documente les écritures ; la fiduciaire et l’administration fiscale gardent le dernier mot.' },
    ],
  },
  final: { title: 'Bouclez votre exercice crypto cette année, pas l’année prochaine.', text: 'Créez un compte, importez un premier fichier et voyez vos écritures en quelques minutes.', cta: 'Démarrer l’essai gratuit' },
  footer: {
    disclaimer: 'Crypto2Books est un outil d’aide à la comptabilité. Il ne remplace pas votre fiduciaire ni votre conseiller fiscal et n’est pas une autorité fiscale. bexio est une marque de bexio AG ; Crypto2Books n’est pas un produit de bexio AG.',
    rights: 'Tous droits réservés.',
    login: 'Connexion',
  },
  shots: { dashboard: 'Tableau de bord Crypto2Books : progression, valeur du portefeuille et avoirs par actif', accounting: 'Écritures comptables proposées avec débit, crédit et statut' },
};

const de: LandingCopy = {
  meta: {
    title: 'Crypto2Books · Schweizer Krypto-Buchhaltung, direkt in bexio',
    description: 'Börsen und Wallets importieren, in CHF bewerten (FIFO oder gewichteter Durchschnitt) und freigegebene Buchungen an bexio senden. Für Treuhänder, AG, GmbH und Stiftungen.',
  },
  nav: { features: 'Funktionen', fiduciaries: 'Treuhänder', how: 'So funktioniert’s', faq: 'FAQ', login: 'Anmelden', trial: 'Gratis testen', open: 'Zu meinem Konto' },
  hero: {
    kicker: 'Gemacht für die Schweizer Buchhaltung',
    title: 'Ihre Kryptos in bexio.',
    titleAccent: 'Ohne Excel. Ohne Abtippen.',
    lead: 'Crypto2Books liest Ihre Börsen und Wallets, rechnet jede Transaktion mit einem belegten Kurs in CHF um, berechnet Ihre Gewinne nach FIFO oder gewichtetem Durchschnitt und sendet freigegebene Buchungen an bexio. Ihr Treuhänder behält bei jedem Schritt die Kontrolle.',
    cta: 'Gratis testen',
    ctaSecondary: 'So funktioniert’s',
    note: 'Ohne Kreditkarte · Oberfläche DE · FR · IT · EN',
  },
  pains: {
    title: 'Der Krypto-Abschluss sollte Sie kein Wochenende mehr kosten.',
    items: [
      { bad: 'CSV-Exporte, die nie gleich aussehen.', good: 'Kraken, Coinbase, Binance, Bitcoin, Ethereum, ICP, OGY … per API oder CSV gelesen, in einem einzigen Format.' },
      { bad: 'CHF-Kurse, einzeln zusammengesucht.', good: 'Jeder CHF-Betrag behält seine Quelle. Kein Kurs wird erfunden: Fehlt die Quelle, wird die Transaktion markiert.' },
      { bad: 'Buchungen, von Hand in bexio abgetippt.', good: 'Ausgeglichene Soll/Haben-Buchungen, mit eindeutiger Referenz an bexio gesendet. Nie doppelt.' },
    ],
  },
  features: {
    title: 'Alles, was es von der Blockchain ins Hauptbuch braucht',
    lead: 'Gebaut für Schweizer Treuhänder und für Dossiers, die einer Revision standhalten müssen.',
    items: [
      { title: 'Native bexio-Integration', text: 'Offizielle OAuth-Verbindung, Kontenplan aus bexio geladen, Zuordnung Ihrer Konten, Versand freigegebener Buchungen. Eine Buchung gilt erst als «synchronisiert», wenn bexio sie bestätigt hat.' },
      { title: 'FIFO oder gewichteter Durchschnitt', text: 'Lose pro Asset und auf Wunsch pro Wallet. Realisierte und unrealisierte Gewinne und Verluste in CHF. Rundungsdifferenzen werden vorgetragen: Das Gebuchte entspricht dem exakten Total.' },
      { title: 'Mandantenfähig für Treuhänder', text: 'Ein Konto für alle Ihre Kunden. Wechseln Sie das Dossier oben in der Leiste; die Daten jedes Kunden bleiben strikt getrennt.' },
      { title: 'AG, GmbH, Stiftung, Selbständige', text: 'Die Klassifizierungen folgen der Rechtsform: Zustiftung, erhaltene Spende, ausgerichtete Vergabung für Stiftungen. Steuerhinweise (DBG, StHG) in den Berichten, je nach Steuerstatus.' },
      { title: 'Import per API und CSV', text: 'Lesende API für Kraken, Coinbase und Binance. Öffentliche Adressen für Bitcoin (xpub), Ethereum, Solana, Cardano, ICP und OGY. Eine universelle CSV-Vorlage für alles andere.' },
      { title: 'Jahresabschluss', text: 'Steuerwerte der ESTV (Kursliste) per 31.12., Wertschriftenverzeichnis, Journal, realisierte Gewinne, Staking-Erträge und Gebühren: Excel- und CSV-Berichte für den Treuhänder.' },
      { title: 'Klassifizierung mit Kontrolle', text: 'Käufe, Verkäufe, Tausch, Staking, Airdrops, Überträge zwischen Ihren Konten: automatisch klassiert. Unsichere Fälle kommen zur Prüfung und blockieren die Berechnung bis zur Bestätigung.' },
      { title: 'Lückenloser Prüfpfad', text: 'Jede Transaktion behält ihre Originalzeilen, ihre Begründung und ihren Verlauf. Eine freigegebene Buchung wird nie automatisch geändert.' },
      { title: 'Sichere Zugriffe', text: 'Nur lesende API-Schlüssel werden akzeptiert: Ein Schlüssel mit Handels- oder Auszahlungsrechten wird abgelehnt. Schlüssel werden verschlüsselt (AES-256). Nie eine Wiederherstellungsphrase.' },
    ],
  },
  how: {
    title: 'Fünf Schritte, von der Börse bis bexio',
    steps: [
      { title: 'Importieren', text: 'Lesende API verbinden, öffentliche Adressen hinzufügen oder eine CSV hochladen.' },
      { title: 'Klassieren', text: 'Transaktionen werden automatisch klassiert; Sie bestätigen die unsicheren Fälle.' },
      { title: 'Berechnen', text: 'Umrechnung in CHF, FIFO oder gewichteter Durchschnitt, realisierte Gewinne, Gebühren.' },
      { title: 'Freigeben', text: 'Sie oder Ihr Treuhänder geben die vorgeschlagenen Buchungen frei.' },
      { title: 'Synchronisieren', text: 'Freigegebene Buchungen gehen an bexio, ohne Duplikate.' },
    ],
  },
  compare: {
    title: 'Tabelle gegen Crypto2Books',
    colOld: 'Excel + Abtippen',
    colNew: 'Crypto2Books',
    rows: [
      ['Transaktionen sammeln', 'Manuelle Exporte, verschiedene Formate', 'Lesende API und erkannte CSV-Formate'],
      ['CHF-Kurse', 'Von Hand kopiert, ohne Quelle', 'Belegt und mit Quelle, kein Kurs erfunden'],
      ['Anschaffungskosten', 'Fehleranfällige Formeln', 'FIFO oder gewichteter Durchschnitt, pro Los'],
      ['Überträge zwischen Wallets', 'Irrtümlich als Verkauf gezählt', 'Zugeordnet, zum Einstand, ohne Scheingewinn'],
      ['Erfassung in bexio', 'Buchung für Buchung', 'Sammelversand, eindeutige Referenz, keine Duplikate'],
      ['Kontrolle durch Treuhänder', 'Dateien per E-Mail', 'Prüfung, Freigabe und Prüfpfad im Tool'],
    ],
  },
  fiduciary: {
    kicker: 'Für Treuhänder',
    title: 'Ihre Kunden haben Kryptos. Sie haben endlich einen Prozess.',
    text: 'Crypto2Books richtet sich zuerst an Treuhänder, die die Buchhaltung ihrer Kunden in bexio führen. Jedes Dossier hat seine Rechtsform, seinen Kanton, seine Bewertungsmethode und seine bexio-Verbindung.',
    points: [
      'Alle Kundendossiers in einem Konto, mit Suche',
      'Vom Treuhänder freigegebene Bewertungsmethode, fixiert sobald Buchungen freigegeben sind',
      'bexio-Kontenzuordnung pro Dossier, auch ein Konto pro Wallet',
      'Berichte für Abschluss und Steuererklärung',
    ],
    cta: 'Treuhänder-Konto eröffnen',
  },
  swiss: {
    title: 'Für die ganze Schweiz',
    text: 'Vom Genfersee bis zum Bodensee, von Basel bis ins Tessin: Jedes Dossier hat seinen Kanton, und die Oberfläche spricht die Sprache Ihres Kunden.',
    langs: 'Deutsch, Français, Italiano, English',
    forms: 'AG, GmbH, Stiftung, Selbständige, Privatpersonen',
    cantons: '26 Kantone',
  },
  sources: { title: 'Unterstützte Quellen', text: 'Lesende API oder öffentliche Adressen. Für andere Plattformen: die universelle CSV-Vorlage.' },
  faq: {
    title: 'Häufige Fragen',
    items: [
      { q: 'Muss ich meine Wiederherstellungsphrase oder einen privaten Schlüssel angeben?', a: 'Nie. Crypto2Books verwendet nur lesende API-Schlüssel oder öffentliche Adressen (xpub, Adressen). Ein Schlüssel mit Handels-, Transfer- oder Auszahlungsrechten wird abgelehnt.' },
      { q: 'Was kommt in bexio an?', a: 'Manuelle Buchungen in CHF, ausgeglichen nach Soll und Haben, auf den Konten, die Sie in Ihrem bexio-Kontenplan gewählt haben. Nur freigegebene Buchungen werden gesendet.' },
      { q: 'FIFO oder gewichteter Durchschnitt?', a: 'Beides ist verfügbar. Wählen Sie die Methode mit Ihrem Treuhänder und behalten Sie sie von Jahr zu Jahr bei; sie wird gesperrt, sobald Buchungen freigegeben sind.' },
      { q: 'Meine Plattform ist nicht aufgeführt.', a: 'Verwenden Sie die Crypto2Books-CSV-Vorlage: eine Zeile pro Vorgang, mit Beispiel zum Herunterladen. Neue Integrationen kommen laufend nach Bedarf dazu.' },
      { q: 'Ersetzt Crypto2Books meinen Treuhänder?', a: 'Nein. Es ist ein Hilfsmittel für die Buchhaltung. Es bereitet Buchungen vor und dokumentiert sie; Treuhänder und Steuerverwaltung haben das letzte Wort.' },
    ],
  },
  final: { title: 'Schliessen Sie Ihr Krypto-Geschäftsjahr dieses Jahr ab, nicht nächstes.', text: 'Konto eröffnen, eine erste Datei importieren und die Buchungen in wenigen Minuten sehen.', cta: 'Gratis testen' },
  footer: {
    disclaimer: 'Crypto2Books ist ein Hilfsmittel für die Buchhaltung. Es ersetzt weder Ihren Treuhänder noch Ihre Steuerberatung und ist keine Steuerbehörde. bexio ist eine Marke der bexio AG; Crypto2Books ist kein Produkt der bexio AG.',
    rights: 'Alle Rechte vorbehalten.',
    login: 'Anmelden',
  },
  shots: { dashboard: 'Crypto2Books-Dashboard: Fortschritt, Portfoliowert und Bestände pro Asset', accounting: 'Vorgeschlagene Buchungen mit Soll, Haben und Status' },
};

const it: LandingCopy = {
  meta: {
    title: 'Crypto2Books · Contabilità cripto svizzera, direttamente in bexio',
    description: 'Importate exchange e wallet, valutate in CHF (FIFO o costo medio ponderato) e inviate registrazioni convalidate a bexio. Per fiduciarie, SA, Sagl e fondazioni.',
  },
  nav: { features: 'Funzionalità', fiduciaries: 'Fiduciarie', how: 'Come funziona', faq: 'FAQ', login: 'Accedi', trial: 'Prova gratuita', open: 'Apri il mio spazio' },
  hero: {
    kicker: 'Fatto per la contabilità svizzera',
    title: 'Le vostre cripto in bexio.',
    titleAccent: 'Senza fogli Excel. Senza ridigitare.',
    lead: 'Crypto2Books legge i vostri exchange e wallet, converte ogni operazione in CHF con un corso documentato, calcola gli utili in FIFO o al costo medio ponderato e invia a bexio registrazioni convalidate. La vostra fiduciaria mantiene il controllo a ogni passo.',
    cta: 'Inizia la prova gratuita',
    ctaSecondary: 'Come funziona',
    note: 'Senza carta di credito · Interfaccia IT · FR · DE · EN',
  },
  pains: {
    title: 'La chiusura cripto non dovrebbe più costarvi un fine settimana.',
    items: [
      { bad: 'Esportazioni CSV sempre diverse.', good: 'Kraken, Coinbase, Binance, Bitcoin, Ethereum, ICP, OGY… letti via API o CSV, in un unico formato.' },
      { bad: 'Corsi in CHF cercati uno per uno.', good: 'Ogni importo in CHF conserva la sua fonte. Nessun corso viene inventato: senza fonte, la transazione viene segnalata.' },
      { bad: 'Registrazioni ricopiate a mano in bexio.', good: 'Registrazioni bilanciate dare/avere, inviate a bexio con un riferimento unico. Mai doppioni.' },
    ],
  },
  features: {
    title: 'Tutto il necessario per passare dalla blockchain al libro mastro',
    lead: 'Pensato per le fiduciarie svizzere e per incarti che devono reggere a una revisione.',
    items: [
      { title: 'Integrazione bexio nativa', text: 'Connessione OAuth ufficiale, piano dei conti caricato da bexio, abbinamento dei vostri conti, invio delle registrazioni convalidate. Una registrazione è «sincronizzata» solo dopo la conferma di bexio.' },
      { title: 'FIFO o costo medio ponderato', text: 'Lotti seguiti per attivo e, se lo desiderate, per wallet. Utili e perdite realizzati e latenti in CHF. Gli arrotondamenti al centesimo sono riportati: il totale contabilizzato corrisponde al totale esatto.' },
      { title: 'Multi-incarto per fiduciarie', text: 'Un solo account per tutti i vostri clienti. Cambiate incarto dalla barra in alto; i dati di ogni cliente restano rigorosamente separati.' },
      { title: 'SA, Sagl, fondazione, indipendente', text: 'Le classificazioni seguono la forma giuridica: dotazione, donazione ricevuta, sussidio versato per le fondazioni. Note fiscali (LIFD, LAID) nei rapporti, secondo lo statuto fiscale.' },
      { title: 'Importazione via API e CSV', text: 'API in sola lettura per Kraken, Coinbase e Binance. Indirizzi pubblici per Bitcoin (xpub), Ethereum, Solana, Cardano, ICP e OGY. Un modello CSV universale per tutto il resto.' },
      { title: 'Chiusura di fine anno', text: 'Valori fiscali AFC (listino dei corsi) al 31.12, elenco dei titoli, giornale, utili realizzati, ricavi da staking e commissioni: rapporti Excel e CSV pronti per la fiduciaria.' },
      { title: 'Classificazione sotto controllo', text: 'Acquisti, vendite, scambi, staking, airdrop, trasferimenti tra i vostri conti: classificati automaticamente. I casi incerti passano in revisione e bloccano il calcolo fino alla verifica.' },
      { title: 'Traccia di revisione completa', text: 'Ogni transazione conserva le righe d’origine, la motivazione e la cronologia. Una registrazione convalidata non viene mai modificata automaticamente.' },
      { title: 'Accessi sicuri', text: 'Sono accettate solo chiavi API in sola lettura: una chiave che consente trading o prelievi viene rifiutata. Le chiavi sono cifrate (AES-256). Mai una frase di recupero.' },
    ],
  },
  how: {
    title: 'Cinque passi, dall’exchange a bexio',
    steps: [
      { title: 'Importare', text: 'Collegate un’API in sola lettura, aggiungete indirizzi pubblici o caricate un CSV.' },
      { title: 'Classificare', text: 'Le transazioni sono classificate automaticamente; confermate i casi incerti.' },
      { title: 'Calcolare', text: 'Conversione in CHF, FIFO o costo medio ponderato, utili realizzati, commissioni.' },
      { title: 'Convalidare', text: 'Voi o la vostra fiduciaria convalidate le registrazioni proposte.' },
      { title: 'Sincronizzare', text: 'Le registrazioni convalidate partono verso bexio, senza doppioni.' },
    ],
  },
  compare: {
    title: 'Il foglio Excel contro Crypto2Books',
    colOld: 'Excel + ridigitazione',
    colNew: 'Crypto2Books',
    rows: [
      ['Raccolta delle transazioni', 'Esportazioni manuali, formati diversi', 'API in sola lettura e CSV riconosciuti'],
      ['Corsi in CHF', 'Copiati a mano, senza fonte', 'Documentati e con fonte, nessun corso inventato'],
      ['Costo di acquisto', 'Formule fragili', 'FIFO o costo medio ponderato, per lotto'],
      ['Trasferimenti tra wallet', 'Contati per errore come vendite', 'Abbinati, al costo, senza utile fittizio'],
      ['Registrazione in bexio', 'Una registrazione alla volta', 'Invio raggruppato, riferimento unico, senza doppioni'],
      ['Controllo della fiduciaria', 'File via e-mail', 'Revisione, convalida e traccia di revisione nello strumento'],
    ],
  },
  fiduciary: {
    kicker: 'Per le fiduciarie',
    title: 'I vostri clienti hanno cripto. Voi avete finalmente un processo.',
    text: 'Crypto2Books si rivolge innanzitutto alle fiduciarie che tengono la contabilità dei clienti in bexio. Ogni incarto ha la sua forma giuridica, il suo cantone, il suo metodo di valutazione e la sua connessione bexio.',
    points: [
      'Tutti gli incarti dei clienti in un solo account, con ricerca',
      'Metodo di valutazione convalidato dalla fiduciaria, bloccato una volta convalidate le registrazioni',
      'Abbinamento dei conti bexio per incarto, anche un conto per wallet',
      'Rapporti per la chiusura e la dichiarazione d’imposta',
    ],
    cta: 'Crea il mio spazio fiduciaria',
  },
  swiss: {
    title: 'Per tutta la Svizzera',
    text: 'Dal Lemano al Bodanico, da Basilea al Ticino: ogni incarto indica il suo cantone e l’interfaccia parla la lingua del vostro cliente.',
    langs: 'Italiano, Français, Deutsch, English',
    forms: 'SA, Sagl, fondazione, indipendente, privato',
    cantons: '26 cantoni',
  },
  sources: { title: 'Fonti supportate', text: 'API in sola lettura o indirizzi pubblici. Per le altre piattaforme: il modello CSV universale.' },
  faq: {
    title: 'Domande frequenti',
    items: [
      { q: 'Devo fornire la frase di recupero o una chiave privata?', a: 'Mai. Crypto2Books usa solo chiavi API in sola lettura o indirizzi pubblici (xpub, indirizzi). Una chiave che consente trading, trasferimenti o prelievi viene rifiutata.' },
      { q: 'Cosa arriva in bexio?', a: 'Registrazioni manuali in CHF, bilanciate dare/avere, sui conti scelti nel vostro piano dei conti bexio. Vengono inviate solo le registrazioni convalidate.' },
      { q: 'FIFO o costo medio ponderato?', a: 'Sono disponibili entrambi. Scegliete il metodo con la vostra fiduciaria e mantenetelo da un esercizio all’altro; viene bloccato non appena ci sono registrazioni convalidate.' },
      { q: 'La mia piattaforma non è nell’elenco.', a: 'Usate il modello CSV Crypto2Books: una riga per operazione, con un esempio scaricabile. Nuove integrazioni vengono aggiunte in base alle richieste.' },
      { q: 'Crypto2Books sostituisce la mia fiduciaria?', a: 'No. È uno strumento di supporto alla contabilità. Prepara e documenta le registrazioni; la fiduciaria e l’amministrazione fiscale hanno l’ultima parola.' },
    ],
  },
  final: { title: 'Chiudete il vostro esercizio cripto quest’anno, non il prossimo.', text: 'Create un account, importate un primo file e vedete le registrazioni in pochi minuti.', cta: 'Inizia la prova gratuita' },
  footer: {
    disclaimer: 'Crypto2Books è uno strumento di supporto alla contabilità. Non sostituisce la vostra fiduciaria né il vostro consulente fiscale e non è un’autorità fiscale. bexio è un marchio di bexio AG; Crypto2Books non è un prodotto di bexio AG.',
    rights: 'Tutti i diritti riservati.',
    login: 'Accedi',
  },
  shots: { dashboard: 'Dashboard di Crypto2Books: avanzamento, valore del portafoglio e averi per attivo', accounting: 'Registrazioni proposte con dare, avere e stato' },
};

const en: LandingCopy = {
  meta: {
    title: 'Crypto2Books · Swiss crypto accounting, straight into bexio',
    description: 'Import exchanges and wallets, value everything in CHF (FIFO or weighted average cost) and send approved entries to bexio. For fiduciaries, AG/SA, GmbH/Sàrl and foundations.',
  },
  nav: { features: 'Features', fiduciaries: 'Fiduciaries', how: 'How it works', faq: 'FAQ', login: 'Log in', trial: 'Free trial', open: 'Open my workspace' },
  hero: {
    kicker: 'Made for Swiss accounting',
    title: 'Your crypto in bexio.',
    titleAccent: 'No spreadsheets. No retyping.',
    lead: 'Crypto2Books reads your exchanges and wallets, converts every transaction to CHF with a documented rate, computes gains with FIFO or weighted average cost, then sends approved entries to bexio. Your fiduciary stays in control at every step.',
    cta: 'Start the free trial',
    ctaSecondary: 'See how it works',
    note: 'No credit card · Interface in EN · FR · DE · IT',
  },
  pains: {
    title: 'Closing the crypto books shouldn’t cost you a weekend.',
    items: [
      { bad: 'CSV exports that never look the same.', good: 'Kraken, Coinbase, Binance, Bitcoin, Ethereum, ICP, OGY… read by API or CSV, into one format.' },
      { bad: 'CHF rates looked up one by one.', good: 'Every CHF amount keeps its source. No rate is ever invented: without a source, the transaction is flagged.' },
      { bad: 'Entries retyped by hand into bexio.', good: 'Balanced debit/credit entries, sent to bexio with a unique reference. Never duplicated.' },
    ],
  },
  features: {
    title: 'Everything you need to go from blockchain to general ledger',
    lead: 'Built for Swiss fiduciaries and for files that have to stand up to an audit.',
    items: [
      { title: 'Native bexio integration', text: 'Official OAuth connection, chart of accounts loaded from bexio, account mapping, approved entries sent. An entry is only marked “synced” once bexio has confirmed it.' },
      { title: 'FIFO or weighted average cost', text: 'Lots tracked per asset and, if you want, per wallet. Realised and unrealised gains and losses in CHF. Rounding to the centime is carried forward so the booked total matches the exact total.' },
      { title: 'Multi-client for fiduciaries', text: 'One account for all your clients. Switch files from the top bar; each client’s data stays strictly separate.' },
      { title: 'AG, GmbH, foundation, self-employed', text: 'Classifications follow the legal form: endowment, donation received, grant paid for foundations. Tax notes (DBG/LIFD, StHG/LHID) in the reports, by tax status.' },
      { title: 'API and CSV imports', text: 'Read-only API for Kraken, Coinbase and Binance. Public addresses for Bitcoin (xpub), Ethereum, Solana, Cardano, ICP and OGY. A universal CSV template for everything else.' },
      { title: 'Year-end closing', text: 'Federal Tax Administration tax values (Kursliste) at 31.12, securities statement, journal, realised gains, staking income and fees: Excel and CSV reports ready for the fiduciary.' },
      { title: 'Classification with control', text: 'Buys, sells, swaps, staking, airdrops, transfers between your own accounts: classified automatically. Uncertain cases go to review and block the calculation until they are checked.' },
      { title: 'Full audit trail', text: 'Every transaction keeps its original rows, its reasoning and its history. An approved entry is never changed automatically.' },
      { title: 'Secure access', text: 'Only read-only API keys are accepted: a key that allows trading or withdrawals is refused. Keys are encrypted (AES-256). Never a recovery phrase.' },
    ],
  },
  how: {
    title: 'Five steps, from exchange to bexio',
    steps: [
      { title: 'Import', text: 'Connect a read-only API, add public addresses or drop in a CSV.' },
      { title: 'Classify', text: 'Transactions are classified automatically; you confirm the uncertain ones.' },
      { title: 'Calculate', text: 'Conversion to CHF, FIFO or weighted average cost, realised gains, fees.' },
      { title: 'Approve', text: 'You or your fiduciary approve the proposed entries.' },
      { title: 'Sync', text: 'Approved entries go to bexio, without duplicates.' },
    ],
  },
  compare: {
    title: 'Spreadsheet vs Crypto2Books',
    colOld: 'Spreadsheet + retyping',
    colNew: 'Crypto2Books',
    rows: [
      ['Collecting transactions', 'Manual exports, different formats', 'Read-only API and recognised CSV formats'],
      ['CHF rates', 'Copied by hand, no source', 'Documented with a source, none invented'],
      ['Cost basis', 'Fragile formulas', 'FIFO or weighted average cost, per lot'],
      ['Transfers between wallets', 'Counted as sales by mistake', 'Matched, at cost, no phantom gain'],
      ['Booking in bexio', 'One entry at a time', 'Batch send, unique reference, no duplicates'],
      ['Fiduciary review', 'Files by e-mail', 'Review, approval and audit trail in the tool'],
    ],
  },
  fiduciary: {
    kicker: 'For fiduciaries',
    title: 'Your clients hold crypto. Now you have a process.',
    text: 'Crypto2Books is built first for fiduciaries who keep their clients’ books in bexio. Each file has its own legal form, canton, valuation method and bexio connection.',
    points: [
      'All client files in one account, with search',
      'Valuation method approved by the fiduciary, locked once entries are approved',
      'bexio account mapping per file, including one account per wallet',
      'Reports for year-end closing and the tax return',
    ],
    cta: 'Create my fiduciary workspace',
  },
  swiss: {
    title: 'For all of Switzerland',
    text: 'From Lake Geneva to Lake Constance, from Basel to Ticino: each file records its canton, and the interface speaks your client’s language.',
    langs: 'English, Français, Deutsch, Italiano',
    forms: 'AG/SA, GmbH/Sàrl, foundation, self-employed, private investor',
    cantons: '26 cantons',
  },
  sources: { title: 'Supported sources', text: 'Read-only API or public addresses. For other platforms: the universal CSV template.' },
  faq: {
    title: 'Frequently asked questions',
    items: [
      { q: 'Do I have to hand over my recovery phrase or a private key?', a: 'Never. Crypto2Books only uses read-only API keys or public addresses (xpub, addresses). A key that allows trading, transfers or withdrawals is refused.' },
      { q: 'What ends up in bexio?', a: 'Manual entries in CHF, balanced debit/credit, on the accounts you chose in your bexio chart of accounts. Only approved entries are sent.' },
      { q: 'FIFO or weighted average cost?', a: 'Both are available. Pick the method with your fiduciary and keep it from one year to the next; it is locked as soon as entries are approved.' },
      { q: 'My platform isn’t listed.', a: 'Use the Crypto2Books CSV template: one row per operation, with a downloadable example. New integrations are added as they are requested.' },
      { q: 'Does Crypto2Books replace my fiduciary?', a: 'No. It is an accounting aid. It prepares and documents entries; your fiduciary and the tax authority have the final word.' },
    ],
  },
  final: { title: 'Close your crypto year this year, not next year.', text: 'Create an account, import a first file and see your entries within minutes.', cta: 'Start the free trial' },
  footer: {
    disclaimer: 'Crypto2Books is an accounting aid. It does not replace your fiduciary or tax adviser and is not a tax authority. bexio is a trademark of bexio AG; Crypto2Books is not a bexio AG product.',
    rights: 'All rights reserved.',
    login: 'Log in',
  },
  shots: { dashboard: 'Crypto2Books dashboard: progress, portfolio value and holdings per asset', accounting: 'Proposed accounting entries with debit, credit and status' },
};

export const LANDING: Record<Locale, LandingCopy> = { fr, de, it, en };

/** Sources shown on the landing page, matching the connectors and importers in the app. */
export const LANDING_SOURCES = ['Kraken', 'Coinbase', 'Binance', 'Bitcoin · xpub', 'Ethereum', 'Solana', 'Cardano', 'ICP', 'OGY', 'CSV'];

export const LOCALE_NAMES: Record<Locale, string> = { fr: 'Français', de: 'Deutsch', it: 'Italiano', en: 'English' };
