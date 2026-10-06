import { Button } from "../components/ui";
import { useRated } from "./RatedProvider";

/** A character card's rated game on Starknet: shown when the connected wallet could play one. */
export default function RatedPlayButton({ characterId, size }: { characterId: string; size: number }) {
  const { anchorFor, ready, reason, start, starting, player } = useRated();
  const anchor = anchorFor(characterId);
  if (!player.data || !anchor) return null;
  const busy = anchor.keys === 0;
  return (
    <Button
      variant="primary"
      disabled={!ready || busy || starting !== null}
      title={reason ?? (busy ? "This AI is busy; try again shortly." : "A rated game on Starknet: 60 seconds a move.")}
      onClick={() => void start(characterId, size)}
    >
      {starting === characterId ? "Signing…" : "Rated game"}
    </Button>
  );
}
