import { IndicatorStatus, IndicatorHistoryPoint } from "../../types";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiFetch } from "../../utils/apiUtils";
import { getBusinessDaysAgo, formatRelativeDate, formatValue } from "../../utils/componentUtils";
import StateSparkline from "./StateSparkline";

interface Props {
  indicator: IndicatorStatus;
}

// Metadata about data update frequencies and expected publishing delays
// This helps users understand why some indicators may appear "old"
// expectedLag: number of days delay expected from data source publishing schedules
const DATA_FREQUENCY: Record<string, { frequency: string; description: string; expectedLag: number }> = {
  VIX: { frequency: "Real-time", description: "Updates continuously during trading hours and weekends (futures)", expectedLag: 0 },
  SPY: { frequency: "Daily", description: "Updates on market trading days (Mon-Fri)", expectedLag: 0 },
  BREADTH_HEALTH: { frequency: "Daily", description: "Derived from RSP/SPY ratio, updates on trading days", expectedLag: 0 },
  DFF: { frequency: "Daily", description: "Federal Reserve publishes with 1-2 day lag", expectedLag: 2 },
  T10Y2Y: { frequency: "Daily", description: "Updates on trading days, may have weekend gaps", expectedLag: 0 },
  UNRATE: { frequency: "Monthly", description: "Bureau of Labor Statistics publishes monthly (typically first Friday)", expectedLag: 30 },
  CONSUMER_HEALTH: { frequency: "Monthly", description: "Calculated from monthly PCE, PI, and CPI data", expectedLag: 30 },
  BOND_MARKET_STABILITY: { frequency: "Daily", description: "Composite of multiple FRED series, updates on business days", expectedLag: 1 },
  LIQUIDITY_PROXY: { frequency: "Weekly", description: "Composite of M2, Fed Balance Sheet, and Reverse Repo data", expectedLag: 7 },
  ANALYST_ANXIETY: { frequency: "Daily", description: "Composite of VIX, MOVE, HY spreads, and ERP data", expectedLag: 1 },
  SENTIMENT_COMPOSITE: { frequency: "Monthly", description: "Composite of Michigan sentiment, business confidence, regional new orders, and CapEx data", expectedLag: 30 },
  AGRICULTURE_STABILITY: { frequency: "Cached market page", description: "Derived from the Agriculture Markets page composite and refreshed from the same underlying market and macro inputs", expectedLag: 1 },
  ENERGY_STABILITY: { frequency: "Cached market page", description: "Derived from the Energy Markets page stability score and refreshed from the same underlying energy-market inputs", expectedLag: 1 },
  REAL_ESTATE_STABILITY: { frequency: "Cached market page", description: "Derived from the Real Estate Markets page stability score and refreshed from the same underlying housing and credit inputs", expectedLag: 1 },
};

const stateDotMap = {
  GREEN: "bg-accent-green",
  YELLOW: "bg-accent-yellow",
  RED: "bg-accent-red",
  UNKNOWN: "bg-stealth-500",
};

function resolveIndicatorRoute(code: string) {
  if (code === "ANALYST_ANXIETY") return "/indicators/ANALYST_CONFIDENCE";
  if (code === "AGRICULTURE_STABILITY") return "/agriculture";
  if (code === "ENERGY_STABILITY") return "/energy";
  if (code === "REAL_ESTATE_STABILITY") return "/real-estate";
  return `/indicators/${code}`;
}

