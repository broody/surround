import { useRef, useState } from "react";
import { Link, Timer, TrendingUp } from "lucide-react";
import { BANDS } from "@surround/offchain/profile";
import { Button, Dialog, Input, StoneDot, Switch, classNames } from "../components/ui";
import { CHARACTERS, type BoardSize } from "../../../../shared/lobby.ts";
import { BoardGlyph } from "../lobby/LobbyParts";
import { useRated } from "./RatedProvider";
// The choice cards are the profile's level cards.
import "../wallet/profile.css";

/** What each kind of game means, row for row: rank, clock, chain. */
const KINDS = [
  { rated: true, name: "Rated", rows: ["Counts toward rank", "60 s a move", "Settled onchain"] },
  { rated: false, name: "Casual", rows: ["No rank change", "No clock", "Nothing onchain"] },
];
const ICONS = [TrendingUp, Timer, Link];
type Color = "black" | "white";

/**
 * A character card's way into a game against its AI anchor: Play, then a
 * dialog asking the board size, which kind, rated (on Starknet, 60 seconds a
 * move) or casual (untimed, nothing onchain), and the color: the player's
 * choice in a casual game; in a rated one the weaker takes black, shown but
 * not theirs to change. A casual game may also be a handicap game: no komi. Shown when the connected wallet could play one.
 */
export default function AnchorButtons({ characterId }: { characterId: string }) {
  const { anchorFor, ready, reason, start, starting, player, band } = useRated();
  const dialog = useRef<HTMLDialogElement>(null);
  const [rated, setRated] = useState(true);
  const [size, setSize] = useState<BoardSize>(9);
  const [chosen, setChosen] = useState<Color>("black");
  const [handicap, setHandicap] = useState(false);
  const anchor = anchorFor(characterId);
  if (!player.data || !anchor) return null;
  const busy = anchor.keys === 0;
  const disabled = !ready || busy || starting !== null;
  const why = reason ?? (busy ? "This AI is busy; try again shortly." : undefined);
  const name = CHARACTERS.find((c) => c.id === characterId)?.name.split(" ")[0] ?? "the AI";
  const title = `play-${characterId}`;
  // A rated game's colors as the matchmaker will seat them: the weaker takes black, the player at equal rank.
  const rank = player.data.shown ?? (band ? (30 - parseInt(BANDS[band] ?? "30", 10)) * 10 : null);
  const given: Color = rank === null || anchor.shown === null || rank <= anchor.shown ? "black" : "white";
  const color = rated ? given : chosen;
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
            void start(characterId, size, rated, rated ? undefined : chosen, !rated && handicap);
          }}
        >
          <h2 id={title}>Play {name}</h2>
          <div className="lobby-size-options" role="group" aria-label="Board size">
            {([9, 13, 19] as const).map((value) => (
              <Button variant="tab" key={value} aria-pressed={size === value} onClick={() => setSize(value)}>
                <BoardGlyph size={value} />
                <span>
                  {value} × {value}
                </span>
              </Button>
            ))}
          </div>
          <div className="anchor-choice">
            {KINDS.map((kind) => (
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
          <div className="lobby-size-options" role="group" aria-label={rated ? "Your color, by rank" : "Your color"}>
            {(["black", "white"] as const).map((value) => (
              <Button
                variant="tab"
                key={value}
                aria-pressed={color === value}
                disabled={rated}
                title={rated ? "In a rated game the weaker player takes black." : undefined}
                onClick={() => setChosen(value)}
              >
                <StoneDot color={value} />
                <span>{value === "black" ? "Black" : "White"}</span>
              </Button>
            ))}
          </div>
          {!rated && (
            <Switch checked={handicap} onCheckedChange={setHandicap}>
              Handicap · no komi
            </Switch>
          )}
          <Button variant="primary" type="submit">
            Start {rated ? "rated" : "casual"} game
          </Button>
        </form>
      </Dialog>
    </>
  );
}
