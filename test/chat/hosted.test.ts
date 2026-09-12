import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { hostedHandler } from "../../src/chat/hosted.js";
import { hostedRequest } from "./helpers.js";

test("hosted request transport preserves origin and unauthenticated APIs remain closed", async () => {
  process.env.ODIN_DATABASE_URL = "postgresql://fixture:fixture@ep-fixture.neon.tech/neondb";
  process.env.NEON_AUTH_BASE_URL =
    "https://ep-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth";
  process.env.ODIN_PUBLIC_ORIGIN = "https://odin.example";
  process.env.GITHUB_OAUTH_CLIENT_ID = "fixture-client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "fixture-secret";
  const server = createServer(hostedHandler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const denied = await hostedRequest(address.port, "https://odin.example", "/api/conversations");
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).code, "UNAUTHORIZED");
    const deletion = await hostedRequest(
      address.port,
      "https://odin.example",
      "/api/session",
      "",
      "DELETE",
      {},
    );
    assert.equal(deletion.status, 401);
    const config = await hostedRequest(address.port, "https://odin.example", "/api/auth/config");
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), {
      provider: "neon",
      emailVerificationRequired: false,
      oauth: {
        github: {
          available: true,
          authBase: "https://ep-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth",
        },
      },
    });
    assert.match(
      config.headers.get("content-security-policy") ?? "",
      /connect-src 'self' https:\/\/ep-fixture\.neonauth\.eu-central-1\.aws\.neon\.tech/u,
    );
    const foreign = await hostedRequest(
      address.port,
      "https://foreign.example",
      "/api/auth/config",
    );
    assert.equal(foreign.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
