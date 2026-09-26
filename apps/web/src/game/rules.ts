export const SIZE = 19;
export type Color = 1 | 2;
export type Stone = 0 | Color;
export type Move = { color: Color; point: number | null; captures: number };
export type Position = {
  board: Stone[];
  turn: Color;
  captures: [number, number];
  moves: Move[];
  hashes: string[];
  passes: number;
  paused: boolean;
};

export const opposite = (color: Color): Color => (color === 1 ? 2 : 1);
export const colorName = (color: Color) => (color === 1 ? "Black" : "White");
export const coordinate = (point: number) =>
  `${"ABCDEFGHJKLMNOPQRST"[point % SIZE]}${SIZE - Math.floor(point / SIZE)}`;
export function emptyPosition(): Position {
  const board = Array<Stone>(SIZE * SIZE).fill(0);
  return {
    board,
    turn: 1,
    captures: [0, 0],
    moves: [],
    hashes: [board.join("")],
    passes: 0,
    paused: false,
  };
}

export function neighbors(point: number): number[] {
  const result: number[] = [];
  if (point >= SIZE) result.push(point - SIZE);
  if (point < SIZE * (SIZE - 1)) result.push(point + SIZE);
  if (point % SIZE > 0) result.push(point - 1);
  if (point % SIZE < SIZE - 1) result.push(point + 1);
  return result;
}

export function groupAt(board: readonly Stone[], point: number) {
  const stones = new Set<number>([point]);
  const liberties = new Set<number>();
  const pending = [point];
  while (pending.length) {
    for (const neighbor of neighbors(pending.pop()!)) {
      if (board[neighbor] === 0) liberties.add(neighbor);
      else if (board[neighbor] === board[point] && !stones.has(neighbor)) {
        stones.add(neighbor);
        pending.push(neighbor);
      }
    }
  }
  return { stones, liberties };
}

export function play(position: Position, point: number | null): Position {
  if (position.paused)
    throw new Error("Both players passed. Resume play or start a new game.");
  const board = [...position.board];
  let captured = 0;
  if (point !== null) {
    if (!Number.isInteger(point) || point < 0 || point >= SIZE * SIZE)
      throw new Error("Choose an intersection on the board.");
    if (board[point]) throw new Error("That intersection is already occupied.");
    board[point] = position.turn;
    for (const neighbor of neighbors(point)) {
      if (board[neighbor] !== opposite(position.turn)) continue;
      const group = groupAt(board, neighbor);
      if (!group.liberties.size) {
        for (const stone of group.stones) board[stone] = 0;
        captured += group.stones.size;
      }
    }
    if (!groupAt(board, point).liberties.size)
      throw new Error("This move has no liberties. Try another intersection.");
    if (position.hashes.includes(board.join("")))
      throw new Error(
        "Superko: a move cannot repeat an earlier board position.",
      );
  }
  const captures: [number, number] = [...position.captures];
  captures[position.turn - 1] += captured;
  const passes = point === null ? position.passes + 1 : 0;
  return {
    board,
    turn: opposite(position.turn),
    captures,
    moves: [
      ...position.moves,
      { color: position.turn, point, captures: captured },
    ],
    hashes:
      point === null ? position.hashes : [...position.hashes, board.join("")],
    passes,
    paused: passes >= 2,
  };
}

// A legal, illustrative opening. Every position is produced through the same rules as user moves.
const STUDY_MOVES = [
  [3, 15],
  [15, 3],
  [3, 3],
  [15, 15],
  [5, 16],
  [13, 16],
  [15, 12],
  [16, 13],
  [13, 14],
  [14, 14],
  [14, 13],
  [15, 14],
  [12, 15],
  [13, 15],
  [11, 16],
  [12, 16],
  [5, 2],
  [3, 5],
  [2, 4],
  [2, 5],
  [3, 4],
  [4, 5],
  [5, 4],
  [6, 5],
  [6, 3],
  [7, 4],
  [9, 3],
  [10, 5],
  [16, 5],
  [16, 4],
  [15, 5],
  [14, 4],
];

export function studyHistory(): Position[] {
  const history = [emptyPosition()];
  for (const [row, col] of STUDY_MOVES)
    history.push(play(history.at(-1)!, row * SIZE + col));
  return history;
}
