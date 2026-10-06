# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools[woff]>=4.50", "skia-pathops>=0.8"]
# ///
"""Builds Surround Sans from the bitmaps in fonts/surround-sans.txt.

Writes a Regular (400) and a Bold (700) WOFF2 to src/assets/fonts/. Bold
widens every stroke one cell to the right, so its glyphs are a cell wider.

    uv run scripts/build-surround-sans.py
"""

from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts" / "surround-sans.txt"
OUT = ROOT / "src" / "assets" / "fonts"

UPM = 1000
CELL = 80  # A cap height of 8 cells matches Pixelify Sans's 643 units.
CAP = 8 * CELL
X_HEIGHT = 6 * CELL
# Pixelify Sans's line metrics, so swapping fonts doesn't move any text.
ASCENT, DESCENT = 920, -280
VERSION = "1.000"


def load():
    glyphs, name, rows = {}, None, []

    def flush():
        if name is None:
            return
        bitmap = [row for row in rows if row]
        if len(bitmap) not in (8, 10):
            raise SystemExit(f"{name}: {len(bitmap)} rows, expected 8 or 10")
        if len({len(row) for row in bitmap}) != 1:
            raise SystemExit(f"{name}: rows of different widths")
        if not set("".join(bitmap)) <= set("#."):
            raise SystemExit(f"{name}: only # and . may draw a glyph")
        bitmap += ["." * len(bitmap[0])] * (10 - len(bitmap))
        char = (
            " "
            if name == "space"
            else chr(int(name[2:], 16))
            if name.startswith("U+")
            else name
        )
        if char in glyphs:
            raise SystemExit(f"{name} is drawn twice")
        glyphs[char] = bitmap

    # Everything before the first glyph is the file's header.
    for line in SOURCE.read_text().splitlines():
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


def outline(bitmap):
    """The union of the bitmap's cells, as clockwise TrueType contours."""
    path = pathops.Path()
    pen = path.getPen()
    for row_index, row in enumerate(bitmap):
        top = CAP - row_index * CELL
        for col, cell in enumerate(row):
            if cell != "#":
                continue
            left = CELL // 2 + col * CELL
            pen.moveTo((left, top - CELL))
            pen.lineTo((left, top))
            pen.lineTo((left + CELL, top))
            pen.lineTo((left + CELL, top - CELL))
            pen.closePath()
    path = pathops.simplify(path, clockwise=True)
    glyph_pen = TTGlyphPen(None)
    path.draw(glyph_pen)
    return glyph_pen.glyph()


def notdef():
    pen = TTGlyphPen(None)
    left, right, top = CELL // 2, CELL // 2 + 5 * CELL, CAP
    for contour in (
        [(left, 0), (left, top), (right, top), (right, 0)],
        [
            (left + CELL, CELL),
            (right - CELL, CELL),
            (right - CELL, top - CELL),
            (left + CELL, top - CELL),
        ],
    ):
        pen.moveTo(contour[0])
        for point in contour[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def build(glyphs, style, weight):
    order = [".notdef"]
    cmap, outlines, metrics = {}, {".notdef": notdef()}, {".notdef": (6 * CELL, CELL // 2)}
    for char, bitmap in sorted(glyphs.items(), key=lambda item: ord(item[0])):
        if weight >= 700:
            bitmap = embolden(bitmap)
        name = "space" if char == " " else f"uni{ord(char):04X}"
        order.append(name)
        cmap[ord(char)] = name
        glyph = outline(bitmap)
        outlines[name] = glyph
        glyph.recalcBounds(None)
        metrics[name] = (
            (len(bitmap[0]) + 1) * CELL,
            getattr(glyph, "xMin", 0),
        )

    family = "Surround Sans"
    postscript = f"SurroundSans-{style}"
    font = FontBuilder(UPM, isTTF=True)
    font.setupGlyphOrder(order)
    font.setupCharacterMap(cmap)
    font.setupGlyf(outlines)
    font.setupHorizontalMetrics(metrics)
    font.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    font.setupNameTable(
        {
            "familyName": family,
            "styleName": style,
            "uniqueFontIdentifier": f"{VERSION};{postscript}",
            "fullName": f"{family} {style}",
            "version": f"Version {VERSION}",
            "psName": postscript,
        }
    )
    font.setupOS2(
        version=4,
        usWeightClass=weight,
        sTypoAscender=ASCENT,
        sTypoDescender=DESCENT,
        sTypoLineGap=0,
        usWinAscent=ASCENT,
        usWinDescent=-DESCENT,
        sCapHeight=CAP,
        sxHeight=X_HEIGHT,
        # USE_TYPO_METRICS, plus BOLD or REGULAR.
        fsSelection=(1 << 7) | (1 << 5 if weight >= 700 else 1 << 6),
        achVendID="NONE",
    )
    font.setupPost(underlinePosition=-2 * CELL, underlineThickness=CELL)
    # A fixed date, so rebuilding unchanged glyphs gives identical files.
    stamp = timestampFromString("Tue Oct 06 00:00:00 2026")
    font.updateHead(
        macStyle=1 if weight >= 700 else 0, created=stamp, modified=stamp
    )
    font.font.recalcTimestamp = False
    font.font.flavor = "woff2"
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"surround-sans-{weight}.woff2"
    font.save(path)
    print(f"{path.relative_to(ROOT)}: {len(order)} glyphs, {path.stat().st_size} bytes")


glyphs = load()
build(glyphs, "Regular", 400)
build(glyphs, "Bold", 700)
