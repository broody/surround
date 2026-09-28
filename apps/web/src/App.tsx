import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Flag,
  Grid2X2,
  Moon,
  Mountain,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button, Dialog, IconButton, Panel, StoneDot } from "./components/ui";
import BoardCanvas from "./game/BoardCanvas";
import StudyPage from "./study/StudyPage";
import GardenScene from "./scene/GardenScene";
import WinterScene from "./scene/WinterScene";
import PavilionScene from "./scene/PavilionScene";
import SunlitScene from "./scene/SunlitScene";
import ModernScene from "./scene/ModernScene";
import LunarScene from "./scene/LunarScene";
import EventideScene from "./scene/EventideScene";
import FujiScene from "./scene/FujiScene";
import GreatWallScene from "./scene/GreatWallScene";
import { WORLD_SCENE_CHOICES } from "./scene/WorldScene";
import LandingPage from "./landing/LandingPage";
import ModeDetails from "./landing/ModeDetails";
import { pageFromHash } from "./landing/modes";
import {
  colorName,
  coordinate,
  emptyPosition,
  opposite,
  play,
  studyHistory,
  type Color,
  type Position,
} from "./game/rules";
import {
  katagoMove,
  katagoReady,
  katagoScore,
  KOMI,
  RANKS,
  rankName,
} from "./game/katago";

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
const hints = [
  "The whole board is a conversation. Take a moment to listen.",
  "Corners, then sides, then the center. Give your stones room to breathe.",
  "A stone is strongest when it has a friend nearby.",
  "Before you play, look at the liberties on both sides.",
];
const MOTE_COUNT = 32;
const SCENES = {
  ...WORLD_SCENE_CHOICES,
  "great-wall": {
    label: "Great Wall autumn",
    heading: "A thousand paths, one next move",
    title: "Great Wall Autumn",
    caption: "Let the wind take its time.",
    description: "Leaves in the breeze. Passing clouds. A wall winding into the distance.",
    component: GreatWallScene,
  },
  fuji: {
    label: "Fuji morning",
    heading: "A still mountain, an open mind",
    title: "Fuji Morning",
    caption: "A little stillness goes a long way.",
    description: "Pines in the breeze. Light on the lake. Fuji beyond the board.",
    component: FujiScene,
  },
  eventide: {
    label: "Eventide platform",
    heading: "At the edge of infinity",
    title: "Eventide Platform",
    caption: "Even here, take your time.",
    description: "An ocean of light. A quiet platform. One move at a time.",
    component: EventideScene,
  },
  lunar: {
    label: "Lunar quiet",
    heading: "A world away",
    title: "Lunar Quiet",
    caption: "A little space to think.",
    description: "Earth on the horizon. A glimmer in the dark. Your next move.",
    component: LunarScene,
  },
  modern: {
    label: "Tatami study room",
    heading: "A little more understanding",
    title: "Tatami Study Room",
    caption: "Time to find your focus.",
    description: "A quiet clock. Leaves beyond the glass. One move at a time.",
    component: ModernScene,
  },
  sunlit: {
    label: "Sunlit training dojo",
    heading: "One stone at a time",
    title: "Sunlit Training Dojo",
    caption: "Room to grow.",
    description:
      "Leaves stir outside. Sunlight settles in. Take your time to learn.",
    component: SunlitScene,
  },
  pavilion: {
    label: "Cloud-sea pavilion",
    heading: "Above the clouds",
    title: "Cloud-Sea Pavilion",
    caption: "Above the clouds.",
    description: "A wandering petal. A sea of clouds. A moment between moves.",
    component: PavilionScene,
  },
  winter: {
    label: "Winter stillness",
    heading: "The winter dojo",
    title: "Winter Stillness",
    caption: "Winter stillness.",
    description: "A soft snowfall. A sheltered light. A moment between moves.",
    component: WinterScene,
  },
  moonlit: {
    label: "Moonlit garden",
    heading: "The moonlit dojo",
    title: "The Moonlit Dojo",
    caption: "The moonlit garden.",
    description: "A passing cloud. A wavering light. A moment between moves.",
    component: GardenScene,
  },
};
type SceneId = keyof typeof SCENES;
const SCENE_CHOICES = Object.entries(SCENES).map(([id, details]) => ({
  id,
  label: details.label,
}));

