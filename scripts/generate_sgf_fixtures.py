#!/usr/bin/env python3
"""Validate vendored SGFs independently and regenerate offline Cairo test data.

Expected margins come from the published RE property, never from Surround.
sgfmill supplies the independent board/capture/area reference. Its area_score
counts mixed-border empty regions for both sides, which cancels in the margin;
only the margin (not individual scores) is used as that reference.
"""

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

from sgfmill import boards, sgf

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/sgf"
OUTPUT = ROOT / "rules/src/fixtures.cairo"
PASS = 361


def require(condition, message):
    if not condition:
        raise ValueError(message)


def half_points(value):
    scaled = Decimal(str(value)) * 2
    require(scaled.is_finite() and scaled == scaled.to_integral_value(),
            f"Not a finite half-point value: {value}")
    return int(scaled)


def packed(points):
    limbs = [0, 0, 0]
    for point in points:
        limbs[point // 128] |= 1 << (point % 128)
    return "Bits { " + ", ".join(
        f"{name}: {hex(value)}" for name, value in zip(("low", "mid", "high"), limbs)
    ) + " }"


def validate(record):
    path = FIXTURES / record["file"]
    data = path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == record["sha256"], "SGF checksum mismatch")
    game = sgf.Sgf_game.from_bytes(data)
    root = game.get_root()
    size = game.get_size()
    require(size in (9, 13, 19), "Unsupported board size")
    require(root.get("RU").lower() == "chinese", "Not a selected area-rules record")
    require(record["source"] in ("kgs", "cgos"), "Unknown source/rules policy")
    require(not root.has_property("HA") or root.get("HA") == 0, "Handicap unsupported")
    komi = half_points(root.get_raw("KM").decode("ascii"))
    require(0 <= komi <= size * size * 2, "Unsupported komi")
    result = root.get("RE").strip()
    require(result == record["result"], "Result differs from provenance manifest")
    match = re.fullmatch(r"([BW])\+([0-9]+(?:\.[0-9]+)?)", result)
    require(match is not None, "Need a numeric winning margin, not resignation/timeout")
    margin = half_points(match[2]) * (1 if match[1] == "B" else -1)
    require(margin != 0, "Use an explicit draw fixture for a draw")

    board = boards.Board(size)
    nodes = list(game.get_main_sequence())
    moves = []
    captures = {"b": 0, "w": 0}
    next_color = "b"
    passes = 0

    def point(coords):
        # sgfmill rows start at the bottom; Surround rows start at the top.
        row, col = coords
        return (size - 1 - row) * size + col

    def state():
        return tuple(board.get(row, col) for row in range(size) for col in range(size))

    seen = {state()}
    for index, node in enumerate(nodes):
        require(len(node) <= 1, "Variations must not be silently discarded")
        require(not any(node.has_property(p) for p in ("AB", "AW", "AE", "PL")),
                "Setup stones/turn overrides unsupported")
        require(not (node.has_property("B") and node.has_property("W")), "Two moves in a node")
        if node.has_property("TB") or node.has_property("TW"):
            require(index == len(nodes) - 1, "Territory annotations must be final")
        color, coords = node.get_move()
        if color is None:
            continue
        require(color == next_color, "Nonalternating move sequence")
        require(passes < 2, "Moves after double pass need explicit resumption metadata")
        next_color = "w" if color == "b" else "b"
        moves.append(PASS if coords is None else point(coords))
        if coords is None:
            passes += 1
            continue
        passes = 0
        occupied = len(board.list_occupied_points())
        board.play(*coords, color)
        # sgfmill permits suicide and does not enforce ko: check both explicitly.
        require(board.get(*coords) == color, "Suicide is incompatible with Surround")
        current = state()
        require(current not in seen, "Positional superko violation")
        seen.add(current)
        captures[color] += occupied + 1 - len(board.list_occupied_points())
    require(passes == 2, "Record must actually end with two passes")

    stones = {color: {point(coords) for c, coords in board.list_occupied_points() if c == color}
              for color in ("b", "w")}
    dead_coords = set()
    final = nodes[-1]
    if record["source"] == "kgs":
        require(final.has_property("TB") and final.has_property("TW"),
                "KGS fixtures need explicit final scoring annotations")
        black_area, white_area = final.get("TB"), final.get("TW")
        require(not black_area & white_area, "Conflicting territory annotations")
        for owner, area in (("b", black_area), ("w", white_area)):
            dead_coords.update(coords for coords in area if board.get(*coords) not in (None, owner))
    else:
        require(not final.has_property("TB") and not final.has_property("TW"),
                "CGOS policy expects no post-play removals")

    # Validate complete groups and select one deterministic representative per group.
    remaining = set(dead_coords)
    representatives = []
    while remaining:
        start = min(remaining, key=point)
        color = board.get(*start)
        group, pending = {start}, [start]
        while pending:
            row, col = pending.pop()
            for neighbor in ((row-1, col), (row+1, col), (row, col-1), (row, col+1)):
                r, c = neighbor
                if 0 <= r < size and 0 <= c < size and neighbor not in group:
                    if board.get(r, c) == color:
                        group.add(neighbor)
                        pending.append(neighbor)
        require(group <= dead_coords, "Annotations select only part of a dead group")
        representatives.append(point(start))
        remaining -= group

    raw_margin = 2 * board.area_score() - komi
    board.apply_setup(set(), set(), dead_coords)
    reference_margin = 2 * board.area_score() - komi
    require(reference_margin == margin,
            f"Published {result} disagrees with independent area margin {reference_margin / 2}")
    return dict(id=record["id"], size=size, komi=komi, moves=moves, captures=captures,
                stones=stones, dead={point(p) for p in dead_coords}, representatives=representatives,
                margin=margin, raw_margin=raw_margin, result=result)


