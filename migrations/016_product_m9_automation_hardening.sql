-- PRODUCT M9: harden Automation wake lifecycle without exposing control-plane rows.
-- The authenticated runtime may clear only wakeups belonging to one of its own automations.
BEGIN;

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
