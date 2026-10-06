import { useEffect, useState } from "react";
import { Panel, Button, LinkButton, Select } from "../components/ui";
import { SEPOLIA, useWallet } from "./WalletProvider";
import { BAND_LABELS, STRK, useBands } from "./rated";
import { useRated } from "../rated/RatedProvider";
import { CHARACTERS } from "../../../../shared/lobby.ts";
import { shortAddress } from "./WalletButton";

/**
 * The connected wallet's place on Starknet: its rank as SurroundRatings holds
 * it, or, before its first rated game, the band it will start from. A wallet
 * whose account isn't deployed yet is helped to activate it first.
 */
export default function RatedProfile() {
  const { address, chainId, invoke, switchToSepolia } = useWallet();
  const { player, band, setBand, pointer, error: startError } = useRated();
  const bands = useBands();
  const [activating, setActivating] = useState<string>();
  const [error, setError] = useState<string>();

  // Another account: its own band, and nothing in progress.
  useEffect(() => {
    setActivating(undefined);
    setError(undefined);
  }, [address]);
  // After an activation, look again every few seconds until the account is deployed.
  const deployed = player.data?.deployed;
  useEffect(() => {
    if (!activating || deployed) return;
    const timer = setInterval(player.refresh, 5000);
    return () => clearInterval(timer);
  }, [activating, deployed, player.refresh]);

  if (!address) return null;
  const onSepolia = chainId !== undefined && BigInt(chainId) === BigInt(SEPOLIA);
  const data = player.data;
  const offered = Object.entries(bands.data?.bands ?? {});

  let body;
  if (!onSepolia)
    body = (
      <>
        <p>Rated games are played on Starknet Sepolia.</p>
        <Button variant="primary" onClick={() => void switchToSepolia()}>
          Switch to Sepolia
        </Button>
      </>
    );
  else if (player.error && !data)
    body = (
      <>
        <p className="wallet-warning" role="alert">
          {player.error}
        </p>
        <Button size="sm" onClick={player.refresh}>
          Retry
        </Button>
      </>
    );
  else if (!data) body = <p className="live-muted">Reading your rank on Starknet…</p>;
  else if (data.anchor)
    body = (
      <p>
        This account is one of the dojo's AI regulars, with a fixed rank of{" "}
        {data.rank}.
      </p>
    );
  else if (!data.deployed)
    body = (
      <>
        <p>
          Your account isn't active on Sepolia yet. Rated games need its
          signature, and it can only sign once it is deployed: your wallet
          deploys it with its first transaction.
        </p>
        <p className="live-muted">
          Activating sends the cheapest transaction there is, a zero STRK
          allowance to yourself. Your wallet pays a small fee in Sepolia STRK.
        </p>
        <Button
          variant="primary"
          disabled={Boolean(activating)}
          onClick={async () => {
            setError(undefined);
            try {
              setActivating(
                await invoke([
                  { contract_address: STRK, entry_point: "approve", calldata: [address, "0x0", "0x0"] },
                ]),
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {activating ? "Activating…" : "Activate account"}
        </Button>
        {activating && (
          <p className="live-muted" role="status">
            Waiting for the transaction to land. This takes a few seconds.
          </p>
        )}
      </>
    );
  else if (data.rated)
    body = (
      <>
        <div className="rated-rank">
          <strong>
            {data.rank}
            {data.provisional && <span title="Provisional">?</span>}
          </strong>
          <span className="live-muted">
            {data.wins} {data.wins === 1 ? "win" : "wins"} · {data.losses}{" "}
            {data.losses === 1 ? "loss" : "losses"}
            {data.draws ? ` · ${data.draws} drawn` : ""} · {data.games}{" "}
            {data.games === 1 ? "game" : "games"}
          </span>
        </div>
        <p className="live-muted">
          {data.provisional
            ? "The ? goes once you have a win, a loss and enough games for a firm rank."
            : "Your rank lives onchain: it goes wherever your wallet goes."}
        </p>
      </>
    );
  else
    body = (
      <>
        <p>
          Not rated yet. Choose where to start: your first rated game places
          you from there, and the rank you earn is kept onchain with your
          wallet.
        </p>
        <label htmlFor="start-band">Starting level</label>
        <Select
          id="start-band"
          value={band ?? ""}
          onChange={(event) => {
            setBand(Number(event.target.value));
          }}
        >
          <option value="" disabled>
            Choose a starting level
          </option>
          {offered.map(([value, rank]) => (
            <option key={value} value={value}>
              {BAND_LABELS[rank] ?? rank} · {rank.replace("k", " kyu")}
            </option>
          ))}
        </Select>
      </>
    );

  return (
    <Panel className="rated-profile">
      <p className="live-eyebrow">YOUR RANK ON STARKNET</p>
      <p className="live-muted">{shortAddress(address)}</p>
      {body}
      {pointer && !pointer.finished && (
        <p>
          <LinkButton variant="primary" href={`#rated/${pointer.digest}`}>
            Return to your rated game
            {pointer.characterId
              ? ` against ${CHARACTERS.find((c) => c.id === pointer.characterId)?.name ?? "the AI"}`
              : ""}
          </LinkButton>
        </p>
      )}
      {data?.deployed && !data.anchor && (data.rated || band) && !(pointer && !pointer.finished) && (
        <p className="live-muted">Choose an AI below and press Rated game to play for your rank.</p>
      )}
      {startError && (
        <p className="wallet-warning" role="alert">
          {startError}
        </p>
      )}
      {error && (
        <p className="wallet-warning" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
