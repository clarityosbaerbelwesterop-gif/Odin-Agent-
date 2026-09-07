BEGIN;
CREATE TABLE IF NOT EXISTS odin_api.workspace_files (
 owner_id text NOT NULL DEFAULT odin_api.actor(), conversation_id uuid NOT NULL,
 path text NOT NULL CHECK(length(path) BETWEEN 1 AND 300),
 content text NOT NULL CHECK(octet_length(content)<=262144),
 sha text NOT NULL CHECK(sha ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(owner_id,conversation_id,path),
 FOREIGN KEY(owner_id,conversation_id) REFERENCES odin_api.conversations(owner_id,id)
);
CREATE TABLE IF NOT EXISTS odin_api.rate_limits (
 owner_id text NOT NULL DEFAULT odin_api.actor(), scope text NOT NULL CHECK(length(scope)<=200),
 hits integer NOT NULL CHECK(hits>0), expires_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,scope)
);
ALTER TABLE odin_api.workspace_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE odin_api.workspace_files FORCE ROW LEVEL SECURITY;
ALTER TABLE odin_api.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE odin_api.rate_limits FORCE ROW LEVEL SECURITY;
DO $policies$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['workspace_files','rate_limits'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='odin_api' AND tablename=tab AND policyname='owner_isolation') THEN
   EXECUTE format('CREATE POLICY owner_isolation ON odin_api.%I TO odin_runtime USING(owner_id=(SELECT odin_api.actor())) WITH CHECK(owner_id=(SELECT odin_api.actor()))',tab);
  END IF;
  EXECUTE format('REVOKE ALL ON odin_api.%I FROM PUBLIC',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON odin_api.%I TO odin_runtime',tab);
 END LOOP;
END $policies$;
COMMIT;
