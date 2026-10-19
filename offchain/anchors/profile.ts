// The test player's profile, which a matchmaker serving profiles (stack.ts)
// needs before it gives anyone a game: made once, with the wallet's
// signature. A matchmaker without profiles (sepolia.ts's own) needs none.
import { profileTypedData } from "../sdk/src/profile.mjs";

/**
 * Make `player`'s profile at `matchmaker` if it has none: `handle`, starting
 * from `band` (0 once rated), signed by `sign` (the wallet's SNIP-12
 * signature, as felts). Returns the profile, or null where there are none.
 */
export async function ensureProfile(
  matchmaker: string,
  { player, chainId, handle, band, sign }:
    { player: string; chainId: bigint; handle: string; band: number; sign(typed: unknown): Promise<string[]> },
) {
  const known = await (await fetch(`${matchmaker}/players/${player}`)).json();
  if (known.profile !== null) return known.profile ?? null;
  const at = Math.floor(Date.now() / 1000);
  const claim = { player, handle, band: known.rated ? 0 : band, at };
  const signature = await sign(profileTypedData({ chainId, ...claim }));
  const response = await fetch(`${matchmaker}/profiles`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...claim, signature }),
  });
  const body = await response.json();
  if (!response.ok) throw Error(`The test player's profile: ${body.error}`);
  return { handle: body.handle, band: body.band };
}
