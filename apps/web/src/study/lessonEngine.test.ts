import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { areaScore, groupAt } from "../game/rules.ts";
import { BASICS } from "./basics.ts";
import {
  answer,
  decodePoints,
  lessonMarks,
  lessonPosition,
  pageSize,
  reply,
  startPuzzle,
  type LessonPage,
  type PuzzleState,
} from "./lessonEngine.ts";

type Puzzle = Extract<LessonPage, { kind: "puzzle" }>;

/** Plays a line, letting the engine supply the opponent's replies. */
function playLine(page: Puzzle, line: string) {
  const moves = decodePoints(line, pageSize(page));
  let state: PuzzleState = startPuzzle(page);
  for (let i = 0; i < moves.length; i += 2) {
    state = answer(state, moves[i]);
    if (state.awaitingReply) {
      state = reply(state);
      if (i + 1 < moves.length)
        assert.equal(
          state.position.moves.at(-1)?.point,
          moves[i + 1],
          `the opponent replies along "${line}"`,
        );
    }
  }
  return state;
}

const pages = BASICS.flatMap((lesson, l) =>
  lesson.pages.map((page, p) => ({ page, name: `${lesson.title} ${p + 1}` })),
);

describe("lesson notation", () => {
  it("reads both OGS coordinate styles", () => {
    // c3 counts rows up from the bottom and skips the letter i; "cg" is SGF.
    assert.deepEqual(decodePoints("c3", 9), [6 * 9 + 2]);
    assert.deepEqual(decodePoints("cg", 9), [6 * 9 + 2]);
    assert.deepEqual(decodePoints("j9a1", 9), [8, 72]);
    assert.deepEqual(decodePoints("k16", 19), [3 * 19 + 9]);
    assert.throws(() => decodePoints("z9", 9));
    assert.throws(() => decodePoints("j10", 9));
  });
  it("turns marks into shapes and labels", () => {
    assert.deepEqual(lessonMarks({ marks: { triangle: "a9", A: "b9" } }), [
      { point: 0, kind: "triangle" },
      { point: 1, kind: "label", text: "A" },
    ]);
  });
});

describe("puzzle play", () => {
  const page: Puzzle = {
    kind: "puzzle",
    text: "",
    goal: "",
    black: "a3b3c3d3d2d1",
    white: "a2b2c2c1",
    correct: ["a1b1a1"],
    wrong: ["b1a1"],
  };
  it("waits for the opponent's reply, then solves", () => {
    let state = answer(startPuzzle(page), decodePoints("a1", 9)[0]);
    assert.equal(state.outcome, "playing");
    assert.equal(state.awaitingReply, true);
    state = reply(state);
    assert.equal(state.awaitingReply, false);
    assert.equal(playLine(page, "a1b1a1").outcome, "correct");
  });
  it("fails a wrong line and any move off the lines", () => {
    assert.equal(playLine(page, "b1a1").outcome, "wrong");
    assert.equal(playLine(page, "e5").outcome, "wrong");
  });
  it("leaves the puzzle unchanged on an illegal move", () => {
    assert.throws(() => answer(startPuzzle(page), decodePoints("a3", 9)[0]));
  });
});

describe("the basics lessons", () => {
  for (const { page, name } of pages) {
    it(`${name} sets up a legal position`, () => {
      const position = lessonPosition(page);
      assert.equal(position.board.length, pageSize(page) ** 2);
      position.board.forEach((stone, point) => {
        if (stone)
          assert.ok(
            groupAt(position.board, point).liberties.size > 0,
            `the stone at ${point} has a liberty`,
          );
      });
      lessonMarks(page);
    });

    if (page.kind === "puzzle" && page.correct !== "anywhere") {
      it(`${name} is solved by every correct line`, () => {
        for (const line of page.correct as string[])
          assert.equal(playLine(page, line).outcome, "correct", line);
      });
      it(`${name} fails every wrong line`, () => {
        for (const line of page.wrong ?? [])
          assert.equal(playLine(page, line).outcome, "wrong", line);
      });
    }
  }

  it("counts each territory answer by Surround's area rules", () => {
    const territory = BASICS.find((lesson) => lesson.title === "Territory")!;
    // The dead stones inside the corner on the last two pages.
    const dead = new Map([
      [10, "hg"],
      [11, "ehfh"],
    ]);
    territory.pages.forEach((page, index) => {
      assert.equal(page.kind, "choice");
      if (page.kind !== "choice") return;
      const { board } = lessonPosition(page);
      const score = areaScore(board, new Set(decodePoints(dead.get(index), 9)));
      // The corner is the smaller of the two territories; the open board
      // around the walls belongs to the other color.
      const counts = ([1, 2] as const).map(
        (color) =>
          score.owner.filter(
            (owner, point) => owner === color && board[point] !== color,
          ).length,
      );
      assert.equal(
        String(Math.min(...counts)),
        page.answer,
        `page ${index + 1}`,
      );
      assert.ok(page.options.includes(page.answer));
    });
  });

  it("scores the finished game as its page says", () => {
    const ending = BASICS.find((lesson) => lesson.title === "End of the Game")!;
    const removal = ending.pages[1];
    assert.equal(removal.kind, "removal");
    if (removal.kind !== "removal") return;
    const { board } = lessonPosition(removal);
    const dead = new Set(decodePoints(removal.dead, 9));
    // Removal marks whole groups, so the target must be one.
    const [first] = dead;
    assert.deepEqual(groupAt(board, first).stones, dead);
    const score = areaScore(board, dead);
    assert.match(ending.pages[2].text, new RegExp(`for ${score.black}\\.`));
    assert.match(ending.pages[2].text, new RegExp(`for ${score.white}\\.`));
    assert.deepEqual(
      areaScore(lessonPosition(ending.pages[2]).board).black,
      score.black,
    );
  });

  it("makes the just-taken ko illegal to retake at once", () => {
    const ko = BASICS.find((lesson) => lesson.title === "Ko")!.pages[4];
    assert.equal(ko.kind, "puzzle");
    if (ko.kind !== "puzzle") return;
    const state = startPuzzle(ko);
    assert.equal(state.position.turn, 1);
    assert.equal(state.position.captures[1], 1);
    assert.throws(() => answer(state, decodePoints("a4", 13)[0]), /Superko/);
  });
});
