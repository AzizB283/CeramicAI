-- WhatsApp slice: per-client slug for webhook URL + app secret for signature verification.
--
-- The naive ALTER … NOT NULL fails on existing rows. We add the column as
-- nullable, backfill anything that exists (the demo row gets 'demo'), then
-- enforce NOT NULL + UNIQUE. Safe on fresh databases (no rows to backfill).

ALTER TABLE "ceramic_clients" ADD COLUMN "slug" text;
--> statement-breakpoint
UPDATE "ceramic_clients" SET "slug" = 'demo' WHERE "slug" IS NULL AND "name" = 'Shree Tiles Pvt Ltd (Demo)';
--> statement-breakpoint
-- Any other rows (none expected in current single-tenant deployments) get a
-- placeholder derived from their id so the NOT NULL constraint succeeds.
-- They can be renamed later via the admin UI.
UPDATE "ceramic_clients" SET "slug" = 'client-' || substring(id::text, 1, 8) WHERE "slug" IS NULL;
--> statement-breakpoint
ALTER TABLE "ceramic_clients" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ceramic_clients" ADD CONSTRAINT "ceramic_clients_slug_unique" UNIQUE("slug");
--> statement-breakpoint
ALTER TABLE "ceramic_clients" ADD COLUMN "wa_app_secret" text;
