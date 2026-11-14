# Crypto2Books

*From crypto to books.* Swiss crypto accounting that turns exchange and wallet transactions into validated accounting entries in **bexio**.

> Crypto2Books is a bookkeeping support tool. It is not a tax authority and does not replace a fiduciary or tax advisor.

- **Feasibility study, bexio API analysis, architecture, risks and roadmap:** [`docs/FEASIBILITY.md`](docs/FEASIBILITY.md)

## What works today (Phase 1)

| Step | Status |
|---|---|
| Registration, login (Argon2id, server-side sessions), organizations, roles | ✅ |
| CSV import with raw-row evidence, file and row deduplication | ✅ Crypto2Books template (supported) · Kraken ledgers, Coinbase history (partial) |
| Classification with confidence scores, own-wallet transfer matching, user rules, review queue | ✅ |
| CHF valuation: trade-implied CHF, documented rate table (CSV import), CoinGecko (optional key) | ✅ — missing rates block posting, nothing is estimated |
| FIFO / weighted average, fee policy, insufficient-history detection | ✅ |
| Balanced journal entries, validation workflow, immutable validated entries, audit log | ✅ |
| bexio OAuth, chart of accounts, account mapping, idempotent posting of manual entries | ✅ implemented — needs a contract test with your bexio developer app before production |
| Reports (CSV, Excel): transactions/CHF conversion, realised, holdings/unrealised, journal, income, fees | ✅ — PDF in Phase 2 |
| UI in French (primary), English, German | ✅ |
| Exchange APIs, wallet address import, scheduled sync, reconciliation, MFA, multi-client dashboard | Phase 2–3 (see roadmap) |

## Stack

Next.js (App Router) · TypeScript · PostgreSQL 16 · Drizzle ORM · decimal.js · Vitest. The accounting logic lives in pure modules under `src/core` (no I/O); database services in `src/server`; external clients in `src/integrations`.

## Run locally

```bash
cp .env.example .env.local      # fill DATABASE_URL and APP_ENCRYPTION_KEY (openssl rand -base64 32)
npm install
npm run db:migrate              # applies drizzle/*.sql (uses DATABASE_URL)
npm run dev                     # http://localhost:3000
```

### Credentials needed

| Variable | Where to get it | Used for |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 16+ | everything |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` | encrypting bexio tokens |
| `BEXIO_CLIENT_ID`, `BEXIO_CLIENT_SECRET`, `APP_URL` | bexio developer portal — create an app with redirect URL `${APP_URL}/api/bexio/callback` | bexio connection (scopes `openid offline_access company_profile accounting`) |
| `COINGECKO_API_KEY` (optional) | CoinGecko | automatic historical CHF prices |
| `ETHERSCAN_API_KEY` (optional) | Etherscan | reading Ethereum public addresses (free key) |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend | e-mails "Mot de passe oublié" (reset links); `MAIL_FROM` must use a domain verified in Resend |

Without bexio credentials the app runs fully; the bexio page shows what is missing. bexio has no sandbox: use a trial company for testing.

## Tests

```bash
npm test                        # unit tests (importers, classification, valuation, cost basis, journal)
npm run test:integration        # full flow on a real PostgreSQL (DATABASE_URL_TEST), bexio HTTP faked in tests only
```

## CSV template

`/api/template` downloads the header. Columns: `date, type, in_asset, in_quantity, out_asset, out_quantity, fee_asset, fee_quantity, external_id, tx_hash, chf_value, note` (details in `src/core/importers/generic.ts`).

Rate table import: `asset,date,rate_chf,source,source_url` (one documented CHF rate per asset and Swiss calendar day).
