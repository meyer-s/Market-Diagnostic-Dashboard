import { useState, useEffect } from "react";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";
import SectorDivergenceWidget from "../components/widgets/SectorDivergenceWidget";
import AASWidget from "../components/widgets/AASWidget";
import MarketLoading from "../components/ui/MarketLoading";
import { getLegacyApiUrl } from "../utils/apiUtils";

interface NewsArticle {
  id: number;
  symbol: string;
  sector?: string | null;
  title: string;
  link: string;
  source: string;
  published_at: string;
}

type OverallSummary = {
  label: string;
  color: string;
  text: string;
  counts: { green: number; yellow: number; red: number };
  total: number;
};

const buildOverallSummary = (items: IndicatorStatus[]): OverallSummary | null => {
  if (!items.length) return null;

  const counts = items.reduce(
    (acc, item) => {
      if (item.state === "GREEN") acc.green += 1;
      if (item.state === "YELLOW") acc.yellow += 1;
      if (item.state === "RED") acc.red += 1;
      return acc;
    },
    { green: 0, yellow: 0, red: 0 }
  );

  const total = items.length;
  const avgScore =
    items.reduce((sum, item) => sum + (Number.isFinite(item.score) ? item.score : 0), 0) / total;
  const avgScoreDisplay = Number.isFinite(avgScore) ? avgScore.toFixed(1) : "n/a";
  const redShare = counts.red / total;
  const yellowShare = counts.yellow / total;

  let label: "Stable" | "Cautious" | "Stressed";
  let color: string;
  let text: string;
  const summaryMetrics = `This measures how many indicators are in good, warning, or stress states (${counts.green} green, ${counts.yellow} yellow, ${counts.red} red out of ${total}, avg score ${avgScoreDisplay}).`;

  if (redShare >= 0.3 || avgScore < 40) {
    label = "Stressed";
    color = "text-red-400";
    text =
      `${summaryMetrics} It matters because broad weakness often shows up next in borrowing costs, hiring, and spending. It affects households and businesses first, and investors feel it as bigger price swings. To take advantage, keep positions smaller, protect cash needs, and add risk only when the red count starts to fall.`;
  } else if (redShare >= 0.15 || yellowShare >= 0.4 || avgScore < 55) {
    label = "Cautious";
    color = "text-yellow-400";
    text =
      `${summaryMetrics} It matters because mixed signals usually mean uneven conditions and more false starts. It affects borrowers, employers, and investors who need timing to be right. To take advantage, stay diversified, avoid big bets, and wait for more indicators to turn green before adding exposure.`;
  } else {
    label = "Stable";
    color = "text-green-400";
    text =
      `${summaryMetrics} It matters because broad agreement usually supports steady jobs, spending, and planning. It affects households through income stability, businesses through clearer demand, and investors through smoother trends. To take advantage, extend time horizons, lock in funding needs, or add exposure while the dashboard stays green.`;
  }

  return { label, color, text, counts, total };
};

export default function Dashboard() {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [indicators, setIndicators] = useState<IndicatorStatus[] | null>(null);
  const [indicatorsLoading, setIndicatorsLoading] = useState(true);
  const [trendPeriod, setTrendPeriod] = useState<90 | 180 | 365>(90);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
  const overallSummary = buildOverallSummary(visibleIndicators);

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
        {indicatorsLoading && (
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-5">
            <p className="text-xs text-stealth-400">Overall conclusion loading...</p>
          </div>
        )}
        {!indicatorsLoading && overallSummary && (
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-stealth-400 uppercase tracking-wide">Overall Conclusion</div>
                <div className={`text-lg font-semibold ${overallSummary.color}`}>{overallSummary.label}</div>
              </div>
              <div className="text-xs text-stealth-400 text-right">
                {overallSummary.counts.green} green • {overallSummary.counts.yellow} yellow • {overallSummary.counts.red} red
              </div>
            </div>
            <p className="text-sm text-stealth-300 mt-2 leading-relaxed">
              {overallSummary.text}
            </p>
          </div>
        )}
        {!indicatorsLoading && !overallSummary && (
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 sm:p-5">
            <p className="text-xs text-stealth-400">Overall conclusion unavailable.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-6 mb-3 md:mb-6">
        <SystemOverviewWidget trendPeriod={trendPeriod} />
        <DowTheoryWidget trendPeriod={trendPeriod} />
        <SectorDivergenceWidget trendPeriod={trendPeriod} />
        <AASWidget timeframe={trendPeriod === 90 ? '90d' : trendPeriod === 180 ? '180d' : '365d'} />
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
