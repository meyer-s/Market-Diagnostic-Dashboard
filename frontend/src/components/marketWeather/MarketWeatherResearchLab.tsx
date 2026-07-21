import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, BookOpen, ChevronDown, FlaskConical, Info, Layers, RotateCcw } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
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
  marketStateColor,
  robustFieldDeviations,
} from "../../utils/marketWeatherLexicon";
import {
  buildDirectionalPhaseRuns,
  buildLearnedFormRuns,
  buildMarketStateTimeline,
  focusedRatioDomain,
  sliceMarketStateTimeline,
} from "../../utils/marketWeatherTimeline";
import type {
  MarketDirectionalPhase,
  MarketStateTimelinePoint,
  MarketTimelineWindow,
} from "../../utils/marketWeatherTimeline";

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
  if (timeframe === "1D") return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (timeframe === "1W") return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

function formatObservationDate(value: string, timeframe: MarketWeatherTimeframe): string {
  const date = parseTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  return ["1D", "1W"].includes(timeframe)
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

function sampleLabel(sampleSize: number): string {
  if (sampleSize < 5) return "Too few holdout observations";
  if (sampleSize < 20) return "Limited holdout evidence";
  return "Descriptive holdout evidence";
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

const TIMELINE_WINDOWS: MarketTimelineWindow[] = [60, 120, 250, "all"];
const TIMELINE_SYNC_ID = "market-state-through-time";

const PHASE_STYLES: Record<MarketDirectionalPhase, { label: string; color: string }> = {
  "positive-strengthening": { label: "Positive · strengthening", color: "#38bdf8" },
  "positive-fading": { label: "Positive · fading", color: "#7dd3fc" },
  "negative-strengthening": { label: "Negative · strengthening", color: "#8b5cf6" },
  "negative-fading": { label: "Negative · fading", color: "#c4b5fd" },
  balanced: { label: "Balanced", color: "#94a3b8" },
};

function formatSignedScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}×`;
}

function activeTimelineDate(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("activeLabel" in state)) return null;
  const activeLabel = (state as { activeLabel?: unknown }).activeLabel;
  return typeof activeLabel === "string" ? activeLabel : null;
}

function EmptyTimelineTooltip() {
  return null;
}

function TimelineCursor({ selectedDate }: { selectedDate: string }) {
  return <ReferenceLine x={selectedDate} stroke="#e2e8f0" strokeDasharray="3 4" strokeOpacity={0.72} />;
}

function TimelineTrackHeader({
  title,
  scale,
  children,
}: {
  title: string;
  scale: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        <p className="mt-0.5 text-xs text-slate-400">{scale}</p>
      </div>
      {children ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">{children}</div> : null}
    </div>
  );
}

function RatioTimelineTrack({
  data,
  dataKey,
  label,
  color,
  selectedDate,
  selectedValue,
  onInspect,
}: {
  data: MarketStateTimelinePoint[];
  dataKey: "volatilityRatio" | "participationRatio" | "liquidityRatio";
  label: string;
  color: string;
  selectedDate: string;
  selectedValue: number | null;
  onInspect: (state: unknown) => void;
}) {
  const domain = focusedRatioDomain(data, dataKey);
  return (
    <div className="min-w-0 lg:px-3 lg:first:pl-0 lg:last:pr-0">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-300">{label}</span>
        <strong className="font-mono text-white">{formatRatio(selectedValue)}</strong>
      </div>
      <div className="h-[104px] min-w-0" role="img" aria-label={`${label} relative to its own causal trailing baseline over the selected window`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            syncId={TIMELINE_SYNC_ID}
            margin={{ top: 7, right: 4, left: 0, bottom: 0 }}
            onMouseMove={onInspect}
            onClick={onInspect}
            accessibilityLayer
          >
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis
              domain={domain}
              width={42}
              tickCount={3}
              tick={{ fill: "var(--chart-axis-tick)", fontSize: 10 }}
              tickFormatter={(value: number) => Number(value).toFixed(domain[1] - domain[0] < 0.5 ? 2 : 1)}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={1} stroke="#64748b" strokeDasharray="3 4" />
            <TimelineCursor selectedDate={selectedDate} />
            <Tooltip content={<EmptyTimelineTooltip />} cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 4" }} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MarketStateTimeline({
  price,
  research,
  timeframe,
}: {
  price: MarketWeatherPricePoint[];
  research: MarketWeatherResearch;
  timeframe: MarketWeatherTimeframe;
}) {
  const lexicon = research.lexicon!;
  const timeline = useMemo(() => buildMarketStateTimeline(price, research), [price, research]);
  const [window, setWindow] = useState<MarketTimelineWindow>(120);
  const visible = useMemo(() => sliceMarketStateTimeline(timeline, window), [timeline, window]);
  const latestDate = visible[visible.length - 1]?.date ?? "";
  const [selectedDate, setSelectedDate] = useState(latestDate);

  useEffect(() => {
    if (!visible.some((point) => point.date === selectedDate)) setSelectedDate(latestDate);
  }, [latestDate, selectedDate, visible]);

  const selected = visible.find((point) => point.date === selectedDate) ?? visible[visible.length - 1];
  const directionalRuns = useMemo(() => buildDirectionalPhaseRuns(visible), [visible]);
  const learnedFormRuns = useMemo(() => buildLearnedFormRuns(visible), [visible]);
  const stateNumberById = useMemo(
    () => new Map(lexicon.archetypes.map((archetype, index) => [archetype.id, index + 1])),
    [lexicon.archetypes],
  );
  const learnedTransitions = learnedFormRuns
    .filter((run) => run.stateId !== null)
    .reduce((count, run, index, runs) => count + (index > 0 && runs[index - 1].stateId !== run.stateId ? 1 : 0), 0);
  const cutoff = lexicon.distance_metric.outside_range_cutoff ?? 0.05;
  const rangeLabel = selected?.distanceTailScore === null || selected?.distanceTailScore === undefined
    ? "Not range-scored"
    : selected.outsideLearnedRange
      ? "Outside learned range"
      : "Within learned range";
  const selectedStateNumber = selected?.stateId ? stateNumberById.get(selected.stateId) : undefined;

  const inspect = (state: unknown) => {
    const date = activeTimelineDate(state);
    if (date) setSelectedDate(date);
  };

  if (!selected) return null;

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-stealth-700 bg-slate-950/30">
      <header className="border-b border-stealth-700 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h3 className="text-lg font-semibold text-white">Market state through time</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">One shared cursor connects price to the measurements that produced each description. Historical diagnostics, not forecasts.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-stealth-700 bg-slate-950/45 p-1" aria-label="Timeline window">
              {TIMELINE_WINDOWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={window === option}
                  onClick={() => setWindow(option)}
                  className={`min-h-9 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${window === option ? "bg-sky-400/15 text-sky-100 ring-1 ring-sky-400/25" : "text-slate-400 hover:text-white"}`}
                >
                  {option === "all" ? "All" : option}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSelectedDate(latestDate)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stealth-700 px-3 text-xs text-slate-300 transition hover:border-stealth-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />Latest
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-stealth-700 bg-slate-950/35">
          <div className="grid sm:grid-cols-2 xl:grid-cols-[1.25fr_.55fr_.8fr_1fr_1fr] xl:divide-x xl:divide-stealth-700">
            <div className="p-3 sm:col-span-2 xl:col-span-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Inspected bar</span>
              <strong className="mt-1 block text-base text-white">{PHASE_STYLES[selected.directionalPhase].label}</strong>
              <span className="mt-1 block text-xs text-slate-400">{formatObservationDate(selected.date, timeframe)} · {selectedStateNumber ? `Form ${selectedStateNumber}` : "before learned evaluation"}</span>
            </div>
            <div className="border-t border-stealth-700 p-3 sm:border-r sm:border-stealth-700 xl:border-t-0 xl:border-r-0">
              <span className="text-xs text-slate-400">Close</span>
              <strong className="mt-1 block font-mono text-base text-white">${selected.close.toFixed(2)}</strong>
            </div>
            <div className="border-t border-stealth-700 p-3 xl:border-t-0">
              <span className="text-xs text-slate-400">Direction</span>
              <strong className="mt-1 block font-mono text-sm text-white">{formatSignedScore(selected.pressure)} · Δ {formatSignedScore(selected.pressureChange)}</strong>
            </div>
            <div className="border-t border-stealth-700 p-3 sm:border-r sm:border-stealth-700 xl:border-t-0 xl:border-r-0">
              <span className="text-xs text-slate-400">Field structure</span>
              <strong className="mt-1 block font-mono text-sm text-white">{Math.round(selected.organization ?? 0)} org · {Math.round(selected.disorder ?? 0)} disorder · {Math.round(selected.propagation ?? 0)} spread</strong>
            </div>
            <div className="border-t border-stealth-700 p-3 xl:border-t-0">
              <span className="text-xs text-slate-400">Learned-range evidence</span>
              <strong className={`mt-1 block text-sm ${selected.outsideLearnedRange ? "text-amber-200" : "text-white"}`}>{rangeLabel}</strong>
              <span className="mt-1 block font-mono text-xs text-slate-400">score {selected.distanceTailScore?.toFixed(3) ?? "—"} · cutoff {cutoff.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="divide-y divide-stealth-700">
        <section className="p-4 sm:p-5">
          <TimelineTrackHeader title="Price" scale={`Actual close · ${visible.length} bars`} />
          <div className="h-[190px] min-w-0 sm:h-[220px]" role="img" aria-label="Closing price over the selected window with measured directional phases">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={visible}
                syncId={TIMELINE_SYNC_ID}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                onMouseMove={inspect}
                onClick={inspect}
                accessibilityLayer
              >
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis domain={["auto", "auto"]} width={58} tick={{ fill: "var(--chart-axis-tick)", fontSize: 11 }} tickFormatter={(value: number) => `$${Number(value).toFixed(0)}`} axisLine={false} tickLine={false} />
                {directionalRuns.map((run) => <ReferenceArea key={run.key} x1={run.start} x2={run.end} fill={PHASE_STYLES[run.phase].color} fillOpacity={0.055} strokeOpacity={0} />)}
                <TimelineCursor selectedDate={selected.date} />
                <Tooltip content={<EmptyTimelineTooltip />} cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 4" }} />
                <Line type="monotone" dataKey="close" stroke="#7dd3fc" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 space-y-3 pl-[58px] pr-2">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><span>Measured directional phase</span><span>{Math.max(0, directionalRuns.length - 1)} phase changes</span></div>
              <div className="flex h-7 min-w-0 overflow-hidden rounded-md border border-stealth-700 bg-slate-900" role="list" aria-label="Measured directional phase runs">
                {directionalRuns.map((run) => (
                  <button
                    key={run.key}
                    type="button"
                    role="listitem"
                    onClick={() => setSelectedDate(run.end)}
                    className="min-w-[3px] border-r border-slate-950/80 last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{ flexGrow: run.duration, backgroundColor: PHASE_STYLES[run.phase].color, borderBottom: run.outsideLearnedRange ? "3px solid #fbbf24" : undefined }}
                    title={`${PHASE_STYLES[run.phase].label}; ${run.duration} bars; ${formatObservationDate(run.start, timeframe)} to ${formatObservationDate(run.end, timeframe)}${run.outsideLearnedRange ? "; outside learned range" : ""}`}
                    aria-label={`${PHASE_STYLES[run.phase].label}, ${run.duration} bars${run.outsideLearnedRange ? ", outside learned range" : ""}`}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><span>Learned Form identity</span><span>{lexicon.archetypes.length} supported · {learnedTransitions} transitions{learnedFormRuns.some((run) => run.stateId === null) ? " · gray before evaluation" : ""}</span></div>
              <div className="flex h-3 min-w-0 overflow-hidden rounded-sm bg-slate-900" role="list" aria-label="Learned Form identity over the evaluation window">
                {learnedFormRuns.map((run) => (
                  <button
                    key={run.key}
                    type="button"
                    role="listitem"
                    onClick={() => setSelectedDate(run.end)}
                    className="min-w-[3px] border-r border-slate-950/80 last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{ flexGrow: run.duration, backgroundColor: run.stateId ? marketStateColor(run.stateId) : "#334155" }}
                    title={`${run.stateId ? `Form ${stateNumberById.get(run.stateId) ?? 1}` : "Before learned evaluation"}; ${run.duration} bars; ${formatObservationDate(run.start, timeframe)} to ${formatObservationDate(run.end, timeframe)}`}
                    aria-label={`${run.stateId ? `Learned Form ${stateNumberById.get(run.stateId) ?? 1}` : "Before learned evaluation"}, ${run.duration} bars`}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="p-4 sm:p-5">
          <TimelineTrackHeader title="Direction" scale="Pressure and pressure change · −100 to +100 bounded signed scales">
            <span><span className="mr-1.5 inline-block h-0.5 w-5 bg-sky-300 align-middle" />Pressure</span>
            <span><span className="mr-1.5 inline-block w-5 border-t-2 border-dashed border-violet-300 align-middle" />Pressure change</span>
          </TimelineTrackHeader>
          <div className="h-[138px] min-w-0" role="img" aria-label="Directional pressure and pressure change over the selected window">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visible} syncId={TIMELINE_SYNC_ID} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} onMouseMove={inspect} onClick={inspect} accessibilityLayer>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis domain={[-100, 100]} ticks={[-100, 0, 100]} width={58} tick={{ fill: "var(--chart-axis-tick)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <ReferenceLine y={0} stroke="#64748b" />
                <TimelineCursor selectedDate={selected.date} />
                <Tooltip content={<EmptyTimelineTooltip />} cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 4" }} />
                <Line type="monotone" dataKey="pressure" stroke="#7dd3fc" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="pressureChange" stroke="#c4b5fd" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="p-4 sm:p-5">
          <TimelineTrackHeader title="Field structure" scale="Bounded 0 to 100 model scores; shared scale, distinct measurements">
            <span><span className="mr-1.5 inline-block h-0.5 w-5 bg-sky-300 align-middle" />Organization</span>
            <span><span className="mr-1.5 inline-block w-5 border-t-2 border-dashed border-violet-300 align-middle" />Disorder</span>
            <span><span className="mr-1.5 inline-block w-5 border-t-2 border-dotted border-amber-300 align-middle" />Propagation</span>
          </TimelineTrackHeader>
          <div className="h-[150px] min-w-0" role="img" aria-label="Organization, disorder, and cross-horizon propagation over the selected window">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visible} syncId={TIMELINE_SYNC_ID} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} onMouseMove={inspect} onClick={inspect} accessibilityLayer>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} width={58} tick={{ fill: "var(--chart-axis-tick)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 4" />
                <TimelineCursor selectedDate={selected.date} />
                <Tooltip content={<EmptyTimelineTooltip />} cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 4" }} />
                <Line type="monotone" dataKey="organization" stroke="#7dd3fc" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="disorder" stroke="#c4b5fd" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="propagation" stroke="#fcd34d" strokeWidth={2} strokeDasharray="2 4" dot={false} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="p-4 sm:p-5">
          <TimelineTrackHeader title="Market carriers" scale="Each mini-track uses its own focused scale around a 1.00× causal baseline; missing volume evidence stays blank" />
          <div className="grid min-w-0 gap-3 divide-stealth-700 lg:grid-cols-3 lg:divide-x">
            <RatioTimelineTrack data={visible} dataKey="volatilityRatio" label="Realized volatility" color="#7dd3fc" selectedDate={selected.date} selectedValue={selected.volatilityRatio} onInspect={inspect} />
            <RatioTimelineTrack data={visible} dataKey="participationRatio" label="Volume participation" color="#c4b5fd" selectedDate={selected.date} selectedValue={selected.participationRatio} onInspect={inspect} />
            <RatioTimelineTrack data={visible} dataKey="liquidityRatio" label="Liquidity stress" color="#fcd34d" selectedDate={selected.date} selectedValue={selected.liquidityRatio} onInspect={inspect} />
          </div>
        </section>

        <section className="p-4 sm:p-5">
          <TimelineTrackHeader title="Learned-range evidence" scale={`Same-state distance-tail rank · lower means farther · outside below ${cutoff.toFixed(2)}`}>
            <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-amber-300/30 ring-1 ring-amber-300/60" />Outside-range zone</span>
          </TimelineTrackHeader>
          <div className="h-[142px] min-w-0" role="img" aria-label="Same-state distance-tail rank over the learned evaluation window; lower values are farther from the learned Form">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visible} syncId={TIMELINE_SYNC_ID} margin={{ top: 5, right: 8, left: 0, bottom: 4 }} onMouseMove={inspect} onClick={inspect} accessibilityLayer>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" minTickGap={42} tick={{ fill: "var(--chart-axis-tick)", fontSize: 11 }} tickFormatter={(value: string) => formatDate(value, timeframe)} axisLine={{ stroke: "var(--chart-axis-line)" }} tickLine={false} />
                <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} width={58} tick={{ fill: "var(--chart-axis-tick)", fontSize: 11 }} tickFormatter={(value: number) => Number(value).toFixed(1)} axisLine={false} tickLine={false} />
                <ReferenceArea y1={0} y2={cutoff} fill="#fbbf24" fillOpacity={0.13} strokeOpacity={0} />
                <ReferenceLine y={cutoff} stroke="#fbbf24" strokeDasharray="4 4" />
                <TimelineCursor selectedDate={selected.date} />
                <Tooltip content={<EmptyTimelineTooltip />} cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 4" }} />
                <Area type="monotone" dataKey="distanceTailScore" stroke="#fcd34d" strokeWidth={2} fill="#fbbf24" fillOpacity={0.08} dot={false} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
      <p className="sr-only">At {formatObservationDate(selected.date, timeframe)}, the close was ${selected.close.toFixed(2)}. {PHASE_STYLES[selected.directionalPhase].label}. Organization {Math.round(selected.organization ?? 0)}, disorder {Math.round(selected.disorder ?? 0)}, and propagation {Math.round(selected.propagation ?? 0)} on zero-to-one-hundred scales. {rangeLabel}.</p>
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
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              {noCloseMatch
                ? `The current measurements read ${profile.headline.toLowerCase()}, but this bar falls outside the learned Form’s held-out range, so its historical analog is disabled.`
                : profile.summary}
            </p>
          </div>
          <div className="min-w-[250px] rounded-xl border border-stealth-600 bg-slate-950/45 px-4 py-3 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wider text-slate-400">Learned-range check</span>
            <span className={`mt-1 block text-base font-semibold ${noCloseMatch ? "text-amber-200" : "text-white"}`}>{!rangeCheckAvailable ? "Insufficient history" : noCloseMatch ? "Outside range" : "Within range"}</span>
            <span className="mt-1 block font-mono text-xs text-slate-400">score {current.distance_tail_score?.toFixed(3) ?? "—"}{distanceTailCutoff !== undefined ? ` · cutoff ${distanceTailCutoff.toFixed(2)}` : ""} · n={current.distance_tail_support}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-3 text-xs text-slate-400">
          <span>Current Form run <strong className="font-medium text-slate-200">{current.age_bars} bars{current.age_truncated ? "+" : ""}</strong></span>
          <span>Typical learned run <strong className="font-medium text-slate-200">{archetype.typical_duration_bars} bars</strong></span>
          <span>Window frequency <strong className="font-medium text-slate-200">{formatRate(archetype.window_frequency)}</strong></span>
          <span>Evidence <strong className="font-medium text-slate-200">{archetype.fit_count} fit · {archetype.calibration_count} range-check · {archetype.evaluation_count} holdout</strong></span>
          <span>Range support minimum <strong className="font-medium text-slate-200">{minimumTailSupport}</strong></span>
        </div>
        {!lexicon.training_split.warmup_complete ? <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">This history does not fully cover the requested horizon warm-up. Treat the learned state and its comparisons as provisional.</p> : null}
      </section>

      <MarketStateTimeline price={price} research={research} timeframe={timeframe} />

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
        <div className={`mt-4 overflow-hidden rounded-xl border border-white/10 ${noCloseMatch ? "opacity-55" : ""}`} aria-disabled={noCloseMatch || undefined}>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-white/10">
            <div className="p-3"><span className="text-xs text-slate-400">Forward window</span><strong className="ml-2 font-mono text-sm text-white sm:ml-0 sm:mt-1 sm:block">{outcome.forward_bars} bars</strong></div>
            <div className="border-t border-white/10 p-3 sm:border-t-0"><span className="text-xs text-slate-400">Median return</span><strong className="ml-2 font-mono text-sm text-white sm:ml-0 sm:mt-1 sm:block">{formatReturn(outcome.median_return)}</strong></div>
            <div className="border-t border-white/10 p-3 xl:border-t-0"><span className="text-xs text-slate-400">Positive observations</span><strong className="ml-2 font-mono text-sm text-white sm:ml-0 sm:mt-1 sm:block">{formatRate(outcome.positive_rate)}</strong></div>
            <div className="border-t border-white/10 p-3 xl:border-t-0"><span className="text-xs text-slate-400">Holdout sample</span><strong className="ml-2 font-mono text-sm text-white sm:ml-0 sm:mt-1 sm:block">n={outcome.sample_size}</strong></div>
          </div>
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
          {lexicon.archetypes.length === 1 ? <p className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs leading-5 text-sky-100">This window supports one state. Additional divisions did not meet the model’s minimum fit support and separation requirements.</p> : null}
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
    now: { tab: "Now", title: "Current market state", description: "How the current reading formed and how its measured components changed together over time." },
    dictionary: { tab: "Dictionary", title: "Learned state dictionary", description: "Measured state definitions relative to this window’s earlier model-fit baseline." },
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
