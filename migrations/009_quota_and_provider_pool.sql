BEGIN;

CREATE TABLE IF NOT EXISTS odin_api.plan_entitlements (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  plan text NOT NULL CHECK(plan IN ('free','pro','developer','ultra')),
  monthly_ocu bigint NOT NULL CHECK(monthly_ocu >= 0),
  daily_ocu bigint NOT NULL CHECK(daily_ocu >= 0),
  max_concurrent_missions integer NOT NULL CHECK(max_concurrent_missions >= 0),
  bot_enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, plan)
);

CREATE TABLE IF NOT EXISTS odin_api.usage_periods (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  plan text NOT NULL CHECK(plan IN ('free','pro','developer','ultra')),
  allowance_ocus bigint NOT NULL CHECK(allowance_ocus >= 0),
  consumed_ocus bigint NOT NULL DEFAULT 0 CHECK(consumed_ocus >= 0),
  reserved_ocus bigint NOT NULL DEFAULT 0 CHECK(reserved_ocus >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, period_start),
  CHECK(period_end > period_start)
);

CREATE TABLE IF NOT EXISTS odin_api.quota_reservations (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 220),
  mission_id text NOT NULL CHECK(length(mission_id) BETWEEN 1 AND 220),
  period_start date NOT NULL,
  mode text NOT NULL CHECK(mode IN ('chat','thinking','research','coding','ultra')),
  model_id text NOT NULL CHECK(length(model_id) BETWEEN 1 AND 160),
  estimated_ocus bigint NOT NULL CHECK(estimated_ocus > 0),
  actual_ocus bigint CHECK(actual_ocus IS NULL OR actual_ocus >= 0),
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  PRIMARY KEY(owner_id, request_id)
);

CREATE TABLE IF NOT EXISTS odin_api.usage_ledger (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 220),
  mission_id text NOT NULL CHECK(length(mission_id) BETWEEN 1 AND 220),
  plan text NOT NULL CHECK(plan IN ('free','pro','developer','ultra')),
  mode text NOT NULL CHECK(mode IN ('chat','thinking','research','coding','ultra')),
  model_id text NOT NULL CHECK(length(model_id) BETWEEN 1 AND 160),
  provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),
  input_tokens bigint NOT NULL CHECK(input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK(output_tokens >= 0),
  compute_units bigint NOT NULL CHECK(compute_units > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, request_id)
);

CREATE TABLE IF NOT EXISTS odin_api.provider_key_health (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  key_slot text NOT NULL CHECK(length(key_slot) BETWEEN 1 AND 80),
  model_id text NOT NULL CHECK(length(model_id) BETWEEN 1 AND 160),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_failures >= 0),
  cooldown_until timestamptz,
  last_status text NOT NULL DEFAULT 'unknown' CHECK(length(last_status) BETWEEN 1 AND 80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, key_slot, model_id)
);

CREATE INDEX IF NOT EXISTS usage_ledger_owner_created_idx
  ON odin_api.usage_ledger(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quota_reservations_owner_status_idx
  ON odin_api.quota_reservations(owner_id, status, expires_at);

DO $tables$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'plan_entitlements',
    'usage_periods',
    'quota_reservations',
    'usage_ledger',
    'provider_key_health'
  ] LOOP
    EXECUTE format('ALTER TABLE odin_api.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE odin_api.%I FORCE ROW LEVEL SECURITY', tab);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='odin_api' AND tablename=tab AND policyname='owner_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY owner_isolation ON odin_api.%I TO odin_runtime USING(owner_id=(SELECT odin_api.actor())) WITH CHECK(owner_id=(SELECT odin_api.actor()))',
        tab
      );
    END IF;
    EXECUTE format('REVOKE ALL ON odin_api.%I FROM PUBLIC', tab);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON odin_api.%I TO odin_runtime', tab);
  END LOOP;
END $tables$;

COMMIT;
