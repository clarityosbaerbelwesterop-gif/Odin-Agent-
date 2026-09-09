-- Exact production reconciliation applied on 2026-09-09 after PR #42.
-- The predecessor github/oauth tables were verified empty before this migration,
-- renamed for preservation, and replaced with the canonical P-R schema expected
-- by src/chat/product.ts. Do not re-run blindly; this file records applied state.

BEGIN;

ALTER TABLE odin_api.github_connections RENAME TO github_connections_legacy_v003;
ALTER TABLE odin_api.oauth_states RENAME TO oauth_states_legacy_v003;

CREATE TABLE odin_api.accounts (
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

CREATE TABLE odin_api.credentials (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','openrouter','nvidia','google')),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 20 AND 20000),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{8}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,provider)
);

CREATE TABLE odin_api.github_connections (
  owner_id text PRIMARY KEY DEFAULT odin_api.actor(),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 20 AND 20000),
  login text NOT NULL CHECK (length(login) BETWEEN 1 AND 100),
  repository text,
  default_branch text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE odin_api.oauth_states (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY(owner_id,state_hash)
);

CREATE TABLE odin_api.stripe_events (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  event_id text NOT NULL,
  created bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,event_id)
);

ALTER TABLE odin_api.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE odin_api.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON odin_api.accounts TO odin_runtime
  USING(owner_id=(SELECT odin_api.actor()))
  WITH CHECK(owner_id=(SELECT odin_api.actor()));

ALTER TABLE odin_api.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE odin_api.credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON odin_api.credentials TO odin_runtime
  USING(owner_id=(SELECT odin_api.actor()))
  WITH CHECK(owner_id=(SELECT odin_api.actor()));

ALTER TABLE odin_api.github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE odin_api.github_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON odin_api.github_connections TO odin_runtime
  USING(owner_id=(SELECT odin_api.actor()))
  WITH CHECK(owner_id=(SELECT odin_api.actor()));

ALTER TABLE odin_api.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE odin_api.oauth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON odin_api.oauth_states TO odin_runtime
  USING(owner_id=(SELECT odin_api.actor()))
  WITH CHECK(owner_id=(SELECT odin_api.actor()));

ALTER TABLE odin_api.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE odin_api.stripe_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON odin_api.stripe_events TO odin_runtime
  USING(owner_id=(SELECT odin_api.actor()))
  WITH CHECK(owner_id=(SELECT odin_api.actor()));

REVOKE ALL ON odin_api.accounts,odin_api.credentials,odin_api.github_connections,odin_api.oauth_states,odin_api.stripe_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON odin_api.accounts,odin_api.credentials,odin_api.github_connections,odin_api.oauth_states,odin_api.stripe_events TO odin_runtime;

COMMIT;
