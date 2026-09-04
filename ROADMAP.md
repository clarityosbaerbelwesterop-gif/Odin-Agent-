# Odin delivery roadmap

Checkboxes mean verified repository evidence, not intent. Milestones are completed sequentially;
later design work may occur early, but later product capability is not declared complete early.

## M0 — Repository foundation

- [x] Research source read and architecture observations extracted.
- [x] Empty-repository baseline and branch state established.
- [x] Product contract, architecture, security, contributor rules, and handover created.
- [x] ADR process and initial architecture decisions recorded.
- [x] Locked Node/TypeScript toolchain and secret-safe environment example created.
- [x] Pull-request CI and deterministic foundation validation established.
- [x] CI result observed on the pull request.

Exit gate: clean install plus `npm run verify` passes locally and in CI; documentation agrees with
the repository; no product capability is overstated.

## M1 — Provider core

- [x] Normalized request, response, streaming, usage, tool-call, and error contracts.
- [x] Capability registry with config overrides and provenance.
- [x] OpenAI, Anthropic, OpenRouter, NVIDIA, and generic compatible adapters.
- [x] Abort, timeout, retry hints, rate limit, malformed output, and context overflow handling.
- [x] Injected-transport contract tests with no live cost.

## M2 — Mission runtime

- [x] Mission aggregate, typed state machine, task DAG, focus classification, and definitions of done.
- [x] Deterministic scheduler, budgets, retries, pause/resume/cancel, and anti-loop circuit breaker.
- [x] Append-only events, projections, checkpoints, optimistic versions, and recovery tests.

## M3 — Tool runtime

- [x] Tool registry and progressive discovery foundation; full skill package lifecycle remains M10.
- [x] Schema validation, risk classes, capability policy, idempotency, timeout, retry, and audit trail.
- [x] Scoped repository search/read/patch and quality-command tools.

## M4 — Coding vertical slice

- [x] Repository understanding and quality-gate discovery through scoped M3 tools.
- [x] Strict plan and task graph generated through the normalized M1 provider boundary.
- [x] Minimal scoped edit in an injected disposable fixture workspace.
- [x] Deliberate quality failure diagnosed, repaired, rerun, and mapped to evidence.
- [x] Interruption/resume demonstrated end to end over replayed M2 event-store state.

M4 proves orchestration across the M1/M2/M3 contracts with scripted provider responses and injected
in-memory fixtures. It does not claim a production OS sandbox or live-provider compatibility.

## M5 — Verification engine

- [x] Typed claim/evidence/binding contracts and deterministic fail-closed verifier.
- [x] Independent adversarial review with validated `ACCEPT`, `BLOCK`, and bounded
  `REPAIR_REQUIRED` outcomes.
- [x] M4 completion gated by fresh, scoped, hash-addressed M5 evidence.
- [x] Required verifier and coding-integration regression scenarios pass.
- [x] Pull-request implementation CI result observed and recorded.

GitHub Actions run `33724426019` passed on M5 implementation head
`f28bcb9758c2079d9f46826ea672c19bd6e538ff` with 77 tests and all configured gates.

## M6 — Memory and context engine

- [x] Scoped/versioned memory contracts and asynchronous in-memory adapter.
- [x] Optimistic concurrency, idempotency, expiry, tombstones, and bounded deterministic retrieval.
- [x] Fixed P0–P6 source priorities, current-source precedence, and mandatory P0–P2 context.
- [x] Deterministic item/section/total token estimates and fail-closed budget handling.
- [x] Bounded content-addressed cache with sensitive-data exclusion and memory invalidation.
- [x] Structured, integrity-checked session snapshots retaining raw-history references.
- [x] Retrieval-to-context vertical slice and requirement-derived regression tests.
- [x] Implementation CI observed: run `33752964771`, 108/108 tests passed.
- [x] Synchronized documentation CI observed: run `33753281792`; final evidence recorded.

## M7 — Specialist coordination

- [x] Bounded specialist registry with compact discovery metadata and injected handlers.
- [x] M2 dependency-ready task selection plus deterministic role/capability matching.
- [x] Expiring repository/resource/state ownership leases with read/write conflict detection.
- [x] Bounded parallel execution, timeout/cancellation cleanup, and partial-failure preservation.
- [x] Strict structured proposal validation and runtime-attested evidence reconciliation.
- [x] Implementation CI observed: run `33755851793`, 132/132 tests passed.
- [x] Synchronized documentation CI observed: run `33756217402`; final M7 evidence recorded.

## M8 — Durable missions and worker recovery

- [x] Node 24 SQLite adapter persists canonical M2 mission events with optimistic versions,
  mission-scoped idempotency, canonical UTC metadata, bounded JSON, hashes, and fail-closed replay.
