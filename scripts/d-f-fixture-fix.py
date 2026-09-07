from pathlib import Path

path = Path("test/routing/frontier-amplification.test.ts")
text = path.read_text()

old = '''    rejectNoChangeRepair: true,
    requiresIndependentVerification: true,
    surgicalRepairOnly: true,'''
new = '''    rejectNoChangeRepair: amplification.strategies.includes("targeted_repair"),
    requiresIndependentVerification: true,
    surgicalRepairOnly: amplification.strategies.includes("targeted_repair"),'''

if text.count(old) != 1:
    raise SystemExit(f"expected one Phase F fixture repair-policy block, got {text.count(old)}")

path.write_text(text.replace(old, new, 1))
