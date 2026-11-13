// Outis without its extension: the Outis window (account.outis.xyz, through
// @outis/sessions), where a player signs in with an email. It signs messages
// only, and only Surround's profile claim and sign-in (the delegation); it
// never sends a transaction, so the matchmaker deploys such a player's
// account (`deployAccount` in ./rated.ts). Where the extension is installed,
// it is the wallet get-starknet finds, and none of this is used.
import { StarknetInjectedWallet } from "@starknet-io/get-starknet-wallet-standard";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { findExtension, windowWallet, type DeploymentResult, type SessionWallet } from "@outis/sessions";

/** Where the window lives: account.outis.xyz, or a local one in development (VITE_OUTIS_WINDOW_URL). */
const WINDOW_URL: string | undefined = import.meta.env?.VITE_OUTIS_WINDOW_URL;

/** How an account is deployed, as the window says it (the wallet API's `wallet_deploymentData`). */
export type Deployment = DeploymentResult;

export type OutisWindow = {
  /** The window as a wallet-standard wallet, to connect like any other. */
  wallet: WalletWithStarknetFeatures;
  /** Open the window now: call it in a click whose signature follows a fetch, or the browser blocks the window. */
  open(): void;
  /** Forget the account on this site, so the next connect asks the window again. */
  forget(): void;
  /**
   * How `address`, the signed-in account, is deployed. Kept on this browser
   * once known (it is the same for good, and no secret: a class, a salt and
   * the owner's public key); else the window answers it by itself, asking the
   * player nothing, which opens the window: in a click, or just after a
   * sign-in, while it is still open.
   */
  deployment(address: string): Promise<Deployment>;
  /** Whether `address`'s deployment is kept here, so `deployment` opens no window. */
  knows(address: string): boolean;
};

/** Whether the Outis extension is in this browser. Asked each time: an extension may announce itself late. */
export const hasOutisExtension = () => findExtension() !== undefined;

const deploymentKey = (chainId: string, address: string) => `surround-outis-deployment:${chainId}:${BigInt(address)}`;
function kept(chainId: string, address: string): Deployment | null {
  try {
    const raw = window.localStorage.getItem(deploymentKey(chainId, address));
    const data = raw ? (JSON.parse(raw) as Deployment) : null;
    return data && BigInt(data.address) === BigInt(address) ? data : null;
  } catch {
    return null;
  }
}
function keep(chainId: string, data: Deployment) {
  try {
    window.localStorage.setItem(deploymentKey(chainId, data.address), JSON.stringify(data));
  } catch {
    /* Storage may be unavailable: the window is asked again. */
  }
}

let made: { chainId: string; window: OutisWindow } | undefined;

/** The Outis window for `chainId` (hex), made once: it listens for its window's answers. */
export function outisWindow(chainId: string): OutisWindow {
  if (made?.chainId !== chainId) {
    const sessions: SessionWallet = windowWallet({ chainId, ...(WINDOW_URL ? { signOrigin: WINDOW_URL } : {}) });
    made = {
      chainId,
      window: {
        wallet: new StarknetInjectedWallet(sessions as never),
        open: () => sessions.open(),
        forget: () => sessions.forget(),
        async deployment(address) {
          const known = kept(chainId, address);
          if (known) return known;
          const data = (await sessions.request({ type: "wallet_deploymentData" })) as Deployment;
          // The window answers for whoever is signed in there: another account's data is not this one's.
          if (BigInt(data.address) !== BigInt(address)) throw new Error("Outis is signed in to another account: connect again.");
          keep(chainId, data);
          return data;
        },
        knows: (address) => kept(chainId, address) !== null,
      },
    };
  }
  return made.window;
}

/** What went wrong, in the window's own words where it gave any ("The user refused"), else the error's. */
export function outisError(error: unknown): Error {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === "string" && data) return new Error(data);
  return error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
}
