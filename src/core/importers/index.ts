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
  { provider: 'generic', label: 'Crypto2Books CSV template', csv: 'supported', api: 'unavailable', note: 'Any source, using our documented template.' },
  { provider: 'kraken', label: 'Kraken', csv: 'partial', api: 'planned', note: 'Ledger CSV import available; read-only API planned for Phase 2.' },
  { provider: 'coinbase', label: 'Coinbase', csv: 'partial', api: 'planned', note: 'Transaction history CSV import available; API planned for Phase 2.' },
  { provider: 'binance', label: 'Binance', csv: 'planned', api: 'planned', note: 'Use the generic template for now.' },
  { provider: 'cryptocom', label: 'Crypto.com', csv: 'planned', api: 'unavailable', note: 'The retail App has no public history API; CSV only.' },
  { provider: 'swissborg', label: 'SwissBorg', csv: 'planned', api: 'unavailable', note: 'No public retail API known; statement import planned.' },
  { provider: 'bitpanda', label: 'Bitpanda', csv: 'planned', api: 'planned', note: 'Use the generic template for now.' },
  { provider: 'ledger', label: 'Ledger', csv: 'planned', api: 'planned', note: 'Public address / xpub import planned. Never enter your recovery phrase.' },
  { provider: 'trezor', label: 'Trezor', csv: 'planned', api: 'planned', note: 'Public address / xpub import planned. Never enter your recovery phrase.' },
  { provider: 'metamask', label: 'MetaMask / EVM', csv: 'planned', api: 'planned', note: 'Public address import via a blockchain indexer planned for Phase 2.' },
];

export type { Importer };