- [x] Derived mission checkpoints persist across close/reopen, reject regression/conflict/corruption,
  and reproduce from canonical events before acceptance.
- [x] Durable jobs provide deterministic atomic claims, bounded attempts, expiring fenced leases,
  hashed opaque lease tokens, retries, cancellation, and terminal blocking on exhaustion.
- [x] Runtime-owned worker timeout, heartbeat, cooperative cancellation, structured settlement, and
  secret-safe error normalization are implemented with injected handlers.
- [x] Mission-scoped lifecycle events expose strictly increasing reconnect cursors and validate hashes.
- [x] Crash/reopen recovery reclaims expired in-flight work at a higher generation and rejects stale
  settlement; a 32-job fixture proves bounded retry/block/cancel/reopen draining.
- [x] Implementation CI observed: run `33766277108`, 149/149 tests passed; aggregate coverage was
  88.91% lines, 76.49% branches, and 95.24% functions.

M8 proves local SQLite restart durability and at-least-once worker delivery. It does not claim hosted
queue semantics, PostgreSQL/service durability, exactly-once external effects, cross-host fencing,
process/container/worktree isolation, or a production sandbox.

## M9 — Client protocol and responsive web shell

- [x] Versioned strict client request/response contracts with bounded user-facing mission projections.
- [x] Runtime-scoped read/command capabilities and exact pause/resume/cancel control only.
- [x] Optimistic expected-version commands plus durable mission-scoped idempotency and stale replay denial.
- [x] Bootstrap and reconnect over M8 lifecycle cursors with deterministic reducer replay and tamper checks.
- [x] Framework-free accessible responsive web fixture for mission state, tasks, budgets, workers,
  verification, reconnect state, and deliberate cancellation.
- [x] One protocol strategy documented for web, iOS/iPadOS/macOS, and Android clients without moving
  canonical long-running state onto devices.
- [x] Implementation CI observed: run `33773644733`, 161/161 tests passed; aggregate coverage was
  89.31% lines, 76.56% branches, and 95.41% functions.

M9 proves the local protocol/controller/reconnect/UI contract. It does not claim a public HTTP service,
authentication, WebSocket/SSE transport, production hosting, push notifications, or native binaries.

## M10 — Progressive skill lifecycle and synthesis

- [x] Immutable versioned skill packages with deterministic SHA-256 content identity and provenance.
- [x] Compact discovery metadata separated from bounded full-instruction loading.
- [x] Learned/community packages enter as non-loadable candidates and cannot self-promote.
- [x] Independent hash-bound verification plus trusted activation, supersession, revocation, and rollback.
- [x] Solved-task synthesis creates candidate-only learned skills behind runtime attestation and idempotency.
- [x] Lifecycle audit history records registration, verification, activation, supersession, rollback, and revocation without private reasoning.
- [x] Required-tool declarations do not create M3 handlers, grants, credentials, or host execution authority.
- [x] Implementation CI observed: run `33777800516`, 172/172 tests passed; aggregate coverage was
  89.84% lines, 76.97% branches, and 95.66% functions.

M10 converts repeated solved procedures into reusable, progressively loaded skill candidates while
keeping execution authority in M3 and completion authority in M5. It does not download or execute
public skills, run arbitrary skill code, or claim autonomous self-improvement/AGI equivalence.

## M11 — Adaptive reasoning, routing, and efficiency

- [x] Empirical capability/quality/cost/latency routing with deterministic quality floors and escalation.
- [x] Cache and concurrency policy that cannot bypass freshness, scope, verification, or budgets.
- [x] Bounded multi-pass critique and targeted self-correction using independent evidence.
- [x] Bounded branch search for ambiguous/high-risk tasks with explicit branch/attempt/call/cost/token ceilings.
- [x] Offline evaluation harness comparing small/fast models against stronger baselines without live provider spend.
- [x] Independent evaluation evidence is bound to exact provider/model/profile/reasoning effort and stale/future/self-authored/tampered evidence fails closed.
- [x] Implementation verification observed: helper run `33784031658`, 199/199 tests passed; aggregate coverage was
  90.01% lines, 76.94% branches, and 95.63% functions.
- [x] Normal pull-request verification observed: run `33784322602` passed on synchronized M11 evidence head.

M11 optimizes price and latency only inside a measured quality floor. Explicit estimated-token and
model-call ceilings bound speculative branch/critique/repair work; bounded plans reserve targeted
repair capacity before spending every remaining call on additional critique. M11 does not claim live
provider benchmark results or permit model self-confidence to become independent completion evidence.

## M12 — Production hardening and release proof

