-- PRODUCT M5 Skills OS product state.
-- This migration stores only user installation/draft state. M10/M23 remain the Skill lifecycle/selection
-- authority and M25 remains the tool/permission authority.
BEGIN;

CREATE TABLE IF NOT EXISTS odin_api.skill_installations (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  installation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  skill_id text NOT NULL CHECK(skill_id ~ '^[a-z][a-z0-9-]{0,63}$'),
  version text NOT NULL CHECK(length(version) BETWEEN 1 AND 32),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  scope text NOT NULL CHECK(scope IN ('global','project')),
  project_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  previous_version text CHECK(previous_version IS NULL OR length(previous_version) BETWEEN 1 AND 32),
  previous_content_hash text CHECK(previous_content_hash IS NULL OR previous_content_hash ~ '^[a-f0-9]{64}$'),
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,installation_id),
  CHECK((scope='global' AND project_id IS NULL) OR (scope='project' AND project_id IS NOT NULL)),
  CHECK((previous_version IS NULL) = (previous_content_hash IS NULL)),
  FOREIGN KEY(owner_id,project_id)
    REFERENCES odin_api.conversations(owner_id,id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_installations_global_unique
  ON odin_api.skill_installations(owner_id,skill_id)
  WHERE scope='global';
CREATE UNIQUE INDEX IF NOT EXISTS skill_installations_project_unique
  ON odin_api.skill_installations(owner_id,project_id,skill_id)
  WHERE scope='project';
CREATE INDEX IF NOT EXISTS skill_installations_project_lookup
  ON odin_api.skill_installations(owner_id,project_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS odin_api.custom_skill_drafts (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  draft_id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(name ~ '^[a-z][a-z0-9-]{0,63}$'),
  version text NOT NULL CHECK(length(version) BETWEEN 1 AND 32),
  purpose text NOT NULL CHECK(length(purpose) BETWEEN 8 AND 600),
  procedure jsonb NOT NULL CHECK(jsonb_typeof(procedure)='array' AND jsonb_array_length(procedure) BETWEEN 1 AND 16 AND octet_length(procedure::text)<=16000),
  inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='array' AND jsonb_array_length(inputs)<=16 AND octet_length(inputs::text)<=4000),
  outputs jsonb NOT NULL CHECK(jsonb_typeof(outputs)='array' AND jsonb_array_length(outputs)<=16 AND octet_length(outputs::text)<=4000),
  required_tools jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(required_tools)='array' AND jsonb_array_length(required_tools)<=32 AND octet_length(required_tools::text)<=4000),
  required_connections jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(required_connections)='array' AND jsonb_array_length(required_connections)<=16 AND octet_length(required_connections::text)<=2000),
  verification_plan jsonb NOT NULL CHECK(jsonb_typeof(verification_plan)='array' AND jsonb_array_length(verification_plan) BETWEEN 1 AND 16 AND octet_length(verification_plan::text)<=8000),
  scope text NOT NULL CHECK(scope IN ('global','project')),
  project_id uuid,
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','QUARANTINED','VERIFIED','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,draft_id),
  CHECK((scope='global' AND project_id IS NULL) OR (scope='project' AND project_id IS NOT NULL)),
  FOREIGN KEY(owner_id,project_id)
    REFERENCES odin_api.conversations(owner_id,id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS custom_skill_drafts_project_lookup
  ON odin_api.custom_skill_drafts(owner_id,project_id,created_at DESC);

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['skill_installations','custom_skill_drafts'] LOOP
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

-- Project-scoped Skill state is now structurally bound to the canonical Conversation/Project authority.
-- No trigger or grant here mints tool/network/credential/deployment/database authority.
COMMIT;
