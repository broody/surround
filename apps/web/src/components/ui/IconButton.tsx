import { forwardRef, type ButtonHTMLAttributes } from "react";
import { classNames } from "./classNames";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, label, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={classNames(
          "icon-button inline-flex items-center justify-center p-1 transition-colors",
          className,
        )}
        aria-label={label}
        {...props}
      />
    );
  },
);

export default IconButton;
