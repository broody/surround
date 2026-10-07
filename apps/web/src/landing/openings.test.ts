import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextInRotation } from "../rotation.ts";
import {
  OPENING_MOVES,
  OPENINGS,
  openingDescription,
  openingPosition,
} from "./openings.ts";

describe("hero openings", () => {
  it("are ten different dan games, each replaying legally under Surround's rules", () => {
    assert.equal(OPENINGS.length, 10);
    assert.equal(new Set(OPENINGS.map((opening) => opening.moves)).size, 10);
    for (const opening of OPENINGS) {
      assert.match(opening.blackRank, /^[4-9]d$/);
      assert.match(opening.whiteRank, /^[4-9]d$/);
      assert.match(opening.moves, /^(?:[a-s]{2})+$/);
      assert.equal(opening.moves.length, OPENING_MOVES * 2);
      // play() throws on an occupied point, suicide or superko.
      const position = openingPosition(opening);
      assert.equal(position.moves.length, OPENING_MOVES);
      assert.equal(position.turn, 1);
      assert.match(openingDescription(opening), new RegExp(opening.black));
    }
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
