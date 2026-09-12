-- Restore the least-privilege namespace grant required by the authenticated runtime
-- to call the SECURITY DEFINER bot wakeup enqueue function.
--
-- The runtime role intentionally receives no table privileges in odin_control.
BEGIN;

REVOKE ALL ON SCHEMA odin_control FROM PUBLIC;
GRANT USAGE ON SCHEMA odin_control TO odin_runtime;

REVOKE ALL ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) TO odin_runtime;

COMMIT;
