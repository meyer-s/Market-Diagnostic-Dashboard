import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

type DataScrollerProps = {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
  initialInlinePosition?: "start" | "end";
};

export default function DataScroller({
  label,
  children,
  className = "",
  hint = "Scroll horizontally to inspect all columns.",
  initialInlinePosition = "start",
}: DataScrollerProps) {
  const hintId = `data-scroller-${useId().replace(/:/g, "")}`;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const visibleHint = hint.trim();

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || initialInlinePosition !== "end") return;

    const frame = window.requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialInlinePosition]);

  return (
    <div className="data-scroller-frame">
      <div
        ref={scrollerRef}
        className={`data-scroller ${className}`.trim()}
        role="region"
        aria-label={label}
        aria-describedby={visibleHint ? hintId : undefined}
        tabIndex={0}
      >
        {children}
      </div>
      {visibleHint ? <p id={hintId} className="data-scroller-hint">{visibleHint}</p> : null}
    </div>
  );
}
