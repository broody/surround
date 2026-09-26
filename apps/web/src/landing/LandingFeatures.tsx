import {
  ArrowRight,
  ArrowDown,
  Check,
  Cpu,
  ShieldCheck,
  Swords,
  Sparkles,
} from "lucide-react";
import FirstCapture from "./FirstCapture";
import type { PreviewMode } from "./modes";

type Props = { onPreview: (mode: PreviewMode) => void; onHelp: () => void };

export default function LandingFeatures({ onPreview, onHelp }: Props) {
  return (
    <div className="landing-features">
      <section
        className="feature-section rewards-section"
        aria-labelledby="rewards"
      >
        <div className="feature-container feature-split">
          <div className="feature-copy">
            <p className="feature-eyebrow">
              <span>01</span> REAL GAMES. REAL REWARDS.
            </p>
            <h2 id="rewards" tabIndex={-1}>
              Your skill.
              <br />
              Something real at stake.
            </h2>
            <p>
              Go head to head, player to player. Agree on the stakes, play your
              match, and let the result speak for itself—with rewards settled on
              Starknet.
            </p>
            <ul className="feature-points">
              <li>
                <Swords size={17} /> Peer-to-peer competition
              </li>
              <li>
                <ShieldCheck size={17} /> Verified results, onchain settlement
              </li>
              <li>
                <Sparkles size={17} /> Real rewards for real-money matches
              </li>
            </ul>
            <button
              className="feature-link"
              onClick={() => onPreview("online")}
            >
              Explore reward matches <ArrowRight size={18} />
            </button>
            <p className="feature-note">
              In development. No wallets, deposits, or payouts in this preview.
            </p>
          </div>
          <div
            className="settlement-preview"
            aria-label="Planned reward match flow"
          >
            <div className="preview-topline">
              <span>THE MATCH PATH</span>
              <span>DESIGN PREVIEW</span>
            </div>
            <div className="match-pair">
              <div>
                <i className="stone-dot black" />
                <span>YOU</span>
              </div>
              <span className="match-versus">対</span>
              <div>
                <i className="stone-dot white" />
                <span>YOUR RIVAL</span>
              </div>
            </div>
            <div className="terms-line">
              AGREED RULES <span>·</span> AGREED STAKES
            </div>
            <div className="settlement-path">
              <div>
                <span className="path-number">01</span>
                <span>
                  Play offchain
                  <small>Signed moves. An uninterrupted game.</small>
                </span>
                <span className="path-mark">碁</span>
              </div>
              <ArrowDown className="path-arrow" size={18} />
              <div>
                <span className="path-number">02</span>
                <span>
                  Verify the result
                  <small>The match transcript and score.</small>
                </span>
                <ShieldCheck size={21} />
              </div>
              <ArrowDown className="path-arrow" size={18} />
              <div className="settlement-destination">
                <span className="path-number">03</span>
                <span>
                  Settle the rewards<small>ONCHAIN · STARKNET</small>
                </span>
                <Sparkles size={22} />
              </div>
            </div>
            <p className="settlement-caption">
              The board decides. The chain settles.
            </p>
          </div>
        </div>
      </section>

      <section className="story-section" aria-labelledby="story">
        <div className="story-landscape" aria-hidden="true" />
        <div className="feature-container story-layout">
          <div className="feature-copy">
            <p className="feature-eyebrow">
              <span>02</span> A WORLD WORTH GETTING LOST IN
            </p>
            <h2 id="story" tabIndex={-1}>
              Every rival, a lesson.
              <br />
              Every game, a chapter.
            </h2>
            <p>
              Step into an engaging single-player story. Meet memorable
              opponents, build your confidence, and discover what the next move
              means—on the board and beyond it.
            </p>
            <button
              className="landing-button outline-button"
              onClick={() => onPreview("story")}
            >
              Discover story mode <ArrowRight size={18} />
            </button>
            <span className="story-status">
              A SINGLE-PLAYER JOURNEY · COMING SOON
            </span>
          </div>
          <div
            className="story-characters"
            aria-label="Story character concepts"
          >
            <figure className="story-character seeker">
              <img
                src="/assets/player-black.png"
                alt="Pixel-art character concept: a thoughtful young Go player"
                loading="lazy"
              />
              <figcaption>
                THE SEEKER<span>A new perspective.</span>
              </figcaption>
            </figure>
            <span className="story-character-cross" aria-hidden="true">
              ✦
            </span>
            <figure className="story-character wayfarer">
              <img
                src="/assets/player-white.png"
                alt="Pixel-art character concept: a calm, experienced Go player"
                loading="lazy"
              />
              <figcaption>
                THE WAYFARER<span>A different way to play.</span>
              </figcaption>
            </figure>
            <span className="character-concept-label">CHARACTER CONCEPTS</span>
          </div>
        </div>
      </section>

      <section
        className="feature-section training-section"
        aria-labelledby="training"
      >
        <div className="feature-container">
          <div className="training-heading">
            <p className="feature-eyebrow">
              <span>03</span> A LITTLE STRONGER, EVERY GAME
            </p>
            <h2 id="training" tabIndex={-1}>
              Find your level. Then go beyond it.
            </h2>
          </div>
          <div className="training-columns">
            <article className="ai-feature">
              <div className="training-icon">
                <Cpu size={28} />
                <span>AI OPPONENTS</span>
              </div>
              <h3>
                A practice partner.
                <br />
                Whenever you’re ready.
              </h3>
              <p>
                From your first tentative moves to a serious challenge, play AI
                opponents at different strengths. Try an idea, make a mistake,
                and come back stronger—without putting money on the line.
              </p>
              <div
                className="ai-strengths"
                aria-label="Planned AI difficulty range"
              >
                <span>First steps</span>
                <i aria-hidden="true" />
                <span>A worthy rival</span>
                <i aria-hidden="true" />
                <span>A real challenge</span>
              </div>
              <button className="feature-link" onClick={() => onPreview("ai")}>
                Meet your future practice partner <ArrowRight size={17} />
              </button>
              <span className="feature-note">AI play is in development.</span>
            </article>
            <article className="rank-feature">
              <div className="training-icon">
                <span className="rank-symbol" aria-hidden="true">
                  段
                </span>
                <span>KYU / DAN RANKINGS</span>
              </div>
              <h3>
                Real Go ranks.
                <br />A journey you can see.
              </h3>
              <p>
                A familiar path from beginner kyu ranks toward dan-level play.
                Build your skill, find well-matched rivals, and give your
                progress a place on the board.
              </p>
              <ol
                className="rank-ladder"
                aria-label="Illustrative traditional Go rank progression"
              >
                {[
                  ["30", "KYU", "Begin"],
                  ["10", "KYU", "Grow"],
                  ["1", "KYU", "Refine"],
                  ["1", "DAN", "Advance"],
                ].map(([number, grade, label]) => (
                  <li key={number + grade}>
                    <span className="rank-medallion">
                      <strong>{number}</strong>
                      <span>{grade}</span>
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ol>
              <p className="feature-note">
                Traditional kyu/dan scale. Ranked play is planned; this preview
                does not issue ratings or federation-recognized ranks.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section
        className="feature-section learn-section"
        aria-labelledby="learn"
      >
        <div className="feature-container feature-split">
          <div className="feature-copy">
            <p className="feature-eyebrow">
              <span>04</span> NO EXPERIENCE NEEDED
            </p>
            <h2 id="learn" tabIndex={-1}>
              Never played Go?
              <br />
              You belong here.
            </h2>
            <p>
              You don’t need to know an opening, a strategy, or even where a
              stone goes. Start from zero. We’re building a guided path from
              your very first stone to your first confident game.
            </p>
            <ol className="learning-path">
              <li>
                <span>01</span>
                <div>
                  Place your first stone
                  <small>On an intersection, not inside a square.</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  Learn to capture
                  <small>
                    Stones need empty neighboring points to breathe.
                  </small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  Find your territory
                  <small>Connect your stones and make room to grow.</small>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  Play your first game
                  <small>Bring it together, one move at a time.</small>
                </div>
              </li>
            </ol>
            <button className="feature-link" onClick={onHelp}>
              Read the simple rules <ArrowRight size={17} />
            </button>
            <p className="feature-note">
              Try a capture right here. The full guided course is coming soon.
            </p>
          </div>
          <FirstCapture />
        </div>
      </section>

      <section className="landing-finale" aria-labelledby="begin-title">
        <div className="feature-container">
          <span className="finale-symbol" aria-hidden="true">
            碁
          </span>
          <p className="feature-eyebrow">A QUIET MIND. AN OPEN BOARD.</p>
          <h2 id="begin-title">
            Your next chapter starts
            <br />
            with one stone.
          </h2>
          <p>
            Start with the board today. A world of stories,
            <br className="desktop-break" /> rivals, and rewards is on its way.
          </p>
          <a className="landing-button gold-button" href="#study">
            Try the board <ArrowRight size={22} />
          </a>
          <span className="finale-note">
            <Check size={13} /> Free local preview <span>·</span> No wallet
            needed
          </span>
        </div>
      </section>
    </div>
  );
}
