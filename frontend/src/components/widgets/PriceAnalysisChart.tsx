/**
 * Price Analysis Chart Component
 *
 * Displays stock price with volatility-based reference bands
 * Visual representation of upside/downside potential and risk levels
 */

interface PriceAnalysisChartProps {
  currentPrice: number;
  takeProfit: number;
  stopLoss: number;
  trailingReturn: number;
  horizon: string;
  analystTarget?: number | null;
  analystCount?: number | null;
  priceHistory?: Array<{ date: string; close: number }>;
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
