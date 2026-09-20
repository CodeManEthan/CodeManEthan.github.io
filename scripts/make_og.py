"""Generated images, from brand.py: the site-wide default preview (1200x630) and the
card graphics for the two private entries (1600x900, no screenshot, no diagram).
Run: python3 scripts/make_og.py        (writes public/og/default.png and public/images/*.png)"""
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from brand import BG, FONT_DISPLAY, FONT_TEXT, GREY_HEX, INK, TEAL, rgb  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "src" / "content" / "projects"

NAME = "Ethan Plunk"
SUBLINE = ("Software developer. Full-stack apps, Linux tooling, "
           "and the multi-agent harness I built to ship them faster.")
CARDS = ["agent-harness", "voice-interface"]


def font(pattern: str, size: int) -> ImageFont.FreeTypeFont:
    path = subprocess.run(["fc-match", "-f", "%{file}", pattern],
                          capture_output=True, text=True, check=True).stdout
    return ImageFont.truetype(path, size)


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def frontmatter(slug: str) -> dict[str, str]:
    text = (CONTENT / f"{slug}.md").read_text()
    block = re.search(r"^---\n(.*?)\n---", text, re.S).group(1)
    return {m.group(1): m.group(2).strip().strip("'\"")
            for m in re.finditer(r"^([a-z]+):\s*(.+)$", block, re.M)}


def panel(size: tuple[int, int], title: str, title_font: ImageFont.FreeTypeFont,
          line: str, line_font: ImageFont.FreeTypeFont, margin: int) -> Image.Image:
    w, h = size
    im = Image.new("RGB", size, rgb(BG))
    d = ImageDraw.Draw(im)
    title_lines = wrap(d, title, title_font, w - 2 * margin)
    line_lines = wrap(d, line, line_font, w - 2 * margin)
    th = title_font.size * 1.1
    lh = line_font.size * 1.4
    bar_h = max(8, title_font.size // 12)
    block = bar_h + 28 + th * len(title_lines) + 18 + lh * len(line_lines)
    y = (h - block) / 2
    d.rectangle([margin, y, margin + title_font.size * 0.8, y + bar_h], fill=rgb(TEAL))
    y += bar_h + 28
    for t in title_lines:
        d.text((margin, y), t, font=title_font, fill=rgb(INK))
        y += th
    y += 18
    for t in line_lines:
        d.text((margin, y), t, font=line_font, fill=rgb(GREY_HEX))
        y += lh
    return im


def main() -> None:
    out_og = ROOT / "public" / "og"
    out_img = ROOT / "public" / "images"
    out_og.mkdir(parents=True, exist_ok=True)
    out_img.mkdir(parents=True, exist_ok=True)

    im = panel((1200, 630), NAME, font(FONT_DISPLAY, 96), SUBLINE, font(FONT_TEXT, 34), 100)
    im.save(out_og / "default.png", optimize=True)
    print("wrote", out_og / "default.png")

    for slug in CARDS:
        fm = frontmatter(slug)
        first_line = fm["summary"].split(":")[0].rstrip(".") + "."
        im = panel((1600, 900), fm["title"], font(FONT_DISPLAY, 84), first_line, font(FONT_TEXT, 40), 120)
        im.save(out_img / f"{slug}.png", optimize=True)
        print("wrote", out_img / f"{slug}.png")


if __name__ == "__main__":
    main()
