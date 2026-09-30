import { Button, Tab, TabList, Panel } from "../components/ui";
import { useEffect, useState } from "react";
import BoardCanvas from "../game/BoardCanvas";
import MentorDialogue from "./MentorDialogue";
import LessonTrack from "./LessonTrack";
import LibraryTrack from "./LibraryTrack";
import { BASICS } from "./basics";
import { loadOgsIndex, type OgsIndex } from "./ogsLibrary";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  Lightbulb,
  RotateCcw,
} from "lucide-react";
import { emptyPosition, play, SIZE, type Position } from "../game/rules";
import { focusRegion } from "../game/region";
import "./study.css";

const point = (x: number, y: number) => (y + 5) * SIZE + x + 5;
const problems = [
  {
    title: "One breath left",
    topic: "Capturing stones",
    level: "30 kyu",
    black: [[4, 4]],
    white: [
      [3, 4],
      [4, 3],
      [4, 5],
    ],
    answer: [5, 4],
    hint: "Look at the four intersections touching the black stone. Which one is still empty?",
    explanation:
      "A stone needs an empty neighboring intersection to stay on the board. These empty points are called liberties. White can capture this stone in one move.",
    success:
      "Exactly. You filled Black’s last liberty. With no breathing room left, the black stone is captured.",
  },
  {
    title: "Stronger together?",
    topic: "Capturing a group",
    level: "29 kyu",
    black: [
      [3, 4],
      [4, 4],
    ],
    white: [
      [2, 4],
      [3, 3],
      [3, 5],
      [4, 3],
      [4, 5],
    ],
    answer: [5, 4],
    hint: "Connected stones share their liberties. Trace the outside of the entire black group.",
    explanation:
      "Stones connected along a line form a group. They share all their liberties—and are captured together when the last liberty is filled.",
    success:
      "Two stones, one last liberty. Your move captured the entire connected group.",
  },
  {
    title: "Turn the corner",
    topic: "Reading liberties",
    level: "28 kyu",
    black: [
      [3, 3],
      [4, 3],
      [4, 4],
    ],
    white: [
      [2, 3],
      [3, 2],
      [3, 4],
      [4, 2],
      [5, 3],
      [5, 4],
    ],
    answer: [4, 5],
    hint: "Diagonal spaces do not count as liberties. Follow only the horizontal and vertical lines.",
    explanation:
      "A group can bend around a corner. Count every empty point directly beside it, remembering that diagonal spaces do not provide breathing room.",
    success:
      "Beautifully read. The bent group had just one liberty, and you found it.",
  },
] as const;

// Each problem concerns one area of the board, so zoom in on its stones and
// the answer rather than showing all 19 lines.
const regions = problems.map((problem) =>
  focusRegion(
    [...problem.black, ...problem.white, problem.answer].map(([x, y]) =>
      point(x, y),
    ),
  ),
);

function initialPosition(index: number): Position {
  const position = emptyPosition();
  for (const [x, y] of problems[index].black) position.board[point(x, y)] = 1;
  for (const [x, y] of problems[index].white) position.board[point(x, y)] = 2;
  position.turn = 2;
  position.hashes = [position.board.join("")];
  return position;
}

type Track = "basics" | "problems" | "library";
const TRACKS: [Track, string][] = [
  ["basics", "The basics"],
  ["problems", "Problems"],
];

export default function StudyPage() {
  const [track, setTrack] = useState<Track>("basics");
  // The imported lesson library, when this copy of the site has one.
  const [library, setLibrary] = useState<OgsIndex | null>(null);
  const tracks: [Track, string][] = library
    ? [...TRACKS, ["library", "Library"]]
    : TRACKS;

  useEffect(() => {
    document.title = "Surround — Study room";
    loadOgsIndex().then(setLibrary);
  }, []);

  return (
    <div className="study-screen">
      <header className="study-header">
        <a href="#home" className="study-wordmark" aria-label="Surround home">
          SURROUND<span>✦</span>
        </a>
        <span className="study-header-label">
          <BookOpen size={14} /> THE STUDY ROOM
        </span>
        <a href="#home" className="study-exit">
          <ChevronLeft size={15} /> Back to the dojo
        </a>
      </header>
      <main id="main-content" className="study-content" tabIndex={-1}>
        <TabList className="study-tracks" aria-label="Study track">
          {tracks.map(([id, label]) => (
            <Tab
              type="button"
              key={id}
              id={`study-tab-${id}`}
              selected={track === id}
              aria-controls="study-track"
              onClick={() => setTrack(id)}
            >
              {label}
            </Tab>
          ))}
        </TabList>
        <div
          id="study-track"
          role="tabpanel"
          aria-labelledby={`study-tab-${track}`}
        >
          {track === "basics" ? (
            <LessonTrack
              lessons={BASICS}
              storageKey="surround:basics"
              kicker="START FROM ZERO, ONE IDEA AT A TIME"
              heading="Learn the basics"
              label="THE BASICS"
              finish={{
                label: "On to problems",
                message:
                  "You've learned the basics. The problems are waiting whenever you are.",
                onFinish: () => setTrack("problems"),
              }}
            />
          ) : track === "library" && library ? (
            <LibraryTrack index={library} />
          ) : (
            <ProblemsTrack />
          )}
        </div>
        <footer className="study-bottom">
          <span>
            SURROUND STUDY ·{" "}
            <a href="https://github.com/broody/surround">SOURCE CODE (AGPL)</a>
          </span>
          <span>No clock. No opponent. Just you and the board.</span>
          {track !== "problems" ? (
            <span>
              LESSONS ADAPTED FROM{" "}
              <a href="https://online-go.com/learn-to-play-go">ONLINE-GO.COM</a>
            </span>
          ) : (
            <span>BEGINNER COLLECTION · 01</span>
          )}
        </footer>
      </main>
    </div>
  );
}

