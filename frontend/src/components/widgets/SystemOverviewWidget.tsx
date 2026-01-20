import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../utils/apiUtils";
import { calculateMovingAverage } from "../../utils/componentUtils";
import { formatTime } from "../../utils/styleUtils";
import { STABILITY_THRESHOLDS } from "../../utils/stabilityConstants";
import {
  Bar,
  BarChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  analyzeSeries,
  getTrendTone,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";
import { useProgressiveCommitment } from "../../hooks/useProgressiveCommitment";
import { getFamilyColor, getMetricColor } from "../../theme/metricColors";
import { CHART_ANIMATION, CHART_MARGIN, CHART_NEUTRAL, commonGridProps } from "../../utils/chartUtils";

interface SystemStatus {
  state: string;
  composite_score: number;
  red_count: number;
  yellow_count: number;
  timestamp?: string;
}

interface SystemHistoryPoint {
  timestamp: string;
  composite_score: number;
  state: string;
  contributions?: Record<string, number>;
}

interface Props {
  trendPeriod?: 90 | 180 | 365;
  onInsight?: (insight: InsightSignal) => void;
}

interface IndicatorMeta {
  code: string;
  name: string;
}

const SystemOverviewWidget = ({ trendPeriod = 90, onInsight }: Props) => {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [history, setHistory] = useState<SystemHistoryPoint[]>([]);
  const [indicatorLabels, setIndicatorLabels] = useState<Record<string, string>>({});
  const [indicatorOrder, setIndicatorOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const commitment = useProgressiveCommitment({
    mode: "navigate",
    onCommit: () => navigate("/system-breakdown"),
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const historyUrl = `/system/history?days=${trendPeriod}`;
        const [statusData, historyData, indicatorData] = await Promise.all([
          apiFetch<SystemStatus>("/system"),
          apiFetch<SystemHistoryPoint[]>(historyUrl),
          apiFetch<IndicatorMeta[]>("/indicators"),
        ]);

        setData(statusData);
        setIndicatorOrder(indicatorData.map((indicator) => indicator.code));
        setIndicatorLabels(
          indicatorData.reduce<Record<string, string>>((acc, indicator) => {
            acc[indicator.code] = indicator.name;
            return acc;
          }, {})
        );

        if (Array.isArray(historyData) && historyData.length > 0) {
          const smoothedHistory = calculateMovingAverage(historyData, "composite_score", 7);
          setHistory(smoothedHistory);
        } else {
          setHistory([
            {
              timestamp: statusData.timestamp || new Date().toISOString(),
              composite_score: statusData.composite_score,
              state: statusData.state,
            },
          ]);
        }

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

  const scoreSeries = history.map((point) => point.composite_score);
  const trendWindows = getTrendWindows(trendPeriod);
  const primarySignal = analyzeSeries(scoreSeries, trendWindows.primary);
  const secondarySignal = analyzeSeries(scoreSeries, trendWindows.secondary);
  const systemInsight = (() => {
    if (!data) return null;
    const insightSummary = `${trendWindows.shortLabel} ${primarySignal.direction}${
      secondarySignal.direction === primarySignal.direction
        ? ""
        : ` / recent ${secondarySignal.direction}`
    }`;
    return {
      id: "system",
      label: "System",
      primaryDirection: primarySignal.direction,
      secondaryDirection: secondarySignal.direction,
      stance: data.state === "GREEN" ? "risk-on" : data.state === "RED" ? "risk-off" : "mixed",
      confidence: getConfidenceFromSignal(primarySignal),
      summary: insightSummary,
    } satisfies InsightSignal;
  })();

  useEffect(() => {
    if (!onInsight || !systemInsight) return;
    onInsight(systemInsight);
  }, [
    onInsight,
    systemInsight?.primaryDirection,
    systemInsight?.secondaryDirection,
    systemInsight?.stance,
    systemInsight?.confidence,
    systemInsight?.summary,
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
        <h3 className="text-lg font-semibold text-red-400 mb-2">System Overview</h3>
        <p className="text-stealth-400 text-sm">{error || "No data available"}</p>
      </div>
    );
  }

  const trendTone = getTrendTone(primarySignal);
  const systemConfidence = getConfidenceFromSignal(primarySignal);
  const stateWord =
    data.state === "GREEN" ? "stable" : data.state === "RED" ? "stressed" : "mixed";
  const primaryWord =
    primarySignal.direction === "up"
      ? "improving"
      : primarySignal.direction === "down"
      ? "softening"
      : "steady";
  const signalLine = `System ${stateWord}, ${primaryWord}`;
  const contextLine = "Volatility, rates, liquidity, sentiment";
  const nearBoundary =
    Math.min(
      Math.abs(data.composite_score - STABILITY_THRESHOLDS.RED_MAX),
      Math.abs(data.composite_score - STABILITY_THRESHOLDS.YELLOW_MAX)
    ) <= 3;
  const toneLabel = trendTone === "mixed" ? "mixed trend" : `${trendTone} trend`;
  const focusLine = `Confidence: ${systemConfidence} - ${toneLabel}${nearBoundary ? ", near boundary" : ""}`;
  const miniSeries = history.map((point) => ({
    timestamp: point.timestamp,
    composite_score: point.composite_score,
  }));
  const showDetails = commitment.state !== "rest";
  const detailWrapClass = `overflow-hidden transition-[max-height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
    showDetails ? "max-h-96" : "max-h-0"
  }`;
  const detailContentClass = `transition-opacity duration-200 ease-in-out ${
    showDetails ? "opacity-100 delay-75" : "opacity-0"
  }`;
  const stateColorMap: Record<string, string> = {
    GREEN: "text-green-400",
    YELLOW: "text-yellow-400",
    RED: "text-red-400",
    UNKNOWN: "text-gray-500",
  };
  const stateColor = stateColorMap[data.state] || "text-gray-500";
  const averageScore = (points: SystemHistoryPoint[]) =>
    points.length
      ? points.reduce((sum, p) => sum + p.composite_score, 0) / points.length
      : 0;
  const last7 = history.slice(-7);
  const prev7 = history.slice(-14, -7);
  const last7Avg = averageScore(last7);
  const prev7Avg = prev7.length ? averageScore(prev7) : last7Avg;
  const trend = last7Avg - prev7Avg;
  const trendDirection = trend > 2 ? "IMPROVING" : trend < -2 ? "WORSENING" : "STABLE";
  const accentColor = getFamilyColor("system", "muted");
  const contributionSeries = history
    .filter((point) => point.contributions)
    .map((point) => ({
      timestamp: point.timestamp,
      ...point.contributions,
    }));
  const contributionKeys = indicatorOrder.length
    ? indicatorOrder.filter((code) =>
        contributionSeries.some((point) => Object.prototype.hasOwnProperty.call(point, code))
      )
    : Object.keys(contributionSeries[0] ?? {}).filter((key) => key !== "timestamp");

  return (
    <div
      {...commitment.getContainerProps<HTMLDivElement>()}
      className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-6 space-y-4 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stealth-500/60"
      aria-expanded={commitment.isExpanded}
    >
      <div className="h-1 rounded-full" style={{ backgroundColor: accentColor }} />
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base sm:text-lg font-semibold text-stealth-100">System Overview</h3>
        <span className="text-xs text-stealth-400">
          {data.timestamp ? formatTime(data.timestamp) : "N/A"}
        </span>
      </div>
      <div className="text-sm text-stealth-200">
        <span className="text-stealth-500">Signal:</span> {signalLine}
      </div>
      <div className="text-sm text-stealth-400">
        <span className="text-stealth-500">Context:</span> {contextLine}
      </div>
      <div className="text-xs text-stealth-500 transition-opacity duration-150 motion-reduce:transition-none">
        {focusLine}
      </div>
      {miniSeries.length > 1 && (
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={miniSeries}>
              <XAxis dataKey="timestamp" hide />
              <YAxis domain={[0, 100]} hide />
              <Line
                type="monotone"
                dataKey="composite_score"
                stroke={getFamilyColor("system")}
                strokeWidth={2}
                dot={false}
                animationDuration={CHART_ANIMATION.duration}
                animationEasing={CHART_ANIMATION.easing}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className={`${detailWrapClass} ${showDetails ? "mt-2" : ""}`}>
        <div className={detailContentClass}>
          <div className="grid grid-cols-3 gap-3 text-xs text-stealth-300">
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">State</div>
              <div className={`mt-1 text-sm font-semibold ${stateColor}`}>{data.state}</div>
            </div>
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">7-day trend</div>
              <div className="mt-1 text-sm text-stealth-200">{trendDirection}</div>
            </div>
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Composite</div>
              <div className="mt-1 text-sm text-stealth-200">{data.composite_score.toFixed(1)}</div>
            </div>
          </div>
          {contributionSeries.length > 1 && (
            <div className="pt-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500 mb-2">
                Indicator Contributions
              </div>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={contributionSeries} margin={CHART_MARGIN}>
                    <CartesianGrid {...commonGridProps} />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(value: string) =>
                        new Date(value).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      stroke={CHART_NEUTRAL.axis}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      stroke={CHART_NEUTRAL.axis}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                        borderRadius: 6,
                        color: "#e2e8f0",
                        fontSize: 11,
                      }}
                      labelFormatter={(value: string) =>
                        new Date(value).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      }
                    />
                    {contributionKeys.map((code) => (
                      <Bar
                        key={code}
                        dataKey={code}
                        name={indicatorLabels[code] ?? code}
                        stackId="system"
                        fill={getMetricColor(code)}
                        fillOpacity={0.7}
                        animationDuration={CHART_ANIMATION.duration}
                        animationEasing={CHART_ANIMATION.easing}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stealth-400">
                {contributionKeys.map((code) => (
                  <span key={code} className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: getMetricColor(code) }}
                    />
                    {indicatorLabels[code] ?? code}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SystemOverviewWidget;
