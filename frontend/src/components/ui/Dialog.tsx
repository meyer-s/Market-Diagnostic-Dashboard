import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type DialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  closeOnBackdrop?: boolean;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function Dialog({
  open,
  title,
  onClose,
  children,
  description,
  footer,
  className = "",
  initialFocusRef,
  closeOnBackdrop = true,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = `dialog-title-${useId().replace(/:/g, "")}`;
  const descriptionId = `dialog-description-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (!open) return undefined;

    const priorFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const requested = initialFocusRef?.current;
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (requested ?? firstFocusable ?? dialogRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      priorFocus?.focus();
    };
  }, [initialFocusRef, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="field-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.currentTarget === event.target) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`field-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="field-dialog-header">
          <div>
            <h2 id={titleId} className="field-dialog-title">{title}</h2>
            {description ? (
              <p id={descriptionId} className="field-dialog-description">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="field-icon-button"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="field-dialog-body">{children}</div>
        {footer ? <footer className="field-dialog-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
