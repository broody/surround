import { Button } from "../components/ui";
import { useRated } from "./RatedProvider";

/**
 * A character card's games against its AI anchor: rated (on Starknet, 60
 * seconds a move) or casual (untimed, nothing onchain). Shown when the
 * connected wallet could play one.
 */
export default function AnchorButtons({ characterId, size }: { characterId: string; size: number }) {
  const { anchorFor, ready, reason, start, starting, player } = useRated();
  const anchor = anchorFor(characterId);
  if (!player.data || !anchor) return null;
  const busy = anchor.keys === 0;
  const disabled = !ready || busy || starting !== null;
  const why = reason ?? (busy ? "This AI is busy; try again shortly." : undefined);
  return (
    <>
      <Button
        variant="primary"
        disabled={disabled}
        title={why ?? "A rated game on Starknet: 60 seconds a move."}
        onClick={() => void start(characterId, size, true)}
      >
        {starting === characterId ? "Signing…" : "Rated game"}
      </Button>
      <Button
        disabled={disabled}
        title={why ?? "A casual game: untimed, nothing onchain, no rank at stake."}
        onClick={() => void start(characterId, size, false)}
      >
        Casual game
      </Button>
    </>
  );
}
