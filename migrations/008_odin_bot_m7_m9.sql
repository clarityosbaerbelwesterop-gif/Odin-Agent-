-- Odin Bot M7-M9: event-driven wakeups, GitHub PR lifecycle receipts and proactive inbox dedupe.
-- Additive/idempotent. The control schema stores only routing metadata and one-way webhook token hashes.
BEGIN;

ALTER TABLE odin_api.bot_inbox
  ADD COLUMN IF NOT EXISTS dedupe_key text
  CHECK(dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX IF NOT EXISTS odin_bot_inbox_dedupe
  ON odin_api.bot_inbox(owner_id,dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS odin_control.bot_github_hooks (
  owner_id text PRIMARY KEY,
  repository text NOT NULL CHECK(repository ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  hook_id text NOT NULL CHECK(hook_id ~ '^[0-9]{1,30}$'),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS odin_bot_github_hooks_repository
  ON odin_control.bot_github_hooks(repository);

CREATE TABLE IF NOT EXISTS odin_control.bot_event_receipts (
  owner_id text NOT NULL,
  delivery_id text NOT NULL CHECK(length(delivery_id) BETWEEN 8 AND 128),
  event_name text NOT NULL CHECK(event_name IN ('pull_request','pull_request_review','check_run','workflow_run','push')),
  repository text NOT NULL CHECK(repository ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY(owner_id,delivery_id)
);
CREATE INDEX IF NOT EXISTS odin_bot_event_receipts_recent
  ON odin_control.bot_event_receipts(received_at DESC);

REVOKE ALL ON odin_control.bot_github_hooks FROM PUBLIC;
REVOKE ALL ON odin_control.bot_event_receipts FROM PUBLIC;

CREATE OR REPLACE FUNCTION odin_control.cleanup_github_event_control() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  DELETE FROM odin_control.bot_event_receipts WHERE owner_id=OLD.owner_id;
  DELETE FROM odin_control.bot_github_hooks WHERE owner_id=OLD.owner_id;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION odin_control.cleanup_github_event_control() FROM PUBLIC;

DROP TRIGGER IF EXISTS github_event_control_cleanup ON odin_api.github_connections;
CREATE TRIGGER github_event_control_cleanup
AFTER DELETE ON odin_api.github_connections
FOR EACH ROW EXECUTE FUNCTION odin_control.cleanup_github_event_control();

DO $grant_worker$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='odin_prod_app') THEN
    GRANT USAGE ON SCHEMA odin_control TO odin_prod_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON odin_control.bot_github_hooks TO odin_prod_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON odin_control.bot_event_receipts TO odin_prod_app;
  END IF;
END $grant_worker$;

ALTER DEFAULT PRIVILEGES IN SCHEMA odin_control REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
