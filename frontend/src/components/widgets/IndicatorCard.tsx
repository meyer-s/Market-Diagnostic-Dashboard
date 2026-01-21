import { IndicatorStatus, IndicatorHistoryPoint } from "../../types";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { buildApiUrl } from "../../utils/apiUtils";
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

  useEffect(() => {
    // Use buildApiUrl to respect proxy configuration
    // Fetch more history for monthly indicators to ensure we have enough data points
    const metadata = DATA_FREQUENCY[indicator.code];
    const isMonthlyIndicator = metadata?.frequency === "Monthly";
    const days = isMonthlyIndicator ? 365 : 60; // Monthly indicators need full year
    
    const url = buildApiUrl(`/indicators/${indicator.code}/history?days=${days}`);
    fetch(url)
      .then(res => res.json())
      .then(data => setHistory(data))
      .catch(() => setHistory([]));
  }, [indicator.code]);

  const lastUpdated = new Date(indicator.timestamp);
  const businessDaysAgo = getBusinessDaysAgo(lastUpdated);
  const timeDisplay = formatRelativeDate(lastUpdated);

  const metadata = DATA_FREQUENCY[indicator.code] || { frequency: "Daily", description: "Updates on business days", expectedLag: 1 };
  
  // Calculate data freshness with intelligent staleness detection
  // Accounts for publishing delays, weekends, and data source schedules
  const isStale = businessDaysAgo > (metadata.expectedLag + 1); // Use business-day lag to avoid weekend false positives
  
  // Visual indicators for data freshness status
  const freshnessIcon = isStale ? (
    // Yellow warning: Data is unexpectedly old, may need investigation
    <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20" title="Data may be stale">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ) : businessDaysAgo > metadata.expectedLag ? (
    // Gray clock: Data is old but this is expected (e.g., monthly indicators, publishing delays)
    <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20" title="Waiting for source data">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
    </svg>
  ) : (
    // Green check: Data is current and up-to-date
    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20" title="Data is current">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );

  const displayName =
    indicator.code === "ANALYST_ANXIETY" ? "Analyst Confidence" : indicator.name;
  const routeCode =
    indicator.code === "ANALYST_ANXIETY" ? "ANALYST_CONFIDENCE" : indicator.code;

  return (
    <Link to={`/indicators/${routeCode}`}>
      <div className="bg-stealth-800 rounded p-4 shadow hover:bg-stealth-700 transition">
        <div className="text-gray-300 text-sm">{displayName}</div>
        <div className="text-2xl font-semibold mt-2">
          {formatValue(indicator.raw_value, 2)}
        </div>
        
        {/* Score Trend Sparkline - matches indicator detail pages */}
        <div className="mt-3">
          <StateSparkline history={history} width={200} height={24} />
        </div>
        
        <div className="flex justify-between items-center mt-2">
          <span className="text-sm text-gray-400">Score: {indicator.score}</span>
          <span className={`font-semibold ${colorMap[indicator.state]}`}>
            {indicator.state}
          </span>
        </div>
        
        {/* Timestamp with tooltip */}
        <div className="flex items-center justify-between mt-2 text-xs">
          <div className="flex items-center gap-1.5 group relative">
            {freshnessIcon}
            <span className="text-gray-500">Last updated: {timeDisplay}</span>
            
            {/* Tooltip */}
            <div className="invisible group-hover:visible absolute bottom-full left-0 mb-2 w-64 p-2 bg-stealth-900 border border-stealth-700 rounded shadow-lg text-xs z-10">
              <div className="font-semibold text-stealth-100 mb-1">{metadata.frequency} Updates</div>
              <div className="text-stealth-300">{metadata.description}</div>
              {isStale && (
                <div className="text-yellow-400 mt-1 font-medium">⚠ Data appears stale</div>
              )}
              {!isStale && businessDaysAgo > metadata.expectedLag && (
                <div className="text-gray-400 mt-1">Waiting for new source data</div>
              )}
            </div>
          </div>
          
          {/* Frequency badge */}
          <span className="text-xs text-gray-600 bg-stealth-900 px-2 py-0.5 rounded">
            {metadata.frequency}
          </span>
        </div>
      </div>
    </Link>
  );
}
