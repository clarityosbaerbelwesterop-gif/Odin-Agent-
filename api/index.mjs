// Vercel compiles TypeScript functions in an isolated transpilation step after the
// repository build. Keep the deployment wrapper JavaScript-only and import the
// already typechecked build artifact so the canonical `npm run build` remains the
// sole TypeScript compilation path.
import { hostedHandler } from "../dist/src/chat/hosted.js";

const exactStripePrices = {
  pro: "price_1UDr55EmDA2oLCpoQJNERPTA",
  developer: "price_1UDr5HEmDA2oLCpoTuUlXUH0",
  ultra: "price_1UDr5REmDA2oLCpoiETsQLQf",
};

console.info("Odin deployment gates", {
  credentialEncryptionConfigured: Boolean(process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY),
  githubOAuthConfigured: Boolean(
    process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET,
  ),
  stripeSecretConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  stripeWebhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  stripePricesConfigured:
    process.env.STRIPE_PRO_PRICE_ID === exactStripePrices.pro &&
    process.env.STRIPE_DEVELOPER_PRICE_ID === exactStripePrices.developer &&
    process.env.STRIPE_ULTRA_PRICE_ID === exactStripePrices.ultra,
  productionNvidiaAuthorized: process.env.ODIN_NVIDIA_PRODUCTION_AUTHORIZED === "true",
  productionNvidiaPrimaryConfigured: Boolean(process.env.NVIDIA_PRODUCTION_API_KEY),
  productionNvidiaSecondaryConfigured: Boolean(process.env.NVIDIA_PRODUCTION_API_KEY_2),
  optionalSharedProviders: {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    google: Boolean(process.env.GOOGLE_API_KEY),
  },
});

export default hostedHandler;
