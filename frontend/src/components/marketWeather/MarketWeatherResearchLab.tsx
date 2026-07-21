import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, BookOpen, ChevronDown, FlaskConical, Info, Layers } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  MarketWeatherDerivativePoint,
  MarketWeatherLexiconArchetype,
  MarketWeatherLexiconMotif,
  MarketWeatherPricePoint,
  MarketWeatherResearch,
  MarketWeatherStrataLatest,
  MarketWeatherTimeframe,
} from "../../types/marketWeather";
import {
  buildGroundedStateProfile,
  MARKET_FIELD_METRICS,
  marketFieldReading,
  robustFieldDeviations,
} from "../../utils/marketWeatherLexicon";
import type { MarketFieldMetricId } from "../../utils/marketWeatherLexicon";

type LanguageView = "now" | "dictionary" | "methods";
type DerivativeKey = "pressure" | "velocity" | "acceleration" | "jerk" | "snap";

interface MarketWeatherResearchLabProps {
  research: MarketWeatherResearch;
  price: MarketWeatherPricePoint[];
  symbol: string;
  timeframe: MarketWeatherTimeframe;
  barSize: string;
}

const DERIVATIVES: Array<{ key: DerivativeKey; label: string }> = [
  { key: "pressure", label: "Pressure" },
  { key: "velocity", label: "Change" },
  { key: "acceleration", label: "Acceleration" },
  { key: "jerk", label: "Jerk" },
  { key: "snap", label: "Snap" },
];

const STRATA: Array<{
  key: keyof Pick<MarketWeatherStrataLatest, "structure" | "kinematics" | "geometry" | "information" | "propagation">;
  label: string;
}> = [
  { key: "structure", label: "Organization" },
  { key: "kinematics", label: "Reorganization" },
  { key: "geometry", label: "Boundary activity" },
  { key: "information", label: "Disorder" },
  { key: "propagation", label: "Propagation" },
];

const FOUNDATIONS = [
  ["Permutation entropy", "Bandt & Pompe (2002)", "https://link.aps.org/doi/10.1103/PhysRevLett.88.174102"],
  ["Optical-flow constraint", "Horn & Schunck (1981)", "https://doi.org/10.1016/0004-3702(81)90024-2"],
  ["Multiscaling", "Mandelbrot, Fisher & Calvet (1997)", "https://cowles.yale.edu/node/145456"],
  ["Time-causal scale-space", "Lindeberg (2017)", "https://link.springer.com/article/10.1007/s10851-016-0691-3"],
  ["State-space reconstruction", "Takens (1981)", "https://doi.org/10.1007/BFb0091924"],
  ["Surrogate-data nulls", "Theiler et al. (1992)", "https://doi.org/10.1016/0167-2789(92)90102-S"],
  ["Multiple-test discipline", "Harvey, Liu & Zhu (2016)", "https://academic.oup.com/rfs/article/29/1/5/1843824"],
] as const;

const METRIC_BY_ID = new Map(MARKET_FIELD_METRICS.map((metric) => [metric.id, metric]));

function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "Not available" : `${Math.round(value * 100)}%`;
}

