import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { ActorDatabase } from "./neon-database.js";
import { ChatError } from "./types.js";

export const PROVIDERS = ["openai", "anthropic", "openrouter", "nvidia", "google"] as const;
export type ProductProvider = (typeof PROVIDERS)[number];
export type Plan = "free" | "pro" | "ultra";

export interface ProductAccount {
  plan: Plan;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  defaultModel: string | null;
}

export class CredentialVault {
  readonly #key: Buffer | undefined;
  constructor(encoded: string | undefined) {
    if (!encoded) return;
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32)
      throw new ChatError("CREDENTIAL_CONFIG", "Credential encryption key must be 32 bytes.", 503);
    this.#key = key;
  }
  seal(value: string): { ciphertext: string; fingerprint: string } {
    if (!this.#key)
      throw new ChatError("CREDENTIAL_CONFIG", "Credential encryption is not configured.", 503);
    if (!value.trim() || value.length > 16000 || /[\r\n]/u.test(value))
      throw new ChatError("INVALID_CREDENTIAL", "Enter a valid provider credential.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"),
      fingerprint: createHash("sha256").update(value).digest("hex").slice(-8),
    };
  }
  open(value: string): string {
    if (!this.#key)
      throw new ChatError("CREDENTIAL_CONFIG", "Credential encryption is not configured.", 503);
    const data = Buffer.from(value, "base64url");
    if (data.length < 29)
      throw new ChatError("CREDENTIAL_INVALID", "Stored credential is invalid.", 500);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
    } catch {
      throw new ChatError("CREDENTIAL_INVALID", "Stored credential could not be decrypted.", 500);
    }
  }
}

export class ProductStore {
  constructor(
    readonly db: ActorDatabase,
    readonly vault: CredentialVault,
  ) {}
  async account(): Promise<ProductAccount> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query(
          "INSERT INTO odin_api.accounts DEFAULT VALUES ON CONFLICT(owner_id) DO UPDATE SET updated_at=odin_api.accounts.updated_at RETURNING plan,subscription_status,cancel_at_period_end,default_model",
        )
      ).rows[0];
      return {
        plan: row.plan,
        subscriptionStatus: row.subscription_status,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        defaultModel: row.default_model,
      };
    });
  }
  async credentials() {
    return this.db.transaction(async (c) =>
      (
        await c.query(
          "SELECT provider,fingerprint,updated_at FROM odin_api.credentials ORDER BY provider",
        )
      ).rows.map((r) => ({
        provider: r.provider,
        fingerprint: r.fingerprint,
        updatedAt: new Date(r.updated_at).toISOString(),
      })),
    );
  }
  async credential(provider: ProductProvider): Promise<string | undefined> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query("SELECT ciphertext FROM odin_api.credentials WHERE provider=$1", [provider])
      ).rows[0];
      return row ? this.vault.open(row.ciphertext) : undefined;
    });
  }
  async saveCredential(provider: ProductProvider, value: string) {
    const sealed = this.vault.seal(value);
    await this.db.transaction(async (c) => {
      await c.query(
        "INSERT INTO odin_api.credentials(provider,ciphertext,fingerprint) VALUES($1,$2,$3) ON CONFLICT(owner_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,fingerprint=excluded.fingerprint,updated_at=now()",
        [provider, sealed.ciphertext, sealed.fingerprint],
      );
    });
    return { provider, fingerprint: sealed.fingerprint };
  }
  async deleteCredential(provider: ProductProvider) {
    await this.db.transaction(async (c) => {
      await c.query("DELETE FROM odin_api.credentials WHERE provider=$1", [provider]);
    });
  }
  async github() {
    return this.db.transaction(async (c) => {
      const r = (
        await c.query(
          "SELECT login,repository,default_branch,updated_at FROM odin_api.github_connections",
        )
      ).rows[0];
      return r
        ? {
            connected: true,
            login: r.login,
            repository: r.repository,
            defaultBranch: r.default_branch,
            updatedAt: new Date(r.updated_at).toISOString(),
          }
        : { connected: false };
    });
  }
  async githubToken() {
    return this.db.transaction(async (c) => {
      const r = (await c.query("SELECT ciphertext FROM odin_api.github_connections")).rows[0];
      return r ? this.vault.open(r.ciphertext) : undefined;
    });
  }
  async saveGithub(token: string, login: string) {
    const sealed = this.vault.seal(token);
    await this.db.transaction(async (c) => {
      await c.query(
        "INSERT INTO odin_api.github_connections(ciphertext,login) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET ciphertext=excluded.ciphertext,login=excluded.login,updated_at=now()",
        [sealed.ciphertext, login],
      );
    });
  }
  async selectRepository(repository: string, branch: string) {
    if (
      !/^[\w.-]+\/[\w.-]+$/u.test(repository) ||
      !/^[\w./-]{1,200}$/u.test(branch) ||
      branch.includes("..")
    )
      throw new ChatError("INVALID_REPOSITORY", "Choose a valid repository and branch.");
    await this.db.transaction(async (c) => {
      const result = await c.query(
        "UPDATE odin_api.github_connections SET repository=$1,default_branch=$2,updated_at=now()",
        [repository, branch],
      );
      if (!result.rowCount)
        throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
    });
  }
  async deleteGithub() {
    await this.db.transaction(async (c) => {
      await c.query("DELETE FROM odin_api.github_connections");
    });
  }
  async createOAuthState(): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(state).digest("hex");
    await this.db.transaction(async (c) => {
      await c.query(
        "DELETE FROM odin_api.oauth_states WHERE expires_at<now() OR consumed_at IS NOT NULL",
      );
      await c.query(
        "INSERT INTO odin_api.oauth_states(state_hash,expires_at) VALUES($1,now()+interval '10 minutes')",
        [hash],
      );
    });
    return state;
  }
  async consumeOAuthState(state: string) {
    const hash = createHash("sha256").update(state).digest("hex");
    const ok = await this.db.transaction(
      async (c) =>
        (
          await c.query(
            "UPDATE odin_api.oauth_states SET consumed_at=now() WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING state_hash",
            [hash],
          )
        ).rows.length === 1,
    );
    if (!ok)
      throw new ChatError(
        "OAUTH_STATE_INVALID",
        "GitHub connection expired or was already used.",
        403,
      );
  }
}

export function provider(value: unknown): ProductProvider {
  if (typeof value !== "string" || !PROVIDERS.includes(value as ProductProvider))
    throw new ChatError("INVALID_PROVIDER", "Unsupported provider.");
  return value as ProductProvider;
}
export function verifyStripeSignature(
  raw: Buffer,
  header: string | undefined,
  secret: string | undefined,
  now = Math.floor(Date.now() / 1000),
): void {
  if (!secret || !header) throw new ChatError("STRIPE_SIGNATURE", "Invalid Stripe signature.", 400);
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300 || !signature)
    throw new ChatError("STRIPE_SIGNATURE", "Invalid or stale Stripe signature.", 400);
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${raw.toString("utf8")}`)
    .digest("hex");
  const a = Buffer.from(signature, "hex"),
    b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new ChatError("STRIPE_SIGNATURE", "Invalid Stripe signature.", 400);
}
