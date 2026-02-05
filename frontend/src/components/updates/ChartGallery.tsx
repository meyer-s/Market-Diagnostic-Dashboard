import { useEffect, useState } from "react";

interface ChartGalleryProps {
  isOpen: boolean;
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

export default function ChartGallery({
  isOpen,
  urls,
  initialIndex,
  onClose,
}: ChartGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(initialIndex);
    }
  }, [initialIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || urls.length === 0) {
    return null;
  }

  const current = urls[Math.max(0, Math.min(activeIndex, urls.length - 1))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-2xl border border-stealth-700 bg-stealth-850 p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs text-stealth-400">
            Chart {activeIndex + 1} of {urls.length}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stealth-700 px-3 py-1.5 text-xs text-stealth-300 transition hover:border-stealth-600 hover:text-stealth-100"
          >
            Close
          </button>
        </div>
        <img
          src={current}
          alt={`Chart ${activeIndex + 1}`}
          className="max-h-[78vh] w-full rounded-xl border border-stealth-700 object-contain bg-stealth-900"
        />
        {urls.length > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setActiveIndex((prev) => (prev - 1 + urls.length) % urls.length)}
              className="rounded-lg border border-stealth-700 px-3 py-1.5 text-xs text-stealth-300 transition hover:border-stealth-600 hover:text-stealth-100"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((prev) => (prev + 1) % urls.length)}
              className="rounded-lg border border-stealth-700 px-3 py-1.5 text-xs text-stealth-300 transition hover:border-stealth-600 hover:text-stealth-100"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
