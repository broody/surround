import type { HTMLAttributes } from "react";
import { classNames } from "./classNames";

export default function Panel({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={classNames(
        "pixel-panel relative border border-[#72654b]",
        className,
      )}
      {...props}
    />
  );
}
