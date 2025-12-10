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

interface Alert {
  id: number;
  timestamp: string;
  type: string;
  message: string;
  affected_indicators: string[];
}

interface Props {
  trendPeriod?: 90 | 180 | 365;
}

const SystemOverviewWidget = ({ trendPeriod = 90 }: Props) => {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [history, setHistory] = useState<SystemHistoryPoint[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusResponse, alertsResponse] = await Promise.all([
          fetch("http://localhost:8000/system"),
          fetch("http://localhost:8000/alerts?hours=24"),
        ]);
        
        if (!statusResponse.ok) throw new Error("Failed to fetch system status");
        if (!alertsResponse.ok) throw new Error("Failed to fetch alerts");
        
        const statusData = await statusResponse.json();
        const alertsData = await alertsResponse.json();
        
        setData(statusData);
        setAlerts(alertsData);
        
        // Build mock history for composite score trend based on trendPeriod
        const mockHistory: SystemHistoryPoint[] = [];
        const now = new Date();
        for (let i = trendPeriod; i >= 0; i--) {
          const timestamp = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const variation = Math.random() * 10 - 5; // Random variation
          const score = Math.max(0, Math.min(100, (statusData.composite_score || 50) + variation));
          mockHistory.push({
            timestamp: timestamp.toISOString(),
            composite_score: score,
            state: score < 40 ? "GREEN" : score < 70 ? "YELLOW" : "RED"
          });
        }
        setHistory(mockHistory);
        
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

  // Get recent alerts (last 3)
  const recentAlerts = alerts.slice(0, 3);

  // Calculate trend (last 7 days vs previous 7 days average)
  const last7 = history.slice(-7);
  const prev7 = history.slice(-14, -7);
  const last7Avg = last7.reduce((sum, p) => sum + p.composite_score, 0) / last7.length;
  const prev7Avg = prev7.reduce((sum, p) => sum + p.composite_score, 0) / prev7.length;
  const trend = last7Avg - prev7Avg;
  const trendDirection = trend > 2 ? "IMPROVING" : trend < -2 ? "WORSENING" : "STABLE";

  const trendColor = {
    IMPROVING: "text-green-400",
    WORSENING: "text-red-400",
    STABLE: "text-gray-400",
  }[trendDirection];

  const periodLabel = trendPeriod === 365 ? "1 year" : trendPeriod === 180 ? "6 months" : "90 days";

  return (
    <Link to="/system-breakdown" className="block">
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 space-y-4 hover:bg-stealth-750 hover:border-stealth-600 transition cursor-pointer">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-stealth-100">
              System Overview
            </h3>
            <span className="text-xs text-stealth-500">→ View Breakdown</span>
          </div>
          <span className="text-xs text-stealth-400">
            {data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : 'N/A'}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-stealth-400 leading-relaxed">
          Composite score aggregating 8 indicators: VIX, SPY, DFF, T10Y2Y, UNRATE, Consumer Health, 
          Bond Market Stability, and Liquidity Proxy. Weighted by historical predictive power.
        </p>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* System State */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-stealth-400">System State</span>
            <span className={`text-xl font-bold ${stateColor}`}>
              {data.state}
            </span>
          </div>
          <div className="relative h-2 bg-stealth-900 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                data.composite_score < 40
                  ? "bg-green-500"
                  : data.composite_score < 70
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
              style={{ width: `${compositePercentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-stealth-400">Composite:</span>
            <span className="text-stealth-200">{data.composite_score.toFixed(1)}</span>
          </div>
        </div>

        {/* Weekly Trend */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-stealth-400">7-Day Trend</span>
            <span className={`text-xl font-bold ${trendColor}`}>
              {trendDirection}
            </span>
          </div>
          <div className="relative h-2 bg-stealth-900 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-500 ${trendColor.replace('text-', 'bg-')}`}
              style={{ width: `${Math.min(100, Math.abs(trend) * 10)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-stealth-400">Change:</span>
            <span className="text-stealth-200">{trend > 0 ? '+' : ''}{trend.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* Status Badges */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700">
          <span className="text-xs text-stealth-400">Red Indicators:</span>
          <span className="text-xs font-semibold text-red-400">
            {data.red_count}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700">
          <span className="text-xs text-stealth-400">Yellow Indicators:</span>
          <span className="text-xs font-semibold text-yellow-400">
            {data.yellow_count}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700">
          <span className="text-xs text-stealth-400">Active Alerts:</span>
          <span className="text-xs font-semibold text-cyan-400">
            {alerts.length}
          </span>
        </div>
      </div>

      {/* Recent Alerts */}
      {recentAlerts.length > 0 && (
        <div className="pt-3 border-t border-stealth-700">
          <h4 className="text-sm font-semibold text-stealth-200 mb-2">
            Recent Alerts (24h)
          </h4>
          <div className="space-y-2">
            {recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-2 p-2 bg-stealth-900 rounded border border-stealth-700"
              >
                <span className="text-xs text-orange-400 mt-0.5">⚠</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stealth-200 truncate">
                    {alert.message}
                  </p>
                  <p className="text-xs text-stealth-400 mt-0.5">
                    {new Date(alert.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composite Score Chart */}
      {history.length > 0 && (
        <div className="pt-4 border-t border-stealth-700">
          <h4 className="text-sm font-semibold text-stealth-200 mb-3">
            Composite Score Trend
          </h4>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(v: string) =>
                    new Date(v).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  stroke="#555560"
                />
                <YAxis
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  stroke="#555560"
                  domain={[0, 100]}
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
                  labelFormatter={(label: string) =>
                    new Date(label).toLocaleDateString()
                  }
                />
                <ReferenceLine y={40} stroke="#10b981" strokeDasharray="3 3" opacity={0.3} />
                <ReferenceLine y={70} stroke="#eab308" strokeDasharray="3 3" opacity={0.3} />
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
      )}

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

      {/* System Description */}
      <div className="bg-stealth-900 border border-stealth-700 rounded p-3 mt-4">
        <p className="text-xs text-stealth-300 leading-relaxed">
          <span className="font-semibold text-stealth-200">Purpose:</span> This dashboard monitors real-time market stability by tracking key economic indicators including volatility (VIX), equity performance (SPY), interest rates (DFF), yield curve (T10Y2Y), and unemployment (UNRATE). Each indicator is scored 0-100 using statistical normalization, then classified as RED (stress), YELLOW (caution), or GREEN (stable). The composite score aggregates all indicators to provide an at-a-glance assessment of overall market health and emerging risks.
        </p>
      </div>
      </div>
    </Link>
  );
};

export default SystemOverviewWidget;
