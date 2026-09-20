"""Build check: WCAG contrast floors from brand.py, and Base.astro's tokens equal brand.py.
Run: python3 scripts/contrast.py   (exit 1 on any failure)"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from brand import TOKENS, rgb  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "src" / "layouts" / "Base.astro"

# (foreground token, background token, floor)
PAIRS = [
    ("--ink", "--bg", 4.5),
    ("--ink-soft", "--bg", 4.5),
    ("--teal", "--bg", 4.5),
    ("--teal-ink", "--teal", 4.5),
    ("--ink", "--surface", 4.5),
    ("--ink-soft", "--surface", 4.5),
    ("--teal", "--surface", 4.5),
    ("--border", "--bg", 3.0),
]


def luminance(hex_colour: str) -> float:
    def channel(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb(hex_colour))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg: str, bg: str) -> float:
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def main() -> int:
    failed = False
    print("contrast (floor):")
    for fg, bg, floor in PAIRS:
        r = ratio(TOKENS[fg], TOKENS[bg])
        ok = r >= floor
        failed |= not ok
        print(f"  {fg:>10} on {bg:<10} {r:6.2f}:1  floor {floor}  {'ok' if ok else 'FAIL'}")

    print("tokens in Base.astro equal brand.py:")
    css = BASE.read_text()
    root = re.search(r":root\s*\{(.*?)\}", css, re.S)
    if not root:
        print("  FAIL: no :root block in Base.astro")
        return 1
    found = dict(re.findall(r"(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", root.group(1)))
    for name, value in TOKENS.items():
        got = found.get(name)
        ok = got is not None and got.lower() == value.lower()
        failed |= not ok
        print(f"  {name:>10} {value}  Base.astro {got or 'missing'}  {'ok' if ok else 'FAIL'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
