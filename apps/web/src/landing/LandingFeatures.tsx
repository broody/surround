import { Button } from "../components/ui";
import { ArrowRight } from "lucide-react";
import FirstCapture from "./FirstCapture";
import type { PreviewMode } from "./modes";

type Props = { onPreview: (mode: PreviewMode) => void; onHelp: () => void };

export default function LandingFeatures({ onPreview, onHelp }: Props) {
  return (
    <div className="landing-features">
      <section className="story-section quiet-story" aria-labelledby="story">
        <div className="story-landscape" aria-hidden="true" />
        <div className="feature-container story-layout">
          <div className="feature-copy">
            <p className="feature-eyebrow">STORY MODE</p>
            <h2 id="story" tabIndex={-1}>
              Every rival
              <br />
              has a story.
            </h2>
            <p>Meet new players. Learn their game. Find your own way forward.</p>
            <Button
              size="lg"
              onClick={() => onPreview("story")}
            >
              Meet your rivals <ArrowRight size={18} />
            </Button>
            <span className="story-status">COMING SOON</span>
          </div>
          <div
            className="story-characters"
            aria-label="Story character concepts"
          >
            <figure className="story-character seeker">
              <img
                src="/assets/player-black.png"
                alt="Character concept: the Seeker"
                loading="lazy"
              />
              <figcaption>THE SEEKER</figcaption>
            </figure>
            <span className="story-character-cross" aria-hidden="true">
              ✦
            </span>
            <figure className="story-character wayfarer">
              <img
                src="/assets/player-white.png"
                alt="Character concept: the Wayfarer"
                loading="lazy"
              />
              <figcaption>THE WAYFARER</figcaption>
            </figure>
            <span className="character-concept-label">CHARACTER CONCEPTS</span>
          </div>
        </div>
      </section>

      <section
        className="feature-section learn-section"
        aria-labelledby="learn"
      >
        <div className="feature-container feature-split">
          <div className="feature-copy quiet-copy">
            <p className="feature-eyebrow">NO EXPERIENCE NEEDED</p>
            <h2 id="learn" tabIndex={-1}>
              Begin with
              <br />
              one stone.
            </h2>
            <p>Learn by playing. We&rsquo;ll guide you from the first move.</p>
            <Button variant="text" className="feature-link" onClick={onHelp}>
              The simple rules <ArrowRight size={17} />
            </Button>
          </div>
          <FirstCapture />
        </div>
      </section>

      <section className="quiet-rewards" aria-labelledby="rewards">
        <div className="feature-container quiet-rewards-inner">
          <div className="quiet-rewards-visual">
            <img
              src="/assets/kifu-to-starknet.svg"
              alt="A cropped opening from the recorded TieBot2–okahachi game, won by Black by 1.5 points, illustrated being recorded on Starknet"
            />
          </div>
          <div className="quiet-rewards-content">
            <p className="feature-eyebrow">STARKNET SETTLEMENT · PLANNED</p>
            <h2 id="rewards" tabIndex={-1}>
              Every ranked game leaves a record.
            </h2>
            <p className="quiet-rewards-copy">
              When the game ends, one proof checks every move and the final
              score. Starknet records the result, tied to the exact moves you
              played.
            </p>
            <Button
              variant="text"
              className="feature-link"
              onClick={() => onPreview("online")}
            >
              How it works <ArrowRight size={17} />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
