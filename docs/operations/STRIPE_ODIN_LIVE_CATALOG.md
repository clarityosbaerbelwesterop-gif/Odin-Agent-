# Odin live Stripe catalog

Created in Stripe account `acct_1SuYrvEmDA2oLCpo` on 2026-09-09 for Odin only. Do not reuse BYB, SCP, AetherGrid or other products.

| Plan | Product | Monthly USD | Live Price ID |
| --- | --- | ---: | --- |
| Pro | `prod_VEJiPt3UxYH0Wo` | $9.99 | `price_1UDr55EmDA2oLCpoQJNERPTA` |
| Developer | `prod_VEJiQd8Lr8slZv` | $19.99 | `price_1UDr5HEmDA2oLCpoTuUlXUH0` |
| Ultra | `prod_VEJisHH4085X1h` | $49.99 | `price_1UDr5REmDA2oLCpoiETsQLQf` |

Free has no Stripe Product/Price and requires no payment method.

## Product contract

- Pro: Thinking, Research and Pro-tier models.
- Developer: Pro plus GitHub-connected Coding Mode and Developer-tier models.
- Ultra: Developer plus Ultra Mode and Ultra-tier models.
- Stripe Checkout success URLs are never entitlement authority. Signed webhook state is authoritative.
- Paid entitlements are effective only for allowlisted active/trialing subscription state.
- `canceled`, `past_due`, `unpaid`, `paused`, `incomplete` and `incomplete_expired` fail closed to Free until the billing state becomes active again.

## Vercel environment mapping

The production configuration workflow writes these non-secret IDs to Vercel:

- `STRIPE_PRO_PRICE_ID=price_1UDr55EmDA2oLCpoQJNERPTA`
- `STRIPE_DEVELOPER_PRICE_ID=price_1UDr5HEmDA2oLCpoTuUlXUH0`
- `STRIPE_ULTRA_PRICE_ID=price_1UDr5REmDA2oLCpoiETsQLQf`

The operator still needs a server-side `STRIPE_SECRET_KEY` and a webhook endpoint secret in `STRIPE_WEBHOOK_SECRET`. Never commit either secret.
