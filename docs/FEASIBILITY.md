# Crypto2Books (brief: "CryptoBook") — Feasibility analysis and technical plan

Status: first version, 10 November 2026. Written before implementation, then kept in sync with the Phase 1 code in this repository.

This document answers items A to I of the product brief. Every external capability claimed below is tagged with how it was checked:

- **[verified]** read in the official documentation (source and date given).
- **[verified-mirror]** read in a third-party mirror of the official documentation because the official page is rendered client-side and could not be read in full by our tooling. The endpoint names were confirmed on docs.bexio.com itself; the request/response details come from the mirror. These must be re-confirmed against a real bexio trial company before production (this is the first task of the "bexio contract test" in section I).
- **[to verify]** our current understanding, not yet checked against primary documentation. Nothing tagged this way is implemented as a working integration; it is only planned.

Crypto2Books is a bookkeeping support tool. It is not a tax authority, does not issue tax rulings and does not replace a fiduciary or tax advisor.

---

## A. Overall feasibility

**Verdict: feasible, with one hard dependency (CHF pricing data) and one structural limitation (exchange/wallet data quality).**

| Capability | Feasible? | Comment |
|---|---|---|
| Posting double-entry bookings into bexio | Yes | bexio exposes `POST /3.0/accounting/manual_entries` (single, compound, group entries) under the `accounting` scope. See B. |
| Reading the chart of accounts from bexio | Yes | `GET /2.0/accounts`, `GET /2.0/account_groups`. Accounts are read-only through the API (no create endpoint). |
| Idempotent sync to bexio | Yes, but we must build it ourselves | bexio documents no idempotency key. We use a deterministic `reference_nr` and look entries up before retrying. |
| Importing exchange history | Yes for CSV; API coverage varies by exchange | CSV exports exist for all priority exchanges, but formats change without notice. APIs differ widely in history depth and pagination. See C. |
| Importing self-custody wallets | Yes via public addresses | Requires an indexing provider (Etherscan-family, Bitcoin Esplora/mempool-style APIs). DeFi interpretation is the hard part. |
| CHF valuation at transaction time | Yes, with a licensed/attributed price source | No free, official, intraday CHF crypto price exists. ESTV publishes year-end tax values only. This is the main data dependency. |
| FIFO / weighted average cost | Yes | Pure computation; implemented and unit-tested in Phase 1. |
| Swiss accounting and tax treatment | Partly automatable | Mechanics are automatable; policy choices (private vs business, professional trader, valuation method, fee treatment, VAT) must be configured and validated by a fiduciary. See D. |
| Multi-tenant fiduciary mode | Yes | Organization/membership model from day 1, UI in Phase 3. |

Fastest genuinely functional path (F): CSV import → normalization → rule-based classification → CHF valuation from documented sources → FIFO → journal entries → manual review → posting to bexio manual entries → CSV/Excel reports. That is the Phase 1 scope implemented in this repository.

---

## B. bexio API — what is actually supported

Sources: https://docs.bexio.com/ (read 10.11.2026; endpoint index, authentication, scopes, rate limits). Request/response bodies from the mirror of the same documentation in `gigerIT/bexio-api-client` (`docs/bexio-api-docs.md`, sync check 02.10.2026). bexio states in its FAQ that it does not currently publish an OpenAPI definition.

### Authentication [verified]

- OpenID Connect / OAuth 2.0 Authorization Code flow on `auth.bexio.com` (the legacy `idp.bexio.com` was decommissioned 31.03.2025).
  - Authorization: `https://auth.bexio.com/realms/bexio/protocol/openid-connect/auth`
  - Token: `https://auth.bexio.com/realms/bexio/protocol/openid-connect/token`
  - Discovery: `https://auth.bexio.com/realms/bexio/.well-known/openid-configuration`
- Apps are registered in the bexio developer portal; redirect URLs must be pre-registered (up to 10). Separate client ID/secret for production is recommended by bexio.
- Refresh tokens (scope `offline_access`) are valid indefinitely, but the offline session closes if not refreshed within 1 year. Token endpoint parameters must be sent in the body.
- Personal Access Tokens exist (60-day validity) — useful for our own contract tests, not for customers.
- There is no documented sandbox. bexio's own "first steps" uses a trial account; we will use a trial company for contract tests.

