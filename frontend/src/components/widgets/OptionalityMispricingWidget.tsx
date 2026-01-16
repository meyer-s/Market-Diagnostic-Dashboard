interface OptionalityMetrics {
  iv30: number | null;
  hv30: number | null;
  iv_percentile: number | null;
  avg_edr: number | null;
}

interface OptionalityMispricingWidgetProps {
  metrics: OptionalityMetrics | null;
}

type MispricingState = "CHEAP" | "FAIR" | "EXPENSIVE" | "UNKNOWN";

const getStateColor = (state: MispricingState) =>
  ({
    CHEAP: "text-green-400",
    FAIR: "text-yellow-300",
    EXPENSIVE: "text-red-400",
    UNKNOWN: "text-gray-400",
  }[state]);

const getStateLabel = (state: MispricingState) =>
  ({
    CHEAP: "Cheap",
    FAIR: "Fairly Valued",
    EXPENSIVE: "Expensive",
    UNKNOWN: "Unknown",
  }[state]);

const getSignal = (value: number | null, high: number, low: number) => {
  if (value === null) return null;
  if (value >= high) return "EXPENSIVE";
  if (value <= low) return "CHEAP";
  return "FAIR";
};

export function OptionalityMispricingWidget({ metrics }: OptionalityMispricingWidgetProps) {
  if (!metrics) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="text-sm font-semibold text-gray-100">Optionality Mispricing</div>
        <p className="text-xs text-gray-400 mt-2">Options data not available.</p>
      </div>
    );
  }

  const iv30 = metrics.iv30;
  const hv30 = metrics.hv30;
  const ivPercentile = metrics.iv_percentile;
  const avgEdr = metrics.avg_edr;

  const ivSpread = iv30 !== null && hv30 !== null ? iv30 - hv30 : null;

  const spreadSignal = ivSpread === null ? null : getSignal(ivSpread, 5, -5);
  const percentileSignal = getSignal(ivPercentile, 70, 30);
  const edrSignal = getSignal(avgEdr, 60, 40);

  const signals = [spreadSignal, percentileSignal, edrSignal].filter(Boolean) as MispricingState[];
  let mispricing: MispricingState = "UNKNOWN";
  if (signals.length > 0) {
    const counts = signals.reduce<Record<MispricingState, number>>(
      (acc, signal) => {
        acc[signal] = (acc[signal] || 0) + 1;
        return acc;
      },
      { CHEAP: 0, FAIR: 0, EXPENSIVE: 0, UNKNOWN: 0 }
    );

    if (counts.CHEAP === counts.EXPENSIVE && counts.CHEAP > 0) {
      mispricing = "FAIR";
    } else if (counts.CHEAP >= counts.FAIR && counts.CHEAP > counts.EXPENSIVE) {
      mispricing = "CHEAP";
    } else if (counts.EXPENSIVE >= counts.FAIR && counts.EXPENSIVE > counts.CHEAP) {
      mispricing = "EXPENSIVE";
    } else {
      mispricing = "FAIR";
    }
  }

  const stateColor = getStateColor(mispricing);
  const stateLabel = getStateLabel(mispricing);

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-100">Optionality Mispricing</div>
          <p className="text-xs text-gray-400">
            Compares implied vs realized volatility, IV percentile, and extrinsic density.
          </p>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold ${stateColor}`}>{stateLabel}</div>
          <div className="text-[10px] text-gray-400">Options chain value</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="bg-gray-800/70 border border-gray-700 rounded p-2">
          <div className="text-gray-400 mb-1">IV30 vs HV30</div>
          <div className="text-sm text-gray-100">
            {iv30 !== null ? `${iv30.toFixed(1)}%` : "n/a"} / {hv30 !== null ? `${hv30.toFixed(1)}%` : "n/a"}
          </div>
          <div className={`text-[10px] ${ivSpread !== null && ivSpread >= 0 ? "text-red-300" : "text-green-300"}`}>
            {ivSpread !== null ? `${ivSpread > 0 ? "+" : ""}${ivSpread.toFixed(1)} pts` : "n/a"}
          </div>
        </div>

        <div className="bg-gray-800/70 border border-gray-700 rounded p-2">
          <div className="text-gray-400 mb-1">IV Percentile</div>
          <div className="text-sm text-gray-100">
            {ivPercentile !== null ? `${ivPercentile.toFixed(1)}%` : "n/a"}
          </div>
          <div className="text-[10px] text-gray-400">Higher = richer IV</div>
        </div>

        <div className="bg-gray-800/70 border border-gray-700 rounded p-2">
          <div className="text-gray-400 mb-1">Avg EDR (front 3-6)</div>
          <div className="text-sm text-gray-100">
            {avgEdr !== null ? `${avgEdr.toFixed(1)}%` : "n/a"}
          </div>
          <div className="text-[10px] text-gray-400">Extrinsic / price</div>
        </div>

        <div className="bg-gray-800/70 border border-gray-700 rounded p-2">
          <div className="text-gray-400 mb-1">Vol Spread</div>
          <div className="text-sm text-gray-100">
            {ivSpread !== null ? `${ivSpread > 0 ? "+" : ""}${ivSpread.toFixed(1)} pts` : "n/a"}
          </div>
          <div className="text-[10px] text-gray-400">IV30 - HV30</div>
        </div>
      </div>
    </div>
  );
}
