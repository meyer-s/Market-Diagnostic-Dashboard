import { useEffect, useState, type ChangeEvent } from "react";
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

const HOURS_OPTIONS = [
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
  { label: "30d", value: 720 },
];

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

export default function MarketNews() {
  const [hours, setHours] = useState(168);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTickerOpen, setIsTickerOpen] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState("ALL");
  const [selectedPreset, setSelectedPreset] = useState("nasdaq100");
  const [tickerDraft, setTickerDraft] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  const [tickerMessage, setTickerMessage] = useState<string | null>(null);
  const [draftInitialized, setDraftInitialized] = useState(false);

  const {
    data: articles,
    loading,
    error,
    refetch,
  } = useApi<NewsArticle[]>(`/news?hours=${hours}&limit=200`);

  const {
    data: tickerData,
    loading: tickersLoading,
    error: tickersError,
    refetch: refetchTickers,
  } = useApi<NewsTickerResponse>("/news/tickers");

  const { data: presetData } = useApi<NewsTickerPresetResponse>(
    "/news/ticker-presets"
  );

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

  // Build the dropdown options from cached articles to stay in sync with the cache.
  const availableTickers = Array.from(
    new Set((articles ?? []).map((article) => article.symbol))
  ).sort();

  useEffect(() => {
    if (selectedTicker !== "ALL" && !availableTickers.includes(selectedTicker)) {
      setSelectedTicker("ALL");
    }
  }, [availableTickers, selectedTicker]);

  // Apply client-side ticker filter on the cached data.
  const filteredArticles =
    selectedTicker === "ALL"
      ? articles
      : (articles ?? []).filter((article) => article.symbol === selectedTicker);

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
      setTickerMessage("Preset not available.");
      return;
    }

    setTickerDraft(formatTickerEditor(preset.tickers));
    setTickerMessage("Preset loaded. Click Save Tickers to apply.");
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTickerMessage(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);

    try {
      await apiFetch("/news/refresh", {
        method: "POST",
        signal: controller.signal,
      });
      window.location.reload();
    } catch (refreshError) {
      console.error(refreshError);
      if (refreshError instanceof DOMException && refreshError.name === "AbortError") {
        setTickerMessage("Refresh timed out. Please try again.");
      } else {
        setTickerMessage("Failed to refresh news.");
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
      setTickerMessage("Failed to save tickers.");
    }
  };

  return (
    <div className="page-shell page-stack">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="page-kicker">Signal Feed</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">News</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Cached Seeking Alpha headlines for your portfolio tickers.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="page-badge">{availableTickers.length} tracked symbols</span>
            <span className="page-badge">Window {HOURS_OPTIONS.find((option) => option.value === hours)?.label ?? `${hours}h`}</span>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="control-strip">
            {HOURS_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setHours(option.value)}
                className={`flex-1 whitespace-nowrap rounded-full px-3 py-1 text-xs sm:text-sm font-medium transition ${
                  hours === option.value
                    ? "bg-stealth-700 text-stealth-50"
                    : "text-stealth-400 hover:text-stealth-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-stealth-700 bg-stealth-900/80 px-3 py-2">
            <span className="text-xs text-stealth-400">Ticker</span>
            <select
              value={selectedTicker}
              onChange={(event) => setSelectedTicker(event.target.value)}
              className="bg-stealth-900 text-stealth-100 text-xs sm:text-sm rounded px-2 py-1 border border-stealth-700 focus:outline-none focus:border-stealth-500"
            >
              <option value="ALL">All</option>
              {availableTickers.map((ticker) => (
                <option key={ticker} value={ticker}>
                  {ticker}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`flex items-center justify-center gap-2 rounded-full px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition ${
              isRefreshing ? BUTTON_STYLES.disabled : BUTTON_STYLES.primary
            }`}
          >
            {isRefreshing ? "Refreshing..." : "Refresh News"}
          </button>
        </div>
      </div>

      {/* Collapsible editor for the cached ticker list (presets load into this editor). */}
      <div className="surface-card-strong p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-stealth-100">Ticker Cache</h3>
            <p className="text-xs text-stealth-400 mt-1">
              Edit the cached tickers below (format: SECTOR: TICKER, TICKER).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-stealth-700 bg-stealth-950/80 px-2 py-1">
              <span className="text-xs text-stealth-400">Preset</span>
              <select
                value={selectedPreset}
                onChange={handlePresetChange}
                className="bg-stealth-900 text-stealth-100 text-xs sm:text-sm rounded px-2 py-1 border border-stealth-700 focus:outline-none focus:border-stealth-500"
              >
                <option value="custom">Custom</option>
                {presetOptions.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                    {preset.count ? ` (${preset.count})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setIsTickerOpen((prev) => !prev)}
              className="rounded-full bg-stealth-800 px-3 py-2 text-xs font-medium text-stealth-200 transition hover:bg-stealth-700 sm:text-sm"
            >
              {isTickerOpen ? "Hide" : "Show"}
            </button>
            <button
              onClick={handleSaveTickers}
              className="rounded-full bg-stealth-100 px-3 py-2 text-xs font-medium text-stealth-950 transition hover:bg-white sm:text-sm"
            >
              Save Tickers
            </button>
          </div>
        </div>

        {isTickerOpen && (
          <>
            {tickersLoading && <LoadingState message="Loading tickers..." />}
            {tickersError && <ErrorState message={tickersError} />}

            {!tickersLoading && !tickersError && (
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
                className="w-full bg-stealth-900 border border-stealth-700 rounded-lg p-3 text-xs sm:text-sm text-stealth-100 focus:outline-none focus:border-stealth-500"
              />
            )}

            {tickerMessage && (
              <div className="mt-3 text-xs text-stealth-300">{tickerMessage}</div>
            )}
          </>
        )}
      </div>

      {loading && <LoadingState message="Loading news..." />}
      {error && <ErrorState message={error} />}
      {!loading && !error && filteredArticles && filteredArticles.length === 0 && (
        <EmptyState
          message={
            selectedTicker === "ALL"
              ? "No cached news for this window yet. Click Refresh News to fetch."
              : `No cached news for ${selectedTicker} in this window.`
          }
        />
      )}

      {filteredArticles && filteredArticles.length > 0 && (
        <div className="space-y-3">
          {filteredArticles.map((article) => (
            <a
              key={article.id}
              href={article.link}
              target="_blank"
              rel="noreferrer"
              className="block primary-card primary-card-hover p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-stealth-400">
                    {article.symbol}
                    {article.sector ? ` | ${article.sector}` : ""}
                    {article.source ? ` | ${article.source}` : ""}
                  </div>
                  <div className="text-sm sm:text-base font-semibold text-stealth-100 mt-1">
                    {article.title}
                  </div>
                  <div className="text-xs text-stealth-500 mt-2">
                    {formatDateTimeWithWeekday(article.published_at)}
                  </div>
                </div>
                <span className="text-xs text-stealth-400">Open</span>
              </div>
            </a>
          ))}
        </div>
      )}

    </div>
  );
}
