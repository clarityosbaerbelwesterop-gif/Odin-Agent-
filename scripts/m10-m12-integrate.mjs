import { readFile, writeFile } from "node:fs/promises";

async function replace(path, from, to) {
  const source = await readFile(path, "utf8");
  if (!source.includes(from)) throw new Error(`Expected integration anchor missing in ${path}`);
  await writeFile(path, source.replace(from, to));
}

await replace(
  "src/chat/agent.ts",
  'import { modePolicy, modePrompt } from "./modes.js";\n',
  'import { modePolicy, modePrompt } from "./modes.js";\nimport type { ChatQuotaController } from "./quota.js";\n',
);
await replace(
  "src/chat/agent.ts",
  "  limits: ChatLimits;\n  store: ChatRepository;\n",
  "  limits: ChatLimits;\n  quota?: ChatQuotaController;\n  store: ChatRepository;\n",
);
await replace(
  "src/chat/agent.ts",
  `    let response: ModelResponse | undefined;\n    if (profile.capabilities.streaming) {\n      for await (const event of model.provider.stream(request, { signal, timeoutMs: 180_000 })) {\n        signal.throwIfAborted();\n        if (event.type === "completed") response = event.response;\n      }\n    } else response = await model.provider.generate(request, { signal, timeoutMs: 180_000 });\n    signal.throwIfAborted();\n    if (!response || response.provider !== model.provider.id || response.model !== model.model)\n      throw new ChatError("PROVIDER_RESPONSE", "Provider returned an invalid response.", 502);\n    const usage = response.usage;\n`,
  `    const quotaReservation =\n      context.quota && model.sharedCapacity === true\n        ? await context.quota.reserve({\n            requestId: \`${"${turn.id}"}:model:${"${state.calls}"}\`,\n            missionId: turn.id,\n            mode: turn.mode,\n            modelId: model.id,\n            estimatedInputTokens: Math.ceil(input / 4),\n            estimatedOutputTokens: output,\n          })\n        : undefined;\n    let response: ModelResponse | undefined;\n    try {\n      if (profile.capabilities.streaming) {\n        for await (const event of model.provider.stream(request, { signal, timeoutMs: 180_000 })) {\n          signal.throwIfAborted();\n          if (event.type === "completed") response = event.response;\n        }\n      } else response = await model.provider.generate(request, { signal, timeoutMs: 180_000 });\n    } catch (error) {\n      if (quotaReservation) await context.quota?.release(quotaReservation).catch(() => undefined);\n      throw error;\n    }\n    if (!response || response.provider !== model.provider.id || response.model !== model.model) {\n      if (quotaReservation) await context.quota?.release(quotaReservation);\n      throw new ChatError("PROVIDER_RESPONSE", "Provider returned an invalid response.", 502);\n    }\n    const usage = response.usage;\n`,
);
await replace(
  "src/chat/agent.ts",
  `    state = {\n      ...state,\n      usageUnknown: previousUnknown,\n`,
  `    if (quotaReservation) await context.quota?.settle(quotaReservation, usage, response.provider);\n    signal.throwIfAborted();\n    state = {\n      ...state,\n      usageUnknown: previousUnknown,\n`,
);

await replace(
  "src/chat/engine.ts",
  'import { DEFAULT_CHAT_LIMITS, MODE_POLICIES, parseMode } from "./modes.js";\n',
  'import { DEFAULT_CHAT_LIMITS, MODE_POLICIES, parseMode } from "./modes.js";\nimport type { ChatQuotaController } from "./quota.js";\n',
);
await replace(
  "src/chat/engine.ts",
  "  research?: ResearchAdapter;\n  workspace?: (onChange: (change: ChatChange) => Promise<void>) => RepositoryWorkspace;\n",
  "  research?: ResearchAdapter;\n  quota?: ChatQuotaController;\n  workspace?: (onChange: (change: ChatChange) => Promise<void>) => RepositoryWorkspace;\n",
);
await replace(
  "src/chat/engine.ts",
  `          ...(this.#options.research ? { research: this.#options.research } : {}),\n          publish,\n`,
  `          ...(this.#options.research ? { research: this.#options.research } : {}),\n          ...(this.#options.quota ? { quota: this.#options.quota } : {}),\n          publish,\n`,
);

await replace(
  "src/chat/hosted.ts",
  'import { hashText, identifier, integer, object, publicError } from "./safety.js";\n',
  'import { QuotaStore } from "./quota.js";\nimport { hashText, identifier, integer, object, publicError } from "./safety.js";\n',
);
await replace(
  "src/chat/hosted.ts",
  `    const product = new ProductStore(\n      db,\n      new CredentialVault(process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY),\n    );\n    const githubConnection = await product.github();\n`,
  `    const product = new ProductStore(\n      db,\n      new CredentialVault(process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY),\n    );\n    const quota = new QuotaStore(db, effectivePlan(await product.account()));\n    const githubConnection = await product.github();\n`,
);
await replace(
  "src/chat/hosted.ts",
  `        research: new WikipediaResearchAdapter("de"),\n        ...(signal ? { signal } : {}),\n`,
  `        research: new WikipediaResearchAdapter("de"),\n        quota,\n        ...(signal ? { signal } : {}),\n`,
);
await replace(
  "src/chat/hosted.ts",
  `        account: { ...account, effectivePlan: effectivePlan(account) },\n        providers: await product.credentials(),\n`,
  `        account: { ...account, effectivePlan: effectivePlan(account) },\n        quota: await quota.snapshot(),\n        providers: await product.credentials(),\n`,
);

