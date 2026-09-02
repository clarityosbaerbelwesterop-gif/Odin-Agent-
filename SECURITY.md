# Security model

Status: design baseline plus M1 provider-boundary controls. Controls not explicitly identified as
implemented remain future work.

## Protected assets

- provider and integration credentials;
- user repositories, documents, memory, artifacts, and personal data;
- mission integrity, budgets, approvals, and audit history;
- execution hosts, network access, connected devices, and external accounts;
- system-protected skills, policies, and release artifacts.

## Trust boundaries

Trusted: the minimal control plane, policy engine, secret broker, validated protocol handlers, and
durable state layer.

Untrusted by default: user input, web/email/chat content, repositories being analyzed, dependency
metadata, tool output, model output, community skills/plugins, generated code, browsers, and workers.
An instruction embedded in untrusted content never becomes runtime authority.

## Default policy

```yaml
filesystem: task-workspace-only
network: deny
secrets: deny-direct-access
host-execution: deny
privileged-execution: deny
external-write: require-scoped-grant
high-impact-action: require-explicit-approval
```

Capabilities bind subject, tenant, mission, task, tool, resource, allowed operation, network scope,
secret handle, call limit, and expiry. Policy decisions are `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, or
`ALLOW_WITH_RESTRICTIONS`. Denial is the fallback for malformed or missing policy data.

## Credential handling

Long-lived credentials reside only in a protected credential store. Models and normal worker
processes receive neither raw keys nor a general-purpose environment containing them. The control
plane proxies requests or issues the narrowest possible short-lived handle. Redaction applies before
logs, events, artifacts, errors, memory, or crash reports are persisted.

The committed `.env.example` contains names and blank values only. Real `.env` files are ignored.

The M1 adapters resolve a credential only after request shape and capability checks pass. They deny
redirects and obvious private-network base URLs by default, reject credentials containing header
delimiters, bound response/event sizes, and normalize transport errors without copying thrown
messages. DNS rebinding protection and destination re-resolution still belong to the later network
policy boundary and are not claimed here.

## Execution and network

Generated commands run in ephemeral, resource-limited workspaces with explicit filesystem roots,
CPU/memory/time/output limits, and destination-based network policy. Paths are canonicalized and
checked against allowed roots to resist traversal and symlink races. HTTP tools resolve and validate
destinations before and after redirects to prevent SSRF and private-network access.

Plugins capable of code execution run out of process over authenticated, versioned RPC. Packages are
pinned, provenance is recorded, and community extensions begin with no authority.

## Prompt injection and durable learning

Every context item carries origin and trust metadata. Tool results are quoted as data. Model output
is schema-validated before it can request a transition or tool. Untrusted observations cannot modify
policy, system-protected skills, credentials, or durable user preferences.

Agent-learned skills follow candidate, provenance review, replay tests, independent verification,
versioned staging, and promotion. All promotions are reversible and auditable.

## Audit and privacy

Consequential records contain initiator, mission/task, action type, input hash, policy decision,
result, side-effect summary, verification, and timestamp. Do not persist private chain-of-thought;
store concise decision records and evidence. Memory is namespaced, versioned, exportable, selectively
deletable, and retention-aware.

## Threats required in security tests

- prompt injection requesting secrets or durable authority;
- malicious tool arguments and malformed model JSON;
- path traversal, symlink escape, and unsafe archive extraction;
- SSRF, DNS rebinding, redirect bypass, and network exfiltration;
- secrets in logs, errors, command lines, patches, or artifacts;
- replayed external writes and duplicated payments/messages/deployments;
- confused-deputy access across user, tenant, mission, task, or device;
- compromised plugin/skill packages and dependency substitution;
- privilege escalation through retries, repair loops, or fallback providers;
- race conditions between cancellation, checkpointing, tools, and completion;
- budget bypass and denial-of-wallet;
- recovery from tampered or incompatible checkpoints.

## Vulnerability reporting

Do not open a public issue containing an exploitable vulnerability, credential, or private user data.
Use the repository owner's private security reporting channel when enabled. Until that channel is
configured, contact the owner privately and provide the smallest safe reproduction.
