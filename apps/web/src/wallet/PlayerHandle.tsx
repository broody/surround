import { useEffect, useState } from "react";
import { HANDLE_PATTERN, handleError } from "@surround/offchain/handle";
import { Button, Input } from "../components/ui";
import { useWallet } from "./WalletProvider";
import { claimHandle } from "./rated";
import { shortAddress } from "./WalletButton";
import "./handle.css";

/**
 * The name the connected wallet goes by in Surround, over its address, and,
 * for an account that can sign (`canClaim`), a form to choose or change it:
 * one wallet signature, kept by the matchmaker, nothing onchain.
 */
export default function PlayerHandle({
  handle,
  canClaim,
  onClaimed,
}: {
  handle: string | null;
  canClaim: boolean;
  onClaimed(): void;
}) {
  const { address, signTypedData } = useWallet();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Another account: its own handle, and nothing in progress.
  useEffect(() => {
    setEditing(false);
    setValue("");
    setError(undefined);
  }, [address]);

  if (!address) return null;
  const open = canClaim && (!handle || editing);

  return (
    <div className="player-handle">
      {handle && <strong className="player-handle-name">{handle}</strong>}
      <p className="live-muted">{shortAddress(address)}</p>
      {open && (
        <form
          className="player-handle-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const problem = handleError(value);
            if (problem) return setError(problem);
            setBusy(true);
            setError(undefined);
            try {
              await claimHandle({ address, signTypedData }, value);
              setEditing(false);
              setValue("");
              onClaimed();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="player-handle">{handle ? "New handle" : "Choose a handle"}</label>
          <div className="player-handle-row">
            <Input
              id="player-handle"
              autoComplete="nickname"
              spellCheck={false}
              maxLength={20}
              pattern={HANDLE_PATTERN.source}
              title="3–20 letters, digits, _ or -, starting with a letter"
              placeholder={handle ?? "How other players see you"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
            />
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Signing…" : "Save"}
            </Button>
            {handle && (
              <Button type="button" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
          <p className="live-muted player-handle-note">
            Your wallet signs it; nothing goes onchain. You can change it once a week.
          </p>
        </form>
      )}
      {canClaim && handle && !editing && (
        <Button size="sm" onClick={() => setEditing(true)}>
          Change handle
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