### Scopes [verified]

| Scope | Meaning (bexio wording) | Used by Crypto2Books |
|---|---|---|
| `accounting` | "Write access to accounting data" | Yes — accounts, currencies, business years, manual entries, journal |
| `file` | "Read and write access to the inbox (file upload)" | Phase 2 — attach evidence to entries |
| `openid profile email offline_access company_profile` | OIDC scopes | `openid offline_access company_profile` |

Important limitation: **there is no read-only accounting scope.** Reading the chart of accounts requires the same `accounting` scope that allows writing. We must therefore explain clearly in the consent UX that Crypto2Books will only create entries the user has validated.

### Accounting endpoints

| Operation | Endpoint | Status |
|---|---|---|
| List accounts | `GET /2.0/accounts` (limit ≤ 2000, offset) — fields `id`, `uuid`, `account_no`, `name`, `account_type`, `tax_id`, `fibu_account_group_id`, `is_active`, `is_locked` | [verified-mirror] |
| Search accounts | `POST /2.0/accounts/search` (fields `account_no`, `fibu_account_group_id`, `name`, `account_type`) | [verified-mirror] |
| Create/update accounts | **Not available.** Users must create crypto accounts in bexio themselves. | [verified] (no such operation in the index) |
| List account groups | `GET /2.0/account_groups` | [verified-mirror] |
| Business years | `GET /3.0/accounting/business_years`, `GET /3.0/accounting/business_years/{id}` (`start`, `end`, `status`, `closed_at`) | [verified-mirror] |
| Currencies | `GET /3.0/currencies` (`id`, `name`, `exchange_rate`, `source`...), `GET /3.0/currencies/{id}/exchange_rates`, `GET /3.0/currencies/codes`; create/update/delete also exist | [verified-mirror] |
| Taxes (VAT codes) | `GET /3.0/taxes` (filters `scope`, `date`, `types`) | [verified-mirror] |
| VAT periods | `GET /3.0/accounting/vat_periods` | [verified] (index) |
| **Create booking** | `POST /3.0/accounting/manual_entries` — body: `type` (`manual_single_entry` \| `manual_compound_entry` \| `manual_group_entry`), `date` (required), `reference_nr` (≤ 80 chars), `entries[]` with `debit_account_id`, `credit_account_id`, `tax_id`, `tax_account_id`, `description`, `amount`, `currency_id`, `currency_factor`. 201 on success, 422 on validation error. Response includes `id`, per-line `id`, `is_locked`, `locked_info` (e.g. `closed_business_year`). | [verified-mirror] |
| Update / delete booking | `PUT /3.0/accounting/manual_entries/{id}`, `DELETE /3.0/accounting/manual_entries/{id}` (delete is permanent and unlinks files) | [verified-mirror] |
| List bookings | `GET /3.0/accounting/manual_entries` (limit ≤ 2000, offset). There is **no single-entry GET** endpoint. | [verified-mirror] |
| Next reference number | `GET /3.0/accounting/manual_entries/next_ref_nr` | [verified-mirror] |
| Attach file to booking line | `POST /3.0/accounting/manual_entries/{id}/entries/{entry_id}/files` (single & group entries), compound-entry variant without `entry_id` | [verified-mirror]; changelog 15.07.2024 [verified] |
| Journal report | `GET /3.0/accounting/journal` (filters `from`, `to`, `account_uuid`; rows carry `debit_account_id`, `credit_account_id`, `amount`, `currency_id`, `base_currency_amount`, `ref_class`) | [verified-mirror] |

### Rate limits [verified]

