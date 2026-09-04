# Engineering handover

Updated: 2026-09-04.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M13 at `1a8ac95b757ad6ef44a03dadd0f1071ee4c7547d`.
- Active work: M14 **Skill Intake Firewall** on `agent/m14-skill-intake-firewall`, Draft PR #19.
- M14 now implements immutable source identity, bounded static inventory/analysis, explicit COMPLETE/PARTIAL plus ACCEPT/QUARANTINE/REJECT decisions, hash-only findings, M10 community-candidate handoff, and no third-party execution.
- Adversarial coverage now includes exfiltration, privilege escalation, policy/memory poisoning, hooks, shell procedures, symlinks, byte/file ceilings, path escape/duplicates, malformed manifests, and nested `.github/workflows` surfaces.
- Two review-found implementation gaps were hardened before verification: malformed manifest values now become explicit partial quarantine instead of escaping as parser errors, and nested workflow surfaces inside a selected skill are detected.
- Strict TypeScript exposed one test-only narrowing defect in the initial M14 suite; the assertion was made type-safe without weakening the denied-lifecycle expectation.
- CI run `33858667944` reached Biome PASS but stopped at that strict test type error before the fix. The subsequent candidate run `33858888408` stalled in `npm ci` before any repository gate; a new exact-head run is required and remains authoritative.
- M12 remains partially verified for hosted-sandbox/public-production claims. Do not spend money, create paid resources, deploy production, or repeat live-provider calls without explicit authorization.
- One additional bounded Kimi K3 A/B comparison remains planned only after M15 curated capability winners are actually integrated.

## M14 capability candidate

`src/skill-intake` treats every community skill/plugin snapshot as untrusted data. A trusted resolver must bind repository, requested ref, selected path, and one immutable 40-hex commit. Analysis is bounded by file count, per-file bytes, total bytes, path depth, and finding count. Opaque binaries/symlinks, unknown license state, truncation, invalid manifests, and incomplete inventory force `PARTIAL` and cannot silently become safe.

Static findings cover prompt override, credential collection, exfiltration, download-and-execute patterns, destructive writes, privilege escalation, self-promotion, policy/memory poisoning, dependency installation, explicit shell/subprocess use, MCP configuration, hooks/workflows, and executable surfaces. Matched raw snippets are not persisted in findings; stable fingerprints and content hashes carry evidence identity.

Only `COMPLETE + ACCEPT` may be converted into an M10 `community` candidate. Intake forces `requiredTools=[]` and cannot activate a skill, register M3 handlers, create capabilities, expose credentials, change budgets/routing, or create completion evidence. M10 verification/promotion remains a separate authority boundary.

## External capability research for M14/M15

Seven user-supplied repositories are now pinned as immutable discovery/research inputs, not installed or executed:

- `ComposioHQ/awesome-claude-skills@be2a406907dbc61b73e6827ded415c96139d13a2` — broad community discovery catalog and MCP/action examples; breadth/stress corpus only, never transitive trust.
- `multica-ai/andrej-karpathy-skills@2c606141936f1eeef17fa3043a72095b4765b9c2` — coding discipline around assumptions, simplicity, surgical edits, and verifiable success; adapt into Odin-owned policy/evals rather than higher-authority external instructions.
- `alirezarezvani/claude-skills@19392f7a08264ed00486a251f5b2098321771f94` — large skill/script/hook corpus useful for M14 supply-chain and executable-surface stress tests.
- `anthropics/claude-plugins-official@1dd995193ba20bba51ca6c681aa8d3398dbd80a2` — official marketplace reference with immutable-source metadata while still warning that third-party plugins are not automatically safe.
- `coreyhaines31/marketingskills@5cd4a7eae3a9a7b5d2aceb0613f7d1f7c4b65968` — domain workflows for product context, CRO, copy, SEO/AEO, pricing, launch, analytics, and sales; candidate source for a measured M15 business/marketing pack.
- `anthropics/claude-code-security-review@0c6a49f1fa56a1d472575da86a94dbc1edb78eda` — security-review reference. Its own README warns it is not hardened against prompt injection, so Odin must preserve its independent trust boundary and complete-coverage evidence rather than inheriting the action as trusted code.
- `0xNyk/awesome-hermes-agent@e4dde5e0e19b734c175a34038deac8e80cd04cb2` — independent Hermes ecosystem catalog. Its own guidance treats listings as discovery aids, not security endorsements, and calls for reviewing triggers, tools, credentials, execution environment, and stop controls.

Additional security research: `NVIDIA/SkillSpector` uses bounded multi-stage scanning and distinguishes partial/static analysis from a fully clean result. Odin adapts the fail-closed ideas without installing or copying the scanner as a dependency.

No third-party code from these sources was executed during M14 research/intake work.

## Next milestones

1. Obtain one normal PR-specific `npm run verify` on the current M14 implementation candidate and fix any remaining real failure without weakening a gate.
2. Synchronize `ROADMAP.md`, `ARCHITECTURE.md`, `SECURITY.md`, and the M14 milestone to the verified evidence, then obtain a final normal exact-head CI.
3. Keep PR #19 unmerged until merge is explicitly authorized in the current request context.
4. After M14 is merged, create a fresh M15 branch: **Curated Capability Pack + offline improvement evaluation**. Deduplicate candidate procedures against Odin's canonical runtime, evaluate quality/safety/context-cost lift on held-out fixtures, and promote only measured winners through M10.
5. After M15 winners are integrated, run the separately bounded NVIDIA/Kimi K3 A/B comparison using sanitized evidence only. Do not infer broad model superiority from one fixture.
6. Keep scheduler/triggers/background missions and permissioned MCP/Agent-Skills adapters as separate no-cost milestones before any public production deployment.

## Standing boundaries

- Repository evidence overrides documentation and memory; CI green is required before merge.
- M3 remains execution/capability authority; M5 remains completion/evidence authority; M10 remains skill promotion authority.
- Models/workers/skills/memory cannot mint credentials, capabilities, approval, budgets, quality evidence, or trusted policy.
- External skill catalogs are discovery inputs only until exact-source M14 analysis and M10 lifecycle requirements succeed.
- No secrets in commits/logs/artifacts and no paid/live infrastructure actions without explicit user approval.