Status: **PARTIALLY_VERIFIED**. Local deterministic M12-A/B/C hardening is verified and one bounded
NVIDIA/Kimi K3 provider path is live-verified; hosted-sandbox and public-production proof remain open.

- [x] Canonical workspace boundary rejects traversal, absolute-path ambiguity, root-prefix confusion,
  and symlink escapes for read/write/cwd resolution.
- [x] Bounded trusted-command subprocess runner uses `shell: false`, deny-by-default environment,
  concurrency ceilings, timeout/cancellation, and independent stdout/stderr byte limits.
- [x] Fail-closed outbound destination policy enforces HTTPS, scoped host/port grants, reserved/private
  address denial, injected DNS evidence, and fresh authorization after destination changes.
- [x] Exact provider/model/profile sandbox bindings select runtime-owned backends and resolve credentials
  only in the control plane; M11 primary/escalation routing feeds that exact identity into allocation.
- [x] Remote sandbox lifecycle uses deterministic allocation keys, collapses concurrent identical creates,
  rejects conflicting replay, requires cleanup, makes release idempotent, and forbids released-session reuse.
- [x] Normal pull-request CI observed: run `33794095989`, 237/237 tests passed; aggregate coverage was
  89.43% lines, 76.28% branches, and 95.37% functions.
- [x] M12-C structured secret-safe observability, deterministic load/recovery evidence, backup/restore
  contracts, integrity-bound release manifests, and fail-closed local/integration/live release gates.
- [x] M12-C normal PR CI observed: run `33796268313`, 258/258 tests passed; aggregate coverage was
  89.29% lines, 76.24% branches, and 95.64% functions.
- [x] Local verify + recovery + restore evidence can pass only the `local` release gate; the same evidence
  is explicitly proven insufficient for `integration` and `live` claims.
- [x] One bounded real NVIDIA `moonshotai/kimi-k3` coding mission through Odin M1/M2/M3/M4/M5: run
  `33837291528`, score 100/100, first pass, one provider call, 632 input / 222 output tokens, M5 PASS.
- [ ] Hosted-sandbox live smoke and broader live-provider evaluation matrix against separately authorized resources.
- [ ] Public-service authentication/realtime transport and deployment hardening after local boundaries remain intact.

M12-A/B/C prove local deterministic enforcement, a provider-neutral remote-sandbox lifecycle contract,
secret-safe observability, deterministic recovery/backup evidence, and fail-closed release-claim levels.
M12-D additionally proves one real NVIDIA/Kimi K3 provider path on a bounded coding fixture. It does
**not** prove Docker/Kubernetes/VM isolation, a hosted sandbox API, broad live-model superiority,
deployment, production auth, cloud backup guarantees, or public traffic.

## M13 — Evidence-backed post-task learning and memory curation

- [x] Exact M5-backed learning attestations bind user/project/mission/task, semantic-key hash, lesson hash, sensitivity, verification-result hash, and evidence references.
- [x] One or two distinct verified tasks remain tentative; three distinct verified tasks are required before a lesson becomes established.
- [x] Conflicting lessons under one scoped key block nudging and M6 promotion until deterministic maintenance resolves the conflict.
- [x] Established learning enters M6 only as lower-authority `verified_learning` semantic memory and remains invisible to broad retrieval without explicit `m13-learning` opt-in.
- [x] Exact replay is idempotent without a fresh evidence lookup; changed replay input fails closed before evidence lookup and the post-await replay check still protects races.
- [x] Obvious credential-like content is rejected across semantic keys, lessons, tags, and source references via the shared M12/M13 secret-text primitive.
- [x] M13 cannot mint M3 tools/capabilities, promote M10 skills, infer durable user preferences, raise budgets, alter routing floors, or mark tasks complete.
- [x] Corrected implementation verification: run `33852005166`, 272/272 tests, 89.42% line / 76.50% branch / 95.67% function coverage.

M13 makes successful verified work compound without converting memory into authority. It is capability amplification, not evidence of AGI/ASI or permission for recursive self-modification.

## M14 — Skill intake firewall

- [x] Discover external Agent Skills / Claude plugins without executing third-party code during intake.
- [x] Resolve mutable refs to immutable commit SHAs and bind repository, subdirectory, manifest, license metadata, and inspected content hashes.
- [x] Bound file count, byte size, depth, symlinks, binaries, scripts, hooks, MCP configuration, workflows, and incomplete inventory.
- [x] Emit stable risk findings for prompt injection, credential collection, exfiltration, shell/subprocess use, destructive writes, self-promotion, memory poisoning, MCP/tool poisoning, dependency installation, and privilege escalation.
- [x] Treat incomplete/partial/failed analysis as non-safe and quarantine rather than silently accepting.
- [x] Convert only fully analyzed accepted material into M10 `community` candidates with `requiredTools=[]`; intake never activates a skill or creates M3 authority.
- [x] Pin reviewed source snapshots and require a new intake result whenever immutable source/content identity changes.

