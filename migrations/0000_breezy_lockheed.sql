CREATE TABLE "ceramic_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"owner_name" text,
	"owner_whatsapp" text,
	"catalog_url" text,
	"export_catalog_url" text,
	"wa_phone_id" text,
	"wa_token" text,
	"wa_verify_token" text,
	"widget_color" text DEFAULT 'e85d04',
	"widget_name" text,
	"widget_greeting" text,
	"timezone" text DEFAULT 'Asia/Kolkata',
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceramic_followups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"client_id" uuid NOT NULL,
	"send_at" timestamp NOT NULL,
	"day_number" integer,
	"message" text,
	"sent" boolean DEFAULT false,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ceramic_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"channel" text,
	"buyer_type" text,
	"buyer_name" text,
	"buyer_phone" text,
	"buyer_phone_hash" text,
	"buyer_company" text,
	"buyer_country" text,
	"buyer_city" text,
	"product_category" text,
	"product_size" text,
	"product_finish" text,
	"quantity" text,
	"incoterms" text,
	"destination_port" text,
	"sample_requested" boolean DEFAULT false,
	"is_distributor_inquiry" boolean DEFAULT false,
	"priority" text DEFAULT 'normal',
	"catalog_sent" boolean DEFAULT false,
	"owner_notified" boolean DEFAULT false,
	"status" text DEFAULT 'new',
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ceramic_followups" ADD CONSTRAINT "ceramic_followups_lead_id_ceramic_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ceramic_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_followups" ADD CONSTRAINT "ceramic_followups_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_leads" ADD CONSTRAINT "ceramic_leads_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ceramic_followups_client_id" ON "ceramic_followups" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_followups_lead_id" ON "ceramic_followups" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_followups_due" ON "ceramic_followups" USING btree ("sent","send_at");--> statement-breakpoint
CREATE INDEX "idx_ceramic_leads_client_id" ON "ceramic_leads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_leads_client_status" ON "ceramic_leads" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "idx_ceramic_leads_client_phone_hash" ON "ceramic_leads" USING btree ("client_id","buyer_phone_hash");--> statement-breakpoint
CREATE INDEX "idx_ceramic_leads_session" ON "ceramic_leads" USING btree ("session_id");