Limit is per company per minute, HTTP 429 when exceeded, with `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers. The numeric limit is not published, so the client reads headers at runtime and backs off.

### Consequences for the design

1. **Direct journal-entry creation is supported**, so the "export file instead of API" fallback is not needed for the core flow. We still provide a journal CSV/Excel export for fiduciaries and as a manual fallback. (Whether bexio's UI can import such a file is [to verify]; we do not claim it.)
2. **All Crypto2Books postings are made in CHF** (`currency_id` = the company's CHF currency id from `/3.0/currencies`, `currency_factor` = 1). Original crypto amounts and the CHF rate used go into the line `description` and remain in Crypto2Books as evidence. This avoids creating crypto "currencies" in bexio and keeps bexio's ledger in the functional currency.
3. **Every economic event is expressed as balanced debit/credit line pairs**, which maps 1:1 to `manual_single_entry` (one line) or `manual_group_entry` (several lines sharing a `reference_nr`). We do not need compound entries.
4. **Idempotency is ours to guarantee.** Each Crypto2Books journal entry has a deterministic `reference_nr` (`C2B-<20 hex chars of the entry id>`). Before re-posting after an unknown outcome (timeout, 5xx), the sync job pages through `GET /3.0/accounting/manual_entries` looking for that reference. "Synced" is only set after a 201 response (or a confirmed match) and the returned bexio ids are stored.
5. **Closed business years**: a booking dated in a closed year is rejected or locked; we fetch business years first and block posting into closed years with a clear message.
6. **Account mapping must point to existing bexio accounts**; the UI loads `/2.0/accounts` and lets the user choose. If a mapped account is deactivated (`is_active=false`), posting is blocked.

---

## C. Exchange APIs and blockchain data — limits

General rules applied regardless of source: read-only keys only; we refuse to store keys that the exchange reports as having withdrawal or trading rights where the exchange lets us check this; we never request seed phrases or private keys; we never show a connection as working until a real authenticated call has succeeded.

| Source | CSV/Excel export | API | Main limitations | Phase |
|---|---|---|---|---|
| Kraken | Ledger CSV export | REST private endpoints with granular key permissions (query ledger / query funds can be granted without withdraw) [to verify] | Ledger API is paginated in small pages [to verify]; asset codes use legacy names (`XXBT`, `ZCHF`, `XETH`) that must be normalised. | CSV: Phase 1 (**partial**, see note). API: Phase 2 |
| Coinbase | Transaction history CSV (format has changed several times) | Coinbase App API / Advanced Trade API with view-only keys [to verify] | Several overlapping products (App, Advanced, Prime); CSV columns vary by account and date. | CSV: Phase 1 (**partial**). API: Phase 2 |
| Binance | Transaction history / trade history exports | REST API with "reading" permission [to verify] | Trade history per symbol (must enumerate pairs); deposit/withdraw history in bounded time windows [to verify]; availability for Swiss residents depends on Binance's own regulatory situation. | Phase 2 |
| Crypto.com | App: CSV export | Public API exists for the Exchange product, not for the retail App history [to verify] | Most retail users use the App, so CSV will remain the main path. | Phase 2 (CSV) |
| SwissBorg | Account statement export [to verify] | No public retail API known [to verify] | Import only. | Phase 2 |
| Bitpanda | CSV export | API key with read scopes [to verify] | — | Phase 2 |
| Ledger / Trezor | Ledger Live and Trezor Suite operation CSV exports [to verify] | Not applicable — hardware wallets hold keys, data lives on-chain | Better route: user provides public addresses or extended public key (xpub). An xpub reveals all addresses of the account and must be stored encrypted. | Phase 2 |
| MetaMask / EVM | — | Public address + indexer (Etherscan-family API, which now offers one key across many chains [to verify]; alternatives Alchemy, Covalent) | Internal transactions and token transfers come from separate endpoints; DeFi/LP/NFT semantics need protocol-specific decoding; free tiers are rate-limited. | Phase 2 (transfers), Phase 4 (DeFi/NFT) |
| Bitcoin addresses | — | Esplora-compatible APIs (e.g. self-hosted or mempool-style) [to verify] | UTXO model: change outputs must be recognised as own funds; needs xpub derivation for HD wallets. | Phase 2 |

**Note on "partial" CSV support in Phase 1.** We do not have authentic export files from every exchange in this repository. The Kraken and Coinbase parsers are written against column layouts we know from these exchanges' exports and are labelled **partial** in the UI. They refuse files whose headers do not match instead of guessing, and every imported row keeps the original raw row as evidence. Each parser must be validated with real customer exports before being labelled **supported**. The **Crypto2Books generic CSV template** is fully supported because we define the format.

**CHF pricing data** (critical dependency):

| Source | What it provides | Use |
|---|---|---|
| Transaction itself | If a trade's counter-asset is CHF, the CHF value is exact | Priority 1 (implemented) |
| User/fiduciary-imported rate table | Daily or exact rates with a declared source and URL | Priority 2 (implemented) |
| CoinGecko API (`/coins/{id}/history`) | Daily historical prices incl. CHF; requires API key; licensing terms apply for commercial use [to verify] | Priority 3 (implemented behind a key; disabled without one) |
| ESTV Kursliste (ICTax) | Official year-end tax values for common cryptocurrencies (https://www.ictax.admin.ch/) | Year-end valuation reference for tax-supporting reports (Phase 2 import) |
| Swiss National Bank | Official fiat exchange rates (USD/EUR→CHF) [to verify exact dataset] | Fiat legs in EUR/USD (Phase 2) |

If no documented rate exists for a transaction, Crypto2Books marks it **"rate missing"** and blocks entry generation for it. It never uses a guessed or zero value.

---

## D. Swiss accounting and tax items that need professional validation

Crypto2Books makes these items **configurable per organisation**, records which configuration was used for every calculation run, and shows a "to be validated by your fiduciary" badge until a fiduciary marks the policy as reviewed.

Official references used (to be kept current):

- ESTV, *Arbeitspapier – Kryptowährungen und Initial Coin/Token Offerings (ICO/ITO) als Gegenstand der Vermögens-, Einkommens- und Gewinnsteuer, der Verrechnungssteuer und der Stempelabgaben*, version of 03.08.2022 (replaces 27.08.2019). Page: https://www.estv.admin.ch/de/kryptowaehrungen-besteuerung (page date stamp 05.11.2026). PDF: https://www.estv.admin.ch/dam/de/sd-web/HgzNhzz7q7YD/dbst-arbeitspapier-kryptowaehrungen-de.pdf
- ESTV Kursliste / ICTax: https://www.ictax.admin.ch/
- ESTV, Kreisschreiben Nr. 36 (gewerbsmässiger Wertschriftenhandel), 27.07.2012 — criteria applied by analogy to crypto, per the ESTV page above.
- Swiss Code of Obligations (CO / OR), Art. 957–960e (bookkeeping and financial reporting), especially Art. 960a (acquisition cost) and Art. 960b (assets with observable market prices): https://www.fedlex.admin.ch/eli/cc/27/317_321_377/fr
- VAT: ESTV MWST-Info / MWST-Branchen-Info on payment tokens [to verify exact publication and date before citing in the UI].

| # | Topic | Why it needs validation | Default in Phase 1 |
|---|---|---|---|
| D1 | **Private vs business assets** | For private individuals, gains on payment tokens held as private assets are generally tax-free capital gains and losses not deductible (ESTV page above); for businesses, gains/losses are part of taxable profit. | Organisation type is chosen at onboarding; reports label figures as "accounting" vs "tax-supporting". |
| D2 | **Professional securities trader status** (KS 36 by analogy) | Changes private gains into taxable income. Fact-based decision. | Not decided by the software. A checklist report will be provided (Phase 4). |
| D3 | **Cost basis method** (FIFO, weighted average) | Not every method is accepted in every context; consistency between years is required. | FIFO default; weighted average available; method is locked per organisation and per year once entries are validated. |
| D4 | **Fees** (capitalise into cost / deduct from proceeds vs expense) | Affects realised result and asset values (CO Art. 960a acquisition cost). | Configurable; default: trading fees capitalised into cost / deducted from proceeds; network fees on internal transfers expensed. |
| D5 | **Year-end valuation** | CO Art. 960b allows observable market prices for listed assets, with options for value adjustment reserves; lower-of-cost-or-market otherwise. Tax values use the ESTV Kursliste. | Unrealised gains reported, **no automatic revaluation entry** in Phase 1. |
| D6 | **Staking, mining, airdrops, lending** | Income character (movable assets vs self-employment) depends on facts per ESTV; accounting recognition timing and valuation also need policy. | Recognised as income at CHF fair value on receipt; account mapping configurable. |
| D7 | **VAT** | Exchange of payment tokens is generally treated like means of payment (exempt), but mining/staking-as-a-service and NFT sales may differ. | No VAT code (`tax_id`) on any Crypto2Books booking unless the user maps one. |
| D8 | **Stablecoins** | Payment token vs asset-backed token classification affects treatment. | Treated as crypto assets with their own lots; flagged in reports. |
| D9 | **Cantonal practice** | Wealth tax valuation and declaration practice differ by canton (e.g. ZG, BL publish their own guidance). | Canton stored on organisation for reports; no cantonal logic in Phase 1. |
| D10 | **Documentation / retention** | CO Art. 958f: 10-year retention of books and supporting documents. | Raw import files and raw rows are retained; deletion of an organisation is blocked while a retention flag is set (Phase 2). |

---

## E. Technical architecture

The repository was empty when this work started, so there was no existing stack to reuse. Choices follow the brief's suggestions and avoid extra infrastructure:

- **Next.js (App Router) + TypeScript** — one deployable for UI, server actions and API routes.
- **PostgreSQL** — single source of truth. **Drizzle ORM** (pure TypeScript, plain SQL migrations committed in `drizzle/`).
- **Background jobs** — Phase 1 runs import/calculation/sync synchronously per request (bounded data sizes). Phase 2 adds **pg-boss** (job queue on the same PostgreSQL, no new infrastructure) for periodic exchange sync and bexio retries.
- **Authentication** — Phase 1: email + password (Argon2id), server-side sessions stored hashed in PostgreSQL, httpOnly/SameSite cookies. The auth module is isolated so it can be swapped for a managed provider; TOTP MFA is Phase 2.
- **Secrets** — bexio tokens and exchange API keys encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` (env/KMS), never logged, never sent to the browser.
- **Money** — all quantities and CHF amounts are `numeric` in PostgreSQL and `decimal.js` in TypeScript. No floating point in accounting paths.

