from pathlib import Path

path = Path("scripts/odin-bot-m7-m9-build.py")
text = path.read_text()
old = '''    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))'''
new = '''    hosted_worker_pair = (
        path == "src/chat/hosted.ts"
        and old.startswith("      const worker = new OdinBotWorker({")
        and count == 2
    )
    if count != 1 and not hosted_worker_pair:
        raise SystemExit(f"{path}: expected one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))'''
if text.count(old) != 1:
    raise SystemExit("builder helper anchor mismatch")
path.write_text(text.replace(old, new, 1))
