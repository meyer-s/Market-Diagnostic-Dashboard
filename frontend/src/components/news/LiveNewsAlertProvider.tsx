import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";

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

type AlertCheck = { updated_at: string | null; alerts: AlertSnapshot };
type AlertLedger = {
  checkedAt: number;
  announcedAt: number;
  updatedAt?: string;
  alerts?: AlertSnapshot;
  seen: string[] | null;
  pending: string[];
};

const POLL_MS = 60_000;
const BATCH_MS = 5 * 60_000;
const BASELINE_AFTER_MS = 15 * 60_000;
const DATA_KEY = "live-news:site-alerts-data";
const ENABLED_KEY = "live-news:site-alerts";
export const DESKTOP_KEY = "live-news:desktop-alerts";
const EMPTY: AlertLedger = { checkedAt: 0, announcedAt: 0, seen: null, pending: [] };

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readLedger(): AlertLedger | undefined {
  try {
    const data = JSON.parse(readStorage(DATA_KEY) ?? "null");
    if (data && typeof data.checkedAt === "number" && typeof data.announcedAt === "number"
        && (data.seen === null || Array.isArray(data.seen)) && Array.isArray(data.pending)) return data;
  } catch {
    // A new session can rebuild the alert history.
  }
}

export function desktopEnabled() {
  return typeof Notification !== "undefined"
    && Notification.permission === "granted"
    && readStorage(DESKTOP_KEY) === "on";
}

function showDesktopAlert(headlines: AlertHeadline[]) {
  if (!desktopEnabled()) return false;
  const [first] = headlines;
  try {
    const notification = new Notification(
      headlines.length === 1 ? "High-relevance headline" : `${headlines.length} high-relevance headlines`,
      {
        body: `${first.score.toFixed(0)} relevance · ${first.title}`,
        tag: "live-news-relevance",
      },
    );
    notification.onclick = () => {
      window.focus();
      notification.close();
      window.location.assign("/news#live-news-alerts");
    };
    return true;
  } catch {
    return false;
  }
}

function updateLedger(current: AlertLedger, alerts: AlertSnapshot | undefined, now: number): AlertLedger {
  if (!alerts) return { ...current, checkedAt: now };
  const ids = alerts.headlines.map(({ id }) => id);
  if (!current.seen || now - current.checkedAt > BASELINE_AFTER_MS) {
    return { ...current, alerts, checkedAt: now, seen: ids, pending: [] };
  }
  const seen = new Set(current.seen);
  const pending = new Set(current.pending);
  return {
    ...current,
    alerts,
    checkedAt: now,
    seen: [...new Set([...seen, ...ids])].slice(-256),
    pending: ids.filter((id) => pending.has(id) || !seen.has(id)),
  };
}

type AlertContext = {
  alerts?: AlertSnapshot;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  publishFeed: (alerts: AlertSnapshot | undefined, updatedAt: string | null) => void;
};

const LiveNewsAlertContext = createContext<AlertContext | null>(null);

export function useLiveNewsAlerts() {
  return useContext(LiveNewsAlertContext);
}

