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
