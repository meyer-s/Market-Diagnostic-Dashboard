export interface NarrativeCluster {
  cluster_id: string;
  title: string;
  link?: string | null;
  source: string;
  first_seen: string;
  last_seen: string;
  direction: number;
  relevance: number;
  novelty: number;
  confidence: number;
  time_decay: number;
  impulse: number;
  propagation_count: number;
  independent_source_count: number;
  source_names: string[];
  origin_role: string;
  topics: string[];
}

interface NarrativeDriverGroup {
  key: string;
  label: string;
  available: boolean;
  cluster_count: number;
  impulse: number | null;
  direction: number | null;
  basis: string;
}

interface NarrativeMarketMetric {
  key: string;
  label: string;
  status: "available" | "unavailable";
  z_score: number | null;
  value: number | null;
  unit: string | null;
  detail: string;
}

interface NarrativeCoverageChannel {
  key: string;
  label: string;
  available: boolean;
  item_count: number;
}

export interface NarrativeAnalysis {
  schema_version: string;
  symbol: string;
  as_of: string;
  window_days: number;
  active_impulse_days: number;
  narrative_impulse: number;
  direction: number | null;
  attention: {
    z_score: number | null;
    status: string;
    recent_cluster_count: number;
    baseline_clusters_per_week: number | null;
    baseline_weeks: number;
    observed_span_days: number;
  };
  evidence_confidence: number;
  market_confirmation: {
    status: "available" | "limited" | "unavailable";
    benchmark: string;
    market_impulse_z: number | null;
    confirmation_z: number | null;
    available_metric_count: number;
    total_metric_count: number;
    metrics: NarrativeMarketMetric[];
  };
  classification: {
    key: string;
    label: string;
    detail: string;
  };
  silence: {
    key: string;
    label: string;
    detail: string;
    recent_cluster_count: number;
    baseline_clusters_per_week: number | null;
    successful_checks_7d: number;
    failed_checks_7d: number;
    latest_check_at: string | null;
    sources_checked: string[];
    continuity_status: string;
  };
  counts: {
    raw_items: number;
    claim_clusters: number;
    active_claim_clusters: number;
    propagation_items: number;
    independent_sources: number;
  };
  driver_groups: NarrativeDriverGroup[];
  clusters: NarrativeCluster[];
  coverage: {
    status: "good" | "limited" | "unavailable";
    channels: NarrativeCoverageChannel[];
    published_start: string | null;
    published_end: string | null;
    successful_checks_7d: number;
    failed_checks_7d: number;
    latest_check_at: string | null;
    limitations: string[];
  };
  methodology: {
    cluster_keys: string[];
    impulse_formula: string;
    confidence_formula: string;
    evidence_confidence_aggregation: string;
    attention_window_days: number;
    headline_model: string;
    market_benchmark: string;
  };
}

const shortDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const narrativeTone = (direction: number | null) => {
  if (direction === null || Math.abs(direction) < 0.15) return "mixed";
  return direction > 0 ? "bullish" : "bearish";
};

const keyTakeaway = (narrative: NarrativeAnalysis, ticker: string) => {
  const tone = narrativeTone(narrative.direction);

  switch (narrative.classification.key) {
    case "confirmed_catalyst":
      return `${ticker}'s ${tone} coverage is moving with the market.`;
    case "chatter_unconfirmed":
      return `${ticker}'s ${tone} coverage has not been confirmed by the market.`;
    case "contradicted_narrative":
      return `${ticker}'s observed coverage and market behavior are moving in opposite directions.`;
    case "hidden_or_mechanical":
      return `The market is moving more than the observed ${ticker} coverage explains.`;
    default:
      return `No meaningful narrative pattern stands out in the observed ${ticker} coverage.`;
  }
};

const contextNote = (narrative: NarrativeAnalysis) => {
  const tone = narrativeTone(narrative.direction);
  const publicOpinionCollected = narrative.coverage.channels.some(
    (channel) => channel.key === "community_public" && channel.available,
  );
  const narrowCoverage = narrative.counts.independent_sources <= 1 || narrative.coverage.status !== "good";
  const silenceUnsettled = ["collection_unobserved", "collection_warming"].includes(narrative.silence.key);

  const parts = [`Recent publisher coverage is ${tone}.`];
  if (narrowCoverage || !publicOpinionCollected) {
    parts.push("Coverage is not broad enough to infer public consensus or company intent.");
  }
  if (silenceUnsettled) {
    parts.push("There is not enough collection history to treat silence as evidence.");
  } else if (narrative.silence.key !== "mentions_observed") {
    parts.push(narrative.silence.detail);
  }
  return parts.join(" ");
};

export default function NarrativeImpulseWidget({
  narrative,
  ticker,
}: {
  narrative: NarrativeAnalysis | null;
  ticker: string;
}) {
  if (!narrative) {
    return (
      <section id="stock-narrative" aria-labelledby="stock-narrative-title" className="surface-card-strong scroll-mt-32 p-4 sm:p-6">
        <h2 id="stock-narrative-title" className="text-lg font-semibold text-white">Narrative</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300">
          No narrative takeaway is available for {ticker}. Price analysis remains usable.
        </p>
      </section>
    );
  }

  const sourceLinks = narrative.clusters.filter((cluster) => Boolean(cluster.link)).slice(0, 3);

  return (
    <section id="stock-narrative" aria-labelledby="stock-narrative-title" className="surface-card-strong scroll-mt-32 p-4 sm:p-6">
      <div className="max-w-4xl">
        <h2 id="stock-narrative-title" className="text-lg font-semibold text-white">Narrative</h2>
        <p className="mt-3 text-xl font-semibold leading-8 text-stealth-100 sm:text-2xl">
          {keyTakeaway(narrative, ticker)}
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300">
          {contextNote(narrative)}
        </p>
      </div>

      <div className="mt-6 border-t border-stealth-700 pt-4">
        <h3 className="text-sm font-semibold text-stealth-200">Sources behind this read</h3>
        {sourceLinks.length > 0 ? (
          <ul className="mt-2 divide-y divide-stealth-800">
            {sourceLinks.map((cluster) => (
              <li key={cluster.cluster_id}>
                <a
                  href={cluster.link ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold leading-6 text-stealth-100 underline decoration-stealth-600 underline-offset-4 group-hover:text-sky-200">
                      {cluster.title}
                    </span>
                    <span className="mt-1 block text-xs text-stealth-400">
                      {cluster.source} · {shortDate(cluster.first_seen)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-lg text-stealth-400 transition-colors group-hover:text-sky-200">↗</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-stealth-400">No linked source events are available.</p>
        )}
      </div>
    </section>
  );
}
