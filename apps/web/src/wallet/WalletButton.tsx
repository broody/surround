import { useRef } from "react";
import { Wallet } from "lucide-react";
import { useStarknetProvider } from "@starknet-io/get-starknet-modal";
import { Button, Dialog, LinkButton } from "../components/ui";
import { SEPOLIA, useWallet } from "./WalletProvider";
import "./wallet.css";

export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The header's wallet control: connect, or the connected account. */
export default function WalletButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const { wallets } = useStarknetProvider();
  const { wallet, address, chainId, connecting, error, connect, disconnect, switchToSepolia } =
    useWallet();
  const onSepolia = chainId !== undefined && BigInt(chainId) === BigInt(SEPOLIA);
  const close = () => dialog.current?.close();
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
                  void disconnect();
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
              {wallets.map((w) =>
                w.state === "available" ? (
                  <li key={w.name}>
                    <Button
                      className="wallet-choice"
                      disabled={connecting}
                      onClick={async () => {
                        await connect(w.wallet);
                        close();
                      }}
                    >
                      <img src={w.wallet.icon} alt="" width="24" height="24" />
                      {w.name}
                    </Button>
                  </li>
                ) : (
                  <li key={w.name}>
                    <LinkButton
                      className="wallet-choice"
                      variant="text"
                      href={Object.values(w.info.downloads)[0]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img src={w.info.icon} alt="" width="24" height="24" />
                      Install {w.name}
                    </LinkButton>
                  </li>
                ),
              )}
            </ul>
            {!wallets.some((w) => w.state === "available") && (
              <p className="live-muted">
                No Starknet wallet found in this browser. Install one, then
                reload the page.
              </p>
            )}
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
