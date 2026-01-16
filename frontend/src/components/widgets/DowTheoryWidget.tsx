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
import { getLegacyApiUrl } from "../../utils/apiUtils";
import { CHART_MARGIN } from "../../utils/chartUtils";
import { formatTime } from "../../utils/styleUtils";

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
  modern_direction: number;
  modern_direction_state: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
  modern_signal_strength: "WEAK" | "MODERATE" | "STRONG";
  modern_divergence: number;
  modern_defensive_outperformance: number;
  direction_spread: number;
  theory_alignment_score: number;
  theory_alignment_state: "ALIGNED" | "MIXED" | "DIVERGENT" | "UNKNOWN";
  components: {
    dji_roc: number;
    djt_roc: number;
    dju_roc: number;
    alignment_score: number;
  };
  modern_components: {
    dia_roc: number;
    iyt_roc: number;
    xlu_roc: number;
    alignment_score: number;
  };
}

interface HistoryPoint {
  timestamp: string;
  market_direction: number;
  modern_direction?: number | null;
  direction_spread?: number | null;
}

interface DowTheoryWidgetProps {
  trendPeriod?: number;
}

const DowTheoryWidget = ({ trendPeriod = 90 }: DowTheoryWidgetProps) => {
  const [data, setData] = useState<DowTheoryData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [activeTab, setActiveTab] = useState<"classic" | "modern">("classic");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = getLegacyApiUrl();
        const historyUrl = trendPeriod
          ? `${apiUrl}/dow-theory/history?days=${trendPeriod}`
          : `${apiUrl}/dow-theory/history`;
        const [currentResponse, historyResponse] = await Promise.all([
          fetch(`${apiUrl}/dow-theory`),
          fetch(historyUrl),
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
          Dow Theory Trends Stability
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

  const modernDirectionColor = {
    UP: "text-green-400",
    DOWN: "text-red-400",
    NEUTRAL: "text-gray-400",
    UNKNOWN: "text-gray-500",
  }[data.modern_direction_state];

  const modernSignalColor = {
    STRONG: "text-cyan-400",
    MODERATE: "text-gray-300",
    WEAK: "text-gray-500",
  }[data.modern_signal_strength];

  const alignmentColor = {
    ALIGNED: "text-green-400",
    MIXED: "text-yellow-400",
    DIVERGENT: "text-red-500",
    UNKNOWN: "text-gray-500",
  }[data.theory_alignment_state];

  const alignmentBarColor = {
    ALIGNED: "bg-green-500",
    MIXED: "bg-yellow-500",
    DIVERGENT: "bg-red-500",
    UNKNOWN: "bg-gray-600",
  }[data.theory_alignment_state];

  const modernConfirmationLabel =
    data.modern_components.alignment_score === 2
      ? "CONFIRMING"
      : data.modern_components.alignment_score === -2
      ? "DIVERGENT"
      : data.modern_components.alignment_score === 0
      ? "MIXED"
      : "PARTIAL";

  const modernConfirmationColor =
    data.modern_components.alignment_score === 2
      ? "text-green-400"
      : data.modern_components.alignment_score === -2
      ? "text-red-400"
      : data.modern_components.alignment_score === 0
      ? "text-yellow-400"
      : "text-orange-400";

  const utilitySpread = data.components
    ? data.components.dju_roc - data.components.dji_roc
    : 0;
  const utilitySpreadClass =
    utilitySpread > 0 ? "text-green-400" : utilitySpread < 0 ? "text-red-400" : "text-stealth-200";

  const directionSpread = data.direction_spread ?? 0;
  const directionSpreadClass =
    directionSpread > 0 ? "text-green-400" : directionSpread < 0 ? "text-red-400" : "text-stealth-200";

  const defensiveTilt = data.modern_defensive_outperformance ?? 0;
  const defensiveTiltClass =
    defensiveTilt > 0 ? "text-green-400" : defensiveTilt < 0 ? "text-red-400" : "text-stealth-200";

  // Direction gauge visual
  const directionPercentage = Math.max(
    0,
    Math.min(100, ((data.market_direction + 5) / 10) * 100)
  );

  const strainPercentage = Math.min(100, data.strain_score);

  const modernDirectionPercentage = Math.max(
    0,
    Math.min(100, ((data.modern_direction + 5) / 10) * 100)
  );
  const alignmentPercentage = Math.max(0, Math.min(100, data.theory_alignment_score));

  return (
    <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-stealth-100">
          Dow Theory Trends Stability
        </h3>
        <span className="text-xs text-stealth-400">
          {formatTime(data.timestamp)}
        </span>
      </div>

      <div className="bg-stealth-900 border border-stealth-700 rounded-lg p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-stealth-200">
              Classic vs Modern Alignment
            </div>
            <p className="text-xs text-stealth-400">
              Higher score means classic DJI/DJT and modern ETF proxies confirm
              the same economic trend.
            </p>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${alignmentColor}`}>
              {data.theory_alignment_score}
            </div>
            <div className={`text-xs font-semibold ${alignmentColor}`}>
              {data.theory_alignment_state}
            </div>
          </div>
        </div>
        <div className="relative h-2 bg-stealth-800 rounded-full overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-full transition-all duration-500 ${alignmentBarColor}`}
            style={{ width: `${alignmentPercentage}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-stealth-400">Spread (Modern - Classic)</span>
          <span className={`font-semibold ${directionSpreadClass}`}>
            {directionSpread > 0 ? "+" : ""}
            {directionSpread.toFixed(2)}%
          </span>
        </div>
      </div>

      {history.length > 0 && (
        <div className="pt-2 border-t border-stealth-700">
          <h4 className="text-sm font-semibold text-stealth-200 mb-3">
            Market Direction Trends
          </h4>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={CHART_MARGIN}>
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
                  formatter={(value: number, name: string) => [
                    `${value.toFixed(2)}%`,
                    name,
                  ]}
                  labelFormatter={(label: string) =>
                    new Date(label).toLocaleDateString()
                  }
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="market_direction"
                  name="Classic"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                  animationDuration={300}
                />
                <Line
                  type="monotone"
                  dataKey="modern_direction"
                  name="Modern"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  animationDuration={300}
                />
                <Line
                  type="monotone"
                  dataKey="direction_spread"
                  name="Spread"
                  stroke="#f97316"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-stealth-700 space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("classic")}
            className={`px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
              activeTab === "classic"
                ? "bg-stealth-700 text-stealth-100 border-stealth-500"
                : "bg-stealth-900 text-stealth-400 border-stealth-700 hover:text-stealth-200"
            }`}
          >
            Classic Dow Theory
          </button>
          <button
            onClick={() => setActiveTab("modern")}
            className={`px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
              activeTab === "modern"
                ? "bg-stealth-700 text-stealth-100 border-stealth-500"
                : "bg-stealth-900 text-stealth-400 border-stealth-700 hover:text-stealth-200"
            }`}
          >
            Modern Dow Theory
          </button>
        </div>

        {activeTab === "classic" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
                <div className="text-xs text-stealth-400 mb-1">
                  Utility Spread (DJU - DJI)
                </div>
                <div className={`text-sm font-semibold ${utilitySpreadClass}`}>
                  {utilitySpread > 0 ? "+" : ""}
                  {utilitySpread.toFixed(2)}%
                </div>
              </div>
            </div>

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
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-stealth-400">Modern Direction</span>
                  <span className={`text-xl font-bold ${modernDirectionColor}`}>
                    {data.modern_direction_state}
                  </span>
                </div>
                <div className="relative h-2 bg-stealth-900 rounded-full overflow-hidden">
                  <div
                    className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                      data.modern_direction > 0.25
                        ? "bg-green-500"
                        : data.modern_direction < -0.25
                        ? "bg-red-500"
                        : "bg-gray-500"
                    }`}
                    style={{ width: `${modernDirectionPercentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-stealth-400">Value:</span>
                  <span className="text-stealth-200">{data.modern_direction}%</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-stealth-400">Signal Strength</span>
                  <span className={`text-xl font-bold ${modernSignalColor}`}>
                    {data.modern_signal_strength}
                  </span>
                </div>
                <div className="text-xs text-stealth-400">Defensive Tilt (XLU - DIA)</div>
                <div className={`text-sm font-semibold ${defensiveTiltClass}`}>
                  {defensiveTilt > 0 ? "+" : ""}
                  {defensiveTilt.toFixed(2)}%
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700">
                <span className="text-xs text-stealth-400">Confirmation:</span>
                <span className={`text-xs font-semibold ${modernConfirmationColor}`}>
                  {modernConfirmationLabel}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 bg-stealth-900 rounded-full border border-stealth-700">
                <span className="text-xs text-stealth-400">Signal:</span>
                <span className={`text-xs font-semibold ${modernSignalColor}`}>
                  {data.modern_signal_strength}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-stealth-700">
              <div>
                <div className="text-xs text-stealth-400 mb-1">DIA ROC</div>
                <div
                  className={`text-sm font-semibold ${
                    data.modern_components.dia_roc > 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {data.modern_components.dia_roc}%
                </div>
              </div>
              <div>
                <div className="text-xs text-stealth-400 mb-1">IYT ROC</div>
                <div
                  className={`text-sm font-semibold ${
                    data.modern_components.iyt_roc > 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {data.modern_components.iyt_roc}%
                </div>
              </div>
              <div>
                <div className="text-xs text-stealth-400 mb-1">XLU ROC</div>
                <div
                  className={`text-sm font-semibold ${
                    data.modern_components.xlu_roc > 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {data.modern_components.xlu_roc}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-stealth-700">
              <div>
                <div className="text-xs text-stealth-400 mb-1">
                  DIA/IYT Divergence
                </div>
                <div className="text-sm font-semibold text-stealth-200">
                  {data.modern_divergence}
                </div>
              </div>
              <div>
                <div className="text-xs text-stealth-400 mb-1">
                  Defensive Tilt (XLU - DIA)
                </div>
                <div className={`text-sm font-semibold ${defensiveTiltClass}`}>
                  {defensiveTilt > 0 ? "+" : ""}
                  {defensiveTilt.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-stealth-700">
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
        >
          {showInfo ? "Hide" : "Show"} Theory Details
          <span className="text-xs">{showInfo ? "^" : "v"}</span>
        </button>

        {showInfo && (
          <div className="mt-3 space-y-3 text-sm text-stealth-300">
            <div>
              <p className="font-semibold text-stealth-200 mb-1">
                Classic Dow Theory
              </p>
              <p className="text-xs leading-relaxed">
                Uses Dow Jones Industrials (DJI) and Transports (DJT) to confirm
                trend strength. Utilities (DJU) act as a risk-off check; rising
                utilities while industrials/transports weaken flags instability.
              </p>
            </div>

            <div>
              <p className="font-semibold text-stealth-200 mb-1">
                Modern Dow Theory
              </p>
              <p className="text-xs leading-relaxed">
                Uses ETF proxies (DIA, IYT, XLU) to capture current sector mix
                and liquidity conditions. Strong agreement between DIA and IYT
                signals broad participation, while defensive tilts in XLU signal
                caution.
              </p>
            </div>

            <div>
              <p className="font-semibold text-stealth-200 mb-1">
                Derived Conclusion
              </p>
              <p className="text-xs leading-relaxed">
                The alignment score rewards tight spread between classic and
                modern direction lines. High alignment implies stable economic
                confirmation; low alignment suggests regime uncertainty and
                higher risk of volatility.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DowTheoryWidget;
