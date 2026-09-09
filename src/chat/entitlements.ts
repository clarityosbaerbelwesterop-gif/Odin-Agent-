import { ChatError, type ChatMode, type ProductPlan } from "./types.js";

const RANK: Readonly<Record<ProductPlan, number>> = { free: 0, pro: 1, ultra: 2 };

export function planAllowsPlan(account: ProductPlan, required: ProductPlan): boolean {
  return RANK[account] >= RANK[required];
}

export function planAllowsMode(plan: ProductPlan, mode: ChatMode): boolean {
  if (mode === "coding" || mode === "thinking") return RANK[plan] >= RANK.pro;
  if (mode === "ultra") return plan === "ultra";
  return true;
}

export function requireModeEntitlement(plan: ProductPlan, mode: ChatMode): void {
  if (!planAllowsMode(plan, mode)) {
    throw new ChatError(
      "PLAN_REQUIRED",
      mode === "ultra"
        ? "Ultra mode requires an active Ultra subscription."
        : "Coding and Thinking require an active Pro or Ultra subscription.",
      403,
    );
  }
}

export function effectivePlan(plan: ProductPlan, status: string): ProductPlan {
  if (plan === "free") return "free";
  return status === "active" || status === "trialing" ? plan : "free";
}
