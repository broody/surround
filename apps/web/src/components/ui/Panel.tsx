import type { HTMLAttributes } from "react";
import { classNames } from "./classNames";

export default function Panel({
  className,
  as: Component = "section",
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "aside" | "div" }) {
  return (
    <Component
      className={classNames("ui-panel", className)}
      {...props}
    />
  );
}
