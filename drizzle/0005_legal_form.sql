ALTER TYPE "public"."org_kind" ADD VALUE 'foundation';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_form" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_status" text DEFAULT 'ordinary' NOT NULL;