CREATE TABLE "ceramic_contact_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"filename" text,
	"preset" text,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"error_report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceramic_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"email_hash" text,
	"phone" text,
	"phone_hash" text,
	"company" text,
	"country" text,
	"city" text,
	"buyer_type" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_id" integer,
	"opted_out" boolean DEFAULT false NOT NULL,
	"last_contacted_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceramic_suppressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"email_hash" text,
	"phone_hash" text,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ceramic_contact_imports" ADD CONSTRAINT "ceramic_contact_imports_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_contact_imports" ADD CONSTRAINT "ceramic_contact_imports_imported_by_admin_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_contacts" ADD CONSTRAINT "ceramic_contacts_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_contacts" ADD CONSTRAINT "ceramic_contacts_lead_id_ceramic_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ceramic_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_suppressions" ADD CONSTRAINT "ceramic_suppressions_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ceramic_contact_imports_client_id" ON "ceramic_contact_imports" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_contacts_client_id" ON "ceramic_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_contacts_client_email_hash" ON "ceramic_contacts" USING btree ("client_id","email_hash");--> statement-breakpoint
CREATE INDEX "idx_ceramic_contacts_client_phone_hash" ON "ceramic_contacts" USING btree ("client_id","phone_hash");--> statement-breakpoint
CREATE INDEX "idx_ceramic_contacts_client_country" ON "ceramic_contacts" USING btree ("client_id","country");--> statement-breakpoint
CREATE INDEX "idx_ceramic_contacts_client_buyer_type" ON "ceramic_contacts" USING btree ("client_id","buyer_type");--> statement-breakpoint
CREATE INDEX "idx_ceramic_suppressions_client_id" ON "ceramic_suppressions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_suppressions_client_email_hash" ON "ceramic_suppressions" USING btree ("client_id","email_hash");--> statement-breakpoint
CREATE INDEX "idx_ceramic_suppressions_client_phone_hash" ON "ceramic_suppressions" USING btree ("client_id","phone_hash");