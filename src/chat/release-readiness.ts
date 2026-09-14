import { ODIN_STRIPE_PRICES } from "./product.js";

export type ReleaseCheckStatus = "ready" | "blocked";

export interface ReleaseCheck {
  readonly id: string;
  readonly label: string;
  readonly status: ReleaseCheckStatus;
}

export interface ReleaseReadiness {
  readonly environment: "production" | "preview";
  readonly ready: boolean;
  readonly checks: readonly ReleaseCheck[];
}

type Environment = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0 && !/[\r\n]/u.test(value);
}

function exactPrice(env: Environment, key: string, expected: string): boolean {
  return env[key] === expected;
}

function validEncryptionKey(value: string | undefined): boolean {
  if (!present(value)) return false;
  try {
    return Buffer.from(value as string, "base64url").length === 32;
  } catch {
    return false;
  }
}

function validPublicOrigin(value: string | undefined): boolean {
  if (!present(value)) return false;
  try {
    const url = new URL(value as string);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}

function production(env: Environment): boolean {
  return env.VERCEL_ENV !== undefined
    ? env.VERCEL_ENV === "production"
    : env.NODE_ENV === "production";
}

export function productReleaseReadiness(
  env: Environment = process.env,
  modelCount = 0,
): ReleaseReadiness {
  const isProduction = production(env);
  const checks: ReleaseCheck[] = [
    {
      id: "public-origin",
      label: "HTTPS public origin",
      status: validPublicOrigin(env.ODIN_PUBLIC_ORIGIN) ? "ready" : "blocked",
    },
    {
      id: "database",
      label: "Neon/Postgres database",
      status: present(env.ODIN_DATABASE_URL ?? env.DATABASE_URL ?? env.POSTGRES_URL)
        ? "ready"
        : "blocked",
    },
    {
      id: "auth",
      label: "Neon Auth",
      status: present(env.NEON_AUTH_BASE_URL) ? "ready" : "blocked",
    },
    {
      id: "credential-vault",
      label: "Credential encryption",
      status: validEncryptionKey(env.ODIN_CREDENTIAL_ENCRYPTION_KEY) ? "ready" : "blocked",
    },
    {
      id: "billing-secret",
      label: "Stripe secret",
      status: present(env.STRIPE_SECRET_KEY) ? "ready" : "blocked",
    },
    {
      id: "billing-webhook",
      label: "Stripe webhook verification",
      status: present(env.STRIPE_WEBHOOK_SECRET) ? "ready" : "blocked",
    },
    {
      id: "billing-prices",
      label: "Exact Odin Stripe prices",
      status:
        exactPrice(env, "STRIPE_PRO_PRICE_ID", ODIN_STRIPE_PRICES.pro) &&
        exactPrice(env, "STRIPE_DEVELOPER_PRICE_ID", ODIN_STRIPE_PRICES.developer) &&
        exactPrice(env, "STRIPE_ULTRA_PRICE_ID", ODIN_STRIPE_PRICES.ultra)
          ? "ready"
          : "blocked",
    },
    {
      id: "github-repository-oauth",
      label: "GitHub repository OAuth",
      status:
        present(env.GITHUB_REPO_OAUTH_CLIENT_ID) && present(env.GITHUB_REPO_OAUTH_CLIENT_SECRET)
          ? "ready"
          : "blocked",
    },
    {
      id: "models",
      label: "Hosted model capacity",
      status: Number.isSafeInteger(modelCount) && modelCount > 0 ? "ready" : "blocked",
    },
  ];

  return {
    environment: isProduction ? "production" : "preview",
    ready: checks.every((check) => check.status === "ready"),
    checks,
  };
}
