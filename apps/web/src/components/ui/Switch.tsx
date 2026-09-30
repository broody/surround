import type { ReactNode } from "react";
import Button, { type ButtonProps } from "./Button";

type SwitchProps = Omit<ButtonProps, "onChange" | "onClick" | "children" | "role" | "aria-checked"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
};

export default function Switch({ checked, onCheckedChange, children, ...props }: SwitchProps) {
  return (
    <Button variant="text" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
      {children}
      <span className="ui-switch-track" aria-hidden="true"><span /></span>
    </Button>
  );
}
