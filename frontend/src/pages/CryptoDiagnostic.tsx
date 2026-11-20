import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../hooks/useApi";
import MarketLoading from "../components/ui/MarketLoading";
import { CryptoSubsystemPanel } from "../components/aas/CryptoSubsystemPanel";
import { CHART_NEUTRAL, CHART_MARGIN } from "../utils/chartUtils";
import {
  buildTechnicalProjections,
  type RelativeClassification,
  type TechnicalProjection,
} from "../utils/technicalProjections";

interface AASComponent {
  name: string;
  category: string;
  value: number;
  weight: number;
  contribution: number;
  status: "active" | "missing";
  description: string;
}

interface AASBreakdownData {
  components: AASComponent[];
  crypto_contribution: number;
}

type AASComponentHistoryResponse = {
  data: Record<string, { date: string; value: number | null }[]>;
};

interface CryptoHistoryPoint {
  date: string;
  price?: number | null;
  market_cap?: number | null;
  total_volume?: number | null;
}

interface CryptoAsset {
  symbol: string;
  name: string;
  coin_id: string;
  color: string;
  current_price: number | null;
  change_24h: number | null;
  change_30d: number | null;
  market_cap: number | null;
  total_volume_24h: number | null;
  history: CryptoHistoryPoint[];
  source?: string;
  observed_at?: string | null;
  change_24h_basis?: string | null;
  change_30d_basis?: string | null;
}

interface CryptoMarketOverviewResponse {
  as_of: string;
  observed_at?: string | null;
  generated_at?: string;
  source?: string;
  data_quality?: { status: string; reason?: string; age_seconds?: number | null };
  summary: {
    btc_dominance: number | null;
    total_market_cap: number | null;
    market_cap_change_24h: number | null;
    advancing_assets_24h: number | null;
    change_24h_available_assets?: number;
    monitored_assets: number;
  };
  assets: CryptoAsset[];
  market_structure_history: Array<{
    date: string;
    total_market_cap: number | null;
    btc_dominance_pct: number | null;
  }>;
}

interface CryptoDiagnosticContextResponse {
  as_of: string;
  indicator_as_of?: string | null;
  signal_as_of?: string | null;
  market_as_of?: string | null;
  model_dates_aligned?: boolean;
  data_quality?: { status: string; reason?: string };
  summary: {
    primary_driver: string | null;
    stress_type: string | null;
    crypto_contribution: number | null;
    crypto_pressure_score: number | null;
    correlation_regime: string | null;
  };
  current_signals: {
    stablecoin_supply: number | null;
    stablecoin_btc_ratio: number | null;
    defi_tvl: number | null;
    exchange_outflows: number | null;
    btc_spy_correlation: number | null;
    altcoin_weakness: number | null;
    btc_hash_rate: number | null;
    btc_difficulty: number | null;
  };
  market_history: Array<{
    date: string;
    btc_price: number | null;
    eth_price: number | null;
    total_crypto_mcap_b: number | null;
    btc_dominance_pct: number | null;
    btc_volume_24h: number | null;
  }>;
  signal_history: Array<{
    date: string;
    stablecoin_supply: number | null;
    stablecoin_btc_ratio: number | null;
    defi_tvl: number | null;
    exchange_outflows: number | null;
    btc_spy_correlation: number | null;
    altcoin_weakness: number | null;
    btc_hash_rate: number | null;
    btc_difficulty: number | null;
  }>;
}

interface CryptoDiagnosticProps {
  embedded?: boolean;
  aasData?: AASBreakdownData;
  componentHistory?: AASComponentHistoryResponse;
}

type CryptoProjection = TechnicalProjection<CryptoAsset>;

const formatCurrency = (value: number | null, compact = false) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : value >= 1000 ? 0 : 2,
  }).format(value);
};

const formatPercent = (value: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const getPercentColor = (value: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "text-stealth-400";
  }
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-stealth-300";
};

const formatSignal = (value: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(2);
};

const formatAxisCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }

  if (Math.abs(value) >= 10) {
    return `$${value.toFixed(0)}`;
  }

  return `$${value.toFixed(2)}`;
};

const getSignalTone = (value: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "text-stealth-400";
  }
  if (value >= 0.67) return "text-red-300";
  if (value >= 0.4) return "text-amber-300";
  return "text-emerald-300";
};

const getRelativeClassColor = (relativeClass: RelativeClassification) => {
  switch (relativeClass) {
    case "Winner":
      return "border-emerald-500 bg-emerald-500/10 text-emerald-300";
    case "Loser":
      return "border-red-500 bg-red-500/10 text-red-300";
    default:
      return "border-blue-500 bg-blue-500/10 text-blue-300";
  }
};

const getClassificationColor = (classification: string) => {
  switch (classification) {
    case "Strong":
      return "text-emerald-400";
    case "Bullish":
      return "text-green-400";
    case "Neutral":
      return "text-yellow-400";
    case "Bearish":
      return "text-orange-400";
    case "Weak":
      return "text-red-300";
    default:
      return "text-stealth-400";
  }
};

const getAssetTextColor = (symbol: string) => {
  switch (symbol) {
    case "BTC":
      return "#fbbf24";
    case "ETH":
      return "#a5b4fc";
    case "SOL":
      return "#5eead4";
    case "XRP":
      return "#f9a8d4";
    default:
      return "#e2e8f0";
  }
};

