import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const orgId = () => uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });
/** Crypto quantities: up to 38 digits, 18 decimals (covers 18-decimal ERC-20 tokens). */
const qty = (name: string) => numeric(name, { precision: 38, scale: 18 });
/** CHF amounts and rates at full precision; rounding to cents happens only in journal lines. */
const amt = (name: string) => numeric(name, { precision: 38, scale: 18 });

export const orgKind = pgEnum('org_kind', ['company', 'sole_trader', 'private', 'foundation']);
export const role = pgEnum('member_role', ['owner', 'accountant', 'fiduciary', 'viewer']);
export const direction = pgEnum('movement_direction', ['in', 'out', 'fee']);
export const reviewStatus = pgEnum('review_status', ['ok', 'needs_review']);
export const entryStatus = pgEnum('entry_status', ['draft', 'validated', 'synced', 'sync_failed', 'superseded']);
export const syncOutcome = pgEnum('sync_outcome', ['success', 'failed', 'unknown']);
export const runStatus = pgEnum('run_status', ['complete', 'blocked']);

// ---------- Identity & tenancy ----------

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  locale: text('locale').notNull().default('fr'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)]);

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  activeOrgId: uuid('active_org_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash)]);

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  kind: orgKind('kind').notNull(),
  /** sa | sarl for kind "company" (null for files created before the choice existed). See src/core/legalForms.ts. */
  legalForm: text('legal_form'),
  /** Direct tax status of a legal entity: ordinary | exempt | partial (LIFD art. 56 let. g). */
  taxStatus: text('tax_status').notNull().default('ordinary'),
  canton: text('canton'),
  baseCurrency: text('base_currency').notNull().default('CHF'),
  createdAt: createdAt(),
});

export const memberships = pgTable('memberships', {
  id: id(),
  orgId: orgId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: role('role').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('memberships_uq').on(t.orgId, t.userId)]);

export const accountingPolicies = pgTable('accounting_policies', {
  id: id(),
  orgId: orgId(),
  costBasisMethod: text('cost_basis_method').notNull().default('fifo'),
  tradingFeeTreatment: text('trading_fee_treatment').notNull().default('capitalize'),
  transferWindowHours: integer('transfer_window_hours').notNull().default(48),
  transferTolerance: numeric('transfer_tolerance', { precision: 10, scale: 6 }).notNull().default('0.01'),
  reviewedByFiduciaryAt: timestamp('reviewed_by_fiduciary_at', { withTimezone: true }),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('policies_org_uq').on(t.orgId)]);

// ---------- Sources & imports ----------

