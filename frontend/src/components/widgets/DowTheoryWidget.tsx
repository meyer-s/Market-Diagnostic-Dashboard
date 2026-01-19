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
  type TooltipProps,
} from "recharts";
import { apiFetch } from "../../utils/apiUtils";
import { CHART_MARGIN, CHART_NEUTRAL, commonGridProps } from "../../utils/chartUtils";
import { formatTime } from "../../utils/styleUtils";
import {
  analyzeSeries,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";
import { useProgressiveCommitment } from "../../hooks/useProgressiveCommitment";
import { getFamilyColor } from "../../theme/metricColors";
import { dashboardCardDetails } from "../../config/dashboardCards";

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

const DowTheoryWidget = ({ trendPeriod = 90, onInsight }: DowTheoryWidgetProps) => {
  const [data, setData] = useState<DowTheoryData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const commitment = useProgressiveCommitment({ mode: "inline" });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const historyUrl = trendPeriod
          ? `/dow-theory/history?days=${trendPeriod}`
          : "/dow-theory/history";
        const [currentData, historyData] = await Promise.all([
          apiFetch<DowTheoryData>("/dow-theory"),
          apiFetch<HistoryPoint[]>(historyUrl),
        ]);

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
    const interval = setInterval(fetchData, 60000);

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
  const dowConfidence = getConfidenceFromSignal(primaryGapSignal);
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
  const signalLine =
    alignmentState === "ALIGNED"
      ? "Signals aligned"
      : alignmentState === "MIXED"
      ? "Signals mixed"
      : alignmentState === "DIVERGENT"
      ? "Signals split"
      : "Signals unclear";
  const contextLine = dashboardCardDetails.dow.context;
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
        confidence: dowConfidence,
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
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-stealth-700 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-stealth-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-2">Dow Theory Trends</h3>
        <p className="text-stealth-400 text-sm">{error || "No data available"}</p>
      </div>
    );
  }

  const alignmentColor = {
    ALIGNED: "text-green-400",
    MIXED: "text-yellow-400",
    DIVERGENT: "text-red-500",
    UNKNOWN: "text-gray-500",
  }[data.theory_alignment_state];

  const directionSpread = data.direction_spread ?? 0;
  const spreadLabel = directionSpread > 0 ? "above" : directionSpread < 0 ? "below" : "even";
  const focusLine = `Confidence: ${dowConfidence} - spread ${spreadTrendPhrase}`;
  const classicLineColor = getFamilyColor("market", "base");
  const modernLineColor = getFamilyColor("market", "muted");

  const stabilityScore = Math.max(0, Math.min(100, 100 - data.strain_score));
  const stabilityLevel: StabilityLevel =
    data.strain_level === "UNKNOWN" ? "UNKNOWN" : getStabilityLevel(stabilityScore);
  const modernDefensiveOutperformance = Math.max(0, data.modern_defensive_outperformance ?? 0);
  const modernStrainScore = Math.min(100, (data.modern_divergence + modernDefensiveOutperformance) * 2);
  const modernStabilityScore = Math.max(0, Math.min(100, 100 - modernStrainScore));

  const renderTrendTooltip = ({ active, label, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload as HistoryPoint;
    const modernValue = point.modern_direction;
    const spreadValue =
      typeof point.direction_spread === "number"
        ? point.direction_spread
        : typeof modernValue === "number"
        ? modernValue - point.market_direction
        : null;

    return (
      <div className="bg-stealth-900 border border-stealth-700 rounded-md px-2 py-2 text-xs text-stealth-100 shadow-lg">
        <div className="text-[11px] text-stealth-400 mb-1">
          {label ? new Date(label).toLocaleDateString() : ""}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-stealth-300">Classic</span>
          <span>{point.market_direction.toFixed(2)}%</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-stealth-300">Modern</span>
          <span>{typeof modernValue === "number" ? `${modernValue.toFixed(2)}%` : "N/A"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-stealth-300">Spread</span>
          <span>{spreadValue === null ? "N/A" : `${spreadValue > 0 ? "+" : ""}${spreadValue.toFixed(2)}%`}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      {...commitment.getContainerProps<HTMLDivElement>()}
      className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-6 space-y-4 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stealth-500/60"
      aria-expanded={commitment.isExpanded}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base sm:text-lg font-semibold text-stealth-100">Dow Theory Trends</h3>
        <span className="text-xs text-stealth-400">{formatTime(data.timestamp)}</span>
      </div>
      <div className="text-sm text-stealth-200">
        <span className="text-stealth-500">Signal:</span> {signalLine}
      </div>
      <div className="text-sm text-stealth-400">
        <span className="text-stealth-500">Context:</span> {contextLine}
      </div>
      {commitment.state === "focus" && (
        <div className="text-xs text-stealth-500 transition-opacity duration-150 motion-reduce:transition-none">
          {focusLine} (recent {recentSpreadPhrase})
        </div>
      )}

      {commitment.isExpanded && (
        <div className="pt-3 border-t border-stealth-700 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-stealth-300">
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Alignment</div>
              <div className={`mt-1 text-sm font-semibold ${alignmentColor}`}>
                {data.theory_alignment_state}
              </div>
              <div className="text-xs text-stealth-400">Score {data.theory_alignment_score}</div>
            </div>
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Spread</div>
              <div className="mt-1 text-sm text-stealth-200">
                {directionSpread > 0 ? "+" : ""}{directionSpread.toFixed(2)}% ({spreadLabel})
              </div>
            </div>
          </div>
          <div className="text-xs text-stealth-300 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-stealth-500">Why it matters</div>
            <p>{dashboardCardDetails.dow.why}</p>
          </div>
          <div className="text-xs text-stealth-300 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-stealth-500">Related signals</div>
            <div className="flex flex-wrap gap-2">
              {dashboardCardDetails.dow.related.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 rounded-full border border-stealth-600 bg-stealth-900 px-2 py-1 text-[11px] text-stealth-300"
                >
                  {item.label}
                  <span className="text-stealth-500">-</span>
                  {item.reason}
                </span>
              ))}
            </div>
          </div>
          <div className="text-xs text-stealth-300 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-stealth-500">Methodology note</div>
            <p>{dashboardCardDetails.dow.methodology}</p>
          </div>

          {chartHistory.length > 0 && (
            <div className="pt-2 border-t border-stealth-700">
              <h4 className="text-sm font-semibold text-stealth-200 mb-3">Market Direction Trends</h4>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartHistory} margin={CHART_MARGIN}>
                    <CartesianGrid {...commonGridProps} />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(v: string) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      stroke={CHART_NEUTRAL.axis}
                    />
                    <YAxis
                      yAxisId="primary"
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      stroke={CHART_NEUTRAL.axis}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip content={renderTrendTooltip} />
                    <ReferenceLine
                      yAxisId="primary"
                      y={7.5}
                      stroke={CHART_NEUTRAL.benchmark}
                      strokeDasharray="4 4"
                    />
                    <ReferenceLine
                      yAxisId="primary"
                      y={-7.5}
                      stroke={CHART_NEUTRAL.benchmark}
                      strokeDasharray="4 4"
                    />
                    <ReferenceLine
                      yAxisId="primary"
                      y={0}
                      stroke={CHART_NEUTRAL.benchmark}
                      strokeDasharray="3 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="market_direction"
                      name="Classic"
                      yAxisId="primary"
                      stroke={classicLineColor}
                      strokeWidth={2}
                      dot={false}
                      animationDuration={300}
                    />
                    <Line
                      type="monotone"
                      dataKey="modern_direction"
                      name="Modern"
                      yAxisId="primary"
                      stroke={modernLineColor}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3 text-xs text-stealth-300">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Classic snapshot</div>
              <div className="mt-2 space-y-1">
                <div>Direction: {data.direction_state}</div>
                <div>Stability: {stabilityLevel} ({stabilityScore.toFixed(1)})</div>
                <div>DJI/DJT/DJU: {data.components.dji_roc}% / {data.components.djt_roc}% / {data.components.dju_roc}%</div>
              </div>
            </div>
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3 text-xs text-stealth-300">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Modern snapshot</div>
              <div className="mt-2 space-y-1">
                <div>Direction: {data.modern_direction_state}</div>
                <div>Stability: {getStabilityLevel(modernStabilityScore)} ({modernStabilityScore.toFixed(1)})</div>
                <div>DIA/IYT/XLU: {data.modern_components.dia_roc}% / {data.modern_components.iyt_roc}% / {data.modern_components.xlu_roc}%</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DowTheoryWidget;
