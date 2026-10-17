import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextInRotation } from "../rotation.ts";
import {
  OPENING_MOVES,
  OPENINGS,
  openingDescription,
  openingPosition,
  nextOpeningPosition,
} from "./openings.ts";

describe("hero openings", () => {
  it("are ten different dan games, each replaying legally under Surround's rules", () => {
    assert.equal(OPENINGS.length, 10);
    assert.equal(new Set(OPENINGS.map((opening) => opening.moves)).size, 10);
    for (const opening of OPENINGS) {
      assert.match(opening.blackRank, /^[4-9]d$/);
      assert.match(opening.whiteRank, /^[4-9]d$/);
      assert.match(opening.moves, /^(?:[a-s]{2}|--)+$/);
      assert.ok(opening.moves.length > OPENING_MOVES * 2);
      // play() throws on an occupied point, suicide or superko.
      const position = openingPosition(opening);
      assert.equal(position.moves.length, OPENING_MOVES);
      assert.equal(position.turn, 1);
      assert.match(openingDescription(opening), new RegExp(opening.black));
    }
  });

  it("continues each opening through its complete record, including captures and passes", () => {
    let captures = 0;
    let passes = 0;
    for (const opening of OPENINGS) {
      let position = openingPosition(opening);
      for (let move = OPENING_MOVES; move < opening.moves.length / 2; move++) {
        position = nextOpeningPosition(opening, position);
        const recorded = opening.moves.slice(move * 2, move * 2 + 2);
        const expected =
          recorded === "--"
            ? null
            : (recorded.charCodeAt(1) - 97) * 19 + recorded.charCodeAt(0) - 97;
        assert.equal(position.moves.length, move + 1);
        assert.equal(position.moves.at(-1)?.point, expected);
        captures += position.moves.at(-1)!.captures;
        if (expected === null) passes++;
      }
      assert.strictEqual(nextOpeningPosition(opening, position), position);
      assert.match(
        openingDescription(opening, position.moves.length),
        new RegExp(`first ${position.moves.length} moves`),
      );
    }
    assert.ok(captures > 0);
    assert.equal(passes, 2);
  });
});

describe("load rotation", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  };

  it("takes every choice in turn, one past the last load's", () => {
    const store = memory();
    store.setItem("k", "1");
    assert.deepEqual(
      [0, 1, 2, 3].map(() => nextInRotation("k", 3, store)),
      [2, 0, 1, 2],
    );
  });

  it("starts anywhere without a stored choice, and survives storage errors", () => {
    const first = nextInRotation("k", 3, memory());
    assert.ok(first >= 0 && first < 3);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    const fallback = nextInRotation("k", 3, broken);
    assert.ok(fallback >= 0 && fallback < 3);
    const none = nextInRotation("k", 3, null);
    assert.ok(none >= 0 && none < 3);
  });
});
