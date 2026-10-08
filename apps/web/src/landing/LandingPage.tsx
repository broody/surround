import { Button, LinkButton } from "../components/ui";
import { memo } from "react";
import { ArrowRight } from "lucide-react";
import BoardCanvas from "../game/BoardCanvas";
import ModeIllustration from "./ModeIllustration";
import LandingFeatures from "./LandingFeatures";
import { MODES } from "./modes";
import { OPENINGS, openingDescription, openingPosition } from "./openings";
import { nextInRotation } from "../rotation";
import { COMING_SOON } from "../launch";

// A different dan game's opening on each visit, taken in turn.
const OPENING = OPENINGS[nextInRotation("surround:hero-opening", OPENINGS.length)];
const OPENING_POSITION = openingPosition(OPENING);
const noop = () => {};

type Props = { hidden: boolean };

export default memo(function LandingPage({ hidden }: Props) {
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
            {COMING_SOON ? (
              // Looks live but does nothing until play opens.
              <Button variant="primary" size="lg">
                Enter the Dojo (Soon)
              </Button>
            ) : (
              <>
                <LinkButton variant="primary" size="lg" href="#lobby">
                  Enter the Dojo <ArrowRight size={23} />
                </LinkButton>
                <LinkButton size="lg" href="#study">
                  Learn Go <ArrowRight size={19} />
                </LinkButton>
              </>
            )}
          </div>
        </div>
        <figure className="hero-board">
          <div className="hero-board-frame">
            <BoardCanvas
              position={OPENING_POSITION}
              coordinates={false}
              readOnly
              description={openingDescription(OPENING)}
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
              // Story is always closed; the others until play opens.
              const closed = COMING_SOON || mode.id === "story";
              const status =
                "status" in mode ? mode.status : closed ? "Coming soon" : null;
              const contents = (
                <>
                  <ModeIllustration mode={mode.id} />
                  <div className="mode-copy">
                    <span className="mode-category">{mode.category}</span>
                    <h3>
                      {mode.title}
                      {!closed && <ArrowRight size={20} aria-hidden="true" />}
                    </h3>
                    <p>{mode.description}</p>
                    {status && <span className="mode-status">{status}</span>}
                  </div>
                </>
              );
              return (
                <article className="mode-entry" key={mode.id}>
                  {closed ? (
                    <Button
                      variant="card"
                      className="mode-link"
                      disabled
                      aria-label={`${mode.title}: coming soon`}
                    >
                      {contents}
                    </Button>
                  ) : (
                    <LinkButton
                      variant="card"
                      className="mode-link"
                      href={mode.id === "study" ? "#study" : "#lobby"}
                      aria-label={mode.action}
                    >
                      {contents}
                    </LinkButton>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <LandingFeatures />

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
          </footer>
        </div>
      </div>
    </main>
  );
});
