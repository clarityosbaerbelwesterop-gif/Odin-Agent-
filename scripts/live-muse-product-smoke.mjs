import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const key = process.env.NV_API_KEY_2;
assert(key && !/[\r\n]/u.test(key), "NV_API_KEY_2 is required");
const started = Date.now();
const report = {
  status: "FAILED",
  evaluatedAt: new Date().toISOString(),
  model: "meta/muse-glimmer-30b",
  endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  authority: "connectivity_only",
  scope: "One bounded server-side text inference; not benchmark evidence.",
};
try {
  const response = await fetch(report.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: report.model,
      messages: [
        {
          role: "user",
          content: "Return one short sentence confirming that this model endpoint can answer a text request.",
        },
      ],
      temperature: 0.95,
      top_p: 1,
      max_tokens: 128,
      reasoning_effort: "minimal",
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });
  report.httpStatus = response.status;
  assert(response.ok, `NVIDIA_HTTP_${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  assert.equal(typeof text, "string");
  assert(text.trim().length > 0, "EMPTY_RESPONSE");
  report.status = "PASS";
  report.responseHash = createHash("sha256").update(text).digest("hex");
  report.usage = data.usage
    ? {
        promptTokens: data.usage.prompt_tokens ?? null,
        completionTokens: data.usage.completion_tokens ?? null,
        totalTokens: data.usage.total_tokens ?? null,
      }
    : null;
} catch (error) {
  report.failure =
    error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "TIMEOUT"
      : typeof error?.message === "string" && /^[A-Z0-9_:-]{1,80}$/u.test(error.message)
        ? error.message
        : "REQUEST_FAILED";
  process.exitCode = 1;
} finally {
  report.wallMs = Date.now() - started;
  await writeFile("muse-product-smoke.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
