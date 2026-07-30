import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  type TooltipContentProps,
} from "recharts";
import { getLegacyApiUrl } from "../../utils/apiUtils";
import { CHART_MARGIN } from "../../utils/chartUtils";
import { formatTime } from "../../utils/styleUtils";
import {
  analyzeSeries,
  getTrendTone,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";

interface DowTheoryData {
  timestamp: string;
  market_direction: number;
  direction_state: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
  signal_strength: "WEAK" | "MODERATE" | "STRONG";
  confirmation_state: "BULL" | "BEAR" | "MIXED";
  strain_score: number;
  strain_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNKNOWN";
  divergence: number;
  util_outperformance: number;
  etf_direction: number | null;
  futures_direction: number | null;
  modern_direction: number;
  modern_direction_state: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
  modern_signal_strength: "WEAK" | "MODERATE" | "STRONG";
  modern_divergence: number;
  modern_defensive_outperformance: number;
  modern_etf_direction: number | null;
  modern_futures_direction: number | null;
  direction_spread: number;
  theory_alignment_score: number;
  theory_alignment_state: "ALIGNED" | "MIXED" | "DIVERGENT" | "UNKNOWN";
  components: {
    dji_roc: number;
    djt_roc: number;
    dju_roc: number;
    alignment_score: number;
  };
  modern_components: {
    dia_roc: number;
    iyt_roc: number;
    xlu_roc: number;
    alignment_score: number;
  };
}

interface HistoryPoint {
  timestamp: string;
  market_direction: number;
  modern_direction?: number | null;
  direction_spread?: number | null;
}

interface DowTheoryWidgetProps {
  trendPeriod?: number;
  onInsight?: (insight: InsightSignal) => void;
}

type StabilityLevel = "HIGH" | "MODERATE" | "LOW" | "VERY LOW" | "UNKNOWN";

const getStabilityLevel = (score: number): StabilityLevel => {
  if (score >= 75) return "HIGH";
  if (score >= 50) return "MODERATE";
  if (score >= 25) return "LOW";
  return "VERY LOW";
};

const getStabilityColor = (level: StabilityLevel) =>
  ({
    HIGH: "text-green-400",
    MODERATE: "text-yellow-400",
    LOW: "text-orange-400",
    "VERY LOW": "text-red-500",
    UNKNOWN: "text-stealth-500",
  }[level]);

const DowTheoryWidget = ({ trendPeriod = 90, onInsight }: DowTheoryWidgetProps) => {
  const [data, setData] = useState<DowTheoryData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = getLegacyApiUrl();
        const historyUrl = trendPeriod
          ? `${apiUrl}/dow-theory/history?days=${trendPeriod}`
          : `${apiUrl}/dow-theory/history`;
        const [currentResponse, historyResponse] = await Promise.all([
          fetch(`${apiUrl}/dow-theory`),
          fetch(historyUrl),
        ]);

        if (!currentResponse.ok) throw new Error("Failed to fetch Dow Theory data");
        if (!historyResponse.ok) throw new Error("Failed to fetch history");

        const currentData = await currentResponse.json();
        const historyData = await historyResponse.json();

        setData(currentData);
        setHistory(historyData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, [trendPeriod]);

  const chartHistory = history;
  const trendWindows = getTrendWindows(trendPeriod);
  const spreadSeries = chartHistory
    .map((point) =>
      typeof point.direction_spread === "number"
        ? point.direction_spread
        : point.modern_direction !== null && point.modern_direction !== undefined
        ? point.modern_direction - point.market_direction
        : null
    )
    .filter((value): value is number => typeof value === "number");
  const spreadAbsSeries = spreadSeries.map((value) => Math.abs(value));
  const primaryGapSignal = analyzeSeries(spreadAbsSeries, {
    ...trendWindows.primary,
    flatThreshold: 0.08,
  });
  const secondaryGapSignal = analyzeSeries(spreadAbsSeries, {
    ...trendWindows.secondary,
    flatThreshold: 0.08,
  });
  const spreadTrendPhrase =
    primaryGapSignal.direction === "up"
      ? "widening"
      : primaryGapSignal.direction === "down"
      ? "tightening"
      : "steady";
  const recentSpreadPhrase =
    secondaryGapSignal.direction === "up"
      ? "widening"
      : secondaryGapSignal.direction === "down"
      ? "tightening"
      : "steady";
  const gapTone = getTrendTone(primaryGapSignal);
  const toneClause = gapTone === "mixed" ? "" : ` It feels ${gapTone}.`;
  const classicSeries = chartHistory.map((point) => point.market_direction);
  const modernSeries = chartHistory
    .map((point) => point.modern_direction)
    .filter((value): value is number => typeof value === "number");
  const primaryClassic = analyzeSeries(classicSeries, trendWindows.primary);
  const primaryModern = analyzeSeries(modernSeries, trendWindows.primary);
  const secondaryClassic = analyzeSeries(classicSeries, trendWindows.secondary);
  const secondaryModern = analyzeSeries(modernSeries, trendWindows.secondary);
  const primaryDirection =
    primaryClassic.direction === primaryModern.direction ? primaryClassic.direction : "flat";
  const secondaryDirection =
    secondaryClassic.direction === secondaryModern.direction ? secondaryClassic.direction : "flat";
  const alignmentState = data?.theory_alignment_state ?? "UNKNOWN";
  let stance: InsightSignal["stance"] = "mixed";
  if (alignmentState === "ALIGNED") {
    stance =
      primaryDirection === "up" ? "risk-on" : primaryDirection === "down" ? "risk-off" : "mixed";
  } else if (alignmentState === "DIVERGENT") {
    stance = "risk-off";
  }
  const summaryShort =
    alignmentState === "ALIGNED"
      ? `aligned, ${trendWindows.shortLabel} ${primaryDirection}`
      : alignmentState === "MIXED"
      ? `mixed, ${trendWindows.shortLabel} ${primaryDirection}`
      : alignmentState === "DIVERGENT"
      ? `split, ${trendWindows.shortLabel} ${primaryDirection}`
      : "unclear";
  const dowInsight: InsightSignal | null = data
    ? {
        id: "dow",
        label: "Dow",
        primaryDirection,
        secondaryDirection,
        stance,
        confidence: getConfidenceFromSignal(primaryGapSignal),
        summary: summaryShort,
      }
    : null;

  useEffect(() => {
    if (!onInsight || !dowInsight) return;
    onInsight(dowInsight);
  }, [
    onInsight,
    dowInsight?.primaryDirection,
    dowInsight?.secondaryDirection,
    dowInsight?.stance,
    dowInsight?.confidence,
    dowInsight?.summary,
  ]);


  if (loading) {
    return (
      <div className="primary-card p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-stealth-700 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-stealth-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="primary-card p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-2">
          Dow Theory Trends
        </h3>
        <p className="text-stealth-400 text-sm">
          {error || "No data available"}
        </p>
      </div>
    );
  }

  // Color mappings
  const directionColor = {
    UP: "text-green-400",
    DOWN: "text-red-400",
    NEUTRAL: "text-stealth-400",
    UNKNOWN: "text-stealth-500",
  }[data.direction_state];

  const confirmColor = {
    BULL: "text-green-400",
    BEAR: "text-red-400",
    MIXED: "text-orange-400",
  }[data.confirmation_state];

  const signalColor = {
    STRONG: "text-cyan-400",
    MODERATE: "text-stealth-300",
    WEAK: "text-stealth-500",
  }[data.signal_strength];

  const modernDirectionColor = {
    UP: "text-green-400",
    DOWN: "text-red-400",
    NEUTRAL: "text-stealth-400",
    UNKNOWN: "text-stealth-500",
  }[data.modern_direction_state];

  const modernSignalColor = {
    STRONG: "text-cyan-400",
    MODERATE: "text-stealth-300",
    WEAK: "text-stealth-500",
  }[data.modern_signal_strength];

  const alignmentColor = {
    ALIGNED: "text-green-400",
    MIXED: "text-yellow-400",
    DIVERGENT: "text-red-500",
    UNKNOWN: "text-stealth-500",
  }[data.theory_alignment_state];

  const alignmentBarColor = {
    ALIGNED: "bg-green-500",
    MIXED: "bg-yellow-500",
    DIVERGENT: "bg-red-500",
    UNKNOWN: "bg-stealth-600",
  }[data.theory_alignment_state];

  const stabilityScore = Math.max(0, Math.min(100, 100 - data.strain_score));
  const stabilityLevel: StabilityLevel =
    data.strain_level === "UNKNOWN" ? "UNKNOWN" : getStabilityLevel(stabilityScore);
  const stabilityColor = getStabilityColor(stabilityLevel);

  const modernDefensiveOutperformance = Math.max(
    0,
    data.modern_defensive_outperformance ?? 0
  );
  const modernStrainScore = Math.min(
    100,
    (data.modern_divergence + modernDefensiveOutperformance) * 2
  );
  const modernStabilityScore = Math.max(0, Math.min(100, 100 - modernStrainScore));
  const modernStabilityLevel = getStabilityLevel(modernStabilityScore);
  const modernStabilityColor = getStabilityColor(modernStabilityLevel);

  const directionSpread = data.direction_spread ?? 0;
  const directionSpreadClass =
    directionSpread > 0 ? "text-green-400" : directionSpread < 0 ? "text-red-400" : "text-stealth-200";
  const alignmentPercentage = Math.max(0, Math.min(100, data.theory_alignment_score));

  const primaryClause =
    primaryDirection === "flat"
      ? `${trendWindows.label} is mixed.`
      : `${trendWindows.label} points ${primaryDirection}.`;
  const secondaryClause =
    secondaryDirection === primaryDirection
      ? "Recent move agrees."
      : secondaryDirection === "flat"
      ? "Recent move is mixed."
      : `Recent move points ${secondaryDirection}.`;
  const gapClause =
    secondaryGapSignal.direction === primaryGapSignal.direction
      ? `Gap is ${spreadTrendPhrase}.`
      : `Gap is ${spreadTrendPhrase}, but the recent move is ${recentSpreadPhrase}.`;
  const dowSummary =
    data.theory_alignment_state === "ALIGNED"
      ? `Checks whether classic and modern signals agree. ${primaryClause} ${gapClause}${toneClause} ${secondaryClause} The trend is more coherent across signals.`
      : data.theory_alignment_state === "MIXED"
      ? `Checks whether classic and modern signals agree. ${primaryClause} ${gapClause}${toneClause} ${secondaryClause} The trend is less coherent across signals.`
      : data.theory_alignment_state === "DIVERGENT"
      ? `Checks whether classic and modern signals agree. ${primaryClause} ${gapClause}${toneClause} ${secondaryClause} Signals are divergent and conditions look choppy.`
      : `Checks whether classic and modern signals agree. Alignment is unclear, so interpret with caution.`;

  const renderTrendTooltip = ({
    active,
    label,
    payload,
  }: TooltipContentProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload as HistoryPoint;
    const modernValue = point.modern_direction;
    const spreadValue =
      typeof point.direction_spread === "number"
        ? point.direction_spread
        : typeof modernValue === "number"
        ? modernValue - point.market_direction
        : null;
    const spreadClass =
      spreadValue === null
        ? "text-stealth-400"
        : spreadValue > 0
        ? "text-green-400"
        : spreadValue < 0
        ? "text-red-400"
        : "text-stealth-100";

    return (
      <div className="bg-stealth-900 border border-stealth-700 rounded-md px-2 py-2 text-xs text-stealth-100 shadow-lg">
        <div className="text-xs text-stealth-400 mb-1">
          {label ? new Date(label).toLocaleDateString() : ""}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-blue-300">Classic</span>
          <span>{point.market_direction.toFixed(2)}%</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-amber-300">Modern</span>
          <span>
            {typeof modernValue === "number"
              ? `${modernValue.toFixed(2)}%`
              : "N/A"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-orange-300">Spread</span>
          <span className={spreadClass}>
            {spreadValue === null
              ? "N/A"
              : `${spreadValue > 0 ? "+" : ""}${spreadValue.toFixed(2)}%`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="primary-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-stealth-100">
          Dow Theory Trends
        </h3>
        <span className="text-xs text-stealth-400">
          {formatTime(data.timestamp)}
        </span>
      </div>

      <div className="secondary-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-stealth-200">
              Classic vs Modern Alignment
            </div>
            <p className="text-xs text-stealth-400">
              Higher score means classic DJI/DJT and modern ETF proxies confirm
              the same economic trend.
            </p>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${alignmentColor}`}>
              {data.theory_alignment_score.toFixed(1)}
            </div>
            <div className={`text-xs font-semibold ${alignmentColor}`}>
              {data.theory_alignment_state}
            </div>
          </div>
        </div>
        <div className="relative h-2 bg-stealth-800 rounded-full overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-full transition-all duration-500 ${alignmentBarColor}`}
            style={{ width: `${alignmentPercentage}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-stealth-400">Spread (Modern - Classic)</span>
          <span className={`font-semibold ${directionSpreadClass}`}>
            {directionSpread > 0 ? "+" : ""}
            {directionSpread.toFixed(2)}%
          </span>
        </div>
      </div>
      {chartHistory.length > 0 && (
        <div className="pt-2 border-t border-stealth-700">
          <h4 className="text-sm font-semibold text-stealth-200 mb-3">
            Market Direction Trends
          </h4>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart
                accessibilityLayer
                aria-label="Dow Theory classic and modern market-direction history"
                data={chartHistory}
                margin={CHART_MARGIN}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(v: string) =>
                    new Date(v).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  tick={{ fill: "#6b7280", fontSize: 12 }}
                  stroke="#555560"
                />
                <YAxis
                  yAxisId="primary"
                  tick={{ fill: "#6b7280", fontSize: 12 }}
                  stroke="#555560"
                  domain={["auto", "auto"]}
                />
                <Tooltip content={renderTrendTooltip} />
                <ReferenceLine yAxisId="primary" y={7.5} stroke="#22c55e" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="primary" y={-7.5} stroke="#f87171" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="primary" y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="market_direction"
                  name="Classic"
                  yAxisId="primary"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                  animationDuration={300}
                />
                <Line
                  type="monotone"
                  dataKey="modern_direction"
                  name="Modern"
                  yAxisId="primary"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-stealth-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="secondary-card p-3 text-xs text-stealth-300">
            <div className="text-xs uppercase tracking-wide text-stealth-500">Classic snapshot</div>
            <div className="mt-2 space-y-1">
              <div>
                Direction: <span className={`font-semibold ${directionColor}`}>{data.direction_state}</span>
              </div>
              <div>
                Stability: <span className={`font-semibold ${stabilityColor}`}>{stabilityLevel}</span>{" "}
                ({stabilityScore.toFixed(1)})
              </div>
              <div>
                Confirmation: <span className={`font-semibold ${confirmColor}`}>{data.confirmation_state}</span>
              </div>
              <div>
                Signal: <span className={`font-semibold ${signalColor}`}>{data.signal_strength}</span>
              </div>
              <div>
                DJI/DJT/DJU: {data.components.dji_roc}% / {data.components.djt_roc}% / {data.components.dju_roc}%
              </div>
            </div>
          </div>
          <div className="secondary-card p-3 text-xs text-stealth-300">
            <div className="text-xs uppercase tracking-wide text-stealth-500">Modern snapshot</div>
            <div className="mt-2 space-y-1">
              <div>
                Direction: <span className={`font-semibold ${modernDirectionColor}`}>{data.modern_direction_state}</span>
              </div>
              <div>
                Stability: <span className={`font-semibold ${modernStabilityColor}`}>{modernStabilityLevel}</span>{" "}
                ({modernStabilityScore.toFixed(1)})
              </div>
              <div>
                Confirmation: <span className={`font-semibold ${confirmColor}`}>{data.confirmation_state}</span>
              </div>
              <div>
                Signal: <span className={`font-semibold ${modernSignalColor}`}>{data.modern_signal_strength}</span>
              </div>
              <div>
                DIA/IYT/XLU: {data.modern_components.dia_roc}% / {data.modern_components.iyt_roc}% / {data.modern_components.xlu_roc}%
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-3">
        <div className="secondary-card p-3">
          <p className="text-xs text-stealth-300 leading-relaxed">{dowSummary}</p>
        </div>
      </div>

    </div>
  );
};

export default DowTheoryWidget;