```
            ┌───────────── Next.js app (UI + server actions + API routes) ─────────────┐
 Browser ──►│ auth · tenancy guard (org_id on every query) · i18n (fr / en / de)       │
            └──────┬───────────────┬───────────────┬───────────────┬───────────────────┘
                   │               │               │               │
           src/core/importers  src/core/classify  src/core/accounting   src/integrations/bexio
           (CSV parsers,       (rules, transfer   (CHF valuation, FIFO / (OAuth, API client,
            raw evidence)       matching, user     WAC, journal entry    accounts, idempotent
                   │            rules, scores)     generation)            manual-entry sync)
                   └───────────────┴───────┬───────┴───────────────┘
                                           ▼
                                PostgreSQL (tenant-scoped tables, audit_log)
```

Module boundaries:

- `src/core/*` is pure TypeScript with no database or network access, so the accounting logic is unit-testable and deterministic.
- `src/server/*` contains the database-backed services (import, classification run, calculation run, sync) and enforces tenancy.
- `src/integrations/*` contains external clients (bexio, price providers, later exchanges/indexers). Each implements a small interface; adding an exchange means adding one importer/connector module and registering it.

**Immutability and audit trail**

- Imported rows are append-only; a re-import of the same file is detected by content hash, and duplicate rows by `(source_id, external_id)` or a row fingerprint.
- Every classification change, rate change, calculation run, validation and sync attempt writes an `audit_log` row (actor, before, after, timestamp).
- A **calculation run** is a versioned snapshot (method, policy, input hash). Journal entries belong to a run. Validated or synced entries are never modified by a later run; if a later run produces a different result for an already validated entry, the difference is surfaced as a conflict requiring an explicit reversal entry.

