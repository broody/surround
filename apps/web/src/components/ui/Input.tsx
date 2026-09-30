import { forwardRef, type InputHTMLAttributes } from "react";
import { classNames } from "./classNames";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props }, ref,
) {
  return <input ref={ref} className={classNames("ui-input", className)} {...props} />;
});

export default Input;
