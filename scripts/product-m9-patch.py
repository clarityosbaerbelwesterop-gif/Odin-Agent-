from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"missing replacement marker in {path}: {old!r}")
    file.write_text(text.replace(old, new, 1))


# Retry backoff mutates available_at, so occurrence identity must use immutable scheduled_at.
replace_once("src/bot/types.ts", "  availableAt: string;\n", "  scheduledAt: string;\n")
replace_once(
    "src/bot/store.ts",
    "SELECT owner_id,id,kind,target_id,available_at,attempts FROM odin_control.bot_wakeups",
    "SELECT owner_id,id,kind,target_id,scheduled_at,attempts FROM odin_control.bot_wakeups",
)
replace_once(
    "src/bot/store.ts",
    "        availableAt: iso(row.available_at) as string,\n",
    "        scheduledAt: iso(row.scheduled_at) as string,\n",
)
replace_once(
    "src/bot/executor.ts",
    "    await store.fireAutomation(automation.id, wake.availableAt, limits);",
    "    await store.fireAutomation(automation.id, wake.scheduledAt, limits);",
)
