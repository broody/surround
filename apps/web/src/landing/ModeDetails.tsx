import { ArrowRight, BookOpen, Cpu } from "lucide-react";
import ModeIllustration from "./ModeIllustration";
import type { PreviewMode } from "./modes";

export default function ModeDetails({
  mode,
  onStudy,
}: {
  mode: PreviewMode;
  onStudy: () => void;
}) {
  const online = mode === "online";
  if (mode === "ai")
    return (
      <>
        <Cpu className="mode-illustration" aria-hidden="true" />
        <span className="eyebrow">AI OPPONENTS · IN DEVELOPMENT</span>
        <h2 id="dialog-title">
          A rival at your level.
          <br />
          Room to get stronger.
        </h2>
        <p>
          Practice against AI opponents at different strengths, from first steps
          to a serious challenge. Try new ideas and build confidence without
          staking money.
        </p>
        <div className="dialog-note">
          AI play isn’t connected yet. The current study board is a local
          sandbox where you control both colors; it does not generate AI moves.
        </div>
        <button className="pixel-button primary" onClick={onStudy}>
          <BookOpen size={17} /> Explore the study board{" "}
          <ArrowRight size={17} />
        </button>
      </>
    );
  return (
    <>
      <ModeIllustration mode={mode} />
      <span className="eyebrow">
        {online
          ? "ONLINE P2P · IN DEVELOPMENT"
          : "SINGLE-PLAYER STORY · IN DEVELOPMENT"}
      </span>
      <h2 id="dialog-title">
        {online ? (
          <>
            Across the board.
            <br />
            On your terms.
          </>
        ) : (
          <>
            Every journey starts
            <br />
            with a single stone.
          </>
        )}
      </h2>
      <p>
        {online
          ? "Peer-to-peer Go with real rewards and money matches, settled on Starknet. Agree on the stakes, play your match, and settle the result."
          : "A single-player journey through the world of Go. Meet new opponents, grow with each game, and discover the story one move at a time."}
      </p>
      {online && (
        <ol className="settlement-steps" aria-label="Planned match flow">
          <li>
            <span>01</span>
            <div>
              Agree on the match<small>Players, rules, and stakes</small>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              Play peer to peer<small>Signed moves exchanged offchain</small>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              Settle on Starknet
              <small>Verified result and reward settlement</small>
            </div>
          </li>
        </ol>
      )}
      <div className="dialog-note">
        {online
          ? "Coming soon. This preview has no wallet connection, matchmaking, deposits, or payouts. No real money is accepted or moved."
          : "Coming soon. Story chapters, opponents, and progression are not playable yet. In the meantime, explore the local study-board sandbox."}
      </div>
      <button className="pixel-button primary" onClick={onStudy}>
        <BookOpen size={17} /> Try the study board <ArrowRight size={17} />
      </button>
    </>
  );
}
