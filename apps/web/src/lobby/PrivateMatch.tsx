import { Button, Input, IconButton } from "../components/ui";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Copy,
  KeyRound,
  Swords,
  Users,
  X,
} from "lucide-react";
import { Avatar, LobbyPanel, Ornament } from "./LobbyParts";
import { FRIENDS } from "./lobbyData";

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const roomCode = () =>
  Array.from(
    { length: 3 },
    () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)],
  ).join("") +
  "-" +
  String(Math.floor(1000 + Math.random() * 9000));

export default function PrivateMatch({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "created" | "entering">("idle");
  const [code, setCode] = useState("");
  const [entry, setEntry] = useState("");
  const entryInput = useRef<HTMLInputElement>(null);
  const entryValid = /^[A-Z]{3}-?\d{4}$/.test(entry.trim().toUpperCase());

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      onNotice(`Room code ${code} copied.`);
    } catch {
      onNotice(`Couldn’t copy automatically. Your code is ${code}.`);
    }
  }

  return (
    <LobbyPanel
      title="Private match"
      subtitle="Play with a friend"
      className="lobby-private"
    >
      <div className="mt-5 flex flex-col gap-2.5">
        {mode === "created" ? (
          <div className="lobby-room-code">
            <span className="lobby-label">Your room</span>
            <div className="flex items-center gap-2">
              <strong>{code}</strong>
              <IconButton
                type="button"
                className="lobby-icon-button"
                label="Copy room code"
                onClick={copyCode}
              >
                <Copy size={15} />
              </IconButton>
              <IconButton
                type="button"
                className="lobby-icon-button ml-auto"
                label="Close room"
                onClick={() => {
                  setMode("idle");
                  onNotice("Room closed.");
                }}
              >
                <X size={15} />
              </IconButton>
            </div>
            <small>
              <i aria-hidden="true" /> Waiting for a friend to arrive…
            </small>
          </div>
        ) : (
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              const next = roomCode();
              setCode(next);
              setMode("created");
              onNotice(
                `Room ${next} created. Rooms aren’t connected in this preview, so no one can join yet.`,
              );
            }}
          >
            <Users size={19} /> Create room <ArrowRight size={17} />
          </Button>
        )}

        {mode === "entering" ? (
          <form
            className="lobby-code-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!entryValid) return;
              onNotice(
                `Room ${entry.trim().toUpperCase()} can’t be reached in this preview.`,
              );
            }}
          >
            <label className="sr-only" htmlFor="lobby-room-entry">
              Room code
            </label>
            <Input
              id="lobby-room-entry"
              ref={entryInput}
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMode("idle");
              }}
              placeholder="ABC-1234"
              maxLength={8}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={!entryValid}>
              Join
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              setMode("entering");
              requestAnimationFrame(() => entryInput.current?.focus());
            }}
          >
            <KeyRound size={18} /> Enter code <ArrowRight size={17} />
          </Button>
        )}
      </div>

      <div className="mt-6 text-center">
        <Ornament className="mb-4" />
        <h3 className="lobby-panel-title small">In the garden</h3>
        <p className="lobby-panel-subtitle">Friends and fellow players</p>
      </div>
      <ul className="lobby-friends mt-3">
        {FRIENDS.map((friend) => (
          <li key={friend.name} className={`is-${friend.presence}`}>
            <Avatar src={friend.portrait} presence={friend.presence} />
            <span className="flex min-w-0 flex-1 flex-col">
              <strong>{friend.name}</strong>
              <small>{friend.detail}</small>
            </span>
            {friend.presence === "online" && (
              <IconButton
                type="button"
                className="lobby-icon-button"
                label={`Challenge ${friend.name}`}
                title={`Challenge ${friend.name}`}
                onClick={() =>
                  onNotice(
                    `Challenges aren’t connected in this preview. ${friend.name} wasn’t notified.`,
                  )
                }
              >
                <Swords size={15} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
    </LobbyPanel>
  );
}
