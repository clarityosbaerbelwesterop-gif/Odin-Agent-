import type { CapabilityDomain } from "./types.js";

export const ODIN_CANONICAL_PROCEDURE_KEYS = Object.freeze([
  "coding.repository-map",
  "coding.targeted-patch",
  "coordination.parallel-specialists",
  "mission.plan-task-dag",
  "routing.quality-floor",
  "skills.progressive-loading",
  "verification.evidence-binding",
] as const);

export const M15_ADDITIVE_PROCEDURE_KEYS: Readonly<Record<CapabilityDomain, readonly string[]>> =
  Object.freeze({
    coding: Object.freeze([
      "coding.assumption-grounding",
      "coding.no-invented-api",
      "coding.surgical-diff",
      "coding.yagni-minimality",
    ]),
    "data-documents": Object.freeze([]),
    marketing: Object.freeze(["marketing.customer-language", "marketing.switching-dynamics"]),
    "product-business": Object.freeze(["product.anti-persona", "product.structured-context"]),
    research: Object.freeze([
      "research.falsifiable-hypotheses",
      "research.opposition-query",
      "research.refresh-targets",
      "research.source-type-diversity",
    ]),
    security: Object.freeze([
      "security.concrete-exploit-path",
      "security.diff-aware-attack-surface",
      "security.false-positive-filter",
    ]),
  });
