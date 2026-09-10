from pathlib import Path

source_path = Path("scripts/odin-bot-m1-m3-patch.py")
source = source_path.read_text()
old = '''replace_once(\n    "package.json",\n    'node --test scripts/workspace-ui.test.mjs',\n    'node --test scripts/workspace-ui.test.mjs && node --test scripts/bot-ui.test.mjs',\n)'''
new = '''replace_once(\n    "package.json",\n    'scripts/workspace-ui.test.mjs\\"',\n    'scripts/workspace-ui.test.mjs scripts/bot-ui.test.mjs\\"',\n)'''
if source.count(old) != 1:
    raise SystemExit("package patch definition mismatch")
patched = source.replace(old, new, 1)
exec(compile(patched, str(source_path), "exec"), {"__name__": "__main__"})
