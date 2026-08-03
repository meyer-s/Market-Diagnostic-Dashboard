export interface OptionalityMetrics {
  iv30: number | null;
  hv30: number | null;
  iv_percentile: number | null;
  iv30_chain_percentile?: number | null;
  iv30_chain_position?: string | null;
  iv30_chain_percentile_kind?: string | null;
  iv_percentile_kind?: string | null;
  avg_edr: number | null;
  observed_at?: string | null;
  data_source?: string | null;
  quote_source?: string | null;
  primary_data_source?: string | null;
  fallback_reason?: string | null;
  pricing_basis?: string | null;
  price_source_counts?: Record<string, number>;
  sample_counts?: {
    iv?: number;
    edr?: number;
  };
  component_usable?: {
    iv30?: boolean;
    iv_percentile?: boolean;
    iv30_chain_percentile?: boolean;
    avg_edr?: boolean;
    mispricing?: boolean;
  };
  mispricing_usable?: boolean;
  quality_status?: "good" | "limited" | "unusable" | string;
  quality_reasons?: string[];
}

interface OptionalityMispricingWidgetProps {
  metrics: OptionalityMetrics | null;
}

type PricingState = "CHEAP" | "FAIR" | "EXPENSIVE" | "UNKNOWN";

const getStateColor = (state: PricingState) =>
  ({
    CHEAP: "text-green-400",
    FAIR: "text-yellow-300",
    EXPENSIVE: "text-red-400",
    UNKNOWN: "text-stealth-300",
  }[state]);

const getStateLabel = (state: PricingState) =>
  ({
    CHEAP: "Cheap",
    FAIR: "Balanced",
    EXPENSIVE: "Expensive",
    UNKNOWN: "Unavailable",
  }[state]);

const getSignal = (value: number | null, high: number, low: number) => {
  if (value === null) return null;
  if (value >= high) return "EXPENSIVE";
  if (value <= low) return "CHEAP";
  return "FAIR";
};

const normalizeSource = (value: string | null | undefined) => {
  if (!value) return "Source unavailable";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatObservedAt = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function OptionalityMispricingWidget({ metrics }: OptionalityMispricingWidgetProps) {
  if (!metrics) {
    return (
      <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
        <div className="text-sm font-semibold text-stealth-100">Options Pricing Context</div>
        <p className="mt-2 text-xs text-stealth-400">Options data unavailable.</p>
      </div>
    );
  }

  const declaredUsable = metrics.mispricing_usable
    ?? metrics.component_usable?.mispricing
    ?? false;
  const usable = declaredUsable && metrics.quality_status !== "unusable";
  const iv30 = metrics.component_usable?.iv30 === false ? null : metrics.iv30;
  const hv30 = metrics.hv30;
  const chainIvPosition = metrics.component_usable?.iv30_chain_percentile === false
    ? null
    : metrics.iv30_chain_percentile
      ?? (metrics.iv_percentile_kind === "current_chain_cross_section" ? metrics.iv_percentile : null);
  const extrinsicShare = metrics.component_usable?.avg_edr === false ? null : metrics.avg_edr;
  const ivSpread = iv30 !== null && hv30 !== null ? iv30 - hv30 : null;

  const spreadSignal = ivSpread === null ? null : getSignal(ivSpread, 5, -5);
  const extrinsicSignal = getSignal(extrinsicShare, 60, 40);

  const signals = usable
    ? [spreadSignal, extrinsicSignal].filter(Boolean) as PricingState[]
    : [];
  let pricingState: PricingState = "UNKNOWN";
  if (signals.length > 0) {
    const counts = signals.reduce<Record<PricingState, number>>(
      (acc, signal) => {
        acc[signal] = (acc[signal] || 0) + 1;
        return acc;
      },
      { CHEAP: 0, FAIR: 0, EXPENSIVE: 0, UNKNOWN: 0 }
    );

    if (counts.CHEAP === counts.EXPENSIVE && counts.CHEAP > 0) {
      pricingState = "FAIR";
    } else if (counts.CHEAP >= counts.FAIR && counts.CHEAP > counts.EXPENSIVE) {
      pricingState = "CHEAP";
    } else if (counts.EXPENSIVE >= counts.FAIR && counts.EXPENSIVE > counts.CHEAP) {
      pricingState = "EXPENSIVE";
    } else {
      pricingState = "FAIR";
    }
  }

  const source = metrics.quote_source || metrics.data_source || metrics.primary_data_source;
  const observed = formatObservedAt(metrics.observed_at);
  const quality = metrics.quality_status && metrics.quality_status !== "good"
    ? metrics.quality_status.replace(/_/g, " ")
    : null;
  const metadataLine = [normalizeSource(source), quality, observed].filter(Boolean).join(" · ");
  const detailTitle = [
    metrics.fallback_reason,
    metrics.pricing_basis ? `Pricing basis: ${metrics.pricing_basis}` : null,
    ...(metrics.quality_reasons || []),
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stealth-100">Options Pricing Context</div>
          <p className="truncate text-xs capitalize text-stealth-400" title={detailTitle || undefined}>
            {metadataLine}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold ${getStateColor(pricingState)}`}>
            {getStateLabel(pricingState)}
          </div>
          <div className="text-xs uppercase tracking-[0.16em] text-stealth-500">
            {usable ? "Chain pricing read" : "Insufficient quality"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/70 p-2.5">
          <div className="mb-1 text-xs uppercase tracking-[0.16em] text-stealth-500">IV30 vs HV30</div>
          <div className="text-sm text-stealth-100">
            {iv30 !== null ? `${iv30.toFixed(1)}%` : "n/a"} / {hv30 !== null ? `${hv30.toFixed(1)}%` : "n/a"}
          </div>
          <div className={`text-xs ${!usable || ivSpread === null ? "text-stealth-300" : ivSpread >= 0 ? "text-rose-300" : "text-emerald-300"}`}>
            {ivSpread !== null ? `${ivSpread > 0 ? "+" : ""}${ivSpread.toFixed(1)} pts` : "n/a"}
          </div>
        </div>

        <div className="rounded-xl border border-stealth-700 bg-stealth-900/70 p-2.5">
          <div className="mb-1 text-xs uppercase tracking-[0.16em] text-stealth-500">Chain IV Position</div>
          <div className="text-sm text-stealth-100">
            {chainIvPosition !== null ? `${chainIvPosition.toFixed(1)}%` : "n/a"}
          </div>
          <div className="text-xs text-stealth-400">Current quotes only</div>
        </div>

        <div className="rounded-xl border border-stealth-700 bg-stealth-900/70 p-2.5">
          <div className="mb-1 text-xs uppercase tracking-[0.16em] text-stealth-500">Extrinsic Share</div>
          <div className="text-sm text-stealth-100">
            {extrinsicShare !== null ? `${extrinsicShare.toFixed(1)}%` : "n/a"}
          </div>
          <div className="text-xs text-stealth-400">Extrinsic / price</div>
        </div>
      </div>
    </div>
  );
}
