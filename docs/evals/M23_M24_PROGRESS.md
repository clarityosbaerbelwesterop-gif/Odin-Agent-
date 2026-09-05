# M23–M24 implementation checkpoint

- M23 Skill OS implementation is present on PR #33. Normal PR CI run `33953811462` passed on the user-authored M23 head after the formatting repair, including full `npm run verify` and credential-free Kimi dry smoke.
- M23 selection remains metadata-first and instruction loading is progressive. Pack registration is accepted only when the exact pack identity is present in the trusted capability-pack source and every exact member remains resolvable. Pin/rollback changes runtime pack routing only; it does not call M10 activation or create M3 tool authority.
- M24 Advanced Memory is implemented and formatted. The next normal exact-head PR CI is the required verification checkpoint before M25 work is considered verified.
- M24 treats current-source observations as higher authority than project-memory conclusions, blocks equally fresh conflicting project memories, provides bounded retention/tombstone delegation, and binds compressed summaries to exact source record hashes as lower-authority `model_summary` project memory.
- No live provider, browser, database, cloud, API, deployment, paid-resource, migration, billing, or public-traffic action is part of this checkpoint.