function PlayerCard({
  color,
  active,
  captures,
  seconds,
  engine,
}: {
  color: Color;
  active: boolean;
  captures: number;
  seconds: number;
  /** KataGo's name, when it plays this color. */
  engine?: string;
}) {
  return (
    <article className={`player-card pixel-panel${active ? " active" : ""}`}>
      <div className="player-top">
        <span>
          <StoneDot color={color} />
          {colorName(color)}
        </span>
        <span className="player-number">0{color}</span>
      </div>
      <div className="portrait-wrap">
        <img
          className="portrait"
          src={`/assets/player-${color === 1 ? "black" : "white"}.png`}
          alt=""
        />
        <span className="portrait-label">
          {engine ? "KATAGO" : color === 1 ? "THE SEEKER" : "THE WAYFARER"}
        </span>
      </div>
      <div className="player-info">
        <div className="player-name">
          {engine ?? `Player ${color === 1 ? "one" : "two"}`}
        </div>
        <span className="player-status">
          {active ? (
            <>
              <i /> {engine ? "Reading the board…" : "Contemplating…"}
            </>
          ) : (
            "Waiting for a move"
          )}
        </span>
      </div>
      <div className="player-stats">
        <div>
          <span className="eyebrow">TIME SPENT</span>
          <strong>{formatTime(seconds)}</strong>
        </div>
        <div>
          <span className="eyebrow">CAPTURES</span>
          <strong>{String(captures).padStart(2, "0")}</strong>
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const [study, setStudy] = useState(() => window.location.hash === "#study");
  useEffect(() => {
    const navigate = () => setStudy(window.location.hash === "#study");
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return study ? <StudyPage /> : <SurroundPreview />;
}

function SurroundPreview() {
  const [page, setPage] = useState(() => pageFromHash(window.location.hash));
  const previousPage = useRef(page);
  const [history, setHistory] = useState<Position[]>(() => [emptyPosition()]);
  const position = history.at(-1)!;
  // The color KataGo plays, or null when two players share this device.
  const [katago, setKatago] = useState<Color | null>(null);
  const [katagoAvailable, setKatagoAvailable] = useState(false);
  // With its human SL network, KataGo imitates a player of this rank.
  const [katagoHuman, setKatagoHuman] = useState(false);
  const [rank, setRank] = useState("1k");
  const katagoName = katagoHuman ? `KataGo · ${rank}` : "KataGo";
  const katagoToPlay = katago === position.turn && !position.paused;
  const [isStudy, setIsStudy] = useState(false);
  const [coordinates, setCoordinates] = useState(true);
  const [sound, setSound] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [sceneMotion, setSceneMotion] = useState(() => !reducedMotion);
  const [scene, setScene] = useState<SceneId>("pavilion");
  const selectedScene = SCENES[scene];
  const Scene = selectedScene.component;
  const [gardenView, setGardenView] = useState(false);
  const gardenButton = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [message, setMessage] = useState(
    "A quiet board. A world of possibilities. Black plays first.",
  );
  const [error, setError] = useState(false);
  const [elapsed, setElapsed] = useState<[number, number]>([0, 0]);
  const [modal, setModal] = useState<
    "help" | "new" | "story" | "online" | "ai" | null
  >(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const latestMove = position.moves.at(-1);

  useEffect(() => {
    const onHashChange = () => {
      setPage(pageFromHash(window.location.hash));
      setGardenView(false);
      setModal(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.title =
      page === "home"
        ? "Surround — A quiet mind. An open board."
        : `Surround — Play in ${SCENES[scene].title}`;
    if (page !== previousPage.current) {
      const anchor = window.location.hash.slice(1);
      const landingAnchor =
        page === "home" &&
        ["modes", "story", "rewards", "learn", "training"].includes(anchor);
      const destination = document.getElementById(
        landingAnchor ? anchor : "main-content",
      );
      if (landingAnchor) destination?.scrollIntoView();
      else window.scrollTo({ top: 0, behavior: "instant" });
      destination?.focus({ preventScroll: true });
      previousPage.current = page;
    }
  }, [page, scene]);

  useEffect(() => {
    if (page !== "play" || position.paused || modal || gardenView) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setElapsed((previous) => {
        const next: [number, number] = [...previous];
        next[position.turn - 1]++;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [page, position.turn, position.paused, modal, gardenView]);

  // A dev server that can run KataGo seats it as White the first time the
  // play page opens.
  useEffect(() => {
    if (page !== "play" || katagoAvailable) return;
    let current = true;
    katagoReady().then(
      ({ human }) => {
        if (!current) return;
        setKatagoAvailable(true);
        setKatagoHuman(human);
        setKatago(2);
        setError(false);
        setMessage(
          human
            ? "KataGo takes White. Set its rank beside the board, or start a new game to switch colors."
            : "KataGo takes White. Start a new game to switch colors or play a friend.",
        );
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [page, katagoAvailable]);

  useEffect(() => {
    if (page !== "play" || !katagoToPlay) return;
    const request = new AbortController();
    katagoMove(position, position.turn, rank, request.signal).then(
      (reply) => {
        if (request.signal.aborted) return;
        if (reply !== "resign") return move(reply);
        setHistory([...history, { ...position, paused: true }]);
        setError(false);
        setMessage(
          `KataGo resigns. ${colorName(opposite(position.turn))} wins.`,
        );
      },
      (reason: Error) => {
        if (request.signal.aborted) return;
        setKatago(null);
        setError(true);
        setMessage(
          `KataGo stopped: ${reason.message.replace(/\.?$/, ".")} Both colors are yours for now.`,
        );
      },
    );
    return () => request.abort();
  }, [page, katagoToPlay, position]);

  useEffect(() => {
    if (page !== "play" || katago === null || position.passes < 2) return;
    const request = new AbortController();
    katagoScore(position, request.signal).then(
      (score) => {
        if (!request.signal.aborted)
          setMessage(`Both players passed. ${score}`);
      },
      () => {},
    );
    return () => request.abort();
  }, [page, katago, position]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) setSceneMotion(false);
    };
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);

  useEffect(() => {
    if (!gardenView) return;
    const closeGarden = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGardenView(false);
        gardenButton.current?.focus();
      }
    };
    window.addEventListener("keydown", closeGarden);
    return () => window.removeEventListener("keydown", closeGarden);
  }, [gardenView]);

  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);

  function clickSound() {
    if (!sound) return;
    try {
      const context = (audioContext.current ??= new AudioContext());
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(620, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        170,
        context.currentTime + 0.045,
      );
      gain.gain.setValueAtTime(0.1, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        context.currentTime + 0.085,
      );
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.09);
    } catch {
      /* Audio is optional; the game remains usable without it. */
    }
  }

  function move(point: number | null) {
    try {
      const next = play(position, point);
      setHistory([...history, next]);
      setError(false);
      if (next.paused)
        setMessage(
          "Both players passed. Play is paused; resume to continue exploring.",
        );
      else if (point === null)
        setMessage(
          `${colorName(position.turn)} passed. ${colorName(next.turn)} to play.`,
        );
      else {
        const captured = next.moves.at(-1)!.captures;
        setMessage(
          captured
            ? `${colorName(position.turn)} captured ${captured} ${captured === 1 ? "stone" : "stones"}.`
            : `${colorName(position.turn)} played ${coordinate(point)}. ${colorName(next.turn)} to play.`,
        );
        clickSound();
      }
    } catch (reason) {
      setError(true);
      setMessage((reason as Error).message);
    }
  }

  function playerMove(point: number | null) {
    if (!katagoToPlay) return move(point);
    setError(false);
    setMessage("KataGo is reading the board. Your move is next.");
  }

  function undo() {
    let back = history.length - 2;
    // Against KataGo, take back its reply as well so it is your move again.
    while (katago && back > 0 && history[back].turn === katago) back--;
    if (back < 0) return;
    setHistory(history.slice(0, back + 1));
    setError(false);
    setMessage(
      back === history.length - 2
        ? "One move taken back. See the board with fresh eyes."
        : "Taken back to your move. See the board with fresh eyes.",
    );
  }

  function reset(study = false, opponent = katago) {
    setHistory(study ? studyHistory() : [emptyPosition()]);
    setKatago(opponent);
    setIsStudy(study);
    setElapsed([0, 0]);
    setMessage(
      study
        ? "A new perspective on the opening. Black to play."
        : opponent === 1
          ? "A quiet board. KataGo takes Black and plays first."
          : "A quiet board. A world of possibilities. Black plays first.",
    );
    setError(false);
    setModal(null);
  }

  function resume() {
    setHistory([...history, { ...position, paused: false, passes: 0 }]);
    setMessage(
      `${colorName(position.turn)} to play. The conversation continues.`,
    );
    setError(false);
  }

  function openStudy() {
    setModal(null);
    setGardenView(false);
    window.location.hash = "study";
  }

  return (
    <div
      id="home"
      className={`app-shell${page === "home" ? " landing-shell" : ""}${gardenView ? " garden-view" : ""}`}
      data-scene-motion={sceneMotion ? "playing" : "paused"}
      data-scene={scene}
    >
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <Scene moving={sceneMotion} />
      {scene === "moonlit" && (
        <div className="fireflies" aria-hidden="true">
          {Array.from({ length: MOTE_COUNT }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${5 + (i * 90) / (MOTE_COUNT - 1)}%`,
                top: `${38 + ((i * 19) % 53)}%`,
                animationDelay: `${i * -2.17}s`,
                animationDuration: `${9 + (i % 5) * 1.1}s`,
              }}
            />
          ))}
        </div>
      )}
      <header
        className={`site-header${page === "home" ? " landing-header" : ""}`}
      >
        <a
          className="brand"
          href="#home"
          aria-label="Surround home"
          onClick={() => {
            setGardenView(false);
            setModal(null);
          }}
        >
          <img src="/assets/surround-logo.png" alt="Surround" />
        </a>
        {page === "home" ? (
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#modes" onClick={() => setGardenView(false)}>
              Play
            </a>
            <a href="#story" onClick={() => setGardenView(false)}>
              Story
            </a>
            <a href="#learn" onClick={() => setGardenView(false)}>
              Learn
            </a>
            <a href="#rewards" onClick={() => setGardenView(false)}>
              Rewards
            </a>
            <button
              className="nav-gardens"
              ref={gardenButton}
              onClick={() => setGardenView(!gardenView)}
              aria-pressed={gardenView}
              aria-label={gardenView ? "Back to the dojo" : "The gardens"}
            >
              <Mountain size={16} />
              <span>{gardenView ? "Back to the dojo" : "The gardens"}</span>
            </button>
          </nav>
        ) : (
          <div className="header-center">
            <span className="tiny-cross">✦</span> A GAME OF CONNECTION{" "}
            <span className="tiny-cross">✦</span>
          </div>
        )}
        <div className="header-actions">
          {page === "play" && (
            <span className="local-tag">
              <i /> {katago ? "VS KATAGO" : "LOCAL PLAY"}
            </span>
          )}
          {page === "play" && (
            <IconButton
              ref={gardenButton}
              className="icon-button garden-view-button"
              label={gardenView ? "Return to game" : "View garden"}
              aria-pressed={gardenView}
              title={
                gardenView ? "Return to game (Esc)" : "View the living garden"
              }
              onClick={() => setGardenView(!gardenView)}
            >
              <Mountain size={18} />
              <span>{gardenView ? "Back to game" : "View garden"}</span>
            </IconButton>
          )}
          <IconButton
            label={
              reducedMotion
                ? "Scenery motion disabled by reduced-motion preference"
                : sceneMotion
                  ? "Pause scenery motion"
                  : "Enable scenery motion"
            }
            aria-pressed={sceneMotion}
            disabled={reducedMotion}
            title={
              reducedMotion
                ? "Scenery motion follows your system's reduced-motion preference"
                : sceneMotion
                  ? "Pause scenery motion"
                  : "Enable scenery motion"
            }
            onClick={() => setSceneMotion(!sceneMotion)}
          >
            {sceneMotion ? <Pause size={16} /> : <Play size={16} />}
          </IconButton>
          {page === "play" && (
            <>
              <IconButton
                label={sound ? "Mute sound" : "Enable sound"}
                aria-pressed={sound}
                onClick={() => setSound(!sound)}
              >
                {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </IconButton>
              <IconButton
                label="How to play"
                onClick={() => setModal("help")}
              >
                <CircleHelp size={18} />
              </IconButton>
            </>
          )}
        </div>
      </header>

      {(page === "play" || gardenView) && (
        <label className="scene-switcher">
          <span>SCENE</span>
          <select
            aria-label="Garden scene"
            value={scene}
            onChange={(event) => setScene(event.target.value as SceneId)}
          >
            {Object.entries(SCENES).map(([id, details]) => (
              <option key={id} value={id}>
                {details.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {page === "home" ? (
        <LandingPage
          hidden={gardenView}
          onHelp={() => setModal("help")}
          onMode={setModal}
          onGarden={() => setGardenView(true)}
          scene={scene}
          scenes={SCENE_CHOICES}
          onScene={(id) => setScene(id as SceneId)}
        />
      ) : (
        <>
          <main
            className="game-layout"
            id="main-content"
            tabIndex={-1}
            inert={gardenView}
          >
            <div className="study-breadcrumb">
              <a href="#home">
                <ArrowLeft size={14} /> Back to the dojo
              </a>
              <span>
                {katago ? "PLAY · KATAGO ON THIS MACHINE" : "PLAY · LOCAL BOARD"}
              </span>
            </div>
            <div className="scene-title">
              <div className="eyebrow">
                {scene === "sunlit" || scene === "modern" ? (
                  <Sun size={12} />
                ) : (
                  <Moon size={12} />
                )}{" "}
                A PLACE TO FIND YOUR NEXT MOVE
              </div>
              <h1>
                {selectedScene.heading}
                <span>.</span>
              </h1>
              <div className="room-details">
                19 × 19 <span>·</span> {katago ? "VS KATAGO" : "TWO PLAYERS"}{" "}
                <span>·</span> NO TIME LIMIT
              </div>
            </div>
            <div className="game-stage">
              <aside className="players" aria-label="Players">
                <div className="section-caption">
                  <span>THE PLAYERS</span>
                  <span>一</span>
                </div>
                <PlayerCard
                  color={1}
                  active={position.turn === 1 && !position.paused}
                  captures={position.captures[0]}
                  seconds={elapsed[0]}
                  engine={katago === 1 ? katagoName : undefined}
                />
                <div className="versus">
                  <span /> 対 <span />
                </div>
                <PlayerCard
                  color={2}
                  active={position.turn === 2 && !position.paused}
                  captures={position.captures[1]}
                  seconds={elapsed[1]}
                  engine={katago === 2 ? katagoName : undefined}
                />
              </aside>

              <section className="board-column" aria-label="Game board">
                <div className="board-heading">
                  <span>
                    <i />
                    {isStudy ? "STUDY POSITION" : "FRIENDLY MATCH"}
                  </span>
                  <span>
                    MOVE {String(position.moves.length).padStart(3, "0")}
                  </span>
                </div>
                <div className="goban">
                  <BoardCanvas
                    position={position}
                    coordinates={coordinates}
                    onPlay={playerMove}
                    onHover={setHover}
                  />
                </div>
                <div className="board-footer">
                  <span id="board-instructions">
                    Click an intersection to place a stone
                  </span>
                  <span className="hover-coordinate" aria-live="polite">
                    {hover !== null ? coordinate(hover) : "19 × 19"}
                  </span>
                </div>
                <div
                  className={`game-message${error ? " error" : ""}`}
                  role="status"
                >
                  <span>{error ? "!" : "✦"}</span>
                  {message}
                </div>
              </section>

              <aside className="match-sidebar" aria-label="Match controls">
                <div className="section-caption">
                  <span>THE MATCH</span>
                  <span>二</span>
                </div>
                <Panel className="turn-panel">
                  <div className="eyebrow">
                    {position.paused
                      ? "TAKE A BREATH"
                      : katagoToPlay
                        ? "KATAGO IS THINKING"
                        : "THE NEXT MOVE IS YOURS"}
                  </div>
                  <div className="turn-title">
                    <StoneDot color={position.turn} />
                    <h2>
                      {position.paused
                        ? "A quiet pause"
                        : `${colorName(position.turn)} to play`}
                    </h2>
                  </div>
                  <p>
                    {position.paused
                      ? position.passes >= 2
                        ? "Two passes. A moment to reflect."
                        : "The game is decided."
                      : katagoToPlay
                        ? "KataGo is reading the board."
                        : "Read the flow. Find the vital point."}
                  </p>
                  <div className="turn-divider" />
                  <dl>
                    <div>
                      <dt>Board</dt>
                      <dd>19 × 19</dd>
                    </div>
                    <div>
                      <dt>Komi</dt>
                      <dd>{KOMI} points</dd>
                    </div>
                    <div>
                      <dt>Rules</dt>
                      <dd>Area · superko</dd>
                    </div>
                    {katago && katagoHuman && (
                      <div>
                        <dt>
                          <label htmlFor="katago-rank">KataGo plays as</label>
                        </dt>
                        <dd>
                          <select
                            id="katago-rank"
                            value={rank}
                            onChange={(event) => setRank(event.target.value)}
                          >
                            {RANKS.map((choice) => (
                              <option key={choice} value={choice}>
                                {rankName(choice)}
                              </option>
                            ))}
                          </select>
                        </dd>
                      </div>
                    )}
                  </dl>
                </Panel>

                <div className="match-buttons">
                  <Button
                    variant="primary"
                    disabled={katagoToPlay}
                    onClick={() =>
                      position.paused ? resume() : playerMove(null)
                    }
                  >
                    <ChevronRight size={18} />
                    <span>{position.paused ? "Resume play" : "Pass turn"}</span>
                    <span className="button-dash">—</span>
                  </Button>
                  <Button
                    disabled={history.length < 2}
                    onClick={undo}
                  >
                    <RotateCcw size={15} />
                    <span>Take back</span>
                  </Button>
                </div>

                <Panel className="record-panel">
                  <div className="record-heading">
                    <span className="eyebrow">LAST MOVES</span>
                    <BookOpen size={13} />
                  </div>
                  <div className="move-list">
                    {position.moves.length === 0 ? (
                      <p className="empty-record">
                        Every game begins
                        <br />
                        with a single stone.
                      </p>
                    ) : (
                      position.moves
                        .slice(-5)
                        .reverse()
                        .map((move, i) => (
                          <div
                            className={`move-row${i === 0 ? " latest" : ""}`}
                            key={position.moves.length - i}
                          >
                            <span className="move-number">
                              {String(position.moves.length - i).padStart(
                                2,
                                "0",
                              )}
                            </span>
                            <StoneDot color={move.color} />
                            <span>
                              {move.point === null
                                ? "Pass"
                                : coordinate(move.point)}
                            </span>
                            {i === 0 ? <ArrowLeft size={13} /> : <span />}
                          </div>
                        ))
                    )}
                  </div>
                </Panel>

                <button
                  className="setting-row"
                  onClick={() => setCoordinates(!coordinates)}
                  aria-pressed={coordinates}
                >
                  <Grid2X2 size={14} />
                  <span>Coordinates</span>
                  <span className={`toggle${coordinates ? " on" : ""}`}>
                    <span />
                  </span>
                </button>
                <button className="new-game" onClick={() => setModal("new")}>
                  <Flag size={14} /> Start a new game{" "}
                  <ArrowDownRight size={14} />
                </button>
              </aside>
            </div>

            <div className="wisdom">
              <div className="wisdom-symbol">碁</div>
              <div>
                <span className="eyebrow">A MOMENT OF CLARITY</span>
                <p>
                  “{hints[Math.floor(position.moves.length / 8) % hints.length]}
                  ”
                </p>
              </div>
              <Sparkles size={20} />
            </div>
          </main>

          <footer className="site-footer" inert={gardenView}>
            <span>
              SURROUND <span className="footer-star">✦</span> A QUIET MIND. AN
              OPEN BOARD.
            </span>
            <span>
              LOCAL PREVIEW <span>·</span>{" "}
              {katago ? "KATAGO RUNS ON THIS MACHINE" : "PLAY ON THE SAME DEVICE"}
            </span>
          </footer>
        </>
      )}

      {gardenView && (
        <section className="garden-caption" aria-label="Garden view">
          <div className="eyebrow">
            {scene === "sunlit" || scene === "modern" || scene === "fuji" ? (
              <Sun size={13} />
            ) : (
              <Moon size={13} />
            )}{" "}
            LET THE WORLD SLOW DOWN
          </div>
          <h1>{selectedScene.caption}</h1>
          <p>{selectedScene.description}</p>
          <Button
            onClick={() => {
              setGardenView(false);
              gardenButton.current?.focus();
            }}
          >
            <ArrowLeft size={15} />{" "}
            {page === "home" ? "Return to the dojo" : "Return to the board"}{" "}
            <kbd>ESC</kbd>
          </Button>
        </section>
      )}

      <Dialog
        ref={dialog}
        wide={modal === "story" || modal === "online" || modal === "ai"}
        aria-labelledby="dialog-title"
        onCloseRequest={() => setModal(null)}
      >
          {modal === "story" || modal === "online" || modal === "ai" ? (
            <ModeDetails mode={modal} onStudy={openStudy} />
          ) : modal === "help" ? (
            <>
              <span className="eyebrow">A GAME OF CONNECTION</span>
              <h2 id="dialog-title">
                A few simple rules.
                <br />
                Endless possibilities.
              </h2>
              <p>
                Take turns placing black and white stones on the intersections.
                Stones connected horizontally or vertically form a group.
              </p>
              <p>
                Empty neighboring intersections are liberties. Surround a group
                so it has no liberties to capture it. You cannot play a move
                with no liberties or repeat an earlier board position.
              </p>
              <p>
                Use the arrow keys on the board to select an intersection, then
                press Enter to play. Pass when you have no move to make; two
                passes pause the game.
              </p>
              <div className="dialog-note">
                {katago
                  ? "KataGo runs on this machine through the dev server; there is no network connection. After two passes it counts the board, removing the stones it judges dead."
                  : "This is a local two-player preview. There is no AI opponent or network connection. Final scoring and agreement on dead groups are not implemented yet."}{" "}
                Time spent is informational.
              </div>
              <Button
                variant="primary"
                onClick={page === "home" ? openStudy : () => setModal(null)}
              >
                <Check size={16} />{" "}
                {page === "home" ? "Try the study board" : "Back to the board"}
              </Button>
            </>
          ) : (
            <>
              <span className="eyebrow">A FRESH PERSPECTIVE</span>
              <h2 id="dialog-title">
                Every board is
                <br />a new beginning.
              </h2>
              <p>
                {katagoAvailable
                  ? "Take either color against KataGo, share the board with a friend, or explore the example opening."
                  : "Start with an empty 19×19 board, or explore the example opening."}{" "}
                This will replace the current local game.
              </p>
              {katagoAvailable ? (
                <>
                  <Button variant="primary" onClick={() => reset(false, 2)}>
                    <StoneDot color={1} /> Play Black vs KataGo{" "}
                    <ArrowRight size={16} />
                  </Button>
                  <Button onClick={() => reset(false, 1)}>
                    <StoneDot color={2} /> Play White vs KataGo
                  </Button>
                  <Button onClick={() => reset(false, null)}>
                    <Grid2X2 size={16} /> Two players, one device
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => reset(false)}>
                  <Grid2X2 size={16} /> Empty board <ArrowRight size={16} />
                </Button>
              )}
              <Button onClick={() => reset(true)}>
                <BookOpen size={16} /> Study the opening
              </Button>
              <Button variant="text" onClick={() => setModal(null)}>
                Keep playing
              </Button>
            </>
          )}
      </Dialog>
      <span className="sr-only">
        {latestMove?.point != null
          ? `Last move: ${coordinate(latestMove.point)}.`
          : ""}
      </span>
    </div>
  );
}
