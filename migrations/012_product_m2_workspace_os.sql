-- PRODUCT M2 Workspace OS.
-- Extends the existing odin_api.workspace_files authority; it does not create a second artifact store.
BEGIN;

ALTER TABLE odin_api.workspace_files
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'GENERATED_ARTIFACT',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'runtime',
  ADD COLUMN IF NOT EXISTS source_turn_id uuid,
  ADD COLUMN IF NOT EXISTS source_task_id text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE odin_api.workspace_files SET item_id = gen_random_uuid() WHERE item_id IS NULL;
ALTER TABLE odin_api.workspace_files ALTER COLUMN item_id SET DEFAULT gen_random_uuid();
ALTER TABLE odin_api.workspace_files ALTER COLUMN item_id SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_files_kind_check') THEN
    ALTER TABLE odin_api.workspace_files ADD CONSTRAINT workspace_files_kind_check
      CHECK(kind IN ('DOCUMENT','NOTE','TEXT','MARKDOWN','CODE','HTML','JSON','IMAGE_REFERENCE','FILE_REFERENCE','GENERATED_ARTIFACT','RESEARCH_RESULT','PLAN','REPORT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_files_origin_check') THEN
    ALTER TABLE odin_api.workspace_files ADD CONSTRAINT workspace_files_origin_check
      CHECK(origin IN ('user','runtime','import'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_files_version_check') THEN
    ALTER TABLE odin_api.workspace_files ADD CONSTRAINT workspace_files_version_check CHECK(version BETWEEN 1 AND 1000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_files_title_check') THEN
    ALTER TABLE odin_api.workspace_files ADD CONSTRAINT workspace_files_title_check
      CHECK(title IS NULL OR length(title) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_files_mime_check') THEN
    ALTER TABLE odin_api.workspace_files ADD CONSTRAINT workspace_files_mime_check
      CHECK(mime_type IS NULL OR length(mime_type) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_files_task_check') THEN
    ALTER TABLE odin_api.workspace_files ADD CONSTRAINT workspace_files_task_check
      CHECK(source_task_id IS NULL OR length(source_task_id) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_files_metadata_check') THEN
    ALTER TABLE odin_api.workspace_files ADD CONSTRAINT workspace_files_metadata_check
      CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=16000);
  END IF;
END $constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_files_item_identity
  ON odin_api.workspace_files(owner_id,conversation_id,item_id);
CREATE INDEX IF NOT EXISTS workspace_files_recent
  ON odin_api.workspace_files(owner_id,conversation_id,updated_at DESC);

-- Existing product event types already allow turnId=null in TypeScript. M2 uses that existing event
-- authority for user Workspace actions that do not belong to a Run.
ALTER TABLE odin_api.events ALTER COLUMN turn_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS odin_api.workspace_context_items (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  conversation_id uuid NOT NULL,
  item_id uuid NOT NULL,
  reason text NOT NULL DEFAULT 'Selected by user' CHECK(length(reason) BETWEEN 1 AND 240),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,conversation_id,item_id),
  FOREIGN KEY(owner_id,conversation_id) REFERENCES odin_api.conversations(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,conversation_id,item_id)
    REFERENCES odin_api.workspace_files(owner_id,conversation_id,item_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS odin_api.workspace_layouts (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  conversation_id uuid NOT NULL,
  open_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_item_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,conversation_id),
  FOREIGN KEY(owner_id,conversation_id) REFERENCES odin_api.conversations(owner_id,id) ON DELETE CASCADE,
  CHECK(jsonb_typeof(open_items)='array' AND jsonb_array_length(open_items)<=12 AND octet_length(open_items::text)<=1200)
);

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['workspace_context_items','workspace_layouts'] LOOP
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

COMMIT;
