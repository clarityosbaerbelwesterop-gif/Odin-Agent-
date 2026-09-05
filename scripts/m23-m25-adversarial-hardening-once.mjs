import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Expected hardening anchor missing in ${path}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Hardening anchor is ambiguous in ${path}`);
  }
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function appendOnce(path, marker, addition) {
  const source = readFileSync(path, "utf8");
  if (source.includes(marker)) throw new Error(`Hardening test already exists in ${path}`);
  writeFileSync(path, `${source.trimEnd()}\n\n${addition.trim()}\n`);
}

replaceOnce(
  "src/capability-packs/registry.ts",
  `  resolveMember(\n    packId: string,\n    packVersion: string,\n    name: string,\n    versionValue: string,\n  ): SkillPackage {`,
  `  resolveMemberMetadata(\n    packId: string,\n    packVersion: string,\n    name: string,\n    versionValue: string,\n  ): CapabilityPackMember {\n    const pack = this.#packs.get(\n      packKey(identifier(packId, "pack id"), version(packVersion, "pack version")),\n    );\n    if (pack === undefined)\n      throw new CapabilityPackError("NOT_FOUND", "Capability pack was not found.");\n    const member = pack.members.find(\n      (entry) => entry.name === name && entry.version === versionValue,\n    );\n    if (member === undefined) {\n      throw new CapabilityPackError(\n        "NOT_FOUND",\n        "Skill is not a member of the requested capability pack.",\n      );\n    }\n    return Object.freeze({\n      ...member,\n      taskClasses: Object.freeze([...member.taskClasses]),\n    });\n  }\n\n  resolveMember(\n    packId: string,\n    packVersion: string,\n    name: string,\n    versionValue: string,\n  ): SkillPackage {`,
);

replaceOnce(
  "src/skill-os/runtime.ts",
  `  maxPacks: 128,\n  maxTaskClasses: 64,`,
  `  maxPacks: 128,\n  maxSelectionAgeMs: 15 * 60 * 1_000,\n  maxTaskClasses: 64,`,
);

replaceOnce(
  "src/skill-os/runtime.ts",
  `    for (const member of input.members) {\n      const loaded = this.#source.resolveMember(\n        input.id,\n        input.version,\n        member.name,\n        member.version,\n      );`,
  `    for (const member of input.members) {\n      const trustedMember = this.#source.resolveMemberMetadata(\n        input.id,\n        input.version,\n        member.name,\n        member.version,\n      );\n      if (\n        trustedMember.name !== member.name ||\n        trustedMember.version !== member.version ||\n        trustedMember.contentHash !== member.contentHash ||\n        !equalStrings(trustedMember.taskClasses, member.taskClasses)\n      ) {\n        throw new SkillOsError(\n          "CONFLICT",\n          "Pack member task scope does not match trusted capability-pack metadata.",\n        );\n      }\n      const loaded = this.#source.resolveMember(\n        input.id,\n        input.version,\n        member.name,\n        member.version,\n      );`,
);

replaceOnce(
  "src/skill-os/runtime.ts",
  `  load(value: unknown): SkillOsLoadedSelection {\n    const selection = normalizeIssuedSelection(value);\n    const { selectionHash, ...body } = selection;`,
  `  load(value: unknown): SkillOsLoadedSelection {\n    const selection = normalizeIssuedSelection(value);\n    const nowMs = Date.parse(canonicalNow(this.#clock()));\n    const issuedAtMs = Date.parse(selection.issuedAt);\n    if (issuedAtMs > nowMs) {\n      throw new SkillOsError("DENIED", "Skill OS selection was issued in the future.");\n    }\n    if (nowMs - issuedAtMs > this.#limits.maxSelectionAgeMs) {\n      throw new SkillOsError("DENIED", "Skill OS selection is stale and must be reselected.");\n    }\n    const { selectionHash, ...body } = selection;`,
);

replaceOnce(
  "test/skill-os/runtime.test.ts",
  `  resolveMember(packId: string, packVersion: string, name: string, version: string): SkillPackage {`,
  `  resolveMemberMetadata(packId: string, packVersion: string, name: string, version: string) {\n    const member = this.resolveMember(packId, packVersion, name, version);\n    return {\n      contentHash: member.contentHash,\n      name: member.name,\n      taskClasses: ["coding.patch"],\n      version: member.version,\n    };\n  }\n\n  resolveMember(packId: string, packVersion: string, name: string, version: string): SkillPackage {`,
);

appendOnce(
  "test/skill-os/runtime.test.ts",
  "M23 rejects forged per-member task scope and stale selections",
  `test("M23 rejects forged per-member task scope and stale selections", () => {\n  const source = new FixturePackSource();\n  let now = T0;\n  const runtime = new SkillOsRuntime(source, {}, () => now);\n  const forged = registration(source, "pack.small");\n  assert.throws(\n    () =>\n      runtime.registerPack({\n        ...forged,\n        members: forged.members.map((member) => ({\n          ...member,\n          taskClasses: ["coding.security"],\n        })),\n      }),\n    (error: unknown) => error instanceof SkillOsError && error.code === "CONFLICT",\n  );\n\n  runtime.registerPack(forged);\n  const selection = runtime.select({ domain: "coding", taskClass: "coding.patch" });\n  now = "2026-09-05T08:15:00.001Z";\n  assert.throws(\n    () => runtime.load(selection),\n    (error: unknown) => error instanceof SkillOsError && error.code === "DENIED",\n  );\n});`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `import { createHash } from "node:crypto";`,
  `import { createHash } from "node:crypto";\nimport { containsObviousSecret } from "../security/secret-text.js";`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `export class AdvancedMemoryError extends Error {\n  constructor(\n    readonly code: "CONFLICT" | "INVALID_INPUT" | "NOT_FOUND",`,
  `export class AdvancedMemoryError extends Error {\n  constructor(\n    readonly code: "CONFLICT" | "DENIED" | "INVALID_INPUT" | "NOT_FOUND",`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `export class AdvancedMemoryEngine {\n  readonly #store: MemoryStore;\n  readonly #clock: () => string;`,
  `const MAX_ISSUED_COMPRESSION_PROPOSALS = 256;\n\nexport class AdvancedMemoryEngine {\n  readonly #store: MemoryStore;\n  readonly #clock: () => string;\n  readonly #issuedCompressionProposals = new Map<string, MemoryCompressionProposal>();`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `    const sourceByKey = new Map(query.currentSources.map((source) => [source.key, source]));\n    const stale = new Map<string, StaleMemoryEntry>();`,
  `    const evaluatedAtMs = Date.parse(query.evaluatedAt);\n    if (\n      query.currentSources.some((source) => Date.parse(source.observedAt) > evaluatedAtMs) ||\n      recalled.some(\n        (item) =>\n          Date.parse(item.record.updatedAt) > evaluatedAtMs ||\n          Date.parse(item.record.provenance.observedAt) > evaluatedAtMs,\n      )\n    ) {\n      throw new AdvancedMemoryError(\n        "CONFLICT",\n        "Advanced memory evidence cannot originate after its evaluation time.",\n      );\n    }\n    const sourceByKey = new Map(query.currentSources.map((source) => [source.key, source]));\n    const stale = new Map<string, StaleMemoryEntry>();`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `    const evaluatedAt = Date.parse(input.evaluatedAt);\n    const candidates = recalled`,
  `    if (recalled.length === 100) {\n      throw new AdvancedMemoryError(\n        "DENIED",\n        "Retention planning reached the M6 retrieval ceiling and cannot claim complete coverage.",\n      );\n    }\n    const evaluatedAt = Date.parse(input.evaluatedAt);\n    const candidates = recalled`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `    const scope: MemoryScope = { projectId: input.projectId, userId: input.userId };\n    const sourceRecords: { id: string; recordHash: string }[] = [];\n    for (const id of input.sourceRecordIds) {`,
  `    const scope: MemoryScope = { projectId: input.projectId, userId: input.userId };\n    const sourceRecords: { id: string; recordHash: string }[] = [];\n    let requiredSensitivity: MemorySensitivity = "public";\n    for (const id of input.sourceRecordIds) {`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `      sourceRecords.push({ id: record.id, recordHash: record.recordHash });\n    }\n    sourceRecords.sort((left, right) => left.id.localeCompare(right.id));`,
  `      sourceRecords.push({ id: record.id, recordHash: record.recordHash });\n      if (sensitivityRank(record.sensitivity) > sensitivityRank(requiredSensitivity)) {\n        requiredSensitivity = record.sensitivity;\n      }\n    }\n    if (sensitivityRank(input.sensitivity) < sensitivityRank(requiredSensitivity)) {\n      throw new AdvancedMemoryError(\n        "DENIED",\n        "Compression cannot downgrade the sensitivity of its source memory.",\n      );\n    }\n    sourceRecords.sort((left, right) => left.id.localeCompare(right.id));`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `    return Object.freeze({ ...body, proposalHash: stableHash(body) });\n  }\n\n  async commitCompression`,
  `    const proposal = Object.freeze({ ...body, proposalHash: stableHash(body) });\n    const existing = this.#issuedCompressionProposals.get(proposal.proposalHash);\n    if (existing !== undefined) return structuredClone(existing);\n    if (this.#issuedCompressionProposals.size >= MAX_ISSUED_COMPRESSION_PROPOSALS) {\n      throw new AdvancedMemoryError(\n        "DENIED",\n        "Compression proposal issuance reached its runtime-owned bound.",\n      );\n    }\n    this.#issuedCompressionProposals.set(proposal.proposalHash, structuredClone(proposal));\n    return structuredClone(proposal);\n  }\n\n  async commitCompression`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `    const { proposalHash, ...body } = proposal;\n    if (stableHash(body) !== proposalHash) {\n      throw new AdvancedMemoryError("CONFLICT", "Compression proposal integrity check failed.");\n    }`,
  `    const { proposalHash, ...body } = proposal;\n    if (stableHash(body) !== proposalHash || proposal.contentHash !== sha256(proposal.summary)) {\n      throw new AdvancedMemoryError("CONFLICT", "Compression proposal integrity check failed.");\n    }\n    const issued = this.#issuedCompressionProposals.get(proposalHash);\n    if (issued === undefined) {\n      throw new AdvancedMemoryError(\n        "DENIED",\n        "Compression commits require a proposal issued by this runtime instance.",\n      );\n    }\n    if (stableHash(issued) !== stableHash(proposal)) {\n      throw new AdvancedMemoryError("CONFLICT", "Compression proposal differs from issued evidence.");\n    }`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `      updatedAt: canonicalTime(this.#clock()),\n    });\n  }\n}`,
  `      updatedAt: proposal.createdAt,\n    });\n  }\n}`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `  if (\n    typeof object.summary !== "string" ||\n    object.summary.trim() === "" ||\n    object.summary.length > 16_384\n  ) {\n    invalid("Compression summary is invalid.");\n  }`,
  `  if (\n    typeof object.summary !== "string" ||\n    object.summary.trim() === "" ||\n    object.summary.length > 16_384 ||\n    containsObviousSecret(object.summary)\n  ) {\n    invalid("Compression summary is invalid or contains obvious secret material.");\n  }`,
);

replaceOnce(
  "src/memory/advanced.ts",
  `function positiveDuration(value: unknown, name: string): number {`,
  `function sensitivityRank(value: MemorySensitivity): number {\n  if (value === "public") return 0;\n  if (value === "internal") return 1;\n  return 2;\n}\n\nfunction positiveDuration(value: unknown, name: string): number {`,
);

appendOnce(
  "test/memory/advanced.test.ts",
  "M24 rejects future evidence, sensitivity downgrade, forged compression, and preserves replay",
  `test("M24 rejects future evidence, sensitivity downgrade, forged compression, and preserves replay", async () => {\n  const store = new InMemoryMemoryStore();\n  await writeEpisode(store, "episode-a", "First source.", T1);\n  await store.write({\n    expectedVersion: 0,\n    idempotencyKey: "write-sensitive",\n    record: {\n      content: "Sensitive project detail.",\n      id: "episode-sensitive",\n      key: "episode-sensitive",\n      kind: "episodic",\n      provenance: {\n        contentHash: hash("Sensitive project detail."),\n        observedAt: T1,\n        reference: "fixture:sensitive",\n        sourceClass: "tool",\n        sourceVersion: "fixture-v1",\n      },\n      scope: { projectId: "project-1", userId: "user-1" },\n      sensitivity: "sensitive",\n      tags: ["episode"],\n    },\n    updatedAt: T1,\n  });\n  const engine = new AdvancedMemoryEngine(store, () => T2);\n\n  await assert.rejects(\n    () =>\n      engine.retrieve({\n        currentSources: [\n          {\n            contentHash: hash("future"),\n            key: "architecture",\n            observedAt: "2026-09-05T08:00:00.001Z",\n            sourceVersion: "v3",\n          },\n        ],\n        evaluatedAt: T2,\n        limit: 10,\n        projectId: "project-1",\n        text: "",\n        userId: "user-1",\n      }),\n    (error: unknown) => error instanceof AdvancedMemoryError && error.code === "CONFLICT",\n  );\n\n  await assert.rejects(\n    () =>\n      engine.proposeCompression({\n        key: "unsafe-summary",\n        projectId: "project-1",\n        sensitivity: "internal",\n        sourceRecordIds: ["episode-a", "episode-sensitive"],\n        summary: "A lower-classified summary.",\n        userId: "user-1",\n      }),\n    (error: unknown) => error instanceof AdvancedMemoryError && error.code === "DENIED",\n  );\n\n  const proposal = await engine.proposeCompression({\n    key: "safe-summary",\n    projectId: "project-1",\n    sensitivity: "sensitive",\n    sourceRecordIds: ["episode-a", "episode-sensitive"],\n    summary: "A sensitivity-preserving summary.",\n    userId: "user-1",\n  });\n  const forgedEngine = new AdvancedMemoryEngine(store, () => T2);\n  await assert.rejects(\n    () => forgedEngine.commitCompression(proposal, "forged-runtime-commit"),\n    (error: unknown) => error instanceof AdvancedMemoryError && error.code === "DENIED",\n  );\n\n  const first = await engine.commitCompression(proposal, "compression-replay");\n  const replay = await engine.commitCompression(proposal, "compression-replay");\n  assert.equal(first.replayed, false);\n  assert.equal(replay.replayed, true);\n});\n\ntest("M24 compression rejects obvious secret material before lower-authority persistence", async () => {\n  const store = new InMemoryMemoryStore();\n  await writeEpisode(store, "episode-a", "First source.", T1);\n  await writeEpisode(store, "episode-b", "Second source.", T1);\n  const engine = new AdvancedMemoryEngine(store, () => T2);\n  await assert.rejects(\n    () =>\n      engine.proposeCompression({\n        key: "secret-summary",\n        projectId: "project-1",\n        sensitivity: "sensitive",\n        sourceRecordIds: ["episode-a", "episode-b"],\n        summary: "Bearer definitely-not-safe-token",\n        userId: "user-1",\n      }),\n    (error: unknown) => error instanceof AdvancedMemoryError && error.code === "INVALID_INPUT",\n  );\n});`,
);
