import type { SourceConnector } from '@/integrations/sources/types';

/**
 * Connector help, limits and field labels, plus the integration notes, in German, Italian and English.
 * The French text stays next to the code (connectors and importers); anything missing here falls back to it.
 */
interface ConnectorCopy { help: string; limits: string; fields?: Record<string, string> }

const CONNECTORS: Record<string, Record<string, ConnectorCopy>> = {
  de: {
    kraken: {
      fields: { apiKey: 'API-Schlüssel (API key)', apiSecret: 'Privater Schlüssel (Private key)' },
      help: 'Kraken → Einstellungen → API → Schlüssel erstellen. Nur «Query ledger entries» (Daten) ankreuzen. Weder Handel noch Ein- oder Auszahlung ankreuzen.',
      limits: 'Kraken erlaubt keine Prüfung der Rechte eines Schlüssels: Wir rufen nur das Lesen des Ledgers auf. Nach offizieller Dokumentation umgesetzt, mit einem echten Konto zu bestätigen.',
    },
    coinbase: {
      fields: { keyName: 'Schlüsselname (organizations/…/apiKeys/…)', privateKey: 'Privater Schlüssel (-----BEGIN EC PRIVATE KEY-----…)' },
      help: 'Coinbase Developer Platform → API Keys → Schlüssel vom Typ «Secret API key» erstellen, Algorithmus ECDSA (nicht Ed25519). Berechtigung: nur «View». Schlüssel mit Trade oder Transfer lehnen wir ab.',
      limits: 'Die Unterfelder von Käufen/Verkäufen sind bei Coinbase nicht dokumentiert: Im Preis enthaltene Gebühren werden nicht getrennt, und ein nicht zugeordneter Teil kommt zur Prüfung.',
    },
    binance: {
      fields: { apiKey: 'API Key', apiSecret: 'Secret Key', extraSymbols: 'Zusätzliche Paare (optional, z. B. SOLUSDT, ADAEUR)' },
      help: 'Binance → Profil → API-Verwaltung → Schlüssel erstellen (systemgeneriert). Nur «Enable Reading» angekreuzt lassen. Wir lehnen jeden Schlüssel ab, der Handel, Transfers oder Auszahlungen erlaubt.',
      limits: 'Umfasst Ein- und Auszahlungen, Spot-Trades und Simple-Earn-Erträge (Staking). Noch nicht: Convert, Staub-Umwandlung, Kartenkäufe, ETH-Staking über WBETH. Binance listet die gehandelten Paare nicht auf: Wir fragen die Paare Ihrer Assets ab; fehlende Paare im vorgesehenen Feld ergänzen.',
    },
    bitcoin: {
      fields: { addresses: 'Erweiterter öffentlicher Schlüssel (xpub, ypub, zpub) oder Bitcoin-Adressen, eine pro Zeile' },
      help: 'Am einfachsten: der erweiterte öffentliche Schlüssel des Kontos (Ledger Live: Konto → Bearbeiten → Erweitert; Trezor Suite: Details → Öffentlichen Schlüssel anzeigen; Sparrow/Electrum: Wallet → Informationen). Alle Adressen des Wallets werden automatisch gefunden. Mit einer xpub kann man nur lesen, nie ausgeben. Nie eine Wiederherstellungsphrase oder einen privaten Schlüssel (xprv).',
      limits: 'Sucht Adressen bis zu 20 unbenutzten Adressen in Folge (Standardregel der Wallets). Eine einfache «xpub» wird in allen drei Adressformaten gelesen (bc1q, 3…, 1…). Taproot (bc1p) und Multisig werden noch nicht unterstützt. Daten über mempool.space.',
    },
    ethereum: {
      fields: { addresses: 'Öffentliche Ethereum-Adressen 0x… (eine pro Zeile)' },
      help: 'Kopieren Sie die öffentliche Adresse Ihres Wallets (MetaMask, Ledger, Trezor, Rabby…). Nie eine Wiederherstellungsphrase oder einen privaten Schlüssel.',
      limits: 'Ethereum-Hauptnetz: ETH, ERC-20-Token, NFT (ERC-721 und ERC-1155) und von Verträgen erhaltene ETH. DeFi-Swaps werden als Tausch vorgeschlagen; Pools, Darlehen und NFT kommen zur Prüfung. Noch nicht: andere Netzwerke (Arbitrum, Base, Polygon…).',
    },
    solana: {
      fields: { addresses: 'Adressen der Solana-Staking-Konten (eine pro Zeile)' },
      help: 'Öffnen Sie in Phantom, Solflare oder Ledger Live die Staking-Position und kopieren Sie die Adresse des Staking-Kontos (nicht die des Validators). Nie eine Wiederherstellungsphrase.',
      limits: 'Liest die nativen SOL-Staking-Erträge Epoche für Epoche (je etwa 2 Tage): Eine lange Historie braucht mehrere Synchronisationen. Liquid Staking (mSOL, JitoSOL…) und Ein-/Ausgänge des Wallets werden noch nicht gelesen. Der öffentliche RPC liefert sehr alte Epochen eventuell nicht.',
    },
    cardano: {
      fields: { addresses: 'Staking-Adresse (stake1…) oder eine Empfangsadresse (addr1…) pro Wallet' },
      help: 'Kopieren Sie in Yoroi, Eternl, Lace oder Daedalus die Staking-Adresse (stake1…) oder eine Empfangsadresse: Die Staking-Adresse wird daraus abgeleitet. Nie eine Wiederherstellungsphrase.',
      limits: 'Liest die ADA-Delegationserträge (Datum: Beginn der Epoche, in der sie verfügbar werden). Ein- und Ausgänge des Wallets werden noch nicht gelesen: Importieren Sie sie von der Ursprungsplattform oder per CSV. Daten über Koios.',
    },
    icp: {
      fields: { addresses: 'Principal ID (liest OGY und ICP) und/oder ICP Account ID (64 Zeichen), eine pro Zeile' },
      help: 'ICP und OGY sind zwei verschiedene Ledger: Eine Principal ID (xxxxx-xxxxx-…-cai) wird auf beiden gelesen (OGY direkt, ICP über ihre Standard-Account-ID). Eine Account ID mit 64 Zeichen gilt nur für ICP (z. B. ein NNS-Konto oder Unterkonto). Ein Wallet pro Zeile, oder eine Quelle pro Wallet, wenn jedes sein eigenes bexio-Konto hat. Nie eine Wiederherstellungsphrase.',
      limits: 'Liest ICP- und OGY-Bewegungen. NNS-Belohnungen werden erkannt, wenn die Maturity auf ein Konto ausbezahlt wird (Token-Erzeugung), und kommen zur Prüfung. Das Sperren von ICP in einem Neuron erscheint als Ausgang: Bestätigen Sie ihn als internen Übertrag. OGY-Unterkonten eines Principals werden zusammengefasst; für ICP eines Unterkontos dessen Account ID hinzufügen. Andere ICRC-Token werden noch nicht gelesen. Daten: offizielles ICP-Dashboard.',
    },
  },
  it: {
    kraken: {
      fields: { apiKey: 'Chiave API (API key)', apiSecret: 'Chiave privata (Private key)' },
      help: 'Kraken → Impostazioni → API → Crea una chiave. Selezionate solo «Query ledger entries» (Dati). Non selezionate né trading, né depositi, né prelievi.',
      limits: 'Kraken non permette di verificare i diritti di una chiave: chiamiamo solo la lettura del registro. Scritto secondo la documentazione ufficiale, da convalidare con un account reale.',
    },
    coinbase: {
      fields: { keyName: 'Nome della chiave (organizations/…/apiKeys/…)', privateKey: 'Chiave privata (-----BEGIN EC PRIVATE KEY-----…)' },
      help: 'Coinbase Developer Platform → API Keys → Create una chiave di tipo «Secret API key», algoritmo ECDSA (non Ed25519). Permesso: solo «View». Rifiutiamo qualsiasi chiave con Trade o Transfer.',
      limits: 'I sottocampi di acquisti/vendite non sono documentati da Coinbase: le commissioni incluse nel prezzo non vengono separate e una parte non abbinata va in revisione.',
    },
    binance: {
      fields: { apiKey: 'API Key', apiSecret: 'Secret Key', extraSymbols: 'Coppie aggiuntive (facoltativo, es. SOLUSDT, ADAEUR)' },
      help: 'Binance → Profilo → Gestione API → Create una chiave (generata dal sistema). Lasciate selezionato solo «Enable Reading». Rifiutiamo qualsiasi chiave che consenta trading, trasferimenti o prelievi.',
      limits: 'Copre depositi, prelievi, trade spot e ricompense Simple Earn (staking). Non ancora: Convert, conversione della polvere, acquisti con carta, staking ETH tramite WBETH. Binance non elenca le coppie scambiate: interroghiamo le coppie dei vostri attivi; aggiungete una coppia mancante nel campo previsto.',
    },
    bitcoin: {
      fields: { addresses: 'Chiave pubblica estesa (xpub, ypub, zpub) o indirizzi Bitcoin, uno per riga' },
      help: 'Il modo più semplice: la chiave pubblica estesa del conto (Ledger Live: Conto → Modifica → Avanzate; Trezor Suite: Dettagli → Mostra chiave pubblica; Sparrow/Electrum: Wallet → Informazioni). Tutti gli indirizzi del wallet vengono trovati automaticamente. Una xpub permette solo di leggere, mai di spendere. Mai frasi di recupero né chiavi private (xprv).',
      limits: 'Cerca indirizzi fino a 20 indirizzi inutilizzati di fila (regola standard dei wallet). Una «xpub» semplice è letta nei tre formati di indirizzo (bc1q, 3…, 1…). Taproot (bc1p) e multisig non sono ancora supportati. Dati tramite mempool.space.',
    },
    ethereum: {
      fields: { addresses: 'Indirizzi Ethereum pubblici 0x… (uno per riga)' },
      help: 'Copiate l’indirizzo pubblico del vostro wallet (MetaMask, Ledger, Trezor, Rabby…). Mai frasi di recupero né chiavi private.',
      limits: 'Rete Ethereum principale: ETH, token ERC-20, NFT (ERC-721 ed ERC-1155) ed ETH ricevuti da contratti. Gli swap DeFi sono proposti come scambi; pool, prestiti e NFT vanno in revisione per la convalida. Non ancora: altre reti (Arbitrum, Base, Polygon…).',
    },
    solana: {
      fields: { addresses: 'Indirizzi dei conti di staking Solana (uno per riga)' },
      help: 'In Phantom, Solflare o Ledger Live aprite la posizione di staking e copiate l’indirizzo del conto di staking (non quello del validatore). Mai frasi di recupero.',
      limits: 'Legge le ricompense di staking nativo SOL, epoca per epoca (circa 2 giorni ciascuna): una lunga cronologia richiede più sincronizzazioni. Lo staking liquido (mSOL, JitoSOL…) e gli invii/ricezioni del wallet non sono ancora letti. L’RPC pubblico potrebbe non servire epoche molto vecchie.',
    },
    cardano: {
      fields: { addresses: 'Indirizzo di staking (stake1…) o un indirizzo di ricezione (addr1…) per wallet' },
      help: 'In Yoroi, Eternl, Lace o Daedalus copiate l’indirizzo di staking (stake1…) o un indirizzo di ricezione: l’indirizzo di staking ne viene dedotto. Mai frasi di recupero.',
      limits: 'Legge le ricompense di delega ADA (data: inizio dell’epoca in cui diventano disponibili). Gli invii e le ricezioni del wallet non sono ancora letti: importateli dalla piattaforma d’origine o via CSV. Dati tramite Koios.',
    },
    icp: {
      fields: { addresses: 'Principal ID (legge OGY e ICP) e/o Account ID ICP (64 caratteri), uno per riga' },
      help: 'ICP e OGY sono due registri diversi: un Principal ID (xxxxx-xxxxx-…-cai) è letto su entrambi (OGY direttamente, ICP tramite il suo Account ID predefinito). Un Account ID di 64 caratteri vale solo per ICP (ad esempio un conto NNS o un sottoconto). Un wallet per riga, o una fonte per wallet se ognuno ha il suo conto bexio. Mai frasi di recupero.',
      limits: 'Legge i movimenti ICP e OGY. Le ricompense NNS sono riconosciute quando la maturity viene versata su un conto (creazione di token) e vanno in revisione. Il blocco di ICP in un neurone appare come un invio: confermatelo come trasferimento interno. I sottoconti OGY di un Principal sono raggruppati; per gli ICP di un sottoconto aggiungete il suo Account ID. Gli altri token ICRC non sono ancora letti. Dati: dashboard ufficiale ICP.',
    },
  },
  en: {
    kraken: {
      fields: { apiKey: 'API key', apiSecret: 'Private key' },
      help: 'Kraken → Settings → API → Create key. Tick only “Query ledger entries” (Data). Do not tick trading, deposits or withdrawals.',
      limits: 'Kraken offers no way to check a key’s permissions: we only call the ledger read endpoint. Built from the official documentation, to be confirmed with a real account.',
    },
    coinbase: {
      fields: { keyName: 'Key name (organizations/…/apiKeys/…)', privateKey: 'Private key (-----BEGIN EC PRIVATE KEY-----…)' },
      help: 'Coinbase Developer Platform → API Keys → create a “Secret API key”, ECDSA algorithm (not Ed25519). Permission: “View” only. We refuse any key with Trade or Transfer.',
      limits: 'Coinbase does not document the sub-fields of buys/sells: fees built into the price are not split out, and an unmatched leg is sent to review.',
    },
    binance: {
      fields: { apiKey: 'API Key', apiSecret: 'Secret Key', extraSymbols: 'Extra pairs (optional, e.g. SOLUSDT, ADAEUR)' },
      help: 'Binance → Profile → API Management → Create key (system generated). Leave only “Enable Reading” ticked. We refuse any key that allows trading, transfers or withdrawals.',
      limits: 'Covers deposits, withdrawals, spot trades and Simple Earn rewards (staking). Not yet: Convert, dust conversion, card purchases, ETH staking via WBETH. Binance does not list traded pairs: we query the pairs of your assets; add a missing pair in the field provided.',
    },
    bitcoin: {
      fields: { addresses: 'Extended public key (xpub, ypub, zpub) or Bitcoin addresses, one per line' },
      help: 'Easiest: the account’s extended public key (Ledger Live: Account → Edit → Advanced; Trezor Suite: Details → Show public key; Sparrow/Electrum: Wallet → Information). All wallet addresses are found automatically. An xpub can only read, never spend. Never a recovery phrase or private key (xprv).',
      limits: 'Scans addresses up to 20 unused addresses in a row (the standard wallet rule). A plain “xpub” is read in all three address formats (bc1q, 3…, 1…). Taproot (bc1p) and multisig are not supported yet. Data via mempool.space.',
    },
    ethereum: {
      fields: { addresses: 'Public Ethereum addresses 0x… (one per line)' },
      help: 'Copy your wallet’s public address (MetaMask, Ledger, Trezor, Rabby…). Never a recovery phrase or private key.',
      limits: 'Ethereum mainnet: ETH, ERC-20 tokens, NFTs (ERC-721 and ERC-1155) and ETH received from contracts. DeFi swaps are proposed as swaps; pools, loans and NFTs go to review for approval. Not yet: other networks (Arbitrum, Base, Polygon…).',
    },
    solana: {
      fields: { addresses: 'Solana stake account addresses (one per line)' },
      help: 'In Phantom, Solflare or Ledger Live, open the staking position and copy the stake account address (not the validator’s). Never a recovery phrase.',
      limits: 'Reads native SOL staking rewards epoch by epoch (about 2 days each): a long history takes several syncs. Liquid staking (mSOL, JitoSOL…) and wallet sends/receives are not read yet. The public RPC may not serve very old epochs.',
    },
    cardano: {
      fields: { addresses: 'Stake address (stake1…) or one receiving address (addr1…) per wallet' },
      help: 'In Yoroi, Eternl, Lace or Daedalus, copy the stake address (stake1…) or a receiving address: the stake address is derived from it. Never a recovery phrase.',
      limits: 'Reads ADA delegation rewards (date: start of the epoch in which they become available). Wallet sends and receives are not read yet: import them from the original platform or by CSV. Data via Koios.',
    },
    icp: {
      fields: { addresses: 'Principal ID (reads OGY and ICP) and/or ICP Account ID (64 characters), one per line' },
      help: 'ICP and OGY are two separate ledgers: a Principal ID (xxxxx-xxxxx-…-cai) is read on both (OGY directly, ICP via its default Account ID). A 64-character Account ID only works for ICP (for example an NNS account or sub-account). One wallet per line, or one source per wallet if each has its own bexio account. Never a recovery phrase.',
      limits: 'Reads ICP and OGY movements. NNS rewards are recognised when maturity is paid to an account (token minting) and go to review. Locking ICP in a neuron shows up as a send: confirm it as an internal transfer. A Principal’s OGY sub-accounts are grouped; for ICP in a sub-account, add its Account ID. Other ICRC tokens are not read yet. Data: official ICP dashboard.',
    },
  },
};