Implementation verification: normal PR CI `33858888408` passed **290/290 tests**, Biome, strict TypeScript, and the secret-free Kimi dry smoke. Aggregate coverage was **89.47% lines / 76.70% branches / 95.84% functions**; `skill-intake/firewall` coverage was **90.20% / 79.74% / 98.61%**. Malformed manifests and nested `.github/workflows` surfaces have dedicated fail-closed regressions. A final synchronized exact-head CI is still required before merge.

Research fixtures pinned for M14/M15: `ComposioHQ/awesome-claude-skills@be2a406907dbc61b73e6827ded415c96139d13a2`, `multica-ai/andrej-karpathy-skills@2c606141936f1eeef17fa3043a72095b4765b9c2`, `alirezarezvani/claude-skills@19392f7a08264ed00486a251f5b2098321771f94`, `anthropics/claude-plugins-official@1dd995193ba20bba51ca6c681aa8d3398dbd80a2`, `coreyhaines31/marketingskills@5cd4a7eae3a9a7b5d2aceb0613f7d1f7c4b65968`, `anthropics/claude-code-security-review@0c6a49f1fa56a1d472575da86a94dbc1edb78eda`, and `0xNyk/awesome-hermes-agent@e4dde5e0e19b734c175a34038deac8e80cd04cb2`. These are discovery/research inputs, not transitive trust.

## M15 — Curated capability pack and offline improvement evaluation

- [x] Runtime-owned procedure catalogs deduplicate candidate behavior against canonical Odin M2/M4/M5/M7/M10/M11 behavior before evaluation.
- [x] Exact candidate name/version/content hash, domain, task classes, context bounds, trusted runtime time, and independent evidence are validated fail-closed.
- [x] Paired held-out curation fixtures enforce quality floors, safety/authority PASS, token/latency ceilings, minimum average lift, deterministic report identity, and no M10 activation.
- [x] Progressive capability-pack registry accepts only exact VERIFIED/ACTIVE community members whose M10 verification is bound to the same integrity-valid passing M15 evidence; discovery stays compact.
- [x] Odin-owned coding, research, security, product/business, and marketing procedure drafts preserve existing M3/M5/M6/M10/M11 authorities; unproven data/documents remains absent.
- [x] Bounded offline replay emits only KEEP/RETEST/COMPRESS/DEDUPLICATE/REVIEW proposals and has no skill, memory, tool, credential, budget, or completion mutation interface.
- [x] Confirmed hardening regressions cover stale-evidence rescue, future caller timestamps, self-declared procedure novelty, forged/mismatched pack evidence, and fail-closed live A/B arm failures.
- [x] Attempt the first bounded post-merge Kimi K3 baseline-vs-candidate provider A/B and preserve its sanitized evidence; run `33870210502` used 10/12 provider calls but produced zero complete matched pairs, so the result is INCONCLUSIVE.
- [ ] Obtain complete matched provider evidence before populating any measured coding pack; only an exact candidate that passes the normal quality/safety/authority/token/latency gates may enter the pack.

Implementation verification helper run `33866236138` passed **319/319 tests**, Biome, strict TypeScript, and secret-free Kimi dry smoke after the final curation/A-B hardening. Aggregate coverage was **89.81% lines / 77.03% branches / 95.85% functions**. `capability-packs/curator` reached **95.48% / 81.05% / 97.22%**, registry **90.43% / 77.88% / 95.24%**, and replay **92.86% / 89.74% / 100%**. Normal exact-head PR CI `33870080147` passed and PR #20 was merged into `main` as `30bcab22f6129925b704fff0d024ca40e472b06c`. The post-merge run does not verify a coding winner: all six arms were incomplete, no distilled candidate is ACTIVE, and no broad model-quality claim is made.

## Post-MVP capability track

- [ ] Production hybrid memory retrieval/retention (lexical/FTS plus optional vector retrieval) behind M6 scope and privacy rules.
- [ ] Event-driven background mission service, scheduler/triggers, and resumable automation.
- [ ] Permissioned MCP/Agent-Skills-style adapters and omnichannel clients behind the same capability model.

## MVP definition of done

MVP requires a user-supplied provider key, workspace, complex coding request, automatic plan and task
graph, targeted repository retrieval, scoped edits, tests, diagnosis and repair, durable mission
resume, token/cost display, and an evidence-backed final report. A mock-only demonstration does not
satisfy MVP.