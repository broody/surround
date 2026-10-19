// Which game a wallet is in, rated or casual, kept in this browser so the Dojo can show
// "return to your game" without loading the protocol SDK. The game itself
// (steps and session key) lives in the session store (src/rated/game.ts).
import type { Pairing } from "./flow.ts";

export type RatedPointer = {
  digest: string;
  /** A rated game (a ticket, settled and rated onchain) or a casual one; older pointers are rated. */
  rated?: boolean;
  /** The character the opponent anchor plays as (shared/lobby.ts); null against a person. */
  characterId: string | null;
  /** The opponent's account: an AI anchor's, or a person's. */
  anchor: string;
  pairing: Pairing;
  /** Rated games the player had before this one: rating is done once it grows. */
  gamesBefore: number;
  finished: boolean;
};

const key = (address: string) => `surround-rated:${BigInt(address)}`;

export function readPointer(address: string): RatedPointer | null {
  try {
    const raw = window.localStorage.getItem(key(address));
    return raw ? (JSON.parse(raw) as RatedPointer) : null;
  } catch {
    return null;
  }
}

export function writePointer(address: string, pointer: RatedPointer) {
  try {
    window.localStorage.setItem(key(address), JSON.stringify(pointer));
  } catch {
    /* Storage may be unavailable: the game page works from the pairing while it is open. */
  }
}

export function clearPointer(address: string) {
  try {
    window.localStorage.removeItem(key(address));
  } catch {
    /* Nothing to clear. */
  }
}
