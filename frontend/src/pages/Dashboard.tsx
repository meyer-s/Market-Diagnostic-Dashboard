import { useState, useEffect, useCallback, useMemo } from "react";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";
import SectorDivergenceWidget from "../components/widgets/SectorDivergenceWidget";
import AASWidget from "../components/widgets/AASWidget";
import MarketLoading from "../components/ui/MarketLoading";
import { getLegacyApiUrl } from "../utils/apiUtils";
import { getTrendWindows, type InsightSignal } from "../utils/insightUtils";
import { useProgressiveCommitment } from "../hooks/useProgressiveCommitment";

interface NewsArticle {
  id: number;
  symbol: string;
  sector?: string | null;
  title: string;
  link: string;
  source: string;
  published_at: string;
}

type OverallInsight = {
  label: string;
  color: string;
  summary: string;
  posture: InsightSignal["stance"];
  primaryDirection: InsightSignal["primaryDirection"];
  secondaryDirection: InsightSignal["secondaryDirection"];
  confidence: InsightSignal["confidence"];
};

const buildOverallInsight = (
  signals: InsightSignal[],
  trendLabel: string
): OverallInsight | null => {
  if (signals.length < 4) return null;

  const stanceScore = signals.reduce((sum, item) => {
    if (item.stance === "risk-on") return sum + 1;
    if (item.stance === "risk-off") return sum - 1;
    return sum;
  }, 0);
  const primaryDirectionScore = signals.reduce((sum, item) => {
    if (item.primaryDirection === "up") return sum + 1;
    if (item.primaryDirection === "down") return sum - 1;
    return sum;
  }, 0);
  const secondaryDirectionScore = signals.reduce((sum, item) => {
    if (item.secondaryDirection === "up") return sum + 1;
    if (item.secondaryDirection === "down") return sum - 1;
    return sum;
  }, 0);
  const confidenceScore = signals.reduce((sum, item) => {
    if (item.confidence === "high") return sum + 1;
    if (item.confidence === "low") return sum - 1;
    return sum;
  }, 0);

  const posture: InsightSignal["stance"] =
    stanceScore >= 2 ? "risk-on" : stanceScore <= -2 ? "risk-off" : "mixed";
  const primaryDirection: InsightSignal["primaryDirection"] =
    primaryDirectionScore >= 2 ? "up" : primaryDirectionScore <= -2 ? "down" : "flat";
  const secondaryDirection: InsightSignal["secondaryDirection"] =
    secondaryDirectionScore >= 2 ? "up" : secondaryDirectionScore <= -2 ? "down" : "flat";
  let confidence: InsightSignal["confidence"] =
    confidenceScore >= 2 ? "high" : confidenceScore <= -2 ? "low" : "medium";
  if (
    primaryDirection !== "flat" &&
    secondaryDirection !== "flat" &&
    primaryDirection !== secondaryDirection
  ) {
    confidence = "low";
  }

  const label =
    posture === "risk-on" ? "Positive" : posture === "risk-off" ? "Cautious" : "Mixed";
  const color =
    posture === "risk-on"
      ? "text-green-400"
      : posture === "risk-off"
      ? "text-red-400"
      : "text-yellow-400";
  let summary = "";
  if (posture === "risk-on") {
    summary = `Tailwinds lead. ${trendLabel} ${primaryDirection}, recent ${secondaryDirection}.`;
  } else if (posture === "risk-off") {
    summary = `Caution leads. ${trendLabel} ${primaryDirection}, recent ${secondaryDirection}.`;
  } else {
    summary = `Signals split. ${trendLabel} ${primaryDirection}, recent ${secondaryDirection}.`;
  }

  if (confidence === "low") {
    summary += " Noisy read.";
  } else if (confidence === "high") {
    summary += " Clear read.";
  }

  return {
    label,
    color,
    summary,
    posture,
    primaryDirection,
    secondaryDirection,
    confidence,
  };
};