---

## F. Fastest route to a genuinely functional MVP

1. Generic CSV template + Kraken/Coinbase CSV parsers (partial) with raw evidence and dedupe.
2. Normalised transaction model (movements in/out/fee per transaction).
3. Rule-based classification with confidence scores, own-wallet transfer matching, user correction rules.
4. CHF valuation: trade-implied CHF, imported rate table, CoinGecko (with key).
5. FIFO and weighted-average engine with realised gains, fee policy, missing-history detection.
6. Journal entries as balanced debit/credit pairs, account mapping keys, review/validate.
7. bexio OAuth, chart of accounts import, mapping UI, idempotent posting of validated entries, sync log.
8. Reports: transactions, realised gains, holdings/unrealised, journal — CSV and Excel.

Everything that depends on credentials (bexio, CoinGecko) is fully implemented but inactive until the credentials are configured, and the UI says which credentials are missing.

---

## G. Biggest risks

| Risk | Type | Impact | Mitigation |
|---|---|---|---|
| Wrong classification of own-wallet transfers as disposals | Accounting | Overstated gains | Transfer matcher, low-confidence review queue, explicit user confirmation |
| Missing history (sales without known acquisition) | Accounting | Wrong cost basis | Engine stops and flags "insufficient lots" instead of assuming zero cost |
| CHF price source licensing and gaps | Data / legal | Unusable valuations | Source attribution per rate, multiple providers, rate-missing blocks posting |
| Exchange CSV format drift | Data | Silent mis-imports | Strict header detection, raw-row evidence, parser versioning, fixtures from real exports |
| bexio contract details only verified via mirror | Integration | Posting errors | Contract test against trial company before go-live; 422 errors surfaced verbatim |
| No idempotency key in bexio | Integration | Duplicate bookings | Deterministic `reference_nr`, lookup-before-retry, per-entry sync state machine |
| `accounting` scope is write-only (no read-only option) | Trust | Users hesitant to grant | Clear consent explanation, posting only validated entries, full sync log |
| Being perceived as tax advice | Regulatory | Liability | Disclaimers, "accounting vs tax-supporting" labels, fiduciary review flags |
| Data protection (nLPD / GDPR) | Regulatory | Fines, trust | Data minimisation, encryption of secrets, Swiss/EU hosting, deletion workflow, DPA with sub-processors (price/indexer providers receive no personal data) |
| Exchange API keys with excessive permissions | Security | Loss of funds | Read-only guidance, permission check where possible, encrypted storage |
| FINMA licensing | Regulatory | — | Not applicable as long as Crypto2Books never holds, transfers or trades assets (read-only). To be confirmed by counsel. |

