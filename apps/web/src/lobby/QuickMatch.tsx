import { Button, Input, IconButton } from "../components/ui";
import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { BoardGlyph, LobbyPanel } from "./LobbyParts";
import {
  BOARD_SIZES,
  PACES,
  paceById,
  type BoardSize,
  type PaceId,
} from "./lobbyData";

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

export default function QuickMatch({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [size, setSize] = useState<BoardSize>(19);
  const [pace, setPace] = useState<PaceId>("casual");
  const [searching, setSearching] = useState(false);
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    if (!searching) return;
    const timer = window.setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [searching]);

  function find() {
    setWaited(0);
    setSearching(true);
    onNotice(
      "Matchmaking isn’t connected in this preview, so no opponent will arrive yet.",
    );
  }

  return (
    <LobbyPanel
      title="Quick match"
      subtitle="Jump into a game"
      className="lobby-quick"
    >
      <fieldset className="mt-5 flex flex-col gap-2.5" disabled={searching}>
        <legend className="sr-only">Board size</legend>
        {BOARD_SIZES.map((choice) => (
          <label
            key={choice.size}
            className={`lobby-choice${size === choice.size ? " is-selected" : ""}`}
          >
            <Input
              type="radio"
              name="quick-size"
              className="sr-only"
              checked={size === choice.size}
              onChange={() => setSize(choice.size)}
            />
            <BoardGlyph size={choice.size} />
            <span className="flex min-w-0 flex-col">
              <strong>
                {choice.size} × {choice.size}
              </strong>
              <small>{choice.label}</small>
            </span>
            <span className="lobby-radio" aria-hidden="true" />
          </label>
        ))}
      </fieldset>

      <fieldset className="mt-4" disabled={searching}>
        <legend className="lobby-label mb-2">Pace</legend>
        <div className="lobby-segmented grid grid-cols-3">
          {PACES.map((option) => (
            <label
              key={option.id}
              className={pace === option.id ? "is-selected" : ""}
            >
              <Input
                type="radio"
                name="quick-pace"
                className="sr-only"
                checked={pace === option.id}
                onChange={() => setPace(option.id)}
              />
              <span>{option.label}</span>
              <small>{option.clock}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-auto pt-5">
        {searching ? (
          <div className="lobby-searching" role="status">
            <span className="lobby-seek-stones" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <strong>Seeking an opponent…</strong>
              <small>
                {size} × {size} · {paceById(pace).label} ·{" "}
                {paceById(pace).clock}
              </small>
            </span>
            <span className="lobby-seek-time">{clock(waited)}</span>
            <IconButton
              type="button"
              className="lobby-icon-button"
              label="Cancel search"
              onClick={() => {
                setSearching(false);
                onNotice("Search cancelled.");
              }}
            >
              <X size={16} />
            </IconButton>
          </div>
        ) : (
          <Button type="button" variant="primary" className="w-full" onClick={find}>
            Find match <ArrowRight size={22} />
          </Button>
        )}
        <p className="lobby-tagline">Thoughtful games. Brighter people.</p>
      </div>
    </LobbyPanel>
  );
}
