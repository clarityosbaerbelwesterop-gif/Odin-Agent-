from pathlib import Path

path = Path("src/connectors/api.ts")
text = path.read_text()
before = 'import { ChatError } from "../chat/types.js";'
after = 'import { ChatError, type ChatEvent } from "../chat/types.js";'
if after not in text:
    if before not in text:
        raise SystemExit("connector API import shape changed")
    path.write_text(text.replace(before, after, 1))
