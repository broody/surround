// Start a rated game against an AI anchor: load the protocol SDK (its own
// chunk), have the wallet sign the game's terms, remember the game,
// and open its page.
import { MATCHMAKER_URL } from "../wallet/rated.ts";
import type { Signer } from "./flow.ts";
import { writePointer } from "./pointer.ts";

export async function startRatedGame({
  signer,
  anchor,
  characterId,
  size,
  band,
  gamesBefore,
}: {
  signer: Signer;
  anchor: string;
  characterId: string | null;
  size: number;
  band: number | null;
  gamesBefore: number;
}) {
  const [{ RatedFlow }, { browserStore }] = await Promise.all([import("./flow.ts"), import("./game.ts")]);
  const flow = new RatedFlow(signer, { matchmaker: MATCHMAKER_URL, store: browserStore() });
  const pairing = await flow.playAnchor({ anchor, size, band });
  writePointer(signer.address, { digest: pairing.digest, characterId, anchor, pairing, gamesBefore, finished: false });
  window.location.hash = `rated/${pairing.digest}`;
}
