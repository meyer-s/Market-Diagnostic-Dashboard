import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { formatDateTimeWithWeekday } from "../../utils/styleUtils";
import { DESKTOP_KEY, desktopEnabled, useLiveNewsAlerts } from "./LiveNewsAlertProvider";

export default function LiveNewsAlerts({ compact }: { compact: boolean }) {
  const service = useLiveNewsAlerts();
  const location = useLocation();
  const details = useRef<HTMLDetailsElement>(null);
  const [desktop, setDesktop] = useState(desktopEnabled);
  const [desktopStatus, setDesktopStatus] = useState("");

  useEffect(() => {
    if (compact || location.hash !== "#live-news-alerts" || !details.current) return;
    details.current.open = true;
    const frame = window.requestAnimationFrame(() => {
      details.current?.scrollIntoView({ block: "start" });
      details.current?.querySelector("summary")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compact, location.hash, location.key]);

  useEffect(() => {
    const syncDesktop = () => setDesktop(desktopEnabled());
    window.addEventListener("storage", syncDesktop);
    window.addEventListener("focus", syncDesktop);
    return () => {
      window.removeEventListener("storage", syncDesktop);
      window.removeEventListener("focus", syncDesktop);
    };
  }, []);

  async function toggleDesktop() {
    setDesktopStatus("");
    try {
      if (desktop) {
        localStorage.removeItem(DESKTOP_KEY);
        setDesktop(false);
        return;
      }
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") {
        setDesktopStatus("Allow notifications for this site in your browser to enable desktop alerts.");
        return;
      }
      localStorage.setItem(DESKTOP_KEY, "on");
      setDesktop(true);
    } catch {
      setDesktopStatus("Desktop alerts are unavailable in this browser.");
    }
  }

  if (!service || (compact && !service.alerts?.headlines.length)) return null;
  const { alerts, enabled, setEnabled } = service;

  return (
    <details ref={details} id={compact ? undefined : "live-news-alerts"} className="surface-card-muted mt-3 scroll-mt-24 px-3 py-2 text-sm text-stealth-300">
      <summary className="min-h-8 cursor-pointer py-1 font-semibold text-stealth-100">
        Relevance alerts{alerts ? " · " + alerts.headlines.length : ""}
      </summary>
      {alerts && (
        <p className="mb-2 text-xs">
          Headlines above {alerts.threshold} on your weights from the last {alerts.window_minutes / 60} hours.
        </p>
      )}
      {alerts && alerts.headlines.length > 0 && (
        <ul className="mb-2 space-y-2">
          {alerts.headlines.map((headline) => (
            <li key={headline.id} className="flex items-baseline gap-2">
              <span className="shrink-0 font-semibold tabular-nums text-sky-200"><span className="sr-only">Relevance </span>{headline.score.toFixed(0)}</span>
              <div className="min-w-0">
                <a className="break-words text-stealth-100 hover:underline focus-visible:underline" href={headline.url} target="_blank" rel="noopener noreferrer">
                  {headline.title} <span className="sr-only">(opens in a new tab)</span>
                </a>
                <p className="mt-0.5 text-xs">{headline.source} · <time dateTime={headline.published_at}>{formatDateTimeWithWeekday(headline.published_at)} ET</time></p>
                {headline.report_label && <p className="mt-0.5 text-xs font-semibold text-amber-200">Raw · {headline.report_label}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <div className="space-y-2 pt-1">
          <p className="text-xs">New matches are grouped into at most one alert every five minutes while a site tab is open.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="field-button field-button-secondary" onClick={() => setEnabled(!enabled)}>
              {enabled ? "Pause site-wide alerts" : "Resume site-wide alerts"}
            </button>
            {typeof Notification !== "undefined" && (
              <button type="button" className="field-button field-button-secondary" onClick={() => void toggleDesktop()}>
                {desktop ? "Turn off desktop alerts" : "Enable desktop alerts"}
              </button>
            )}
          </div>
          {desktopStatus && <p role="status" className="text-xs text-amber-200">{desktopStatus}</p>}
        </div>
      )}
    </details>
  );
}
