import { forwardRef, type DialogHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";
import { classNames } from "./classNames";

type DialogProps = DialogHTMLAttributes<HTMLDialogElement> & {
  children: ReactNode;
  onCloseRequest: () => void;
  wide?: boolean;
};

const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  { children, className, onCloseRequest, wide = false, ...props },
  ref,
) {
  return (
    <dialog
      ref={ref}
      className={classNames(
        "game-dialog pixel-panel m-auto max-h-[85svh] w-[calc(100%_-_40px)] overflow-auto",
        wide && "mode-dialog",
        className,
      )}
      onCancel={onCloseRequest}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRequest();
      }}
      {...props}
    >
      <div className="dialog-content relative">
        <IconButton
          className="dialog-close absolute right-4 top-4"
          label="Close dialog"
          onClick={onCloseRequest}
        >
          <X size={20} />
        </IconButton>
        {children}
      </div>
    </dialog>
  );
});

export default Dialog;
