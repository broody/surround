import { forwardRef, type AnchorHTMLAttributes } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./Button";

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { variant = "secondary", size = "md", className, ...props }, ref,
) {
  return <a ref={ref} className={buttonClasses(variant, size, className)} {...props} />;
});

export default LinkButton;
