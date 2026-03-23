import { useMemo, useState } from "react";
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
import { MethodologyPanel } from "../components/aas/MethodologyPanel";
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
}

interface CryptoMarketOverviewResponse {
  as_of: string;
  summary: {
    btc_dominance: number | null;
    total_market_cap: number | null;
    market_cap_change_24h: number | null;
    advancing_assets_24h: number;
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
      return "text-red-400";
    default:
      return "text-stealth-400";
  }
};

export default function CryptoDiagnostic({
  embedded = false,
  aasData,
  componentHistory,
}: CryptoDiagnosticProps) {
  const { data: marketData, loading, error } = useApi<CryptoMarketOverviewResponse>("/crypto/market-overview?days=365");
  const { data: diagnosticContext } = useApi<CryptoDiagnosticContextResponse>("/crypto/diagnostic-context?days=365");
  const { data: fallbackAasData } = useApi<AASBreakdownData>(aasData ? "" : "/aas/components/breakdown");
  const { data: fallbackComponentHistory } = useApi<AASComponentHistoryResponse>(componentHistory ? "" : "/aas/components/history?days=365");
  const [selectedTab, setSelectedTab] = useState<"overview" | "deep-dive">("overview");
  const [timeframe, setTimeframe] = useState<30 | 90 | 180 | 365>(90);

  const resolvedAasData = aasData ?? fallbackAasData;
  const resolvedComponentHistory = componentHistory ?? fallbackComponentHistory;

  const cryptoComponents = useMemo(
    () => (resolvedAasData?.components ?? []).filter((component) => component.category === "crypto"),
    [resolvedAasData]
  );

  const cutoffDate = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - timeframe);
    return cutoff;
  }, [timeframe]);

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
            label: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
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
    const dominance = marketData.summary.btc_dominance ?? 0;
    const avg30d = marketData.assets.reduce((sum, asset) => sum + (asset.change_30d ?? 0), 0) / Math.max(marketData.assets.length, 1);

    if (breadth >= 3 && avg30d > 8) {
      return { label: "Broad Risk-On", detail: "Leadership is expanding beyond BTC and participation is healthy." };
    }
    if (dominance >= 58) {
      return { label: "Flight To Quality", detail: "BTC is carrying the tape while lower-beta crypto leadership dominates." };
    }
    if (avg30d < 0) {
      return { label: "Defensive Drift", detail: "The basket is softening and broad participation is fading." };
    }

    return { label: "Mixed Rotation", detail: "Crypto is active, but leadership is rotating rather than fully broadening out." };
  }, [marketData]);

  const marketStructureData = useMemo(
    () =>
      (marketData?.market_structure_history ?? [])
        .filter((point) => new Date(point.date) >= cutoffDate)
        .map((point) => ({
          ...point,
          label: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        })),
    [marketData, cutoffDate]
  );

  const signalPanelData = useMemo(
    () =>
      (diagnosticContext?.signal_history ?? [])
        .filter((point) => new Date(point.date) >= cutoffDate)
        .map((point) => ({
          ...point,
          label: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        })),
    [diagnosticContext, cutoffDate]
  );

  const cryptoProjections = useMemo<CryptoProjection[]>(() => {
    if (!marketData?.assets?.length) {
      return [];
    }

    return buildTechnicalProjections<CryptoAsset>([...marketData.assets]);
  }, [marketData]);

  const hasLargeCapChartData = largeCapChartData.length > 1;
  const hasSecondaryChartData = secondaryChartData.length > 1;
  const hasMarketStructureData = marketStructureData.length > 1;
  const hasSignalPanelData = signalPanelData.length > 1;

  if (loading) {
    return (
      <div className={embedded ? "py-8" : "p-6"}>
        <div className="flex justify-center py-6">
          <MarketLoading size={110} variant="pulse" label="Loading crypto diagnostic..." />
        </div>
      </div>
    );
  }

  if (error || !marketData) {
    return (
      <div className={embedded ? "py-8" : "p-6"}>
        <div className="bg-red-900/20 border border-red-700 text-red-200 p-4 rounded">
          Error loading crypto data: {error ?? "No data available."}
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "text-gray-200" : "p-3 md:p-6 text-gray-200"}>
      {!embedded && (
        <>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Crypto Diagnostic</h1>
          <p className="text-stealth-400 mb-6 text-sm md:text-base">
            A compact market-structure view built around BTC, ETH, SOL, and XRP to track digital monetary leadership,
            platform beta, speculative breadth, and the payments and regulatory lane inside crypto.
          </p>
        </>
      )}

      <div className="mb-6 bg-stealth-800 rounded-lg border border-stealth-700 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg md:text-xl font-bold mb-1 text-white">Crypto Regime Snapshot</h2>
            <p className="text-sm text-stealth-400 max-w-3xl">{regime.detail}</p>
          </div>
          <div className="rounded-full border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-200">
            {regime.label}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="rounded-lg border border-stealth-700 bg-stealth-900/60 p-4">
            <div className="text-xs text-stealth-400 mb-1">Total Crypto Market Cap</div>
            <div className="text-lg font-bold text-blue-300">{formatCurrency(marketData.summary.total_market_cap, true)}</div>
          </div>
          <div className="rounded-lg border border-stealth-700 bg-stealth-900/60 p-4">
            <div className="text-xs text-stealth-400 mb-1">BTC Dominance</div>
            <div className="text-lg font-bold text-amber-300">{marketData.summary.btc_dominance?.toFixed(2) ?? "n/a"}%</div>
          </div>
          <div className="rounded-lg border border-stealth-700 bg-stealth-900/60 p-4">
            <div className="text-xs text-stealth-400 mb-1">24H Breadth</div>
            <div className="text-lg font-bold text-emerald-300">
              {marketData.summary.advancing_assets_24h}/{marketData.summary.monitored_assets} advancing
            </div>
          </div>
          <div className="rounded-lg border border-stealth-700 bg-stealth-900/60 p-4">
            <div className="text-xs text-stealth-400 mb-1">Global MCAP Change</div>
            <div className={`text-lg font-bold ${getPercentColor(marketData.summary.market_cap_change_24h)}`}>
              {formatPercent(marketData.summary.market_cap_change_24h)}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 border-b border-stealth-700 flex gap-4">
        <button
          onClick={() => setSelectedTab("overview")}
          className={`pb-3 px-2 font-semibold border-b-2 transition ${
            selectedTab === "overview"
              ? "border-blue-500 text-blue-300"
              : "border-transparent text-stealth-400 hover:text-gray-300"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setSelectedTab("deep-dive")}
          className={`pb-3 px-2 font-semibold border-b-2 transition ${
            selectedTab === "deep-dive"
              ? "border-blue-500 text-blue-300"
              : "border-transparent text-stealth-400 hover:text-gray-300"
          }`}
        >
          Deep Dive
        </button>
      </div>

      {selectedTab === "overview" && (
        <>
          <div className="mb-6 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-stealth-100">Winners & Losers Right Now</h3>
              <p className="text-xs text-stealth-400">
                Competitive ranking across this four-asset basket based on trend strength, momentum, and exhaustion risk.
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {cryptoProjections.map((asset) => (
                <div key={asset.symbol} className={`rounded-lg border p-3 ${getRelativeClassColor(asset.relativeClassification)}`}>
                  <div className="mb-1 text-xs font-semibold">
                    #{asset.rank} <span style={{ color: asset.color }}>{asset.name}</span>
                  </div>
                  <div className="text-lg font-bold text-stealth-100">{formatCurrency(asset.current_price)}</div>
                  <div className="mt-1 text-xs">Score: {asset.score_total}/100</div>
                  <div className={`mt-1 text-xs font-semibold ${getClassificationColor(asset.classification)}`}>{asset.classification}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {cryptoProjections.map((asset) => (
                <div key={`${asset.symbol}-detail`} className="rounded-lg border border-stealth-700 bg-stealth-900/60 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-stealth-100">
                        <span style={{ color: asset.color }}>{asset.name}</span> ({asset.symbol})
                      </h4>
                      <div className="text-xs" style={{ color: asset.color }}>{asset.coin_id.toUpperCase()}</div>
                    </div>
                    <div className={`rounded border px-2 py-1 text-xs font-semibold ${getRelativeClassColor(asset.relativeClassification)}`}>
                      {asset.relativeClassification}
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-stealth-500">Current</div>
                      <div className="font-semibold text-stealth-100">{formatCurrency(asset.current_price)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-stealth-500">RSI</div>
                      <div className="font-semibold text-stealth-100">{asset.technicals.rsi?.toFixed(1) ?? "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-stealth-500">SMA 20</div>
                      <div className="font-semibold text-stealth-100">{formatCurrency(asset.technicals.sma_20)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-stealth-500">SMA 50</div>
                      <div className="font-semibold text-stealth-100">{formatCurrency(asset.technicals.sma_50)}</div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="mb-1 text-xs text-stealth-500">Momentum</div>
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
                      <div className="mb-1 text-stealth-500">Support Levels</div>
                      {asset.levels.support.length > 0 ? asset.levels.support.map((level: number, index: number) => (
                        <div key={`${asset.symbol}-support-${index}`} className="font-semibold text-green-400">
                          {formatCurrency(level)}
                        </div>
                      )) : <div className="text-stealth-500">None detected</div>}
                    </div>
                    <div>
                      <div className="mb-1 text-stealth-500">Resistance Levels</div>
                      {asset.levels.resistance.length > 0 ? asset.levels.resistance.map((level: number, index: number) => (
                        <div key={`${asset.symbol}-resistance-${index}`} className="font-semibold text-red-400">
                          {formatCurrency(level)}
                        </div>
                      )) : <div className="text-stealth-500">None detected</div>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-stealth-600 pt-3 text-xs">
                    <div>
                      <span className="text-stealth-400">Upper:</span>
                      <span className="ml-2 font-semibold text-green-400">{formatCurrency(asset.levels.take_profit)}</span>
                    </div>
                    <div>
                      <span className="text-stealth-400">Lower:</span>
                      <span className="ml-2 font-semibold text-red-400">{formatCurrency(asset.levels.stop_loss)}</span>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-stealth-600 pt-3">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-stealth-400">Trend Score:</span>
                      <span className="font-semibold">{asset.score_trend}/100</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-stealth-400">Momentum Score:</span>
                      <span className="font-semibold">{asset.score_momentum}/100</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded border-l-2 border-blue-500 bg-stealth-900/50 p-3 text-xs text-stealth-400">
              <strong>Technical Analysis:</strong> Projections are based on SMA crossovers (20/50/200), RSI, momentum,
              and recent support/resistance. Winner/Loser classification is relative across BTC, ETH, SOL, and XRP only.
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-stealth-100">Price Structure</h3>
                <p className="text-xs text-stealth-400">
                  Raw-price curves are separated by market tier so the leadership signal is readable without compressing BTC,
                  ETH, SOL, and XRP into one distorted axis.
                </p>
              </div>
              <div className="flex gap-2">
                {[30, 90, 180, 365].map((days) => (
                  <button
                    key={days}
                    onClick={() => setTimeframe(days as 30 | 90 | 180 | 365)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
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

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="min-w-0 rounded-lg border border-stealth-700 bg-stealth-900/60 p-4 xl:col-span-2">
                <div className="mb-3">
                  <h4 className="text-sm font-semibold text-stealth-100">BTC vs ETH</h4>
                  <p className="text-xs text-stealth-500">BTC stays on the left axis and ETH on the right so institutional leadership and smart-contract beta can diverge cleanly.</p>
                </div>
                <div className="h-80 min-w-0 w-full">
                  {hasLargeCapChartData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={largeCapChartData} margin={CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis
                        dataKey="label"
                        minTickGap={28}
                        tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={72}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={72}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: CHART_NEUTRAL.label, fontWeight: 600 }}
                        formatter={(value: number, name: string) => [formatAxisCurrency(value), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: CHART_NEUTRAL.text }} />
                      <Line yAxisId="left" type="monotone" dataKey="BTC" name="BTC" stroke="#f59e0b" strokeWidth={2.5} dot={false} connectNulls />
                      <Line yAxisId="right" type="monotone" dataKey="ETH" name="ETH" stroke="#60a5fa" strokeWidth={2.5} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-500">
                      Large-cap history is temporarily unavailable.
                    </div>
                  )}
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-stealth-700 bg-stealth-900/60 p-4">
                <div className="mb-3">
                  <h4 className="text-sm font-semibold text-stealth-100">SOL vs XRP</h4>
                  <p className="text-xs text-stealth-500">The higher-beta pair sits in a separate panel so alt rotation is visible without flattening the larger-cap leaders.</p>
                </div>
                <div className="h-80 min-w-0 w-full">
                  {hasSecondaryChartData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={secondaryChartData} margin={CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis
                        dataKey="label"
                        minTickGap={24}
                        tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={68}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }}
                        axisLine={{ stroke: CHART_NEUTRAL.axis }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value))}
                        width={68}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: CHART_NEUTRAL.label, fontWeight: 600 }}
                        formatter={(value: number, name: string) => [formatAxisCurrency(value), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: CHART_NEUTRAL.text }} />
                      <Line yAxisId="left" type="monotone" dataKey="SOL" name="SOL" stroke="#14b8a6" strokeWidth={2.4} dot={false} connectNulls />
                      <Line yAxisId="right" type="monotone" dataKey="XRP" name="XRP" stroke="#f472b6" strokeWidth={2.4} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-500">
                      Alt-rotation history is temporarily unavailable.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {diagnosticContext && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
              <div className="min-w-0 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-stealth-100">Leadership Concentration</h3>
                  <p className="text-xs text-stealth-400">BTC dominance versus total crypto market cap shows whether leadership is broadening out or collapsing back toward defensive concentration.</p>
                </div>
                <div className="h-72 min-w-0 w-full">
                  {hasMarketStructureData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={marketStructureData} margin={CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} width={56} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} tickFormatter={(value) => formatAxisCurrency(Number(value))} width={78} />
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
                      <Legend wrapperStyle={{ fontSize: 11, color: CHART_NEUTRAL.text }} />
                      <ReferenceLine yAxisId="left" y={60} stroke="#64748b" strokeDasharray="4 4" />
                      <Line yAxisId="left" type="monotone" dataKey="btc_dominance_pct" name="BTC Dominance" stroke="#fbbf24" strokeWidth={2.4} dot={false} connectNulls />
                      <Line yAxisId="right" type="monotone" dataKey="total_market_cap" name="Total Market Cap" stroke="#60a5fa" strokeWidth={2.2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-500">
                      Market-structure history is temporarily unavailable.
                    </div>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded border border-stealth-700 bg-stealth-900/60 p-3">
                    <div className="text-xs text-stealth-500">Primary Driver</div>
                    <div className="font-semibold text-stealth-100">{diagnosticContext.summary.primary_driver ?? "n/a"}</div>
                  </div>
                  <div className="rounded border border-stealth-700 bg-stealth-900/60 p-3">
                    <div className="text-xs text-stealth-500">Stress Type</div>
                    <div className="font-semibold text-stealth-100">{diagnosticContext.summary.stress_type ?? "n/a"}</div>
                  </div>
                  <div className="rounded border border-stealth-700 bg-stealth-900/60 p-3">
                    <div className="text-xs text-stealth-500">Correlation Regime</div>
                    <div className="font-semibold text-stealth-100">{diagnosticContext.summary.correlation_regime ?? "n/a"}</div>
                  </div>
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-stealth-100">Liquidity Plumbing & Alt Behavior</h3>
                  <p className="text-xs text-stealth-400">AAS crypto signals on a normalized 0 to 1 scale. The reference bands help separate benign plumbing from a more defensive or stress-heavy tape.</p>
                </div>
                <div className="h-72 min-w-0 w-full">
                  {hasSignalPanelData ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={signalPanelData} margin={CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: CHART_NEUTRAL.tick }} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: CHART_NEUTRAL.label, fontWeight: 600 }}
                        formatter={(value: number, name: string) => [value?.toFixed(2), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: CHART_NEUTRAL.text }} />
                      <ReferenceLine y={0.33} stroke="#1e293b" strokeDasharray="4 4" />
                      <ReferenceLine y={0.67} stroke="#1e293b" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="stablecoin_supply" name="Stablecoin Supply" stroke="#38bdf8" strokeWidth={2.2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="defi_tvl" name="DeFi Participation" stroke="#22c55e" strokeWidth={2.2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="btc_spy_correlation" name="BTC Equity Correlation" stroke="#c084fc" strokeWidth={2.2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="altcoin_weakness" name="Alt Breadth Stress" stroke="#f97316" strokeWidth={2.2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-stealth-700 bg-stealth-950/40 text-sm text-stealth-500">
                      Signal history is temporarily unavailable.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </>
      )}

      {selectedTab === "deep-dive" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4 md:p-6">
            <h3 className="text-lg font-semibold text-stealth-100 mb-2">Basket Design</h3>
            <p className="text-sm text-stealth-400 leading-relaxed">
              BTC anchors the monetary-store-of-value lane, ETH captures smart-contract core beta, SOL adds higher-beta speculative and throughput-sensitive behavior,
              and XRP adds a payments and regulatory-narrative lane. It is not a full ecosystem map, but it is a compact and defensible top-level market read.
            </p>
          </div>

          {diagnosticContext && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-500 mb-1">Stablecoin Dry Powder</div>
                <div className={`text-2xl font-bold ${getSignalTone(diagnosticContext.current_signals.stablecoin_btc_ratio)}`}>
                  {formatSignal(diagnosticContext.current_signals.stablecoin_btc_ratio)}
                </div>
                <div className="mt-2 text-xs text-stealth-400">Higher values suggest more sidelined capital relative to BTC market value.</div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-500 mb-1">DeFi Participation</div>
                <div className={`text-2xl font-bold ${getSignalTone(diagnosticContext.current_signals.defi_tvl)}`}>
                  {formatSignal(diagnosticContext.current_signals.defi_tvl)}
                </div>
                <div className="mt-2 text-xs text-stealth-400">Tracks whether on-chain participation is supporting the broader crypto complex.</div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-500 mb-1">BTC Alternative Behavior</div>
                <div className={`text-2xl font-bold ${getSignalTone(diagnosticContext.current_signals.btc_spy_correlation)}`}>
                  {formatSignal(diagnosticContext.current_signals.btc_spy_correlation)}
                </div>
                <div className="mt-2 text-xs text-stealth-400">Higher normalized readings mean BTC is acting more like an alternative asset than plain risk beta.</div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-800 p-4">
                <div className="text-xs text-stealth-500 mb-1">Alt Breadth Stress</div>
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

          <MethodologyPanel />
        </div>
      )}
    </div>
  );
}