export default function LiveNewsAlertProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => readStorage(ENABLED_KEY) !== "off");
  const [alerts, setAlerts] = useState(() => {
    const saved = readLedger();
    return saved && Date.now() - saved.checkedAt < BASELINE_AFTER_MS ? saved.alerts : undefined;
  });
  const [notice, setNotice] = useState<AlertHeadline[]>([]);
  const local = useRef<AlertLedger>(EMPTY);
  const active = useRef(enabled);
  const feedAt = useRef(0);

  const save = useCallback((ledger: AlertLedger) => {
    local.current = ledger;
    writeStorage(DATA_KEY, JSON.stringify(ledger));
  }, []);

  const deliver = useCallback((current: AlertLedger, now: number) => {
    if (!active.current || readStorage(ENABLED_KEY) === "off"
        || now - current.announcedAt < BATCH_MS || now - current.checkedAt > BASELINE_AFTER_MS
        || !current.pending.length) return current;
    const pending = current.alerts?.headlines.filter(({ id }) => current.pending.includes(id)) ?? [];
    if (!pending.length) return current;
    const inFocus = !document.hidden && document.hasFocus();
    if (inFocus) setNotice(pending);
    else if (!showDesktopAlert(pending)) return current;
    return { ...current, announcedAt: now, pending: [] };
  }, []);

  const apply = useCallback((alerts: AlertSnapshot | undefined, updatedAt: string | null, fromFeed = false) => {
    const commit = () => {
      if (!active.current || readStorage(ENABLED_KEY) === "off") return;
      const now = Date.now();
      const current = readLedger() ?? local.current;
      if (updatedAt && current.updatedAt && updatedAt < current.updatedAt) return;
      const changed = alerts && JSON.stringify(alerts) !== JSON.stringify(current.alerts);
      const next = fromFeed && !changed && now - current.checkedAt < POLL_MS / 2
        ? current
        : { ...updateLedger(current, updatedAt ? alerts : undefined, now), updatedAt: updatedAt ?? current.updatedAt };
      const delivered = deliver(next, now);
      if (delivered !== current) save(delivered);
      if (next !== current) setAlerts((previous) => changed ? next.alerts : previous ?? next.alerts);
    };
    const locks = navigator.locks;
    if (locks) return locks.request(DATA_KEY, commit);
    commit();
  }, [deliver, save]);

  const publishFeed = useCallback((snapshot: AlertSnapshot | undefined, updatedAt: string | null) => {
    if (!active.current || !snapshot || !updatedAt) return;
    feedAt.current = Date.now();
    void apply(snapshot, updatedAt, true)?.catch(() => undefined);
  }, [apply]);

  const setEnabled = useCallback((value: boolean) => {
    writeStorage(ENABLED_KEY, value ? "on" : "off");
    active.current = value;
    setEnabledState(value);
    if (!value) {
      feedAt.current = 0;
      setNotice([]);
      const reset = () => {
        const current = readLedger() ?? local.current;
        save({ ...current, checkedAt: 0, seen: null, pending: [] });
      };
      if (navigator.locks) void navigator.locks.request(DATA_KEY, reset).catch(() => undefined);
      else reset();
    }
  }, [save]);

  useEffect(() => {
    const deliverPending = () => {
      const commit = () => {
        const current = readLedger() ?? local.current;
        const next = deliver(current, Date.now());
        if (next !== current) save(next);
      };
      if (navigator.locks) void navigator.locks.request(DATA_KEY, commit).catch(() => undefined);
      else commit();
    };
    const sync = (event: StorageEvent) => {
      if (event.key === ENABLED_KEY || event.key === null) {
        const value = readStorage(ENABLED_KEY) !== "off";
        active.current = value;
        setEnabledState(value);
        if (!value) setNotice([]);
      }
      if (event.key === DATA_KEY) {
        const current = readLedger();
        if (current) {
          local.current = current;
          setAlerts(current.alerts);
          if (current.pending.length && !document.hidden && document.hasFocus()) deliverPending();
        }
      }
    };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", deliverPending);
    document.addEventListener("visibilitychange", deliverPending);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", deliverPending);
      document.removeEventListener("visibilitychange", deliverPending);
    };
  }, [deliver, save]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let lastAttempt = 0;
    const remaining = () => {
      const current = readLedger() ?? local.current;
      return POLL_MS - (Date.now() - Math.max(lastAttempt, feedAt.current, current.checkedAt));
    };
    const poll = async () => {
      let delay = POLL_MS;
      const check = async () => {
        const wait = remaining();
        if (wait > 0) {
          delay = wait;
          return;
        }
        if (controller.signal.aborted || readStorage(ENABLED_KEY) === "off") return;
        lastAttempt = Date.now();
        const response = await fetch("/live-news/alerts", {
          method: "POST",
          headers: { "X-Live-News": "1" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const snapshot = await response.json() as AlertCheck;
        if (!controller.signal.aborted) await apply(snapshot.alerts, snapshot.updated_at);
      };
      try {
        if (navigator.locks) {
          await navigator.locks.request(`${DATA_KEY}:poll`, { ifAvailable: true }, async (lock) => {
            if (lock) await check();
            else delay = 5_000;
          });
        } else {
          await check();
        }
      } catch {
        // A failed check can retry at the next scheduled interval.
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, delay);
      }
    };
    timer = window.setTimeout(poll, 2_000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [apply, enabled]);

  const [newest] = notice;
  const title = notice.length === 1 ? "High-relevance headline" : `${notice.length} high-relevance headlines`;

  return (
    <LiveNewsAlertContext.Provider value={{ alerts, enabled, setEnabled, publishFeed }}>
      {children}
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
            <Link className="text-xs font-semibold text-sky-200 underline underline-offset-4" to="/news#live-news-alerts" onClick={() => setNotice([])}>Review alerts</Link>
            <button type="button" className="field-button field-button-secondary" onClick={() => setNotice([])}>Dismiss</button>
          </div>
        </aside>
      )}
    </LiveNewsAlertContext.Provider>
  );
}
