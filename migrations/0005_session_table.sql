-- Session store table for connect-pg-simple (express-session backing store).
--
-- We provision this via migration instead of the library's
-- `createTableIfMissing` option: that option reads connect-pg-simple's bundled
-- `table.sql` from disk at runtime, which does not survive the esbuild bundle
-- (the SQL data file is left out of dist/server.cjs → ENOENT on first session
-- write). DDL mirrors node_modules/connect-pg-simple/table.sql. IF NOT EXISTS
-- so this is safe on environments where the table was already auto-created.
CREATE TABLE IF NOT EXISTS "session" (
	"sid" varchar NOT NULL COLLATE "default",
	"sess" json NOT NULL,
	"expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION
	WHEN invalid_table_definition THEN null;
	WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
