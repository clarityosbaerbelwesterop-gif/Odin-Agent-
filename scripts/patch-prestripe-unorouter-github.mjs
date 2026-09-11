import { readFile, writeFile } from "node:fs/promises";

async function replace(path, pairs) {
  let text = await readFile(path, "utf8");
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`${path}: missing patch anchor: ${from.slice(0, 80)}`);
    text = text.split(from).join(to);
  }
  await writeFile(path, text);
}

await replace("src/chat/server-models.ts", [
  ['import { OpenRouterProvider } from "../providers/openrouter.js";', 'import { UnoRouterProvider } from "../providers/unorouter.js";'],
  ['OPENROUTER_SHARED_MODEL_DEFINITIONS', 'UNOROUTER_SHARED_MODEL_DEFINITIONS'],
  ['openrouter-gpt-5-6-luna', 'unorouter-gpt-5-6-luna'],
  ['openrouter-claude-fable-5-1', 'unorouter-claude-fable-5-1'],
  ['openrouter-claude-opus-5', 'unorouter-claude-opus-5'],
  ['GPT-5.6 Luna · OpenRouter', 'GPT-5.6 Luna · UnoRouter'],
  ['Claude Fable 5.1 · OpenRouter', 'Claude Fable 5.1 · UnoRouter'],
  ['Claude Opus 5 · OpenRouter', 'Claude Opus 5 · UnoRouter'],
  ['model: "openai/gpt-5.6-luna"', 'model: "gpt-5.6-luna"'],
  ['model: "anthropic/claude-fable-5.1"', 'model: "claude-fable-5.1"'],
  ['model: "anthropic/claude-opus-5"', 'model: "claude-opus-5"'],
  ['version: "openrouter-2026-09-11"', 'version: "unorouter-2026-09-11"'],
  ['reference: "https://openrouter.ai/openai/gpt-5.6-luna"', 'reference: "https://unorouter.com/de/modelle/openai/gpt-5.6-luna"'],
  ['reference: "https://openrouter.ai/anthropic/claude-fable-5.1"', 'reference: "https://unorouter.com/de/modelle/anthropic/claude-fable-5.1"'],
  ['reference: "https://openrouter.ai/anthropic/claude-opus-5"', 'reference: "https://unorouter.com/de/modelle/anthropic/claude-opus-5"'],
  ['sharedOpenRouterCredential', 'sharedUnoRouterCredential'],
  ['const value = env.OPENROUTER_API_KEY ?? env.UNOROUTER_API_KEY;', 'const value = env.UNOROUTER_API_KEY;'],
  ['createSharedOpenRouterModels', 'createSharedUnoRouterModels'],
  ['provider: "openrouter"', 'provider: "unorouter"'],
  ['new OpenRouterProvider({', 'new UnoRouterProvider({'],
  ['        appTitle: "Odin Agent",\n        ...(httpReferer ? { httpReferer } : {}),\n', ''],
  ['  const httpReferer = env.ODIN_PUBLIC_ORIGIN?.startsWith("https://")\n    ? env.ODIN_PUBLIC_ORIGIN\n    : undefined;\n', ''],
  ['OpenRouter is intentionally a small curated frontier lane instead of mirroring the whole catalog.', 'UnoRouter is intentionally a small curated frontier lane instead of mirroring the whole catalog.'],
]);

await replace("src/chat/quota.ts", [
  ['"openrouter-gpt-5-6-luna"', '"unorouter-gpt-5-6-luna"'],
  ['"openrouter-claude-fable-5-1"', '"unorouter-claude-fable-5-1"'],
  ['"openrouter-claude-opus-5"', '"unorouter-claude-opus-5"'],
]);

await replace("src/bot/executor.ts", [
  ['openrouter-gpt-5-6-luna', 'unorouter-gpt-5-6-luna'],
  ['openrouter-claude-fable-5-1', 'unorouter-claude-fable-5-1'],
  ['openrouter-claude-opus-5', 'unorouter-claude-opus-5'],
]);