const formatTimestamp = (value: string | null | undefined) => {
  if (!value) return "Timestamp unavailable";
  const timestamp = new Date(/^\d{4}-\d{2}-\d{2}T/.test(value) && !/(Z|[+-]\d{2}:\d{2})$/.test(value) ? `${value}Z` : value);
  return Number.isNaN(timestamp.getTime())
    ? value
    : timestamp.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

interface ChartReadRow {
  observation: string;
  date: string;
  values: Array<{ label: string; value: string }>;
}

function buildChartReadRows<T extends { label?: string; date?: string }>(
  data: T[],
  series: Array<{ label: string; read: (row: T) => string }>,
): ChartReadRow[] {
  if (data.length === 0) return [];
  const points = [
    { observation: "First", row: data[0] },
    { observation: "Latest", row: data[data.length - 1] },
  ];
  return points.map(({ observation, row }) => ({
    observation,
    date: row.label ?? row.date ?? "n/a",
    values: series.map((item) => ({ label: item.label, value: item.read(row) })),
  }));
}

function ChartDataDisclosure({
  label,
  description,
  rows,
}: {
  label: string;
  description: string;
  rows: ChartReadRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <details className="mt-3 rounded-xl border border-stealth-700 bg-stealth-950/35">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-stealth-200">
        Read chart values
      </summary>
      <div className="border-t border-stealth-700 p-3">
        <p className="mb-2 text-xs leading-5 text-stealth-300">{description}</p>
        <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="text-stealth-400">
              <tr>
                <th className="px-2 py-2 font-semibold" scope="col">Observation</th>
                <th className="px-2 py-2 font-semibold" scope="col">Date</th>
                {rows[0].values.map((item) => (
                  <th key={item.label} className="px-2 py-2 font-semibold" scope="col">{item.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-stealth-100">
              {rows.map((row) => (
                <tr key={row.observation} className="border-t border-stealth-800">
                  <th className="px-2 py-2 font-semibold" scope="row">{row.observation}</th>
                  <td className="px-2 py-2">{row.date}</td>
                  {row.values.map((item) => <td key={item.label} className="px-2 py-2">{item.value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export default function CryptoDiagnostic({
  embedded = false,
  aasData,
  componentHistory,
}: CryptoDiagnosticProps) {
  const {
    data: marketData,
    loading,
    error,
    refetch: refetchMarket,
  } = useApi<CryptoMarketOverviewResponse>("/crypto/market-overview?days=365", {timeoutMs: 30_000});
  const {
    data: diagnosticContext,
    loading: diagnosticLoading,
    error: diagnosticError,
    refetch: refetchDiagnostic,
  } = useApi<CryptoDiagnosticContextResponse>("/crypto/diagnostic-context?days=365");
  const {
    data: fallbackAasData,
    loading: aasLoading,
    error: aasError,
  } = useApi<AASBreakdownData>(aasData ? "" : "/aas/components/breakdown");
  const {
    data: fallbackComponentHistory,
    loading: componentHistoryLoading,
    error: componentHistoryError,
  } = useApi<AASComponentHistoryResponse>(componentHistory ? "" : "/aas/components/history?days=365");
  const [selectedTab, setSelectedTab] = useState<"overview" | "deep-dive">("overview");
  const [timeframe, setTimeframe] = useState<30 | 90 | 180 | 365>(90);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      const background = document.visibilityState === "hidden" || !document.hasFocus();
      timer = setTimeout(() => { refetchMarket(); refetchDiagnostic(); schedule(); }, background ? 300_000 : 60_000);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", schedule);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); window.removeEventListener("focus", schedule); window.removeEventListener("blur", schedule); };
  }, [refetchMarket, refetchDiagnostic]);
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab = selectedTab === "overview" ? "deep-dive" : "overview";
    setSelectedTab(nextTab);
    document.getElementById(`crypto-${nextTab}-tab`)?.focus();
  };

  const resolvedAasData = aasData ?? fallbackAasData;
  const resolvedComponentHistory = componentHistory ?? fallbackComponentHistory;

  const cryptoComponents = useMemo(
    () => (resolvedAasData?.components ?? []).filter((component) => component.category === "crypto"),
    [resolvedAasData]
  );

  const cutoffDate = useMemo(() => {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - timeframe);
    return cutoff;
  }, [timeframe, marketData]);

  const buildPriceChartData = (symbols: string[]) => {
    if (!marketData?.assets?.length) {
      return [];
    }

    const dateMap = new Map<string, Record<string, string | number | null>>();

    for (const symbol of symbols) {
      const asset = marketData.assets.find((candidate) => candidate.symbol === symbol);
      if (!asset) {
        continue;
      }

      const filteredHistory = asset.history.filter(
        (point) => new Date(point.date) >= cutoffDate && point.price !== null && point.price !== undefined
      );

      for (const point of filteredHistory) {
        if (!dateMap.has(point.date)) {
          dateMap.set(point.date, {
            date: point.date,
            label: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
          });
        }

        const row = dateMap.get(point.date)!;
        row[asset.symbol] = point.price ?? null;
      }
    }

    return Array.from(dateMap.values()).sort((left, right) => String(left.date).localeCompare(String(right.date)));
  };

  const largeCapChartData = useMemo(() => buildPriceChartData(["BTC", "ETH"]), [marketData, cutoffDate]);
  const secondaryChartData = useMemo(() => buildPriceChartData(["SOL", "XRP"]), [marketData, cutoffDate]);

  const regime = useMemo(() => {
    if (!marketData) {
      return { label: "Loading", detail: "Fetching crypto market context." };
    }

    const breadth = marketData.summary.advancing_assets_24h;
    const dominance = marketData.summary.btc_dominance;
    const changes = marketData.assets.map(asset => asset.change_30d).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const observed24h = marketData.summary.change_24h_available_assets ?? marketData.assets.filter(asset => typeof asset.change_24h === "number" && Number.isFinite(asset.change_24h)).length;
    if (marketData.data_quality?.status === "stale" || marketData.data_quality?.status === "unavailable") return {label: "Stale / unavailable", detail: "Current basket classification is withheld while observations are stale or unavailable."};
    if (!marketData.assets.length || changes.length < marketData.assets.length || observed24h < marketData.assets.length || breadth === null) return {label: "Partial coverage", detail: `${changes.length}/${marketData.assets.length} assets have 30-day changes; ${observed24h}/${marketData.assets.length} have daily changes. Missing values are excluded.`};
    const avg30d = changes.reduce((sum, value) => sum + value, 0) / changes.length;

    if (breadth >= 3 && avg30d > 8) {
      return { label: "Basket strength", detail: `${breadth}/${marketData.assets.length} tracked assets advanced, with a positive 30-day basket mean. This is a four-asset sample.` };
    }
    if (avg30d < 0) {
      return { label: "Basket weakness", detail: `The tracked basket averages ${avg30d.toFixed(1)}% over 30 days. Relative leaders can still be falling.` };
    }
    if (dominance !== null && dominance >= 58) return {label: "BTC concentration", detail: `BTC represents ${dominance.toFixed(1)}% of reported crypto capitalization. Its share alone does not establish a flight to safety.`};

    return { label: "Mixed basket", detail: "The daily breadth and 30-day mean do not meet this model's strength or weakness rules." };
  }, [marketData]);

  const marketStructureData = useMemo(
    () =>
      (marketData?.market_structure_history ?? [])
        .filter((point) => new Date(point.date) >= cutoffDate)
        .map((point) => ({
          ...point,
          label: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
        })),
    [marketData, cutoffDate]
  );

  const signalPanelData = useMemo(
    () =>
      (diagnosticContext?.signal_history ?? [])
        .filter((point) => new Date(point.date) >= cutoffDate)
        .map((point) => ({
          ...point,
          label: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
        })),
    [diagnosticContext, cutoffDate]
  );

  const cryptoProjections = useMemo<CryptoProjection[]>(() => {
    if (!marketData?.assets?.length) {
      return [];
    }

    return buildTechnicalProjections<CryptoAsset>([...marketData.assets]).filter(asset => Date.now() - Date.parse(`${asset.analysis_as_of}T00:00:00Z`) <= 3 * 86_400_000);
  }, [marketData]);

  const hasLargeCapChartData = largeCapChartData.length > 1;
  const hasSecondaryChartData = secondaryChartData.length > 1;
  const hasMarketStructureData = marketStructureData.length > 1;
  const hasSignalPanelData = signalPanelData.length > 1;
  const supportingAvailable = [diagnosticContext, resolvedAasData, resolvedComponentHistory]
    .filter((source) => source !== null).length;
  const supportingLoading = [diagnosticLoading, aasLoading, componentHistoryLoading]
    .filter(Boolean).length;
  const supportingErrors = [diagnosticError, aasError, componentHistoryError]
    .filter(Boolean).length;

  if (loading && !marketData) {
    return (
      <div className={embedded ? "py-8" : "p-6"}>
        <div className="flex justify-center py-6">
          <MarketLoading size={110} variant="pulse" label="Loading crypto diagnostic..." />
        </div>
      </div>
    );
  }

  if (!marketData) {
    return (
      <div className={embedded ? "py-8" : "page-shell"}>
        <div className="rounded-xl border border-red-700 bg-red-900/20 p-4 text-red-100" role="alert">
          <p className="text-lg font-semibold">Crypto diagnostic could not load</p>
          <p className="mt-1 text-sm text-red-200">{error ?? "The market overview returned no current observation."}</p>
          <button
            type="button"
            onClick={refetchMarket}
            className="mt-4 min-h-11 rounded-xl border border-red-400/60 bg-red-950/50 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "text-stealth-200" : "page-shell text-stealth-200"}>
      {!embedded && (
        <section className="page-hero mb-6">
          <p className="page-kicker">Tools</p>
          <h1 className="page-title">Crypto Diagnostic</h1>
          <p className="page-subtitle">
            Prices, relative technical strength and model context for BTC, ETH, SOL and XRP.
          </p>
          <div className="page-meta">
            <span className="page-badge">Observed {formatTimestamp(marketData.observed_at ?? marketData.as_of)}</span>
            <span className="page-badge">{marketData.summary.monitored_assets} assets monitored</span>
            <span className="page-badge">
              {supportingAvailable}/3 supporting responses loaded
              {supportingLoading > 0 ? ` · ${supportingLoading} updating` : ""}
              {supportingErrors > 0 ? ` · ${supportingErrors} unavailable` : ""}
            </span>
          </div>
        </section>
      )}

      {error ? <p role="status" className="mb-4 text-sm text-amber-300">The latest check failed. Previous observations remain visible: {error}</p> : null}
      <details className="mb-5 secondary-card p-3 text-xs text-stealth-300">
        <summary className="cursor-pointer">{marketData.source ?? "Market source"} · {marketData.data_quality?.status ?? "quality unverified"} · source and timing</summary>
        <p className="mt-2">{marketData.data_quality?.reason ?? "Check the observation time and per-asset change basis before comparing snapshots."}</p>
        <p className="mt-1">Response generated {formatTimestamp(marketData.generated_at)}. Page checks every minute while active and every five minutes in the background. Server quotes refresh every 15 minutes, including weekends.</p>
        {diagnosticContext ? <p className="mt-1">Model signals {formatTimestamp(diagnosticContext.signal_as_of ?? diagnosticContext.as_of)} · {diagnosticContext.data_quality?.status ?? "quality unverified"}{diagnosticContext.model_dates_aligned === false ? " · model dates differ" : ""}.</p> : null}
      </details>
      <section id="crypto-now" className="section-anchor mb-6 primary-card p-4 md:p-6" aria-labelledby="crypto-now-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="page-kicker">Now</p>
            <h2 id="crypto-now-heading" className="mt-1 text-lg font-bold text-white md:text-xl">Crypto Regime Snapshot</h2>
            <p className="text-sm text-stealth-400 max-w-3xl">{regime.detail}</p>
          </div>
          <div className="rounded-full border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-200">
            {regime.label}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="secondary-card p-4">
            <div className="text-xs text-stealth-400 mb-1">Total Crypto Market Cap</div>
            <div className="text-lg font-bold text-blue-300">{formatCurrency(marketData.summary.total_market_cap, true)}</div>
          </div>
          <div className="secondary-card p-4">
            <div className="text-xs text-stealth-400 mb-1">BTC Dominance</div>
            <div className="text-lg font-bold text-amber-300">{marketData.summary.btc_dominance?.toFixed(2) ?? "n/a"}%</div>
          </div>
          <div className="secondary-card p-4">
            <div className="text-xs text-stealth-400 mb-1">Daily Breadth</div>
            <div className={`text-lg font-bold ${marketData.summary.advancing_assets_24h === null ? "text-stealth-300" : marketData.summary.advancing_assets_24h === 0 ? "text-red-300" : marketData.summary.advancing_assets_24h >= 3 ? "text-emerald-300" : "text-amber-300"}`}>
              {marketData.summary.advancing_assets_24h ?? "n/a"}/{marketData.summary.change_24h_available_assets ?? marketData.summary.monitored_assets} advancing
            </div>
          </div>
          <div className="secondary-card p-4">
            <div className="text-xs text-stealth-400 mb-1">Market Cap Change (24H / daily)</div>
            <div className={`text-lg font-bold ${getPercentColor(marketData.summary.market_cap_change_24h)}`}>
              {formatPercent(marketData.summary.market_cap_change_24h)}
            </div>
          </div>
        </div>
      </section>

      <div id="crypto-views" className="section-anchor control-strip mb-6" role="tablist" aria-label="Crypto diagnostic view">
        <button
          type="button"
          id="crypto-overview-tab"
          role="tab"
          aria-selected={selectedTab === "overview"}
          aria-controls="crypto-overview-panel"
          tabIndex={selectedTab === "overview" ? 0 : -1}
          onClick={() => setSelectedTab("overview")}
          onKeyDown={handleTabKeyDown}
          className={`min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            selectedTab === "overview"
              ? "bg-blue-500/15 text-blue-200 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.28)]"
              : "text-stealth-400 hover:bg-stealth-800/70 hover:text-stealth-200"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          id="crypto-deep-dive-tab"
          role="tab"
          aria-selected={selectedTab === "deep-dive"}
          aria-controls="crypto-deep-dive-panel"
          tabIndex={selectedTab === "deep-dive" ? 0 : -1}
          onClick={() => setSelectedTab("deep-dive")}
          onKeyDown={handleTabKeyDown}
          className={`min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            selectedTab === "deep-dive"
              ? "bg-blue-500/15 text-blue-200 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.28)]"
              : "text-stealth-400 hover:bg-stealth-800/70 hover:text-stealth-200"
          }`}
        >
          Deep Dive
        </button>
      </div>

      {selectedTab === "overview" && (
        <div id="crypto-overview-panel" role="tabpanel" aria-labelledby="crypto-overview-tab" tabIndex={0}>
          <div id="crypto-leaders" className="section-anchor mb-6 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
            <div className="mb-4">
              <p className="page-kicker">Drivers</p>
              <h2 className="mt-1 text-lg font-semibold text-stealth-100">Winners & Losers Right Now</h2>
              <p className="text-xs text-stealth-400">
                Relative technical scores within this basket. A winner can still have a weak absolute setup.
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {cryptoProjections.map((asset) => (
                <div key={asset.symbol} className={`rounded-lg border p-3 ${getRelativeClassColor(asset.relativeClassification)}`}>
                  <div className="mb-1 text-xs font-semibold">
                    #{asset.rank} <span style={{ color: getAssetTextColor(asset.symbol) }}>{asset.name}</span>
                  </div>
                  <div className="text-lg font-bold text-stealth-100">{formatCurrency(asset.current_price)}</div>
                  <div className="text-xs text-stealth-300">Daily bar · {asset.analysis_as_of}</div>
                  <div className="mt-1 text-xs">Score: {asset.score_total.toFixed(1)}/100</div>
                  <div className={`mt-1 text-xs font-semibold ${getClassificationColor(asset.classification)}`}>{asset.classification}</div>
                </div>
              ))}
            </div>

            {cryptoProjections.length < marketData.assets.length ? <p role="status" className="mb-4 text-sm text-amber-300">{cryptoProjections.length}/{marketData.assets.length} assets have 200 consecutive valid UTC daily bars ending within three days, required for a current technical score.</p> : null}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {cryptoProjections.map((asset) => (
                <div key={`${asset.symbol}-detail`} className="secondary-card p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-stealth-100">
                        <span style={{ color: getAssetTextColor(asset.symbol) }}>{asset.name}</span> ({asset.symbol})
                      </h3>
                      <div className="text-xs" style={{ color: getAssetTextColor(asset.symbol) }}>{asset.coin_id.toUpperCase()}</div>
                    </div>
                    <div className={`rounded border px-2 py-1 text-xs font-semibold ${getRelativeClassColor(asset.relativeClassification)}`}>
                      {asset.relativeClassification}
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-stealth-400">Technical daily bar · {asset.analysis_as_of}</div>
                      <div className="font-semibold text-stealth-100">{formatCurrency(asset.current_price)}</div>
                      <div className="mt-1 text-xs text-stealth-300">Latest quote {formatCurrency(asset.quote_price)} · {formatTimestamp(asset.observed_at)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-stealth-400">Wilder RSI (14)</div>
                      <div className="font-semibold text-stealth-100">{asset.technicals.rsi?.toFixed(1) ?? "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-stealth-400">SMA 20</div>
                      <div className="font-semibold text-stealth-100">{formatCurrency(asset.technicals.sma_20)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-stealth-400">SMA 50</div>
                      <div className="font-semibold text-stealth-100">{formatCurrency(asset.technicals.sma_50)}</div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="mb-1 text-xs text-stealth-400">Momentum</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-stealth-400">5d:</span>
                        <span className={`ml-1 font-semibold ${getPercentColor(asset.technicals.momentum_5d)}`}>
                          {formatPercent(asset.technicals.momentum_5d)}
                        </span>
                      </div>
                      <div>
                        <span className="text-stealth-400">20d:</span>
                        <span className={`ml-1 font-semibold ${getPercentColor(asset.technicals.momentum_20d)}`}>
                          {formatPercent(asset.technicals.momentum_20d)}
                        </span>
                      </div>
                      <div>
                        <span className="text-stealth-400">60d:</span>
                        <span className={`ml-1 font-semibold ${getPercentColor(asset.technicals.momentum_60d)}`}>
                          {formatPercent(asset.technicals.momentum_60d)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="mb-1 text-stealth-400">Support Levels</div>
                      {asset.levels.support.length > 0 ? asset.levels.support.map((level: number, index: number) => (
                        <div key={`${asset.symbol}-support-${index}`} className="font-semibold text-green-400">
                          {formatCurrency(level)}
                        </div>
                      )) : <div className="text-stealth-400">None detected</div>}
                    </div>
                    <div>
                      <div className="mb-1 text-stealth-400">Resistance Levels</div>
                      {asset.levels.resistance.length > 0 ? asset.levels.resistance.map((level: number, index: number) => (
                        <div key={`${asset.symbol}-resistance-${index}`} className="font-semibold text-red-400">
                          {formatCurrency(level)}
                        </div>
                      )) : <div className="text-stealth-400">None detected</div>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-stealth-600 pt-3 text-xs">
                    <div>
                      <span className="text-stealth-400">Upper (+10%):</span>
                      <span className="ml-2 font-semibold text-green-400">{formatCurrency(asset.levels.take_profit)}</span>
                    </div>
                    <div>
                      <span className="text-stealth-400">Lower (−5%):</span>
                      <span className="ml-2 font-semibold text-red-400">{formatCurrency(asset.levels.stop_loss)}</span>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-stealth-600 pt-3">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-stealth-400">Trend Score:</span>
                      <span className="font-semibold">{asset.score_trend.toFixed(1)}/100</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-stealth-400">Momentum Score:</span>
                      <span className="font-semibold">{asset.score_momentum.toFixed(1)}/100</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-stealth-700 bg-stealth-900/50 p-3 text-xs text-stealth-400">
              <strong>Technical model:</strong> 60% moving-average trend score and 40% RSI score. Indicators use the same daily-bar basis and require 200 consecutive UTC days; today's observation may be incomplete and the latest quote is separate. Support/resistance and fixed upper/lower references do not enter the score. RSI near 50 receives more points under this model; the score is not an expected return.
            </div>
          </div>

          <div id="crypto-price-structure" className="section-anchor mb-6 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="page-kicker">Evidence</p>
                <h2 className="mt-1 text-lg font-semibold text-stealth-100">Price Structure</h2>
                <p className="text-xs text-stealth-400">
                  Raw-price curves use separate axes to keep each series visible without compressing BTC,
                  ETH, SOL, and XRP into one shared price axis. Independent axes do not establish correlation.
                </p>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Price history range">
                {[30, 90, 180, 365].map((days) => (
                  <button
                    type="button"
                    key={days}
                    onClick={() => setTimeframe(days as 30 | 90 | 180 | 365)}
                    aria-pressed={timeframe === days}
                    className={`min-h-11 rounded-full px-3 py-2 text-xs font-medium transition ${
                      timeframe === days
                        ? "border border-blue-500/40 bg-blue-500/20 text-blue-200"
                        : "border border-stealth-700 bg-stealth-900/60 text-stealth-400"
                    }`}
                  >
                    {days}D
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="min-w-0 secondary-card p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-stealth-100">BTC vs ETH</h3>
                  <p className="text-xs text-stealth-400">BTC uses the left dollar axis; ETH uses the right. Compare dates and returns separately from line height.</p>
                  <p className="mt-1 text-xs text-stealth-300">Latest plotted: {largeCapChartData[largeCapChartData.length - 1]?.label ?? "unavailable"}</p>
                </div>
                <div className="h-80 min-w-0 w-full">
                  {hasLargeCapChartData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={240}>
                    <LineChart
                      accessibilityLayer
                      aria-label="Bitcoin and Ether price history"
                      data={largeCapChartData}
                      margin={CHART_MARGIN}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis
                        dataKey="label"
                        minTickGap={28}
                        tick={{ fontSize: 12, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 12, fill: "#f59e0b" }}
                        axisLine={{ stroke: "#f59e0b" }}
                        tickLine={{ stroke: "#f59e0b" }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={72}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 12, fill: "#60a5fa" }}
                        axisLine={{ stroke: "#60a5fa" }}
                        tickLine={{ stroke: "#60a5fa" }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={72}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: CHART_NEUTRAL.label, fontWeight: 600 }}
                        formatter={(value: number, name: string) => [formatAxisCurrency(value), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: CHART_NEUTRAL.text }} />
                      <Line yAxisId="left" type="monotone" dataKey="BTC" name="BTC" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="ETH" name="ETH" stroke="#60a5fa" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-400">
                      Large-cap history is temporarily unavailable.
                    </div>
                  )}
                </div>
                <ChartDataDisclosure
                  label="BTC and ETH price chart summary"
                  description={`The chart spans ${timeframe} days and uses separate price axes. Values below show the first and latest plotted observations.`}
                  rows={buildChartReadRows(largeCapChartData, [
                    { label: "BTC", read: (row) => formatAxisCurrency(typeof row.BTC === "number" ? row.BTC : null) },
                    { label: "ETH", read: (row) => formatAxisCurrency(typeof row.ETH === "number" ? row.ETH : null) },
                  ])}
                />
              </div>

              <div className="min-w-0 secondary-card p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-stealth-100">SOL vs XRP</h3>
                  <p className="text-xs text-stealth-400">SOL uses the left dollar axis; XRP uses the right. This pair does not represent the entire altcoin market.</p>
                  <p className="mt-1 text-xs text-stealth-300">Latest plotted: {secondaryChartData[secondaryChartData.length - 1]?.label ?? "unavailable"}</p>
                </div>
                <div className="h-80 min-w-0 w-full">
                  {hasSecondaryChartData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={240}>
                    <LineChart
                      accessibilityLayer
                      aria-label="Solana and XRP price history"
                      data={secondaryChartData}
                      margin={CHART_MARGIN}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis
                        dataKey="label"
                        minTickGap={24}
                        tick={{ fontSize: 12, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 12, fill: "#14b8a6" }}
                        axisLine={{ stroke: "#14b8a6" }}
                        tickLine={{ stroke: "#14b8a6" }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={68}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 12, fill: "#f472b6" }}
                        axisLine={{ stroke: "#f472b6" }}
                        tickLine={{ stroke: "#f472b6" }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={68}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: CHART_NEUTRAL.label, fontWeight: 600 }}
                        formatter={(value: number, name: string) => [formatAxisCurrency(value), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: CHART_NEUTRAL.text }} />
                      <Line yAxisId="left" type="monotone" dataKey="SOL" name="SOL" stroke="#14b8a6" strokeWidth={2.4} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="XRP" name="XRP" stroke="#f472b6" strokeWidth={2.4} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-400">
                      Alt-rotation history is temporarily unavailable.
                    </div>
                  )}
                </div>
                <ChartDataDisclosure
                  label="SOL and XRP price chart summary"
                  description={`The chart spans ${timeframe} days and uses separate price axes. Values below show the first and latest plotted observations.`}
                  rows={buildChartReadRows(secondaryChartData, [
                    { label: "SOL", read: (row) => formatAxisCurrency(typeof row.SOL === "number" ? row.SOL : null) },
                    { label: "XRP", read: (row) => formatAxisCurrency(typeof row.XRP === "number" ? row.XRP : null) },
                  ])}
                />
              </div>
            </div>
          </div>

          {diagnosticContext && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
              <div className="min-w-0 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-stealth-100">Leadership Concentration</h3>
                  <p className="text-xs text-stealth-400">BTC share and total crypto capitalization. Changes in share alone do not identify capital flows or investor motives.</p>
                  <p className="mt-1 text-xs text-stealth-300">Latest plotted: {marketStructureData[marketStructureData.length - 1]?.label ?? "unavailable"}</p>
                </div>
                <div className="h-72 min-w-0 w-full">
                  {hasMarketStructureData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={220}>
                    <LineChart
                      accessibilityLayer
                      aria-label="Bitcoin dominance and total crypto market-capitalization history"
                      data={marketStructureData}
                      margin={CHART_MARGIN}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 12, fill: "#fbbf24" }} axisLine={{ stroke: "#fbbf24" }} tickLine={{ stroke: "#fbbf24" }} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} width={56} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: "#60a5fa" }} axisLine={{ stroke: "#60a5fa" }} tickLine={{ stroke: "#60a5fa" }} tickFormatter={(value) => formatAxisCurrency(Number(value))} width={78} />
                      <Tooltip
                        contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: CHART_NEUTRAL.label, fontWeight: 600 }}
                        formatter={(value: number, name: string) => {
                          if (name === "BTC Dominance") {
                            return [`${value?.toFixed(2)}%`, name];
                          }
                          return [formatCurrency(value, true), name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: CHART_NEUTRAL.text }} />
                      <ReferenceLine yAxisId="left" y={60} stroke="#64748b" strokeDasharray="4 4" />
                      <Line yAxisId="left" type="monotone" dataKey="btc_dominance_pct" name="BTC Dominance" stroke="#fbbf24" strokeWidth={2.4} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="total_market_cap" name="Total Market Cap" stroke="#60a5fa" strokeWidth={2.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-400">
                      Market-structure history is temporarily unavailable.
                    </div>
                  )}
                </div>
                <ChartDataDisclosure
                  label="Leadership concentration chart summary"
                  description="The chart compares BTC dominance with total crypto market capitalization. Values below show the first and latest plotted observations."
                  rows={buildChartReadRows(marketStructureData, [
                    { label: "BTC dominance", read: (row) => row.btc_dominance_pct !== null && Number.isFinite(row.btc_dominance_pct) ? `${row.btc_dominance_pct.toFixed(2)}%` : "n/a" },
                    { label: "Market cap", read: (row) => formatCurrency(row.total_market_cap, true) },
                  ])}
                />
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded border border-stealth-700 bg-stealth-900/60 p-3">
                    <div className="text-xs text-stealth-400">Cross-asset Model Driver</div>
                    <div className="font-semibold text-stealth-100">{diagnosticContext.summary.primary_driver ?? "n/a"}</div>
                  </div>
                  <div className="rounded border border-stealth-700 bg-stealth-900/60 p-3">
                    <div className="text-xs text-stealth-400">Cross-asset Model Stress</div>
                    <div className="font-semibold text-stealth-100">{diagnosticContext.summary.stress_type ?? "n/a"}</div>
                  </div>
                  <div className="rounded border border-stealth-700 bg-stealth-900/60 p-3">
                    <div className="text-xs text-stealth-400">Correlation Regime</div>
                    <div className="font-semibold text-stealth-100">{diagnosticContext.summary.correlation_regime ?? "n/a"}</div>
                  </div>
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-stealth-100">Liquidity Plumbing & Alt Behavior</h3>
                  <p className="text-xs text-stealth-400">Normalized model pressure, 0–1. These values are not dollar balances, raw correlations or probabilities; a higher score does not by itself prove market stress.</p>
                  <p className="mt-1 text-xs text-stealth-300">Latest plotted: {signalPanelData[signalPanelData.length - 1]?.label ?? "unavailable"}</p>
                </div>
                <div className="h-72 min-w-0 w-full">
                  {hasSignalPanelData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={220}>
                    <LineChart
                      accessibilityLayer
                      aria-label="Crypto liquidity plumbing and alt-behavior signal history"
                      data={signalPanelData}
                      margin={CHART_MARGIN}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 12, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: CHART_NEUTRAL.label, fontWeight: 600 }}
                        formatter={(value: number, name: string) => [value?.toFixed(2), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: CHART_NEUTRAL.text }} />
                      <ReferenceLine y={0.33} stroke="#1e293b" strokeDasharray="4 4" />
                      <ReferenceLine y={0.67} stroke="#1e293b" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="stablecoin_supply" name="Stablecoin level pressure" stroke="#38bdf8" strokeWidth={2.2} dot={false} />
                      <Line type="monotone" dataKey="defi_tvl" name="TVL level pressure" stroke="#22c55e" strokeWidth={2.2} dot={false} />
                      <Line type="monotone" dataKey="btc_spy_correlation" name="BTC/SPY divergence pressure" stroke="#c084fc" strokeWidth={2.2} dot={false} />
                      <Line type="monotone" dataKey="altcoin_weakness" name="Alt Breadth Stress" stroke="#f97316" strokeWidth={2.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-400">
                      Signal history is temporarily unavailable.
                    </div>
                  )}
                </div>
                <ChartDataDisclosure
                  label="Crypto liquidity and breadth chart summary"
                  description="Signals use a normalized zero-to-one scale. Values below show the first and latest plotted observations."
                  rows={buildChartReadRows(signalPanelData, [
                    { label: "Stablecoin supply", read: (row) => formatSignal(row.stablecoin_supply) },
                    { label: "DeFi participation", read: (row) => formatSignal(row.defi_tvl) },
                    { label: "BTC equity correlation", read: (row) => formatSignal(row.btc_spy_correlation) },
                    { label: "Alt breadth stress", read: (row) => formatSignal(row.altcoin_weakness) },
                  ])}
                />
              </div>
            </div>
          )}

          {diagnosticError && (
            <div className="mb-6 rounded-xl border border-amber-600/60 bg-amber-950/20 p-4 text-sm text-amber-100" role="status">
              Diagnostic-context evidence is unavailable: {diagnosticError}
            </div>
          )}
        </div>
      )}

      {selectedTab === "deep-dive" && (
        <div
          id="crypto-deep-dive-panel"
          role="tabpanel"
          aria-labelledby="crypto-deep-dive-tab"
          className="space-y-6"
          tabIndex={0}
        >
          <div id="crypto-basket" className="section-anchor rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
            <p className="page-kicker">Definition</p>
            <h2 className="mb-2 mt-1 text-lg font-semibold text-stealth-100">Basket Design</h2>
            <p className="text-sm text-stealth-400 leading-relaxed">
              The monitored basket contains BTC, ETH, SOL and XRP. Its breadth and relative ranks describe these four assets; it is not a representative index of every cryptoasset.
            </p>
          </div>

          {diagnosticContext && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-400 mb-1">Stablecoin / BTC Ratio Pressure</div>
                <div className={`text-2xl font-bold ${getSignalTone(diagnosticContext.current_signals.stablecoin_btc_ratio)}`}>
                  {formatSignal(diagnosticContext.current_signals.stablecoin_btc_ratio)}
                </div>
                <div className="mt-2 text-xs text-stealth-400">The stablecoin/BTC-cap ratio versus its reference history, normalized to 0–1. It does not measure cash waiting to buy.</div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-400 mb-1">DeFi Participation</div>
                <div className={`text-2xl font-bold ${getSignalTone(diagnosticContext.current_signals.defi_tvl)}`}>
                  {formatSignal(diagnosticContext.current_signals.defi_tvl)}
                </div>
                <div className="mt-2 text-xs text-stealth-400">Normalized DeFi TVL level versus its reference history. Price changes can affect TVL without equivalent capital flows.</div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-400 mb-1">BTC / SPY Divergence Pressure</div>
                <div className={`text-2xl font-bold ${getSignalTone(diagnosticContext.current_signals.btc_spy_correlation)}`}>
                  {formatSignal(diagnosticContext.current_signals.btc_spy_correlation)}
                </div>
                <div className="mt-2 text-xs text-stealth-400">(1 − return correlation) / 2: 0.5 means zero correlation; 1 means −1 correlation. This does not establish hedging effectiveness.</div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-400 mb-1">Alt Breadth Stress</div>
                <div className={`text-2xl font-bold ${getSignalTone(diagnosticContext.current_signals.altcoin_weakness)}`}>
                  {formatSignal(diagnosticContext.current_signals.altcoin_weakness)}
                </div>
                <div className="mt-2 text-xs text-stealth-400">Shows whether speculative breadth is holding up or breaking back toward BTC defensiveness.</div>
              </div>
            </div>
          )}

          {resolvedAasData && cryptoComponents.length > 0 && (
            <CryptoSubsystemPanel
              components={cryptoComponents}
              contribution={resolvedAasData.crypto_contribution}
              rawHistory={resolvedComponentHistory?.data}
            />
          )}

          {(diagnosticError || aasError || componentHistoryError) && (
            <div className="rounded-xl border border-amber-600/60 bg-amber-950/20 p-4 text-sm text-amber-100" role="status">
              This view is partial. Some supporting evidence is unavailable; the current market overview remains visible.
            </div>
          )}
          <section id="crypto-method" className="section-anchor rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6" aria-labelledby="crypto-method-heading">
            <p className="page-kicker">Method & audit</p>
            <h2 id="crypto-method-heading" className="mb-2 mt-1 text-lg font-semibold text-stealth-100">
              How to read the crypto diagnostic
            </h2>
            <div className="grid gap-4 text-sm leading-6 text-stealth-300 lg:grid-cols-3">
              <div>
                <h3 className="font-semibold text-stealth-100">Market basket</h3>
                <p className="mt-1">
                  Price, breadth, dominance, and market-cap evidence describe the current crypto tape.
                  This is a diagnostic snapshot, not a forecast or trade signal.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-stealth-100">Subsystem evidence</h3>
                <p className="mt-1">
                  The subsystem is a cross-asset pressure model filtered to crypto components. Its scores describe transformations of observed inputs, not raw dollar flows or probabilities.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-stealth-100">Interpretation limits</h3>
                <p className="mt-1">
                  Normalize signals within their stated scale, check freshness and missing coverage,
                  and corroborate regime language with the disclosed chart values before acting.
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
