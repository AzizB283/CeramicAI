CREATE TABLE "ceramic_campaign_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reply_intent" text,
	"next_send_at" timestamp,
	"rendered_subject" text,
	"rendered_body" text,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"error" text,
	"opened_at" timestamp,
	"last_sent_at" timestamp,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceramic_campaign_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"subject" text NOT NULL,
	"body_template" text NOT NULL,
	"catalogue_id" integer,
	"whatsapp_template_name" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceramic_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"segment_id" integer,
	"ai_personalize" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceramic_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kind" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceramic_tracked_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"token" text NOT NULL,
	"target_url" text NOT NULL,
	"campaign_id" integer,
	"recipient_id" integer,
	"catalogue_id" integer,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"first_hit_at" timestamp,
	"last_hit_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ceramic_tracked_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "ceramic_campaign_recipients" ADD CONSTRAINT "ceramic_campaign_recipients_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_campaign_recipients" ADD CONSTRAINT "ceramic_campaign_recipients_campaign_id_ceramic_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ceramic_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_campaign_recipients" ADD CONSTRAINT "ceramic_campaign_recipients_contact_id_ceramic_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."ceramic_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_campaign_steps" ADD CONSTRAINT "ceramic_campaign_steps_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_campaign_steps" ADD CONSTRAINT "ceramic_campaign_steps_campaign_id_ceramic_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ceramic_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_campaign_steps" ADD CONSTRAINT "ceramic_campaign_steps_catalogue_id_ceramic_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."ceramic_catalogues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_campaigns" ADD CONSTRAINT "ceramic_campaigns_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_campaigns" ADD CONSTRAINT "ceramic_campaigns_segment_id_ceramic_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."ceramic_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_segments" ADD CONSTRAINT "ceramic_segments_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_tracked_links" ADD CONSTRAINT "ceramic_tracked_links_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_tracked_links" ADD CONSTRAINT "ceramic_tracked_links_campaign_id_ceramic_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ceramic_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_tracked_links" ADD CONSTRAINT "ceramic_tracked_links_recipient_id_ceramic_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."ceramic_campaign_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceramic_tracked_links" ADD CONSTRAINT "ceramic_tracked_links_catalogue_id_ceramic_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."ceramic_catalogues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaign_recipients_campaign_status" ON "ceramic_campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaign_recipients_client_id" ON "ceramic_campaign_recipients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaign_recipients_contact" ON "ceramic_campaign_recipients" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaign_recipients_due" ON "ceramic_campaign_recipients" USING btree ("status","next_send_at");--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaign_steps_campaign" ON "ceramic_campaign_steps" USING btree ("campaign_id","step_index");--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaign_steps_client_id" ON "ceramic_campaign_steps" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaigns_client_id" ON "ceramic_campaigns" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_campaigns_client_status" ON "ceramic_campaigns" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "idx_ceramic_segments_client_id" ON "ceramic_segments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_tracked_links_client_id" ON "ceramic_tracked_links" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_tracked_links_recipient" ON "ceramic_tracked_links" USING btree ("recipient_id");