---

## H. Database schema

The authoritative schema is `src/server/db/schema.ts` (Drizzle) with SQL migrations in `drizzle/`. Summary:

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Accounts | `email` (unique), `password_hash` (Argon2id), `locale` |
| `sessions` | Server-side sessions | `token_hash`, `user_id`, `expires_at` |
| `organizations` | Tenant = a business, sole trader, private investor or a fiduciary's client | `name`, `kind` (`company` \| `sole_trader` \| `private`), `canton`, `base_currency` (CHF) |
| `memberships` | User ↔ organization with role | `role` (`owner` \| `accountant` \| `fiduciary` \| `viewer`) |
| `accounting_policies` | Configurable rules, versioned | `cost_basis_method`, `trading_fee_treatment`, `transfer_fee_treatment`, `transfer_match_window_hours`, `reviewed_by_fiduciary_at` |
| `sources` | Exchange accounts and wallets | `kind` (`exchange` \| `wallet`), `provider`, `label`, `connection_type` (`csv` \| `api` \| `address`), `encrypted_credentials` |
| `import_batches` | One uploaded file / sync run | `source_id`, `parser_id`, `parser_version`, `file_sha256` (unique per source), `raw_file` reference, `row_count`, `status` |
| `raw_records` | Original rows as evidence (append-only) | `batch_id`, `row_number`, `raw` (jsonb), `fingerprint` |
| `transactions` | Normalised transactions | `source_id`, `external_id`, `occurred_at`, `raw_type`, `fingerprint` (unique per org), `classification`, `confidence`, `classification_origin` (`rule` \| `user` \| `transfer_match` \| `ai`), `review_status`, `transfer_group_id`, `notes` |
| `movements` | Asset legs of a transaction | `transaction_id`, `direction` (`in` \| `out` \| `fee`), `asset`, `quantity` (numeric), `chf_rate`, `chf_value`, `rate_source`, `rate_ref` |
| `classification_rules` | User corrections remembered | `match_provider`, `match_raw_type`, `match_asset`, `classification` |
| `price_rates` | Documented CHF rates | `asset`, `quote` (CHF), `rate_date` / `rate_at`, `rate`, `source`, `source_url` |
| `calculation_runs` | Versioned calculation snapshots | `policy_snapshot` (jsonb), `method`, `input_hash`, `status`, `created_by` |
| `lots` | Acquisition lots (per run) | `run_id`, `asset`, `acquired_at`, `quantity`, `remaining`, `cost_chf`, `origin_movement_id` |
| `disposals` | Realised results (per run) | `run_id`, `movement_id`, `asset`, `quantity`, `proceeds_chf`, `cost_chf`, `gain_chf`, `lot_allocations` (jsonb) |
| `account_mappings` | Crypto2Books account key → bexio account | `key` (e.g. `crypto_asset:BTC`, `realized_gain`), `bexio_account_id`, `bexio_account_no` |
| `journal_entries` | Generated bookings | `run_id`, `transaction_id`, `date`, `reference_nr` (unique), `status` (`draft` \| `validated` \| `synced` \| `sync_failed` \| `superseded`), `validated_by`, `validated_at` |
| `journal_lines` | Debit/credit pairs (CHF) | `entry_id`, `debit_key`, `credit_key`, `amount_chf`, `description` |
| `bexio_connections` | OAuth link per organization | `encrypted_tokens`, `bexio_company_id`, `chf_currency_id`, `scopes`, `connected_at` |
| `bexio_accounts` | Cached chart of accounts | `bexio_id`, `uuid`, `account_no`, `name`, `is_active` |
| `sync_attempts` | Every push to bexio | `entry_id`, `request` (jsonb, no secrets), `http_status`, `response`, `bexio_manual_entry_id`, `outcome` (`success` \| `failed` \| `unknown`) |
| `audit_log` | Append-only audit trail | `org_id`, `actor_user_id`, `action`, `entity`, `entity_id`, `before`, `after`, `created_at` |
| `plans` / `subscriptions` | Billing (Phase 2/3) | Limits as data (`max_sources`, `bexio_sync`, `multi_client`), prices in CHF as data, trial end |

