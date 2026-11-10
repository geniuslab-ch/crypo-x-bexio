import type { ParsedTransaction, ParseIssue, SupportLevel } from '@/core/types';

/**
 * Read-only data connectors for exchanges (API keys) and blockchains (public addresses).
 *
 * Rules (see docs/FEASIBILITY.md):
 * - Only read-only credentials. Where the platform exposes the key's permissions, `verify` refuses
 *   keys that can trade, transfer or withdraw. Never private keys or seed phrases.
 * - Nothing is invented: every field mapped below comes from the platform's published API reference,
 *   and anything we cannot interpret is reported as an issue or left for review.
 * - Long histories are fetched over several runs (serverless time limits). Raw records accumulate in
 *   `state` and transactions are only produced once a pass is complete, so a trade is never split
 *   across two runs.
 */

export interface CredentialField {
  name: string;
  label: string;
  secret: boolean;
  multiline?: boolean;
  placeholder?: string;
  optional?: boolean;
}

export type SyncState = Record<string, unknown>;

export interface FetchContext {
  fetch: typeof fetch;
  /** Epoch ms after which the connector must stop requesting and return its progress. */
  deadline: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  env: Record<string, string | undefined>;
}

export interface SyncResult {
  /** Only filled when `complete` is true. */
  transactions: ParsedTransaction[];
  issues: ParseIssue[];
  /** Raw API records of the completed pass, stored as audit evidence. */
  evidence: unknown;
  state: SyncState;
  /** False when the time budget ran out: run the sync again to continue where it stopped. */
  complete: boolean;
  /** Short progress note for the user (French). */
  progress?: string;
}

export interface SourceConnector {
  /** Stored as the import batch's parser id. */
  id: string;
  version: number;
  provider: string;
  label: string;
  kind: 'exchange' | 'wallet';
  support: SupportLevel;
  fields: CredentialField[];
  /** How to create a read-only key / which address to enter (French, shown in the UI). */
  help: string;
  /** What this connector does not cover yet (French, shown in the UI). */
  limits: string;
  /** Checks the credentials work and, where possible, that they are read-only. Throws ConnectorError otherwise. */
  verify(creds: Record<string, string>, fx: FetchContext): Promise<{ readOnly: 'verified' | 'not_checkable' }>;
  sync(creds: Record<string, string>, state: SyncState, fx: FetchContext): Promise<SyncResult>;
}

/** Error with a stable code shown to the user (translated in the UI). */
export class ConnectorError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
