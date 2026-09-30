import { Button, Select, LinkButton } from "../components/ui";
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
            GO, SIMPLY <span aria-hidden="true" />
          </p>
          <h1 id="hero-title">
            <span>A quiet mind.</span>
            <span>An open board.</span>
          </h1>
          <p className="hero-description">
            Learn at your own pace. Play when you&rsquo;re ready.
          </p>
          <div className="hero-actions">
            <LinkButton variant="primary" size="lg" href="#study">
              Enter the dojo <ArrowRight size={23} />
            </LinkButton>
            <LinkButton size="lg" href="#learn">
              Learn Go <ArrowRight size={19} />
            </LinkButton>
          </div>
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
          <figcaption>Take your time.</figcaption>
        </figure>
      </section>

      <section className="modes-section" aria-labelledby="modes">
        <span className="section-jewel" aria-hidden="true">
          ✧
        </span>
        <div className="landing-container">
          <div className="modes-heading">
            <h2 id="modes" tabIndex={-1}>
              Choose your path
            </h2>
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
                    <LinkButton
                      variant="card"
                      className="mode-link"
                      href="#study"
                      aria-label={mode.action}
                    >
                      {contents}
                    </LinkButton>
                  ) : (
                    <Button
                      variant="card"
                      className="mode-link"
                      onClick={() => onMode(mode.id as "story" | "online")}
                      aria-label={mode.action}
                    >
                      {contents}
                    </Button>
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
              <span className="footer-star">·</span>
              <a href="https://github.com/broody/surround">
                SOURCE CODE (AGPL)
              </a>
            </span>
            <div className="landing-garden-control">
              <Button variant="text" size="sm" onClick={onGarden}>
                <Mountain size={14} /> The gardens
              </Button>
              <Select
                aria-label="Garden scene"
                value={scene}
                onChange={(event) => onScene(event.target.value)}
              >
                {scenes.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
});
