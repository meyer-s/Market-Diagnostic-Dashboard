import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../../utils/componentUtils";

const LiveNewsPanel = lazy(() => import("./LiveNewsPanel"));

export default function LiveNewsSection({ compact = false }: { compact?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const id = compact ? "dashboard-live-news" : "live-news";

  return (
    <section id={id} className="surface-card-strong p-4" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-base font-semibold text-stealth-100">Live news</h2>
        <div className="flex flex-wrap items-center gap-2">
          {compact && <Link className="field-button field-button-secondary" to="/news">Open News tab</Link>}
          <button
            type="button"
            aria-controls={`${id}-panel`}
            aria-expanded={enabled}
            onClick={() => setEnabled((current) => !current)}
            className="field-button field-button-secondary"
          >
            {enabled ? "Turn off live news" : "Turn on live news"}
          </button>
        </div>
      </div>
      <div id={`${id}-panel`} hidden={!enabled}>
        {enabled && (
          <Suspense fallback={<div className="mt-4"><LoadingState message="Loading live news." /></div>}>
            <LiveNewsPanel compact={compact} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
