import { Panel } from "../components/ui";
import { SIZE } from "../game/rules";
import { OPENINGS, openingPosition, type Opening } from "./openings";

// kifu.svg's paper and grid geometry, so the sheets behind it match its size.
const VIEW = "0 0 284.8 280";
const PAPER = "M37.6 18H223.2L247.2 42V244H37.6V18Z";
const FOLD = "M223.2 18V42H247.2";
const CROP = 8;

type Side = "left" | "right" | "top";

// Which part of a sheet peeks out from behind the one in front.
const peeks = (side: Side, row: number, col: number) =>
  side === "left" ? col < CROP / 2 : side === "right" ? col >= CROP / 2 : row < 3;

/** The 8×8 corner of an opening that shows the most stones on the sheet's
 * visible side, numbered as in a kifu. */
function corner(opening: Opening, side: Side) {
  const position = openingPosition(opening);
  const numbers = new Map<number, number>();
  for (let i = 0; i < opening.moves.length; i += 2) {
    const sgf = opening.moves.slice(i, i + 2);
    numbers.set(
      (sgf.charCodeAt(1) - 97) * SIZE + sgf.charCodeAt(0) - 97,
      i / 2 + 1,
    );
  }
  const crops = [0, SIZE - CROP].flatMap((top) =>
    [0, SIZE - CROP].map((left) => {
      const stones = [];
      for (let row = 0; row < CROP; row++)
        for (let col = 0; col < CROP; col++) {
          const point = (top + row) * SIZE + left + col;
          const color = position.board[point];
          if (color) stones.push({ row, col, color, move: numbers.get(point)! });
        }
      return stones;
    }),
  );
  const shown = (crop: typeof crops[number]) =>
    crop.filter((stone) => peeks(side, stone.row, stone.col)).length;
  return crops.reduce((best, crop) => (shown(crop) > shown(best) ? crop : best));
}

/** A sheet behind the recorded game: another dan game's busiest corner. */
function BackSheet({
  opening,
  side,
  index,
}: {
  opening: Opening;
  side: Side;
  index: number;
}) {
  return (
    <svg
      className={`kifu-sheet kifu-back kifu-back-${index}`}
      viewBox={VIEW}
      aria-hidden="true"
    >
      <path className="kifu-paper" d={PAPER} />
      <path className="kifu-fold" d={FOLD} />
      <g transform="translate(-28 -48) scale(1.2)">
        <g className="kifu-grid">
          {Array.from({ length: CROP }, (_, i) => (
            <path
              key={i}
              d={`M73 ${87 + i * 18}H211M${73 + i * 18} 87V225`}
            />
          ))}
        </g>
        {corner(opening, side).map(({ row, col, color, move }) => (
          <g key={`${row}-${col}`} className={color === 1 ? "black" : "white"}>
            <circle cx={73 + col * 18} cy={87 + row * 18} r="8.5" />
            <text x={73 + col * 18} y={87 + row * 18}>
              {move}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// Three games other than the one kifu.svg records, spread across the set.
const BACKS = [
  { opening: OPENINGS[1], side: "left" },
  { opening: OPENINGS[5], side: "right" },
  { opening: OPENINGS[8], side: "top" },
] as const;

export default function KifuStack() {
  return (
    <Panel as="div" className="kifu-stack-panel">
      <div className="kifu-stack">
        {BACKS.map(({ opening, side }, index) => (
          <BackSheet
            key={opening.game}
            opening={opening}
            side={side}
            index={index}
          />
        ))}
        <svg className="kifu-sheet kifu-backing" viewBox={VIEW} aria-hidden="true">
          <path className="kifu-paper" d={PAPER} />
        </svg>
        <img
          className="kifu-sheet kifu-front"
          src="/assets/kifu.svg"
          alt="A kifu: a cropped opening from the recorded TieBot2–okahachi game, won by Black by 1.5 points"
        />
      </div>
    </Panel>
  );
}