await replace("src/chat/hosted.ts", [
  ['if (!process.env.GITHUB_OAUTH_CLIENT_ID)\n        throw new ChatError("GITHUB_NOT_CONFIGURED", "GitHub OAuth is not configured.", 503);', 'if (!process.env.GITHUB_REPO_OAUTH_CLIENT_ID || !process.env.GITHUB_REPO_OAUTH_CLIENT_SECRET)\n        throw new ChatError(\n          "GITHUB_REPO_OAUTH_NOT_CONFIGURED",\n          "Repository access needs its own GitHub OAuth app. Configure the repo OAuth client first.",\n          503,\n        );'],
  ['target.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID);', 'target.searchParams.set("client_id", process.env.GITHUB_REPO_OAUTH_CLIENT_ID);'],
  ['const client = process.env.GITHUB_OAUTH_CLIENT_ID;\n      const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;', 'const client = process.env.GITHUB_REPO_OAUTH_CLIENT_ID;\n      const secret = process.env.GITHUB_REPO_OAUTH_CLIENT_SECRET;'],
]);

await replace("scripts/sync-vercel-production.mjs", [
  ['["OPENROUTER_API_KEY", "OPENROUTER_API_KEY"],', '["UNOROUTER_API_KEY", "UNOROUTER_API_KEY"],\n  ["GITHUB_REPO_OAUTH_CLIENT_ID", "GITHUB_REPO_OAUTH_CLIENT_ID"],\n  ["GITHUB_REPO_OAUTH_CLIENT_SECRET", "GITHUB_REPO_OAUTH_CLIENT_SECRET"],'],
]);

await replace(".github/workflows/configure-vercel-production.yml", [
  ['          GITHUB_OAUTH_CLIENT_SECRET: ${{ secrets.CLIENT_SECRET }}\n', '          GITHUB_OAUTH_CLIENT_SECRET: ${{ secrets.CLIENT_SECRET }}\n          GITHUB_REPO_OAUTH_CLIENT_ID: ${{ secrets.GITHUB_REPO_OAUTH_CLIENT_ID }}\n          GITHUB_REPO_OAUTH_CLIENT_SECRET: ${{ secrets.GITHUB_REPO_OAUTH_CLIENT_SECRET }}\n'],
  ['          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY || secrets.UNOROUTER_API_KEY }}', '          UNOROUTER_API_KEY: ${{ secrets.UNOROUTER_API_KEY }}'],
  ['      - src/providers/openrouter.ts\n', '      - src/providers/openrouter.ts\n      - src/providers/unorouter.ts\n'],
]);

await replace("src/providers/index.ts", [
  ['export * from "./openrouter.js";\n', 'export * from "./openrouter.js";\nexport * from "./unorouter.js";\n'],
]);

await replace("test/chat/openrouter-shared.test.ts", [
  ['createSharedOpenRouterModels', 'createSharedUnoRouterModels'],
  ['OPENROUTER_SHARED_MODEL_DEFINITIONS', 'UNOROUTER_SHARED_MODEL_DEFINITIONS'],
  ['sharedOpenRouterCredential', 'sharedUnoRouterCredential'],
  ['OpenRouter', 'UnoRouter'],
  ['openrouter-gpt-5-6-luna', 'unorouter-gpt-5-6-luna'],
  ['openrouter-claude-fable-5-1', 'unorouter-claude-fable-5-1'],
  ['openrouter-claude-opus-5', 'unorouter-claude-opus-5'],
  ['"openai/gpt-5.6-luna"', '"gpt-5.6-luna"'],
  ['"anthropic/claude-fable-5.1"', '"claude-fable-5.1"'],
  ['"anthropic/claude-opus-5"', '"claude-opus-5"'],
  ['OPENROUTER_API_KEY: "canonical"', 'UNOROUTER_API_KEY: "canonical"'],
  ['models.every((model) => model.provider.id === "openrouter")', 'models.every((model) => model.provider.id === "unorouter")'],
]);

await replace("test/bot/model-routing.test.ts", [
  ['openrouter-gpt-5-6-luna', 'unorouter-gpt-5-6-luna'],
  ['openrouter-claude-fable-5-1', 'unorouter-claude-fable-5-1'],
  ['openrouter-claude-opus-5', 'unorouter-claude-opus-5'],
  ['OpenRouter', 'UnoRouter'],
  ['startsWith("openrouter-")', 'startsWith("unorouter-")'],
]);

await replace("test/chat/quota.test.ts", [
  ['openrouter-gpt-5-6-luna', 'unorouter-gpt-5-6-luna'],
  ['openrouter-claude-fable-5-1', 'unorouter-claude-fable-5-1'],
  ['openrouter-claude-opus-5', 'unorouter-claude-opus-5'],
  ['OpenRouter', 'UnoRouter'],
]);
