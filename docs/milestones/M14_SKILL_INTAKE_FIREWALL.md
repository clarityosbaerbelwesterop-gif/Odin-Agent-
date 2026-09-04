# M14 — Skill intake firewall

Status: **IMPLEMENTATION_IN_PROGRESS**. Updated: 2026-09-04.

## Objective

Let Odin discover large public Agent-Skills / Claude-plugin ecosystems without turning third-party text,
scripts, hooks, MCP configuration, or mutable Git refs into trusted runtime behavior. M14 converts one
bounded external skill snapshot into an immutable, risk-scored intake report and may hand only a fully
analyzed accepted skill to M10 as a `community` **CANDIDATE**.

M14 is capability acquisition, not automatic trust. It never executes third-party code, never activates a
skill, never registers an M3 tool, never resolves third-party credentials, and never treats a catalog's
endorsement as transitive evidence.

## Source identity

Every intake request names a repository, requested ref, exact skill path, and observation time. A trusted
source adapter resolves that request to one immutable 40-hex Git commit plus a bounded snapshot. The
firewall verifies that repository/ref/path identity matches the request and binds the final report to:

- repository + requested ref;
- exact resolved commit SHA;
- exact selected skill path;
- normalized license metadata;
- path/content hashes for all inspected text;
- explicit completeness/limitation records;
- risk findings and deterministic report hash.

Changing the commit or content requires a new report and a new M10 candidate version. Mutable refs are
never themselves proof.

## Initial pinned discovery sources

The user supplied these sources. They are discovery/research inputs only until each individual skill is
resolved and analyzed:

- `ComposioHQ/awesome-claude-skills@be2a406907dbc61b73e6827ded415c96139d13a2`
- `multica-ai/andrej-karpathy-skills@2c606141936f1eeef17fa3043a72095b4765b9c2`
- `alirezarezvani/claude-skills@19392f7a08264ed00486a251f5b2098321771f94`
- `anthropics/claude-plugins-official@1dd995193ba20bba51ca6c681aa8d3398dbd80a2`
- `coreyhaines31/marketingskills@5cd4a7eae3a9a7b5d2aceb0613f7d1f7c4b65968`
- `anthropics/claude-code-security-review@0c6a49f1fa56a1d472575da86a94dbc1edb78eda`
- `0xNyk/awesome-hermes-agent@e4dde5e0e19b734c175a34038deac8e80cd04cb2`

`anthropics/claude-code-security-review` is a useful security-analysis reference, not trusted intake code.
Its own documentation explicitly warns that the action is not hardened against prompt injection, so Odin
must preserve its separate trust boundary and complete-coverage evidence rather than inheriting the action's
assumptions.

`0xNyk/awesome-hermes-agent` is an independent ecosystem directory, not a security endorsement. Its own
trust-boundary guidance treats skills/plugins/MCP servers as discovery inputs whose triggers, tools,
credentials, execution environment, and stop controls must be reviewed before use.

`NVIDIA/SkillSpector` was reviewed as a security-design reference. Odin adapts its fail-closed resource-
bound/completeness principles but does not install or copy SkillSpector as a dependency.

## Resource ceilings

Default M14 analysis is intentionally smaller than a general repository scanner:

- at most 256 inventory entries per selected skill;
- at most 4 MiB total inspected text;
- at most 256 KiB per text file;
- at most 16 path segments;
- at most 256 retained findings;
- one selected skill per report;
- no archive expansion, package installation, subprocess, shell, browser, MCP, or network execution.

Crossing a ceiling is not a clean result. It makes analysis `PARTIAL` and the decision at least
`QUARANTINE`. Binary, symlink, omitted, unresolved-reference, malformed-manifest, or unknown-license
coverage is similarly explicit.

## Static risk classes

M14 produces stable fingerprinted findings without retaining matched secret/raw snippets. Required classes:

- prompt-instruction override / prompt injection;
- credential collection or secret handling requests;
- data exfiltration / credential-bearing outbound transfer;
- remote execution such as download-and-pipe-to-shell;
- destructive filesystem/repository/database writes;
- privilege escalation;
- self-installation, self-promotion, or trusted-policy mutation;
- durable memory/policy poisoning;
- MCP/tool configuration capable of introducing execution authority;
- hooks/workflows that execute automatically, including nested `.github/workflows` surfaces inside a selected skill;
- dependency installation;
- shell/subprocess instructions or executable bundled scripts.

Critical findings => `REJECT`. High findings => at least `QUARANTINE`. A fully complete report with only
low/medium findings may be `ACCEPT`, but M10 still records only a candidate.

## Agent-Skills manifest handling

M14 reads only bounded `SKILL.md` frontmatter and body. It extracts a compact name and description and
hashes the exact instructions. Malformed or invalid manifest values are represented as explicit partial
coverage and quarantine rather than escaping the intake boundary as an unhandled parser failure. Auxiliary
text is analyzed for risk/completeness but is not granted tool or execution authority. Bundled scripts remain
data even if the report is accepted.

## M10 handoff

Only `ACCEPT + COMPLETE` can produce a package for `SkillRegistry.registerCandidate`:

- `trustClass = community`;
- deterministic external name scoped by source identity;
- commit-derived immutable version;
- exact analyzed SKILL.md instructions;
- `requiredTools = []` at intake;
- provenance reference binds repository, commit, skill path, and intake report hash;
- `testRefs` bind the M14 report;
- lifecycle remains `CANDIDATE`.

The candidate cannot load through normal M10 resolution and cannot activate until independent M10
verification and trusted promotion occur. M14 cannot create tool handlers, capability grants, credentials,
workers, approvals, budgets, or completion evidence.

## Required regression scenarios

1. complete safe `SKILL.md` -> deterministic `ACCEPT` -> M10 `CANDIDATE`, normal resolve denied;
2. input file ordering cannot change file/report hashes;
3. source repository/ref/path mismatch or non-commit resolved identity fails closed;
4. prompt injection / exfiltration / remote-exec / privilege escalation becomes `REJECT`;
5. credential collection / policy-memory mutation / MCP / hook-workflow content becomes `QUARANTINE`;
6. dependency/shell procedure is surfaced even when accepted as lower-risk candidate data;
7. binary/symlink/oversize/unknown-license/incomplete inventory cannot report safe;
8. finding-output ceiling cannot turn a truncated scan into `ACCEPT`;
9. source or content change changes report identity and candidate version/hash;
10. M14 candidate creation leaves M3 `ToolRegistry` empty and M10 lifecycle unprivileged;
11. a broad catalog link is discovery metadata only; its downstream repository requires a separate intake;
12. malformed manifests become explicit partial quarantine instead of unhandled parser errors;
13. nested `.github/workflows` surfaces inside a selected skill are detected and quarantined.

## Acceptance gate

M14 is VERIFIED only when implementation, adversarial tests, synchronized ROADMAP/ARCHITECTURE/SECURITY/
HANDOVER, and a normal exact-head `npm run verify` pass in GitHub Actions. No live provider or third-party
skill execution is required.
