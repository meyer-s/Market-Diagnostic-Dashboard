import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../utils/apiUtils";
import { calculateMovingAverage } from "../../utils/componentUtils";
import { formatTime } from "../../utils/styleUtils";
import { STABILITY_THRESHOLDS } from "../../utils/stabilityConstants";
import {
  analyzeSeries,
  getTrendTone,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";
import { useProgressiveCommitment } from "../../hooks/useProgressiveCommitment";

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
}

interface Props {
  trendPeriod?: 90 | 180 | 365;
  onInsight?: (insight: InsightSignal) => void;
}

const SystemOverviewWidget = ({ trendPeriod = 90, onInsight }: Props) => {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [history, setHistory] = useState<SystemHistoryPoint[]>([]);
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
        const [statusData, historyData] = await Promise.all([
          apiFetch<SystemStatus>("/system"),
          apiFetch<SystemHistoryPoint[]>(historyUrl),
        ]);

        setData(statusData);

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

  return (
    <div
      {...commitment.getContainerProps<HTMLDivElement>()}
      className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-6 space-y-4 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stealth-500/60"
      aria-expanded={commitment.isExpanded}
    >
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
      {commitment.state === "focus" && (
        <div className="text-xs text-stealth-500 transition-opacity duration-150 motion-reduce:transition-none">
          {focusLine}
        </div>
      )}
    </div>
  );
};

export default SystemOverviewWidget;
