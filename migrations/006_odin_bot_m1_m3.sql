-- Odin Bot M1-M3: persistent bot identity, durable task/wakeup control plane and inbox.
-- Additive and idempotent. User-owned data remains FORCE-RLS isolated in odin_api.
-- odin_control contains only scheduler references (owner id + target id + timing), never task payloads or secrets.
BEGIN;

CREATE SCHEMA IF NOT EXISTS odin_control;
REVOKE ALL ON SCHEMA odin_control FROM PUBLIC;

CREATE TABLE IF NOT EXISTS odin_api.bots (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Odin Bot' CHECK(length(name) BETWEEN 1 AND 100),
  goal text NOT NULL DEFAULT 'Take ownership of delegated work.' CHECK(length(goal) BETWEEN 1 AND 2000),
  autonomy_level smallint NOT NULL DEFAULT 2 CHECK(autonomy_level BETWEEN 0 AND 4),
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS odin_bot_one_default ON odin_api.bots(owner_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS odin_api.bot_tasks (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  bot_id uuid NOT NULL,
  goal text NOT NULL CHECK(length(goal) BETWEEN 1 AND 16000),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','working','waiting','approval','blocked','done','cancelled','failed')),
  current_step text NOT NULL DEFAULT 'Queued' CHECK(length(current_step) BETWEEN 1 AND 300),
  agent text NOT NULL DEFAULT 'odin_general' CHECK(length(agent) BETWEEN 1 AND 80),
  mode text NOT NULL DEFAULT 'thinking' CHECK(mode IN ('chat','thinking','research','coding','ultra')),
  model_id text CHECK(model_id IS NULL OR length(model_id) BETWEEN 1 AND 160),
  priority smallint NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
  budget jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(budget)='object' AND octet_length(budget::text)<=20000),
  permissions jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(permissions)='object' AND octet_length(permissions::text)<=20000),
  artifacts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(artifacts)='array' AND octet_length(artifacts::text)<=100000),
  checkpoint jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(checkpoint)='object' AND octet_length(checkpoint::text)<=500000),
  checkpoint_version integer NOT NULL DEFAULT 0 CHECK(checkpoint_version BETWEEN 0 AND 1000000),
  source_automation_id uuid,
  conversation_id uuid,
  turn_id uuid,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 160),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  next_wakeup_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  UNIQUE(owner_id,idempotency_key),
  FOREIGN KEY(owner_id,bot_id) REFERENCES odin_api.bots(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_tasks_status ON odin_api.bot_tasks(owner_id,status,priority DESC,created_at);

CREATE TABLE IF NOT EXISTS odin_api.bot_task_events (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  cursor bigint GENERATED ALWAYS AS IDENTITY,
  task_id uuid NOT NULL,
  type text NOT NULL CHECK(type ~ '^[a-z0-9_.-]{1,80}$'),
  data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,cursor),
  FOREIGN KEY(owner_id,task_id) REFERENCES odin_api.bot_tasks(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_events_replay ON odin_api.bot_task_events(owner_id,task_id,cursor);

CREATE TABLE IF NOT EXISTS odin_api.bot_automations (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  bot_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  instruction text NOT NULL CHECK(length(instruction) BETWEEN 1 AND 4000),
  trigger_type text NOT NULL CHECK(trigger_type IN ('schedule','event','webhook','condition','dependency','retry','app_event')),
  trigger jsonb NOT NULL CHECK(jsonb_typeof(trigger)='object' AND octet_length(trigger::text)<=30000),
  action jsonb NOT NULL CHECK(jsonb_typeof(action)='object' AND octet_length(action::text)<=30000),
  notification_policy text NOT NULL DEFAULT 'important' CHECK(notification_policy IN ('critical','important','all','digest','silent')),
  budget jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(budget)='object' AND octet_length(budget::text)<=20000),
  enabled boolean NOT NULL DEFAULT true,
  next_wakeup_at timestamptz,
  last_fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,bot_id) REFERENCES odin_api.bots(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_automations_due ON odin_api.bot_automations(owner_id,next_wakeup_at) WHERE enabled;

CREATE TABLE IF NOT EXISTS odin_api.bot_inbox (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  task_id uuid,
  category text NOT NULL CHECK(category IN ('approval','information','important','critical')),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  action jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(action)='object' AND octet_length(action::text)<=20000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,task_id) REFERENCES odin_api.bot_tasks(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_inbox_unread ON odin_api.bot_inbox(owner_id,created_at DESC) WHERE read_at IS NULL;

-- Cross-tenant scheduler index. It deliberately contains no goal, prompt, tool payload, credential or artifact.
CREATE TABLE IF NOT EXISTS odin_control.bot_wakeups (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('task','automation')),
  target_id uuid NOT NULL,
  dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 240),
  available_at timestamptz NOT NULL,
  priority smallint NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  UNIQUE(owner_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS odin_bot_wakeups_due ON odin_control.bot_wakeups(available_at,priority DESC,created_at)
  WHERE lease_expires_at IS NULL;
REVOKE ALL ON odin_control.bot_wakeups FROM PUBLIC;

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['bots','bot_tasks','bot_task_events','bot_automations','bot_inbox'] LOOP
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
GRANT USAGE ON SEQUENCE odin_api.bot_task_events_cursor_seq TO odin_runtime;

CREATE OR REPLACE FUNCTION odin_control.enqueue_bot_wakeup(
  p_kind text,
  p_target uuid,
  p_available timestamptz,
  p_dedupe text,
  p_priority integer DEFAULT 50
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_owner text := NULLIF(current_setting('odin.user_id', true), '');
  v_id uuid := gen_random_uuid();
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Missing Odin actor'; END IF;
  IF p_kind NOT IN ('task','automation') THEN RAISE EXCEPTION 'Invalid wakeup kind'; END IF;
  IF p_kind='task' AND NOT EXISTS (
    SELECT 1 FROM odin_api.bot_tasks WHERE owner_id=v_owner AND id=p_target
  ) THEN RAISE EXCEPTION 'Task not owned by actor'; END IF;
  IF p_kind='automation' AND NOT EXISTS (
    SELECT 1 FROM odin_api.bot_automations WHERE owner_id=v_owner AND id=p_target
  ) THEN RAISE EXCEPTION 'Automation not owned by actor'; END IF;
  INSERT INTO odin_control.bot_wakeups(owner_id,id,kind,target_id,dedupe_key,available_at,priority)
  VALUES(v_owner,v_id,p_kind,p_target,p_dedupe,p_available,GREATEST(0,LEAST(100,p_priority)))
  ON CONFLICT(owner_id,dedupe_key) DO UPDATE
    SET available_at=LEAST(odin_control.bot_wakeups.available_at,excluded.available_at),
        priority=GREATEST(odin_control.bot_wakeups.priority,excluded.priority)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;
REVOKE ALL ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) TO odin_runtime;

CREATE OR REPLACE FUNCTION odin_control.cleanup_bot_wakeup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  DELETE FROM odin_control.bot_wakeups
  WHERE owner_id=OLD.owner_id AND target_id=OLD.id
    AND kind=CASE WHEN TG_TABLE_NAME='bot_tasks' THEN 'task' ELSE 'automation' END;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION odin_control.cleanup_bot_wakeup() FROM PUBLIC;

DROP TRIGGER IF EXISTS bot_task_wakeup_cleanup ON odin_api.bot_tasks;
CREATE TRIGGER bot_task_wakeup_cleanup AFTER DELETE ON odin_api.bot_tasks
FOR EACH ROW EXECUTE FUNCTION odin_control.cleanup_bot_wakeup();
DROP TRIGGER IF EXISTS bot_automation_wakeup_cleanup ON odin_api.bot_automations;
CREATE TRIGGER bot_automation_wakeup_cleanup AFTER DELETE ON odin_api.bot_automations
FOR EACH ROW EXECUTE FUNCTION odin_control.cleanup_bot_wakeup();

DO $grant_worker$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='odin_prod_app') THEN
    GRANT USAGE ON SCHEMA odin_control TO odin_prod_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON odin_control.bot_wakeups TO odin_prod_app;
  END IF;
END $grant_worker$;

ALTER DEFAULT PRIVILEGES IN SCHEMA odin_api REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA odin_control REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
