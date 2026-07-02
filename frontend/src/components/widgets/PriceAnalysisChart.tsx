/**
 * Price Analysis Chart Component
 *
 * Displays stock price with volatility-based reference bands and history overlays.
 * Supports unified 252d/1Y/5Y/Max history views.
 */

interface PriceAnalysisChartProps {
  currentPrice: number;
  takeProfit: number;
  rawUpperReference?: number | null;
  stopLoss: number;
  trailingReturn: number;
  horizon: string;
  analystTarget?: number | null;
  analystCount?: number | null;
  targetRegime?: string | null;
  sanityFlags?: Array<{
    type: string;
    severity?: string;
    message?: string;
    threshold?: number;
    value?: number;
  }>;
}

export function PriceAnalysisChart({
  currentPrice,
  takeProfit,
  rawUpperReference,
  stopLoss,
  trailingReturn,
  horizon,
  analystTarget,
  analystCount,
  targetRegime,
  sanityFlags,
}: PriceAnalysisChartProps) {
  // Calculate percentages for visualization
  const safeStopLoss = Math.max(0, stopLoss);
  const rawUpper = rawUpperReference && rawUpperReference > 0 ? rawUpperReference : takeProfit;
  const tpUpside = ((takeProfit - currentPrice) / currentPrice) * 100;
  const rawUpside = ((rawUpper - currentPrice) / currentPrice) * 100;
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
  const hasRawExtensionGap = rawUpper > takeProfit * 1.03;
  const normalizedTargetRegime = (targetRegime || "technical_extension").replace(/_/g, " ");
  const highSeverityFlags = (sanityFlags || []).filter((flag) => flag.severity === "high");
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
        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
          <span>Target Regime: <span className="text-gray-200 capitalize">{normalizedTargetRegime}</span></span>
          {highSeverityFlags.length > 0 && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
              valuation caution
            </span>
          )}
        </div>
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
              <p className="text-xs text-green-400 font-semibold">Trade Target</p>
              <p className="text-xs text-green-300">${takeProfit.toFixed(2)}</p>
              <p className="text-xs text-green-200">+{tpUpside.toFixed(1)}%</p>
              {hasRawExtensionGap && (
                <p className="mt-0.5 text-[10px] text-amber-300">
                  Raw ext ${rawUpper.toFixed(2)} (+{rawUpside.toFixed(1)}%)
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {hasRawExtensionGap && (
        <div className="mb-3 rounded border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
          Raw extension is shown for signal context and may not be valuation-adjusted.
        </div>
      )}

      {sanityFlags && sanityFlags.length > 0 && (
        <div className="mb-3 rounded border border-amber-500/35 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Sanity Flags</p>
          <p className="mt-1 text-xs text-amber-200">
            {sanityFlags.map((flag) => flag.message || flag.type.replace(/_/g, " ")).join("; ")}
          </p>
        </div>
      )}
      
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
