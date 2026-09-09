import type { NeonActorDatabase } from "./neon-database.js";
import type { CredentialVault } from "./credential-vault.js";
import { ChatError, type ProductPlan } from "./types.js";

export type ProviderId = "openai" | "anthropic" | "openrouter" | "nvidia" | "gemini";
export const PROVIDERS: readonly ProviderId[] = [
  "openai",
  "anthropic",
  "openrouter",
  "nvidia",
  "gemini",
];

export interface ProductPreferences {
  readonly selectedModelId: string | null;
  readonly selectedRepository: string | null;
  readonly selectedRepositoryId: number | null;
  readonly selectedRepositoryBranch: string | null;
}

export interface GitHubConnectionState {
  readonly connected: boolean;
  readonly login: string | null;
  readonly scopes: readonly string[];
  readonly connectedAt: string | null;
}

export interface ProviderConnectionState {
  readonly provider: ProviderId;
  readonly connected: boolean;
  readonly verifiedAt: string | null;
  readonly fingerprintSuffix: string | null;
}

export interface SubscriptionState {
  readonly plan: ProductPlan;
  readonly status: string;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly priceId: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
}

function assertProvider(value: string): ProviderId {
  if (!PROVIDERS.includes(value as ProviderId))
    throw new ChatError("INVALID_PROVIDER", "Unknown model provider.");
  return value as ProviderId;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export class ProductStore {
  constructor(
    readonly db: NeonActorDatabase,
    readonly vault: CredentialVault,
  ) {}

  async preferences(): Promise<ProductPreferences> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT selected_model_id,selected_repository,selected_repository_id,selected_repository_branch FROM odin_api.user_preferences LIMIT 1",
        )
      ).rows[0] as Record<string, unknown> | undefined;
      return {
        selectedModelId: nullableString(row?.selected_model_id),
        selectedRepository: nullableString(row?.selected_repository),
        selectedRepositoryId: nullableNumber(row?.selected_repository_id),
        selectedRepositoryBranch: nullableString(row?.selected_repository_branch),
      };
    });
  }

  async savePreferences(input: Partial<ProductPreferences>): Promise<ProductPreferences> {
    const current = await this.preferences();
    const next: ProductPreferences = {
      selectedModelId: input.selectedModelId === undefined ? current.selectedModelId : input.selectedModelId,
      selectedRepository:
        input.selectedRepository === undefined ? current.selectedRepository : input.selectedRepository,
      selectedRepositoryId:
        input.selectedRepositoryId === undefined ? current.selectedRepositoryId : input.selectedRepositoryId,
      selectedRepositoryBranch:
        input.selectedRepositoryBranch === undefined
          ? current.selectedRepositoryBranch
          : input.selectedRepositoryBranch,
    };
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO odin_api.user_preferences(selected_model_id,selected_repository,selected_repository_id,selected_repository_branch,updated_at)
         VALUES($1,$2,$3,$4,now())
         ON CONFLICT(owner_id) DO UPDATE SET selected_model_id=excluded.selected_model_id,
           selected_repository=excluded.selected_repository,selected_repository_id=excluded.selected_repository_id,
           selected_repository_branch=excluded.selected_repository_branch,updated_at=now()`,
        [
          next.selectedModelId,
          next.selectedRepository,
          next.selectedRepositoryId,
          next.selectedRepositoryBranch,
        ],
      );
    });
    return next;
  }

  async providerConnections(): Promise<readonly ProviderConnectionState[]> {
    return this.db.transaction(async (client) => {
      const rows = (
        await client.query(
          "SELECT provider,verified_at,secret_fingerprint FROM odin_api.provider_credentials ORDER BY provider",
        )
      ).rows as Record<string, unknown>[];
      const found = new Map(
        rows.map((row) => [
          assertProvider(String(row.provider)),
          {
            provider: assertProvider(String(row.provider)),
            connected: true,
            verifiedAt:
              row.verified_at instanceof Date
                ? row.verified_at.toISOString()
                : nullableString(row.verified_at),
            fingerprintSuffix:
              typeof row.secret_fingerprint === "string"
                ? row.secret_fingerprint.slice(-8)
                : null,
          } satisfies ProviderConnectionState,
        ]),
      );
      return PROVIDERS.map(
        (provider) =>
          found.get(provider) ?? {
            provider,
            connected: false,
            verifiedAt: null,
            fingerprintSuffix: null,
          },
      );
    });
  }

  async saveProviderCredential(
    providerValue: string,
    secret: string,
    metadata: Record<string, unknown> = {},
  ): Promise<ProviderConnectionState> {
    const provider = assertProvider(providerValue);
    const sealed = this.vault.seal(secret);
    const serialized = JSON.stringify(metadata);
    if (Buffer.byteLength(serialized) > 12_000)
      throw new ChatError("INVALID_CREDENTIAL_METADATA", "Credential metadata is too large.");
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO odin_api.provider_credentials(provider,secret_ciphertext,secret_fingerprint,verified_at,metadata,updated_at)
         VALUES($1,$2,$3,now(),$4::jsonb,now())
         ON CONFLICT(owner_id,provider) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,
           secret_fingerprint=excluded.secret_fingerprint,verified_at=excluded.verified_at,
           metadata=excluded.metadata,updated_at=now()`,
        [provider, sealed.ciphertext, sealed.fingerprint, serialized],
      );
    });
    return {
      provider,
      connected: true,
      verifiedAt: new Date().toISOString(),
      fingerprintSuffix: sealed.fingerprint.slice(-8),
    };
  }

  async providerCredential(providerValue: string): Promise<string | null> {
    const provider = assertProvider(providerValue);
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT secret_ciphertext FROM odin_api.provider_credentials WHERE provider=$1 LIMIT 1",
          [provider],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (typeof row?.secret_ciphertext !== "string") return null;
      return this.vault.open(row.secret_ciphertext);
    });
  }

  async deleteProviderCredential(providerValue: string): Promise<void> {
    const provider = assertProvider(providerValue);
    await this.db.transaction(async (client) => {
      await client.query("DELETE FROM odin_api.provider_credentials WHERE provider=$1", [provider]);
    });
  }

  async githubConnection(): Promise<GitHubConnectionState> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT github_login,scopes,connected_at FROM odin_api.github_connections LIMIT 1",
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row)
        return { connected: false, login: null, scopes: [], connectedAt: null };
      return {
        connected: true,
        login: nullableString(row.github_login),
        scopes: Array.isArray(row.scopes)
          ? row.scopes.filter((scope): scope is string => typeof scope === "string")
          : [],
        connectedAt:
          row.connected_at instanceof Date
            ? row.connected_at.toISOString()
            : nullableString(row.connected_at),
      };
    });
  }

  async saveGitHubConnection(input: {
    userId: number;
    login: string;
    token: string;
    scopes: readonly string[];
  }): Promise<void> {
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 || !/^[A-Za-z0-9-]{1,100}$/u.test(input.login))
      throw new ChatError("GITHUB_IDENTITY", "GitHub returned an invalid account identity.", 502);
    const sealed = this.vault.seal(input.token);
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO odin_api.github_connections(github_user_id,github_login,token_ciphertext,token_fingerprint,scopes,connected_at,updated_at)
         VALUES($1,$2,$3,$4,$5,now(),now())
         ON CONFLICT(owner_id) DO UPDATE SET github_user_id=excluded.github_user_id,
           github_login=excluded.github_login,token_ciphertext=excluded.token_ciphertext,
           token_fingerprint=excluded.token_fingerprint,scopes=excluded.scopes,updated_at=now()`,
        [input.userId, input.login, sealed.ciphertext, sealed.fingerprint, [...input.scopes]],
      );
    });
  }

  async githubToken(): Promise<string | null> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query("SELECT token_ciphertext FROM odin_api.github_connections LIMIT 1")
      ).rows[0] as Record<string, unknown> | undefined;
      return typeof row?.token_ciphertext === "string" ? this.vault.open(row.token_ciphertext) : null;
    });
  }

  async disconnectGitHub(): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query("DELETE FROM odin_api.github_connections");
      await client.query(
        "UPDATE odin_api.user_preferences SET selected_repository=NULL,selected_repository_id=NULL,selected_repository_branch=NULL,updated_at=now()",
      );
    });
  }

  async subscription(): Promise<SubscriptionState> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT plan,status,stripe_customer_id,stripe_subscription_id,price_id,current_period_end,cancel_at_period_end FROM odin_api.subscriptions LIMIT 1",
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row)
        return {
          plan: "free",
          status: "free",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          priceId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        };
      const plan = String(row.plan);
      if (!(["free", "pro", "ultra"] as const).includes(plan as ProductPlan))
        throw new ChatError("BILLING_STATE", "Stored subscription state is invalid.", 500);
      return {
        plan: plan as ProductPlan,
        status: String(row.status),
        stripeCustomerId: nullableString(row.stripe_customer_id),
        stripeSubscriptionId: nullableString(row.stripe_subscription_id),
        priceId: nullableString(row.price_id),
        currentPeriodEnd:
          row.current_period_end instanceof Date
            ? row.current_period_end.toISOString()
            : nullableString(row.current_period_end),
        cancelAtPeriodEnd: row.cancel_at_period_end === true,
      };
    });
  }
}
