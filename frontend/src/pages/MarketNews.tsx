import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../utils/apiUtils";
import { EmptyState, ErrorState, LoadingState } from "../utils/componentUtils";
import { BUTTON_STYLES, formatDateTimeWithWeekday } from "../utils/styleUtils";

interface NewsArticle {
  id: number;
  symbol: string;
  sector?: string | null;
  title: string;
  link: string;
  source: string;
  published_at: string;
}

interface NewsTicker {
  symbol: string;
  sector: string;
}

interface NewsTickerResponse {
  count: number;
  tickers: NewsTicker[];
}

interface NewsTickerPreset {
  id: string;
  label: string;
  count: number;
  tickers: NewsTicker[];
}

interface NewsTickerPresetResponse {
  presets: NewsTickerPreset[];
}

type SortOrder = "newest" | "oldest";

const HOURS_OPTIONS = [
  { label: "24 hours", shortLabel: "24h", value: 24 },
  { label: "7 days", shortLabel: "7d", value: 168 },
  { label: "30 days", shortLabel: "30d", value: 720 },
] as const;

const PAGE_SIZE = 12;

const formatTickerEditor = (tickers: NewsTicker[]) => {
  const grouped = new Map<string, string[]>();
  tickers.forEach((ticker) => {
    const sector = ticker.sector || "GENERAL";
    if (!grouped.has(sector)) {
      grouped.set(sector, []);
    }
    grouped.get(sector)?.push(ticker.symbol);
  });

  return Array.from(grouped.entries())
    .map(([sector, symbols]) => `${sector}: ${symbols.join(", ")}`)
    .join("\n");
};

