import { Panel } from "../components/ui";
import { SIZE } from "../game/rules";
import { OPENINGS, openingPosition, type Opening } from "./openings";

// kifu.svg's paper and grid geometry, so the sheets behind it match its size.
const VIEW = "0 0 284.8 280";
const PAPER = "M37.6 18H223.2L247.2 42V244H37.6V18Z";
const FOLD = "M223.2 18V42H247.2";
const CROP = 8;

type Side = "left" | "right";

// The columns of a side sheet that clear the front one (its stones included),
// given the offsets in features.css: the left sheet's first three, the right
// sheet's last two.
const peeks = (side: Side, col: number) => (side === "left" ? col <= 2 : col >= 6);

/** The 8×8 window of an opening that shows the most stones where the sheet
 * peeks out (then the most in all), numbered as in a kifu. */
function crop(opening: Opening, side: Side) {
  const position = openingPosition(opening);
  const numbers = new Map<number, number>();
  for (let i = 0; i < opening.moves.length; i += 2) {
    const sgf = opening.moves.slice(i, i + 2);
    numbers.set(
      (sgf.charCodeAt(1) - 97) * SIZE + sgf.charCodeAt(0) - 97,
      i / 2 + 1,
    );
  }
  const offsets = Array.from({ length: SIZE - CROP + 1 }, (_, i) => i);
  const crops = offsets.flatMap((top) =>
    offsets.map((left) => {
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
  const score = (stones: (typeof crops)[number]) =>
    stones.filter((stone) => peeks(side, stone.col)).length * 100 + stones.length;
  return crops.reduce((best, stones) => (score(stones) > score(best) ? stones : best));
}

/** A sheet behind the recorded game: a window onto another dan game. */
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
        {crop(opening, side).map(({ row, col, color, move }) => (
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

// Two games other than the one kifu.svg records, one to each side: of the
// ten openings, the two with the most stones where each sheet peeks out.
const BACKS = [
  { opening: OPENINGS[2], side: "left" },
  { opening: OPENINGS[9], side: "right" },
] as const;

export default function KifuStack() {
  return (
    <Panel as="div" className="kifu-stack-panel">
      <div className="kifu-stack">
        <div className="kifu-stack-art">
        {/* One unrotated layer, so its dither stays on the screen's pixel grid. */}
        <div className="kifu-backs">
          {BACKS.map(({ opening, side }, index) => (
            <BackSheet
              key={opening.game}
              opening={opening}
              side={side}
              index={index}
            />
          ))}
        </div>
        <svg className="kifu-sheet kifu-backing" viewBox={VIEW} aria-hidden="true">
          <path className="kifu-paper" d={PAPER} />
        </svg>
        <img
          className="kifu-sheet kifu-front"
          src="/assets/kifu.svg"
          alt="A kifu: a cropped opening from the recorded TieBot2–okahachi game, won by Black by 1.5 points"
        />
        </div>
      </div>
    </Panel>
  );
}
