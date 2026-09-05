import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SkillOsError,
  type SkillOsPackSource,
  type SkillOsPackSummary,
  SkillOsRuntime,
} from "../../src/skill-os/index.js";
import type { SkillPackage } from "../../src/skills/index.js";

const T0 = "2026-09-05T08:00:00.000Z";
const SMALL_INSTRUCTIONS = "Inspect current code, change only the target, verify the result.";
const LARGE_INSTRUCTIONS =
  "Inspect repository context, preserve invariants, make one bounded change, run deterministic verification, and stop on any failed evidence.";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function skill(name: string, version: string, instructions: string): SkillPackage {
  return {
    contentHash: hash(`${name}\u0000${version}\u0000${instructions}`),
    instructions,
    name,
    provenance: { kind: "community", observedAt: T0, reference: `fixture:${name}` },
    requiredTools: [],
    summary: `Fixture ${name}`,
    tags: ["coding"],
    testRefs: ["fixture:verified"],
    trustClass: "community",
    version,
  };
}

class FixturePackSource implements SkillOsPackSource {
  readonly summaries: SkillOsPackSummary[];
  readonly members = new Map<string, SkillPackage>();
  revoked = new Set<string>();

  constructor() {
    const small = skill("community.small", "1.0.0", SMALL_INSTRUCTIONS);
    const large = skill("community.large", "1.0.0", LARGE_INSTRUCTIONS);
    this.members.set("pack.small@1.0.0/community.small@1.0.0", small);
    this.members.set("pack.large@1.0.0/community.large@1.0.0", large);
    this.summaries = [
      {
        contextBytes: Buffer.byteLength(SMALL_INSTRUCTIONS),
        domain: "coding",
        id: "pack.small",
        memberCount: 1,
        packHash: hash("pack.small@1.0.0"),
        taskClasses: ["coding.patch"],
        version: "1.0.0",
      },
      {
        contextBytes: Buffer.byteLength(LARGE_INSTRUCTIONS),
        domain: "coding",
        id: "pack.large",
        memberCount: 1,
        packHash: hash("pack.large@1.0.0"),
        taskClasses: ["coding.patch"],
        version: "1.0.0",
      },
    ];
  }

  listSummaries(): readonly SkillOsPackSummary[] {
    return structuredClone(this.summaries);
  }

  resolveMember(packId: string, packVersion: string, name: string, version: string): SkillPackage {
    const key = `${packId}@${packVersion}/${name}@${version}`;
    if (this.revoked.has(key)) throw new Error("fixture member revoked");
    const member = this.members.get(key);
    if (member === undefined) throw new Error("fixture member absent");
    return structuredClone(member);
  }
}

function registration(source: FixturePackSource, id: "pack.large" | "pack.small") {
  const summary = source.summaries.find((item) => item.id === id);
  assert.ok(summary);
  const member = source.resolveMember(id, "1.0.0", `community.${id.split(".")[1]}`, "1.0.0");
  return {
    ...summary,
    members: [
      {
        contentHash: member.contentHash,
        name: member.name,
        taskClasses: ["coding.patch"],
        version: member.version,
      },
    ],
  };
}

test("M23 discovers compact metadata and loads instructions only after exact task selection", () => {
  const source = new FixturePackSource();
  const runtime = new SkillOsRuntime(source, {}, () => T0);
  runtime.registerPack(registration(source, "pack.large"));
  runtime.registerPack(registration(source, "pack.small"));

  const discovered = runtime.discover({ domain: "coding", taskClass: "coding.patch" });
  assert.deepEqual(
    discovered.map((item) => item.id),
    ["pack.small", "pack.large"],
  );
  assert.equal(JSON.stringify(discovered).includes("Inspect current code"), false);
  assert.equal("members" in discovered[0]!, false);

  const selected = runtime.select({ domain: "coding", taskClass: "coding.patch" });
  assert.equal(selected.packId, "pack.small");
  const loaded = runtime.load(selected);
  assert.equal(loaded.packages.length, 1);
  assert.equal(loaded.packages[0]?.instructions, SMALL_INSTRUCTIONS);
});

test("M23 pin and rollback change only pack routing and preserve explicit history", () => {
  const source = new FixturePackSource();
  const runtime = new SkillOsRuntime(source, {}, () => T0);
  const small = runtime.registerPack(registration(source, "pack.small"));
  const large = runtime.registerPack(registration(source, "pack.large"));

  runtime.pin({
    actor: "trusted_runtime",
    domain: "coding",
    packHash: small.packHash,
    packId: small.id,
    packVersion: small.version,
    taskClass: "coding.patch",
  });
  runtime.pin({
    actor: "user_approved",
    domain: "coding",
    packHash: large.packHash,
    packId: large.id,
    packVersion: large.version,
    taskClass: "coding.patch",
  });
  assert.equal(
    runtime.select({ domain: "coding", taskClass: "coding.patch" }).packId,
    "pack.large",
  );

  const rollback = runtime.rollback({
    actor: "user_approved",
    domain: "coding",
    packHash: small.packHash,
    packId: small.id,
    packVersion: small.version,
    taskClass: "coding.patch",
  });
  assert.equal(rollback.action, "ROLLED_BACK");
  assert.equal(
    runtime.select({ domain: "coding", taskClass: "coding.patch" }).packId,
    "pack.small",
  );
  assert.deepEqual(
    runtime.history().map((event) => event.action),
    ["PINNED", "PINNED", "ROLLED_BACK"],
  );
});

test("M23 rejects untrusted pack metadata, tampered selections, and stale member identity", () => {
  const source = new FixturePackSource();
  const runtime = new SkillOsRuntime(source, {}, () => T0);
  const registered = registration(source, "pack.small");

  assert.throws(
    () => runtime.registerPack({ ...registered, packHash: hash("forged") }),
    (error: unknown) => error instanceof SkillOsError && error.code === "CONFLICT",
  );
  runtime.registerPack(registered);
  const selected = runtime.select({ domain: "coding", taskClass: "coding.patch" });
  assert.throws(
    () => runtime.load({ ...selected, contextBytes: selected.contextBytes + 1 }),
    (error: unknown) => error instanceof SkillOsError && error.code === "CONFLICT",
  );

  source.revoked.add("pack.small@1.0.0/community.small@1.0.0");
  assert.throws(() => runtime.load(selected));
});

test("M23 refuses rollback to an exact pack revision never observed for that route", () => {
  const source = new FixturePackSource();
  const runtime = new SkillOsRuntime(source, {}, () => T0);
  const large = runtime.registerPack(registration(source, "pack.large"));
  assert.throws(
    () =>
      runtime.rollback({
        actor: "trusted_runtime",
        domain: "coding",
        packHash: large.packHash,
        packId: large.id,
        packVersion: large.version,
        taskClass: "coding.patch",
      }),
    (error: unknown) => error instanceof SkillOsError && error.code === "DENIED",
  );
});

test("M23 ceilings and task identity fail closed before progressive instruction loading", () => {
  const source = new FixturePackSource();
  const runtime = new SkillOsRuntime(source, { maxContextBytes: 10_000, maxMembers: 2 }, () => T0);
  runtime.registerPack(registration(source, "pack.small"));
  assert.throws(
    () => runtime.select({ domain: "coding", maxContextBytes: 1, taskClass: "coding.patch" }),
    (error: unknown) => error instanceof SkillOsError && error.code === "NOT_FOUND",
  );
  assert.throws(
    () => runtime.select({ domain: "coding", taskClass: "coding.security" }),
    (error: unknown) => error instanceof SkillOsError && error.code === "NOT_FOUND",
  );
});
