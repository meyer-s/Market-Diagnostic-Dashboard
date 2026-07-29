import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type SupportingContextTooltipProps = {
  children?: ReactNode;
  text: ReactNode;
  id?: string;
  align?: "start" | "end";
  placement?: "top" | "bottom";
  className?: string;
};

const ALIGNMENT_CLASSES = {
  start: "left-0",
  end: "right-0",
} as const;

const PLACEMENT_CLASSES = {
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
} as const;

export default function SupportingContextTooltip({
  children,
  text,
  id,
  align = "start",
  placement = "top",
  className = "",
}: SupportingContextTooltipProps) {
  const generatedId = useId();
  const tooltipId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const showTooltip = () => {
    clearCloseTimer();
    setOpen(true);
  };

  const scheduleTooltipClose = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 120);
  };

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setOpen(false);
    };

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [open]);

  return (
    <div
      className={`relative inline-flex min-w-0 max-w-full items-start ${className}`.trim()}
    >
      {children}
      <span aria-hidden="true" className="ml-1 h-6 w-6 shrink-0" />
      <button
        type="button"
        aria-describedby={tooltipId}
        aria-label="Show supporting context"
        onMouseEnter={showTooltip}
        onMouseLeave={scheduleTooltipClose}
        onFocus={showTooltip}
        onBlur={scheduleTooltipClose}
        className="group/context-trigger absolute -right-2.5 -top-2.5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-transparent text-stealth-300 focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-stealth-600 bg-stealth-900 text-xs font-semibold leading-none transition-colors group-hover/context-trigger:border-stealth-400 group-hover/context-trigger:text-white group-focus-visible/context-trigger:border-sky-300 group-focus-visible/context-trigger:text-white group-focus-visible/context-trigger:ring-2 group-focus-visible/context-trigger:ring-sky-400 group-focus-visible/context-trigger:ring-offset-2 group-focus-visible/context-trigger:ring-offset-stealth-950"
        >
          i
        </span>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        data-tooltip-size="supporting"
        onMouseEnter={showTooltip}
        onMouseLeave={scheduleTooltipClose}
        className={`pointer-events-auto absolute z-50 w-64 max-w-[calc(100vw-2rem)] select-text rounded-lg border border-stealth-600 bg-stealth-950/98 px-3 py-2 text-left text-xs font-normal leading-4 normal-case tracking-normal text-stealth-100 shadow-[0_14px_44px_rgba(2,6,23,0.9)] backdrop-blur-xl sm:w-[17rem] ${ALIGNMENT_CLASSES[align]} ${PLACEMENT_CLASSES[placement]} ${open ? "block" : "hidden"}`}
      >
        {text}
      </span>
    </div>
  );
}
