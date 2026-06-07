CREATE TABLE "email_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"gmail_address" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" timestamp,
	"history_id" text,
	"last_checked_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "email_connections_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"lead_id" integer,
	"gmail_thread_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"from_email" text,
	"from_name" text,
	"subject" text,
	"body_text" text,
	"source_platform" text,
	"language" text,
	"generated_reply" text,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"received_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "email_threads_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
ALTER TABLE "ceramic_leads" ADD COLUMN "email_thread_id" integer;--> statement-breakpoint
ALTER TABLE "email_connections" ADD CONSTRAINT "email_connections_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_lead_id_ceramic_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ceramic_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_connections_active" ON "email_connections" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_email_threads_client_id" ON "email_threads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_email_threads_client_status" ON "email_threads" USING btree ("client_id","status");