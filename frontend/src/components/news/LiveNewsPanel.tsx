import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../utils/componentUtils";
import { formatDateTimeWithWeekday } from "../../utils/styleUtils";
import { Dialog, FormField, SegmentedControl } from "../ui";
import { useLiveNewsAlerts, type AlertSnapshot } from "./LiveNewsAlertProvider";

const LIVE_PATH = "/live-news";
const REFRESH_MS = 5_000;
const ACTIVITY_MS = 20_000;
const BACKGROUND_MS = 60_000;
const RETRY_MS = 15_000;
const HOME_HEADLINE_LIMIT = 6;
const HOVER_DELAY_MS = 180;
const BUTTON = "field-button field-button-secondary disabled:cursor-not-allowed disabled:opacity-50";
type View = "focused" | "all";
const VIEWS: { value: View; label: string }[] = [
  { value: "focused", label: "Focused" },
  { value: "all", label: "All News" },
];
const TOPIC_COLORS: Record<string, string> = {
  releases: "[--live-news-topic:theme(colors.emerald.400)]",
  markets: "[--live-news-topic:theme(colors.sky.400)]",
  metals: "[--live-news-topic:theme(colors.amber.400)]",
  crypto: "[--live-news-topic:theme(colors.violet.400)]",
  world: "[--live-news-topic:theme(colors.rose.400)]",
  tech: "[--live-news-topic:theme(colors.cyan.400)]",
  energy: "[--live-news-topic:theme(colors.orange.400)]",
  general: "[--live-news-topic:theme(colors.slate.400)]",
};
const PRIORITY = {
  Top: { bars: 3, fade: "", color: "text-emerald-400" },
  High: { bars: 2, fade: "opacity-90", color: "text-sky-400" },
  Standard: { bars: 1, fade: "opacity-75", color: "text-stealth-300" },
};

type Article = {
  id: string;
  title: string;
  url: string;
  published_at: string;
  source: string;
  topic: string;
  priority: keyof typeof PRIORITY;
  score: number;
  reasons: string[];
  summary: string;
  cached: boolean;
};

type Snapshot = {
  updated_at: string | null;
  checked_label: string | null;
  read_interval: number;
  topics: Record<string, string>;
  page: number;
  pages: number;
  total: number;
  first: number;
  last: number;
  sources: { name: string; url: string; state: string; last_item: string | null; error: string }[];
  articles: Article[];
  featured: Article[];
  alerts?: AlertSnapshot;
};

type WeightSettings = {
  token: string;
  weights: Record<string, number>;
  focus: string;
  topics: Record<string, string>;
  weight_levels: string[];
  focus_levels: Record<string, string>;
};

type Preview = { text: string; origin: string };

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`${LIVE_PATH}${path}`, options);
  if (!response.ok) throw new Error(String(response.status));
  return response;
}

