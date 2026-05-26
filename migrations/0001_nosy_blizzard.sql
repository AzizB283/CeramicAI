CREATE TABLE "ceramic_catalogues" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"audience" text DEFAULT 'both' NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"sizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finishes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ceramic_catalogues" ADD CONSTRAINT "ceramic_catalogues_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ceramic_catalogues_client_id" ON "ceramic_catalogues" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_ceramic_catalogues_client_active" ON "ceramic_catalogues" USING btree ("client_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_ceramic_catalogues_match" ON "ceramic_catalogues" USING btree ("client_id","category","audience");