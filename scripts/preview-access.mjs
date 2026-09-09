// Reuse a temporary share that the deployment owner already issued. Never broaden or renew access.
export function temporaryDeploymentShare(protectionBypass, now = Date.now()) {
  if (!Number.isFinite(now) || !protectionBypass || typeof protectionBypass !== "object")
    return undefined;
  const shares = Object.entries(protectionBypass).filter(
    ([secret, entry]) =>
      /^[A-Za-z0-9_.-]{11,1024}$/u.test(secret) &&
      entry?.scope === "shareable-link" &&
      Number.isFinite(entry.expires) &&
      entry.expires > now + 300000 &&
      entry.expires <= now + 86400000,
  );
  shares.sort((a, b) => a[1].expires - b[1].expires);
  return shares.length ? { secret: shares[0][0], expires: shares[0][1].expires } : undefined;
}
