import type { ButtonHTMLAttributes } from "react";
import { classNames } from "./classNames";

type ButtonVariant = "primary" | "secondary" | "text";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "pixel-button primary",
  secondary: "pixel-button",
  text: "text-button",
};

export default function Button({
  className,
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames(
        "inline-flex items-center disabled:cursor-not-allowed disabled:opacity-40",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
