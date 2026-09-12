-- Coding tasks request reversible workspace writes by default.
-- Runtime autonomy remains the authority: executor.ts still requires autonomy level >= 3.
-- An explicitly supplied workspaceWrites=false remains respected.

CREATE OR REPLACE FUNCTION odin_control.apply_bot_coding_write_intent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.permissions := COALESCE(NEW.permissions, '{}'::jsonb);

  IF NEW.mode = 'coding' AND NOT (NEW.permissions ? 'workspaceWrites') THEN
    NEW.permissions := jsonb_set(NEW.permissions, '{workspaceWrites}', 'true'::jsonb, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bot_tasks_coding_write_intent ON odin_api.bot_tasks;
CREATE TRIGGER bot_tasks_coding_write_intent
BEFORE INSERT OR UPDATE OF mode, permissions ON odin_api.bot_tasks
FOR EACH ROW
EXECUTE FUNCTION odin_control.apply_bot_coding_write_intent();

-- Reconcile existing non-terminal coding work created before this migration, but do not
-- override an explicit false grant.
UPDATE odin_api.bot_tasks
SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{workspaceWrites}', 'true'::jsonb, true),
    updated_at = now()
WHERE mode = 'coding'
  AND status NOT IN ('done', 'cancelled', 'failed', 'blocked')
  AND NOT (COALESCE(permissions, '{}'::jsonb) ? 'workspaceWrites');
