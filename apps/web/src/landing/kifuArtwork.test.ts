import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { emptyPosition, play, type Color } from "../game/rules.ts";

const source = readFileSync(
  new URL("../../../../tests/fixtures/sgf/kgs_2019_04_10_39.sgf", import.meta.url),
  "utf8",
);
const artwork = readFileSync(
  new URL("../../public/assets/kifu.svg", import.meta.url),
  "utf8",
);

// This vendored SGF is a single mainline without setup stones or variations.
const moves = Array.from(
  source.matchAll(/(?:^|[;\]\s])([BW])\[([a-s]{2})?\]/g),
  (match) => ({
    color: (match[1] === "B" ? 1 : 2) as Color,
    point: match[2]
      ? (match[2].charCodeAt(1) - 97) * 19 + match[2].charCodeAt(0) - 97
      : null,
  }),
);

describe("recorded kifu artwork", () => {
  it("shows only surviving stones from the real opening's top-left crop", () => {
    assert.equal(moves.length, 309);
    let position = emptyPosition();
    const numbers = Array<number>(361).fill(0);
    for (const [index, move] of moves.slice(0, 60).entries()) {
      assert.equal(position.turn, move.color);
      position = play(position, move.point);
      for (let point = 0; point < 361; point++)
        if (!position.board[point]) numbers[point] = 0;
      if (move.point !== null) numbers[move.point] = index + 1;
    }
    // Black 39 at B16 was captured: never draw every historical move together.
    assert.deepEqual(position.captures, [0, 1]);
    const expected = position.board.flatMap((color, point) =>
      color && point % 19 < 8 && Math.floor(point / 19) < 8
        ? [{ x: 73 + (point % 19) * 18, y: 87 + Math.floor(point / 19) * 18,
            color, move: numbers[point] }]
        : [],
    );
    const stones = artwork.match(/<g id="recorded-stones"[^>]*>([\s\S]*?)<\/g>/)![1];
    const actual = Array.from(stones.matchAll(
      /<circle cx="(\d+)" cy="(\d+)" r="8\.5" fill="([^"]+)"[^>]*\/><text x="(\d+)" y="(\d+)"[^>]*>(\d+)<\/text>/g,
    ), (match) => {
      assert.equal(match[1], match[4]);
      assert.equal(match[2], match[5]);
      return { x: Number(match[1]), y: Number(match[2]),
        color: match[3] === "#111820" ? 1 : 2, move: Number(match[6]) };
    });
    assert.equal(actual.length, 35);
    assert.deepEqual(actual, expected);
    assert.ok(!actual.some((stone) => stone.move === 39));
    // Enlarge the whole detail together, preserving the tight stone/grid ratio.
    assert.ok(artwork.includes('id="kifu-board-detail" transform="translate(-28 -48) scale(1.2)"'));
    for (const stone of actual) {
      assert.ok((stone.x - 9) * 1.2 - 28 > 37.6);
      assert.ok((stone.x + 9) * 1.2 - 28 < 247.2);
      assert.ok((stone.y - 9) * 1.2 - 48 > 48);
      assert.ok((stone.y + 9) * 1.2 - 48 < 244);
    }
    assert.ok(artwork.includes('d="M37.6 18H223.2L247.2 42V244H37.6V18Z"'));
    const padding = [
      73 * 1.2 - 28 - 37.6, // left grid edge to paper; ignore move 60's overhang
      247.2 - (211 * 1.2 - 28), // rightmost grid line to paper
      244 - (225 * 1.2 - 48), // lowest grid line to paper
    ];
    assert.ok(padding.every((value) => Math.abs(value - 22) < 1e-10));
  });

  it("uses the published result, omits the move count and labels the sheet alone", () => {
    const result = source.match(/RE\[([BW])\+([\d.]+)\]/)!;
    assert.ok(artwork.includes(`>${result[1]}+${Number(result[2])}</text>`));
    const resultX = Number(artwork.match(/<text x="([\d.]+)" y="43"/)![1]);
    assert.ok(Math.abs(resultX - (73 * 1.2 - 28)) < 1e-10);
    assert.ok(!/>[^<]*MOVES<\/text>/.test(artwork));
    assert.equal((artwork.match(/>KIFU<\/text>/g) ?? []).length, 1);
    assert.ok(artwork.includes('<text x="142.4" y="260">KIFU</text>'));
    // The ranked play section shows Starknet; the sheet sits centered alone.
    assert.ok(!artwork.includes("STARKNET"));
    assert.ok(artwork.includes('viewBox="0 0 284.8 280"'));
    assert.ok(Math.abs(37.6 + 247.2 - 284.8) < 1e-10);
  });
});
