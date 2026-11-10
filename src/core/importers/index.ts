import type { SupportLevel } from '../types';
import { coinbaseImporter } from './coinbase';
import { genericImporter } from './generic';
import { krakenLedgerImporter } from './kraken';
import type { Importer } from './types';

export const IMPORTERS: Importer[] = [genericImporter, krakenLedgerImporter, coinbaseImporter];

export function getImporter(id: string): Importer | undefined {
  return IMPORTERS.find((i) => i.id === id);
}

export function detectImporter(text: string): Importer | undefined {
  return IMPORTERS.find((i) => i.detect(text));
}

/**
 * Honest integration matrix shown in the UI ("Wallets & exchanges").
 * Never mark something supported before it works end to end with real data.
 */
export interface IntegrationStatus {
  provider: string;
  label: string;
  csv: SupportLevel;
  api: SupportLevel;
  note: string;
}

export const INTEGRATIONS: IntegrationStatus[] = [
  { provider: 'generic', label: 'Crypto2Books CSV template', csv: 'supported', api: 'unavailable', note: 'Toute source, avec notre modèle documenté.' },
  { provider: 'kraken', label: 'Kraken', csv: 'partial', api: 'partial', note: 'CSV « Ledgers » ou API lecture seule (même traitement).' },
  { provider: 'coinbase', label: 'Coinbase', csv: 'partial', api: 'partial', note: 'CSV « Transaction history » ou clé API CDP « View » uniquement.' },
  { provider: 'binance', label: 'Binance', csv: 'planned', api: 'partial', note: 'API lecture seule : dépôts, retraits, trades spot. Convert/Earn à venir.' },
  { provider: 'bitcoin', label: 'Bitcoin (adresses)', csv: 'unavailable', api: 'partial', note: 'Adresses publiques via mempool.space. xpub à venir.' },
  { provider: 'ethereum', label: 'Ethereum (adresses)', csv: 'unavailable', api: 'partial', note: 'ETH + jetons ERC-20 via Etherscan. Autres réseaux EVM à venir.' },
  { provider: 'bitstamp', label: 'Bitstamp', csv: 'planned', api: 'planned', note: 'API officielle disponible ; intégration à venir.' },
  { provider: 'cryptocom', label: 'Crypto.com', csv: 'planned', api: 'unavailable', note: 'L’app grand public n’a pas d’API d’historique : CSV uniquement.' },
  { provider: 'swissborg', label: 'SwissBorg', csv: 'planned', api: 'unavailable', note: 'Pas d’API publique : import du relevé à venir.' },
  { provider: 'bitpanda', label: 'Bitpanda', csv: 'planned', api: 'planned', note: 'Utilisez le modèle CSV en attendant.' },
  { provider: 'ledger', label: 'Ledger', csv: 'planned', api: 'unavailable', note: 'Ajoutez vos adresses publiques comme source Bitcoin ou Ethereum. Jamais la phrase de récupération.' },
  { provider: 'trezor', label: 'Trezor', csv: 'planned', api: 'unavailable', note: 'Ajoutez vos adresses publiques comme source Bitcoin ou Ethereum. Jamais la phrase de récupération.' },
  { provider: 'metamask', label: 'MetaMask / EVM', csv: 'planned', api: 'unavailable', note: 'Ajoutez votre adresse 0x… comme source Ethereum.' },
];

export type { Importer };
