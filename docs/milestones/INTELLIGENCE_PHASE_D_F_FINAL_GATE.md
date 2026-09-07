# Intelligence D–F final merge gate

Status: **FINAL_CI_PENDING**.

This checkpoint is intentionally user-authored after governance synchronization so the normal pull-request CI executes on the exact candidate head before merge.

Verified evidence already complete:

- Phase D exact-head CI: `34091888679` — PASS.
- Phase E exact-head CI: `34092487219` — PASS.
- Phase F normal CI: `34095946506` — PASS.
- Package adversarial hardening: `34097050800` — PASS, 492/492 tests, 90.02% line / 76.67% branch / 96.05% function aggregate coverage.
- Governance synchronization: `34098623883` — PASS for repository verify and build.

Authority boundaries remain unchanged: Phase F is evaluation-only, routing/promotion eligibility remains false, and no live-provider result can bypass M5/M11/M21/M22/release gates.

Merge rule:

1. require one fresh normal CI success on this exact head;
2. require PR #36 to remain mergeable;
3. squash merge with expected-head SHA pin only after both conditions hold.

Post-merge, exactly three bounded Kimi live evaluations are separately authorized by the user. They are task/profile-specific measurement evidence only and do not become automatic routing, promotion, production, or universal model-performance claims.