Tenant isolation: every tenant table carries `org_id`; all queries go through helpers that require the caller's membership. PostgreSQL row-level security is planned as a second layer in Phase 2.

---

## I. Prioritised development plan

**Phase 1 — Functional MVP (this branch)**

1. Project scaffold, database schema, migrations, auth (register, login, logout, sessions), organization creation.
2. CSV import pipeline with dedupe and raw evidence; generic template (supported), Kraken ledger and Coinbase history parsers (partial).
3. Classification engine with confidence scores, transfer matching, user correction rules, review queue.
4. CHF valuation chain (trade-implied, rate table import, CoinGecko with key) with source attribution.
5. FIFO and weighted average engines, fee policies, insufficient-lot detection.
6. Journal entry generation, account mapping, validation workflow.
7. bexio OAuth connection, chart-of-accounts import, idempotent posting of validated entries, sync log.
8. Reports (CSV/Excel): transactions, realised gains, holdings, journal.
9. **bexio contract test** against a trial company (requires the owner's bexio developer app credentials) — the gate before calling the bexio sync "supported".

**Phase 2 — Automation**: pg-boss jobs; Kraken and Coinbase API connectors (read-only); EVM and Bitcoin address imports; SNB fiat rates and ESTV Kursliste import; reconciliation report (Crypto2Books vs bexio journal, `GET /3.0/accounting/journal`); evidence upload to bexio (`file` scope); TOTP MFA; PDF reports; row-level security.

**Phase 3 — Fiduciary**: multi-client dashboard, invitations and per-client roles, bulk validation, bulk reporting, policy review sign-off.

**Phase 4 — Advanced**: DeFi/LP decoding, NFTs, AI assistant (suggestions stored as `classification_origin = 'ai'`, always requiring human validation), advanced tax-supporting reports (KS 36 checklist, wealth tax statement using ESTV Kursliste).

**Credentials the owner needs to provide**

| Credential | Where | Needed for |
|---|---|---|
| `BEXIO_CLIENT_ID`, `BEXIO_CLIENT_SECRET` | bexio developer portal, app with redirect URL `<APP_URL>/api/bexio/callback` | bexio connection |
| A bexio trial company | bexio sign-up | Contract tests |
| `COINGECKO_API_KEY` (optional) | CoinGecko | Automatic historical CHF prices |
| `APP_ENCRYPTION_KEY` | Generated (32 bytes, base64) | Encrypting tokens |
| `DATABASE_URL` | PostgreSQL 16 | Everything |
