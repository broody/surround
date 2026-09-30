import { Button, Panel } from "../components/ui";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  RotateCcw,
} from "lucide-react";
import BoardCanvas from "../game/BoardCanvas";
import { colorName, groupAt } from "../game/rules";
import MentorDialogue from "./MentorDialogue";
import {
  answer,
  decodePoints,
  lessonMarks,
  lessonPosition,
  pageSize,
  playerColor,
  reply,
  startPuzzle,
  type Lesson,
  type LessonPage,
  type PuzzleState,
} from "./lessonEngine";

type PageState =
  | { kind: "puzzle"; puzzle: PuzzleState }
  | { kind: "choice"; picked: string | null }
  | { kind: "action"; done: boolean }
  | { kind: "removal"; dead: ReadonlySet<number> };

function startPage(page: LessonPage): PageState {
  if (page.kind === "puzzle")
    return { kind: "puzzle", puzzle: startPuzzle(page) };
  if (page.kind === "choice") return { kind: "choice", picked: null };
  if (page.kind === "action") return { kind: "action", done: false };
  return { kind: "removal", dead: new Set() };
}

function statusOf(page: LessonPage, state: PageState) {
  if (state.kind === "puzzle") return state.puzzle.outcome;
  if (page.kind === "choice" && state.kind === "choice")
    return state.picked === null
      ? "playing"
      : state.picked === page.answer
        ? "correct"
        : "wrong";
  if (state.kind === "action") return state.done ? "correct" : "playing";
  if (page.kind === "removal" && state.kind === "removal") {
    const target = decodePoints(page.dead, pageSize(page));
    return state.dead.size === target.length &&
      target.every((point) => state.dead.has(point))
      ? "correct"
      : "playing";
  }
  return "playing";
}

// Where the learner is and which pages they've finished, kept in this browser
// so the course resumes where they left it.
type Progress = { lesson: number; page: number; done: string[] };

function loadProgress(key: string, lessons: Lesson[]): Progress {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      Number.isInteger(saved?.lesson) &&
      Number.isInteger(saved?.page) &&
      lessons[saved.lesson]?.pages[saved.page] &&
      Array.isArray(saved.done)
    )
      return saved;
  } catch {
    // Storage can be unavailable; start at the beginning.
  }
  return { lesson: 0, page: 0, done: [] };
}

const PRAISE = [
  "Well played.",
  "Exactly right.",
  "That's it.",
  "Nicely done.",
  "Good eye.",
];

const pad = (n: number) => String(n).padStart(2, "0");

type Props = {
  lessons: Lesson[];
  /** Where this course's progress is kept in the browser. */
  storageKey: string;
  kicker: string;
  heading: string;
  /** The course's name above the lesson title. */
  label: string;
  /** Offered after the last page, e.g. moving on to problems. */
  finish?: { label: string; message: string; onFinish: () => void };
};

