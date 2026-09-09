BEGIN;

CREATE TABLE IF NOT EXISTS odin_api.user_preferences (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  selected_model_id text CHECK (selected_model_id IS NULL OR length(selected_model_id) BETWEEN 1 AND 180),
  selected_repository text CHECK (selected_repository IS NULL OR length(selected_repository) BETWEEN 3 AND 300),
  selected_repository_id bigint CHECK (selected_repository_id IS NULL OR selected_repository_id > 0),
  selected_repository_branch text CHECK (selected_repository_branch IS NULL OR length(selected_repository_branch) BETWEEN 1 AND 255),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id)
);

CREATE TABLE IF NOT EXISTS odin_api.github_connections (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  github_user_id bigint NOT NULL CHECK (github_user_id > 0),
  github_login text NOT NULL CHECK (length(github_login) BETWEEN 1 AND 100),
  token_ciphertext text NOT NULL CHECK (length(token_ciphertext) BETWEEN 40 AND 12000),
  token_fingerprint text NOT NULL CHECK (token_fingerprint ~ '^[a-f0-9]{64}$'),
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id)
);

CREATE TABLE IF NOT EXISTS odin_api.oauth_states (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 8 AND 500),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,state_hash)
);

CREATE TABLE IF NOT EXISTS odin_api.provider_credentials (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','openrouter','nvidia','gemini')),
  secret_ciphertext text NOT NULL CHECK (length(secret_ciphertext) BETWEEN 40 AND 16000),
  secret_fingerprint text NOT NULL CHECK (secret_fingerprint ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=12000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,provider)
);

CREATE TABLE IF NOT EXISTS odin_api.subscriptions (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','ultra')),
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  stripe_customer_id text CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text CHECK (stripe_subscription_id IS NULL OR stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  price_id text CHECK (price_id IS NULL OR price_id ~ '^price_[A-Za-z0-9]+$'),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  last_event_created bigint NOT NULL DEFAULT 0 CHECK (last_event_created >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS odin_subscription_customer_unique
  ON odin_api.subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS odin_subscription_id_unique
  ON odin_api.subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS odin_api.billing_events (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  event_id text NOT NULL CHECK (event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 120),
  event_created bigint NOT NULL CHECK (event_created >= 0),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,event_id)
);

CREATE TABLE IF NOT EXISTS odin_api.usage_counters (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  period_key text NOT NULL CHECK (period_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  scope text NOT NULL CHECK (scope ~ '^[a-z0-9_.:-]{1,100}$'),
  hits bigint NOT NULL DEFAULT 0 CHECK (hits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,period_key,scope)
);

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'user_preferences','github_connections','oauth_states','provider_credentials',
    'subscriptions','billing_events','usage_counters'
  ] LOOP
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

COMMIT;