function ProblemsTrack() {
  const [index, setIndex] = useState(0);
  const [position, setPosition] = useState(() => initialPosition(0));
  const [completed, setCompleted] = useState<number[]>([]);
  const [hint, setHint] = useState(false);
  const [feedback, setFeedback] = useState("");
  const problem = problems[index];
  const solved = position.captures[1] > 0;
  const mentorMood = solved
    ? "success"
    : feedback
      ? "retry"
      : hint
        ? "hint"
        : "lesson";
  const mentorMessage = solved
    ? problem.success
    : feedback || (hint ? problem.hint : problem.explanation);

  function navigate(next: number) {
    setIndex(next);
    setPosition(initialPosition(next));
    setHint(false);
    setFeedback("");
  }
  function attempt(selectedPoint: number) {
    if (solved) return;
    try {
      const next = play(position, selectedPoint);
      if (!next.captures[1]) {
        setFeedback(
          "Not quite. Black still has a liberty. Look again—you can try another point.",
        );
        return;
      }
      setPosition(next);
      setCompleted((items) =>
        items.includes(index) ? items : [...items, index],
      );
      setFeedback("");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Try an empty intersection.",
      );
    }
  }

  return (
    <>
      <div className="study-heading">
        <div>
          <p className="study-kicker">A LITTLE STRONGER, ONE STONE AT A TIME</p>
          <h1>
            Find your next move<span>.</span>
          </h1>
        </div>
        <div className="study-level">
          <span className="study-level-symbol">入</span>
          <div>
            <span className="study-kicker">PROBLEM LEVEL</span>
            <strong>
              {problem.level}
              <small>Beginner</small>
            </strong>
          </div>
        </div>
      </div>
      <div className="study-workspace">
        <section className="study-board-section" aria-label="Problem board">
          <div className="study-board-heading">
            <span>
              <i /> {solved ? "PROBLEM SOLVED" : "WHITE TO PLAY"}
            </span>
            <span>CAPTURE IN ONE MOVE</span>
          </div>
          <div className="goban">
            <BoardCanvas
              position={position}
              coordinates
              region={regions[index]}
              onPlay={attempt}
              onHover={() => {}}
            />
          </div>
          <p id="board-instructions" className="sr-only">
            Click an intersection, or use the arrow keys and Enter to place
            White. Capture the black group in one move.
          </p>
          <div className="study-board-tools">
            <span>Take your time. Every move teaches.</span>
            <Button variant="text" size="sm" onClick={() => navigate(index)}>
              <RotateCcw size={14} /> Reset board
            </Button>
          </div>
        </section>
        <aside className="study-sidebar" aria-label="Lesson and explanation">
          <div className="study-problem-meta">
            <span className="study-kicker">THE FUNDAMENTALS</span>
            <span>
              0{index + 1}{" "}
              <span className="study-dim">/ 0{problems.length}</span>
            </span>
          </div>
          <h2>{problem.title}</h2>
          <p className="study-topic">{problem.topic}</p>
          <Panel as="div" className="study-explanation">
            <div className="study-note-label">
              {solved ? <Check size={16} /> : <BookOpen size={16} />}
              {solved ? "WELL PLAYED" : "YOUR GOAL"}
            </div>
            <p>
              {solved
                ? "You found the last liberty."
                : "Capture the black group in one move."}
            </p>
            <div className="study-objective">
              <span>{solved ? "✓" : "→"}</span>
              {solved
                ? index === problems.length - 1
                  ? "Problem solved. Revisit any problem to practice."
                  : "Problem solved. Ready for the next?"
                : "Find the last liberty. Play White to capture."}
            </div>
          </Panel>
          <Button
            type="button"
            variant="text"
            className="study-hint-button"
            disabled={solved}
            onClick={() => {
              setFeedback("");
              setHint(!hint);
            }}
          >
            <Lightbulb size={16} />
            {hint ? "Hide hint" : "A little hint"}
            <span>{hint ? "−" : "+"}</span>
          </Button>
          <div className="study-session">
            <div>
              <span className="study-kicker">YOUR SESSION</span>
              <span>
                {completed.length} of {problems.length} solved
              </span>
            </div>
            <div
              className="study-progress"
              aria-label={`${completed.length} of ${problems.length} problems solved`}
            >
              {problems.map((_, n) => (
                <span
                  key={n}
                  className={
                    completed.includes(n)
                      ? "is-complete"
                      : n === index
                        ? "is-current"
                        : ""
                  }
                />
              ))}
            </div>
            <p>Small steps. Lasting understanding.</p>
          </div>
        </aside>
      </div>
      <MentorDialogue message={mentorMessage} mood={mentorMood} />
      <nav className="study-navigation" aria-label="Problem navigation">
        <Button
          type="button"
          disabled={index === 0}
          onClick={() => navigate(index - 1)}
        >
          <ArrowLeft size={17} /> Previous problem
        </Button>
        <span>
          PROBLEM <strong>0{index + 1}</strong> OF 0{problems.length}
        </span>
        <Button
          type="button"
          variant="primary"
          disabled={index === problems.length - 1}
          onClick={() => navigate(index + 1)}
        >
          Next problem <ArrowRight size={17} />
        </Button>
      </nav>
    </>
  );
}