const parseTickerEditor = (text: string): NewsTicker[] => {
  const results: NewsTicker[] = [];
  const seen = new Set<string>();

  text.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const [left, right] = line.split(":");
    const hasSector = right !== undefined;
    const sector = (hasSector ? left : "GENERAL").trim() || "GENERAL";
    const symbolsText = hasSector ? right : left;

    symbolsText
      .split(/[,\s]+/)
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
      .forEach((symbol) => {
        const key = `${sector}:${symbol}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        results.push({ symbol, sector });
      });
  });

  return results;
};

const parsePositiveInteger = (value: string | null, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default function MarketNews() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTickerOpen, setIsTickerOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("custom");
  const [tickerDraft, setTickerDraft] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  const [tickerMessage, setTickerMessage] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [draftInitialized, setDraftInitialized] = useState(false);

  const requestedHours = Number.parseInt(searchParams.get("window") ?? "", 10);
  const hours = HOURS_OPTIONS.some((option) => option.value === requestedHours)
    ? requestedHours
    : 168;
  const requestedTicker = (searchParams.get("ticker") || "ALL").toUpperCase();
  const sortOrder: SortOrder = searchParams.get("sort") === "oldest" ? "oldest" : "newest";
  const requestedPage = parsePositiveInteger(searchParams.get("page"), 1);

  const updateView = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const {
    data: articles,
    loading,
    error,
  } = useApi<NewsArticle[]>(`/news?hours=${hours}&limit=200`);

  const {
    data: tickerData,
    loading: tickersLoading,
    error: tickersError,
    refetch: refetchTickers,
  } = useApi<NewsTickerResponse>("/news/tickers");

  const { data: presetData } = useApi<NewsTickerPresetResponse>("/news/ticker-presets");

  useEffect(() => {
    if (!draftInitialized && tickerData?.tickers) {
      const formatted = formatTickerEditor(tickerData.tickers);
      setCustomDraft(formatted);
      if (selectedPreset === "custom") {
        setTickerDraft(formatted);
      }
      setDraftInitialized(true);
    }
  }, [draftInitialized, selectedPreset, tickerData]);

  const presetOptions = presetData?.presets ?? [];
  const availableTickers = useMemo(
    () => Array.from(new Set((articles ?? []).map((article) => article.symbol))).sort(),
    [articles],
  );
  const selectedTicker =
    requestedTicker === "ALL" || availableTickers.includes(requestedTicker)
      ? requestedTicker
      : "ALL";

  useEffect(() => {
    if (
      articles &&
      requestedTicker !== "ALL" &&
      !availableTickers.includes(requestedTicker)
    ) {
      updateView({ ticker: null, page: null });
    }
  }, [articles, availableTickers, requestedTicker, updateView]);

  const filteredAndSortedArticles = useMemo(() => {
    const filtered =
      selectedTicker === "ALL"
        ? [...(articles ?? [])]
        : (articles ?? []).filter((article) => article.symbol === selectedTicker);
    return filtered.sort((left, right) => {
      const delta =
        new Date(right.published_at).getTime() - new Date(left.published_at).getTime();
      return sortOrder === "newest" ? delta : -delta;
    });
  }, [articles, selectedTicker, sortOrder]);

  const totalResults = filteredAndSortedArticles.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = totalResults === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, totalResults);
  const visibleArticles = filteredAndSortedArticles.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  useEffect(() => {
    if (!loading && articles && requestedPage !== currentPage) {
      updateView({ page: currentPage === 1 ? null : String(currentPage) });
    }
  }, [articles, currentPage, loading, requestedPage, updateView]);

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextPreset = event.target.value;
    setSelectedPreset(nextPreset);
    setTickerMessage(null);

    if (nextPreset === "custom") {
      const fallback =
        customDraft ||
        (tickerData?.tickers ? formatTickerEditor(tickerData.tickers) : "");
      setTickerDraft(fallback);
      if (!customDraft && tickerData?.tickers) {
        setCustomDraft(fallback);
      }
      return;
    }

    const preset = presetOptions.find((option) => option.id === nextPreset);
    if (!preset) {
      setTickerMessage("That preset is not available. Choose another preset.");
      return;
    }

    setTickerDraft(formatTickerEditor(preset.tickers));
    setTickerMessage("Preset loaded. Save the ticker list to apply it.");
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTickerMessage(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);

    try {
      await apiFetch("/news/refresh", {
        method: "POST",
        signal: controller.signal,
      });
      window.location.reload();
    } catch (refreshError) {
      console.error(refreshError);
      if (refreshError instanceof DOMException && refreshError.name === "AbortError") {
        setTickerMessage("The refresh stopped after 10 seconds. Try again in a moment.");
      } else {
        setTickerMessage("News could not be refreshed. The cached feed is still available.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsRefreshing(false);
    }
  };

  const handleSaveTickers = async () => {
    const parsed = parseTickerEditor(tickerDraft);
    if (parsed.length === 0) {
      setTickerMessage("Add at least one ticker before saving.");
      return;
    }

    try {
      setTickerMessage(null);
      const data = await apiFetch<NewsTickerResponse>("/news/tickers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: parsed }),
      });
      const formatted = formatTickerEditor(data.tickers);
      setTickerDraft(formatted);
      setCustomDraft(formatted);
      setDraftInitialized(true);
      setSelectedPreset("custom");
      setTickerMessage("Ticker list saved.");
      refetchTickers();
    } catch (saveError) {
      console.error(saveError);
      setTickerMessage("Ticker changes were not saved. Review the list and try again.");
    }
  };

  const handleCopyView = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage("View link copied.");
    } catch {
      setShareMessage("Copy is unavailable in this browser. Use the address bar to share this view.");
    }
  };

  return (
    <div className="page-shell page-stack">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="page-kicker">Signal Feed</span>
          <h1 className="page-title">Market News</h1>
          <p className="page-subtitle">
            Cached Seeking Alpha headlines for the configured market watchlist.
          </p>
          <div className="page-meta">
            <span className="page-badge">{availableTickers.length} tracked symbols</span>
            <span className="page-badge">
              Window{" "}
              {HOURS_OPTIONS.find((option) => option.value === hours)?.shortLabel ??
                `${hours}h`}
            </span>
            <span className="page-badge">12 headlines per page</span>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-stealth-300">Time window</legend>
            <div className="control-strip" aria-label="News time window">
              {HOURS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={hours === option.value}
                  onClick={() =>
                    updateView({
                      window: option.value === 168 ? null : String(option.value),
                      page: null,
                    })
                  }
                  className={`min-h-11 flex-1 whitespace-nowrap rounded-full px-4 text-sm font-medium transition ${
                    hours === option.value
                      ? "bg-stealth-700 text-stealth-50"
                      : "text-stealth-300 hover:text-stealth-100"
                  }`}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stealth-300">Ticker</span>
            <select
              value={selectedTicker}
              onChange={(event) =>
                updateView({
                  ticker: event.target.value === "ALL" ? null : event.target.value,
                  page: null,
                })
              }
              className="min-h-11 w-full rounded-xl border border-stealth-700 bg-stealth-900 px-3 text-sm text-stealth-100 focus:border-stealth-400 focus:outline-none"
            >
              <option value="ALL">All tracked tickers</option>
              {availableTickers.map((ticker) => (
                <option key={ticker} value={ticker}>
                  {ticker}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stealth-300">Sort</span>
            <select
              value={sortOrder}
              onChange={(event) =>
                updateView({
                  sort: event.target.value === "newest" ? null : event.target.value,
                  page: null,
                })
              }
              className="min-h-11 w-full rounded-xl border border-stealth-700 bg-stealth-900 px-3 text-sm text-stealth-100 focus:border-stealth-400 focus:outline-none"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`min-h-11 rounded-full px-4 text-sm font-medium transition ${
              isRefreshing ? BUTTON_STYLES.disabled : BUTTON_STYLES.primary
            }`}
          >
            {isRefreshing ? "Refreshing…" : "Refresh news"}
          </button>
        </div>
      </header>

      <section className="surface-card-strong p-4" aria-labelledby="ticker-cache-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="ticker-cache-heading" className="text-base font-semibold text-stealth-100">
              Ticker cache
            </h2>
            <p className="mt-1 text-sm text-stealth-300">
              Manage the symbols used when the feed is refreshed.
            </p>
          </div>
          <button
            type="button"
            aria-expanded={isTickerOpen}
            aria-controls="ticker-cache-editor"
            onClick={() => setIsTickerOpen((previous) => !previous)}
            className="min-h-11 rounded-xl border border-stealth-600 px-4 text-sm font-semibold text-stealth-100 transition hover:border-stealth-400"
          >
            {isTickerOpen ? "Close ticker editor" : "Edit ticker cache"}
          </button>
        </div>

        {isTickerOpen && (
          <div id="ticker-cache-editor" className="mt-4 border-t border-stealth-700 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block sm:min-w-64">
                <span className="mb-1 block text-xs font-medium text-stealth-300">Preset</span>
                <select
                  value={selectedPreset}
                  onChange={handlePresetChange}
                  className="min-h-11 w-full rounded-xl border border-stealth-700 bg-stealth-900 px-3 text-sm text-stealth-100 focus:border-stealth-400 focus:outline-none"
                >
                  <option value="custom">Custom</option>
                  {presetOptions.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                      {preset.count ? ` (${preset.count})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleSaveTickers}
                className="min-h-11 rounded-xl bg-stealth-100 px-4 text-sm font-semibold text-stealth-950 transition hover:bg-white"
              >
                Save ticker list
              </button>
            </div>

            {tickersLoading && <LoadingState message="Loading the ticker cache…" />}
            {tickersError && <ErrorState message={tickersError} />}
            {!tickersLoading && !tickersError && (
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-medium text-stealth-200">
                  Tickers by sector
                </span>
                <span className="mb-2 block text-xs text-stealth-400">
                  Use the format SECTOR: TICKER, TICKER.
                </span>
                <textarea
                  value={tickerDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTickerDraft(value);
                    if (selectedPreset === "custom") {
                      setCustomDraft(value);
                    }
                  }}
                  rows={6}
                  className="w-full rounded-xl border border-stealth-700 bg-stealth-900 p-3 text-sm text-stealth-100 focus:border-stealth-400 focus:outline-none"
                />
              </label>
            )}
          </div>
        )}

        {tickerMessage && (
          <p className="mt-3 text-sm text-stealth-200" role="status" aria-live="polite">
            {tickerMessage}
          </p>
        )}
      </section>

      <section aria-labelledby="news-results-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="news-results-heading" className="text-lg font-semibold text-stealth-100">
              Headlines
            </h2>
            <p className="mt-1 text-sm text-stealth-300" aria-live="polite">
              {totalResults === 0
                ? "No matching headlines"
                : `Showing ${pageStart}–${pageEnd} of ${totalResults} headlines`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-stealth-400">Filters and page are saved in this URL.</p>
            <button
              type="button"
              onClick={handleCopyView}
              className="min-h-11 rounded-xl border border-stealth-600 px-4 text-sm font-semibold text-stealth-100 transition hover:border-stealth-400"
            >
              Copy view link
            </button>
          </div>
        </div>
        {shareMessage && (
          <p className="mb-3 text-sm text-stealth-300" role="status" aria-live="polite">
            {shareMessage}
          </p>
        )}

        {loading && !articles && <LoadingState message="Loading cached headlines…" />}
        {loading && articles && (
          <p className="mb-3 rounded-xl border border-stealth-700 bg-stealth-900/70 p-3 text-sm text-stealth-300" role="status">
            Updating this view. The previous cached results remain visible.
          </p>
        )}
        {error && <ErrorState message={error} />}
        {!loading && !error && totalResults === 0 && (
          <EmptyState
            message={
              selectedTicker === "ALL"
                ? "No cached news is available for this window. Refresh the feed to try again."
                : `No cached news is available for ${selectedTicker} in this window.`
            }
          />
        )}

        {visibleArticles.length > 0 && (
          <div className="space-y-3">
            {visibleArticles.map((article) => (
              <article key={article.id}>
                <a
                  href={article.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block primary-card primary-card-hover p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-pulse-400"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-stealth-300">
                        {article.symbol}
                        {article.sector ? ` · ${article.sector}` : ""}
                        {article.source ? ` · ${article.source}` : ""}
                      </p>
                      <h3 className="mt-1 text-base font-semibold leading-6 text-stealth-100">
                        {article.title}
                      </h3>
                      <p className="mt-2 text-xs text-stealth-400">
                        {formatDateTimeWithWeekday(article.published_at)}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-stealth-300">Open article ↗</span>
                  </div>
                </a>
              </article>
            ))}
          </div>
        )}

        {totalResults > PAGE_SIZE && (
          <nav
            className="mt-5 flex flex-col gap-3 rounded-2xl border border-stealth-700 bg-stealth-900/70 p-3 sm:flex-row sm:items-center sm:justify-between"
            aria-label="News pagination"
          >
            <p className="text-sm text-stealth-300">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() =>
                  updateView({
                    page: currentPage - 1 === 1 ? null : String(currentPage - 1),
                  })
                }
                className="min-h-11 min-w-24 rounded-xl border border-stealth-600 px-4 text-sm font-semibold text-stealth-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => updateView({ page: String(currentPage + 1) })}
                className="min-h-11 min-w-24 rounded-xl border border-stealth-600 px-4 text-sm font-semibold text-stealth-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
