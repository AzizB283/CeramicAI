CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'factory' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "superadmin_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"superadmin_id" uuid NOT NULL,
	"client_id" uuid,
	"action" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superadmin_actions" ADD CONSTRAINT "superadmin_actions_superadmin_id_admin_users_id_fk" FOREIGN KEY ("superadmin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superadmin_actions" ADD CONSTRAINT "superadmin_actions_client_id_ceramic_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ceramic_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_users_client_id" ON "admin_users" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_superadmin_actions_client" ON "superadmin_actions" USING btree ("client_id");