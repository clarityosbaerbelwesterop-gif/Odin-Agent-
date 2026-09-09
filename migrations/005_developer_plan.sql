-- Phase S: extend the canonical hosted-product plan enum with Developer.
-- Apply through a tested Neon migration branch before production promotion.
BEGIN;

ALTER TABLE odin_api.accounts
  DROP CONSTRAINT IF EXISTS accounts_plan_check;

ALTER TABLE odin_api.accounts
  ADD CONSTRAINT accounts_plan_check
  CHECK (plan IN ('free','pro','developer','ultra'));

COMMIT;
