import type { HTMLAttributes } from "react";
import { classNames } from "./classNames";

type StoneColor = "black" | "white" | 1 | 2;

export default function StoneDot({
  className,
  color,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "color"> & { color: StoneColor }) {
  return (
    <span
      aria-hidden="true"
      className={classNames(
        "stone-dot inline-block shrink-0 rounded-full",
        color === "black" || color === 1 ? "black" : "white",
        className,
      )}
      {...props}
    />
  );
}