const NOTES: Record<string, Record<string, string>> = {
  de: {
    generic: 'Jede Quelle, mit unserer dokumentierten Vorlage.',
    kraken: 'CSV «Ledgers» oder lesende API (gleiche Verarbeitung).',
    coinbase: 'CSV «Transaction history» oder CDP-API-Schlüssel nur mit «View».',
    binance: 'Lesende API: Ein- und Auszahlungen, Spot-Trades, Simple-Earn-Erträge. Convert folgt.',
    bitcoin: 'Erweiterter öffentlicher Schlüssel (xpub/ypub/zpub) oder Adressen, über mempool.space.',
    ethereum: 'ETH, ERC-20-Token, NFT und DeFi-Swaps über Etherscan. Weitere EVM-Netzwerke folgen.',
    solana: 'Native Staking-Erträge über öffentlichen RPC. Ein- und Ausgänge folgen.',
    cardano: 'ADA-Delegationserträge über Koios. Ein- und Ausgänge folgen.',
    icp: 'Account ID (ICP) und Principal ID (OGY) über das offizielle ICP-Dashboard. NNS-Belohnungen zur Prüfung vorgeschlagen.',
    polkadot: 'Über Subscan (kostenloser API-Schlüssel): Dokumentation wird geprüft. Bis dahin: Staking über Kraken, Coinbase oder Binance, oder CSV.',
    bitstamp: 'Offizielle API vorhanden; Integration folgt.',
    cryptocom: 'Die Consumer-App hat keine Verlaufs-API: nur CSV.',
    swissborg: 'Keine öffentliche API: Import des Auszugs folgt.',
    bitpanda: 'Verwenden Sie bis dahin die CSV-Vorlage.',
    ledger: 'Fügen Sie Ihre öffentlichen Adressen als Bitcoin- oder Ethereum-Quelle hinzu. Nie die Wiederherstellungsphrase.',
    trezor: 'Fügen Sie Ihre öffentlichen Adressen als Bitcoin- oder Ethereum-Quelle hinzu. Nie die Wiederherstellungsphrase.',
    metamask: 'Fügen Sie Ihre 0x…-Adresse als Ethereum-Quelle hinzu.',
  },
  it: {
    generic: 'Qualsiasi fonte, con il nostro modello documentato.',
    kraken: 'CSV «Ledgers» o API in sola lettura (stesso trattamento).',
    coinbase: 'CSV «Transaction history» o chiave API CDP solo «View».',
    binance: 'API in sola lettura: depositi, prelievi, trade spot, ricompense Simple Earn. Convert in arrivo.',
    bitcoin: 'Chiave pubblica estesa (xpub/ypub/zpub) o indirizzi, tramite mempool.space.',
    ethereum: 'ETH, token ERC-20, NFT e swap DeFi tramite Etherscan. Altre reti EVM in arrivo.',
    solana: 'Ricompense di staking nativo tramite RPC pubblico. Invii/ricezioni in arrivo.',
    cardano: 'Ricompense di delega ADA tramite Koios. Invii/ricezioni in arrivo.',
    icp: 'Account ID (ICP) e Principal ID (OGY) tramite la dashboard ufficiale ICP. Ricompense NNS proposte in revisione.',
    polkadot: 'Tramite Subscan (chiave API gratuita): documentazione in verifica. Nel frattempo: staking tramite Kraken, Coinbase o Binance, o CSV.',
    bitstamp: 'API ufficiale disponibile; integrazione in arrivo.',
    cryptocom: 'L’app consumer non ha un’API della cronologia: solo CSV.',
    swissborg: 'Nessuna API pubblica: importazione dell’estratto in arrivo.',
    bitpanda: 'Nel frattempo usate il modello CSV.',
    ledger: 'Aggiungete i vostri indirizzi pubblici come fonte Bitcoin o Ethereum. Mai la frase di recupero.',
    trezor: 'Aggiungete i vostri indirizzi pubblici come fonte Bitcoin o Ethereum. Mai la frase di recupero.',
    metamask: 'Aggiungete il vostro indirizzo 0x… come fonte Ethereum.',
  },
  en: {
    generic: 'Any source, with our documented template.',
    kraken: '“Ledgers” CSV or read-only API (same processing).',
    coinbase: '“Transaction history” CSV or a CDP API key with “View” only.',
    binance: 'Read-only API: deposits, withdrawals, spot trades, Simple Earn rewards. Convert coming.',
    bitcoin: 'Extended public key (xpub/ypub/zpub) or addresses, via mempool.space.',
    ethereum: 'ETH, ERC-20 tokens, NFTs and DeFi swaps via Etherscan. Other EVM networks coming.',
    solana: 'Native staking rewards via public RPC. Sends/receives coming.',
    cardano: 'ADA delegation rewards via Koios. Sends/receives coming.',
    icp: 'Account ID (ICP) and Principal ID (OGY) via the official ICP dashboard. NNS rewards proposed for review.',
    polkadot: 'Via Subscan (free API key): documentation being verified. Meanwhile: staking via Kraken, Coinbase or Binance, or CSV.',
    bitstamp: 'Official API available; integration coming.',
    cryptocom: 'The consumer app has no history API: CSV only.',
    swissborg: 'No public API: statement import coming.',
    bitpanda: 'Use the CSV template for now.',
    ledger: 'Add your public addresses as a Bitcoin or Ethereum source. Never the recovery phrase.',
    trezor: 'Add your public addresses as a Bitcoin or Ethereum source. Never the recovery phrase.',
    metamask: 'Add your 0x… address as an Ethereum source.',
  },
};

