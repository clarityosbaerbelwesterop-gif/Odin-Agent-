-- Apply with the migration connection, first on an isolated preview branch.
-- Application requests SET LOCAL ROLE + verified identity inside each short transaction.
BEGIN;
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odin_runtime') THEN
    CREATE ROLE odin_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='odin_runtime' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
    RAISE EXCEPTION 'Unsafe odin_runtime role';
  END IF;
END $role$;
GRANT odin_runtime TO CURRENT_USER;
CREATE SCHEMA IF NOT EXISTS odin_api;
REVOKE ALL ON SCHEMA odin_api FROM PUBLIC;
GRANT USAGE ON SCHEMA odin_api TO odin_runtime;

CREATE OR REPLACE FUNCTION odin_api.actor() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ SELECT NULLIF(current_setting('odin.user_id', true), '') $$;
REVOKE ALL ON FUNCTION odin_api.actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odin_api.actor() TO odin_runtime;

CREATE TABLE IF NOT EXISTS odin_api.conversations (
  owner_id text NOT NULL DEFAULT odin_api.actor(), id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS odin_api.mission_streams (
  owner_id text NOT NULL DEFAULT odin_api.actor(), id uuid NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 100000),
  events jsonb NOT NULL DEFAULT '[]', replays jsonb NOT NULL DEFAULT '{}',
  CHECK(jsonb_typeof(events)='array' AND octet_length(events::text)<=8000000),
  CHECK(jsonb_typeof(replays)='object' AND octet_length(replays::text)<=4000000),
  PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS odin_api.turns (
  owner_id text NOT NULL DEFAULT odin_api.actor(), id uuid NOT NULL, conversation_id uuid NOT NULL,
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL CHECK(octet_length(data::text)<=40000),
  data_hash text NOT NULL CHECK(data_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id),
  UNIQUE(owner_id,conversation_id,id), UNIQUE(owner_id,conversation_id,request_key),
  FOREIGN KEY(owner_id,conversation_id) REFERENCES odin_api.conversations(owner_id,id),
  FOREIGN KEY(owner_id,id) REFERENCES odin_api.mission_streams(owner_id,id)
);
CREATE TABLE IF NOT EXISTS odin_api.events (
  owner_id text NOT NULL DEFAULT odin_api.actor(), cursor bigint GENERATED ALWAYS AS IDENTITY,
  conversation_id uuid NOT NULL, turn_id uuid NOT NULL,
  type text NOT NULL CHECK(type ~ '^[a-z_.]{1,50}$'),
  data jsonb NOT NULL CHECK(octet_length(data::text)<=300000),
  data_hash text NOT NULL CHECK(data_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,cursor),
  FOREIGN KEY(owner_id,conversation_id,turn_id) REFERENCES odin_api.turns(owner_id,conversation_id,id)
);
CREATE INDEX IF NOT EXISTS odin_events_replay ON odin_api.events(owner_id,conversation_id,cursor);
CREATE TABLE IF NOT EXISTS odin_api.checkpoints (
  owner_id text NOT NULL DEFAULT odin_api.actor(), turn_id uuid NOT NULL,
  data jsonb NOT NULL CHECK(octet_length(data::text)<=2000000),
  data_hash text NOT NULL CHECK(data_hash ~ '^[a-f0-9]{64}$'), PRIMARY KEY(owner_id,turn_id),
  FOREIGN KEY(owner_id,turn_id) REFERENCES odin_api.turns(owner_id,id)
);
CREATE TABLE IF NOT EXISTS odin_api.leases (
  owner_id text NOT NULL DEFAULT odin_api.actor(), resource text NOT NULL CHECK(length(resource)<=150),
  token uuid NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id,resource)
);
DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['conversations','mission_streams','turns','events','checkpoints','leases'] LOOP
    EXECUTE format('ALTER TABLE odin_api.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE odin_api.%I FORCE ROW LEVEL SECURITY',tab);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='odin_api' AND tablename=tab AND policyname='owner_isolation') THEN
      EXECUTE format('CREATE POLICY owner_isolation ON odin_api.%I TO odin_runtime USING (owner_id = (SELECT odin_api.actor())) WITH CHECK (owner_id = (SELECT odin_api.actor()))',tab);
    END IF;
    EXECUTE format('REVOKE ALL ON odin_api.%I FROM PUBLIC',tab);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON odin_api.%I TO odin_runtime',tab);
  END LOOP;
END $policies$;
GRANT USAGE ON SEQUENCE odin_api.events_cursor_seq TO odin_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA odin_api REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA odin_api REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
