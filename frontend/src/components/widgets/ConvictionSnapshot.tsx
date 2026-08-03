/** Displays composite signal quality and directional score for a trailing window. */

interface ConvictionSnapshotProps {
  signalQuality: number;
  score: number;
  volatility: number;
  horizon: string;
}

export function ConvictionSnapshot({
  signalQuality,
  score,
  volatility,
  horizon,
}: ConvictionSnapshotProps) {
  const getQualityLevel = (value: number) => {
    if (value >= 75) return { label: "Very High", color: "text-sky-300", bg: "bg-sky-500/10", border: "border-sky-500/50" };
    if (value >= 60) return { label: "High", color: "text-blue-300", bg: "bg-blue-500/10", border: "border-blue-500/50" };
    if (value >= 45) return { label: "Moderate", color: "text-yellow-300", bg: "bg-yellow-500/10", border: "border-yellow-500/50" };
    if (value >= 30) return { label: "Low", color: "text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/50" };
    return { label: "Very Low", color: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/50" };
  };
  
  const qualityLevel = getQualityLevel(signalQuality);
  
  // Determine signal type based on score
  const getSignalType = (s: number) => {
    if (s >= 65) return { label: "Strong Bullish", icon: "↑↑", color: "text-green-400" };
    if (s >= 55) return { label: "Bullish", icon: "↑", color: "text-lime-400" };
    if (s <= 35) return { label: "Strong Bearish", icon: "↓↓", color: "text-red-400" };
    if (s <= 45) return { label: "Bearish", icon: "↓", color: "text-orange-400" };
    return { label: "Balanced", icon: "→", color: "text-stealth-400" };
  };
  
  const signal = getSignalType(score);
  
  // Volatility assessment
  const getVolatilityStatus = (v: number) => {
    if (v > 40) return { label: "Very High", color: "text-red-400" };
    if (v > 30) return { label: "High", color: "text-orange-400" };
    if (v > 20) return { label: "Moderate", color: "text-yellow-400" };
    if (v > 10) return { label: "Low", color: "text-green-400" };
    return { label: "Very Low", color: "text-green-400" };
  };
  
  const volStatus = getVolatilityStatus(volatility);
  const directionDistance = Math.abs(score - 50);
  const directionLabel = directionDistance >= 15
    ? "strong direction"
    : directionDistance >= 5
      ? "moderate direction"
      : "near-neutral direction";
  
  return (
    <div className={`secondary-card stock-conviction-panel flex h-full min-w-0 flex-col p-3 sm:p-4 ${qualityLevel.border} ${qualityLevel.bg}`}>
      {/* Header */}
      <div className="mb-3">
        <p className="text-xs text-stealth-400 mb-1">Signal Quality</p>
        <p className="text-xs text-stealth-300">{horizon} trailing window</p>
      </div>
      
      {/* Main quality display */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {/* Quality gauge */}
        <div className="col-span-2">
          <div className="flex items-end justify-between mb-1.5">
            <span className="text-xs text-stealth-400">Composite</span>
            <span className={`text-lg font-bold ${qualityLevel.color}`}>
              {signalQuality.toFixed(0)}/100
            </span>
          </div>
          <div className="w-full bg-stealth-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                signalQuality >= 75
                  ? "bg-sky-400"
                  : signalQuality >= 60
                  ? "bg-blue-400"
                  : signalQuality >= 45
                  ? "bg-yellow-500"
                  : signalQuality >= 30
                  ? "bg-orange-500"
                  : "bg-amber-500"
              }`}
              style={{ width: `${Math.max(0, Math.min(100, signalQuality))}%` }}
            />
          </div>
          <p className={`text-xs ${qualityLevel.color} mt-1 font-semibold`}>
            {qualityLevel.label}
          </p>
        </div>
        
        {/* Signal Indicator */}
        <div className="flex flex-col items-center justify-center bg-stealth-800/50 rounded p-1.5">
          <span className={`text-xl font-bold ${signal.color} mb-0.5`}>{signal.icon}</span>
          <p className={`text-xs font-semibold ${signal.color} text-center leading-tight`}>
            {signal.label}
          </p>
        </div>
      </div>
      
      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-1.5 mb-3 text-xs">
        {/* Score */}
        <div className="bg-stealth-800/30 rounded p-1.5 border border-stealth-700/50">
          <p className="text-stealth-400 mb-0.5 text-xs">Model Score</p>
          <p className="text-sm font-bold text-blue-300">{score.toFixed(0)}/100</p>
        </div>
        
        {/* Volatility */}
        <div className="bg-stealth-800/30 rounded p-1.5 border border-stealth-700/50">
          <p className="text-stealth-400 mb-0.5 text-xs">Vol</p>
          <p className={`text-sm font-bold ${volStatus.color}`}>
            {volatility.toFixed(1)}%
          </p>
        </div>
      </div>
      
      {/* The weighted composition answers the quality basis without explanatory prose. */}
      <div className="mt-auto rounded border border-stealth-700/30 bg-stealth-800/20 p-2 text-xs text-stealth-300">
        <div className="mb-1.5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="font-semibold">Quality drivers</span>
          <span className="text-right text-stealth-400">{volStatus.label} volatility · {directionLabel}</span>
        </div>
        <div
          className="flex h-2 overflow-hidden rounded-full bg-stealth-800"
          role="img"
          aria-label="Signal quality weighting: component consistency 40 percent, realized volatility 35 percent, directional strength 25 percent"
        >
          <span className="h-full w-[40%] bg-sky-400/80" />
          <span className="h-full w-[35%] bg-violet-400/75" />
          <span className="h-full w-[25%] bg-amber-300/75" />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-stealth-400">
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-sky-400/80" />Components 40%</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-violet-400/75" />Volatility 35%</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-300/75" />Direction 25%</span>
        </div>
      </div>
    </div>
  );
}
