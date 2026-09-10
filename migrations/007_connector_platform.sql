-- Odin Connector Platform: user-owned OAuth/MCP connections, one-time auth transactions and tool cache.
-- Secret material is AES-GCM ciphertext created by the existing server CredentialVault.
BEGIN;

CREATE TABLE IF NOT EXISTS odin_api.connector_connections (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  connector_id text NOT NULL CHECK(connector_id ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  endpoint text CHECK(endpoint IS NULL OR length(endpoint) BETWEEN 8 AND 2000),
  runtime text NOT NULL CHECK(runtime IN ('direct_mcp','vercel_connect','custom_mcp')),
  auth_mode text NOT NULL CHECK(auth_mode IN ('oauth','api_key','none')),
  status text NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','needs_authorization','error')),
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_type text CHECK(token_type IS NULL OR length(token_type) BETWEEN 1 AND 40),
  token_expires_at timestamptz,
  scopes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(scopes)='array' AND octet_length(scopes::text)<=20000),
  issuer text CHECK(issuer IS NULL OR length(issuer) BETWEEN 8 AND 2000),
  resource text CHECK(resource IS NULL OR length(resource) BETWEEN 8 AND 2000),
  client_id text CHECK(client_id IS NULL OR length(client_id) BETWEEN 1 AND 2000),
  client_secret_ciphertext text,
  vercel_connector_uid text CHECK(vercel_connector_uid IS NULL OR length(vercel_connector_uid) BETWEEN 1 AND 300),
  last_verified_at timestamptz,
  last_error_code text CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id)
);
CREATE INDEX IF NOT EXISTS odin_connector_connections_provider
  ON odin_api.connector_connections(owner_id,connector_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS odin_api.connector_oauth_transactions (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  state_hash text NOT NULL CHECK(state_hash ~ '^[a-f0-9]{64}$'),
  connection_id uuid NOT NULL,
  connector_id text NOT NULL CHECK(connector_id ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  endpoint text NOT NULL CHECK(length(endpoint) BETWEEN 8 AND 2000),
  resource text NOT NULL CHECK(length(resource) BETWEEN 8 AND 2000),
  issuer text NOT NULL CHECK(length(issuer) BETWEEN 8 AND 2000),
  authorization_endpoint text NOT NULL CHECK(length(authorization_endpoint) BETWEEN 8 AND 2000),
  token_endpoint text NOT NULL CHECK(length(token_endpoint) BETWEEN 8 AND 2000),
  client_id text NOT NULL CHECK(length(client_id) BETWEEN 1 AND 2000),
  client_secret_ciphertext text,
  verifier_ciphertext text NOT NULL,
  redirect_uri text NOT NULL CHECK(length(redirect_uri) BETWEEN 8 AND 2000),
  scopes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(scopes)='array' AND octet_length(scopes::text)<=20000),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,state_hash),
  FOREIGN KEY(owner_id,connection_id) REFERENCES odin_api.connector_connections(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_connector_oauth_expiry
  ON odin_api.connector_oauth_transactions(owner_id,expires_at);

CREATE TABLE IF NOT EXISTS odin_api.connector_tool_cache (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  connection_id uuid NOT NULL,
  remote_name text NOT NULL CHECK(length(remote_name) BETWEEN 1 AND 200),
  tool_name text NOT NULL CHECK(length(tool_name) BETWEEN 1 AND 220),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  operation text NOT NULL CHECK(operation IN ('execute','read','search','write')),
  risk_class text NOT NULL CHECK(risk_class IN ('low','medium','high')),
  side_effecting boolean NOT NULL,
  requires_approval boolean NOT NULL,
  input_schema jsonb NOT NULL CHECK(jsonb_typeof(input_schema)='object' AND octet_length(input_schema::text)<=200000),
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id,connection_id,remote_name),
  UNIQUE(owner_id,tool_name),
  FOREIGN KEY(owner_id,connection_id) REFERENCES odin_api.connector_connections(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_connector_tool_cache_expiry
  ON odin_api.connector_tool_cache(owner_id,connection_id,expires_at);

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['connector_connections','connector_oauth_transactions','connector_tool_cache'] LOOP
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

ALTER DEFAULT PRIVILEGES IN SCHEMA odin_api REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
