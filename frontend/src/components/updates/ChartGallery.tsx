import { useEffect, useRef, useState } from "react";

interface ChartGalleryProps {
  isOpen: boolean;
  urls: string[];
  initialIndex: number;
  title?: string;
  onClose: () => void;
}

export default function ChartGallery({
  isOpen,
  urls,
  initialIndex,
  title = "Recap charts",
  onClose,
}: ChartGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(Math.max(0, Math.min(initialIndex, urls.length - 1)));
    }
  }, [initialIndex, isOpen, urls.length]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.tabIndex >= 0);
      if (focusable.length === 0) {
        event.preventDefault();
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

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const hasCharts = urls.length > 0;
  const current = hasCharts
    ? urls[Math.max(0, Math.min(activeIndex, urls.length - 1))]
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close chart gallery"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-stealth-950/95"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-6xl rounded-2xl border border-stealth-700 bg-stealth-850 p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-chart-gallery-title"
        data-evidence-panel="recap-gallery"
        data-evidence-state={hasCharts ? "complete" : "empty"}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 id="recap-chart-gallery-title" className="text-sm font-semibold text-stealth-100">
              {title}
            </h2>
            <p className="mt-1 text-xs text-stealth-300">
              {hasCharts ? `Chart ${activeIndex + 1} of ${urls.length}` : "No chart snapshots"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-stealth-600 px-4 text-sm text-stealth-200 transition hover:border-stealth-400 hover:text-stealth-100"
          >
            Close
          </button>
        </div>
        {current ? (
          <img
            src={current}
            alt={`Chart ${activeIndex + 1} supporting ${title}`}
            className="max-h-[78vh] w-full rounded-xl border border-stealth-700 object-contain bg-stealth-900"
          />
        ) : (
          <div
            className="rounded-xl border border-stealth-700 bg-stealth-900 p-6 text-sm text-stealth-300"
            role="status"
          >
            This recap does not include chart snapshots. Its written analysis remains available in the
            recap reader.
          </div>
        )}
        {urls.length > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setActiveIndex((prev) => (prev - 1 + urls.length) % urls.length)}
              className="min-h-11 rounded-lg border border-stealth-600 px-4 text-sm text-stealth-200 transition hover:border-stealth-400 hover:text-stealth-100"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((prev) => (prev + 1) % urls.length)}
              className="min-h-11 rounded-lg border border-stealth-600 px-4 text-sm text-stealth-200 transition hover:border-stealth-400 hover:text-stealth-100"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
