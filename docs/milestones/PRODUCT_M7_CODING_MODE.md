# PRODUCT M7 — Coding Mode

Status: implementation, deterministic acceptance and full repository verification complete on the PRODUCT M7 branch; final exact-head PR CI and merge evidence pending.

PRODUCT M7 exposes Odin's existing coding depth as a professional developer workspace. It does not introduce another Git client, coding runtime, Mission authority, Skill engine, verifier or unrestricted shell. `GitHubWorkspace`, `GitHubPullRequestClient`, canonical Hosted Runs, repository tools, M25 permissions, M5 verification and PRODUCT M5 Skills remain authoritative.

## Product flow

```text
Selected GitHub repository
→ canonical Coding Run
→ bounded repository tree/search/read
→ isolated odin/* work branch
→ real repository patches
→ real quality / CI evidence
→ reviewable diff
→ fail-closed PR readiness gate
→ GitHubPullRequestClient delivery
```

## Repository browser and viewer

Coding Mode reads the selected connected repository through the existing `GitHubWorkspace`. Tree results are bounded, paths are normalized, unsupported/binary content is rejected, file reads are byte-limited and text search is bounded. Repository text is untrusted data; a README or source file cannot grant tools, credentials, network access, approval or policy authority.

The product surface exposes repository files/search/changed files and a line-oriented source viewer. It is deliberately not a replacement for VS Code; agent mutations continue through scoped repository tools rather than browser-controlled arbitrary filesystem access.

## Diff authority

Changes are derived from canonical `file.changed` evidence/checkpoint `ChatChange` records plus the actual isolated GitHub branch state. Modified/additional content is reviewable as a bounded unified diff with additions/removals. Base SHA, work branch and head SHA are repository evidence, not assistant prose.

## Branch isolation and resume

Ordinary Coding Runs use the existing `odin/YYYY-MM-DD/<id>` work-branch architecture and never write directly to canonical `main`. Checkpoints persist repository identity, original base SHA, exact isolated work branch, current head SHA and persisted write hashes. Resume reconstructs the same branch. If a stored branch lacks repository/base provenance, Odin fails closed rather than silently creating a replacement branch.

Git commit identities accept the real GitHub SHA forms used by this path. Remote base/work-branch identities are revalidated before delivery.

## Quality and CI evidence

Coding Mode projects actual repository quality evidence. Repository checks distinguish passing/failing CI from the existing no-CI branch-integrity fallback. Branch integrity proves only that intended writes persisted; it never becomes a false `tests passed` claim. Quality evidence must be newer than the latest source mutation before final PR delivery.

## PR delivery gate

PR creation fails closed unless the canonical Run is `COMPLETED`, real repository changes exist, passing current quality evidence exists after the last mutation, repository/branch/base/head provenance is complete, the configured repository matches, the base remains current and changed content passes secret screening. A moved base blocks delivery and requires reconciliation rather than silent overwrite.

`GitHubPullRequestClient` remains the delivery authority. M7 does not create a second PR client or write directly to main.

## Review mode

Review reads actual GitHub PR status and bounded changed-file patches. Findings therefore have concrete file/diff evidence. Unsupported or unavailable patch evidence remains unavailable; Odin does not fabricate line findings.

## Skills, Memory and context

Coding Runs continue through PRODUCT M5 Skill selection and the existing Context Compiler. Repository conventions or architecture decisions may become PRODUCT M3 Memory only through existing eligible memory paths. Temporary compiler errors, old logs and arbitrary source snippets do not become permanent truth merely because Coding Mode saw them.

## Deterministic acceptance

### Acceptance #1 — failing login test

The fixture requires repository inspection, an initial patch, a real failed quality check, diagnosis/repair, a subsequent passing check and final verification. The acceptance intentionally proves failure-and-repair rather than a mocked green-only path, and the resulting source mutation remains reviewable.

### Acceptance #2 — multi-file feature with resume

The fixture applies one scoped change, pauses the canonical Run, resumes the same Run/branch, applies the second scoped change and verifies after the final mutation. The branch and repository provenance remain continuous across the interruption.

## Security boundaries

Repository instructions are untrusted input. Existing Tool Gateway/M25 capability policy, normalized repository paths, sandbox/network rules, secret detection, approval policy and verification remain authoritative. M7 adds explicit regressions for traversal, binary/large-file handling, malicious repository instructions, invalid restored Git identities, failed/missing CI, PR permission failures, incomplete provenance and stale quality evidence.

There is no unrestricted terminal. Model-proposed arbitrary command text cannot become execution; only registered quality command identifiers and existing sandbox/tool policy are accepted.

## Responsive experience

Desktop can present repository + source/diff + Odin together. iPad landscape keeps the main editor/diff primary while repository and Companion remain accessible. iPad portrait switches focused surfaces instead of squeezing a three-column desktop IDE into the screen.

## Verification evidence

The original pre-PR run `34767187345` failed at Biome. The root cause was M7 formatting/CSS cascade violations. After repairing that, strict TypeScript exposed incomplete GitHub resume provenance call sites; those were upgraded to repository/base-aware fail-closed restore. Later domain verification exposed stale fixtures, acceptance assertions that ignored final re-verification, a branch-regex test defect and a real 40-character Git SHA restore bug. Those were repaired and covered by new repository-security and PR-readiness regressions.

Full `npm run verify` passed on `feebe53ab81e3eaa0ae81a91c26df910a012b17f` after the repairs and cleanup. The focused domain gate passed 667/667 tests at the repository's 80.00% line-coverage floor before that final full verify. A fresh exact-head normal PR CI remains mandatory after temporary milestone workflows are removed.

## Known boundaries

- Coding Mode is a professional Odin coding workspace, not a full VS Code clone.
- When canonical base moves, M7 blocks PR delivery and surfaces reconciliation rather than automatically guessing a rebase/merge strategy.
- Repositories without CI receive branch-integrity persistence evidence only; test correctness remains unverified until real checks exist.
- Live third-party GitHub behavior beyond the connected repository's actual API responses is not fabricated from deterministic fixtures.
