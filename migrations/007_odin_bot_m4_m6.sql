-- Odin Bot M4-M6: scoped approvals, persistent bot memory, continuity and focus state.
-- Additive, idempotent, FORCE-RLS isolated. No credential material belongs in these tables.
BEGIN;

CREATE TABLE IF NOT EXISTS odin_api.bot_approvals (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  task_id uuid NOT NULL,
  action_type text NOT NULL CHECK(action_type ~ '^[a-z0-9_.-]{1,80}$'),
  action_ref text NOT NULL CHECK(length(action_ref) BETWEEN 1 AND 1000),
  action_hash text NOT NULL CHECK(action_hash ~ '^[a-f0-9]{64}$'),
  risk text NOT NULL CHECK(risk IN ('low','medium','high','critical')),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','consumed','expired')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,task_id) REFERENCES odin_api.bot_tasks(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_approvals_pending
  ON odin_api.bot_approvals(owner_id,created_at DESC) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS odin_bot_approval_exact_action
  ON odin_api.bot_approvals(owner_id,task_id,action_hash) WHERE status IN ('pending','approved');

CREATE TABLE IF NOT EXISTS odin_api.bot_memories (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  bot_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN (
    'user_preference','project','recurring_task','decision','working_context','previous_mission','learned_procedure'
  )),
  memory_key text NOT NULL CHECK(length(memory_key) BETWEEN 1 AND 240),
  content text NOT NULL CHECK(length(content) BETWEEN 1 AND 65536),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  source_class text NOT NULL CHECK(source_class IN ('explicit_user','repository','tool','mission','verified_learning')),
  source_ref text NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 1000),
  source_timestamp timestamptz NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(scope)='object' AND octet_length(scope::text)<=20000),
  confidence numeric(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000000),
  sensitivity text NOT NULL CHECK(sensitivity IN ('public','internal','sensitive')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  UNIQUE(owner_id,bot_id,memory_key),
  FOREIGN KEY(owner_id,bot_id) REFERENCES odin_api.bots(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_memory_recall
  ON odin_api.bot_memories(owner_id,bot_id,kind,updated_at DESC);

CREATE TABLE IF NOT EXISTS odin_api.bot_focus (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  task_id uuid NOT NULL,
  primary_objective text NOT NULL CHECK(length(primary_objective) BETWEEN 1 AND 16000),
  definition_of_done jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(definition_of_done)='array' AND octet_length(definition_of_done::text)<=50000),
  constraints jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(constraints)='array' AND octet_length(constraints::text)<=50000),
  current_plan jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(current_plan)='array' AND octet_length(current_plan::text)<=100000),
  completed_steps jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(completed_steps)='array' AND octet_length(completed_steps::text)<=100000),
  open_blockers jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(open_blockers)='array' AND octet_length(open_blockers::text)<=50000),
  team_plan jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(team_plan)='object' AND octet_length(team_plan::text)<=50000),
  drift_count integer NOT NULL DEFAULT 0 CHECK(drift_count BETWEEN 0 AND 1000000),
  revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,task_id),
  FOREIGN KEY(owner_id,task_id) REFERENCES odin_api.bot_tasks(owner_id,id) ON DELETE CASCADE
);

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['bot_approvals','bot_memories','bot_focus'] LOOP
    EXECUTE format('ALTER TABLE odin_api.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE odin_api.%I FORCE ROW LEVEL SECURITY',tab);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='odin_api' AND tablename=tab AND policyname='owner_isolation'
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

ALTER DEFAULT PRIVILEGES IN SCHEMA odin_api REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
