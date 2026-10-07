import { Button, Panel } from "../components/ui";
import { useId, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import BoardCanvas from "../game/BoardCanvas";
import type { Position } from "../game/rules";
import {
  createCaptureLesson,
  LESSON_REGION,
  LESSON_TARGET,
  tryCapture,
} from "./captureLesson";

type Attempt =
  | { kind: "ready" }
  | { kind: "missed"; point: number; position: Position }
  | { kind: "captured"; position: Position };

const lesson = createCaptureLesson();
const noop = () => {};

export default function FirstCapture() {
  const [attempt, setAttempt] = useState<Attempt>({ kind: "ready" });
  // Why a stone couldn't go down; the board keeps the last try meanwhile.
  const [refusal, setRefusal] = useState("");
  const id = useId();
  const lessonAction = useRef<HTMLButtonElement>(null);
  const complete = attempt.kind === "captured";
  const place = (point: number) => {
    if (complete) return;
    try {
      const { position, captured } = tryCapture(point);
      setAttempt(
        captured
          ? { kind: "captured", position }
          : { kind: "missed", point, position },
      );
      setRefusal("");
      // The board turns read-only once the stone is taken, and drops focus.
      if (captured) lessonAction.current?.focus({ preventScroll: true });
    } catch (error) {
      setRefusal(
        error instanceof Error ? error.message : "Try another intersection.",
      );
    }
  };
  return (
    <Panel as="div" className="first-capture" aria-labelledby={`${id}-title`}>
      <div className="lesson-heading">
        <span>YOUR FIRST LESSON</span>
        <span>01 / CAPTURE</span>
      </div>
      <h3 id={`${id}-title`}>White to capture</h3>
      <div className="lesson-board">
        <BoardCanvas
          position={"position" in attempt ? attempt.position : lesson}
          coordinates={false}
          readOnly={complete}
          region={LESSON_REGION}
          marks={
            attempt.kind === "missed"
              ? [{ point: attempt.point, kind: "cross" }]
              : undefined
          }
          description="The black stone has been captured. Four white stones surround its empty intersection."
          interactionLabel="White to capture. A black stone in the center has white stones above, below and to its left. Use arrow keys to select an intersection and Enter to place a stone."
          onPlay={place}
          onHover={noop}
        />
      </div>
      <p id="board-instructions" className="sr-only">
        Click an intersection, or use the arrow keys and Enter to place a
        stone.
      </p>
      <p
        className={`lesson-feedback${complete ? " success" : refusal || attempt.kind === "missed" ? " retry" : ""}`}
        role="status"
      >
        {complete ? (
          <>
            <Check size={16} /> You captured a stone. That’s your first move.
          </>
        ) : refusal ? (
          refusal
        ) : attempt.kind === "missed" ? (
          <>
            <X size={16} /> Not quite. Black can still breathe. Try another
            point.
          </>
        ) : (
          "Stones need breathing room. Fill every liberty to capture one."
        )}
      </p>
      <Button
        variant="text"
        className="lesson-action"
        ref={lessonAction}
        onClick={() =>
          complete ? setAttempt({ kind: "ready" }) : place(LESSON_TARGET)
        }
      >
        {complete ? (
          <>
            <RotateCcw size={14} /> Try it again
          </>
        ) : (
          <>
            Show me the capture <span aria-hidden="true">→</span>
          </>
        )}
      </Button>
    </Panel>
  );
}
