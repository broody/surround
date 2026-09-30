import { forwardRef, type SelectHTMLAttributes } from "react";
import { classNames } from "./classNames";

const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props }, ref,
) {
  return <select ref={ref} className={classNames("ui-select", className)} {...props} />;
});

export default Select;
