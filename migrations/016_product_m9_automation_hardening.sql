-- PRODUCT M9: harden Automation occurrence identity and wake lifecycle.
-- The runtime never receives direct table authority over odin_control.
BEGIN;

-- available_at is mutable retry/backoff timing. scheduled_at is immutable occurrence identity.
ALTER TABLE odin_control.bot_wakeups
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
UPDATE odin_control.bot_wakeups
SET scheduled_at=available_at
WHERE scheduled_at IS NULL;
ALTER TABLE odin_control.bot_wakeups
  ALTER COLUMN scheduled_at SET NOT NULL;

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

  INSERT INTO odin_control.bot_wakeups(
    owner_id,id,kind,target_id,dedupe_key,available_at,scheduled_at,priority
  )
  VALUES(
    v_owner,v_id,p_kind,p_target,p_dedupe,p_available,p_available,
    GREATEST(0,LEAST(100,p_priority))
  )
  ON CONFLICT(owner_id,dedupe_key) DO UPDATE
    SET available_at=LEAST(odin_control.bot_wakeups.available_at,excluded.available_at),
        priority=GREATEST(odin_control.bot_wakeups.priority,excluded.priority)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;
REVOKE ALL ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) TO odin_runtime;

-- Pause/resume may clear stale automation wakes, but only through actor-checked authority.
CREATE OR REPLACE FUNCTION odin_control.clear_bot_automation_wakeups(p_target uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_owner text := NULLIF(current_setting('odin.user_id', true), '');
  v_deleted integer := 0;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Missing Odin actor'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM odin_api.bot_automations
    WHERE owner_id=v_owner AND id=p_target
  ) THEN
    RAISE EXCEPTION 'Automation not owned by actor';
  END IF;

  DELETE FROM odin_control.bot_wakeups
  WHERE owner_id=v_owner AND kind='automation' AND target_id=p_target;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$fn$;
REVOKE ALL ON FUNCTION odin_control.clear_bot_automation_wakeups(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odin_control.clear_bot_automation_wakeups(uuid) TO odin_runtime;

COMMIT;