export const sources = pgTable('sources', {
  id: id(),
  orgId: orgId(),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  kind: text('kind').notNull(), // exchange | wallet
  connectionType: text('connection_type').notNull().default('csv'), // csv | api | address
  /** AES-256-GCM encrypted JSON; read-only API keys only. Never private keys or seed phrases. */
  encryptedCredentials: text('encrypted_credentials'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  /** Connector progress between runs (raw records of an unfinished pass, cursors). Never credentials. */
  syncState: jsonb('sync_state').$type<Record<string, unknown>>(),
  /** Outcome of the last sync run, shown to the user. */
  syncNote: text('sync_note'),
  createdAt: createdAt(),
});

export const importBatches = pgTable('import_batches', {
  id: id(),
  orgId: orgId(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  parserId: text('parser_id').notNull(),
  parserVersion: integer('parser_version').notNull(),
  fileName: text('file_name').notNull(),
  fileSha256: text('file_sha256').notNull(),
  /** Original file kept as evidence (retention: CO art. 958f). */
  fileContent: text('file_content').notNull(),
  rowCount: integer('row_count').notNull(),
  importedCount: integer('imported_count').notNull(),
  duplicateCount: integer('duplicate_count').notNull(),
  issues: jsonb('issues').notNull().default([]),
  createdBy: uuid('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('batches_file_uq').on(t.sourceId, t.fileSha256)]);

export const transactions = pgTable('transactions', {
  id: id(),
  orgId: orgId(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  txHash: text('tx_hash'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  rawType: text('raw_type').notNull(),
  raw: jsonb('raw').notNull(),
  rowNumbers: jsonb('row_numbers').notNull(),
  note: text('note'),
  fingerprint: text('fingerprint').notNull(),
  hint: jsonb('hint'),
  sourceChfValue: amt('source_chf_value'),
  // classification
  classification: text('classification').notNull().default('unknown'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
  classificationOrigin: text('classification_origin').notNull().default('structure'),
  classificationReasons: jsonb('classification_reasons').notNull().default([]),
  manualClassification: text('manual_classification'),
  reviewStatus: reviewStatus('review_status').notNull().default('needs_review'),
  transferGroupId: text('transfer_group_id'),
  // valuation
  rateMissing: jsonb('rate_missing').notNull().default([]),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('transactions_fp_uq').on(t.orgId, t.fingerprint),
  index('transactions_org_time_idx').on(t.orgId, t.occurredAt),
]);

export const movements = pgTable('movements', {
  id: id(),
  orgId: orgId(),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  direction: direction('direction').notNull(),
  asset: text('asset').notNull(),
  quantity: qty('quantity').notNull(),
  derived: boolean('derived').notNull().default(false),
  chfRate: amt('chf_rate'),
  chfValue: amt('chf_value'),
  rateSource: text('rate_source'),
  rateRef: text('rate_ref'),
}, (t) => [index('movements_tx_idx').on(t.transactionId)]);

export const classificationRules = pgTable('classification_rules', {
  id: id(),
  orgId: orgId(),
  provider: text('provider').notNull(),
  rawType: text('raw_type').notNull(),
  asset: text('asset'),
  classification: text('classification').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: createdAt(),
});

export const priceRates = pgTable('price_rates', {
  id: id(),
  orgId: orgId(),
  asset: text('asset').notNull(),
  rateDate: text('rate_date').notNull(), // YYYY-MM-DD, Europe/Zurich
  rate: amt('rate').notNull(), // CHF per unit
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('price_rates_uq').on(t.orgId, t.asset, t.rateDate)]);

/**
 * Official tax values per asset and tax year (e.g. ESTV/AFC Kursliste ICTax, value at 31.12), entered or imported by
 * the user. Kept apart from accounting price rates so that tax values never change bookings.
 */
export const taxValues = pgTable('tax_values', {
  id: id(),
  orgId: orgId(),
  asset: text('asset').notNull(),
  taxYear: integer('tax_year').notNull(),
  valueChf: amt('value_chf').notNull(), // CHF per unit
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('tax_values_uq').on(t.orgId, t.asset, t.taxYear)]);

// ---------- Calculation & journal ----------

export const calculationRuns = pgTable('calculation_runs', {
  id: id(),
  orgId: orgId(),
  status: runStatus('status').notNull(),
  policySnapshot: jsonb('policy_snapshot').notNull(),
  inputHash: text('input_hash').notNull(),
  issues: jsonb('issues').notNull().default([]),
  transactionCount: integer('transaction_count').notNull(),
  /** Per account key: exact full-precision total, total booked in cents, and the rounding residue carried forward. */
  roundingLedger: jsonb('rounding_ledger'),
  createdBy: uuid('created_by').notNull(),
  createdAt: createdAt(),
});

export const lots = pgTable('lots', {
  id: id(),
  orgId: orgId(),
  runId: uuid('run_id').notNull().references(() => calculationRuns.id, { onDelete: 'cascade' }),
  lotKey: text('lot_key').notNull(),
  transactionId: uuid('transaction_id').notNull(),
  asset: text('asset').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
  quantity: qty('quantity').notNull(),
  costChf: amt('cost_chf').notNull(),
}, (t) => [index('lots_run_idx').on(t.runId)]);

export const disposals = pgTable('disposals', {
  id: id(),
  orgId: orgId(),
  runId: uuid('run_id').notNull().references(() => calculationRuns.id, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').notNull(),
  asset: text('asset').notNull(),
  kind: text('kind').notNull(),
  quantity: qty('quantity').notNull(),
  proceedsChf: amt('proceeds_chf').notNull(),
  costChf: amt('cost_chf').notNull(),
  gainChf: amt('gain_chf').notNull(),
  allocations: jsonb('allocations').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
}, (t) => [index('disposals_run_idx').on(t.runId)]);

export const journalEntries = pgTable('journal_entries', {
  id: id(),
  orgId: orgId(),
  runId: uuid('run_id').notNull().references(() => calculationRuns.id),
  /** Null for year-end entries, which belong to a closing rather than to one transaction. */
  transactionId: uuid('transaction_id').references(() => transactions.id),
  /** transaction | year_end_valuation | year_end_reversal */
  kind: text('kind').notNull().default('transaction'),
  /** Closed year a year-end entry belongs to. */
  closingYear: integer('closing_year'),
  /** Hash of the lines; a later run producing the same content reuses the existing entry. */
  contentHash: text('content_hash').notNull(),
  entryDate: text('entry_date').notNull(), // YYYY-MM-DD, Europe/Zurich
  referenceNr: text('reference_nr').notNull(),
  description: text('description').notNull(),
  status: entryStatus('status').notNull().default('draft'),
  validatedBy: uuid('validated_by'),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  bexioManualEntryId: integer('bexio_manual_entry_id'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  lastSyncError: text('last_sync_error'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('journal_ref_uq').on(t.orgId, t.referenceNr),
  index('journal_tx_idx').on(t.transactionId),
]);

/**
 * Year-end closing of a calendar year: the 31.12 valuation of crypto assets (CO art. 960 / 960b) and the lock of the
 * period. A closed year cannot receive new transactions, reclassifications, revaluations or entry changes.
 */
export const fiscalClosings = pgTable('fiscal_closings', {
  id: id(),
  orgId: orgId(),
  year: integer('year').notNull(),
  /** closed | reopened */
  status: text('status').notNull(),
  valuationMethod: text('valuation_method').notNull(),
  rateBasis: text('rate_basis').notNull(),
  /** Valuation table at 31.12 (per account: quantity, book value, rate and source, market value, adjustment). */
  snapshot: jsonb('snapshot').notNull(),
  valuationEntryId: uuid('valuation_entry_id'),
  reversalEntryId: uuid('reversal_entry_id'),
  closedBy: uuid('closed_by').notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
  reopenedBy: uuid('reopened_by'),
  reopenedAt: timestamp('reopened_at', { withTimezone: true }),
}, (t) => [uniqueIndex('fiscal_closings_uq').on(t.orgId, t.year)]);

export const journalLines = pgTable('journal_lines', {
  id: id(),
  orgId: orgId(),
  entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  debitKey: text('debit_key').notNull(),
  creditKey: text('credit_key').notNull(),
  amountChf: numeric('amount_chf', { precision: 18, scale: 2 }).notNull(),
  description: text('description').notNull(),
  bexioEntryLineId: integer('bexio_entry_line_id'),
});

// ---------- bexio ----------

export const accountMappings = pgTable('account_mappings', {
  id: id(),
  orgId: orgId(),
  key: text('key').notNull(),
  bexioAccountId: integer('bexio_account_id').notNull(),
  bexioAccountNo: text('bexio_account_no').notNull(),
  bexioAccountName: text('bexio_account_name').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('mappings_uq').on(t.orgId, t.key)]);

export const bexioConnections = pgTable('bexio_connections', {
  id: id(),
  orgId: orgId(),
  /** AES-256-GCM encrypted {access_token, refresh_token, expires_at}. */
  encryptedTokens: text('encrypted_tokens').notNull(),
  scopes: text('scopes').notNull(),
  companyName: text('company_name'),
  chfCurrencyId: integer('chf_currency_id'),
  connectedBy: uuid('connected_by').notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
}, (t) => [uniqueIndex('bexio_conn_org_uq').on(t.orgId)]);

export const bexioAccounts = pgTable('bexio_accounts', {
  id: id(),
  orgId: orgId(),
  bexioId: integer('bexio_id').notNull(),
  uuid: text('uuid'),
  accountNo: text('account_no').notNull(),
  name: text('name').notNull(),
  accountType: integer('account_type'),
  isActive: boolean('is_active').notNull(),
  isLocked: boolean('is_locked').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('bexio_accounts_uq').on(t.orgId, t.bexioId)]);

export const bexioBusinessYears = pgTable('bexio_business_years', {
  id: id(),
  orgId: orgId(),
  bexioId: integer('bexio_id').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  status: text('status').notNull(),
}, (t) => [uniqueIndex('bexio_by_uq').on(t.orgId, t.bexioId)]);

export const syncAttempts = pgTable('sync_attempts', {
  id: id(),
  orgId: orgId(),
  entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  request: jsonb('request').notNull(),
  httpStatus: integer('http_status'),
  response: jsonb('response'),
  outcome: syncOutcome('outcome').notNull(),
  errorMessage: text('error_message'),
  createdBy: uuid('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('sync_attempts_entry_idx').on(t.entryId)]);

export const oauthStates = pgTable('oauth_states', {
  id: id(),
  state: text('state').notNull(),
  nonce: text('nonce').notNull(),
  orgId: orgId(),
  userId: uuid('user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('oauth_state_uq').on(t.state)]);

// ---------- Audit & billing ----------

export const auditLog = pgTable('audit_log', {
  id: id(),
  orgId: uuid('org_id'),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: createdAt(),
}, (t) => [index('audit_org_idx').on(t.orgId, t.createdAt)]);

/** Plans are data, so prices and limits can change without code changes. */
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priceChfMonthly: numeric('price_chf_monthly', { precision: 10, scale: 2 }),
  limits: jsonb('limits').notNull(),
  active: boolean('active').notNull().default(true),
});

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  orgId: orgId(),
  planId: text('plan_id').notNull().references(() => plans.id),
  status: text('status').notNull(), // trialing | active | canceled
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('subscriptions_org_uq').on(t.orgId)]);
