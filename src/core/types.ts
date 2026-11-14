/**
 * Core domain types. Everything in src/core is pure: no database, no network.
 * Quantities and CHF amounts are decimal strings at the boundaries and
 * decimal.js values inside calculations. Never use JS numbers for money.
 */

export const CLASSIFICATIONS = [
  'buy',
  'sell',
  'swap',
  'fiat_deposit',
  'fiat_withdrawal',
  'deposit',
  'withdrawal',
  'internal_transfer',
  'trading_fee',
  'network_fee',
  'staking_reward',
  'mining_reward',
  'airdrop',
  'lending_interest',
  'donation_received',
  'endowment_received',
  'grant_paid',
  'opening_balance',
  'defi',
  'liquidity_pool',
  'nft_purchase',
  'nft_sale',
  'unknown',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** Classifications the Phase 1 accounting engine can book automatically. */
export const BOOKABLE_CLASSIFICATIONS: ReadonlySet<Classification> = new Set<Classification>([
  'buy',
  'sell',
  'swap',
  'fiat_deposit',
  'fiat_withdrawal',
  'deposit',
  'withdrawal',
  'internal_transfer',
  'trading_fee',
  'network_fee',
  'staking_reward',
  'mining_reward',
  'airdrop',
  'lending_interest',
  'donation_received',
  'endowment_received',
  'grant_paid',
  'opening_balance',
  // DeFi operations confirmed by a person: exchange at market value (see src/core/defi.ts).
  'defi',
  'liquidity_pool',
]);

/** Gifts received and given (donations, foundation endowments, grants paid for the purpose). */
export const DONATION_CLASSIFICATIONS: ReadonlySet<Classification> = new Set<Classification>([
  'donation_received',
  'endowment_received',
  'grant_paid',
]);

export const INCOME_CLASSIFICATIONS: ReadonlySet<Classification> = new Set<Classification>([
  'staking_reward',
  'mining_reward',
  'airdrop',
  'lending_interest',
]);

export type Direction = 'in' | 'out' | 'fee';

export interface Movement {
  direction: Direction;
  /** Normalised asset symbol, e.g. BTC, ETH, CHF. */
  asset: string;
  /** Always positive decimal string. Direction carries the sign. */
  quantity: string;
  /** Set when the movement was derived by CryptoBook (e.g. implicit transfer fee), not read from the source. */
  derived?: boolean;
}

/** A transaction as produced by an importer, before persistence. */
export interface ParsedTransaction {
  externalId: string | null;
  occurredAt: Date;
  /** The source's own type label, kept verbatim for traceability and user rules. */
  rawType: string;
  movements: Movement[];
  /** Original row(s) exactly as read from the file. */
  raw: Record<string, string>[];
  rowNumbers: number[];
  txHash?: string | null;
  note?: string | null;
  /** Classification suggested by the parser from the source's own type label. */
  /** `decisive`: the source knows better than the shape of the movements (e.g. a documented DeFi contract), even when its confidence is low. */
  hint?: { classification: Classification; confidence: number; reason: string; decisive?: boolean } | null;
  /** CHF value stated in the source file itself for the principal crypto leg (evidence from source). */
  sourceChfValue?: string | null;
}

export interface ParseIssue {
  rowNumber: number;
  message: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  issues: ParseIssue[];
}

export type SupportLevel = 'supported' | 'partial' | 'planned' | 'unavailable';
