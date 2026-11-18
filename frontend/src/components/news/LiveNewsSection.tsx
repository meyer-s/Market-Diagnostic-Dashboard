import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../../utils/componentUtils";
import LiveNewsAlerts from "./LiveNewsAlerts";

const LiveNewsPanel = lazy(() => import("./LiveNewsPanel"));

export default function LiveNewsSection({ compact = false }: { compact?: boolean }) {
  const id = compact ? "dashboard-live-news" : "live-news";
  const storageKey = compact ? "live-news:dashboard" : "live-news:news";
  const [enabled, setEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) !== "off";
    } catch {
      return true;
    }
  });
  const [inViewport, setInViewport] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!enabled || !sectionRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setInViewport(entry.isIntersecting);
    });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [enabled]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setInViewport(false);
    try {
      window.localStorage.setItem(storageKey, next ? "on" : "off");
    } catch {
      // The toggle still works for this visit when storage is unavailable.
    }
  }

  return (
    <section ref={sectionRef} id={id} className="surface-card-strong p-4" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-base font-semibold text-stealth-100">Live news</h2>
        <div className="flex flex-wrap items-center gap-2">
          {compact && <Link className="field-button field-button-secondary" to="/news">Open News tab</Link>}
          <button
            type="button"
            aria-controls={`${id}-panel`}
            aria-expanded={enabled}
            onClick={toggle}
            className="field-button field-button-secondary"
          >
            {enabled ? "Turn off live news" : "Turn on live news"}
          </button>
        </div>
      </div>
      <LiveNewsAlerts compact={compact} />
      <div id={`${id}-panel`} hidden={!enabled}>
        {enabled && (
          <Suspense fallback={<div className="mt-4"><LoadingState message="Loading live news." /></div>}>
            <LiveNewsPanel compact={compact} inViewport={inViewport} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
