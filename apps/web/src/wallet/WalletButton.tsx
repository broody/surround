import { useRef } from "react";
import { Wallet } from "lucide-react";
import { useStarknetProvider } from "@starknet-io/get-starknet-modal";
import {
  StarknetWalletApi,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";
import { Button, Dialog, LinkButton } from "../components/ui";
import { SEPOLIA, useWallet } from "./WalletProvider";
import { hasOutisExtension, outisWindow } from "./outis";
import "./wallet.css";
import { useRated } from "../rated/RatedProvider";

/**
 * Outis, Surround's own wallet: recommended. Without its extension a player
 * signs in with an email in the Outis window, and the extension is linked to.
 */
const OUTIS_ID = "outis";
const OUTIS_URL = "https://outis.xyz";
const idOf = (wallet: WalletWithStarknetFeatures) =>
  wallet.features[StarknetWalletApi].id;

export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The header's wallet control: connect, or the connected account. */
export default function WalletButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const { wallets } = useStarknetProvider();
  const { wallet, address, chainId, connecting, error, connect, disconnect, switchToSepolia } =
    useWallet();
  const { signOut } = useRated();
  // The wallets this browser has; the only install suggestion is Outis.
  const available = wallets.filter((w) => w.state === "available");
  const outis = available.find((w) => idOf(w.wallet) === OUTIS_ID);
  const others = available.filter((w) => idOf(w.wallet) !== OUTIS_ID);
  // No extension in this browser: Outis is its window, where an email signs in.
  const byEmail = !outis && !hasOutisExtension() ? outisWindow(SEPOLIA).wallet : undefined;
  const onSepolia = chainId !== undefined && BigInt(chainId) === BigInt(SEPOLIA);
  const close = () => dialog.current?.close();
  // A wallet's own windows open above the page, but never above a modal
  // dialog: close it first, and bring it back to show what went wrong.
  const choose = async (next: WalletWithStarknetFeatures) => {
    close();
    try {
      if (!(await connect(next))) dialog.current?.showModal();
    } catch {
      dialog.current?.showModal();
    }
  };
  return (
    <>
      <Button size="sm" onClick={() => dialog.current?.showModal()}>
        <Wallet size={15} />
        {address ? shortAddress(address) : connecting ? "Connecting…" : "Connect wallet"}
      </Button>
      <Dialog ref={dialog} onCloseRequest={close} aria-labelledby="wallet-title">
        <h2 id="wallet-title">{wallet ? "Your wallet" : "Connect a wallet"}</h2>
        {wallet && address ? (
          <div className="wallet-account">
            <div className="wallet-row">
              <img src={wallet.icon} alt="" width="28" height="28" />
              <div>
                <strong>{wallet.name}</strong>
                <span className="live-muted">{shortAddress(address)}</span>
              </div>
            </div>
            <p className={onSepolia ? "live-muted" : "wallet-warning"} role="status">
              {onSepolia
                ? "On Starknet Sepolia, where Surround's rated games are played."
                : "Surround's rated games are on Starknet Sepolia."}
            </p>
            <div className="wallet-actions">
              {!onSepolia && (
                <Button variant="primary" onClick={() => void switchToSepolia()}>
                  Switch to Sepolia
                </Button>
              )}
              <Button
                onClick={() => {
                  close();
                  // Disconnecting signs this browser out too: its key revokes itself, with no wallet prompt.
                  void signOut().finally(() => disconnect());
                }}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="live-muted">
              Your wallet signs each rated game you agree to play. It never pays
              to play: the keeper settles games onchain.
            </p>
            <ul className="wallet-list">
              <li>
                {outis ? (
                  <Button
                    className="wallet-choice"
                    disabled={connecting}
                    onClick={() => void choose(outis.wallet)}
                  >
                    <img src={outis.wallet.icon} alt="" width="24" height="24" />
                    Outis
                    <span className="wallet-tag">Recommended</span>
                  </Button>
                ) : byEmail ? (
                  <Button
                    className="wallet-choice"
                    disabled={connecting}
                    onClick={() => void choose(byEmail)}
                  >
                    <img src="/assets/wallets/outis.svg" alt="" width="24" height="24" />
                    Sign in with email
                    <span className="wallet-tag">Recommended</span>
                  </Button>
                ) : (
                  <LinkButton
                    className="wallet-choice"
                    href={OUTIS_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img src="/assets/wallets/outis.svg" alt="" width="24" height="24" />
                    Get Outis
                    <span className="wallet-tag">Recommended</span>
                  </LinkButton>
                )}
              </li>
              {others.map((w) => (
                <li key={w.name}>
                  <Button
                    className="wallet-choice"
                    disabled={connecting}
                    onClick={() => void choose(w.wallet)}
                  >
                    <img src={w.wallet.icon} alt="" width="24" height="24" />
                    {w.name}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="live-muted wallet-note">
              {byEmail ? (
                <>
                  Your email signs you in with Outis, Surround&rsquo;s own wallet. Or{" "}
                  <a href={OUTIS_URL} target="_blank" rel="noreferrer">
                    get its extension
                  </a>
                  .
                </>
              ) : (
                <>Outis is Surround&rsquo;s own wallet.</>
              )}
            </p>
          </>
        )}
        {error && (
          <p className="wallet-warning" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
