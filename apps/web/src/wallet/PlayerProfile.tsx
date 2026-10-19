import { useEffect, useState } from "react";
import { HANDLE_PATTERN, handleError } from "@surround/offchain/profile";
import { Button, Input, Select } from "../components/ui";
import { useWallet } from "./WalletProvider";
import { BAND_LABELS, claimProfile, type Bands } from "./rated";
import { shortAddress } from "./WalletButton";
import "./profile.css";

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
          <label htmlFor="player-handle">{profile ? "Handle" : "Choose a handle"}</label>
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
          {!rated && (
            <>
              <label htmlFor="player-band">Starting level</label>
              <Select id="player-band" value={band} onChange={(event) => setBand(event.target.value)} required>
                <option value="" disabled>
                  Choose a starting level
                </option>
                {Object.entries(bands).map(([value, rank]) => (
                  <option key={value} value={value}>
                    {BAND_LABELS[rank] ?? rank} · {rank.replace("k", " kyu")}
                  </option>
                ))}
              </Select>
            </>
          )}
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
          <p className="live-muted player-profile-note">
            Your wallet signs it; nothing goes onchain. You can change your handle once a week
            {rated ? "." : ", and your starting level until your first rated game."}
          </p>
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
