import { useId, type ReactNode } from "react";

type DataScrollerProps = {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
};

export default function DataScroller({
  label,
  children,
  className = "",
  hint = "Scroll horizontally to inspect all columns.",
}: DataScrollerProps) {
  const hintId = `data-scroller-${useId().replace(/:/g, "")}`;

  return (
    <div className="data-scroller-frame">
      <div
        className={`data-scroller ${className}`.trim()}
        role="region"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={0}
      >
        {children}
      </div>
      <p id={hintId} className="data-scroller-hint">{hint}</p>
    </div>
  );
}
