import { Button, LinkButton, Panel } from "../components/ui";
import { ArrowRight, Bot, Users } from "lucide-react";
import { CHARACTERS, levelName } from "../../../../shared/lobby.ts";
import FirstCapture from "./FirstCapture";
import KifuStack from "./KifuStack";
import { COMING_SOON } from "../launch";
import type { PreviewMode } from "./modes";

type Props = { onPreview: (mode: PreviewMode) => void; onHelp: () => void };

export default function LandingFeatures({ onPreview, onHelp }: Props) {
  return (
    <div className="landing-features">
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

      <section
        className="feature-section ranked-section"
        aria-labelledby="ranked"
      >
        <div className="feature-container feature-split">
          <Panel as="div" className="ranked-roster">
            <div className="roster-heading">
              <span>AI ANCHOR OPPONENTS</span>
            </div>
            <ol
              className="roster-ladder"
              aria-label="AI anchor opponents, from 20 kyu to pro"
            >
              {CHARACTERS.map((character) => (
                <li key={character.id}>
                  <img src={character.portrait} alt="" loading="lazy" />
                  <strong>{levelName(character.rank)}</strong>
                  <span>{character.name.split(" ")[0]}</span>
                </li>
              ))}
            </ol>
            <div className="roster-chain">
              <span>RANKED RESULTS SETTLE ON</span>
              <img src="/assets/brand/starknet-logo.svg" alt="Starknet" />
            </div>
          </Panel>
          <div className="feature-copy">
            <p className="feature-eyebrow">RANKED PLAY · HUMANS &amp; AI</p>
            <h2 id="ranked" tabIndex={-1}>
              Your rank,
              <br />
              set in stone,
              <br />
              onchain.
            </h2>
            <p>
              Every ranked game settles on Starknet and moves your rating
              there, so your rank is permanent and enforced by the chain. A
              settled result is never revised.
            </p>
            <ul className="feature-points">
              <li>
                <Users size={18} aria-hidden="true" /> Play people near your
                rank in the Dojo.
              </li>
              <li>
                <Bot size={18} aria-hidden="true" /> Or the AI regulars, ready
                whenever you are.
              </li>
            </ul>
            {COMING_SOON ? (
              <span className="story-status">Coming soon</span>
            ) : (
              <LinkButton variant="text" className="feature-link" href="#lobby">
                Enter the Dojo <ArrowRight size={17} />
              </LinkButton>
            )}
          </div>
        </div>
      </section>

      <section className="quiet-rewards" aria-labelledby="rewards">
        <div className="feature-container quiet-rewards-inner">
          <div className="quiet-rewards-content">
            <p className="feature-eyebrow">GAME RECORD</p>
            <h2 id="rewards" tabIndex={-1}>
              Every ranked game leaves a record.
            </h2>
            <p className="quiet-rewards-copy">
              When the game ends, one proof checks every move and the final
              score. Then its kifu is minted onchain: a lasting record of
              every move you played.
            </p>
            <Button
              variant="text"
              className="feature-link"
              onClick={() => onPreview("online")}
            >
              How it works <ArrowRight size={17} />
            </Button>
          </div>
          <div className="quiet-rewards-visual">
            <KifuStack />
          </div>
        </div>
      </section>

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
            <span className="story-status">Coming soon</span>
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
    </div>
  );
}
