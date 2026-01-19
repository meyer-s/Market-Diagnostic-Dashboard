import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { getLegacyApiUrl } from "../../utils/apiUtils";
import { calculateMovingAverage } from "../../utils/componentUtils";
import { formatDateTime, formatTime } from "../../utils/styleUtils";
import { CHART_MARGIN, commonXAxisProps, commonYAxisProps, commonGridProps, commonTooltipStyle } from "../../utils/chartUtils";
import { getStateFromScore, STABILITY_THRESHOLDS } from "../../utils/stabilityConstants";
import { analyzeSeries, getTrendTone } from "../../utils/insightUtils";

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

interface NewsArticle {
  id: number;
  symbol: string;
  sector?: string | null;
  title: string;
  link: string;
  source: string;
  published_at: string;
}

interface Props {
  trendPeriod?: 90 | 180 | 365;
}

const SystemOverviewWidget = ({ trendPeriod = 90 }: Props) => {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [history, setHistory] = useState<SystemHistoryPoint[]>([]);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('SystemOverview fetching data with trendPeriod:', trendPeriod);
        const apiUrl = getLegacyApiUrl();
        const historyUrl = `${apiUrl}/system/history?days=${trendPeriod}`;
        console.log('SystemOverview history URL:', historyUrl);
        const [statusResponse, historyResponse, newsResponse] = await Promise.all([
          fetch(`${apiUrl}/system`),
          fetch(historyUrl),
          fetch(`${apiUrl}/news?hours=24&limit=50`),
        ]);
        
        if (!statusResponse.ok) throw new Error("Failed to fetch system status");
        if (!historyResponse.ok) throw new Error("Failed to fetch system history");
        if (!newsResponse.ok) throw new Error("Failed to fetch news");
        
        const statusData = await statusResponse.json();
        const historyData = await historyResponse.json();
        const newsData = await newsResponse.json();
        
        setData(statusData);
        setNews(newsData);
        
        // Use real historical data from backend
        if (Array.isArray(historyData) && historyData.length > 0) {
          // Apply 7-day moving average to smooth out daily oscillations
          const smoothedHistory = calculateMovingAverage(historyData, 'composite_score', 7);
          setHistory(smoothedHistory);
        } else {
          // Fallback: if no history available, use current data point only
          setHistory([{
            timestamp: statusData.timestamp || new Date().toISOString(),
            composite_score: statusData.composite_score,
            state: statusData.state
          }]);
        }
        
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
        <h3 className="text-lg font-semibold text-red-400 mb-2">
          System Overview
        </h3>
        <p className="text-stealth-400 text-sm">
          {error || "No data available"}
        </p>
      </div>
    );
  }

  // Color mappings
  const stateColorMap: Record<string, string> = {
    GREEN: "text-green-400",
    YELLOW: "text-yellow-400",
    RED: "text-red-400",
    UNKNOWN: "text-gray-500",
  };
  const stateColor = stateColorMap[data.state] || "text-gray-500";

  const compositePercentage = Math.min(100, data.composite_score || 0);

  // Get recent news (last 3)
  const recentNews = news.slice(0, 3);

  // Calculate trend (last 7 days vs previous 7 days average)
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

  const trendColor = {
    IMPROVING: "text-green-400",
    WORSENING: "text-red-400",
    STABLE: "text-gray-400",
  }[trendDirection];

  const periodLabel = trendPeriod === 365 ? "1 year" : trendPeriod === 180 ? "6 months" : "90 days";
  const scoreSeries = history.map((point) => point.composite_score);
  const trendSignal = analyzeSeries(scoreSeries);
  const trendTone = getTrendTone(trendSignal);
  const condition =
    data.state === "GREEN" ? "steady" : data.state === "YELLOW" ? "mixed" : "stressed";
  const trendWord =
    trendSignal.direction === "up"
      ? "improving"
      : trendSignal.direction === "down"
      ? "softening"
      : "holding";
  const momentumClause =
    trendSignal.momentum === "steady"
      ? ""
      : `, momentum is ${trendSignal.momentum === "accelerating" ? "building" : "fading"}`;
  const toneClause = trendTone === "mixed" ? "" : `, the signal feels ${trendTone}`;
  const nuanceSentence = `It looks ${condition} and ${trendWord}${momentumClause}${toneClause}.`;
  let actionSentence = "";
  if (data.state === "GREEN") {
    actionSentence =
      trendSignal.direction === "down"
        ? "Households and businesses should still see stability, but keep risk measured until the slide stops."
        : "Households and businesses usually feel stability first, so longer-term plans can make sense while this holds.";
  } else if (data.state === "YELLOW") {
    actionSentence =
      trendSignal.direction === "up"
        ? "Unevenness may ease, but stay diversified until the signal firms up."
        : "Uneven costs or demand can show up for households and employers, so keep exposure balanced.";
  } else {
    actionSentence =
      trendSignal.direction === "up"
        ? "Stress may be easing, but borrowers and employers feel it first; protect cash needs until it stabilizes."
        : "Borrowers and employers feel this first; protect cash needs and keep risk small.";
  }
  const systemSummary = `This blends many signals into one health score. ${nuanceSentence} ${actionSentence}`;

  return (
    <Link to="/system-breakdown" className="block">
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-3 sm:p-6 space-y-4 hover:bg-stealth-750 hover:border-stealth-600 transition cursor-pointer">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-1 sm:gap-2 min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-stealth-100 whitespace-nowrap">
              System Overview
            </h3>
            <span className="text-xs text-stealth-500 flex-shrink-0">→ View</span>
          </div>
          <span className="text-xs text-stealth-400 flex-shrink-0">
            {data.timestamp ? formatTime(data.timestamp) : 'N/A'}
          </span>
        </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4">
        {/* System State */}
        <div className="space-y-2 min-w-0">
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-xs sm:text-sm text-stealth-400 truncate">System State</span>
            <span className={`text-lg sm:text-xl font-bold flex-shrink-0 ${stateColor}`}>
              {data.state}
            </span>
          </div>
          <div className="relative h-2 bg-stealth-900 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                data.composite_score >= STABILITY_THRESHOLDS.YELLOW_MAX
                  ? "bg-green-500"
                  : data.composite_score >= STABILITY_THRESHOLDS.RED_MAX
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
              style={{ width: `${compositePercentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs gap-1">
            <span className="text-stealth-400 truncate">Composite:</span>
            <span className="text-stealth-200 flex-shrink-0">{data.composite_score.toFixed(1)}</span>
          </div>
        </div>

        {/* Weekly Trend */}
        <div className="space-y-2 min-w-0">
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-xs sm:text-sm text-stealth-400 truncate">7-Day Trend</span>
            <span className={`text-lg sm:text-xl font-bold flex-shrink-0 ${trendColor}`}>
              {trendDirection}
            </span>
          </div>
          <div className="relative h-2 bg-stealth-900 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-500 ${trendColor.replace('text-', 'bg-')}`}
              style={{ width: `${Math.min(100, Math.abs(trend) * 10)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs gap-1">
            <span className="text-stealth-400 truncate">Change:</span>
            <span className="text-stealth-200 flex-shrink-0">{trend > 0 ? '+' : ''}{trend.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* Status Badges */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        <div className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700 text-xs whitespace-nowrap">
          <span className="text-stealth-400 flex-shrink-0">Red:</span>
          <span className="font-semibold text-red-400 flex-shrink-0">
            {data.red_count}
          </span>
        </div>
        <div className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700 text-xs whitespace-nowrap">
          <span className="text-stealth-400 flex-shrink-0">Yellow:</span>
          <span className="font-semibold text-yellow-400 flex-shrink-0">
            {data.yellow_count}
          </span>
        </div>
        <div className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700 text-xs whitespace-nowrap">
          <span className="text-stealth-400 flex-shrink-0">News:</span>
          <span className="font-semibold text-cyan-400 flex-shrink-0">
            {news.length}
          </span>
        </div>
      </div>

      {/* Recent News */}
      {recentNews.length > 0 && (
        <div className="pt-3 border-t border-stealth-700">
          <h4 className="text-sm font-semibold text-stealth-200 mb-2">
            Recent Market News
          </h4>
          <div className="space-y-2">
            {recentNews.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 p-2 bg-stealth-900 rounded border border-stealth-700"
              >
                <span className="text-xs text-sky-400 mt-0.5">{item.symbol}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stealth-200 truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-stealth-400 mt-0.5">
                    {formatDateTime(item.published_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composite Score Chart */}
      {history.length > 0 && (() => {
        // Convert timestamps to numeric values and ensure unique dates
        const chartData = history.map(item => ({
          ...item,
          timestampNum: new Date(item.timestamp).getTime()
        }));
        
        // Calculate domain with today at the end
        const timestamps = chartData.map(d => d.timestampNum);
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);
        
        // Generate evenly spaced tick positions (5 ticks total, including start and end)
        const tickPositions: number[] = [];
        for (let i = 0; i < 5; i++) {
          tickPositions.push(minTime + (maxTime - minTime) * (i / 4));
        }
        
        console.log('SystemOverview chart data sample:', chartData.slice(0, 3), 'total:', chartData.length);
        
        return (
            <div className="pt-6 border-t border-stealth-700">
            <h4 className="text-sm font-semibold text-stealth-200 mb-4">
              Composite Score Trend
            </h4>
            <div className="w-full h-60 sm:h-72 lg:h-80 -mx-6 sm:mx-0 px-3 sm:px-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                  <XAxis
                    dataKey="timestampNum"
                    type="number"
                    domain={[minTime, maxTime]}
                    scale="linear"
                    ticks={tickPositions}
                    tickFormatter={(v: number) => {
                      const date = new Date(v);
                      const today = new Date();
                      const isToday = date.toDateString() === today.toDateString();
                      return isToday ? 'Today' : date.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      });
                    }}
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                    stroke="#555560"
                  />
                  <YAxis
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                    stroke="#555560"
                    domain={['dataMin - 5', 'dataMax + 5']}
                    scale="linear"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#161619",
                      borderColor: "#555560",
                      borderRadius: "6px",
                      padding: "8px",
                    }}
                    labelStyle={{ color: "#a4a4b0", fontSize: 11 }}
                    itemStyle={{ color: "#ffffff", fontSize: 11 }}
                    formatter={(value: number) => [`${value.toFixed(1)}`, "Score"]}
                    labelFormatter={(label: string | number) =>
                      new Date(label).toLocaleDateString()
                    }
                  />
                  <ReferenceLine y={70} stroke="#10b981" strokeDasharray="3 3" opacity={0.3} />
                  <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="3 3" opacity={0.3} />
                  <Line
                    type="monotone"
                    dataKey="composite_score"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={300}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-stealth-700">
        <div>
          <div className="text-xs text-stealth-400 mb-1">{periodLabel} Avg</div>
          <div className="text-sm font-semibold text-stealth-200">
            {(history.reduce((sum, p) => sum + p.composite_score, 0) / history.length).toFixed(1)}
          </div>
        </div>
        <div>
          <div className="text-xs text-stealth-400 mb-1">{periodLabel} High</div>
          <div className="text-sm font-semibold text-stealth-200">
            {Math.max(...history.map(p => p.composite_score)).toFixed(1)}
          </div>
        </div>
        <div>
          <div className="text-xs text-stealth-400 mb-1">{periodLabel} Low</div>
          <div className="text-sm font-semibold text-stealth-200">
            {Math.min(...history.map(p => p.composite_score)).toFixed(1)}
          </div>
        </div>
      </div>

      {/* Conclusion */}
      <div className="bg-stealth-900 border border-stealth-700 rounded p-3 mt-4">
        <p className="text-xs text-stealth-300 leading-relaxed">{systemSummary}</p>
      </div>
      </div>
    </Link>
  );
};

export default SystemOverviewWidget;
