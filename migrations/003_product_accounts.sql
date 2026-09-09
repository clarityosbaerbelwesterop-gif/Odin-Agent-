-- P-R production schema. This migration is recorded here for schema parity.
-- Production was migrated before this changeset; operators must not blindly re-run it.
BEGIN;

CREATE TABLE IF NOT EXISTS odin_api.accounts (
  owner_id text PRIMARY KEY DEFAULT odin_api.actor(),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','ultra')),
  subscription_status text NOT NULL DEFAULT 'free',
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  stripe_event_created bigint NOT NULL DEFAULT 0,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  default_model text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS odin_api.credentials (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','openrouter','nvidia','google')),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 20 AND 20000),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{8}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,provider)
);
CREATE TABLE IF NOT EXISTS odin_api.github_connections (
  owner_id text PRIMARY KEY DEFAULT odin_api.actor(),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 20 AND 20000),
  login text NOT NULL CHECK (length(login) BETWEEN 1 AND 100),
  repository text,
  default_branch text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS odin_api.oauth_states (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY(owner_id,state_hash)
);
CREATE TABLE IF NOT EXISTS odin_api.stripe_events (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  event_id text NOT NULL,
  created bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,event_id)
);

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['accounts','credentials','github_connections','oauth_states','stripe_events'] LOOP
    EXECUTE format('ALTER TABLE odin_api.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE odin_api.%I FORCE ROW LEVEL SECURITY',tab);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='odin_api' AND tablename=tab AND policyname='owner_isolation') THEN
      EXECUTE format('CREATE POLICY owner_isolation ON odin_api.%I TO odin_runtime USING(owner_id=(SELECT odin_api.actor())) WITH CHECK(owner_id=(SELECT odin_api.actor()))',tab);
    END IF;
    EXECUTE format('REVOKE ALL ON odin_api.%I FROM PUBLIC',tab);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON odin_api.%I TO odin_runtime',tab);
  END LOOP;
END $policies$;
COMMIT;
