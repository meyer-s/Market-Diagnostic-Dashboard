/**
 * Price Analysis Chart Component
 *
 * Displays stock price with volatility-based reference bands and history overlays.
 * Supports unified 252d/1Y/5Y/Max history views.
 */

interface PriceAnalysisChartProps {
  latestClose: number;
  closeLabel?: string;
  upperReference: number;
  rawUpperReference?: number | null;
  lowerReference: number;
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
  latestClose,
  closeLabel = "Latest Close",
  upperReference,
  rawUpperReference,
  lowerReference,
  trailingReturn,
  horizon,
  analystTarget,
  analystCount,
  targetRegime,
  sanityFlags,
}: PriceAnalysisChartProps) {
  // Calculate percentages for visualization
  const safeLatestClose = Math.max(0.01, latestClose);
  const safeLowerReference = Math.max(0, lowerReference);
  const rawUpper = rawUpperReference && rawUpperReference > 0 ? rawUpperReference : upperReference;
  const upperDistance = ((upperReference - safeLatestClose) / safeLatestClose) * 100;
  const rawUpside = ((rawUpper - safeLatestClose) / safeLatestClose) * 100;
  const lowerDistance = ((safeLowerReference - safeLatestClose) / safeLatestClose) * 100;
  const upperVisualDistance = Math.max(0, upperDistance);
  const lowerVisualDistance = Math.max(0, -lowerDistance);
  const rangeRatio = upperDistance > 0 && lowerDistance < 0
    ? upperDistance / Math.abs(lowerDistance)
    : null;
  const formatSignedPercent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  const trailingPercent = trailingReturn;

  // Color coding
  const isPositive = trailingReturn > 0;
  const returnColor = isPositive ? "text-green-400" : "text-red-400";
  const returnBg = isPositive ? "bg-green-500/10" : "bg-red-500/10";
  const returnBorder = isPositive ? "border-green-500/50" : "border-red-500/50";
  const maxRange = Math.max(lowerVisualDistance, upperVisualDistance, 0.01) * 1.2;
  const lowerHeight = Math.min(100, (lowerVisualDistance / maxRange) * 100);
  const upperHeight = Math.min(100, (upperVisualDistance / maxRange) * 100);
  
  const modelReference = upperReference;
  const hasRawExtensionGap = rawUpper > upperReference * 1.03;
  const normalizedTargetRegime = targetRegime?.trim()
    ? targetRegime.trim().replace(/_/g, " ")
    : null;
  const highSeverityFlags = (sanityFlags || []).filter((flag) => flag.severity === "high");
  const hasAnalystTarget =
    analystTarget !== null && analystTarget !== undefined && analystTarget > 0;
  const analystDiffPct = hasAnalystTarget
    ? ((modelReference - analystTarget) / analystTarget) * 100
    : null;
  let analystAlignment = "n/a";
  let analystColor = "text-stealth-400";
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
    <div className="secondary-card stock-price-analysis-panel h-full min-w-0 p-3 sm:p-4">
      {/* Header */}
      <div className="mb-3">
        <p className="text-xs text-stealth-400 mb-1">Price Analysis for {horizon}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-stealth-400">{closeLabel}</p>
            <p className="text-xl font-bold text-white">${latestClose.toFixed(2)}</p>
          </div>
          <div className={`w-fit shrink-0 rounded border px-2 py-1 text-left text-xs sm:text-right ${returnBg} ${returnBorder}`}>
            <p className="text-xs text-stealth-300 mb-0.5">Trailing Price Return</p>
            <p className={`text-base font-bold ${returnColor}`}>
              {trailingReturn > 0 ? "+" : ""}{trailingPercent.toFixed(1)}%
            </p>
          </div>
        </div>
        {hasAnalystTarget && (
          <div
            data-testid="analyst-reference-context"
            className="mt-2 flex flex-col items-start gap-1 text-xs leading-5 text-stealth-400 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              Analyst reference: ${analystTarget!.toFixed(2)}
              {analystCount ? ` (${analystCount})` : ""}
            </span>
            <span className={`font-semibold ${analystColor}`}>
              Reference alignment: {analystAlignment}
            </span>
          </div>
        )}
        {(normalizedTargetRegime || highSeverityFlags.length > 0) && (
          <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs text-stealth-400 ${normalizedTargetRegime ? "justify-between" : "justify-end"}`}>
            {normalizedTargetRegime && (
              <span>Reference basis: <span className="text-stealth-200 capitalize">{normalizedTargetRegime}</span></span>
            )}
            {highSeverityFlags.length > 0 && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs uppercase tracking-wide text-amber-300">
                reference caution
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="grid grid-cols-2 items-start gap-3 px-1">
          <div className="flex min-w-0 flex-col items-center">
            <div className="mb-2 flex h-20 w-full flex-col-reverse items-center justify-end sm:h-24">
              <div
                className="w-full bg-red-500/30 border border-red-500/50 rounded-sm transition-all"
                style={{ height: `${lowerHeight}%`, minHeight: "3px" }}
              />
            </div>
            <div className="text-center">
              <p className="text-xs text-red-400 font-semibold">Lower Reference</p>
              <p className="text-xs text-red-300">${safeLowerReference.toFixed(2)}</p>
              <p className="text-xs text-red-200">{formatSignedPercent(lowerDistance)}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-center">
            <div className="mb-2 flex h-20 w-full flex-col-reverse items-center justify-end sm:h-24">
              <div
                className="w-full bg-green-500/30 border border-green-500/50 rounded-sm transition-all"
                style={{ height: `${upperHeight}%`, minHeight: "3px" }}
              />
            </div>
            <div className="text-center">
              <p className="text-xs text-green-400 font-semibold">Upper Reference</p>
              <p className="text-xs text-green-300">${upperReference.toFixed(2)}</p>
              <p className="text-xs text-green-200">{formatSignedPercent(upperDistance)}</p>
              {hasRawExtensionGap && (
                <p className="mt-0.5 text-xs text-amber-300">
                  Raw ext ${rawUpper.toFixed(2)} ({formatSignedPercent(rawUpside)})
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {hasRawExtensionGap && (
        <div className="mb-3 rounded border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200">
          Technical extension is shown for context and may not be valuation-adjusted.
        </div>
      )}

      {sanityFlags && sanityFlags.length > 0 && (
        <div className="mb-3 rounded border border-amber-500/35 bg-amber-500/10 px-2.5 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Reference Checks</p>
          <p className="mt-1 text-xs text-amber-200">
            {sanityFlags.map((flag) => flag.message || flag.type.replace(/_/g, " ")).join("; ")}
          </p>
        </div>
      )}
      
      {/* Stats */}
      <div className="grid grid-cols-2 gap-1 text-xs">
        <div className="bg-red-500/10 border border-red-500/30 rounded p-1.5">
          <p className="text-red-300 text-xs mb-0.5">Upper / Lower</p>
          <p className="text-red-200 font-semibold text-xs">
            {rangeRatio === null ? "n/a" : `${rangeRatio.toFixed(2)}×`}
          </p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded p-1.5">
          <p className="text-blue-300 text-xs mb-0.5">Lower Distance</p>
          <p className="text-blue-200 font-semibold text-xs">
            {formatSignedPercent(lowerDistance)}
          </p>
        </div>
      </div>
    </div>
  );
}
