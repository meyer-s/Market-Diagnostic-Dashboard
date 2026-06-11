/**
 * Price Analysis Chart Component
 *
 * Displays stock price with volatility-based reference bands and history overlays.
 * Supports unified 252d/1Y/5Y/Max history views.
 */

import { ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type HistoryWindow = "252d" | "1y" | "5y" | "max";

interface PriceAnalysisChartProps {
  currentPrice: number;
  takeProfit: number;
  stopLoss: number;
  trailingReturn: number;
  horizon: string;
  analystTarget?: number | null;
  analystCount?: number | null;
  priceHistory?: Array<{ date: string; close: number }>;
  intradayHistory2h?: Array<{ timestamp: string; close: number }>;
  historyWindow?: HistoryWindow;
  onHistoryWindowChange?: (window: HistoryWindow) => void;
  flowEvents?: Array<{
    date: string;
    price: number;
    volume: number;
    notional: number;
    volume_z: number;
    side: "buy" | "sell" | "neutral";
    strength: number;
  }>;
}

export function PriceAnalysisChart({
  currentPrice,
  takeProfit,
  stopLoss,
  trailingReturn,
  horizon,
  analystTarget,
  analystCount,
  priceHistory = [],
  intradayHistory2h = [],
  historyWindow = "252d",
  onHistoryWindowChange,
  flowEvents = [],
}: PriceAnalysisChartProps) {
  // Calculate percentages for visualization
  const safeStopLoss = Math.max(0, stopLoss);
  const tpUpside = ((takeProfit - currentPrice) / currentPrice) * 100;
  const slDownside = ((currentPrice - safeStopLoss) / currentPrice) * 100;
  const trailingPercent = trailingReturn;

  // Color coding
  const isPositive = trailingReturn > 0;
  const returnColor = isPositive ? "text-green-400" : "text-red-400";
  const returnBg = isPositive ? "bg-green-500/10" : "bg-red-500/10";
  const returnBorder = isPositive ? "border-green-500/50" : "border-red-500/50";
  const maxRange = Math.max(slDownside, tpUpside) * 1.2;
  const slHeight = (slDownside / maxRange) * 100;
  const tpHeight = (tpUpside / maxRange) * 100;
  
  const modelTarget = takeProfit;
  const hasAnalystTarget =
    analystTarget !== null && analystTarget !== undefined && analystTarget > 0;
  const analystDiffPct = hasAnalystTarget
    ? ((modelTarget - analystTarget) / analystTarget) * 100
    : null;
  let analystAlignment = "n/a";
  let analystColor = "text-gray-400";
  if (analystDiffPct !== null) {
    if (Math.abs(analystDiffPct) <= 5) {
      analystAlignment = "Aligned";
      analystColor = "text-green-400";
    } else if (analystDiffPct > 5) {
      analystAlignment = "Above analysts";
      analystColor = "text-orange-300";
    } else {
      analystAlignment = "Below analysts";
      analystColor = "text-blue-300";
    }
  }

  const isShortView = historyWindow === "252d";

  const chartData = (() => {
    if (isShortView && intradayHistory2h.length > 0) {
      const closes = intradayHistory2h.map((p) => p.close);
      return intradayHistory2h.map((point, idx) => {
        const sma50 = idx >= 49 ? closes.slice(idx - 49, idx + 1).reduce((a, b) => a + b, 0) / 50 : null;
        const sma200 = idx >= 199 ? closes.slice(idx - 199, idx + 1).reduce((a, b) => a + b, 0) / 200 : null;
        const day = point.timestamp.slice(0, 10);
        const hasFlow = flowEvents.some((evt) => evt.date === day && evt.side !== "neutral");
        return {
          x: point.timestamp,
          close: point.close,
          sma50,
          sma200,
          eventPrice: hasFlow ? point.close : null,
        };
      });
    }

    return priceHistory.map((point) => ({
      x: point.date,
      close: point.close,
      sma50: null,
      sma200: null,
      eventPrice: null,
    }));
  })();

  const formatTick = (value: string) => {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    if (isShortView) {
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  const formatLabel = (value: string) => {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    if (isShortView) {
      return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
    return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };
  
  return (
    <div className="bg-gray-900 rounded-lg p-3 sm:p-4 border border-gray-700">
      {/* Header */}
      <div className="mb-3">
        <p className="text-xs text-gray-400 mb-1">Price Analysis for {horizon}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-gray-400">Current Price</p>
            <p className="text-xl font-bold text-white">${currentPrice.toFixed(2)}</p>
          </div>
          <div className={`text-right px-2 py-1 rounded text-xs ${returnBg} border ${returnBorder}`}>
            <p className="text-xs text-gray-300 mb-0.5">Trailing Return</p>
            <p className={`text-base font-bold ${returnColor}`}>
              {trailingReturn > 0 ? "+" : ""}{trailingPercent.toFixed(1)}%
            </p>
          </div>
        </div>
        {hasAnalystTarget && (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
            <span>
              Analyst target: ${analystTarget!.toFixed(2)}
              {analystCount ? ` (${analystCount})` : ""}
            </span>
            <span className={`font-semibold ${analystColor}`}>
              Analyst Alignment: {analystAlignment}
            </span>
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">Unified price history</p>
        <div className="flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800/70 p-0.5">
          {([
            { value: "252d", label: "252D" },
            { value: "1y", label: "1Y" },
            { value: "5y", label: "5Y" },
            { value: "max", label: "Max" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onHistoryWindowChange?.(opt.value)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] ${
                historyWindow === opt.value ? "bg-gray-600 text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="mb-3 h-56 rounded border border-gray-800 bg-gray-950/50 p-2" style={{ minWidth: 0, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={chartData}>
              <XAxis dataKey="x" tickFormatter={formatTick} tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                tick={{ fill: "#9ca3af", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                labelFormatter={(label) => formatLabel(String(label))}
                formatter={(value: number, name: string) => {
                  if (name === "close") return [`$${Number(value).toFixed(2)}`, "Price"];
                  if (name === "sma50") return [`$${Number(value).toFixed(2)}`, "SMA 50 (2h)"];
                  if (name === "sma200") return [`$${Number(value).toFixed(2)}`, "SMA 200 (2h)"];
                  return [value, name];
                }}
                contentStyle={{
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Line type="monotone" dataKey="close" stroke="#60a5fa" strokeWidth={2} dot={false} name="close" />
              {isShortView && (
                <>
                  <Line type="monotone" dataKey="sma50" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="sma50" />
                  <Line type="monotone" dataKey="sma200" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="sma200" />
                  <Line type="monotone" dataKey="eventPrice" stroke="#22c55e" strokeWidth={0} dot={{ r: 2 }} name="eventPrice" />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mb-3">
        <div className="flex items-flex-end justify-between h-32 gap-2 px-1">
          <div className="flex flex-col items-center flex-1">
            <div className="w-full flex flex-col-reverse items-center justify-end h-32 mb-1">
              <div
                className="w-full bg-red-500/30 border border-red-500/50 rounded-sm transition-all"
                style={{ height: `${slHeight}%`, minHeight: "3px" }}
              />
            </div>
            <div className="text-center">
              <p className="text-xs text-red-400 font-semibold">Stop Loss</p>
              <p className="text-xs text-red-300">${safeStopLoss.toFixed(2)}</p>
              <p className="text-xs text-red-200">-{slDownside.toFixed(1)}%</p>
            </div>
          </div>

          <div className="flex flex-col items-center flex-1">
            <div className="w-full flex flex-col-reverse items-center justify-end h-32 mb-1">
              <div
                className="w-full bg-green-500/30 border border-green-500/50 rounded-sm transition-all"
                style={{ height: `${tpHeight}%`, minHeight: "3px" }}
              />
            </div>
            <div className="text-center">
              <p className="text-xs text-green-400 font-semibold">Take Profit</p>
              <p className="text-xs text-green-300">${takeProfit.toFixed(2)}</p>
              <p className="text-xs text-green-200">+{tpUpside.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 gap-1 text-xs">
        <div className="bg-red-500/10 border border-red-500/30 rounded p-1.5">
          <p className="text-red-300 text-xs mb-0.5">Risk/Reward</p>
          <p className="text-red-200 font-semibold text-xs">
            1 : {(tpUpside / slDownside).toFixed(2)}
          </p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded p-1.5">
          <p className="text-blue-300 text-xs mb-0.5">Risk</p>
          <p className="text-blue-200 font-semibold text-xs">
            {slDownside.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}
