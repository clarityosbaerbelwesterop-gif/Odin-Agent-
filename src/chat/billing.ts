import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { NeonActorDatabase } from "./neon-database.js";
import type { SubscriptionState } from "./product-store.js";
import { ChatError, type ProductPlan } from "./types.js";

const STRIPE_API = "https://api.stripe.com/v1";
const WEBHOOK_TOLERANCE_SECONDS = 300;

interface StripeConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly proPriceId: string | null;
  readonly ultraPriceId: string | null;
}

export interface BillingPlanView {
  readonly id: ProductPlan;
  readonly label: string;
  readonly checkoutConfigured: boolean;
}

function stripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const secretKey = env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!/^sk_(?:live|test)_[A-Za-z0-9_]{12,}$/u.test(secretKey) || /[\r\n]/u.test(secretKey))
    throw new ChatError("STRIPE_CONFIG", "Stripe billing is not configured.", 503);
  if (!/^whsec_[A-Za-z0-9_]{12,}$/u.test(webhookSecret) || /[\r\n]/u.test(webhookSecret))
    throw new ChatError("STRIPE_CONFIG", "Stripe webhook verification is not configured.", 503);
  const price = (value: string | undefined): string | null =>
    value && /^price_[A-Za-z0-9]+$/u.test(value) ? value : null;
  return {
    secretKey,
    webhookSecret,
    proPriceId: price(env.STRIPE_PRO_PRICE_ID),
    ultraPriceId: price(env.STRIPE_ULTRA_PRICE_ID),
  };
}

export function billingPlans(env: NodeJS.ProcessEnv = process.env): readonly BillingPlanView[] {
  let config: StripeConfig | null = null;
  try {
    config = stripeConfig(env);
  } catch {
    // Public plan availability must be safe even while operators finish secret wiring.
  }
  return [
    { id: "free", label: "Free", checkoutConfigured: true },
    { id: "pro", label: "Pro", checkoutConfigured: !!config?.proPriceId },
    { id: "ultra", label: "Ultra", checkoutConfigured: !!config?.ultraPriceId },
  ];
}

function priceFor(plan: ProductPlan, config: StripeConfig): string {
  if (plan === "pro" && config.proPriceId) return config.proPriceId;
  if (plan === "ultra" && config.ultraPriceId) return config.ultraPriceId;
  throw new ChatError(
    "PLAN_NOT_CONFIGURED",
    "This paid plan does not have an approved live Stripe price yet.",
    503,
  );
}

function form(input: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    result.set(key, String(value));
  }
  return result;
}

async function stripePost<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  secretKey: string,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form(params),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    const code = typeof error?.code === "string" ? error.code : "stripe_error";
    if (code === "resource_missing")
      throw new ChatError("STRIPE_PRICE", "The configured Stripe price is unavailable.", 503);
    throw new ChatError("STRIPE_UPSTREAM", "Stripe could not complete the billing request.", 502);
  }
  return payload as T;
}

export async function createSubscriptionCheckout(input: {
  plan: ProductPlan;
  userId: string;
  email: string;
  origin: string;
  requestId: string;
  subscription: SubscriptionState;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  if (input.plan === "free") throw new ChatError("INVALID_PLAN", "Free does not require Checkout.");
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(input.requestId))
    throw new ChatError("INVALID_REQUEST_ID", "Billing request identity is invalid.");
  if (["active", "trialing", "past_due"].includes(input.subscription.status)) {
    if (input.subscription.plan === input.plan)
      throw new ChatError("ALREADY_SUBSCRIBED", "This subscription is already active.", 409);
    throw new ChatError(
      "USE_BILLING_PORTAL",
      "Manage an existing paid subscription through the billing portal.",
      409,
    );
  }
  const config = stripeConfig(input.env);
  const priceId = priceFor(input.plan, config);
  const session = await stripePost<{ url?: string }>(
    "/checkout/sessions",
    {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      success_url: `${input.origin}/app?billing=success`,
      cancel_url: `${input.origin}/app?billing=cancelled`,
      client_reference_id: input.userId,
      ...(input.subscription.stripeCustomerId
        ? { customer: input.subscription.stripeCustomerId }
        : { customer_email: input.email }),
      allow_promotion_codes: true,
      "metadata[odin_user_id]": input.userId,
      "metadata[odin_plan]": input.plan,
      "subscription_data[metadata][odin_user_id]": input.userId,
      "subscription_data[metadata][odin_plan]": input.plan,
    },
    config.secretKey,
    `odin-checkout-${input.userId}-${input.plan}-${input.requestId}`,
  );
  if (typeof session.url !== "string" || !session.url.startsWith("https://checkout.stripe.com/"))
    throw new ChatError("STRIPE_UPSTREAM", "Stripe did not return a safe Checkout URL.", 502);
  return session.url;
}

export async function createBillingPortal(input: {
  customerId: string | null;
  origin: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  if (!input.customerId)
    throw new ChatError("NO_BILLING_CUSTOMER", "No paid Stripe customer exists for this account yet.", 409);
  const config = stripeConfig(input.env);
  const session = await stripePost<{ url?: string }>(
    "/billing_portal/sessions",
    { customer: input.customerId, return_url: `${input.origin}/app` },
    config.secretKey,
  );
  if (typeof session.url !== "string" || !session.url.startsWith("https://billing.stripe.com/"))
    throw new ChatError("STRIPE_UPSTREAM", "Stripe did not return a safe billing portal URL.", 502);
  return session.url;
}

function signatureParts(header: string): { timestamp: number; signatures: readonly string[] } {
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value && /^\d+$/u.test(value)) timestamp = Number(value);
    if (key === "v1" && value && /^[a-f0-9]{64}$/u.test(value)) signatures.push(value);
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || signatures.length === 0)
    throw new ChatError("STRIPE_SIGNATURE", "Stripe webhook signature is invalid.", 400);
  return { timestamp, signatures };
}

