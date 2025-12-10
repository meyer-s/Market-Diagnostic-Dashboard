import { useEffect, useState } from "react";
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

interface DowTheoryData {
  timestamp: string;
  market_direction: number;
  direction_state: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
  signal_strength: "WEAK" | "MODERATE" | "STRONG";
  confirmation_state: "BULL" | "BEAR" | "MIXED";
  strain_score: number;
  strain_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNKNOWN";
  divergence: number;
  util_outperformance: number;
  etf_direction: number | null;
  futures_direction: number | null;
  components: {
    dji_roc: number;
    djt_roc: number;
    dju_roc: number;
    alignment_score: number;
  };
}

interface HistoryPoint {
  timestamp: string;
  market_direction: number;
}

const DowTheoryWidget = () => {
  const [data, setData] = useState<DowTheoryData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [currentResponse, historyResponse] = await Promise.all([
          fetch("http://localhost:8000/dow-theory"),
          fetch("http://localhost:8000/dow-theory/history"),
        ]);
        
        if (!currentResponse.ok) throw new Error("Failed to fetch Dow Theory data");
        if (!historyResponse.ok) throw new Error("Failed to fetch history");
        
        const currentData = await currentResponse.json();
        const historyData = await historyResponse.json();
        
        setData(currentData);
        setHistory(historyData);
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
  }, []);

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
          Dow Theory Market Strain
        </h3>
        <p className="text-stealth-400 text-sm">
          {error || "No data available"}
        </p>
      </div>
    );
  }

  // Color mappings
  const directionColor = {
    UP: "text-green-400",
    DOWN: "text-red-400",
    NEUTRAL: "text-gray-400",
    UNKNOWN: "text-gray-500",
  }[data.direction_state];

  const confirmColor = {
    BULL: "text-green-400",
    BEAR: "text-red-400",
    MIXED: "text-orange-400",
  }[data.confirmation_state];

  const strainColor = {
    LOW: "text-green-400",
    MODERATE: "text-yellow-400",
    HIGH: "text-orange-400",
    CRITICAL: "text-red-500",
    UNKNOWN: "text-gray-500",
  }[data.strain_level];

  const signalColor = {
    STRONG: "text-cyan-400",
    MODERATE: "text-gray-300",
    WEAK: "text-gray-500",
  }[data.signal_strength];

  // Direction gauge visual
  const directionPercentage = Math.max(
    0,
    Math.min(100, ((data.market_direction + 5) / 10) * 100)
  );

  const strainPercentage = Math.min(100, data.strain_score);

  return (
    <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-stealth-100">
          Dow Theory Market Strain
        </h3>
        <span className="text-xs text-stealth-400">
          {new Date(data.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Market Direction */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-stealth-400">Market Direction</span>
            <span className={`text-xl font-bold ${directionColor}`}>
              {data.direction_state}
            </span>
          </div>
          <div className="relative h-2 bg-stealth-900 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                data.market_direction > 0.25
                  ? "bg-green-500"
                  : data.market_direction < -0.25
                  ? "bg-red-500"
                  : "bg-gray-500"
              }`}
              style={{ width: `${directionPercentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-stealth-400">Value:</span>
            <span className="text-stealth-200">{data.market_direction}%</span>
          </div>
        </div>

        {/* Strain Score */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-stealth-400">Strain Level</span>
            <span className={`text-xl font-bold ${strainColor}`}>
              {data.strain_level}
            </span>
          </div>
          <div className="relative h-2 bg-stealth-900 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                data.strain_score < 25
                  ? "bg-green-500"
                  : data.strain_score < 50
                  ? "bg-yellow-500"
                  : data.strain_score < 75
                  ? "bg-orange-500"
                  : "bg-red-500"
              }`}
              style={{ width: `${strainPercentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-stealth-400">Score:</span>
            <span className="text-stealth-200">{data.strain_score}</span>
          </div>
        </div>
      </div>

      {/* Status Badges */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700">
          <span className="text-xs text-stealth-400">Confirmation:</span>
          <span className={`text-xs font-semibold ${confirmColor}`}>
            {data.confirmation_state}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700">
          <span className="text-xs text-stealth-400">Signal:</span>
          <span className={`text-xs font-semibold ${signalColor}`}>
            {data.signal_strength}
          </span>
        </div>
      </div>

      {/* Component Details */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-stealth-700">
        <div>
          <div className="text-xs text-stealth-400 mb-1">DJI ROC</div>
          <div
            className={`text-sm font-semibold ${
              data.components.dji_roc > 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {data.components.dji_roc}%
          </div>
        </div>
        <div>
          <div className="text-xs text-stealth-400 mb-1">DJT ROC</div>
          <div
            className={`text-sm font-semibold ${
              data.components.djt_roc > 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {data.components.djt_roc}%
          </div>
        </div>
        <div>
          <div className="text-xs text-stealth-400 mb-1">DJU ROC</div>
          <div
            className={`text-sm font-semibold ${
              data.components.dju_roc > 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {data.components.dju_roc}%
          </div>
        </div>
      </div>

      {/* Strain Breakdown */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-stealth-700">
        <div>
          <div className="text-xs text-stealth-400 mb-1">
            DJI/DJT Divergence
          </div>
          <div className="text-sm font-semibold text-stealth-200">
            {data.divergence}
          </div>
        </div>
        <div>
          <div className="text-xs text-stealth-400 mb-1">Utility Risk</div>
          <div className="text-sm font-semibold text-stealth-200">
            {data.util_outperformance}
          </div>
        </div>
      </div>

      {/* Proxy Indicators */}
      {(data.etf_direction !== null || data.futures_direction !== null) && (
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-stealth-700">
          {data.etf_direction !== null && (
            <div>
              <div className="text-xs text-stealth-400 mb-1">
                ETF Direction
              </div>
              <div
                className={`text-sm font-semibold ${
                  data.etf_direction > 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {data.etf_direction}%
              </div>
            </div>
          )}
          {data.futures_direction !== null && (
            <div>
              <div className="text-xs text-stealth-400 mb-1">
                Futures Direction
              </div>
              <div
                className={`text-sm font-semibold ${
                  data.futures_direction > 0
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {data.futures_direction}%
              </div>
            </div>
          )}
        </div>
      )}

      {/* Market Direction Chart */}
      {history.length > 0 && (
        <div className="pt-4 border-t border-stealth-700">
          <h4 className="text-sm font-semibold text-stealth-200 mb-3">
            Market Direction Trend
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
                  domain={["auto", "auto"]}
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
                  formatter={(value: number) => [`${value.toFixed(2)}%`, "Direction"]}
                  labelFormatter={(label: string) =>
                    new Date(label).toLocaleDateString()
                  }
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="market_direction"
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

      {/* Info Toggle */}
      <div className="pt-4 border-t border-stealth-700">
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
        >
          {showInfo ? "Hide" : "Show"} Theory Details
          <span className="text-xs">{showInfo ? "▲" : "▼"}</span>
        </button>

        {showInfo && (
          <div className="mt-3 space-y-3 text-sm text-stealth-300">
            <div>
              <p className="font-semibold text-stealth-200 mb-1">
                What is Dow Theory?
              </p>
              <p className="text-xs leading-relaxed">
                Classic market analysis using Dow Jones Industrials (DJI),
                Transports (DJT), and Utilities (DJU) to identify market trends
                and confirm bullish or bearish conditions.
              </p>
            </div>

            <div>
              <p className="font-semibold text-stealth-200 mb-1">
                Market Direction
              </p>
              <p className="text-xs leading-relaxed">
                Combines DJI and DJT momentum with alignment factors. Positive
                values signal bullish bias, negative values signal bearish bias.
                Strong confirmation occurs when both indices move together.
              </p>
            </div>

            <div>
              <p className="font-semibold text-stealth-200 mb-1">
                Strain Score
              </p>
              <p className="text-xs leading-relaxed">
                Measures market stress from: (1) DJI/DJT divergence (classic
                non-confirmation), (2) Utility outperformance (risk-off
                rotation). Higher strain indicates market instability.
              </p>
            </div>

            <div>
              <p className="font-semibold text-stealth-200 mb-1">Thresholds</p>
              <p className="text-xs leading-relaxed">
                <span className="text-green-400">LOW (&lt;25)</span>: Healthy confirmation.{" "}
                <span className="text-yellow-400">MODERATE (25-50)</span>: Some divergence.{" "}
                <span className="text-orange-400">HIGH (50-75)</span>: Notable stress.{" "}
                <span className="text-red-400">CRITICAL (75+)</span>: Extreme divergence or risk-off.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DowTheoryWidget;
