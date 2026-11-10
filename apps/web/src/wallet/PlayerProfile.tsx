import { useEffect, useState } from "react";
import { HANDLE_PATTERN, handleError } from "@surround/offchain/profile";
import { Button, Input, classNames } from "../components/ui";
import { useWallet } from "./WalletProvider";
import { BAND_LABELS, BAND_NOTES, claimProfile, type Bands } from "./rated";
import { shortAddress } from "./WalletButton";
import "./profile.css";

/** A few stones on a corner of a board for each starting band, busier as the level rises: [column, row, color]. */
const BAND_STONES: Record<string, [number, number, "black" | "white"][]> = {
  "23k": [[2, 2, "black"]],
  "17k": [[1, 1, "black"], [2, 1, "black"], [2, 2, "white"], [3, 2, "white"]],
  "6k": [
    [0, 2, "black"], [1, 1, "black"], [1, 2, "black"], [2, 0, "black"],
    [2, 1, "white"], [2, 2, "white"], [3, 1, "white"], [1, 3, "white"],
  ],
  "1k": [
    [0, 1, "black"], [1, 1, "black"], [1, 3, "black"], [2, 0, "black"], [3, 3, "black"],
    [2, 1, "white"], [2, 2, "white"], [3, 1, "white"], [1, 2, "white"], [3, 0, "white"],
  ],
};

/** The starting bands as cards to pick from, each a radio: a small board, plain words, who it's for, and the rank. */
function LevelCards({ bands, value, onChange }: { bands: Bands; value: string; onChange(value: string): void }) {
  return (
    <fieldset className="level-cards">
      <legend>Starting level</legend>
      <div className="level-cards-grid">
        {Object.entries(bands).map(([band, rank]) => (
          <label key={band} className={classNames("level-card", value === band && "is-selected")}>
            <Input
              type="radio"
              name="player-band"
              className="sr-only"
              value={band}
              checked={value === band}
              onChange={() => onChange(band)}
              required
            />
            <svg className="level-board" viewBox="0 0 50 50" aria-hidden="true">
              <path d="M5 5v40M15 5v40M25 5v40M35 5v40M45 5v40M5 5h40M5 15h40M5 25h40M5 35h40M5 45h40" />
              {(BAND_STONES[rank] ?? []).map(([x, y, color]) => (
                <circle key={`${x}-${y}`} className={`level-stone ${color}`} cx={5 + x * 10} cy={5 + y * 10} r={4.4} />
              ))}
            </svg>
            <strong className="level-card-name">{BAND_LABELS[rank] ?? rank}</strong>
            {BAND_NOTES[rank] && <span className="level-card-note">{BAND_NOTES[rank]}</span>}
            <span className="level-card-rank">{rank.replace("k", " kyu")}</span>
          </label>
        ))}
      </div>
      <p className="live-muted player-profile-note">Not sure? Pick the lower one.</p>
    </fieldset>
  );
}

/**
 * The connected wallet's profile: the handle it goes by, over its address,
 * and, for an account that can sign (`canClaim`), a form to make or change
 * it. An unrated player also chooses the level its first rated game starts
 * from, among the `bands` SurroundRatings allows. One wallet signature, kept
 * by the matchmaker, nothing onchain.
 */
export default function PlayerProfile({
  profile,
  rated,
  bands,
  canClaim,
  onClaimed,
}: {
  profile: { handle: string; band: number } | null;
  rated: boolean;
  bands: Bands;
  canClaim: boolean;
  onClaimed(): void;
}) {
  const { address, signTypedData } = useWallet();
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [band, setBand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Another account: its own profile, and nothing in progress.
  useEffect(() => {
    setEditing(false);
    setError(undefined);
  }, [address]);
  // The form starts from the profile kept, so changing one field keeps the other.
  useEffect(() => {
    if (editing && profile) {
      setHandle(profile.handle);
      setBand(profile.band ? String(profile.band) : "");
    }
  }, [editing, profile]);

  if (!address) return null;
  const open = canClaim && (!profile || editing);

  return (
    <div className="player-profile">
      {profile && <strong className="player-profile-name">{profile.handle}</strong>}
      <p className="live-muted">{shortAddress(address)}</p>
      {open && (
        <form
          className="player-profile-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const problem = handleError(handle) ?? (!rated && !band ? "Choose a starting level." : null);
            if (problem) return setError(problem);
            setBusy(true);
            setError(undefined);
            try {
              await claimProfile({ address, signTypedData }, { handle, band: rated ? 0 : Number(band) });
              setEditing(false);
              onClaimed();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="player-handle">Handle</label>
          <Input
            id="player-handle"
            autoComplete="nickname"
            spellCheck={false}
            maxLength={20}
            pattern={HANDLE_PATTERN.source}
            title="3–20 letters, digits, _ or -, starting with a letter"
            placeholder="How other players see you"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            required
          />
          {!rated && <LevelCards bands={bands} value={band} onChange={setBand} />}
          <div className="player-profile-row">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Signing…" : "Save"}
            </Button>
            {profile && (
              <Button type="button" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
          <p className="live-muted player-profile-note">Your wallet signs it. Nothing goes onchain.</p>
        </form>
      )}
      {canClaim && profile && !editing && (
        <Button size="sm" onClick={() => setEditing(true)}>
          Edit profile
        </Button>
      )}
      {error && (
        <p className="wallet-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