def render(fixtures):
    parts = ["""// Generated by scripts/generate_sgf_fixtures.py. Do not edit by hand.
// Provenance and original SGFs: tests/fixtures/sgf/manifest.json.
use crate::rules::{Bits, Position};

#[derive(Drop)]
pub struct ReplayFixture {
    pub size: u8,
    pub komi_half: u16,
    pub moves: Span<u16>,
    pub final_board: Position,
    pub black_captures: u32,
    pub white_captures: u32,
    pub dead: Bits,
    pub dead_groups: Span<u16>,
    pub margin_half: i32,
    pub raw_margin_half: i32,
}
"""]
    for f in fixtures:
        moves = ", ".join(str(p) for p in f["moves"])
        groups = ", ".join(str(p) for p in f["representatives"])
        parts.append(f"""
// Published result: {f['result']}; {len(f['moves'])} moves; {len(f['dead'])} agreed dead stones.
pub fn {f['id']}() -> ReplayFixture {{
    ReplayFixture {{
        size: {f['size']}, komi_half: {f['komi']},
        moves: array![{moves}].span(),
        final_board: Position {{ black: {packed(f['stones']['b'])}, white: {packed(f['stones']['w'])} }},
        black_captures: {f['captures']['b']}, white_captures: {f['captures']['w']},
        dead: {packed(f['dead'])}, dead_groups: array![{groups}].span(),
        margin_half: {f['margin']}, raw_margin_half: {f['raw_margin']},
    }}
}}
""")
    # Use the pinned project formatter so --check is byte-for-byte reproducible.
    with tempfile.TemporaryDirectory(prefix="surround-sgf-") as directory:
        project = Path(directory)
        (project / "Scarb.toml").write_text(
            '[package]\nname = "surround_fixture_format"\nversion = "0.1.0"\n'
            'edition = "2024_07"\n'
        )
        (project / "src").mkdir()
        temporary = project / "src/lib.cairo"
        temporary.write_text("".join(parts))
        subprocess.run(["scarb", "--manifest-path", str(project / "Scarb.toml"), "fmt"],
                       cwd=ROOT, check=True)
        return temporary.read_text()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if generated Cairo differs")
    args = parser.parse_args()
    records = json.loads((FIXTURES / "manifest.json").read_text())["games"]
    fixtures = []
    for record in records:
        try:
            fixture = validate(record)
        except (ValueError, KeyError) as error:
            raise SystemExit(f"{record['id']}: {error}") from error
        fixtures.append(fixture)
        print(f"{fixture['id']}: {len(fixture['moves'])} moves, "
              f"{len(fixture['dead'])} dead stones, published {fixture['result']} verified")
    generated = render(fixtures)
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != generated:
            raise SystemExit("Generated fixtures differ; run without --check and review the change")
    else:
        OUTPUT.write_text(generated)
    print(f"{len(fixtures)} fixtures validated; Cairo {'up to date' if args.check else 'generated'}")


if __name__ == "__main__":
    main()
