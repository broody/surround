# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
"""Builds Surround's logo from pixel bitmaps.

The badge is drawn below; the wordmark is SURROUND set in Surround Sans Bold
from fonts/surround-sans.txt. Writes, under public/:

  assets/brand/surround-logo.svg  the badge and wordmark, for page headers
  assets/brand/surround-mark.svg  the badge alone, also the favicon
  apple-touch-icon.png            the badge on the page background, 180px

    uv run scripts/build-brand.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "fonts" / "surround-sans.txt"
PUBLIC = ROOT / "public"

COLORS = {
    "g": "#d9b875",  # gold
    "G": "#f0c671",  # bright gold
    "d": "#9b8558",  # dark gold
    "w": "#d6ac65",  # board wood
    "l": "#684824",  # board lines
    "k": "#101722",  # black stone
    "h": "#657078",  # black stone highlight
    "c": "#e8e4d5",  # white stone
    "C": "#fffef0",  # white stone highlight
    "s": "#a3977d",  # white stone shadow
    "i": "#05090f",  # the wordmark's plate
    "t": "#ede5d2",  # the wordmark's letters
}
BACKGROUND = "#0b121b"

# A black and a white stone on a corner of a board, in a gold frame.
MARK = """
.........G.........
......ggggggg......
.....gwwwwwwwg.....
....gwlwwwwwlwg....
...gwkkkwwwwlwwg...
..gwkhkkkwwwlwwwg..
.gwlkkkkklllllllwg.
.gwwkkkkkwwwlwwwwg.
.gwwwkkkwwwwlwwwwg.
GgwwwwlwwwwwlwwwwgG
.gwwwwlwwwwcccwwwg.
.gwwwwlwwwcCcccwwg.
.gwlllllllccccclwg.
..gwwwlwwwccccswg..
...gwwlwwwwccswg...
....gwlwwwwwlwg....
.....gwwwwwwwg.....
......ggggggg......
.........G.........
""".split()

DIAMOND = [".G.", "GGG", ".G."]
END_CAP = [".G.", "GGG", "GGG", ".G."]


def load_font():
    glyphs, name, rows = {}, None, []

    def flush():
        if name is not None:
            glyphs[name] = [row for row in rows if row]

    for line in FONT.read_text().splitlines():
        if line.startswith("== "):
            flush()
            name, rows = line[3:], []
        elif name is not None:
            rows.append(line.strip())
    flush()
    return glyphs


def embolden(bitmap):
    return [
        "".join(
            "#" if "#" in (row + ".")[i] + ("." + row)[i] else "."
            for i in range(len(row) + 1)
        )
        for row in bitmap
    ]


def place(cells, x0, y0, bitmap):
    for y, row in enumerate(bitmap):
        for x, key in enumerate(row):
            if key != ".":
                cells[x0 + x, y0 + y] = key


def lockup():
    """The badge, then SURROUND on a dark plate between two gold rails."""
    glyphs = load_font()
    cells = {}
    place(cells, 0, 0, MARK)
    x0, top = 22, 5
    letters, x = {}, x0
    for char in "SURROUND":
        glyph = embolden(glyphs[char])
        place(letters, x, top, [row.replace("#", "t") for row in glyph])
        x += len(glyph[0]) + 2
    right = x - 3
    for px in range(x0 - 1, right + 2):
        for py in range(top - 1, top + 9):
            cells[px, py] = "i"
    # A one-cell gold shadow under each stroke.
    for (px, py) in letters:
        if (px, py + 1) not in letters:
            cells[px, py + 1] = "d"
    cells.update(letters)
    middle = (x0 + right) // 2
    for rail in (top - 3, top + 10):
        for px in range(x0 - 2, right + 3):
            cells[px, rail] = "g"
        place(cells, middle - 1, rail - 1, DIAMOND)
    place(cells, right + 4, top + 2, END_CAP)
    return cells


def svg(cells, scale):
    xs = [x for x, _ in cells]
    ys = [y for _, y in cells]
    left, top = min(xs), min(ys)
    width, height = max(xs) - left + 1, max(ys) - top + 1
    paths = {}
    for y in range(top, top + height):
        x = left
        while x < left + width:
            key = cells.get((x, y))
            if key is None:
                x += 1
                continue
            run = 1
            while cells.get((x + run, y)) == key:
                run += 1
            paths.setdefault(key, []).append(f"M{x - left} {y - top}h{run}v1h-{run}z")
            x += run
    body = "".join(
        f'<path fill="{COLORS[key]}" d="{"".join(runs)}"/>'
        for key, runs in sorted(paths.items())
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width * scale}" height="{height * scale}" shape-rendering="crispEdges">'
        f"<title>Surround</title>{body}</svg>\n"
    )


def touch_icon(cells, size=180, cell=8):
    icon = Image.new("RGB", (size, size), BACKGROUND)
    xs = [x for x, _ in cells]
    ys = [y for _, y in cells]
    width = (max(xs) - min(xs) + 1) * cell
    height = (max(ys) - min(ys) + 1) * cell
    ox, oy = (size - width) // 2, (size - height) // 2
    for (x, y), key in cells.items():
        color = COLORS[key]
        rgb = tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))
        for dy in range(cell):
            for dx in range(cell):
                icon.putpixel((ox + (x - min(xs)) * cell + dx, oy + (y - min(ys)) * cell + dy), rgb)
    return icon


mark = {}
place(mark, 0, 0, MARK)
brand = PUBLIC / "assets" / "brand"
brand.mkdir(parents=True, exist_ok=True)
outputs = {
    brand / "surround-logo.svg": svg(lockup(), 2),
    brand / "surround-mark.svg": svg(mark, 2),
}
for path, text in outputs.items():
    path.write_text(text)
touch_icon(mark).save(PUBLIC / "apple-touch-icon.png", optimize=True)
for path in [*outputs, PUBLIC / "apple-touch-icon.png"]:
    print(f"{path.relative_to(ROOT)}: {path.stat().st_size} bytes")
