CREATE TABLE "bexio_taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bexio_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"value" numeric(7, 4) NOT NULL,
	"is_active" boolean NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD COLUMN "bexio_tax_id" integer;--> statement-breakpoint
ALTER TABLE "bexio_taxes" ADD CONSTRAINT "bexio_taxes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bexio_taxes_uq" ON "bexio_taxes" USING btree ("org_id","bexio_id");