import type { BoardMark } from "../game/BoardCanvas";
import type { BoardRegion } from "../game/region.ts";
import {
  emptyPosition,
  opposite,
  play,
  type Color,
  type Position,
} from "../game/rules.ts";

/** A board as the OGS lessons describe one. Points use OGS notation: either
 * letter and row ("c3d4", rows counted up from the bottom, no letter i) or
 * SGF-style letter pairs ("ccdd", column then row from the top-left). */
export type LessonBoard = {
  /** Lines per side; lessons default to 9×9. */
  size?: 9 | 13 | 19;
  black?: string;
  white?: string;
  toPlay?: "black" | "white";
  /** Moves played before the page starts, ending just before `toPlay`'s turn,
   * so the rules know the history (e.g. a ko that was just taken). */
  setup?: string;
  /** "triangle", "cross", "circle" or "square" mark their points; any other
   * key is a label drawn on its points, such as "A" or "1". */
  marks?: Record<string, string>;
  /** Show only part of the board. */
  bounds?: BoardRegion;
};

/** What the learner does on a page. */
export type PageTask =
  | {
      kind: "puzzle";
      /** Move sequences that solve the page, alternating the player's moves
       * with the opponent's replies, or "anywhere" for any legal move. */
      correct: string[] | "anywhere";
      /** Sequences that fail. Any move off every line fails too. */
      wrong?: string[];
    }
  | { kind: "choice"; options: string[]; answer: string }
  /** A button, such as Pass, completes the page. */
  | { kind: "action"; button: string }
  /** Click stones to mark their groups dead until exactly these are. */
  | { kind: "removal"; dead: string };

export type LessonPage = LessonBoard & {
  /** What Ayu explains before the task. */
  text: string;
  /** The task, in one line. */
  goal: string;
  /** Where the page comes from, for pages drawn from a library. */
  id?: string;
  /** Problems found when the page was checked against Surround's rules. */
  issues?: string[];
} & PageTask;

export type Lesson = { title: string; subtext: string; pages: LessonPage[] };

const LETTERS = "abcdefghjklmnopqrst";

export function decodePoints(text: string | undefined, size: number) {
  if (!text) return [];
  const points: number[] = [];
  const pretty = /\d/.test(text);
  const pattern = pretty ? /([a-hj-t])(\d{1,2})/y : /([a-s])([a-s])/y;
  while (pattern.lastIndex < text.length) {
    const match = pattern.exec(text);
    if (!match) throw new Error(`Unreadable points "${text}"`);
    const col = pretty
      ? LETTERS.indexOf(match[1])
      : match[1].charCodeAt(0) - 97;
    const row = pretty ? size - Number(match[2]) : match[2].charCodeAt(0) - 97;
    if (col >= size || row < 0 || row >= size)
      throw new Error(`"${match[0]}" is off a ${size}×${size} board`);
    points.push(row * size + col);
  }
  return points;
}

export const pageSize = (page: LessonBoard) => page.size ?? 9;
export const playerColor = (page: LessonBoard): Color =>
  page.toPlay === "white" ? 2 : 1;

export function lessonPosition(page: LessonBoard): Position {
  const size = pageSize(page);
  const toPlay = playerColor(page);
  const setup = decodePoints(page.setup, size);
  let position = emptyPosition(size);
  for (const point of decodePoints(page.black, size)) position.board[point] = 1;
  for (const point of decodePoints(page.white, size)) position.board[point] = 2;
  position.turn = setup.length % 2 ? opposite(toPlay) : toPlay;
  position.hashes = [position.board.join("")];
  for (const point of setup) position = play(position, point);
  return position;
}

const SHAPES = new Set(["triangle", "cross", "circle", "square"]);

export function lessonMarks(page: LessonBoard): BoardMark[] {
  const size = pageSize(page);
  return Object.entries(page.marks ?? {}).flatMap(([key, points]) =>
    decodePoints(points, size).map((point) =>
      SHAPES.has(key)
        ? { point, kind: key as BoardMark["kind"] }
        : { point, kind: "label" as const, text: key },
    ),
  );
}

export type MoveNode = {
  point: number;
  correct?: boolean;
  wrong?: boolean;
  next: MoveNode[];
};

export function moveTree(correct: string[], wrong: string[], size: number) {
  const root: MoveNode[] = [];
  const add = (line: string, flag: "correct" | "wrong") => {
    let branches = root;
    let node: MoveNode | undefined;
    for (const point of decodePoints(line, size)) {
      node = branches.find((branch) => branch.point === point);
      if (!node) branches.push((node = { point, next: [] }));
      branches = node.next;
    }
    if (node) node[flag] = true;
  };
  for (const line of correct) add(line, "correct");
  for (const line of wrong) add(line, "wrong");
  return root;
}

export type PuzzleState = {
  position: Position;
  /** The moves that stay on a line from here, or "anywhere". */
  branches: MoveNode[] | "anywhere";
  outcome: "playing" | "correct" | "wrong";
  /** The opponent's reply is due before the player moves again. */
  awaitingReply: boolean;
};

export function startPuzzle(
  page: Extract<LessonPage, { kind: "puzzle" }>,
): PuzzleState {
  return {
    position: lessonPosition(page),
    branches:
      page.correct === "anywhere"
        ? "anywhere"
        : moveTree(page.correct, page.wrong ?? [], pageSize(page)),
    outcome: "playing",
    awaitingReply: false,
  };
}

function reach(position: Position, node: MoveNode | undefined): PuzzleState {
  const outcome =
    !node || node.wrong || (!node.correct && !node.next.length)
      ? "wrong"
      : node.correct
        ? "correct"
        : "playing";
  return {
    position,
    branches: node?.next ?? [],
    outcome,
    awaitingReply: outcome === "playing",
  };
}

/** The player's move. Throws the rules' error for an illegal move, which
 * leaves the puzzle as it was. */
export function answer(state: PuzzleState, point: number): PuzzleState {
  const position = play(state.position, point);
  if (state.branches === "anywhere")
    return { position, branches: [], outcome: "correct", awaitingReply: false };
  const node = state.branches.find((branch) => branch.point === point);
  return reach(position, node);
}

/** Plays the opponent's reply: `point` if given, otherwise the first line
 * that continues. */
export function reply(state: PuzzleState, point?: number): PuzzleState {
  if (state.branches === "anywhere" || !state.branches.length) return state;
  const node =
    point === undefined
      ? state.branches[0]
      : state.branches.find((branch) => branch.point === point);
  if (!node) throw new Error(`No reply at ${point} on this line`);
  const next = reach(play(state.position, node.point), node);
  return { ...next, awaitingReply: false };
}

/** Plays one of a puzzle's lines move by move, player and opponent in turn,
 * and returns where it ends. Throws if a move is illegal under Surround's
 * rules or the line leaves the move tree. */
export function replayLine(
  page: Extract<LessonPage, { kind: "puzzle" }>,
  line: string,
) {
  let state = startPuzzle(page);
  decodePoints(line, pageSize(page)).forEach((point, index) => {
    try {
      state = state.awaitingReply ? reply(state, point) : answer(state, point);
    } catch (error) {
      throw new Error(
        `move ${index + 1} of "${line}": ${error instanceof Error ? error.message : error}`,
      );
    }
  });
  return state;
}
