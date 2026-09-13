-- PRODUCT M5 verified Neon cleanup.
-- M004 preserved two predecessor tables after proving them empty. By M5 the canonical
-- replacements have carried production traffic for multiple milestones. This cleanup
-- fails closed if either predecessor receives data before this migration is applied.
BEGIN;

DO $cleanup$
BEGIN
  IF to_regclass('odin_api.github_connections_legacy_v003') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM odin_api.github_connections_legacy_v003 LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop non-empty github_connections_legacy_v003';
    END IF;
  END IF;

  IF to_regclass('odin_api.oauth_states_legacy_v003') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM odin_api.oauth_states_legacy_v003 LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop non-empty oauth_states_legacy_v003';
    END IF;
  END IF;
END $cleanup$;

-- Intentionally no CASCADE: any newly introduced dependency must stop the migration
-- and be reviewed instead of being removed implicitly.
DROP TABLE IF EXISTS odin_api.github_connections_legacy_v003;
DROP TABLE IF EXISTS odin_api.oauth_states_legacy_v003;

COMMIT;