function HeadlineDetails({ article, expanded, featured }: { article: Article; expanded: boolean; featured: boolean }) {
  const { id, priority, summary } = article;
  const hasExcerpt = priority === "Top" && !(featured && summary);
  const [preview, setPreview] = useState<Preview>();
  useEffect(() => {
    if (!expanded || !hasExcerpt || summary || preview) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await request(`/preview?${new URLSearchParams({ id })}`, { signal: controller.signal });
        setPreview(await response.json() as Preview);
      } catch {
        if (!controller.signal.aborted) setPreview({ text: "Preview unavailable. Open the headline for the full story.", origin: "" });
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [expanded, hasExcerpt, id, preview, summary]);

  return (
    <div className="mb-0.5 mt-2 min-h-11 max-w-3xl space-y-1.5 border-t border-stealth-700 pt-2.5 text-xs text-stealth-300">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold text-stealth-100">{priority} priority · Relevance {article.score}</span>
        {article.reasons.length > 0 && <span>{article.reasons.join(" · ")}</span>}
      </p>
      {hasExcerpt && (
        <div className="space-y-1.5">
          <p className="text-sm leading-relaxed text-stealth-100">{summary || preview?.text || "Loading article preview…"}</p>
          {(summary || preview?.origin) && (
            <p>{summary ? "Official release" : preview?.origin}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Headline({ article, topic, featured = false }: { article: Article; topic: string; featured?: boolean }) {
  const { bars, fade, color } = PRIORITY[article.priority];
  const topicColor = TOPIC_COLORS[article.topic] ?? TOPIC_COLORS.general;
  const Title = featured ? "h4" : "h3";
  const detailsId = useId();
  const [disclosure, setDisclosure] = useState<"closed" | "hover" | "open">("closed");
  const hoverTimer = useRef<number>();
  const expanded = disclosure !== "closed";

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  function closeHover() {
    window.clearTimeout(hoverTimer.current);
    setDisclosure((current) => current === "hover" ? "closed" : current);
  }

  return (
    <article
      className={`group/row relative py-2.5 pl-6 pr-3 ${topicColor} ${featured ? "surface-card-muted" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        hoverTimer.current = window.setTimeout(() => {
          setDisclosure((current) => current === "closed" ? "hover" : current);
        }, HOVER_DELAY_MS);
      }}
      onPointerLeave={closeHover}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-2.5 left-1 w-5 overflow-hidden">
          <span
            className={`flex min-h-11 w-full items-center justify-center rounded-l-md bg-[var(--live-news-topic)] py-1 transition-transform motion-reduce:transition-none ${expanded ? "duration-200 ease-out" : "translate-x-full duration-150 ease-in"}`}
          >
            <span className="rotate-180 whitespace-nowrap text-xs font-bold leading-none text-slate-950 [writing-mode:vertical-rl]">{topic}</span>
          </span>
        </div>
        <button
          type="button"
          className="field-icon-button !border-[var(--live-news-topic)]"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${article.priority} priority · ${topic} · ${article.priority === "Top" && !featured ? "Article preview" : "Headline details"}`}
          onClick={() => {
            window.clearTimeout(hoverTimer.current);
            setDisclosure((current) => current === "closed" ? "open" : "closed");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && expanded) {
              window.clearTimeout(hoverTimer.current);
              setDisclosure("closed");
            }
          }}
        >
          <span aria-hidden="true" className={`flex h-4 items-end gap-0.5 ${color}`}>
            {[1, 2, 3].map((bar) => (
              <span key={bar} className={`w-[3px] rounded-sm bg-current ${bar <= bars ? "" : "opacity-25"}`} style={{ height: bar * 4 + 2 }} />
            ))}
          </span>
        </button>
        <div className="min-w-0 flex-1 self-center">
          <div className={`space-y-1 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none ${expanded ? "" : fade}`}>
            <Title className="break-words text-sm font-semibold leading-snug text-stealth-100 sm:text-base">
              <a className="hover:underline focus-visible:underline" href={article.url} target="_blank" rel="noopener noreferrer">
                {article.title}<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Title>
            <p className="flex flex-wrap gap-x-2 text-xs text-stealth-300">
              <span className="sr-only">{topic}</span>
              <span>{article.source}</span>
              <time dateTime={article.published_at}>{formatDateTimeWithWeekday(article.published_at)} ET</time>
              {article.cached && <span>Cached</span>}
            </p>
            {featured && article.summary && <p className="text-sm leading-relaxed text-stealth-200">{article.summary}</p>}
          </div>
          <div
            id={detailsId}
            aria-hidden={!expanded}
            className={`collapsible-panel ${expanded ? "collapsible-panel-open" : ""}`}
          >
            <div className="collapsible-panel-inner">
              <HeadlineDetails article={article} expanded={expanded} featured={featured} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function WeightsEditor({ close, onSaved }: { close: () => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<WeightSettings>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request("/weights", { signal: controller.signal })
      .then(async (response) => setSettings(await response.json() as WeightSettings))
      .catch(() => {
        if (!controller.signal.aborted) setError("Live news weights could not be loaded. Reopen the dialog to try again.");
      });
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving) return;
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    const body = new URLSearchParams({ token: settings.token });
    data.forEach((value, key) => body.set(key, String(value)));
    setSaving(true);
    setError("");
    try {
      await request("/weights", { method: "POST", body });
      onSaved();
    } catch {
      setError("Live news weights could not be saved. Reopen the dialog to renew the settings and try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog open title="Live news weights" onClose={close} description="Topic weights set personal relevance scores for Focused news and alerts. Focus strength controls which headlines appear in Focused.">
      {error && <ErrorState message={error} />}
      {settings ? (
        <form onSubmit={save} className="space-y-4">
          <FormField label="Focus strength">
            <select className="px-3 text-sm" name="focus" defaultValue={settings.focus}>
              {Object.entries(settings.focus_levels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(settings.topics).map(([key, label]) => (
              <FormField key={key} label={label}>
                <select className="px-3 text-sm" name={key} defaultValue={settings.weights[key]}>
                  {settings.weight_levels.map((level, index) => <option key={level} value={index}>{level}</option>)}
                </select>
              </FormField>
            ))}
          </div>
          <div className="field-dialog-footer">
            <button type="submit" className="field-button field-button-primary disabled:opacity-50" disabled={saving}>
              {saving ? "Saving…" : "Save weights"}
            </button>
            <button type="submit" className={BUTTON} name="reset" value="1" disabled={saving}>Reset defaults</button>
          </div>
        </form>
      ) : !error && <LoadingState message="Loading your live news weights." />}
    </Dialog>
  );
}

export default function LiveNewsPanel({ compact = false, inViewport }: { compact?: boolean; inViewport: boolean }) {
  const [view, setView] = useState<View>(compact ? "focused" : "all");
  const [topic, setTopic] = useState("");
  const [when, setWhen] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [showWeights, setShowWeights] = useState(false);
  const [result, setResult] = useState<{ query: string; data: Snapshot }>();
  const [failedQuery, setFailedQuery] = useState<string>();
  const [windowFocused, setWindowFocused] = useState(() => !document.hidden && document.hasFocus());
  const publishFeed = useLiveNewsAlerts()?.publishFeed;
  const foreground = inViewport && windowFocused;
  const nextActivity = useRef({ foreground: 0, background: 0 });
  const previousTarget = useRef<string>();
  const closeWeights = useCallback(() => setShowWeights(false), []);
  const feedQuery = new URLSearchParams({ view, topic }).toString();
  const query = new URLSearchParams({ view, topic, when, q: search, page: String(page) }).toString();
  const latestSnapshot = result?.data;
  const data = result?.query === query ? latestSnapshot : undefined;
  const topics = latestSnapshot?.topics ?? {};
  const error = failedQuery === query;
  const articles = data?.articles.slice(0, compact ? HOME_HEADLINE_LIMIT - data.featured.length : undefined) ?? [];

  useEffect(() => {
    const updateFocus = () => setWindowFocused(!document.hidden && document.hasFocus());
    window.addEventListener("focus", updateFocus);
    window.addEventListener("blur", updateFocus);
    document.addEventListener("visibilitychange", updateFocus);
    updateFocus();
    return () => {
      window.removeEventListener("focus", updateFocus);
      window.removeEventListener("blur", updateFocus);
      document.removeEventListener("visibilitychange", updateFocus);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const mode = foreground ? "foreground" : "background";
    const interval = foreground ? ACTIVITY_MS : BACKGROUND_MS;
    let timer: number | undefined;
    const renew = () => {
      if (controller.signal.aborted) return;
      const now = Date.now();
      const remaining = nextActivity.current[mode] - now;
      if (remaining > 0) {
        timer = window.setTimeout(renew, remaining);
        return;
      }
      nextActivity.current[mode] = now + interval;
      void request("/activity", {
        method: "POST",
        headers: { "X-Live-News": "1", "X-Live-News-Mode": mode },
        signal: controller.signal,
      }).catch(() => undefined);
      timer = window.setTimeout(renew, interval);
    };
    if (foreground || nextActivity.current.foreground || nextActivity.current.background) {
      queueMicrotask(renew);
    } else {
      timer = window.setTimeout(renew, BACKGROUND_MS);
    }
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [foreground]);

  useEffect(() => {
    const controller = new AbortController();
    const interval = foreground ? REFRESH_MS : BACKGROUND_MS;
    const target = `${query}#${revision}`;
    const viewChanged = previousTarget.current !== undefined && previousTarget.current !== target;
    previousTarget.current = target;
    let timer: number | undefined;
    const refresh = async () => {
      if (controller.signal.aborted) return;
      let delay = interval;
      try {
        const response = await request(`/snapshot?${query}`, { signal: controller.signal });
        const snapshot = await response.json() as Snapshot;
        if (controller.signal.aborted) return;
        setResult({ query, data: snapshot });
        publishFeed?.(snapshot.alerts, snapshot.updated_at);
        setFailedQuery(undefined);
        delay = Math.max(interval, snapshot.read_interval * 1000);
      } catch {
        if (!controller.signal.aborted) setFailedQuery(query);
        delay = Math.max(interval, RETRY_MS);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, delay);
      }
    };
    if (foreground || viewChanged) {
      void refresh();
    } else {
      timer = window.setTimeout(refresh, interval);
    }
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [foreground, publishFeed, query, revision]);

  const topicField = (
    <FormField label="Topic">
      <select value={topic} onChange={(event) => { setTopic(event.target.value); setPage(1); }} className="min-w-0 px-3 text-sm">
        <option value="">All topics</option>
        {Object.entries(topics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </FormField>
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <SegmentedControl label="Live news view" options={VIEWS} value={view} onChange={(value) => { setView(value); setPage(1); }} />
          {compact && <div className="w-full sm:w-44">{topicField}</div>}
        </div>
        {compact ? (
          <p className="pb-1 text-xs tabular-nums text-stealth-300">
            Last updated{" "}
            {latestSnapshot?.checked_label
              ? <time dateTime={latestSnapshot.updated_at ?? undefined}>{latestSnapshot.checked_label}</time>
              : "—"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} onClick={() => setRevision((value) => value + 1)}>Refresh live news</button>
            <button type="button" className={BUTTON} onClick={() => setShowWeights(true)}>Weights</button>
            <a className={BUTTON} href={`${LIVE_PATH}/rss.xml?${feedQuery}`}>RSS feed</a>
          </div>
        )}
      </div>
      {!compact && <form
        className="surface-card-muted grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(String(new FormData(event.currentTarget).get("search")).trim());
          setPage(1);
        }}
      >
        {topicField}
        <FormField label="Published">
          <select value={when} onChange={(event) => { setWhen(event.target.value); setPage(1); }} className="min-w-0 px-3 text-sm">
            <option value="">Any recent date</option>
            <option value="24h">Last 24 hours</option>
            <option value="72h">Last 72 hours</option>
          </select>
        </FormField>
        <FormField label="Search live headlines">
          <input name="search" type="search" maxLength={120} className="min-w-0 px-3 text-sm" />
        </FormField>
        <button type="submit" className={BUTTON}>Search</button>
      </form>}

      {showWeights && <WeightsEditor close={closeWeights} onSaved={() => { closeWeights(); setRevision((value) => value + 1); }} />}

      {error && <ErrorState message={data ? "Live updates are delayed. Showing the last loaded snapshot." : "Live news could not be loaded. It will retry automatically."} />}
      {!data && !error && <LoadingState message="Loading live headlines." />}
      {data && (
        <>
          {!compact && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-stealth-300">
              <span>{data.total
                ? `${data.first}–${data.last} of ${data.total.toLocaleString()} ${data.featured.length ? "other headlines" : "headlines"}`
                : "0 matching headlines"}
              </span>
              <span>{data.checked_label ? <>Feed snapshot <time dateTime={data.updated_at ?? undefined}>{data.checked_label}</time></> : "Waiting for the collector"} · {foreground ? `Updates every ${data.read_interval}s` : "Updates every minute"}</span>
            </div>
          )}
          {data.featured.length > 0 && (
            <section className="space-y-2" aria-labelledby="live-news-releases">
              <h3 id="live-news-releases" className="text-sm font-semibold text-stealth-100">Key releases</h3>
              {data.featured.map((article) => <Headline key={article.id} article={article} topic={topics[article.topic]} featured />)}
            </section>
          )}
          {articles.length > 0 ? (
            <ul aria-label="Live headlines" className="surface-card-muted divide-y divide-stealth-800">
              {articles.map((article) => (
                <li key={article.id}><Headline article={article} topic={topics[article.topic]} /></li>
              ))}
            </ul>
          ) : data.featured.length === 0 && (
            <EmptyState message={data.updated_at ? "No headlines match these filters." : "Publisher results will appear here as the collector checks its feeds."} />
          )}
          {!compact && data.pages > 1 && (
            <nav aria-label="Live headlines pages" className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className={BUTTON} disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button>
              <span className="text-sm text-stealth-300">Page {data.page} of {data.pages}</span>
              <button type="button" className={BUTTON} disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next</button>
            </nav>
          )}
          {!compact && <details className="surface-card-muted px-3 py-2 text-sm text-stealth-300">
            <summary className="min-h-8 cursor-pointer py-1 font-semibold text-stealth-100">
              Source status · {data.sources.filter((source) => source.state === "Online").length} of {data.sources.length} current
            </summary>
            <ul className="grid gap-x-4 gap-y-2 pb-2 pt-1 sm:grid-cols-2">
              {data.sources.map((source, index) => (
                <li key={`${source.name}-${index}`} className="flex flex-wrap gap-x-2 text-xs">
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-stealth-100 hover:underline">{source.name}</a>
                  <span>{source.state}</span>
                  {source.last_item && <time dateTime={source.last_item}>{formatDateTimeWithWeekday(source.last_item)} ET</time>}
                  {source.error && <span className="basis-full">{source.error}</span>}
                </li>
              ))}
            </ul>
          </details>}
        </>
      )}
    </div>
  );
}
