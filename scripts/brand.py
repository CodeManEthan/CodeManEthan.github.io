"""The site's palette and faces, once. Base.astro's tokens must equal TOKENS
(scripts/contrast.py asserts it), and make_og.py draws from the same values.
Source: the LinkedIn banner constants (redhat variant), ruled 2026-09-19."""

BG = "#232627"        # page background
SURFACE = "#2b2f31"   # cards, code blocks
BORDER = "#66707a"    # card borders, rules (3:1 against BG)
INK = "#f5f5f0"       # body text, headings
INK_SOFT = "#a0a5aa"  # summaries, meta, footer
GREY_HEX = INK_SOFT   # the banner calls it GREY
TEAL = "#1abc9c"      # kicker, bars, links, chip borders, filled button
TEAL_INK = "#0f2a25"  # text on a teal fill

TOKENS = {
    "--bg": BG,
    "--surface": SURFACE,
    "--border": BORDER,
    "--ink": INK,
    "--ink-soft": INK_SOFT,
    "--teal": TEAL,
    "--teal-ink": TEAL_INK,
}

# fontconfig patterns, resolved with fc-match; the site ships the same faces as woff2.
FONT_DISPLAY = "Red Hat Display:bold"
FONT_TEXT = "Red Hat Text:medium"
FONT_CODE = "Source Code Pro"


def rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