export default function Dashboard() {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [indicators, setIndicators] = useState<IndicatorStatus[] | null>(null);
  const [indicatorsLoading, setIndicatorsLoading] = useState(true);
  const [trendPeriod, setTrendPeriod] = useState<90 | 180 | 365>(90);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [insights, setInsights] = useState<Partial<Record<InsightSignal["id"], InsightSignal>>>({});

  useEffect(() => {
    const apiUrl = getLegacyApiUrl();
    setIndicatorsLoading(true);
    // Fetch indicators data from backend
    fetch(`${apiUrl}/indicators`)
      .then(res => res.json())
      .then(data => setIndicators(data))
      .catch(() => setIndicators(null))
      .finally(() => setIndicatorsLoading(false));

    // Fetch cached news from last 24 hours
    fetch(`${apiUrl}/news?hours=24&limit=200`)
      .then(res => res.json())
      .then(data => setNews(data))
      .catch(() => setNews([])  );
  }, [refreshKey]);

  const newsCount = news.length;
  const visibleIndicators = indicators?.filter((i) => i.code !== "AAP") ?? [];
  const insightOrder: InsightSignal["id"][] = ["system", "dow", "sector", "aas"];
  const insightList = useMemo(
    () => insightOrder.map((id) => insights[id]).filter(Boolean) as InsightSignal[],
    [insights]
  );
  const overallTrendLabel = useMemo(
    () => getTrendWindows(trendPeriod).label.toLowerCase(),
    [trendPeriod]
  );
  const overallInsight = useMemo(
    () => buildOverallInsight(insightList, overallTrendLabel),
    [insightList, overallTrendLabel]
  );
  const overallSignalLine = overallInsight
    ? overallInsight.posture === "risk-on"
      ? "Tailwinds lead"
      : overallInsight.posture === "risk-off"
      ? "Caution leads"
      : "Signals split"
    : "";
  const overallContextLine = overallInsight
    ? `${overallTrendLabel} ${overallInsight.primaryDirection}, recent ${overallInsight.secondaryDirection}`
    : "";
  const overallConfidenceNote =
    overallInsight?.confidence === "high"
      ? "clear trend"
      : overallInsight?.confidence === "low"
      ? "signals diverge"
      : "mixed trend";
  const overallHoverLine = overallInsight
    ? `Confidence: ${overallInsight.confidence} (${overallConfidenceNote})`
    : "";
  const overallRelatedReasons: Record<InsightSignal["id"], string> = {
    system: "Composite anchor for system stability",
    dow: "Confirms trend agreement across transports",
    sector: "Shows leadership between defensive and cyclical",
    aas: "Alternative assets confirm risk appetite shifts",
  };
  const overallCommitment = useProgressiveCommitment({ mode: "inline" });

  const handleInsight = useCallback((insight: InsightSignal) => {
    setInsights((prev) => {
      const existing = prev[insight.id];
      if (
        existing &&
        existing.summary === insight.summary &&
        existing.primaryDirection === insight.primaryDirection &&
        existing.secondaryDirection === insight.secondaryDirection &&
        existing.stance === insight.stance &&
        existing.confidence === insight.confidence
      ) {
        return prev;
      }
      return { ...prev, [insight.id]: insight };
    });
  }, []);

  // Manual refresh function - triggers ETL ingestion for all indicators
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const apiUrl = getLegacyApiUrl();
      // Trigger backend ETL to fetch latest data from FRED and Yahoo Finance
      const response = await fetch(`${apiUrl}/admin/ingest/run`, {
        method: "POST",
      });
      
      if (response.ok) {
        // Wait for backend to process new data
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Force re-fetch of dashboard data by incrementing refresh key
        setRefreshKey(prev => prev + 1);
      }
    } catch (error) {
      console.error("Failed to refresh data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="p-3 md:p-6 text-gray-200">
      {/* Header with News Badge */}
      <div className="flex flex-col mb-4 md:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
          <div className="flex flex-col">
            <h2 className="text-xl sm:text-2xl font-bold">Dashboard</h2>
            <p className="text-xs sm:text-sm text-gray-400">Real-time market regime assessment across volatility, rates, liquidity, and sentiment</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {newsCount > 0 && (
              <div className="flex items-center gap-2 bg-sky-500/20 border border-sky-500/50 rounded-full px-2 sm:px-3 py-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                </span>
                <span className="text-xs sm:text-sm font-semibold text-sky-300">
                  {newsCount} News Item{newsCount !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 justify-end">
            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium text-xs sm:text-sm transition ${
                isRefreshing
                  ? 'bg-stealth-700 text-stealth-400 cursor-not-allowed'
                  : 'bg-stealth-700 text-stealth-200 hover:bg-stealth-600 hover:text-stealth-100'
              }`}
              title="Refresh all indicator data"
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="hidden xs:inline">{isRefreshing ? 'Refreshing...' : 'Refresh Data'}</span>
              <span className="xs:hidden">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            {/* Trend Period Toggle */}
            <div className="flex items-center gap-1 bg-stealth-800 border border-stealth-700 rounded-lg p-1">
              <button
                onClick={() => setTrendPeriod(90)}
                className={`flex-1 px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition whitespace-nowrap ${
                  trendPeriod === 90
                    ? 'bg-stealth-600 text-stealth-100'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                90d
              </button>
              <button
                onClick={() => setTrendPeriod(180)}
                className={`flex-1 px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition whitespace-nowrap ${
                  trendPeriod === 180
                    ? 'bg-stealth-600 text-stealth-100'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                6mo
              </button>
              <button
                onClick={() => setTrendPeriod(365)}
                className={`flex-1 px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition whitespace-nowrap ${
                  trendPeriod === 365
                    ? 'bg-stealth-600 text-stealth-100'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                1yr
              </button>
            </div>
          </div>
        </div>

      <div className="mb-3 md:mb-6">
        {!overallInsight && (
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-5">
            <p className="text-xs text-stealth-400">Overall read forming...</p>
          </div>
        )}
        {overallInsight && (
          <div
            {...overallCommitment.getContainerProps<HTMLDivElement>()}
            className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-5 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stealth-500/60"
            aria-expanded={overallCommitment.isExpanded}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-stealth-400 uppercase tracking-wide">Overall Summary</div>
                <div className={`text-lg font-semibold ${overallInsight.color}`}>{overallInsight.label}</div>
              </div>
            </div>
            <div className="mt-2 text-sm text-stealth-200">
              <span className="text-stealth-500">Signal:</span> {overallSignalLine}
            </div>
            <div className="text-sm text-stealth-400">
              <span className="text-stealth-500">Context:</span> {overallContextLine}
            </div>
            {overallCommitment.state === "focus" && (
              <div className="mt-2 text-xs text-stealth-500 transition-opacity duration-150 motion-reduce:transition-none">
                {overallHoverLine}
              </div>
            )}
            {overallCommitment.isExpanded && (
              <div className="mt-3 border-t border-stealth-700 pt-3 text-xs text-stealth-300 space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-stealth-500">
                    Why it matters
                  </div>
                  <p className="text-stealth-300">
                    {overallInsight.summary} This keeps the dashboard aligned on a single read.
                  </p>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-stealth-500">
                    Related signals
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {insightList.map((insight) => (
                      <span
                        key={insight.id}
                        className="inline-flex items-center gap-2 rounded-full border border-stealth-600 bg-stealth-900 px-2 py-1 text-[11px] text-stealth-300"
                      >
                        {insight.label}
                        <span className="text-stealth-500">-</span>
                        {overallRelatedReasons[insight.id] ?? "Composite input for overall balance"}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-stealth-500">
                    Methodology note
                  </div>
                  <p className="text-stealth-300">
                    Combines system state, trend alignment, sector leadership, and alternative-asset stability.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-6 mb-3 md:mb-6">
        <SystemOverviewWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
        <DowTheoryWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
        <SectorDivergenceWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
        <AASWidget
          timeframe={trendPeriod === 90 ? '90d' : trendPeriod === 180 ? '180d' : '365d'}
          onInsight={handleInsight}
        />
      </div>

      <h3 className="text-lg sm:text-xl font-semibold mb-3 md:mb-4">Indicators</h3>
      {indicatorsLoading && (
        <div className="flex justify-center mb-4 md:mb-6">
          <MarketLoading size={96} variant="scan" />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4">
        {visibleIndicators.map((i) => (
          <IndicatorCard key={i.code} indicator={i} />
        ))}
      </div>
    </div>
  );
}