export default function LessonTrack({
  lessons,
  storageKey,
  kicker,
  heading,
  label,
  finish,
}: Props) {
  const [initial] = useState(() => loadProgress(storageKey, lessons));
  const [[lessonIndex, pageIndex], setAt] = useState([
    initial.lesson,
    initial.page,
  ]);
  const [done, setDone] = useState<ReadonlySet<string>>(
    () => new Set(initial.done),
  );
  const lesson = lessons[lessonIndex];
  const page = lesson.pages[pageIndex];
  const [state, setState] = useState(() => startPage(page));
  const [feedback, setFeedback] = useState("");
  const status = statusOf(page, state);
  const pageKey = `${lessonIndex}.${pageIndex}`;
  const lastLesson = lessonIndex === lessons.length - 1;
  const lastPage = pageIndex === lesson.pages.length - 1;

  const idlePosition = useMemo(() => {
    const position = lessonPosition(page);
    // Paused hides the hover stone while marking dead stones.
    return page.kind === "removal" ? { ...position, paused: true } : position;
  }, [page]);
  const position =
    state.kind === "puzzle" ? state.puzzle.position : idlePosition;
  const marks = useMemo(() => lessonMarks(page), [page]);
  const dead = state.kind === "removal" ? state.dead : undefined;
  const readOnly =
    state.kind === "puzzle"
      ? status !== "playing" || state.puzzle.awaitingReply
      : state.kind === "removal"
        ? status === "correct"
        : true;

  useEffect(() => {
    if (status === "correct")
      setDone((current) =>
        current.has(pageKey) ? current : new Set([...current, pageKey]),
      );
  }, [status, pageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          lesson: lessonIndex,
          page: pageIndex,
          done: [...done],
        }),
      );
    } catch {
      // Progress just won't be remembered.
    }
  }, [lessonIndex, pageIndex, done]);

  // The opponent answers a moment after the learner's move.
  useEffect(() => {
    if (state.kind !== "puzzle" || !state.puzzle.awaitingReply) return;
    const timer = setTimeout(
      () =>
        setState((current) =>
          current.kind === "puzzle" && current.puzzle.awaitingReply
            ? { kind: "puzzle", puzzle: reply(current.puzzle) }
            : current,
        ),
      450,
    );
    return () => clearTimeout(timer);
  }, [state]);

  function go(lesson: number, page: number) {
    setAt([lesson, page]);
    setState(startPage(lessons[lesson].pages[page]));
    setFeedback("");
  }
  function previous() {
    if (pageIndex > 0) go(lessonIndex, pageIndex - 1);
    else if (lessonIndex > 0)
      go(lessonIndex - 1, lessons[lessonIndex - 1].pages.length - 1);
  }
  function next() {
    if (!lastPage) go(lessonIndex, pageIndex + 1);
    else if (!lastLesson) go(lessonIndex + 1, 0);
    else finish?.onFinish();
  }

  function place(point: number) {
    if (state.kind === "puzzle") {
      if (readOnly) return;
      try {
        setState({ kind: "puzzle", puzzle: answer(state.puzzle, point) });
        setFeedback("");
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Try another intersection.",
        );
      }
    } else if (state.kind === "removal" && !readOnly) {
      if (!position.board[point]) {
        setFeedback("Click a stone to mark its whole group as dead.");
        return;
      }
      const marked = new Set(state.dead);
      const marking = !marked.has(point);
      for (const stone of groupAt(position.board, point).stones)
        if (marking) marked.add(stone);
        else marked.delete(stone);
      setState({ kind: "removal", dead: marked });
      setFeedback("");
    }
  }

  const wronglyMarked =
    page.kind === "removal" &&
    state.kind === "removal" &&
    [...state.dead].some(
      (point) => !decodePoints(page.dead, pageSize(page)).includes(point),
    );
  const mentorMood =
    status === "correct"
      ? "success"
      : feedback || status === "wrong" || wronglyMarked
        ? "retry"
        : "lesson";
  const mentorMessage =
    status === "correct"
      ? `${PRAISE[(lessonIndex + pageIndex) % PRAISE.length]} ${
          lastPage && lastLesson
            ? (finish?.message ?? "That's the last page of the course.")
            : lastPage
              ? `That's the end of "${lesson.title}".`
              : "On to the next page when you're ready."
        }`
      : feedback ||
        (status === "wrong"
          ? page.kind === "choice"
            ? "Not quite. Count again, one point at a time."
            : "Not quite. That isn't the move. Reset the board and try again."
          : wronglyMarked
            ? "Those stones can still live. Click them again to put them back."
            : page.text || page.goal);

  const boardLabel =
    page.kind === "puzzle"
      ? `${colorName(playerColor(page))} to play`
      : page.kind === "choice"
        ? "Choose an answer"
        : page.kind === "removal"
          ? "Mark the dead stones"
          : "The game is over";
  const objective =
    status === "correct"
      ? lastPage
        ? "Lesson complete. Ready for the next?"
        : "Page complete. Ready for the next?"
      : status === "wrong"
        ? page.kind === "choice"
          ? "Pick another answer."
          : "Reset the board to try again."
        : page.kind === "choice"
          ? "Pick an answer."
          : page.kind === "action"
            ? `Press ${page.button}.`
            : page.kind === "removal"
              ? "Click a stone to mark its group; click again to undo."
              : `Play ${colorName(playerColor(page))} on the board.`;
  const doneInLesson = lesson.pages.filter((_, n) =>
    done.has(`${lessonIndex}.${n}`),
  ).length;

  return (
    <>
      <div className="study-heading">
        <div>
          <p className="study-kicker">{kicker}</p>
          <h1>
            {heading}
            <span>.</span>
          </h1>
        </div>
        <div className="study-level">
          <span className="study-level-symbol">基</span>
          <div>
            <span className="study-kicker">LESSON</span>
            <strong>
              {lessonIndex + 1} of {lessons.length}
              <small>{lesson.title}</small>
            </strong>
          </div>
        </div>
      </div>
      <div className="study-workspace">
        <section className="study-board-section" aria-label="Lesson board">
          <div className="study-board-heading">
            <span>
              <i
                className={
                  page.kind === "puzzle" && playerColor(page) === 1
                    ? "is-black"
                    : undefined
                }
              />{" "}
              {boardLabel.toUpperCase()}
            </span>
            <span>
              PAGE {pageIndex + 1} OF {lesson.pages.length}
            </span>
          </div>
          <div className="goban">
            <BoardCanvas
              position={position}
              coordinates
              readOnly={readOnly}
              region={page.bounds}
              marks={marks}
              dead={dead}
              description={page.goal}
              onPlay={place}
              onHover={() => {}}
            />
          </div>
          <p id="board-instructions" className="sr-only">
            Click an intersection, or use the arrow keys and Enter to place a
            stone.
          </p>
          <div className="study-board-tools">
            <span>Take your time. Every move teaches.</span>
            <Button variant="text" size="sm" onClick={() => go(lessonIndex, pageIndex)}>
              <RotateCcw size={14} /> Reset board
            </Button>
          </div>
        </section>
        <aside className="study-sidebar" aria-label="Lesson and goal">
          <div className="study-problem-meta">
            <span className="study-kicker">{label}</span>
            <span>
              {pad(lessonIndex + 1)}{" "}
              <span className="study-dim">/ {pad(lessons.length)}</span>
            </span>
          </div>
          <h2>{lesson.title}</h2>
          <p className="study-topic">{lesson.subtext}</p>
          <Panel as="div" className="study-explanation">
            <div className="study-note-label">
              {status === "correct" ? (
                <Check size={16} />
              ) : (
                <BookOpen size={16} />
              )}
              {status === "correct"
                ? "WELL PLAYED"
                : status === "wrong"
                  ? "NOT QUITE"
                  : "YOUR GOAL"}
            </div>
            <p>{page.goal}</p>
            {page.kind === "choice" && state.kind === "choice" && (
              <div className="study-choices" role="group" aria-label="Answers">
                {page.options.map((option) => (
                  <Button
                    type="button"
                    key={option}
                    aria-pressed={state.picked === option}
                    className={
                      state.picked === option
                        ? option === page.answer
                          ? "is-right"
                          : "is-wrong"
                        : undefined
                    }
                    onClick={() =>
                      status !== "correct" &&
                      setState({ kind: "choice", picked: option })
                    }
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
            {page.kind === "action" && (
              <Button
                type="button"
                variant="primary"
                className="study-action"
                disabled={status === "correct"}
                onClick={() => setState({ kind: "action", done: true })}
              >
                {page.button}
              </Button>
            )}
            <div className="study-objective">
              <span>{status === "correct" ? "✓" : "→"}</span>
              {objective}
            </div>
          </Panel>
          {page.id && <p className="study-page-id">{page.id}</p>}
          {page.issues && (
            <div className="study-issues" role="note">
              <strong>Needs review under Surround&apos;s rules</strong>
              <ul>
                {page.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="study-session">
            <div>
              <span className="study-kicker">THIS LESSON</span>
              <span>
                {doneInLesson} of {lesson.pages.length} done
              </span>
            </div>
            <div
              className="study-progress"
              aria-label={`${doneInLesson} of ${lesson.pages.length} pages done`}
            >
              {lesson.pages.map((_, n) => (
                <span
                  key={n}
                  className={
                    done.has(`${lessonIndex}.${n}`)
                      ? "is-complete"
                      : n === pageIndex
                        ? "is-current"
                        : ""
                  }
                />
              ))}
            </div>
            <ol className="study-lessons" aria-label="Lessons">
              {lessons.map((item, n) => {
                const finished = item.pages.every((_, p) =>
                  done.has(`${n}.${p}`),
                );
                return (
                  <li key={n}>
                    <Button
                      variant="text"
                      size="sm"
                      type="button"
                      aria-current={n === lessonIndex ? "step" : undefined}
                      onClick={() => go(n, 0)}
                    >
                      <span aria-hidden="true">
                        {finished ? <Check size={12} /> : pad(n + 1)}
                      </span>
                      {item.title}
                      {finished && <span className="sr-only"> (finished)</span>}
                    </Button>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </div>
      <MentorDialogue message={mentorMessage} mood={mentorMood} />
      <nav className="study-navigation" aria-label="Lesson navigation">
        <Button
          type="button"
          disabled={lessonIndex === 0 && pageIndex === 0}
          onClick={previous}
        >
          <ArrowLeft size={17} /> Previous
        </Button>
        <span>
          LESSON <strong>{pad(lessonIndex + 1)}</strong> · PAGE{" "}
          <strong>{pad(pageIndex + 1)}</strong> OF {pad(lesson.pages.length)}
        </span>
        <Button
          type="button"
          variant={status === "correct" ? "primary" : "secondary"}
          disabled={lastPage && lastLesson && !finish}
          onClick={next}
        >
          {lastPage && lastLesson && finish ? finish.label : "Next"}{" "}
          <ArrowRight size={17} />
        </Button>
      </nav>
    </>
  );
}