/** The connector with its help, limits and field labels in the interface language. */
export function connectorText(c: SourceConnector, locale: string): SourceConnector {
  const tr = CONNECTORS[locale]?.[c.provider];
  if (!tr) return c;
  return { ...c, help: tr.help, limits: tr.limits, fields: c.fields.map((f) => ({ ...f, label: tr.fields?.[f.name] ?? f.label })) };
}

/** Integration matrix note in the interface language (French source text as fallback). */
export function integrationNote(provider: string, fallback: string, locale: string): string {
  return NOTES[locale]?.[provider] ?? fallback;
}

const LABEL_WORDS: Record<string, [RegExp, string][]> = {
  de: [[/\(adresses\)/, '(Adressen)'], [/Crypto2Books CSV template/, 'Crypto2Books CSV-Vorlage']],
  it: [[/\(adresses\)/, '(indirizzi)'], [/Crypto2Books CSV template/, 'Modello CSV Crypto2Books']],
  en: [[/\(adresses\)/, '(addresses)']],
  fr: [[/Crypto2Books CSV template/, 'Modèle CSV Crypto2Books']],
};

/** Integration name in the interface language (only the descriptive words change). */
export function integrationLabel(label: string, locale: string): string {
  return (LABEL_WORDS[locale] ?? []).reduce((s, [re, to]) => s.replace(re, to), label);
}