function formatReturn(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  const percent = value * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function parseTimestamp(value: string): Date {
  return new Date(value.includes("T") ? value : `${value}T00:00:00`);
}

function formatDate(value: string, timeframe: MarketWeatherTimeframe): string {
  const date = parseTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  return ["1D", "1W"].includes(timeframe)
    ? date.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

function formatObservationDate(value: string, timeframe: MarketWeatherTimeframe): string {
  const date = parseTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  return ["1D", "1W"].includes(timeframe)
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

function stateTone(direction: "positive" | "negative" | "neutral"): string {
  if (direction === "positive") return "#38bdf8";
  if (direction === "negative") return "#a78bfa";
  return "#94a3b8";
}

function metricValue(id: MarketFieldMetricId, value: number): string {
  if (["pressure", "velocity", "cascade_bias"].includes(id)) {
    const scaled = value * 100;
    return `${scaled > 0 ? "+" : ""}${scaled.toFixed(1)}`;
  }
  return `${Math.round(value * 100)}`;
}

function metricUnit(id: MarketFieldMetricId): string {
  if (["pressure", "velocity", "cascade_bias"].includes(id)) return "on a −100 to +100 scale";
  if (["volatility_carrier", "participation_carrier", "liquidity_stress_carrier"].includes(id)) {
    return "index; 50 is its trailing baseline";
  }
  return "on a 0 to 100 scale";
}

function sampleLabel(sampleSize: number): string {
  if (sampleSize < 5) return "Too few holdout observations";
  if (sampleSize < 20) return "Limited holdout evidence";
  return "Descriptive holdout evidence";
}

function baselineRatioReading(value: number): string {
  const difference = (value - 1) * 100;
  if (Math.abs(difference) < 0.05) return "at baseline";
  const magnitude = Math.abs(difference);
  return `${magnitude < 10 ? magnitude.toFixed(1) : magnitude.toFixed(0)}% ${difference > 0 ? "above" : "below"}`;
}

function StateDeviationBars({
  archetype,
  research,
  compact = false,
}: {
  archetype: MarketWeatherLexiconArchetype;
  research: MarketWeatherResearch;
  compact?: boolean;
}) {
  const features = research.lexicon?.features ?? [];
  const deviations = robustFieldDeviations(archetype.centroid, features);
  const ranked = deviations.slice().sort((left, right) => Math.abs(right.robustDeviation) - Math.abs(left.robustDeviation));
  const visible = ranked.slice(0, compact ? 3 : 8);

  return (
    <div className="space-y-2" aria-label="Difference from the model-fit baseline">
      {visible.map((deviation) => {
        const magnitude = Math.min(50, Math.abs(deviation.robustDeviation) / 3 * 50);
        const positive = deviation.robustDeviation >= 0;
        return (
          <div key={deviation.id} className="grid grid-cols-[minmax(86px,1fr)_minmax(90px,1.4fr)_52px] items-center gap-2 text-xs">
            <span className="truncate text-slate-300">{deviation.label}</span>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
              <span className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
              <span
                className={`absolute inset-y-0 rounded-full ${positive ? "bg-sky-300" : "bg-violet-300"}`}
                style={positive ? { left: "50%", width: `${magnitude}%` } : { right: "50%", width: `${magnitude}%` }}
              />
            </div>
            <span className="text-right font-mono text-slate-300">
              {deviation.robustDeviation > 0 ? "+" : ""}{deviation.robustDeviation.toFixed(1)}
            </span>
          </div>
        );
      })}
      {!compact ? <p className="text-xs leading-5 text-slate-400">The eight largest differences are shown. The center line is the model-fit median; numbers are fit-spread units (normally interquartile ranges), while bar lengths cap at three for display.</p> : null}
    </div>
  );
}

function PriceStateChart({
  price,
  research,
  timeframe,
}: {
  price: MarketWeatherPricePoint[];
  research: MarketWeatherResearch;
  timeframe: MarketWeatherTimeframe;
}) {
  const lexicon = research.lexicon!;
  const visiblePrice = price.slice(-120);
  const visibleDates = new Set(visiblePrice.map((point) => point.date));
  const profileById = useMemo(
    () => new Map(lexicon.archetypes.map((archetype) => [archetype.id, buildGroundedStateProfile(archetype.centroid, lexicon.features)])),
    [lexicon.archetypes, lexicon.features],
  );
  const runs: Array<{ stateId: string; start: string; end: string; duration: number; outside: boolean }> = [];
  lexicon.evaluation_sequence.filter((point) => visibleDates.has(point.date)).forEach((point) => {
    const previous = runs[runs.length - 1];
    const outside = point.outside_learned_range === true;
    if (previous?.stateId === point.state_id && previous.outside === outside) {
      previous.end = point.date;
      previous.duration += 1;
    } else {
      runs.push({ stateId: point.state_id, start: point.date, end: point.date, duration: 1, outside });
    }
  });

  return (
    <article className="min-w-0 rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-white">Price and learned state history</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">Actual closing price with the model’s recent state assignments below it.</p>
        </div>
        {visiblePrice.length ? <span className="rounded-full border border-stealth-600 px-3 py-1 text-xs text-slate-300">Last {visiblePrice.length} bars</span> : null}
      </div>
      <div className="h-[280px] min-w-0 sm:h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visiblePrice} margin={{ top: 8, right: 8, left: 2, bottom: 4 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="date"
              minTickGap={44}
              tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
              tickFormatter={(value: string) => formatDate(value, timeframe)}
              axisLine={{ stroke: "var(--chart-axis-line)" }}
              tickLine={false}
            />
            <YAxis
              domain={["auto", "auto"]}
              width={62}
              tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
              tickFormatter={(value: number) => `$${Number(value).toFixed(0)}`}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 12 }}
              labelStyle={{ color: "var(--chart-tooltip-label)" }}
              labelFormatter={(value) => formatObservationDate(String(value), timeframe)}
              formatter={(value) => [`$${Number(value).toFixed(2)}`, "Close"]}
            />
            <Line type="monotone" dataKey="close" stroke="#7dd3fc" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>Recent learned states</span>
          <span>{runs.length} runs shown</span>
        </div>
        <div className="flex h-8 min-w-0 overflow-hidden rounded-lg border border-stealth-700 bg-slate-900" role="list" aria-label="Recent learned state runs">
          {runs.map((run) => {
            const profile = profileById.get(run.stateId);
            return (
              <div
                key={`${run.start}-${run.stateId}`}
                role="listitem"
                className="min-w-[3px] border-r border-slate-950/80 last:border-r-0"
                style={{ flexGrow: run.duration, backgroundColor: run.outside ? "#fbbf24" : stateTone(profile?.direction ?? "neutral") }}
                title={`${run.outside ? "Outside learned range" : profile?.headline ?? "Learned state"}; ${run.duration} bars; ${formatObservationDate(run.start, timeframe)} to ${formatObservationDate(run.end, timeframe)}`}
                aria-label={`${run.outside ? "Outside learned range" : profile?.headline ?? "Learned state"}, ${run.duration} bars`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400" aria-label="State direction legend">
          <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" />Positive pressure</span>
          <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" />Balanced pressure</span>
          <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-violet-400" />Negative pressure</span>
          <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Outside learned range</span>
        </div>
      </div>
    </article>
  );
}

function CurrentStateView({ research, price, symbol, timeframe, barSize }: MarketWeatherResearchLabProps) {
  const lexicon = research.lexicon!;
  const current = lexicon.current;
  const archetype = lexicon.archetypes.find((item) => item.id === current.state_id) ?? lexicon.archetypes[0];
  const latestDerivative = research.derivative_series[research.derivative_series.length - 1];
  const latestStrata = research.strata.latest;
  const latestCarriers = research.carriers?.latest;
  const latestRatios = research.carriers?.ratios?.latest;
  const currentValues: Record<string, number> = {
    ...archetype.centroid,
    pressure: latestDerivative?.pressure ?? archetype.centroid.pressure ?? 0,
    velocity: latestDerivative?.velocity ?? archetype.centroid.velocity ?? 0,
    acceleration: latestDerivative?.acceleration ?? archetype.centroid.acceleration ?? 0,
    jerk: latestDerivative?.jerk ?? archetype.centroid.jerk ?? 0,
    snap: latestDerivative?.snap ?? archetype.centroid.snap ?? 0,
    structure: latestStrata.structure,
    kinematics: latestStrata.kinematics,
    geometry: latestStrata.geometry,
    information: latestStrata.information,
    propagation: latestStrata.propagation,
    cascade_bias: latestStrata.cascade_bias,
    scaling_exponent: latestStrata.scaling_exponent,
    volatility_carrier: latestCarriers?.realized_volatility ?? archetype.centroid.volatility_carrier ?? 0,
    participation_carrier: latestCarriers?.participation ?? archetype.centroid.participation_carrier ?? 0,
    liquidity_stress_carrier: latestCarriers?.liquidity_stress ?? archetype.centroid.liquidity_stress_carrier ?? 0,
  };
  const profile = buildGroundedStateProfile(currentValues, lexicon.features);
  const rangeCheckAvailable = typeof current.outside_learned_range === "boolean";
  const noCloseMatch = current.outside_learned_range === true;
  const currentDate = price[price.length - 1]?.date ?? lexicon.evaluation_sequence[lexicon.evaluation_sequence.length - 1]?.date;
  const outcome = archetype.evaluation_outcome;
  const measuredMetrics: MarketFieldMetricId[] = [
    "pressure",
    "velocity",
    "volatility_carrier",
    "participation_carrier",
    "liquidity_stress_carrier",
  ];
  const directRatios: Partial<Record<MarketFieldMetricId, number | null>> = {
    volatility_carrier: latestRatios?.realized_volatility,
    participation_carrier: latestRatios?.participation,
    liquidity_stress_carrier: latestRatios?.liquidity_stress,
  };
  const distanceTailCutoff = lexicon.distance_metric.outside_range_cutoff;
  const minimumTailSupport = lexicon.distance_metric.minimum_distance_tail_support ?? 20;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">{symbol} · {barSize} · {currentDate ? formatObservationDate(currentDate, timeframe) : "Latest bar"}</p>
            <h3 className={`mt-2 text-2xl font-semibold tracking-tight sm:text-3xl ${noCloseMatch ? "text-amber-200" : "text-white"}`}>
              {noCloseMatch ? "No reliable learned-state match" : profile.headline}
            </h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              {noCloseMatch
                ? `The current field is farther from its assigned state than nearly all same-state bars in the held-out calibration slice. Its live measurements show ${profile.headline.toLowerCase()}, but that state’s historical behavior is not treated as a current analog.`
                : `The current field has ${profile.headline.toLowerCase()} and ${profile.characteristic}. ${profile.summary}`}
            </p>
          </div>
          <div className="rounded-xl border border-stealth-600 bg-slate-950/45 px-4 py-3 text-sm text-slate-300">
            <span className="block text-xs uppercase tracking-wider text-slate-400">Learned-range check</span>
            <span className={`mt-1 block text-lg font-semibold ${noCloseMatch ? "text-amber-200" : "text-white"}`}>{!rangeCheckAvailable ? "Insufficient history" : noCloseMatch ? "Outside range" : "Within range"}</span>
            <span className="mt-1 block text-xs text-slate-400">Held-out distance-tail score {current.distance_tail_score?.toFixed(3) ?? "not available"}{distanceTailCutoff !== undefined ? `; cutoff ${distanceTailCutoff.toFixed(2)}` : ""}</span>
            <span className="mt-1 block text-xs text-slate-500">Same-state reference n={current.distance_tail_support}; {minimumTailSupport} required. Empirical rank, not a formal p-value.</span>
          </div>
        </div>
        {!lexicon.training_split.warmup_complete ? <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">This history does not fully cover the requested horizon warm-up. Treat the learned state and its comparisons as provisional.</p> : null}
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <PriceStateChart price={price} research={research} timeframe={timeframe} />
        <aside className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-white">Current measured evidence</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <span className="text-xs text-slate-400">Current run</span>
              <strong className="mt-1 block text-lg text-white">{current.age_bars} bars</strong>
              <span className="text-xs leading-5 text-slate-400">Typical learned run: {archetype.typical_duration_bars} bars{current.age_truncated ? "; visible history starts mid-run" : ""}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <span className="text-xs text-slate-400">Window frequency</span>
              <strong className="mt-1 block text-lg text-white">{formatRate(archetype.window_frequency)}</strong>
              <span className="text-xs leading-5 text-slate-400">Share of eligible bars assigned to this learned state</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3 sm:col-span-2 xl:col-span-1">
              <span className="text-xs text-slate-400">State observations</span>
              <strong className="mt-1 block text-lg text-white">{archetype.fit_count + archetype.calibration_count + archetype.evaluation_count} bars</strong>
              <span className="text-xs leading-5 text-slate-400">{archetype.fit_count} fit · {archetype.calibration_count} range-check · {archetype.evaluation_count} later holdout{noCloseMatch ? "; the current bar is not treated as an analog" : ""}</span>
            </div>
          </div>
        </aside>
      </div>

      <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">What the model actually measured</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">Directional measures retain their signed scales. The three OHLCV carriers are shown as direct multiples of their own causal trailing baselines.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {measuredMetrics.map((id) => {
            const definition = METRIC_BY_ID.get(id)!;
            const value = currentValues[id] ?? 0;
            const directRatio = directRatios[id];
            const hasDirectRatio = typeof directRatio === "number" && Number.isFinite(directRatio);
            const ratioLabel = hasDirectRatio && directRatio >= 10 ? "≥10.00×" : hasDirectRatio ? `${directRatio.toFixed(2)}×` : "Unavailable";
            return (
              <article key={id} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <h4 className="text-xs font-medium text-slate-300">{definition.label}</h4>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <strong className="font-mono text-xl text-white">{definition.family === "carrier" ? ratioLabel : metricValue(id, value)}</strong>
                  <span className="text-xs capitalize text-sky-300">{definition.family === "carrier" ? hasDirectRatio ? baselineRatioReading(directRatio) : "source unavailable" : marketFieldReading(id, value)}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-400">{definition.family === "carrier" ? hasDirectRatio ? "mean per-horizon ratio to its causal EWM baseline" : "this carrier cannot be measured from the returned OHLCV bars" : metricUnit(id)}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">What followed similar holdout bars</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">Every evaluation bar assigned to the nearest state; forward windows overlap and are serially dependent.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs ${outcome.sample_size < 20 ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-sky-400/30 bg-sky-400/10 text-sky-200"}`}>
            {sampleLabel(outcome.sample_size)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-slate-400">Forward window</span><strong className="mt-1 block text-lg text-white">{outcome.forward_bars} bars</strong></div>
          <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-slate-400">Median return</span><strong className="mt-1 block text-lg text-white">{formatReturn(outcome.median_return)}</strong></div>
          <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-slate-400">Positive observations</span><strong className="mt-1 block text-lg text-white">{formatRate(outcome.positive_rate)}</strong></div>
          <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-slate-400">Holdout observations</span><strong className="mt-1 block text-lg text-white">{outcome.sample_size}</strong></div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-400"><Info className="mt-0.5 h-4 w-4 shrink-0" />Descriptive historical context only, not a forecast or trading signal.{noCloseMatch ? " The current bar is novel, so this analog is especially weak." : ""}</p>
      </section>
    </div>
  );
}

function TransitionEvidence({
  archetype,
  research,
}: {
  archetype: MarketWeatherLexiconArchetype;
  research: MarketWeatherResearch;
}) {
  const lexicon = research.lexicon!;
  const fromIndex = lexicon.grammar.state_ids.indexOf(archetype.id);
  const counts = lexicon.grammar.counts[fromIndex] ?? [];
  const support = counts.reduce((total, count) => total + count, 0);
  const destinations = counts
    .map((count, index) => ({ count, stateId: lexicon.grammar.state_ids[index] }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);

  return (
    <details className="rounded-xl border border-stealth-700 bg-slate-950/30 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-200">
        <span>Observed state exits ({support})</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </summary>
      <div className="mt-4 space-y-3">
        {support < lexicon.grammar.minimum_transition_support ? (
          <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
            Insufficient observed exits for a stable transition estimate. At least {lexicon.grammar.minimum_transition_support} are required.
          </p>
        ) : null}
        {destinations.length ? destinations.map((destination) => {
          const destinationArchetype = lexicon.archetypes.find((item) => item.id === destination.stateId);
          const destinationProfile = destinationArchetype
            ? buildGroundedStateProfile(destinationArchetype.centroid, lexicon.features)
            : null;
          return (
            <div key={destination.stateId} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 px-3 py-2.5 text-xs">
              <span className="text-slate-300">{destinationProfile?.headline ?? "Another learned state"}</span>
              <span className="shrink-0 font-mono text-slate-300">
                {destination.count} of {support}{support >= lexicon.grammar.minimum_transition_support ? ` · ${Math.round(destination.count / support * 100)}%` : ""}
              </span>
            </div>
          );
        }) : <p className="text-xs text-slate-400">No run-collapsed exits were observed in calibration.</p>}
        <p className="text-xs leading-5 text-slate-400">Raw calibration counts only. Self-persistence is excluded, and these are not forecast probabilities.</p>
      </div>
    </details>
  );
}

function LearnedStateCard({
  archetype,
  index,
  selected,
  research,
  onSelect,
}: {
  archetype: MarketWeatherLexiconArchetype;
  index: number;
  selected: boolean;
  research: MarketWeatherResearch;
  onSelect: () => void;
}) {
  const profile = buildGroundedStateProfile(archetype.centroid, research.lexicon?.features ?? []);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${selected ? "border-sky-300/55 bg-sky-950/25" : "border-stealth-700 bg-slate-950/25 hover:border-stealth-500"}`}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Learned state {index + 1}</span>
      <strong className="mt-2 block text-base leading-6 text-white">{profile.headline}</strong>
      <span className="mt-1 block text-xs leading-5 text-slate-400">{profile.characteristic}</span>
      <div className="mt-4"><StateDeviationBars archetype={archetype} research={research} compact /></div>
      <span className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 pt-3 text-xs text-slate-300">
        <span>{formatRate(archetype.window_frequency)} of window</span>
        <span>Typical run {archetype.typical_duration_bars} bars</span>
        <span>Holdout n={archetype.evaluation_outcome.sample_size}</span>
      </span>
    </button>
  );
}

function MeasurementGlossary() {
  const fieldMetrics = MARKET_FIELD_METRICS.filter((metric) => metric.family === "field");
  const carrierMetrics = MARKET_FIELD_METRICS.filter((metric) => metric.family === "carrier");

  return (
    <details className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white">
        <span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4 text-sky-300" />Measurement glossary</span>
        <span className="inline-flex items-center gap-2 text-xs font-normal text-slate-400">{MARKET_FIELD_METRICS.length} definitions <ChevronDown className="h-4 w-4" /></span>
      </summary>
      <p className="mt-3 max-w-3xl text-xs leading-5 text-slate-400">Every learned state is a cluster over these measurements. The labels below state the actual scale and construction; none is a probability or a trading recommendation.</p>
      {[
        { title: "Price-field measurements", metrics: fieldMetrics },
        { title: "OHLCV context", metrics: carrierMetrics },
      ].map((group) => (
        <section key={group.title} className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">{group.title}</h4>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {group.metrics.map((metric) => (
              <article key={metric.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h5 className="text-sm font-medium text-white">{metric.label}</h5>
                  <span className="text-xs text-sky-200">{metric.scale}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-400">{metric.definition}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </details>
  );
}

function DictionaryView({ research }: { research: MarketWeatherResearch }) {
  const lexicon = research.lexicon!;
  const [selectedId, setSelectedId] = useState(lexicon.current.state_id);

  useEffect(() => setSelectedId(lexicon.current.state_id), [lexicon.current.state_id]);

  const selected = lexicon.archetypes.find((archetype) => archetype.id === selectedId) ?? lexicon.archetypes[0];
  const selectedIndex = Math.max(0, lexicon.archetypes.findIndex((archetype) => archetype.id === selected.id));
  const profile = buildGroundedStateProfile(selected.centroid, lexicon.features);
  const outcome = selected.evaluation_outcome;

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(300px,.72fr)_minmax(0,1.28fr)]">
      <section className="min-w-0">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">Learned states in this window</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">Names come from the sign of directional pressure and whether its first change reinforces or opposes that sign. Profiles show measured differences from the earlier model-fit baseline.</p>
        </div>
        <div className="space-y-3">
          {lexicon.archetypes.map((archetype, index) => (
            <LearnedStateCard
              key={archetype.id}
              archetype={archetype}
              index={index}
              selected={archetype.id === selected.id}
              research={research}
              onSelect={() => setSelectedId(archetype.id)}
            />
          ))}
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5 lg:sticky lg:top-4 lg:self-start">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">Learned state {selectedIndex + 1}</span>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">{profile.headline}</h3>
        <p className="mt-3 text-sm leading-6 text-slate-300">{profile.summary}</p>

        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <h4 className="text-sm font-semibold text-white">Measured definition</h4>
          <p className="mt-1 text-xs leading-5 text-slate-400">Deviation from the model-fit median in fit-spread units; these are measured comparisons, not hand-set category scores.</p>
          <div className="mt-4"><StateDeviationBars archetype={selected} research={research} /></div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-slate-400">Window frequency</span><strong className="mt-1 block text-lg text-white">{formatRate(selected.window_frequency)}</strong></div>
          <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-slate-400">Typical run</span><strong className="mt-1 block text-lg text-white">{selected.typical_duration_bars} bars</strong></div>
          <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-slate-400">Holdout sample</span><strong className="mt-1 block text-lg text-white">{outcome.sample_size}</strong></div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Holdout behavior</h4>
              <p className="mt-1 text-xs leading-5 text-slate-400">What followed assigned evaluation bars over the next {outcome.forward_bars} bars.</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs ${outcome.sample_size < 20 ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-sky-400/30 bg-sky-400/10 text-sky-200"}`}>{sampleLabel(outcome.sample_size)}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div><span className="text-xs text-slate-400">Median return</span><strong className="mt-1 block text-base text-white">{formatReturn(outcome.median_return)}</strong></div>
            <div><span className="text-xs text-slate-400">Positive observations</span><strong className="mt-1 block text-base text-white">{formatRate(outcome.positive_rate)}</strong></div>
            <div><span className="text-xs text-slate-400">Mean absolute move</span><strong className="mt-1 block text-base text-white">{formatReturn(outcome.mean_absolute_return)}</strong></div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">Overlapping, serially dependent observations; descriptive only and not corrected for state search.</p>
        </div>

        <div className="mt-4"><TransitionEvidence archetype={selected} research={research} /></div>
      </section>
      </div>
      <MeasurementGlossary />
    </div>
  );
}

function DerivativeHeatmap({ series, timeframe }: { series: MarketWeatherDerivativePoint[]; timeframe: MarketWeatherTimeframe }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = 232;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => setWidth(wrapper.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || !series.length) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "rgb(10,17,29)";
    context.fillRect(0, 0, width, height);
    const left = 98;
    const bottom = 28;
    const cellWidth = (width - left - 8) / series.length;
    const cellHeight = (height - bottom - 8) / DERIVATIVES.length;
    DERIVATIVES.forEach((derivative, row) => {
      series.forEach((point, column) => {
        const value = Math.max(-1, Math.min(1, point[derivative.key]));
        const alpha = 0.12 + Math.abs(value) * 0.88;
        context.fillStyle = value >= 0 ? `rgba(56,189,248,${alpha})` : `rgba(245,158,11,${alpha})`;
        context.fillRect(left + column * cellWidth, 7 + row * cellHeight, Math.max(1, cellWidth + 0.2), cellHeight + 0.2);
      });
      context.fillStyle = "rgba(203,213,225,.88)";
      context.font = "12px IBM Plex Sans, sans-serif";
      context.textAlign = "right";
      context.fillText(derivative.label, left - 8, 7 + (row + 0.58) * cellHeight);
    });
    context.textAlign = "left";
    context.fillStyle = "rgba(148,163,184,.9)";
    context.fillText(formatDate(series[0].date, timeframe), left, height - 8);
    context.textAlign = "right";
    context.fillText(formatDate(series[series.length - 1].date, timeframe), width - 8, height - 8);
  }, [series, timeframe, width]);

  return (
    <div ref={wrapperRef} className="overflow-hidden rounded-xl border border-stealth-700">
      <canvas ref={canvasRef} className="block w-full" aria-label="Pressure and its first four causal changes over time; blue is positive and amber is negative." />
    </div>
  );
}

function translatedMotif(motif: MarketWeatherLexiconMotif, research: MarketWeatherResearch): string[] {
  const lexicon = research.lexicon!;
  return motif.states.map((stateId) => {
    const archetype = lexicon.archetypes.find((item) => item.id === stateId);
    return archetype ? buildGroundedStateProfile(archetype.centroid, lexicon.features).headline : "Unresolved state";
  });
}

function MethodsView({ research, symbol, timeframe, barSize }: Omit<MarketWeatherResearchLabProps, "price">) {
  const latest = research.strata.latest;
  const motifs = research.lexicon?.motifs.slice().sort((left, right) => right.count - left.count).slice(0, 6) ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><Layers className="h-4 w-4 text-violet-300" /><h3 className="text-base font-semibold text-white">Causal derivative layers</h3></div>
        <p className="mb-4 max-w-3xl text-xs leading-5 text-slate-400">Successive changes in the pressure field. This visualization is diagnostic; higher orders are more noise-sensitive.</p>
        <DerivativeHeatmap series={research.derivative_series} timeframe={timeframe} />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400"><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" />Positive</span><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Negative</span></div>
      </section>

      <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <h3 className="text-base font-semibold text-white">Latest field layers</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {STRATA.map((stratum) => (
            <article key={stratum.key} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-300">{stratum.label}</span><strong className="font-mono text-white">{Math.round(latest[stratum.key] * 100)}</strong></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-300" style={{ width: `${Math.max(0, Math.min(100, latest[stratum.key] * 100))}%` }} /></div>
              <p className="mt-2 text-xs text-slate-400">0 to 100 model scale</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <h3 className="text-base font-semibold text-white">Experimental repeated sequences</h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">Run-collapsed sequences translated into measured state definitions. They remain descriptive and uncorrected for search.</p>
        {motifs.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {motifs.map((motif) => {
              const states = translatedMotif(motif, research);
              return (
                <article key={motif.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs leading-5 text-slate-300">
                    {states.map((state, index) => <span key={`${state}-${index}`} className="inline-flex items-center gap-2"><span>{state}</span>{index < states.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-slate-500" /> : null}</span>)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-xs text-slate-400">
                    <span>{motif.count} occurrences</span><span>Typical span {motif.typical_span_bars} bars</span><span>Next {motif.outcome.forward_bars} bars: {formatReturn(motif.outcome.median_return)}</span><span>n={motif.outcome.sample_size}</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <p className="mt-4 rounded-xl border border-dashed border-stealth-700 p-5 text-center text-xs text-slate-400">No repeated sequence has enough occurrences in the visible evaluation window.</p>}
      </section>

      <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <h3 className="text-base font-semibold text-white">Chronological relationship checks</h3>
        <div className="mt-4 overflow-x-auto rounded-xl border border-stealth-700">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-slate-950/60 uppercase tracking-[0.12em] text-slate-400"><tr><th className="px-3 py-3">Test</th><th className="px-3 py-3">Sample</th><th className="px-3 py-3">Event</th><th className="px-3 py-3">Baseline</th><th className="px-3 py-3">Difference</th><th className="px-3 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {research.relationship_atlas.map((result) => <tr key={result.id}><td className="px-3 py-3 text-slate-200">{result.label}</td><td className="px-3 py-3 font-mono text-slate-300">{result.sample_size}</td><td className="px-3 py-3 font-mono text-slate-300">{formatReturn(result.event_mean)}</td><td className="px-3 py-3 font-mono text-slate-400">{formatReturn(result.baseline_mean)}</td><td className="px-3 py-3 font-mono text-sky-300">{formatReturn(result.uplift)}</td><td className="px-3 py-3 text-slate-400">{result.status}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <details className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white"><span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4 text-violet-300" />Published foundations and limits</span><ChevronDown className="h-4 w-4 text-slate-400" /></summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {FOUNDATIONS.map(([title, authors, url]) => <a key={title} href={url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-3 py-3 text-xs text-slate-300 hover:border-violet-400/40 hover:text-white"><span className="block font-medium text-slate-100">{title}</span><span className="mt-1 block text-slate-400">{authors}</span></a>)}
        </div>
        <div className="mt-4 space-y-2 text-xs leading-5 text-slate-400">
          {research.notes.map((note) => <p key={note}>{note}</p>)}
          <p>{symbol} · {barSize} · chronological evaluation · overlapping outcomes · no multiple-test adjustment</p>
        </div>
      </details>
    </div>
  );
}

export default function MarketWeatherResearchLab(props: MarketWeatherResearchLabProps) {
  const { research } = props;
  const lexicon = research.lexicon;
  const [view, setView] = useState<LanguageView>("now");
  const labels: Record<LanguageView, { tab: string; title: string; description: string }> = {
    now: { tab: "Now", title: "Current market state", description: "What the field measures now, where it appeared in price, and how strong the historical match is." },
    dictionary: { tab: "Dictionary", title: "Learned state dictionary", description: "Measured state definitions relative to this window’s calibration baseline." },
    methods: { tab: "Methods", title: "Methods and evidence", description: "Higher-order layers, experimental sequences, validation checks, references, and limitations." },
  };

  return (
    <section className="primary-card relative isolate overflow-hidden">
      <header className="border-b border-stealth-700 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300"><FlaskConical className="h-4 w-4" />Field language · {lexicon?.version ?? "learning"}</div>
            <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">{labels[view].title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400 sm:text-sm">{labels[view].description}</p>
          </div>
          <div className="grid min-h-11 w-full grid-cols-3 rounded-xl border border-stealth-700 bg-slate-950/45 p-1 sm:w-auto" role="tablist" aria-label="Field language view">
            {(["now", "dictionary", "methods"] as LanguageView[]).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                id={`field-language-${option}-tab`}
                aria-controls={`field-language-${option}-panel`}
                aria-selected={view === option}
                onClick={() => setView(option)}
                className={`min-h-10 min-w-0 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 sm:min-w-[96px] ${view === option ? "bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30" : "text-slate-400 hover:text-white"}`}
              >
                {labels[option].tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      {lexicon?.archetypes.length ? (
        <div id={`field-language-${view}-panel`} role="tabpanel" aria-labelledby={`field-language-${view}-tab`} className="min-w-0 p-4 sm:p-5">
          {view === "now" ? <CurrentStateView {...props} /> : null}
          {view === "dictionary" ? <DictionaryView research={research} /> : null}
          {view === "methods" ? <MethodsView research={research} symbol={props.symbol} timeframe={props.timeframe} barSize={props.barSize} /> : null}
        </div>
      ) : (
        <div className="grid min-h-[260px] place-items-center p-8 text-center">
          <div><Activity className="mx-auto h-7 w-7 text-violet-300" /><div className="mt-3 text-sm font-medium text-slate-200">Learning measured states</div><div className="mt-1 text-xs text-slate-400">More eligible history is required before the state dictionary can be calibrated.</div></div>
        </div>
      )}
    </section>
  );
}
