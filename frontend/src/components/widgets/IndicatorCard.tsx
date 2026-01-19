import { IndicatorStatus, IndicatorHistoryPoint } from "../../types";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../utils/apiUtils";
import { getBusinessDaysAgo, formatRelativeDate } from "../../utils/componentUtils";
import { analyzeSeries } from "../../utils/insightUtils";
import { useProgressiveCommitment } from "../../hooks/useProgressiveCommitment";
import { metricFamilyByKey, metricFamilyLabels } from "../../theme/metricColors";

interface Props {
  indicator: IndicatorStatus;
}

const DATA_FREQUENCY: Record<string, { frequency: string; description: string; expectedLag: number }> = {
  VIX: { frequency: "Real-time", description: "Updates continuously during trading hours and weekends (futures)", expectedLag: 0 },
  SPY: { frequency: "Daily", description: "Updates on market trading days (Mon-Fri)", expectedLag: 0 },
  DFF: { frequency: "Daily", description: "Federal Reserve publishes with 1-2 day lag", expectedLag: 2 },
  T10Y2Y: { frequency: "Daily", description: "Updates on trading days, may have weekend gaps", expectedLag: 0 },
  UNRATE: { frequency: "Monthly", description: "Bureau of Labor Statistics publishes monthly (typically first Friday)", expectedLag: 30 },
  CONSUMER_HEALTH: { frequency: "Monthly", description: "Calculated from monthly PCE, PI, and CPI data", expectedLag: 30 },
  BOND_MARKET_STABILITY: { frequency: "Daily", description: "Composite of multiple FRED series, updates on business days", expectedLag: 1 },
  LIQUIDITY_PROXY: { frequency: "Weekly", description: "Composite of M2, Fed Balance Sheet, and Reverse Repo data", expectedLag: 7 },
  ANALYST_ANXIETY: { frequency: "Daily", description: "Composite of VIX, MOVE, HY spreads, and ERP data", expectedLag: 1 },
  SENTIMENT_COMPOSITE: { frequency: "Monthly", description: "Composite of Michigan Sentiment, NFIB, ISM New Orders, and CapEx data", expectedLag: 30 },
};

const colorMap = {
  GREEN: "text-accent-green",
  YELLOW: "text-accent-yellow",
  RED: "text-accent-red",
};

export default function IndicatorCard({ indicator }: Props) {
  const [history, setHistory] = useState<IndicatorHistoryPoint[]>([]);
  const navigate = useNavigate();
  const routeCode = indicator.code === "ANALYST_ANXIETY" ? "ANALYST_CONFIDENCE" : indicator.code;
  const commitment = useProgressiveCommitment({
    mode: "navigate",
    onCommit: () => navigate(`/indicators/${routeCode}`),
  });

  useEffect(() => {
    const metadata = DATA_FREQUENCY[indicator.code];
    const isMonthlyIndicator = metadata?.frequency === "Monthly";
    const days = isMonthlyIndicator ? 365 : 60;

    apiFetch<IndicatorHistoryPoint[]>(`/indicators/${indicator.code}/history?days=${days}`)
      .then((data) => setHistory(data))
      .catch(() => setHistory([]));
  }, [indicator.code]);

  const lastUpdated = new Date(indicator.timestamp);
  const businessDaysAgo = getBusinessDaysAgo(lastUpdated);
  const timeDisplay = formatRelativeDate(lastUpdated);

  const metadata =
    DATA_FREQUENCY[indicator.code] || { frequency: "Daily", description: "Updates on business days", expectedLag: 1 };

  const isStale = businessDaysAgo > metadata.expectedLag + 1;
  const freshnessLabel = isStale ? "stale" : businessDaysAgo > metadata.expectedLag ? "lagging" : "current";

  const historyScores = history.map((point) => point.score).filter((score) => Number.isFinite(score));
  const trendSignal = analyzeSeries(historyScores, { recent: 6, prior: 6, flatThreshold: 0.08 });
  const trendLabel =
    trendSignal.direction === "up" ? "improving" : trendSignal.direction === "down" ? "softening" : "steady";
  const stateLabel =
    indicator.state === "GREEN" ? "stable" : indicator.state === "RED" ? "stressed" : "mixed";
  const signalLine = `${stateLabel}, ${trendLabel}`;
  const family = metricFamilyByKey[routeCode] ?? metricFamilyByKey[indicator.code] ?? "system";
  const contextLine = metricFamilyLabels[family] || "System";

  const displayName = indicator.code === "ANALYST_ANXIETY" ? "Analyst Confidence" : indicator.name;

  return (
    <div
      {...commitment.getContainerProps<HTMLDivElement>()}
      className="bg-stealth-800 rounded p-4 shadow transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stealth-500/60"
      aria-expanded={commitment.isExpanded}
    >
      <div className="flex items-center justify-between">
        <div className="text-gray-300 text-sm">{displayName}</div>
        <span className={`text-xs font-semibold ${colorMap[indicator.state]}`}>{indicator.state}</span>
      </div>
      <div className="mt-2 text-sm text-stealth-200">
        <span className="text-stealth-500">Signal:</span> {signalLine}
      </div>
      <div className="text-sm text-stealth-400">
        <span className="text-stealth-500">Context:</span> {contextLine}
      </div>
      {commitment.state === "focus" && (
        <div className="mt-2 text-xs text-stealth-500 transition-opacity duration-150 motion-reduce:transition-none">
          Freshness: {freshnessLabel} ({timeDisplay})
        </div>
      )}
    </div>
  );
}
