CREATE TABLE "platform_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"wanted" text DEFAULT 'either' NOT NULL,
	"note" text,
	"sample_name" text,
	"sample_content" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reported_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"asset" text NOT NULL,
	"as_of" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"evidence" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_requests" ADD CONSTRAINT "platform_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_balances" ADD CONSTRAINT "reported_balances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_balances" ADD CONSTRAINT "reported_balances_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_requests_org_idx" ON "platform_requests" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reported_balances_uq" ON "reported_balances" USING btree ("org_id","source_id","asset","as_of");