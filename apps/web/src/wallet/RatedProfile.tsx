import { useEffect, useState } from "react";
import { Panel, Button, LinkButton } from "../components/ui";
import { SEPOLIA, useWallet } from "./WalletProvider";
import { BANDS } from "@surround/offchain/profile";
import { STRK, useBands } from "./rated";
import { useRated } from "../rated/RatedProvider";
import { CHARACTERS } from "../../../../shared/lobby.ts";
import PlayerProfile from "./PlayerProfile";

/**
 * The connected wallet's place on Starknet: its profile (the handle it goes
 * by, and the band its first rated game starts from), and its rank as
 * SurroundRatings holds it. A wallet whose account isn't deployed yet is
 * helped to activate it first.
 */
export default function RatedProfile() {
  const { address, chainId, invoke, switchToSepolia } = useWallet();
  const { player, band, pointer, signedIn, signIn, signOut, starting, error: startError } = useRated();
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
        <p>Activate your account to play: one zero-STRK approval to yourself, for a small fee.</p>
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
            Waiting for the transaction…
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
        {data.provisional && (
          <p className="live-muted">The ? goes once you have a win, a loss and enough games.</p>
        )}
      </>
    );
  else
    body = (
      <p>
        Not rated yet.{band ? ` You start at ${BANDS[band]?.replace("k", " kyu") ?? "your starting level"}.` : null}
      </p>
    );

  return (
    <Panel className="rated-profile">
      <p className="live-eyebrow">YOUR PROFILE</p>
      <PlayerProfile
        profile={data?.profile ?? null}
        rated={Boolean(data?.rated)}
        bands={bands.data?.bands ?? {}}
        canClaim={onSepolia && Boolean(data?.deployed) && !data?.anchor}
        onClaimed={player.refresh}
      />
      {body}
      {pointer && !pointer.finished && (
        <p>
          <LinkButton variant="primary" href={`#rated/${pointer.digest}`}>
            Return to your {pointer.rated === false ? "casual " : "rated "}game
            {pointer.characterId
              ? ` against ${CHARACTERS.find((c) => c.id === pointer.characterId)?.name ?? "the AI"}`
              : ""}
          </LinkButton>
        </p>
      )}
      {onSepolia && data?.deployed && !data.anchor && data.profile && (
        <div className="player-signin">
          {signedIn ? (
            <>
              <p className="live-muted">
                Signed in until {new Date(signedIn.expires_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.
              </p>
              <Button size="sm" disabled={starting !== null} onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="primary" disabled={starting !== null} onClick={() => void signIn()}>
                {starting === "sign-in" ? "Signing…" : "Sign in for the week"}
              </Button>
            </>
          )}
        </div>
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
