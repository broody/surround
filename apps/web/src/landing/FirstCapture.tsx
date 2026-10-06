import { Button, Panel } from "../components/ui";
import { useId, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import BoardCanvas from "../game/BoardCanvas";
import { placement } from "../game/region";
import { play } from "../game/rules";
import {
  createCaptureLesson,
  LESSON_REGION,
  LESSON_TARGET,
} from "./captureLesson";

const noop = () => {};
const target = placement(LESSON_REGION, LESSON_TARGET);

export default function FirstCapture() {
  const [position, setPosition] = useState(createCaptureLesson);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const id = useId();
  const lessonAction = useRef<HTMLButtonElement>(null);
  const complete = position.captures[1] === 1;
  const capture = () => {
    if (!complete) {
      setPosition(play(position, LESSON_TARGET));
      // The target turns inert, so it may never see the pointer leave.
      setHovered(false);
      // Keep keyboard focus in the lesson when the intersection becomes disabled.
      lessonAction.current?.focus({ preventScroll: true });
    }
  };
  return (
    <Panel as="div" className="first-capture" aria-labelledby={`${id}-title`}>
      <div className="lesson-heading">
        <span>YOUR FIRST LESSON</span>
        <span>01 / CAPTURE</span>
      </div>
      <h3 id={`${id}-title`}>One move. You’ve got this.</h3>
      <p>Fill the last empty point beside the black stone.</p>
      <div className="lesson-board">
        <BoardCanvas
          position={position}
          coordinates={false}
          readOnly
          region={LESSON_REGION}
          description={
            complete
              ? "The black stone has been captured. Four white stones surround its empty intersection."
              : "A black stone has white neighbors above, below, and to its left. Its last liberty is the empty intersection on the right."
          }
          previewPoint={hovered || focused ? LESSON_TARGET : null}
          onPlay={noop}
          onHover={noop}
        />
        <Button
          variant="board-point"
          className={`lesson-target${complete ? " completed" : ""}`}
          style={{
            left: `${target.x * 100}%`,
            top: `${target.y * 100}%`,
            width: `${target.step * 100}%`,
          }}
          aria-label={
            complete
              ? "Capture complete"
              : "Place a white stone on the highlighted intersection"
          }
          aria-describedby={`${id}-feedback`}
          disabled={complete}
          onClick={capture}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={(event) =>
            setFocused(event.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setFocused(false)}
        >
          {!complete && <span aria-hidden="true">+</span>}
        </Button>
      </div>
      <p
        className={`lesson-feedback${complete ? " success" : ""}`}
        id={`${id}-feedback`}
        role="status"
      >
        {complete ? (
          <>
            <Check size={16} /> You captured a stone. That’s your first move.
          </>
        ) : (
          "Stones need breathing room. Fill every liberty to capture one."
        )}
      </p>
      <Button
        variant="text"
        className="lesson-action"
        ref={lessonAction}
        onClick={complete ? () => setPosition(createCaptureLesson()) : capture}
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
