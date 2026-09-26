import { useId, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { play, SIZE } from "../game/rules";
import { createCaptureLesson, LESSON_TARGET } from "./captureLesson";

export default function FirstCapture() {
  const [position, setPosition] = useState(createCaptureLesson);
  const id = useId();
  const lessonAction = useRef<HTMLButtonElement>(null);
  const complete = position.captures[1] === 1;
  const capture = () => {
    if (!complete) {
      setPosition(play(position, LESSON_TARGET));
      // Keep keyboard focus in the lesson when the intersection becomes disabled.
      lessonAction.current?.focus({ preventScroll: true });
    }
  };
  return (
    <div className="first-capture" aria-labelledby={`${id}-title`}>
      <div className="lesson-heading">
        <span>YOUR FIRST LESSON</span>
        <span>01 / CAPTURE</span>
      </div>
      <h3 id={`${id}-title`}>One move. You’ve got this.</h3>
      <p>Fill the last empty point beside the black stone.</p>
      <div className="lesson-board">
        <svg
          viewBox="0 0 240 240"
          role="img"
          aria-label={
            complete
              ? "The black stone has been captured. Four white stones surround its empty intersection."
              : "A black stone has white neighbors above, below, and to its left. Its last liberty is the empty intersection on the right."
          }
        >
          <defs>
            <radialGradient id={`${id}-white`} cx="34%" cy="28%">
              <stop stopColor="#fff9e5" />
              <stop offset="0.65" stopColor="#e7dfcd" />
              <stop offset="1" stopColor="#aaa493" />
            </radialGradient>
            <radialGradient id={`${id}-black`} cx="34%" cy="28%">
              <stop stopColor="#506477" />
              <stop offset="0.5" stopColor="#233040" />
              <stop offset="1" stopColor="#0b1521" />
            </radialGradient>
          </defs>
          <rect width="240" height="240" fill="#d3aa6a" />
          {Array.from({ length: 5 }, (_, i) => (
            <g key={i} stroke="#79562d" strokeWidth="1">
              <path d={`M24 ${24 + i * 48}H216M${24 + i * 48} 24V216`} />
            </g>
          ))}
          <circle cx="120" cy="120" r="2.5" fill="#5c4126" />
          {Array.from({ length: 25 }, (_, i) => {
            const row = Math.floor(i / 5),
              col = i % 5;
            const stone = position.board[(row + 7) * SIZE + col + 7];
            if (!stone) return null;
            const x = 24 + col * 48,
              y = 24 + row * 48;
            return (
              <g key={i}>
                <ellipse
                  cx={x + 1}
                  cy={y + 3}
                  rx="16"
                  ry="14"
                  fill="#523d2860"
                />
                <circle
                  cx={x}
                  cy={y}
                  r="16"
                  fill={`url(#${id}-${stone === 1 ? "black" : "white"})`}
                />
              </g>
            );
          })}
        </svg>
        <button
          className={`lesson-target${complete ? " completed" : ""}`}
          aria-label={
            complete
              ? "Capture complete"
              : "Place a white stone on the highlighted intersection"
          }
          aria-describedby={`${id}-feedback`}
          disabled={complete}
          onClick={capture}
        >
          {!complete && <span aria-hidden="true">+</span>}
        </button>
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
      <button
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
      </button>
    </div>
  );
}
