CREATE TABLE "fiscal_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" text NOT NULL,
	"valuation_method" text NOT NULL,
	"rate_basis" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"valuation_entry_id" uuid,
	"reversal_entry_id" uuid,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "transaction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "kind" text DEFAULT 'transaction' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "closing_year" integer;--> statement-breakpoint
ALTER TABLE "fiscal_closings" ADD CONSTRAINT "fiscal_closings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_closings_uq" ON "fiscal_closings" USING btree ("org_id","year");