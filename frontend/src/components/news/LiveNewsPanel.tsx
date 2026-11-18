import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../utils/componentUtils";
import { formatDateTimeWithWeekday } from "../../utils/styleUtils";
import { Dialog, FormField, SegmentedControl, SupportingContextTooltip } from "../ui";

const LIVE_PATH = "/live-news";
const REFRESH_MS = 5_000;
const ACTIVITY_MS = 20_000;
const RETRY_MS = 15_000;
const BUTTON = "field-button field-button-secondary disabled:cursor-not-allowed disabled:opacity-50";
type View = "wire" | "focused" | "all";
const VIEWS: { value: View; label: string }[] = [
  { value: "wire", label: "Wires" },
  { value: "focused", label: "Focused" },
  { value: "all", label: "All News" },
];
const TOPIC_COLORS: Record<string, string> = {
  releases: "bg-emerald-400",
  markets: "bg-sky-400",
  metals: "bg-amber-400",
  crypto: "bg-violet-400",
  world: "bg-rose-400",
  tech: "bg-cyan-400",
  energy: "bg-orange-400",
  general: "bg-slate-400",
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
  archive_error: string | null;
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

function ArticlePreview({ article }: { article: Article }) {
  const { id, priority, summary } = article;
  const [preview, setPreview] = useState<Preview>();
  useEffect(() => {
    if (priority !== "Top" || summary) return;
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
  }, [id, priority, summary]);

  return (
    <>
      <span className="block font-semibold">{article.priority} priority · Relevance {article.score}</span>
      {article.reasons.length > 0 && <span className="mt-1 block text-stealth-300">{article.reasons.join(" · ")}</span>}
      {priority === "Top" && (
        <span className="mt-2 block border-t border-stealth-700 pt-2">
          {summary || preview?.text || "Loading article preview…"}
          {(summary || preview?.origin) && (
            <span className="mt-1 block text-stealth-300">{summary ? "Official release" : preview?.origin}</span>
          )}
        </span>
      )}
    </>
  );
}

function Headline({ article, topic, featured = false }: { article: Article; topic: string; featured?: boolean }) {
  const { bars, fade, color } = PRIORITY[article.priority];
  const Title = featured ? "h4" : "h3";
  return (
    <article className={`group/row relative flex gap-1.5 pl-1.5 pr-3 py-2.5 ${featured ? "surface-card-muted" : ""}`}>
      <div aria-hidden="true" className="relative w-4 shrink-0 self-stretch">
        <div className={`pointer-events-none absolute left-0 top-0 z-10 flex min-h-full w-1 items-center justify-center overflow-hidden rounded transition-[width] group-hover/row:w-4 group-focus-within/row:w-4 motion-reduce:transition-none ${TOPIC_COLORS[article.topic] ?? TOPIC_COLORS.general}`}>
          <span className="hidden rotate-180 whitespace-nowrap py-1 text-[10px] font-bold leading-none text-slate-950 [writing-mode:vertical-rl] group-hover/row:block group-focus-within/row:block">
            {topic}
          </span>
        </div>
      </div>
      <SupportingContextTooltip
        className="w-full items-center gap-2.5"
        placement="bottom"
        trigger={
          <span aria-hidden="true" className={`flex h-4 items-end gap-0.5 ${color}`}>
            {[1, 2, 3].map((bar) => (
              <span key={bar} className={`w-[3px] rounded-sm bg-current ${bar <= bars ? "" : "opacity-25"}`} style={{ height: bar * 4 + 2 }} />
            ))}
          </span>
        }
        triggerLabel={`${article.priority} priority · ${topic}${article.priority === "Top" ? " · Article preview" : ""}`}
        text={<ArticlePreview article={article} />}
        openOnContentHover={article.priority === "Top"}
        lazy
      >
        <div className={`space-y-1 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none ${fade}`}>
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
      </SupportingContextTooltip>
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
    <Dialog open title="Live news weights" onClose={close} description="Adjust which topics rise in the Focused view and how strongly it filters headlines.">
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

export default function LiveNewsPanel() {
  const [view, setView] = useState<View>("wire");
  const [topic, setTopic] = useState("");
  const [when, setWhen] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [showWeights, setShowWeights] = useState(false);
  const [result, setResult] = useState<{ query: string; data: Snapshot }>();
  const [failedQuery, setFailedQuery] = useState<string>();
  const closeWeights = useCallback(() => setShowWeights(false), []);
  const feedQuery = new URLSearchParams({ view, topic }).toString();
  const query = new URLSearchParams({ view, topic, when, q: search, page: String(page) }).toString();
  const data = result?.query === query ? result.data : undefined;
  const topics = result?.data.topics ?? {};
  const error = failedQuery === query;

  useEffect(() => {
    const controller = new AbortController();
    let nextActivity = 0;
    const renew = () => {
      if (document.hidden || Date.now() < nextActivity) return;
      nextActivity = Date.now() + ACTIVITY_MS;
      void request("/activity", {
        method: "POST",
        headers: { "X-Live-News": "1" },
        signal: controller.signal,
      }).catch(() => undefined);
    };
    renew();
    const timer = window.setInterval(renew, ACTIVITY_MS);
    document.addEventListener("visibilitychange", renew);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", renew);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let inFlight = false;
    const refresh = async () => {
      window.clearTimeout(timer);
      if (document.hidden || inFlight) return;
      inFlight = true;
      let delay = REFRESH_MS;
      try {
        const response = await request(`/snapshot?${query}`, { signal: controller.signal });
        const snapshot = await response.json() as Snapshot;
        if (controller.signal.aborted) return;
        setResult({ query, data: snapshot });
        setFailedQuery(undefined);
        delay = Math.max(REFRESH_MS, snapshot.read_interval * 1000);
      } catch {
        if (!controller.signal.aborted) setFailedQuery(query);
        delay = RETRY_MS;
      } finally {
        inFlight = false;
        if (!controller.signal.aborted && !document.hidden) timer = window.setTimeout(refresh, delay);
      }
    };
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [query, revision]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl label="Live news view" options={VIEWS} value={view} onChange={(value) => { setView(value); setPage(1); }} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={() => setRevision((value) => value + 1)}>Refresh live news</button>
          <button type="button" className={BUTTON} onClick={() => setShowWeights(true)}>Weights</button>
          <a className={BUTTON} href={`${LIVE_PATH}/rss.xml?${feedQuery}`}>RSS feed</a>
        </div>
      </div>
      <form
        className="surface-card-muted grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(String(new FormData(event.currentTarget).get("search")).trim());
          setPage(1);
        }}
      >
        <FormField label="Topic">
          <select value={topic} onChange={(event) => { setTopic(event.target.value); setPage(1); }} className="min-w-0 px-3 text-sm">
            <option value="">All topics</option>
            {Object.entries(topics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </FormField>
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
      </form>

      {showWeights && <WeightsEditor close={closeWeights} onSaved={() => { closeWeights(); setRevision((value) => value + 1); }} />}

      {error && <ErrorState message={data ? "Live updates are delayed. Showing the last loaded snapshot." : "Live news could not be loaded. It will retry automatically."} />}
      {!data && !error && <LoadingState message="Loading live headlines." />}
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-stealth-300">
            <span>{data.total ? `${data.first}–${data.last} of ${data.total.toLocaleString()} ${data.featured.length ? "other headlines" : "headlines"}` : "0 matching headlines"}</span>
            <span>{data.checked_label ? <>Feed snapshot <time dateTime={data.updated_at ?? undefined}>{data.checked_label}</time></> : "Waiting for the collector"} · Updates every {data.read_interval}s</span>
          </div>
          {data.archive_error && view === "wire" && <p className="text-sm text-stealth-300" role="status">{data.archive_error}</p>}
          {data.featured.length > 0 && (
            <section className="space-y-2" aria-labelledby="live-news-releases">
              <h3 id="live-news-releases" className="text-sm font-semibold text-stealth-100">Key releases</h3>
              {data.featured.map((article) => <Headline key={article.id} article={article} topic={topics[article.topic]} featured />)}
            </section>
          )}
          {data.articles.length > 0 ? (
            <ul aria-label="Live headlines" className="surface-card-muted divide-y divide-stealth-800">
              {data.articles.map((article) => (
                <li key={article.id}><Headline article={article} topic={topics[article.topic]} /></li>
              ))}
            </ul>
          ) : data.featured.length === 0 && (
            <EmptyState message={data.updated_at ? "No headlines match these filters." : "Publisher results will appear here as the collector checks its feeds."} />
          )}
          {data.pages > 1 && (
            <nav aria-label="Live headlines pages" className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className={BUTTON} disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button>
              <span className="text-sm text-stealth-300">Page {data.page} of {data.pages}</span>
              <button type="button" className={BUTTON} disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next</button>
            </nav>
          )}
          <details className="surface-card-muted px-3 py-2 text-sm text-stealth-300">
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
          </details>
        </>
      )}
    </div>
  );
}
