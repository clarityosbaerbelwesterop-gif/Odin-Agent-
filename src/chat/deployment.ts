/** Public endpoints verified through the connected Neon project; contains no credentials. */
const VERCEL_AUTH_BY_DATABASE = new Map([
  [
    "ep-rapid-union-b14h469x.c-5.eu-central-1.aws.neon.tech/neondb",
    "https://ep-rapid-union-b14h469x.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth",
  ],
  [
    "ep-restless-cake-b1d8u9ge.c-5.eu-central-1.aws.neon.tech/neondb",
    "https://ep-restless-cake-b1d8u9ge.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth",
  ],
]);

export function resolveNeonAuthUrl(
  connection: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const explicit = env.NEON_AUTH_BASE_URL ?? env.NEON_AUTH_URL ?? env.VITE_NEON_AUTH_URL;
  if (explicit) return explicit;
  if (!connection || !["preview", "production"].includes(env.VERCEL_ENV ?? "")) return undefined;
  try {
    const database = new URL(connection);
    if (!["postgres:", "postgresql:"].includes(database.protocol)) return undefined;
    const host = database.hostname.replace(/-pooler(?=\.)/u, "").toLowerCase();
    const path = database.pathname.toLowerCase();
    return VERCEL_AUTH_BY_DATABASE.get(`${host}${path}`);
  } catch {
    return undefined;
  }
}
