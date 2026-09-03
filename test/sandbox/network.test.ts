import assert from "node:assert/strict";
import test from "node:test";
import { type DnsResolver, OutboundNetworkPolicy, SandboxError } from "../../src/sandbox/index.js";

class Resolver implements DnsResolver {
  readonly #answers: Readonly<Record<string, readonly string[]>>;

  constructor(answers: Readonly<Record<string, readonly string[]>>) {
    this.#answers = answers;
  }

  async resolve(hostname: string): Promise<readonly string[]> {
    const answer = this.#answers[hostname];
    if (answer === undefined) throw new Error("not found");
    return answer;
  }
}

test("allowlisted HTTPS destination binds normalized host port and public DNS evidence", async () => {
  const policy = new OutboundNetworkPolicy({
    allowedHosts: ["api.example.com"],
    resolver: new Resolver({ "api.example.com": ["93.184.216.34", "93.184.216.35"] }),
  });
  const decision = await policy.authorize("https://api.example.com/v1/tasks?b=2");
  assert.equal(decision.hostname, "api.example.com");
  assert.equal(decision.port, 443);
  assert.deepEqual(decision.addresses, ["93.184.216.34", "93.184.216.35"]);
  assert.match(decision.resolutionHash, /^[a-f0-9]{64}$/u);
  assert.equal(decision.normalizedUrl, "https://api.example.com/v1/tasks?b=2");
});

test("private reserved loopback and mapped addresses are denied after DNS", async () => {
  const privateAddresses = [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.1.2",
    "172.16.1.2",
    "192.168.1.2",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ];
  for (const address of privateAddresses) {
    const policy = new OutboundNetworkPolicy({
      allowedHosts: ["api.example.com"],
      resolver: new Resolver({ "api.example.com": [address] }),
    });
    await assert.rejects(
      policy.authorize("https://api.example.com/"),
      (error: unknown) => error instanceof SandboxError && error.code === "NETWORK_DENIED",
    );
  }
});

test("private IP literals remain denied even when the literal is allowlisted", async () => {
  const ipv4 = new OutboundNetworkPolicy({
    allowedHosts: ["127.0.0.1"],
    resolver: new Resolver({}),
  });
  await assert.rejects(
    ipv4.authorize("https://127.0.0.1/"),
    (error: unknown) => error instanceof SandboxError && error.code === "NETWORK_DENIED",
  );

  const ipv6 = new OutboundNetworkPolicy({
    allowedHosts: ["::1"],
    resolver: new Resolver({}),
  });
  await assert.rejects(
    ipv6.authorize("https://[::1]/"),
    (error: unknown) => error instanceof SandboxError && error.code === "NETWORK_DENIED",
  );
});

test("protocol port credentials fragment and foreign host fail closed", async () => {
  const policy = new OutboundNetworkPolicy({
    allowedHosts: ["api.example.com"],
    resolver: new Resolver({ "api.example.com": ["93.184.216.34"] }),
  });
  for (const url of [
    "http://api.example.com/",
    "https://api.example.com:8443/",
    "https://user:pass@api.example.com/",
    "https://api.example.com/#fragment",
    "https://other.example.com/",
  ]) {
    await assert.rejects(policy.authorize(url), SandboxError);
  }
});

test("wildcard grants match subdomains only and do not include the parent host", async () => {
  const resolver = new Resolver({
    "api.example.com": ["93.184.216.34"],
    "example.com": ["93.184.216.34"],
  });
  const policy = new OutboundNetworkPolicy({ allowedHosts: ["*.example.com"], resolver });
  assert.equal((await policy.authorize("https://api.example.com/")).hostname, "api.example.com");
  await assert.rejects(
    policy.authorize("https://example.com/"),
    (error: unknown) => error instanceof SandboxError && error.code === "NETWORK_DENIED",
  );
});

test("redirect or destination changes require a fresh authorization decision", async () => {
  const policy = new OutboundNetworkPolicy({
    allowedHosts: ["api.example.com"],
    resolver: new Resolver({ "api.example.com": ["93.184.216.34"] }),
  });
  const first = await policy.authorize("https://api.example.com/start");
  assert.equal(first.hostname, "api.example.com");
  await assert.rejects(
    policy.authorize("https://redirect.example.net/final"),
    (error: unknown) => error instanceof SandboxError && error.code === "NETWORK_DENIED",
  );
});

test("mixed public and private DNS answers deny the whole destination", async () => {
  const policy = new OutboundNetworkPolicy({
    allowedHosts: ["api.example.com"],
    resolver: new Resolver({ "api.example.com": ["93.184.216.34", "127.0.0.1"] }),
  });
  await assert.rejects(
    policy.authorize("https://api.example.com/"),
    (error: unknown) => error instanceof SandboxError && error.code === "NETWORK_DENIED",
  );
});
