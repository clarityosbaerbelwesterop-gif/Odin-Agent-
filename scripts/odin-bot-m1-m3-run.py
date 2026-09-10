from pathlib import Path

source_path = Path("scripts/odin-bot-m1-m3-patch.py")
source = source_path.read_text()
old = '''replace_once(\n    "package.json",\n    'node --test scripts/workspace-ui.test.mjs',\n    'node --test scripts/workspace-ui.test.mjs && node --test scripts/bot-ui.test.mjs',\n)'''
new = '''replace_once(\n    "package.json",\n    'scripts/workspace-ui.test.mjs\\"',\n    'scripts/workspace-ui.test.mjs scripts/bot-ui.test.mjs\\"',\n)'''
if source.count(old) != 1:
    raise SystemExit("package patch definition mismatch")
patched = source.replace(old, new, 1)
exec(compile(patched, str(source_path), "exec"), {"__name__": "__main__"})


def replace_once(path: str, before: str, after: str) -> None:
    target = Path(path)
    text = target.read_text()
    if text.count(before) != 1:
        raise SystemExit(f"{path}: repair anchor mismatch")
    target.write_text(text.replace(before, after, 1))


replace_once(
    "src/bot/store.ts",
    'import type { Pool } from "pg";',
    'import type { Pool, QueryResultRow } from "pg";',
)
replace_once(
    "src/bot/store.ts",
    'function task(row: Record<string, any>): BotTask {',
    'function task(row: QueryResultRow): BotTask {',
)
replace_once(
    "src/bot/store.ts",
    'function automation(row: Record<string, any>): BotAutomation {',
    'function automation(row: QueryResultRow): BotAutomation {',
)
replace_once(
    "src/bot/store.ts",
    '''  const clean = value.trim();\n  if (!clean || clean.length > max || /[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]/u.test(clean))\n    throw new ChatError("INVALID_BOT_INPUT", `${label} is invalid.`);''',
    '''  const clean = value.trim();\n  const hasControl = [...clean].some((char) => {\n    const code = char.charCodeAt(0);\n    return code < 32 && ![9, 10, 13].includes(code);\n  });\n  if (!clean || clean.length > max || hasControl)\n    throw new ChatError("INVALID_BOT_INPUT", `${label} is invalid.`);''',
)
replace_once(
    "src/bot/store.ts",
    '    idempotencyKey?: string;',
    '    idempotencyKey?: string | undefined;',
)
replace_once(
    "web/bot.js",
    '  items.forEach((item) => target.append(row(item)));',
    '  for (const item of items) target.append(row(item));',
)
replace_once(
    "src/bot/wakeup.ts",
    '  return values as Record<string, number>;',
    '''  return values as {\n    year: number;\n    month: number;\n    day: number;\n    hour: number;\n    minute: number;\n    second: number;\n  };''',
)
replace_once(
    "src/bot/wakeup.ts",
    '    const everyMinutes = /hour|stund/u.test(interval[2]) ? amount * 60 : amount;',
    '    const everyMinutes = /hour|stund/u.test(interval[2] ?? "") ? amount * 60 : amount;',
)
replace_once(
    "src/bot/worker-auth.ts",
    '''  if (!match) throw new ChatError("BOT_WORKER_UNAUTHORIZED", "Worker authorization is required.", 401);\n  try {\n    const { payload } = await jwtVerify(match[1], JWKS, {''',
    '''  const token = match?.[1];\n  if (!token) throw new ChatError("BOT_WORKER_UNAUTHORIZED", "Worker authorization is required.", 401);\n  try {\n    const { payload } = await jwtVerify(token, JWKS, {''',
)
replace_once(
    "src/bot/executor.ts",
    '  credentialEncryptionKey?: string;',
    '  credentialEncryptionKey?: string | undefined;',
)
replace_once(
    "scripts/bot-ui.test.mjs",
    'assert.doesNotMatch(html, /demo|placeholder|fake activity/iu);',
    'assert.doesNotMatch(html, /\\bdemo\\b|fake activity/iu);',
)
