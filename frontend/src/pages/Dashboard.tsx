import { useState, useEffect, useCallback, useMemo } from "react";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";
import SectorDivergenceWidget from "../components/widgets/SectorDivergenceWidget";
import AASWidget from "../components/widgets/AASWidget";
import AdvanceDeclineCard from "../components/widgets/AdvanceDeclineCard";
import DebtCompositeCreditWidget from "../components/widgets/DebtCompositeCreditWidget";
import MarketLoading from "../components/ui/MarketLoading";
import { getLegacyApiUrl } from "../utils/apiUtils";
import { getTrendWindows, type InsightSignal } from "../utils/insightUtils";

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

const describeDirection = (direction: InsightSignal["primaryDirection"]) => {
  if (direction === "up") return "an uptrend";
  if (direction === "down") return "a downtrend";
  return "a sideways move";
};

const capitalize = (value: string) =>
  value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;

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
  const primaryPhrase = describeDirection(primaryDirection);
  const secondaryPhrase = describeDirection(secondaryDirection);
  let summary = "";
  if (posture === "risk-on") {
    summary = `Tailwinds lead. ${trendLabel} shows ${primaryPhrase}, with ${secondaryPhrase} recently.`;
  } else if (posture === "risk-off") {
    summary = `Caution leads. ${trendLabel} shows ${primaryPhrase}, with ${secondaryPhrase} recently.`;
  } else {
    summary = `Signals are split. ${trendLabel} shows ${primaryPhrase}, with ${secondaryPhrase} recently.`;
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
  const visibleIndicators = useMemo(() => indicators?.filter((i) => i.code !== "AAS" && i.code !== "AAP") ?? [], [indicators]);
  const insightOrder: InsightSignal["id"][] = ["system", "dow", "sector", "aas"];
  const insightList = useMemo(
    () => insightOrder.map((id) => insights[id]).filter(Boolean) as InsightSignal[],
    [insights]
  );
  const overallTrendLabel = useMemo(() => getTrendWindows(trendPeriod).label, [trendPeriod]);
  const overallInsight = useMemo(
    () => buildOverallInsight(insightList, overallTrendLabel),
    [insightList, overallTrendLabel]
  );
  const confidenceLabel = overallInsight
    ? overallInsight.confidence === "high"
      ? "Clear read"
      : overallInsight.confidence === "low"
      ? "Noisy read"
      : "Mixed read"
    : "";
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

  const directionCardStyles = {
    up: "bg-green-500/15 text-green-300 border-green-400/40",
    down: "bg-red-500/15 text-red-300 border-red-400/40",
    flat: "bg-yellow-500/15 text-yellow-300 border-yellow-400/40",
  } as const;
  const directionLabel = {
    up: "Uptrend",
    down: "Downtrend",
    flat: "Sideways",
  } as const;
  const directionStyles = {
    up: "text-green-300",
    down: "text-red-300",
    flat: "text-stealth-300",
  } as const;

  const formatInsightSummary = (insight: InsightSignal) => {
    const primary = capitalize(describeDirection(insight.primaryDirection));
    const secondary = capitalize(describeDirection(insight.secondaryDirection));
    return `${overallTrendLabel}: ${primary}. Recent: ${secondary}.`;
  };


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
    <div className="page-shell page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col">
          <span className="page-kicker">Daily Diagnostic</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Dashboard</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Real-time market regime assessment across volatility, rates, liquidity, and sentiment.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="page-badge">{visibleIndicators.length} active indicators</span>
            <span className="page-badge">Trend window {overallTrendLabel}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <div className="flex items-center gap-2 sm:gap-4">
            {newsCount > 0 && (
              <div className="page-badge border-sky-500/40 bg-sky-500/12 text-sky-200">
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

          <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-center sm:gap-3">
            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`flex items-center justify-center gap-2 rounded-full px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition ${
                isRefreshing
                  ? 'border border-stealth-700/80 text-stealth-500 cursor-not-allowed'
                  : 'border border-stealth-600/90 text-stealth-300 hover:border-stealth-500 hover:text-stealth-200'
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
            <div className="control-strip">
              <button
                onClick={() => setTrendPeriod(90)}
                className={`flex-1 whitespace-nowrap rounded-full px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium transition ${
                  trendPeriod === 90
                    ? 'bg-stealth-700 text-white'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                90d
              </button>
              <button
                onClick={() => setTrendPeriod(180)}
                className={`flex-1 whitespace-nowrap rounded-full px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium transition ${
                  trendPeriod === 180
                    ? 'bg-stealth-700 text-white'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                6mo
              </button>
              <button
                onClick={() => setTrendPeriod(365)}
                className={`flex-1 whitespace-nowrap rounded-full px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium transition ${
                  trendPeriod === 365
                    ? 'bg-stealth-700 text-white'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                1yr
              </button>
            </div>
          </div>
        </div>
      </div>

      <div>
        {!overallInsight && (
          <div className="surface-card-strong p-4 sm:p-5">
            <p className="text-xs text-stealth-400">Overall read forming...</p>
          </div>
        )}
        {overallInsight && (
          <div className="surface-card-strong p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-stealth-400 uppercase tracking-wide">Overall Summary</div>
                <div className={`text-lg font-semibold ${overallInsight.color}`}>{overallInsight.label}</div>
              </div>
              <div className="text-xs text-stealth-500 text-right">
                {confidenceLabel}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {insightList.map((insight) => (
                <div
                  key={insight.id}
                  className={`rounded-md border px-2 py-2 ${directionCardStyles[insight.primaryDirection]}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-stealth-100">
                      {insight.label}
                    </span>
                    <span className={`text-[10px] uppercase ${directionStyles[insight.primaryDirection]}`}>
                      {directionLabel[insight.primaryDirection]}
                    </span>
                  </div>
                  <div className="text-[10px] text-stealth-200 mt-1 truncate">
                    {formatInsightSummary(insight)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-stealth-300 mt-3 leading-relaxed">
              {overallInsight.summary}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:gap-6 lg:grid-cols-2">
        <SystemOverviewWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
        <DowTheoryWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
        <SectorDivergenceWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
        <AASWidget
          timeframe={trendPeriod === 90 ? '90d' : trendPeriod === 180 ? '180d' : '365d'}
          onInsight={handleInsight}
        />
        <AdvanceDeclineCard />
        <DebtCompositeCreditWidget />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="page-kicker">Breadth</div>
          <h3 className="mt-1 text-lg font-semibold text-stealth-100 sm:text-xl">Indicators</h3>
        </div>
      </div>
      {indicatorsLoading && (
        <div className="flex justify-center">
          <MarketLoading size={96} variant="scan" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {visibleIndicators.map((i) => (
          <IndicatorCard key={i.code} indicator={i} />
        ))}
      </div>
    </div>
  );
}
