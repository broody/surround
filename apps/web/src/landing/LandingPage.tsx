import { memo } from "react";
import { ArrowRight, Mountain } from "lucide-react";
import BoardCanvas from "../game/BoardCanvas";
import { studyHistory } from "../game/rules";
import ModeIllustration from "./ModeIllustration";
import LandingFeatures from "./LandingFeatures";
import { MODES, type PreviewMode } from "./modes";

const OPENING = studyHistory().at(-1)!;
const noop = () => {};

type Props = {
  hidden: boolean;
  onHelp: () => void;
  onMode: (mode: PreviewMode) => void;
  onGarden: () => void;
  scene: string;
  scenes: { id: string; label: string }[];
  onScene: (scene: string) => void;
};

export default memo(function LandingPage({
  hidden,
  onHelp,
  onMode,
  onGarden,
  scene,
  scenes,
  onScene,
}: Props) {
  return (
    <main
      className="landing-page"
      id="main-content"
      tabIndex={-1}
      inert={hidden}
    >
      <section className="landing-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-eyebrow">
            A GAME OF CONNECTION <span aria-hidden="true" />
          </p>
          <h1 id="hero-title">
            <span>A quiet mind.</span>
            <span>An open board.</span>
          </h1>
          <p className="hero-description">
            From your first stone to your next great rival. Learn Go, play AI,
            find your story—and compete for rewards on Starknet.
          </p>
          <div className="hero-actions">
            <a className="landing-button gold-button" href="#modes">
              Play Go <ArrowRight size={23} />
            </a>
            <a className="landing-button outline-button" href="#learn">
              Start learning <ArrowRight size={19} />
            </a>
          </div>
          <p className="hero-meta">
            STORY <span>·</span> STUDY <span>·</span> ONLINE
          </p>
          <a href="#rewards" className="hero-reward-link">
            OFFCHAIN PLAY. ONCHAIN REWARDS. <ArrowRight size={13} />
          </a>
        </div>
        <figure className="hero-board">
          <div className="hero-board-frame">
            <BoardCanvas
              position={OPENING}
              coordinates={false}
              readOnly
              onPlay={noop}
              onHover={noop}
            />
          </div>
          <figcaption>Every move is a conversation.</figcaption>
        </figure>
      </section>

      <section className="modes-section" aria-labelledby="modes">
        <span className="section-jewel" aria-hidden="true">
          ✧
        </span>
        <div className="landing-container">
          <div className="modes-heading">
            <h2 id="modes" tabIndex={-1}>
              THREE PATHS. ONE BOARD.
            </h2>
            <span className="preview-label">
              <i /> THE DOJO IS TAKING SHAPE
            </span>
          </div>
          <div className="mode-list">
            {MODES.map((mode) => {
              const contents = (
                <>
                  <ModeIllustration mode={mode.id} />
                  <div className="mode-copy">
                    <span className="mode-category">{mode.category}</span>
                    <h3>
                      {mode.title}
                      <ArrowRight size={20} aria-hidden="true" />
                    </h3>
                    <p>{mode.description}</p>
                    <span
                      className={`mode-status ${mode.id === "study" ? "available" : ""}`}
                    >
                      {mode.id === "study" && <i />} {mode.status}
                    </span>
                  </div>
                </>
              );
              return (
                <article className="mode-entry" key={mode.id}>
                  {mode.id === "study" ? (
                    <a
                      className="mode-link"
                      href="#study"
                      aria-label={mode.action}
                    >
                      {contents}
                    </a>
                  ) : (
                    <button
                      className="mode-link"
                      onClick={() => onMode(mode.id as "story" | "online")}
                      aria-label={mode.action}
                    >
                      {contents}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <LandingFeatures onPreview={onMode} onHelp={onHelp} />

      <div className="landing-footer-wrap">
        <div className="landing-container">
          <footer className="landing-footer">
            <span>
              SURROUND <span className="footer-star">✦</span> TAKE YOUR TIME.
              FIND YOUR WAY.
            </span>
            <div className="landing-garden-control">
              <button onClick={onGarden}>
                <Mountain size={14} /> The gardens
              </button>
              <select
                aria-label="Garden scene"
                value={scene}
                onChange={(event) => onScene(event.target.value)}
              >
                {scenes.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
});
