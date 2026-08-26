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

const signed = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
};

const signedSigma = (value: number | null | undefined) => {
  const formatted = signed(value, 1);
  return formatted === "Unavailable" ? formatted : `${formatted}σ`;
};

const percent = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `${Math.round(value * 100)}%`;
};

const marketMetricDisplay = (metric: NarrativeMarketMetric) =>
  metric.status === "available" ? signedSigma(metric.z_score) : "Unavailable";

const shortDate = (value: string | null | undefined) => {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const directionLabel = (value: number | null) => {
  if (value === null) return "No directional evidence";
  if (value >= 0.15) return "Bullish";
  if (value <= -0.15) return "Bearish";
  return "Mixed / neutral";
};

const directionTone = (value: number | null) => {
  if (value === null || Math.abs(value) < 0.15) return "text-stealth-200";
  return value > 0 ? "text-emerald-300" : "text-rose-300";
};

const classificationTone = (key: string) => {
  if (key === "confirmed_catalyst") return "border-emerald-500/45 bg-emerald-950/35 text-emerald-200";
  if (key === "contradicted_narrative") return "border-rose-500/45 bg-rose-950/35 text-rose-200";
  if (key === "chatter_unconfirmed" || key === "hidden_or_mechanical") return "border-amber-500/45 bg-amber-950/30 text-amber-200";
  return "border-stealth-600 bg-stealth-900 text-stealth-200";
};

const clusterOrigin = (value: string) => {
  const labels: Record<string, string> = {
    company_attributed: "Company-attributed",
    analyst_publisher: "Analyst framing",
    publisher_editorial: "Publisher framing",
    regulatory_legal: "Regulatory / legal",
    community_public: "Community / public",
  };
  return labels[value] ?? "Unclassified origin";
};

function MetricCell({ label, value, detail, tone = "text-white" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <dt className="text-xs font-semibold text-stealth-300">{label}</dt>
      <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${tone}`}>{value}</dd>
      <dd className="mt-1 text-xs leading-5 text-stealth-400">{detail}</dd>
    </div>
  );
}

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
        <h2 id="stock-narrative-title" className="text-lg font-semibold text-white">Narrative Impulse</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300">
          Narrative evidence is unavailable. Price analysis remains usable, but no claim-cluster or silence inference is shown.
        </p>
      </section>
    );
  }

  const attentionValue = signedSigma(narrative.attention.z_score);
  const confirmationValue = signedSigma(narrative.market_confirmation.confirmation_z);
  const latestClusters = narrative.clusters.slice(0, 4);
  const visibleDrivers = narrative.driver_groups.filter(
    (driver) => driver.cluster_count > 0 || driver.key === "company_attributed" || driver.key === "community_public",
  );
  const quietState = narrative.silence.key !== "mentions_observed";
  const headline = narrative.direction === null
    ? `${ticker} has no supported directional narrative in the active window.`
    : `${directionLabel(narrative.direction)} claims carry the observed narrative; ${narrative.classification.label.toLowerCase()}.`;

  return (
    <section id="stock-narrative" aria-labelledby="stock-narrative-title" className="surface-card-strong scroll-mt-32 overflow-hidden">
      <div className="p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="stock-narrative-title" className="text-lg font-semibold text-white">Narrative Impulse</h2>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${classificationTone(narrative.classification.key)}`}>
                {narrative.classification.label}
              </span>
            </div>
            <p className="mt-2 text-base font-semibold leading-6 text-stealth-100">{headline}</p>
            <p className="mt-1 text-sm leading-6 text-stealth-300">{narrative.classification.detail}</p>
          </div>
          <div className="shrink-0 sm:text-right">
            <div className="text-xs font-semibold text-stealth-400">Time-decayed cluster impulse</div>
            <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${directionTone(narrative.direction)}`}>
              {signed(narrative.narrative_impulse)}
            </div>
            <div className="mt-1 text-xs text-stealth-500">{narrative.active_impulse_days}d active window</div>
          </div>
        </div>

        <dl className="mt-5 grid overflow-hidden rounded-xl border border-stealth-700 bg-stealth-800/80 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-stealth-700">
          <MetricCell
            label="Narrative direction"
            value={signed(narrative.direction)}
            detail={directionLabel(narrative.direction)}
            tone={directionTone(narrative.direction)}
          />
          <MetricCell
            label="Attention surprise"
            value={attentionValue}
            detail={narrative.attention.z_score === null ? "Historical cluster baseline is still insufficient" : `${narrative.attention.recent_cluster_count} clusters this week vs ${narrative.attention.baseline_clusters_per_week?.toFixed(1)} baseline`}
            tone={narrative.attention.z_score !== null && narrative.attention.z_score >= 1.5 ? "text-amber-200" : "text-white"}
          />
          <MetricCell
            label="Evidence confidence"
            value={percent(narrative.evidence_confidence)}
            detail={`${narrative.counts.independent_sources} observed independent source${narrative.counts.independent_sources === 1 ? "" : "s"}`}
          />
          <MetricCell
            label="Market confirmation"
            value={confirmationValue}
            detail={narrative.market_confirmation.confirmation_z === null ? "No directional narrative to confirm, or market evidence is unavailable" : `${narrative.market_confirmation.available_metric_count}/${narrative.market_confirmation.total_metric_count} drivers available`}
            tone={narrative.market_confirmation.confirmation_z !== null && narrative.market_confirmation.confirmation_z < -0.75 ? "text-rose-300" : "text-white"}
          />
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stealth-400" aria-label="Narrative evidence pipeline counts">
          <span><strong className="font-semibold text-stealth-200">{narrative.counts.raw_items}</strong> raw items</span>
          <span aria-hidden="true">→</span>
          <span><strong className="font-semibold text-stealth-200">{narrative.counts.claim_clusters}</strong> claim clusters</span>
          <span aria-hidden="true">→</span>
          <span><strong className="font-semibold text-stealth-200">{narrative.counts.independent_sources}</strong> independent source{narrative.counts.independent_sources === 1 ? "" : "s"}</span>
          <span aria-hidden="true">→</span>
          <span><strong className="font-semibold text-stealth-200">{percent(narrative.evidence_confidence)}</strong> source confidence</span>
          <span aria-hidden="true">→</span>
          <span><strong className="font-semibold text-stealth-200">{signed(narrative.narrative_impulse)}</strong> decayed impulse</span>
          <span aria-hidden="true">→</span>
          <span><strong className="font-semibold text-stealth-200">{signedSigma(narrative.market_confirmation.market_impulse_z)}</strong> market impulse</span>
          <span className="text-stealth-500">· {narrative.counts.propagation_items} copy/repost items excluded from corroboration</span>
        </div>

        <div className={`mt-4 rounded-xl border px-3 py-3 ${quietState ? "border-amber-700/50 bg-amber-950/20" : "border-stealth-700 bg-stealth-900/55"}`}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className={`text-sm font-semibold ${quietState ? "text-amber-100" : "text-stealth-100"}`}>{narrative.silence.label}</h3>
              <p className="mt-1 text-xs leading-5 text-stealth-300">{narrative.silence.detail}</p>
            </div>
            <div className="shrink-0 text-xs text-stealth-400 sm:text-right">
              {narrative.silence.successful_checks_7d} successful / {narrative.silence.failed_checks_7d} failed feed checks · 7d
            </div>
          </div>
        </div>
      </div>

      <div className="grid border-t border-stealth-700 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
        <div className="min-w-0 p-4 sm:p-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Independent narrative events</h3>
              <p className="mt-1 text-xs leading-5 text-stealth-400">One row is one claim cluster; propagation is shown separately.</p>
            </div>
            <span className="text-xs text-stealth-500"><span className="sm:hidden">Top {Math.min(3, latestClusters.length)}</span><span className="hidden sm:inline">Top {latestClusters.length}</span> active</span>
          </div>

          {latestClusters.length > 0 ? (
            <ol className="mt-3 divide-y divide-stealth-800 border-y border-stealth-800">
              {latestClusters.map((cluster, index) => (
                <li key={cluster.cluster_id} className={`py-3 ${index >= 3 ? "hidden sm:block" : ""}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      {cluster.link ? (
                        <a href={cluster.link} target="_blank" rel="noopener noreferrer" className="font-semibold leading-5 text-stealth-100 underline decoration-stealth-600 underline-offset-4 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                          {cluster.title}
                        </a>
                      ) : (
                        <span className="font-semibold leading-5 text-stealth-100">{cluster.title}</span>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-stealth-400">
                        <span>{cluster.source}</span>
                        <span>First seen {shortDate(cluster.first_seen)}</span>
                        <span>{clusterOrigin(cluster.origin_role)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 sm:text-right">
                      <div className={`font-mono text-sm font-semibold tabular-nums ${directionTone(cluster.direction)}`}>{signed(cluster.impulse, 3)} impulse</div>
                      <div className="mt-1 text-xs text-stealth-500">{cluster.independent_source_count} source{cluster.independent_source_count === 1 ? "" : "s"} · {cluster.propagation_count} propagation</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {cluster.topics.map((topic) => (
                      <span key={topic} className="rounded-md border border-stealth-700 bg-stealth-900 px-2 py-1 text-xs text-stealth-300">
                        {topic.replace(/_/g, " ")}
                      </span>
                    ))}
                    <span className="rounded-md border border-stealth-700 px-2 py-1 text-xs text-stealth-400">confidence {percent(cluster.confidence)}</span>
                    <span className="rounded-md border border-stealth-700 px-2 py-1 text-xs text-stealth-400">novelty {percent(cluster.novelty)}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-stealth-700 bg-stealth-900/40 px-4 py-5 text-sm text-stealth-300">
              No supported claim cluster is active. Consult the silence and collection receipts before interpreting the absence.
            </div>
          )}
        </div>

        <div className="min-w-0 border-t border-stealth-700 p-4 sm:p-6 lg:border-l lg:border-t-0">
          <h3 className="text-sm font-semibold text-white">Who carries the narrative?</h3>
          <p className="mt-1 text-xs leading-5 text-stealth-400">Headline attribution, not motive or coordination.</p>
          <dl className="mt-3 divide-y divide-stealth-800 border-y border-stealth-800">
            {visibleDrivers.map((driver) => (
              <div key={driver.key} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-xs text-stealth-300">{driver.label}</dt>
                <dd className="text-right">
                  {driver.available && driver.cluster_count > 0 ? (
                    <><span className={`font-mono text-sm font-semibold ${directionTone(driver.direction)}`}>{signed(driver.impulse, 3)}</span><span className="ml-2 text-xs text-stealth-500">{driver.cluster_count} cluster{driver.cluster_count === 1 ? "" : "s"}</span></>
                  ) : driver.available ? (
                    <span className="text-xs font-semibold text-stealth-300">None observed</span>
                  ) : (
                    <span className="text-xs font-semibold text-amber-200">Not collected</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-5 text-sm font-semibold text-white">Market cross-check</h3>
          <p className="mt-1 text-xs leading-5 text-stealth-400">Directional market impulse {signedSigma(narrative.market_confirmation.market_impulse_z)} vs {narrative.market_confirmation.benchmark}.</p>
          <dl className="mt-3 space-y-2">
            {narrative.market_confirmation.metrics.map((metric) => (
              <div key={metric.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-lg bg-stealth-900/60 px-3 py-2.5">
                <dt className="text-xs font-semibold text-stealth-200">{metric.label}</dt>
                <dd className={`font-mono text-xs font-semibold tabular-nums ${metric.status === "available" ? "text-white" : "text-amber-200"}`}>
                  {marketMetricDisplay(metric)}
                </dd>
                <dd className="col-span-2 mt-1 text-xs leading-5 text-stealth-500">{metric.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <details className="border-t border-stealth-700 bg-stealth-950/45 px-4 py-2 sm:px-6">
        <summary className="flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-stealth-200 hover:bg-stealth-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          Method, collection coverage, and limitations
        </summary>
        <div className="grid gap-5 px-2 pb-4 pt-2 text-xs leading-5 text-stealth-300 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold text-white">Coverage</h3>
            <ul className="mt-2 space-y-1.5">
              {narrative.coverage.channels.map((channel) => (
                <li key={channel.key} className="flex justify-between gap-4">
                  <span>{channel.label}</span>
                  <span className={channel.available ? "text-stealth-100" : "text-amber-200"}>{channel.available ? `${channel.item_count} items` : "Not collected"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-stealth-500">Published evidence {shortDate(narrative.coverage.published_start)}–{shortDate(narrative.coverage.published_end)} · latest feed check {shortDate(narrative.coverage.latest_check_at)}.</p>
          </div>
          <div>
            <h3 className="font-semibold text-white">Calculation</h3>
            <p className="mt-2 font-mono text-stealth-200">Impulse = direction × relevance × novelty × confidence × time decay</p>
            <p className="mt-1 font-mono text-stealth-200">Cluster confidence = 1 − ∏(1 − independent source confidence)</p>
            <p className="mt-1 text-stealth-400">Displayed evidence confidence is the relevance-, novelty-, and time-decay-weighted mean of active cluster confidence.</p>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-stealth-400">
              {narrative.coverage.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
