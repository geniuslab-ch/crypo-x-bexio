CREATE TYPE "public"."movement_direction" AS ENUM('in', 'out', 'fee');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('draft', 'validated', 'synced', 'sync_failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."org_kind" AS ENUM('company', 'sole_trader', 'private');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('ok', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'accountant', 'fiduciary', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('complete', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."sync_outcome" AS ENUM('success', 'failed', 'unknown');--> statement-breakpoint
CREATE TABLE "account_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"bexio_account_id" integer NOT NULL,
	"bexio_account_no" text NOT NULL,
	"bexio_account_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"cost_basis_method" text DEFAULT 'fifo' NOT NULL,
	"trading_fee_treatment" text DEFAULT 'capitalize' NOT NULL,
	"transfer_window_hours" integer DEFAULT 48 NOT NULL,
	"transfer_tolerance" numeric(10, 6) DEFAULT '0.01' NOT NULL,
	"reviewed_by_fiduciary_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bexio_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bexio_id" integer NOT NULL,
	"uuid" text,
	"account_no" text NOT NULL,
	"name" text NOT NULL,
	"account_type" integer,
	"is_active" boolean NOT NULL,
	"is_locked" boolean NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bexio_business_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bexio_id" integer NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bexio_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"encrypted_tokens" text NOT NULL,
	"scopes" text NOT NULL,
	"company_name" text,
	"chf_currency_id" integer,
	"connected_by" uuid NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calculation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" "run_status" NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transaction_count" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"raw_type" text NOT NULL,
	"asset" text,
	"classification" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"asset" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"proceeds_chf" numeric(38, 18) NOT NULL,
	"cost_chf" numeric(38, 18) NOT NULL,
	"gain_chf" numeric(38, 18) NOT NULL,
	"allocations" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"parser_id" text NOT NULL,
	"parser_version" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_content" text NOT NULL,
	"row_count" integer NOT NULL,
	"imported_count" integer NOT NULL,
	"duplicate_count" integer NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"entry_date" text NOT NULL,
	"reference_nr" text NOT NULL,
	"description" text NOT NULL,
	"status" "entry_status" DEFAULT 'draft' NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"bexio_manual_entry_id" integer,
	"synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"debit_key" text NOT NULL,
	"credit_key" text NOT NULL,
	"amount_chf" numeric(18, 2) NOT NULL,
	"description" text NOT NULL,
	"bexio_entry_line_id" integer
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"lot_key" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"asset" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"cost_chf" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"direction" "movement_direction" NOT NULL,
	"asset" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"derived" boolean DEFAULT false NOT NULL,
	"chf_rate" numeric(38, 18),
	"chf_value" numeric(38, 18),
	"rate_source" text,
	"rate_ref" text
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "org_kind" NOT NULL,
	"canton" text,
	"base_currency" text DEFAULT 'CHF' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_chf_monthly" numeric(10, 2),
	"limits" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset" text NOT NULL,
	"rate_date" text NOT NULL,
	"rate" numeric(38, 18) NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"active_org_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"connection_type" text DEFAULT 'csv' NOT NULL,
	"encrypted_credentials" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"http_status" integer,
	"response" jsonb,
	"outcome" "sync_outcome" NOT NULL,
	"error_message" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"external_id" text,
	"tx_hash" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw_type" text NOT NULL,
	"raw" jsonb NOT NULL,
	"row_numbers" jsonb NOT NULL,
	"note" text,
	"fingerprint" text NOT NULL,
	"hint" jsonb,
	"source_chf_value" numeric(38, 18),
	"classification" text DEFAULT 'unknown' NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"classification_origin" text DEFAULT 'structure' NOT NULL,
	"classification_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual_classification" text,
	"review_status" "review_status" DEFAULT 'needs_review' NOT NULL,
	"transfer_group_id" text,
	"rate_missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_policies" ADD CONSTRAINT "accounting_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bexio_accounts" ADD CONSTRAINT "bexio_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bexio_business_years" ADD CONSTRAINT "bexio_business_years_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bexio_connections" ADD CONSTRAINT "bexio_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposals" ADD CONSTRAINT "disposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposals" ADD CONSTRAINT "disposals_run_id_calculation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."calculation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_run_id_calculation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."calculation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_run_id_calculation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."calculation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rates" ADD CONSTRAINT "price_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mappings_uq" ON "account_mappings" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_org_uq" ON "accounting_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bexio_accounts_uq" ON "bexio_accounts" USING btree ("org_id","bexio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bexio_by_uq" ON "bexio_business_years" USING btree ("org_id","bexio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bexio_conn_org_uq" ON "bexio_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "disposals_run_idx" ON "disposals" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_file_uq" ON "import_batches" USING btree ("source_id","file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_ref_uq" ON "journal_entries" USING btree ("org_id","reference_nr");--> statement-breakpoint
CREATE INDEX "journal_tx_idx" ON "journal_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "lots_run_idx" ON "lots" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "movements_tx_idx" ON "movements" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_state_uq" ON "oauth_states" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "price_rates_uq" ON "price_rates" USING btree ("org_id","asset","rate_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_uq" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sync_attempts_entry_idx" ON "sync_attempts" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_fp_uq" ON "transactions" USING btree ("org_id","fingerprint");--> statement-breakpoint
CREATE INDEX "transactions_org_time_idx" ON "transactions" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));