export function verifyStripeWebhook(
  body: string,
  signatureHeader: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): void {
  const { webhookSecret } = stripeConfig(env);
  const { timestamp, signatures } = signatureParts(signatureHeader);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS)
    throw new ChatError("STRIPE_SIGNATURE", "Stripe webhook signature is outside the allowed time window.", 400);
  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest();
  const valid = signatures.some((signature) => {
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!valid) throw new ChatError("STRIPE_SIGNATURE", "Stripe webhook signature is invalid.", 400);
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChatError("STRIPE_EVENT", "Stripe webhook event is malformed.", 400);
  return value as Record<string, unknown>;
}

function metadata(object: Record<string, unknown>): Record<string, unknown> {
  return objectRecord(object.metadata ?? {});
}

function planFromMetadata(object: Record<string, unknown>): ProductPlan {
  const plan = String(metadata(object).odin_plan ?? "");
  if (!(["pro", "ultra"] as const).includes(plan as "pro" | "ultra"))
    throw new ChatError("STRIPE_EVENT", "Stripe subscription is missing Odin plan metadata.", 400);
  return plan as ProductPlan;
}

function userFromMetadata(object: Record<string, unknown>): string {
  const id = String(metadata(object).odin_user_id ?? "");
  if (!id || id.length > 200 || [...id].some((char) => char.charCodeAt(0) < 32))
    throw new ChatError("STRIPE_EVENT", "Stripe subscription is missing Odin user metadata.", 400);
  return id;
}

const ALLOWED_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

function nullableId(value: unknown, prefix: string): string | null {
  const text = typeof value === "string" ? value : "";
  return new RegExp(`^${prefix}_[A-Za-z0-9]+$`, "u").test(text) ? text : null;
}

function periodEnd(object: Record<string, unknown>): Date | null {
  const seconds = object.current_period_end;
  if (typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0)
    return new Date(seconds * 1000);
  const items = object.items;
  if (items && typeof items === "object") {
    const data = (items as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      const first = data[0];
      if (first && typeof first === "object") {
        const end = (first as Record<string, unknown>).current_period_end;
        if (typeof end === "number" && Number.isSafeInteger(end) && end > 0)
          return new Date(end * 1000);
      }
    }
  }
  return null;
}

export async function processStripeWebhook(input: {
  body: string;
  signature: string;
  pool: Pool;
  env?: NodeJS.ProcessEnv;
}): Promise<{ processed: boolean; type: string }> {
  verifyStripeWebhook(input.body, input.signature, input.env);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    throw new ChatError("STRIPE_EVENT", "Stripe webhook body is not valid JSON.", 400);
  }
  const event = objectRecord(parsed);
  const eventId = typeof event.id === "string" && /^evt_[A-Za-z0-9]+$/u.test(event.id) ? event.id : "";
  const type = typeof event.type === "string" ? event.type : "";
  const created = typeof event.created === "number" && Number.isSafeInteger(event.created) ? event.created : -1;
  if (!eventId || !type || created < 0) throw new ChatError("STRIPE_EVENT", "Stripe webhook event is malformed.", 400);
  if (!type.startsWith("customer.subscription.")) return { processed: false, type };
  const data = objectRecord(event.data);
  const object = objectRecord(data.object);
  const userId = userFromMetadata(object);
  const plan = planFromMetadata(object);
  const status = String(object.status ?? "");
  if (!ALLOWED_STATUSES.has(status))
    throw new ChatError("STRIPE_EVENT", "Stripe returned an unsupported subscription status.", 400);
  const subscriptionId = nullableId(object.id, "sub");
  const customerId = nullableId(object.customer, "cus");
  if (!subscriptionId || !customerId)
    throw new ChatError("STRIPE_EVENT", "Stripe subscription identifiers are invalid.", 400);
  const item = objectRecord(((object.items as Record<string, unknown> | undefined)?.data as unknown[] | undefined)?.[0] ?? {});
  const price = objectRecord(item.price ?? {});
  const priceId = nullableId(price.id, "price");
  const db = new NeonActorDatabase(input.pool, { id: userId });
  const payloadHash = createHash("sha256").update(input.body).digest("hex");
  const deleted = type === "customer.subscription.deleted";
  const end = periodEnd(object);
  let processed = false;
  await db.transaction(async (client) => {
    const inserted = (
      await client.query(
        `INSERT INTO odin_api.billing_events(event_id,event_type,event_created,payload_hash)
         VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,event_id) DO NOTHING RETURNING event_id`,
        [eventId, type, created, payloadHash],
      )
    ).rows.length > 0;
    if (!inserted) return;
    await client.query(
      `INSERT INTO odin_api.subscriptions(plan,status,stripe_customer_id,stripe_subscription_id,price_id,current_period_end,cancel_at_period_end,last_event_created,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT(owner_id) DO UPDATE SET
         plan=CASE WHEN $9 THEN 'free' ELSE excluded.plan END,
         status=excluded.status,
         stripe_customer_id=excluded.stripe_customer_id,
         stripe_subscription_id=excluded.stripe_subscription_id,
         price_id=excluded.price_id,
         current_period_end=excluded.current_period_end,
         cancel_at_period_end=excluded.cancel_at_period_end,
         last_event_created=excluded.last_event_created,
         updated_at=now()
       WHERE odin_api.subscriptions.last_event_created <= excluded.last_event_created`,
      [
        plan,
        deleted ? "canceled" : status,
        customerId,
        subscriptionId,
        priceId,
        end,
        object.cancel_at_period_end === true,
        created,
        deleted,
      ],
    );
    processed = true;
  });
  return { processed, type };
}
