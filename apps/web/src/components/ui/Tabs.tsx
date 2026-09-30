import type { HTMLAttributes } from "react";
import Button, { type ButtonProps } from "./Button";
import { classNames } from "./classNames";

export function TabList({ className, onKeyDown, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={classNames("ui-tabs", className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
        const current = tabs.indexOf(event.target as HTMLButtonElement);
        if (current < 0) return;
        const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : delta ? (current + delta + tabs.length) % tabs.length : -1;
        if (index < 0) return;
        event.preventDefault();
        tabs[index].focus();
        tabs[index].click();
      }}
      {...props}
    />
  );
}

export function Tab({ selected, ...props }: Omit<ButtonProps, "variant"> & { selected: boolean }) {
  return <Button variant="tab" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} size="sm" {...props} />;
}
