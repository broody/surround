import { useRef, useState } from "react";
import { Link, Timer, TrendingUp } from "lucide-react";
import { BANDS } from "@surround/offchain/profile";
import { BYOYOMI, byoyomiLabel } from "@surround/offchain/clocks";
import { maxHandicap } from "@surround/offchain/handicap";
import { Button, Dialog, Input, Select, StoneDot, classNames } from "../components/ui";
import { CHARACTERS, type BoardSize } from "../../../../shared/lobby.ts";
import { BoardGlyph } from "../lobby/LobbyParts";
import { useRated } from "./RatedProvider";
// The choice cards are the profile's level cards.
import "../wallet/profile.css";

/** What each kind of game means, rated on a `size` board, row for row: rank, clock, chain. */
const kinds = (size: number) => [
  { rated: true, name: "Rated", rows: ["Counts toward rank", byoyomiLabel(BYOYOMI[size]), "Settled onchain"] },
  { rated: false, name: "Casual", rows: ["No rank change", "No clock", "Nothing onchain"] },
];
const ICONS = [TrendingUp, Timer, Link];
type Color = "black" | "white";

/** The board each kind starts on until the player picks one: rated is the full game, casual a quick one. */
const DEFAULT_SIZE = { rated: 19, casual: 9 } as const;

/**
 * A character card's way into a game against its AI anchor: Play, then a
 * dialog asking which kind, rated (on Starknet, on the board's byo-yomi) or
 * casual (untimed, nothing onchain), then the board size, 19 × 19 for rated
 * and 9 × 9 for casual until the player picks one. In a rated game the weaker
 * takes black, which the dialog states; in a casual one the color is the
 * player's, and the game may be a handicap game: Black's stones on the star
 * points (2 to 9, 5 on 9 × 9), whoever Black is, or none with no komi. Shown
 * when the connected wallet could play one.
 */
export default function AnchorButtons({ characterId }: { characterId: string }) {
  const { anchorFor, ready, reason, start, starting, player, band } = useRated();
  const dialog = useRef<HTMLDialogElement>(null);
  const [rated, setRated] = useState(true);
  const [picked, setPicked] = useState<BoardSize | null>(null);
  const [chosen, setChosen] = useState<Color>("black");
  const [handicap, setHandicap] = useState(0);
  const anchor = anchorFor(characterId);
  if (!player.data || !anchor) return null;
  const busy = anchor.keys === 0;
  const disabled = !ready || busy || starting !== null;
  const why = reason ?? (busy ? "This AI is busy; try again shortly." : undefined);
  const name = CHARACTERS.find((c) => c.id === characterId)?.name.split(" ")[0] ?? "the AI";
  const title = `play-${characterId}`;
  // A rated game's colors as the matchmaker will seat them: the weaker takes black, the player at equal rank.
  const rank = player.data.shown ?? (band ? (30 - parseInt(BANDS[band] ?? "30", 10)) * 10 : null);
  const theirs = anchor.shown;
  const given: Color = rank === null || theirs === null || rank <= theirs ? "black" : "white";
  const seat =
    rank === null || theirs === null
      ? "You play Black."
      : rank < theirs
        ? "You play Black, as the lower rank."
        : rank === theirs
          ? "You play Black, at even rank."
          : `You play White; ${name} is the lower rank.`;
  const sizeFor = (kind: keyof typeof DEFAULT_SIZE) => picked ?? DEFAULT_SIZE[kind];
  const size = sizeFor(rated ? "rated" : "casual");
  // A smaller board takes fewer stones: the most it takes, until a bigger board again.
  const stones = Math.min(handicap, maxHandicap(size));
  return (
    <>
      <Button variant="primary" disabled={disabled} title={why} onClick={() => dialog.current?.showModal()}>
        {starting === characterId ? "Signing…" : "Play"}
      </Button>
      <Dialog ref={dialog} onCloseRequest={() => dialog.current?.close()} aria-labelledby={title}>
        <form
          className="anchor-play"
          onSubmit={(event) => {
            event.preventDefault();
            dialog.current?.close();
            void start(characterId, size, rated, rated ? undefined : chosen, rated ? 0 : stones);
          }}
        >
          <h2 id={title}>Play {name}</h2>
          <div className="anchor-choice">
            {kinds(sizeFor("rated")).map((kind) => (
              <label
                key={kind.name}
                className={classNames("level-card", kind.rated ? "is-rated" : "is-casual", rated === kind.rated && "is-selected")}
              >
                <Input
                  type="radio"
                  name={title}
                  className="sr-only"
                  checked={rated === kind.rated}
                  onChange={() => setRated(kind.rated)}
                />
                <strong className="level-card-name">{kind.name}</strong>
                {kind.rows.map((row, i) => {
                  const Icon = ICONS[i];
                  return (
                    <span className="anchor-choice-row" key={row}>
                      <Icon size={14} aria-hidden="true" /> {row}
                    </span>
                  );
                })}
              </label>
            ))}
          </div>
          <div className="lobby-size-options" role="group" aria-label="Board size">
            {([9, 13, 19] as const).map((value) => (
              <Button variant="tab" key={value} aria-pressed={size === value} onClick={() => setPicked(value)}>
                <BoardGlyph size={value} />
                <span>
                  {value} × {value}
                </span>
              </Button>
            ))}
          </div>
          {/* Both kinds' last row share one slot, sized to the taller, so switching kinds moves nothing. */}
          <div className="anchor-slot">
            <p className="anchor-seat" title="In a rated game the weaker player takes black." inert={!rated} aria-hidden={!rated}>
              <StoneDot color={given} />
              {seat}
            </p>
            <div className="anchor-casual" inert={rated} aria-hidden={rated}>
              <div className="lobby-size-options" role="group" aria-label="Your color">
                {(["black", "white"] as const).map((value) => (
                  <Button variant="tab" key={value} aria-pressed={chosen === value} onClick={() => setChosen(value)}>
                    <StoneDot color={value} />
                    <span>{value === "black" ? "Black" : "White"}</span>
                  </Button>
                ))}
              </div>
              <div className="anchor-handicap">
                <label htmlFor={`${title}-handicap`}>
                  Handicap
                  {stones >= 2 && <span> · {chosen === "black" ? "your stones" : `${name}'s stones`}</span>}
                </label>
                <Select id={`${title}-handicap`} value={stones} onChange={(event) => setHandicap(Number(event.target.value))}>
                  <option value={0}>Even</option>
                  <option value={1}>½ komi</option>
                  {Array.from({ length: maxHandicap(size) - 1 }, (_, i) => i + 2).map((n) => (
                    <option key={n} value={n}>
                      {n} stones
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
          <Button variant="primary" type="submit">
            Start {rated ? "rated" : "casual"} game · {size} × {size}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
