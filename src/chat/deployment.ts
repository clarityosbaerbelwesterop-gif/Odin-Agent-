/** Public endpoints verified through the connected Neon project; contains no credentials. */
const PREVIEW_AUTH = new Map([
  [
    "ep-rapid-union-b14h469x.c-5.eu-central-1.aws.neon.tech/neondb",
    "https://ep-rapid-union-b14h469x.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth",
  ],
]);

export function resolveNeonAuthUrl(
  connection: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const explicit = env.NEON_AUTH_BASE_URL ?? env.NEON_AUTH_URL ?? env.VITE_NEON_AUTH_URL;
  if (explicit) return explicit;
  if (!connection || env.VERCEL_ENV !== "preview") return undefined;
  try {
    const database = new URL(connection);
    if (!["postgres:", "postgresql:"].includes(database.protocol)) return undefined;
    const host = database.hostname.replace(/-pooler(?=\.)/u, "");
    return PREVIEW_AUTH.get(`${host}${database.pathname}`);
  } catch {
    return undefined;
  }
}
