from pathlib import Path


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    text = target.read_text()
    if before in text:
        target.write_text(text.replace(before, after, 1))
        return
    if after in text:
        return
    raise SystemExit(f"{label}: generated source did not match the audited shapes")


replace_once(
    "src/chat/agent.ts",
    '''        let output: string;\n        let failed = false;\n        try {\n          const name = tools.resolveName(tool.name);\n          const runtimeInput = tool.arguments;\n          const registration = tools.registry.resolveRegistration(name, "1");\n          const inputHash = hashText(JSON.stringify(runtimeInput));\n          const approvalId = hashText(`${turn.id}\\u0000${name}\\u0000${inputHash}`);''',
    '''        let output: string;\n        let failed = false;\n        let name = tool.name;\n        const runtimeInput = tool.arguments;\n        let registration: ToolRegistration | undefined;\n        const inputHash = hashText(JSON.stringify(runtimeInput));\n        let approvalId = "";\n        try {\n          name = tools.resolveName(tool.name);\n          registration = tools.registry.resolveRegistration(name, "1");\n          approvalId = hashText(`${turn.id}\\u0000${name}\\u0000${inputHash}`);''',
    "approval scope",
)
replace_once(
    "src/chat/agent.ts",
    '''          if (error instanceof ToolRuntimeError && error.category === "require_approval") {''',
    '''          if (\n            error instanceof ToolRuntimeError &&\n            error.category === "require_approval" &&\n            registration\n          ) {''',
    "approval registration guard",
)

catalog = Path("src/connectors/catalog.ts")
catalog_text = catalog.read_text()
catalog_text = catalog_text.replace(
    '  Object.freeze({\n    id: "',
    '  Object.freeze<ConnectorDescriptor>({\n    id: "',
)
catalog_text = catalog_text.replace(
    "const CUSTOM: ConnectorDescriptor = Object.freeze({",
    "const CUSTOM: ConnectorDescriptor = Object.freeze<ConnectorDescriptor>({",
)
catalog.write_text(catalog_text)

replace_once(
    "src/connectors/tool-bridge.ts",
    "  return Object.freeze({\n",
    "  return Object.freeze<ToolRegistration>({\n",
    "tool bridge contextual typing",
)

# Domain tests execute from dist/, but they intentionally inspect the real repository source
# and migration contracts. Resolve those files from the checkout root rather than from dist/.
test_path = Path("test/chat/connector-platform.test.ts")
test_text = test_path.read_text()
if 'import { join } from "node:path";' not in test_text:
    test_text = test_text.replace(
        'import { readFile } from "node:fs/promises";\n',
        'import { readFile } from "node:fs/promises";\nimport { join } from "node:path";\n',
        1,
    )
for relative in [
    "src/connectors/api.ts",
    "src/connectors/oauth.ts",
    "src/connectors/network.ts",
    "src/connectors/tool-bridge.ts",
    "src/chat/agent.ts",
    "migrations/017_connector_platform.sql",
]:
    test_text = test_text.replace(
        f'readFile(new URL("../../{relative}", import.meta.url), "utf8")',
        f'readFile(join(process.cwd(), "{relative}"), "utf8")',
    )
if 'new URL("../../src/connectors/api.ts", import.meta.url)' in test_text:
    raise SystemExit("connector platform test still resolves source paths relative to dist")
test_path.write_text(test_text)

# The browser must render the server-owned connector catalog rather than duplicating provider
# identities client-side. Verify requested providers in the canonical catalog and the UI's
# dynamic /api/connectors rendering contract separately.
ui_path = Path("scripts/connectors-ui.test.mjs")
ui_text = ui_path.read_text()
if 'const catalog = await readFile(new URL("../src/connectors/catalog.ts", import.meta.url), "utf8");' not in ui_text:
    ui_text = ui_text.replace(
        'const live = await readFile(new URL("../web/live-work.js", import.meta.url), "utf8");\n',
        'const live = await readFile(new URL("../web/live-work.js", import.meta.url), "utf8");\nconst catalog = await readFile(new URL("../src/connectors/catalog.ts", import.meta.url), "utf8");\n',
        1,
    )
ui_text = ui_text.replace(
    '  for (const id of ["neon", "linkedin"]) assert.match(js, new RegExp(id, "u"));\n  assert.match(js, /google-workspace/u);\n',
    '  for (const id of ["neon", "vercel", "google-workspace", "linkedin"])\n    assert.match(catalog, new RegExp(`id: "${id}"`, "u"));\n  assert.match(js, /cState\\.catalog = data\\.connectors/u);\n',
    1,
)
if 'assert.match(js, /google-workspace/u)' in ui_text:
    raise SystemExit("connector UI test still requires browser-side provider duplication")
ui_path.write_text(ui_text)
