import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { formatDateTimeWithWeekday } from "../../utils/styleUtils";

type AlertHeadline = {
  id: string;
  title: string;
  url: string;
  published_at: string;
  source: string;
  score: number;
};

export type AlertSnapshot = {
  threshold: number;
  window_minutes: number;
  headlines: AlertHeadline[];
};

const SEEN_KEY = "live-news:seen-alerts";
const DESKTOP_KEY = "live-news:desktop-alerts";

function readSeen() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "null");
    if (Array.isArray(stored)) {
      return new Set<string>(stored.filter((id): id is string => typeof id === "string"));
    }
  } catch {
    // The current view can track alerts in memory when storage is unavailable.
  }
}

function desktopEnabled() {
  try {
    return typeof Notification !== "undefined"
      && Notification.permission === "granted"
      && localStorage.getItem(DESKTOP_KEY) === "on";
  } catch {
    return false;
  }
}

function showDesktopAlert(headlines: AlertHeadline[]) {
  const [first] = headlines;
  if (!first || !desktopEnabled() || (!document.hidden && document.hasFocus())) return;

  try {
    const notification = new Notification(
      headlines.length === 1 ? "High-relevance news" : `${headlines.length} high-relevance headlines`,
      { body: `${first.score.toFixed(0)} relevance · ${first.title}`, tag: `live-news:${first.id}` },
    );
    notification.onclick = () => {
      window.open(first.url, "_blank", "noopener,noreferrer");
      notification.close();
    };
  } catch {
    // Some browsers only support notifications from a service worker.
  }
}

export default function LiveNewsAlerts({
  alerts,
  ready,
  compact,
}: {
  alerts?: AlertSnapshot;
  ready: boolean;
  compact: boolean;
}) {
  const seen = useRef<Set<string>>();
  const [announced, setAnnounced] = useState<string[]>([]);
  const [desktop, setDesktop] = useState(desktopEnabled);
  const [desktopStatus, setDesktopStatus] = useState("");

  useEffect(() => {
    if (!alerts || !ready) return;

    const previous = seen.current ?? readSeen();
    const fresh = alerts.headlines.filter(({ id }) => !previous?.has(id));
    if (previous && fresh.length === 0) return;

    const next = [...(previous ?? []), ...fresh.map(({ id }) => id)].slice(-256);
    seen.current = new Set(next);
    try {
      sessionStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      // Continue tracking stories in memory.
    }

    if (previous && fresh.length) {
      setAnnounced(fresh.map(({ id }) => id));
      showDesktopAlert(fresh);
    }
  }, [alerts, ready]);

  useEffect(() => {
    const syncDesktop = (event: StorageEvent) => {
      if (event.key === DESKTOP_KEY || event.key === null) setDesktop(desktopEnabled());
    };
    window.addEventListener("storage", syncDesktop);
    return () => window.removeEventListener("storage", syncDesktop);
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

  if (!alerts) return null;
  const notices = alerts.headlines.filter(({ id }) => announced.includes(id));
  const [newest] = notices;
  const title = notices.length === 1 ? "High-relevance headline" : `${notices.length} high-relevance headlines`;

  return (
    <>
      <div className="sr-only" role="status">
        {newest ? `${title}. ${newest.title}. Relevance ${newest.score.toFixed(0)}.` : ""}
      </div>
      {newest && (
        <aside className="surface-card-strong fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm border-sky-400 p-4 shadow-xl" aria-label="Live news alert">
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-200">
            <Bell size={16} aria-hidden="true" />
            <p>{title} · {newest.score.toFixed(0)}</p>
          </div>
          <a className="mt-2 block text-sm font-semibold text-stealth-100 underline underline-offset-4" href={newest.url} target="_blank" rel="noopener noreferrer">
            {newest.title} <span className="sr-only">(opens in a new tab)</span>
          </a>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-stealth-300">{newest.source}</span>
            <button type="button" className="field-button field-button-secondary" onClick={() => setAnnounced([])}>Dismiss</button>
          </div>
        </aside>
      )}
      {(!compact || alerts.headlines.length > 0) && (
        <details className="surface-card-muted px-3 py-2 text-sm text-stealth-300">
          <summary className="min-h-8 cursor-pointer py-1 font-semibold text-stealth-100">
            Relevance alerts · {alerts.headlines.length}
          </summary>
          <p className="mb-2 text-xs">Headlines above {alerts.threshold} on your weights from the last {alerts.window_minutes / 60} hours.</p>
          {alerts.headlines.length > 0 && (
            <ul className="mb-2 space-y-2">
              {alerts.headlines.map((headline) => (
                <li key={headline.id} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-semibold tabular-nums text-sky-200"><span className="sr-only">Relevance </span>{headline.score.toFixed(0)}</span>
                  <div className="min-w-0">
                    <a className="break-words text-stealth-100 hover:underline focus-visible:underline" href={headline.url} target="_blank" rel="noopener noreferrer">
                      {headline.title} <span className="sr-only">(opens in a new tab)</span>
                    </a>
                    <p className="mt-0.5 text-xs">{headline.source} · <time dateTime={headline.published_at}>{formatDateTimeWithWeekday(headline.published_at)} ET</time></p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!compact && typeof Notification !== "undefined" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" className="field-button field-button-secondary" onClick={() => void toggleDesktop()}>
                {desktop ? "Turn off desktop alerts" : "Enable desktop alerts"}
              </button>
              <p className="text-xs">While Live News is open in the background.</p>
              {desktopStatus && <p role="status" className="basis-full text-xs text-amber-200">{desktopStatus}</p>}
            </div>
          )}
        </details>
      )}
    </>
  );
}
