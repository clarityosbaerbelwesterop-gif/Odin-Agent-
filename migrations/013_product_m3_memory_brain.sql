-- PRODUCT M3 Memory Brain.
-- Persists the existing M6 MemoryStore contract and bounded product signals; it does not create a second memory authority.
BEGIN;

CREATE TABLE IF NOT EXISTS odin_api.memory_records (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  project_id uuid NOT NULL,
  id text NOT NULL CHECK(length(id) BETWEEN 1 AND 200),
  mission_id text,
  memory_key text NOT NULL CHECK(length(memory_key) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK(kind IN ('working','episodic','project','semantic','user_preference')),
  content text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  sensitivity text NOT NULL CHECK(sensitivity IN ('internal','public','sensitive')),
  source_class text,
  source_reference text,
  source_version text,
  source_observed_at timestamptz,
  source_content_hash text,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','tombstoned')),
  previous_content_hash text,
  version integer NOT NULL CHECK(version BETWEEN 1 AND 1000000),
  record_hash text NOT NULL CHECK(record_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id,project_id,id),
  FOREIGN KEY(owner_id,project_id) REFERENCES odin_api.conversations(owner_id,id) ON DELETE CASCADE,
  CHECK(mission_id IS NULL OR length(mission_id) BETWEEN 1 AND 200),
  CHECK(jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=32 AND octet_length(tags::text)<=4096),
  CHECK(kind<>'working' OR mission_id IS NOT NULL),
  CHECK(
    (status='active' AND content IS NOT NULL AND octet_length(content) BETWEEN 1 AND 65536
      AND source_class IN ('explicit_user','import','model_summary','repository','tool','verified_learning')
      AND source_reference IS NOT NULL AND length(source_reference) BETWEEN 1 AND 1000
      AND source_version IS NOT NULL AND length(source_version) BETWEEN 1 AND 200
      AND source_observed_at IS NOT NULL
      AND source_content_hash ~ '^[a-f0-9]{64}$'
      AND previous_content_hash IS NULL)
    OR
    (status='tombstoned' AND content IS NULL AND source_class IS NULL AND source_reference IS NULL
      AND source_version IS NULL AND source_observed_at IS NULL AND source_content_hash IS NULL
      AND previous_content_hash ~ '^[a-f0-9]{64}$')
  ),
  CHECK(kind<>'user_preference' OR source_class='explicit_user')
);
CREATE INDEX IF NOT EXISTS memory_records_recall
  ON odin_api.memory_records(owner_id,project_id,kind,updated_at DESC) WHERE status='active';
CREATE INDEX IF NOT EXISTS memory_records_key
  ON odin_api.memory_records(owner_id,project_id,memory_key,updated_at DESC) WHERE status='active';

CREATE TABLE IF NOT EXISTS odin_api.memory_revisions (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  cursor bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL,
  memory_id text NOT NULL,
  version integer NOT NULL CHECK(version BETWEEN 1 AND 1000000),
  action text NOT NULL CHECK(action IN ('written','tombstoned')),
  record_hash text NOT NULL CHECK(record_hash ~ '^[a-f0-9]{64}$'),
  source_reference text NOT NULL CHECK(length(source_reference) BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id,cursor),
  UNIQUE(owner_id,project_id,memory_id,version),
  FOREIGN KEY(owner_id,project_id,memory_id)
    REFERENCES odin_api.memory_records(owner_id,project_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_revisions_history
  ON odin_api.memory_revisions(owner_id,project_id,memory_id,version);

CREATE TABLE IF NOT EXISTS odin_api.memory_idempotency (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  project_id uuid NOT NULL,
  memory_id text NOT NULL,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,project_id,memory_id,idempotency_key),
  FOREIGN KEY(owner_id,project_id,memory_id)
    REFERENCES odin_api.memory_records(owner_id,project_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS odin_api.memory_product_signals (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  project_id uuid NOT NULL,
  memory_id text NOT NULL,
  usage_count integer NOT NULL DEFAULT 0 CHECK(usage_count BETWEEN 0 AND 1000000000),
  last_used_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,project_id,memory_id),
  FOREIGN KEY(owner_id,project_id,memory_id)
    REFERENCES odin_api.memory_records(owner_id,project_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_product_recent
  ON odin_api.memory_product_signals(owner_id,project_id,last_used_at DESC NULLS LAST);

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['memory_records','memory_revisions','memory_idempotency','memory_product_signals'] LOOP
    EXECUTE format('ALTER TABLE odin_api.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE odin_api.%I FORCE ROW LEVEL SECURITY',tab);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='odin_api' AND tablename=tab AND policyname='owner_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY owner_isolation ON odin_api.%I TO odin_runtime USING(owner_id=(SELECT odin_api.actor())) WITH CHECK(owner_id=(SELECT odin_api.actor()))',
        tab
      );
    END IF;
    EXECUTE format('REVOKE ALL ON odin_api.%I FROM PUBLIC',tab);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON odin_api.%I TO odin_runtime',tab);
  END LOOP;
END $policies$;
GRANT USAGE,SELECT ON SEQUENCE odin_api.memory_revisions_cursor_seq TO odin_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA odin_api REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
