import { forwardRef, type ButtonHTMLAttributes } from "react";
import { classNames } from "./classNames";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "text"
  | "tab"
  | "card"
  | "board-point";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
) {
  return classNames(
    "ui-button",
    `ui-button--${variant}`,
    `ui-button--${size}`,
    className,
  );
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, type = "button", variant = "secondary", size = "md", ...props },
  ref,
) {
  return (
    <button
      type={type}
      ref={ref}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
});

export default Button;