await replace(
  "src/bot/executor.ts",
  'import { WikipediaResearchAdapter } from "../chat/research.js";\n',
  'import { QuotaStore } from "../chat/quota.js";\nimport { WikipediaResearchAdapter } from "../chat/research.js";\n',
);
await replace(
  "src/bot/executor.ts",
  `    const plan = effectivePlan(account);\n    const limits = botPlanLimits(plan);\n`,
  `    const plan = effectivePlan(account);\n    const quota = new QuotaStore(db, plan);\n    const limits = botPlanLimits(plan);\n`,
);
await replace(
  "src/bot/executor.ts",
  `        ...(readToolsAllowed ? { research: new WikipediaResearchAdapter("de") } : {}),\n      });\n`,
  `        ...(readToolsAllowed ? { research: new WikipediaResearchAdapter("de") } : {}),\n        quota,\n      });\n`,
);

await replace(
  ".github/workflows/configure-vercel-production.yml",
  `      - migrations/008_odin_bot_m7_m9.sql\n      - src/bot/**\n`,
  `      - migrations/008_odin_bot_m7_m9.sql\n      - migrations/009_quota_and_provider_pool.sql\n      - src/bot/**\n      - src/providers/nvidia-pool.ts\n      - src/chat/quota.ts\n      - src/chat/server-models.ts\n`,
);
await replace(
  ".github/workflows/configure-vercel-production.yml",
  `          NVIDIA_PRODUCTION_API_KEY: \${{ secrets.NV_API_KEY }}\n          NVIDIA_PRODUCTION_API_KEY_2: \${{ secrets.NV_API_KEY_2 }}\n          ODIN_NVIDIA_PRODUCTION_AUTHORIZED: "true"\n`,
  `          NVIDIA_PRODUCTION_API_KEY: \${{ secrets.NV_API_KEY }}\n          NVIDIA_PRODUCTION_API_KEY_2: \${{ secrets.NV_API_KEY_2 }}\n          NVIDIA_PRODUCTION_API_KEY_3: \${{ secrets.NV_API_KEY_3 }}\n          NVIDIA_PRODUCTION_API_KEY_4: \${{ secrets.NV_API_KEY_4 }}\n          NVIDIA_PRODUCTION_API_KEY_5: \${{ secrets.NV_API_KEY_5 }}\n          ODIN_NVIDIA_PRODUCTION_AUTHORIZED: "true"\n`,
);

await replace(
  "scripts/sync-vercel-production.mjs",
  `    const botEventMigration = await readFile(\n      new URL("../migrations/008_odin_bot_m7_m9.sql", import.meta.url),\n      "utf8",\n    );\n    await pool.query(botEventMigration);\n    report.checks.push("Odin Bot M7-M9 GitHub event/PR lifecycle schema reconciled");\n`,
  `    const botEventMigration = await readFile(\n      new URL("../migrations/008_odin_bot_m7_m9.sql", import.meta.url),\n      "utf8",\n    );\n    await pool.query(botEventMigration);\n    report.checks.push("Odin Bot M7-M9 GitHub event/PR lifecycle schema reconciled");\n    const quotaMigration = await readFile(\n      new URL("../migrations/009_quota_and_provider_pool.sql", import.meta.url),\n      "utf8",\n    );\n    await pool.query(quotaMigration);\n    report.checks.push("M10-M12 quota/provider-pool schema reconciled");\n`,
);
await replace(
  "scripts/sync-vercel-production.mjs",
  `    const productionNvidia = safeSecret("NVIDIA_PRODUCTION_API_KEY");\n    const productionNvidia2 = safeSecret("NVIDIA_PRODUCTION_API_KEY_2");\n    if (productionAuthorized && productionNvidia) {\n`,
  `    const productionNvidia = safeSecret("NVIDIA_PRODUCTION_API_KEY");\n    const productionNvidia2 = safeSecret("NVIDIA_PRODUCTION_API_KEY_2");\n    const productionNvidia3 = safeSecret("NVIDIA_PRODUCTION_API_KEY_3");\n    const productionNvidia4 = safeSecret("NVIDIA_PRODUCTION_API_KEY_4");\n    const productionNvidia5 = safeSecret("NVIDIA_PRODUCTION_API_KEY_5");\n    if (productionAuthorized && productionNvidia) {\n`,
);
await replace(
  "scripts/sync-vercel-production.mjs",
  `      if (productionNvidia2)\n        await upsert("NVIDIA_PRODUCTION_API_KEY_2", productionNvidia2, envKeys);\n      report.synced.push("ODIN_NVIDIA_PRODUCTION_AUTHORIZED", "NVIDIA_PRODUCTION_API_KEY");\n      if (productionNvidia2) report.synced.push("NVIDIA_PRODUCTION_API_KEY_2");\n`,
  `      if (productionNvidia2)\n        await upsert("NVIDIA_PRODUCTION_API_KEY_2", productionNvidia2, envKeys);\n      if (productionNvidia3)\n        await upsert("NVIDIA_PRODUCTION_API_KEY_3", productionNvidia3, envKeys);\n      if (productionNvidia4)\n        await upsert("NVIDIA_PRODUCTION_API_KEY_4", productionNvidia4, envKeys);\n      if (productionNvidia5)\n        await upsert("NVIDIA_PRODUCTION_API_KEY_5", productionNvidia5, envKeys);\n      report.synced.push("ODIN_NVIDIA_PRODUCTION_AUTHORIZED", "NVIDIA_PRODUCTION_API_KEY");\n      if (productionNvidia2) report.synced.push("NVIDIA_PRODUCTION_API_KEY_2");\n      if (productionNvidia3) report.synced.push("NVIDIA_PRODUCTION_API_KEY_3");\n      if (productionNvidia4) report.synced.push("NVIDIA_PRODUCTION_API_KEY_4");\n      if (productionNvidia5) report.synced.push("NVIDIA_PRODUCTION_API_KEY_5");\n`,
);

console.log("M10-M12 integration anchors applied");
