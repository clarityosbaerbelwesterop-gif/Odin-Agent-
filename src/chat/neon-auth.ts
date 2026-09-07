import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { ChatError } from "./types.js";

export interface NeonIdentity {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}
const denied = () => new ChatError("UNAUTHORIZED", "Sign in to access Odin.", 401);
const COOKIE_NAMES = new Set(["__Secure-neonauth.session_token", "neonauth.session_token"]);

/** Same-origin broker avoids third-party cookie failures on Safari. No password is stored. */
export class NeonAuth {
  readonly base: URL;
  readonly #keys: JWTVerifyGetKey;
  constructor(
    baseUrl: string,
    readonly request: typeof fetch = fetch,
    keys?: JWTVerifyGetKey,
  ) {
    this.base = new URL(baseUrl.replace(/\/$/u, ""));
    if (
      this.base.protocol !== "https:" ||
      !this.base.hostname.endsWith(".neon.tech") ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    )
      throw new ChatError("AUTH_CONFIG", "Configure the connected Neon Auth URL.", 503);
    this.#keys =
      keys ??
      createRemoteJWKSet(new URL(`${this.base.href}/.well-known/jwks.json`), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 300000,
      });
  }
  async verifyToken(token: string): Promise<NeonIdentity> {
    if (token.length > 16000) throw denied();
    try {
      const { payload } = await jwtVerify(token, this.#keys, {
        algorithms: ["EdDSA"],
        issuer: this.base.origin,
        audience: this.base.origin,
        requiredClaims: ["sub", "iat", "exp"],
        maxTokenAge: "15m",
        clockTolerance: 5,
      });
      if (
        !payload.sub ||
        payload.sub.length > 200 ||
        payload.role !== "authenticated" ||
        payload.banned === true ||
        typeof payload.email !== "string"
      )
        throw denied();
      return {
        id: payload.sub,
        email: payload.email,
        emailVerified: payload.emailVerified === true,
      };
    } catch {
      throw denied();
    }
  }
  cookie(header: string): string {
    if (header.length > 16000) throw denied();
    return header
      .split(";")
      .map((part) => part.trim())
      .filter((part) => COOKIE_NAMES.has(part.split("=")[0] ?? ""))
      .join("; ");
  }
  async session(cookie: string, origin: string): Promise<NeonIdentity> {
    const selected = this.cookie(cookie);
    if (!selected) throw denied();
    const response = await this.upstream("get-session", "GET", origin, selected);
    if (!response.ok) throw denied();
    const body = (await response.json()) as {
      user?: { id?: string };
      session?: { userId?: string; expiresAt?: string };
    };
    if (
      !body?.user?.id ||
      body.session?.userId !== body.user.id ||
      !body.session.expiresAt ||
      !Number.isFinite(Date.parse(body.session.expiresAt)) ||
      Date.parse(body.session.expiresAt) <= Date.now()
    )
      throw denied();
    let token = response.headers.get("set-auth-jwt");
    if (!token) {
      const result = await this.upstream("token", "GET", origin, selected);
      if (!result.ok) throw denied();
      const data = (await result.json()) as { token?: string };
      token = data.token ?? null;
    }
    if (!token) throw denied();
    const identity = await this.verifyToken(token);
    if (identity.id !== body.user.id) throw denied();
    if (!identity.emailVerified)
      throw new ChatError(
        "EMAIL_UNVERIFIED",
        "Verify your email before opening the workspace.",
        403,
      );
    return identity;
  }
  async upstream(
    path: string,
    method: string,
    origin: string,
    cookie = "",
    body?: unknown,
  ): Promise<Response> {
    const allowed = [
      "get-session",
      "token",
      "sign-in/email",
      "sign-up/email",
      "sign-out",
      "email-otp/send-verification-otp",
      "email-otp/verify-email",
      "email-otp/request-password-reset",
      "email-otp/reset-password",
    ];
    if (!allowed.includes(path))
      throw new ChatError("AUTH_ROUTE", "Unsupported authentication action.", 404);
    return this.request(`${this.base.href}/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: this.cookie(cookie) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  }
  cookies(response: Response): string[] {
    return response.headers.getSetCookie().flatMap((raw) => {
      const pair = raw.split(";")[0];
      if (!pair || !COOKIE_NAMES.has(pair.split("=")[0] ?? "")) return [];
      if (/[\r\n]/u.test(pair)) throw denied();
      const age = /;\s*Max-Age=(-?\d+)/iu.exec(raw)?.[1];
      const expires = /;\s*Expires=([^;]+)/iu.exec(raw)?.[1];
      return [
        `${pair}; Path=/; HttpOnly; Secure; SameSite=Strict${age ? `; Max-Age=${Math.max(0, Math.min(Number(age), 604800))}` : ""}${expires ? `; Expires=${expires}` : ""}`,
      ];
    });
  }
}
