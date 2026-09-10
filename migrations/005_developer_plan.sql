-- S-U four-tier product contract. Safe to re-run after migration 003/004.
BEGIN;

DO $migration$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='odin_api' AND t.relname='accounts' AND c.contype='c'
    AND pg_get_constraintdef(c.oid) LIKE '%plan%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE odin_api.accounts DROP CONSTRAINT %I', constraint_name);
  END IF;
END $migration$;

ALTER TABLE odin_api.accounts
  ADD CONSTRAINT accounts_plan_check CHECK (plan IN ('free','pro','developer','ultra'));

COMMIT;