export default function IndicatorCard({ indicator }: Props) {
  const [history, setHistory] = useState<IndicatorHistoryPoint[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const metadata = DATA_FREQUENCY[indicator.code];
    const isMonthlyIndicator = metadata?.frequency === "Monthly";
    const days = isMonthlyIndicator ? 365 : 60;

    void apiFetch<unknown>(`/indicators/${indicator.code}/history?days=${days}`, {
      signal: controller.signal,
      timeoutMs: 15_000,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data)) {
          setHistory([]);
          return;
        }
        const validHistory = data.filter(
          (point): point is IndicatorHistoryPoint =>
            typeof point === "object"
            && point !== null
            && typeof point.timestamp === "string"
            && typeof point.raw_value === "number"
            && typeof point.score === "number"
            && ["GREEN", "YELLOW", "RED"].includes(String(point.state)),
        );
        setHistory(validHistory);
      })
      .catch((requestError: unknown) => {
        if (
          controller.signal.aborted
          || requestError instanceof DOMException && requestError.name === "AbortError"
        ) {
          return;
        }
        setHistory([]);
      });

    return () => controller.abort();
  }, [indicator.code]);

  const lastUpdated = indicator.timestamp ? new Date(indicator.timestamp) : null;
  const businessDaysAgo = lastUpdated ? getBusinessDaysAgo(lastUpdated) : Number.POSITIVE_INFINITY;
  const timeDisplay = lastUpdated ? formatRelativeDate(lastUpdated) : "No data";

  const metadata = DATA_FREQUENCY[indicator.code] || { frequency: "Daily", description: "Updates on business days", expectedLag: 1 };
  
  // Calculate data freshness with intelligent staleness detection
  // Accounts for publishing delays, weekends, and data source schedules
  const isStale = !lastUpdated || businessDaysAgo > (metadata.expectedLag + 1); // Use business-day lag to avoid weekend false positives
  
  // Visual indicators for data freshness status
  const freshnessIcon = isStale ? (
    // Yellow warning: Data is unexpectedly old, may need investigation
    <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><title>Data may be stale</title>
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ) : businessDaysAgo > metadata.expectedLag ? (
    // Gray clock: Data is old but this is expected (e.g., monthly indicators, publishing delays)
    <svg className="w-4 h-4 text-stealth-400" fill="currentColor" viewBox="0 0 20 20"><title>Waiting for source data</title>
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
    </svg>
  ) : (
    // Green check: Data is current and up-to-date
    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20"><title>Data is current</title>
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );

  const displayName =
    indicator.code === "ANALYST_ANXIETY" ? "Analyst Confidence" : indicator.name;
  const routePath = resolveIndicatorRoute(indicator.code);

  return (
    <Link to={routePath} className="indicator-sensor-link block h-full">
      <div className="indicator-sensor-card primary-card primary-card-hover flex h-full flex-col p-3.5">
        <div className="indicator-sensor-name text-sm leading-6 text-stealth-300">{displayName}</div>
        <div className="indicator-sensor-value mt-1 text-2xl font-semibold">
          {formatValue(indicator.raw_value, 2)}
        </div>
        
        {/* Score Trend Sparkline - matches indicator detail pages */}
        <div className="indicator-sensor-sparkline mt-2.5">
          <StateSparkline history={history} width={200} height={24} />
        </div>
        
        <div className="indicator-sensor-score-row mt-2 flex items-center justify-between">
          <span className="indicator-sensor-score text-sm text-stealth-400">Score: {formatValue(indicator.score, 1)}</span>
          <span className="indicator-sensor-state inline-flex items-center" title={indicator.state}>
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${stateDotMap[indicator.state]}`}></span>
            <span className="indicator-sensor-state-label sr-only">{indicator.state}</span>
          </span>
        </div>
        
        {/* Timestamp with tooltip */}
        <div className="indicator-sensor-meta mt-auto flex items-center justify-between pt-2.5 text-xs">
          <div className="indicator-sensor-freshness flex items-center gap-1.5">
            {freshnessIcon}
            <span className="text-stealth-500">Last updated: {timeDisplay}</span>
          </div>
          
          {/* Frequency badge */}
          <span className="indicator-sensor-frequency text-xs text-stealth-600 bg-stealth-900 px-2 py-0.5 rounded">
            {metadata.frequency}
          </span>
        </div>
        <p className="indicator-sensor-description mt-1 text-xs leading-5 text-stealth-400">
          {metadata.description}
          {isStale ? " Data appears stale." : ""}
          {!isStale && businessDaysAgo > metadata.expectedLag ? " Waiting for new source data." : ""}
        </p>
      </div>
    </Link>
  );
}
