CREATE TABLE "tax_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset" text NOT NULL,
	"tax_year" integer NOT NULL,
	"value_chf" numeric(38, 18) NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_values" ADD CONSTRAINT "tax_values_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_values_uq" ON "tax_values" USING btree ("org_id","asset","tax_year");