import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Download,
  Info,
  X,
} from "lucide-react";

import type {
  MarketWeatherComparisonBasis,
  MarketWeatherComparisonCoordinate,
  MarketWeatherComparisonResponse,
  MarketWeatherComparisonSeriesPoint,
  MarketWeatherComparisonView,
  MarketWeatherPairCoordinateOrder,
  MarketWeatherPairScopeScale,
  MarketWeatherPairScopeTrail,
  MarketWeatherPairTab,
  MarketWeatherTimeframe,
} from "../../types/marketWeather";
import {
  markPairOverviewVisible,
  trackPairEvent,
} from "../../utils/marketWeatherPairTelemetry";
import { buildMarketWeatherPairSummary } from "../../utils/marketWeatherPairSummary";

interface MarketWeatherComparisonLabProps {
  data: MarketWeatherComparisonResponse;
  basis: MarketWeatherComparisonBasis;
  view: MarketWeatherComparisonView;
  selectedDimension: string;
  tab?: PairTab;
  scopeTrail?: ScopeTrail;
  scopeScale?: ScopeScale;
  coordinateOrder?: CoordinateOrder;
  onBasisChange: (basis: MarketWeatherComparisonBasis) => void;
  onViewChange: (view: MarketWeatherComparisonView) => void;
  onDimensionChange: (dimension: string) => void;
  onTabChange?: (tab: PairTab) => void;
  onScopeTrailChange?: (trail: ScopeTrail) => void;
  onScopeScaleChange?: (scale: ScopeScale) => void;
  onCoordinateOrderChange?: (order: CoordinateOrder) => void;
}

interface ScopeDefinition {
  id: string;
  title: string;
  question: string;
  x: string;
  y: string;
  marker: string;
  xMeaning: string;
  yMeaning: string;
  markerMeaning: string;
  caution: string;
}

const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  {
    id: "direction",
    title: "Directional phase",
    question: "Which way does the multihorizon trend state lean, and is that lean building or easing?",
    x: "pressure",
    y: "velocity",
    marker: "structure",
    xMeaning: "directional lean",
    yMeaning: "pressure-change reading",
    markerMeaning: "directional activity plus neighboring-horizon agreement",
    caution: "Pressure describes the measured trend state, not expected return.",
  },
  {
    id: "higher_motion",
    title: "Higher motion",
    question: "Is pressure change accelerating, and is that acceleration still building or starting to turn?",
    x: "acceleration",
    y: "jerk",
    marker: "snap",
    xMeaning: "acceleration",
    yMeaning: "jerk",
    markerMeaning: "the change in jerk, the most noise-sensitive derivative here",
    caution: "Higher-order differences amplify noise and are not signals by themselves.",
  },
  {
    id: "organization",
    title: "Structure & information",
    question: "Are horizons active and aligned, and is the recent ordering relatively simple or complex?",
    x: "structure",
    y: "information",
    marker: "kinematics",
    xMeaning: "activity-and-agreement composite",
    yMeaning: "ordinal disorder",
    markerMeaning: "total reorganization across the pressure derivatives",
    caution: "Structure is a composite, not pure organization; Information means measured disorder, not useful information or confidence.",
  },
  {
    id: "propagation",
    title: "Propagation & carriers",
    question: "Is a change appearing across horizons, which way is it oriented, and is price impact elevated?",
    x: "propagation",
    y: "cascade_bias",
    marker: "liquidity_stress_carrier",
    xMeaning: "cross-horizon spread",
    yMeaning: "cascade orientation",
    markerMeaning: "OHLCV price impact relative to its causal baseline",
    caution: "This is not causal transmission, lead-lag evidence, or order-book liquidity.",
  },
];

const FAMILY_LABELS: Record<string, string> = {
  pressure_state: "Motion",
  field_transform: "Field structure",
  ohlcv_carrier: "Activity and liquidity",
};

const FAMILY_ORDER = ["pressure_state", "field_transform", "ohlcv_carrier"] as const;

const COORDINATE_GUIDANCE: Record<string, { definition: string; higher: string }> = {
  pressure: {
    definition: "Bounded signed multihorizon directional pressure.",
    higher: "Higher means more positive measured pressure, not better expected performance.",
  },
  velocity: {
    definition: "First causal time difference of directional pressure.",
    higher: "Higher means pressure is changing in a more positive direction.",
  },
  acceleration: {
    definition: "Second causal time difference of directional pressure.",
    higher: "Higher means the pressure-change rate is becoming more positive.",
  },
  jerk: {
    definition: "Third causal time difference of directional pressure.",
    higher: "Higher means acceleration is changing in a more positive direction.",
  },
  snap: {
    definition: "Fourth causal time difference of directional pressure.",
    higher: "Higher is a signed higher-order motion measurement, not a quality score.",
  },
  structure: {
    definition: "Implemented blend of directional activity and cross-horizon agreement.",
    higher: "Higher means more of the recipe's activity/agreement composite; its flat-field anchor is nonzero.",
  },
  kinematics: {
    definition: "Magnitude-weighted summary of pressure derivatives.",
    higher: "Higher means more measured reorganization across derivative orders.",
  },
  geometry: {
    definition: "Boundary and scale-derivative magnitude across the horizon field.",
    higher: "Higher means more measured horizon-shape activity.",
  },
  information: {
    definition: "Permutation-entropy and disorder blend under the fixed recipe.",
    higher: "Higher means greater measured ordinal disorder; it is parameter-sensitive.",
  },
  propagation: {
    definition: "Mean cross-horizon propagation strength.",
    higher: "Higher means stronger measured transmission across configured horizons.",
  },
  cascade_bias: {
    definition: "Signed direction of cross-horizon propagation.",
    higher: "Higher means the measured cascade is oriented toward longer horizons.",
  },
  scaling_exponent: {
    definition: "Log-horizon slope of realized variation.",
    higher: "Higher means realized variation grows faster across the configured horizon grid.",
  },
  volatility_carrier: {
    definition: "Realized-volatility level relative to its causal baseline.",
    higher: "Higher means more realized variation relative to that instrument's baseline.",
  },
  participation_carrier: {
    definition: "Volume participation relative to its causal baseline.",
    higher: "Higher means more volume participation relative to that instrument's baseline.",
  },
  liquidity_stress_carrier: {
    definition: "Price-impact proxy relative to its causal baseline.",
    higher: "Higher means more measured liquidity stress relative to that instrument's baseline.",
  },
};

type PairTab = MarketWeatherPairTab;
type ScopeTrail = MarketWeatherPairScopeTrail;
type ScopeScale = MarketWeatherPairScopeScale;
type CoordinateOrder = MarketWeatherPairCoordinateOrder;

const PAIR_TAB_OPTIONS: Array<{ id: PairTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "field", label: "Field detail" },
  { id: "audit", label: "Audit receipt" },
];

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function useMinimumWidth(minimumWidth: number): boolean {
  const read = () => {
    if (typeof window === "undefined") return false;
    return typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width: ${minimumWidth}px)`).matches
      : window.innerWidth >= minimumWidth;
  };
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width: ${minimumWidth}px)`)
      : null;
    const update = () => setMatches(read());
    media?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    return () => {
      media?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, [minimumWidth]);

  return matches;
}

function useDesktopLayout(): boolean {
  return useMinimumWidth(1024);
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (!finite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (!finite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatLevel(value: number | null | undefined): string {
  if (!finite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 2 : 4 }).format(value);
}

function formatMilliseconds(value: number | null | undefined): string {
  return finite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)} ms` : "not measured";
}

function formatDate(value: string | null | undefined, timeframe: MarketWeatherTimeframe): string {
  if (!value) return "Unavailable";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return ["1D", "1W"].includes(timeframe)
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function observationFrequency(timeframe: MarketWeatherTimeframe): string {
  if (timeframe === "1D") return "daily";
  if (timeframe === "1W") return "weekly";
  return timeframe;
}

function relativeStanding(
  targetSymbol: string,
  benchmarkSymbol: string,
  value: number | null | undefined,
): {
  headline: string;
  plain: string;
} {
  if (!finite(value)) {
    return {
      headline: "Relative progress unavailable",
      plain: `${targetSymbol} and ${benchmarkSymbol} do not have a supported current relative-progress reading.`,
    };
  }
  if (value > 0) {
    return {
      headline: `${targetSymbol} ahead of ${benchmarkSymbol}`,
      plain: `${targetSymbol} is ahead of ${benchmarkSymbol} by ${Math.abs(value).toFixed(2)}%`,
    };
  }
  if (value < 0) {
    return {
      headline: `${targetSymbol} behind ${benchmarkSymbol}`,
      plain: `${targetSymbol} is behind ${benchmarkSymbol} by ${Math.abs(value).toFixed(2)}%`,
    };
  }
  return {
    headline: `${targetSymbol} level with ${benchmarkSymbol}`,
    plain: `${targetSymbol} and ${benchmarkSymbol} are level from the shared starting point`,
  };
}

function betaStanding(
  targetSymbol: string,
  benchmarkSymbol: string,
  value: number | null | undefined,
): string {
  if (!finite(value)) return "A current adjusted comparison is unavailable.";
  if (value > 0) return `${targetSymbol} remains ahead of ${benchmarkSymbol} on the current adjusted chain.`;
  if (value < 0) return `${targetSymbol} trails ${benchmarkSymbol} on the current adjusted chain.`;
  return `${targetSymbol} and ${benchmarkSymbol} are level on the current adjusted chain.`;
}

function AuditGroup({
  code,
  title,
  summary,
  initiallyOpen = false,
  children,
}: {
  code: string;
  title: string;
  summary: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group overflow-hidden rounded-xl border border-stealth-700 bg-slate-950/30"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-sky-400/20 bg-sky-400/[0.06] font-mono text-[10px] text-sky-200">
            {code}
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-slate-100">{title}</h3>
            <p className="mt-0.5 truncate text-[10px] text-slate-400">{summary}</p>
          </div>
        </div>
        <span className="shrink-0 text-xs text-slate-500 transition group-open:rotate-45" aria-hidden="true">+</span>
      </summary>
      <div className="border-t border-stealth-700 p-3.5">
        {children}
      </div>
    </details>
  );
}

function relationshipStateLabel(value: string): string {
  if (value === "widening") return "Widening";
  if (value === "converging") return "Narrowing";
  if (value === "mixed") return "No clear change";
  return "Insufficient support";
}

function betaChainStart(data: MarketWeatherComparisonResponse): string | null {
  let start: string | null = null;
  for (let index = 0; index < data.price_series.length; index += 1) {
    const value = data.price_series[index]?.beta_adjusted_cumulative_return;
    if (!finite(value)) {
      start = null;
    } else if (start === null) {
      start = data.price_series[index]?.date ?? null;
    }
  }
  return start;
}

function relationshipStretchValues(data: MarketWeatherComparisonResponse): {
  latest: number | null;
  previous: number | null;
} {
  const familyPairs = new Map<string, Array<[number, number]>>();
  const observedFamilies = new Set(data.coordinates.map((coordinate) => coordinate.family));
  data.coordinates.forEach((coordinate) => {
    if (coordinate.series.length < 6) return;
    const latest = coordinate.series[coordinate.series.length - 1]?.context_difference;
    const previous = coordinate.series[coordinate.series.length - 6]?.context_difference;
    const latestRow = coordinate.series[coordinate.series.length - 1];
    const previousRow = coordinate.series[coordinate.series.length - 6];
    if (
      latestRow?.target_supported === false
      || latestRow?.benchmark_supported === false
      || latestRow?.pair_supported === false
      || previousRow?.target_supported === false
      || previousRow?.benchmark_supported === false
      || previousRow?.pair_supported === false
    ) return;
    if (!finite(latest) || !finite(previous)) return;
    const pairs = familyPairs.get(coordinate.family) ?? [];
    pairs.push([latest, previous]);
    familyPairs.set(coordinate.family, pairs);
  });
  if (!observedFamilies.size || [...observedFamilies].some((family) => !familyPairs.has(family))) {
    return { latest: null, previous: null };
  }
  const means = (position: 0 | 1) => {
    const familyMeans = [...familyPairs.values()].map(
      (pairs) => pairs.reduce((sum, pair) => sum + Math.abs(pair[position]), 0) / pairs.length,
    );
    return familyMeans.reduce((sum, value) => sum + value, 0) / familyMeans.length;
  };
  return { latest: means(0), previous: means(1) };
}

function fiveBarChange(
  coordinate: MarketWeatherComparisonCoordinate,
  basis: MarketWeatherComparisonBasis,
): number | null {
  if (coordinate.series.length < 6) return null;
  const current = coordinate.series[coordinate.series.length - 1];
  const previous = coordinate.series[coordinate.series.length - 6];
  if (!current || !previous) return null;
  const currentValue = supportedValueForPoint(current, basis, "difference");
  const previousValue = supportedValueForPoint(previous, basis, "difference");
  return finite(currentValue) && finite(previousValue) ? currentValue - previousValue : null;
}

function valueForPoint(
  point: MarketWeatherComparisonSeriesPoint,
  basis: MarketWeatherComparisonBasis,
  view: MarketWeatherComparisonView,
): number | null {
  if (view === "difference") {
    return basis === "context" ? point.context_difference : point.native_difference;
  }
  if (basis === "context") {
    const contextual = view === "target" ? point.target_context : point.benchmark_context;
    return finite(contextual) ? contextual : null;
  }
  return view === "target" ? point.target : point.benchmark;
}

function supportedValueForPoint(
  point: MarketWeatherComparisonSeriesPoint,
  basis: MarketWeatherComparisonBasis,
  view: MarketWeatherComparisonView,
): number | null {
  if (view === "target" && point.target_supported === false) return null;
  if (view === "benchmark" && point.benchmark_supported === false) return null;
  if (
    view === "difference"
    && (
      point.target_supported === false
      || point.benchmark_supported === false
      || point.pair_supported === false
    )
  ) return null;
  return valueForPoint(point, basis, view);
}

function latestDifference(
  coordinate: MarketWeatherComparisonCoordinate,
  basis: MarketWeatherComparisonBasis,
): number | null {
  if (
    coordinate.latest.target_supported === false
    || coordinate.latest.benchmark_supported === false
    || coordinate.latest.pair_supported === false
  ) return null;
  return basis === "context" ? coordinate.latest.context_difference : coordinate.latest.native_difference;
}

function colorForValue(value: number, maximum: number, alpha = 0.88): string {
  const intensity = Math.min(1, Math.abs(value) / Math.max(maximum, 1e-9));
  if (Math.abs(value) < maximum * 0.055) return `rgba(71, 85, 105, ${Math.max(0.34, alpha * 0.55)})`;
  if (value > 0) {
    return `rgba(${Math.round(45 - 16 * intensity)}, ${Math.round(158 + 47 * intensity)}, ${Math.round(190 + 30 * intensity)}, ${alpha})`;
  }
  return `rgba(${Math.round(130 + 58 * intensity)}, ${Math.round(94 - 28 * intensity)}, ${Math.round(205 + 30 * intensity)}, ${alpha})`;
}

interface HeatSegment {
  color: string;
  magnitude: number;
  supported: boolean;
  value: number | null;
}

function heatSegments(
  coordinate: MarketWeatherComparisonCoordinate,
  basis: MarketWeatherComparisonBasis,
): HeatSegment[] {
  const points = coordinate.series.slice(-72);
  const values = points.map((point) => (
    point.target_supported !== false && point.benchmark_supported !== false && point.pair_supported !== false
      ? basis === "context" ? point.context_difference : point.native_difference
      : null
  ));
  const finiteValues = values.filter(finite);
  const maximum = Math.max(...finiteValues.map(Math.abs), 1e-9);
  return values.map((value) => ({
    color: finite(value) ? colorForValue(value, maximum) : "rgba(15,23,42,.9)",
    magnitude: finite(value) ? Math.min(1, Math.abs(value) / maximum) : 0,
    supported: finite(value),
    value,
  }));
}

function seriesDash(view: MarketWeatherComparisonView): string | undefined {
  if (view === "benchmark") return "8 4";
  if (view === "difference") return "2 4";
  return undefined;
}

function SeriesPointMarker({
  view,
  x,
  y,
  stroke,
  size,
  emphasized = false,
}: {
  view: MarketWeatherComparisonView;
  x: number;
  y: number;
  stroke: string;
  size: number;
  emphasized?: boolean;
}) {
  const fill = emphasized ? stroke : "#0f172a";
  const strokeColor = emphasized ? "#f8fafc" : stroke;
  const strokeWidth = emphasized ? 1.7 : 1.2;
  if (view === "benchmark") {
    const edge = size * 1.45;
    return (
      <rect
        x={x - edge / 2}
        y={y - edge / 2}
        width={edge}
        height={edge}
        rx=".4"
        fill={fill}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        transform={`rotate(45 ${x} ${y})`}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (view === "difference") {
    const edge = size * 1.7;
    return (
      <rect
        x={x - edge / 2}
        y={y - edge / 2}
        width={edge}
        height={edge}
        rx=".7"
        fill={fill}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return (
    <circle
      cx={x}
      cy={y}
      r={size}
      fill={fill}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function boundedControl(value: number, left: number, right: number): number {
  return Math.max(Math.min(left, right), Math.min(Math.max(left, right), value));
}

function smoothPath(
  points: Array<{ x: number; y: number }>,
  startIndex = 0,
  endIndex = points.length - 1,
): string {
  if (!points.length || endIndex < startIndex) return "";
  if (endIndex === startIndex) return `M ${points[startIndex].x} ${points[startIndex].y}`;
  let path = `M ${points[startIndex].x.toFixed(2)} ${points[startIndex].y.toFixed(2)}`;
  for (let index = startIndex; index < endIndex; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    // A restrained Catmull-Rom conversion keeps the trail smooth without
    // allowing control points to invent excursions beyond each observed edge.
    const c1x = boundedControl(p1.x + (p2.x - p0.x) / 8, p1.x, p2.x);
    const c1y = boundedControl(p1.y + (p2.y - p0.y) / 8, p1.y, p2.y);
    const c2x = boundedControl(p2.x - (p3.x - p1.x) / 8, p1.x, p2.x);
    const c2y = boundedControl(p2.y - (p3.y - p1.y) / 8, p1.y, p2.y);
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}

interface ScopePlotPoint {
  date: string;
  sourceIndex: number;
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  marker: number | null;
}

interface ScopeStrokeChunk {
  id: string;
  points: ScopePlotPoint[];
  startIndex: number;
  endIndex: number;
  opacity: number;
  sourceEnd: number;
  dashOffset: number;
}

interface ScopeChartFrame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  xTickY: number;
  xTitleY: number;
  yTitleX: number;
}

const COMPACT_SCOPE_FRAME: ScopeChartFrame = {
  width: 360,
  height: 236,
  left: 42,
  right: 348,
  top: 18,
  bottom: 196,
  xTickY: 211,
  xTitleY: 232,
  yTitleX: 9,
};

const WIDE_SCOPE_FRAME: ScopeChartFrame = {
  width: 672,
  height: 220,
  left: 48,
  right: 624,
  top: 18,
  bottom: 184,
  xTickY: 198,
  xTitleY: 216,
  yTitleX: 10,
};

function formatScopeAxisValue(value: number, extent: number): string {
  const magnitude = Math.abs(extent);
  if (magnitude < 1e-4) {
    const normalized = Math.abs(value) < 1e-12 ? 0 : value;
    return normalized.toExponential(1);
  }
  const digits = magnitude < 0.01 ? 4 : magnitude < 0.1 ? 3 : magnitude < 10 ? 2 : 1;
  const normalized = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(digits)}`;
}

function pointLineDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x)
    / Math.hypot(dx, dy);
}

function strongestInteriorPoint(
  points: ScopePlotPoint[],
  startIndex: number,
  endIndex: number,
): { index: number; distance: number } | null {
  if (endIndex - startIndex <= 1) return null;
  let strongestIndex = -1;
  let strongestDistance = -1;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const distance = pointLineDistance(points[index], points[startIndex], points[endIndex]);
    if (distance > strongestDistance) {
      strongestIndex = index;
      strongestDistance = distance;
    }
  }
  return strongestIndex >= 0 ? { index: strongestIndex, distance: strongestDistance } : null;
}

/**
 * Budgeted Ramer-Douglas-Peucker-style simplification. Unlike uniform
 * decimation, this keeps endpoints and repeatedly preserves the strongest
 * turn, so a full-history path retains materially more of its visible shape.
 */
function simplifyScopePoints(points: ScopePlotPoint[], maximum = 240): ScopePlotPoint[] {
  if (points.length <= maximum) return points;
  const kept = new Set<number>([0, points.length - 1]);
  const spans: Array<{ start: number; end: number; candidate: { index: number; distance: number } }> = [];
  const firstCandidate = strongestInteriorPoint(points, 0, points.length - 1);
  if (firstCandidate) spans.push({ start: 0, end: points.length - 1, candidate: firstCandidate });

  while (kept.size < maximum && spans.length) {
    spans.sort((left, right) => right.candidate.distance - left.candidate.distance);
    const span = spans.shift();
    if (!span) break;
    const split = span.candidate.index;
    kept.add(split);
    const leftCandidate = strongestInteriorPoint(points, span.start, split);
    const rightCandidate = strongestInteriorPoint(points, split, span.end);
    if (leftCandidate) spans.push({ start: span.start, end: split, candidate: leftCandidate });
    if (rightCandidate) spans.push({ start: split, end: span.end, candidate: rightCandidate });
  }

  return [...kept].sort((left, right) => left - right).map((index) => points[index]);
}

function scopePathLength(points: ScopePlotPoint[], startIndex: number, endIndex: number): number {
  let length = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    length += Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
  }
  return length;
}

function temporalStrokeChunks(
  runs: ScopePlotPoint[][],
  visibleCount: number,
  view: MarketWeatherComparisonView,
  maximumChunks = 56,
): ScopeStrokeChunk[] {
  const totalEdges = runs.reduce((sum, run) => sum + Math.max(0, run.length - 1), 0);
  const edgesPerChunk = Math.max(1, Math.ceil(totalEdges / maximumChunks));
  const dashPeriod = view === "benchmark" ? 12 : view === "difference" ? 6 : 0;
  const denominator = Math.max(1, visibleCount - 1);
  const chunks: ScopeStrokeChunk[] = [];

  runs.forEach((points, runIndex) => {
    let startIndex = 0;
    let distanceBefore = 0;
    while (startIndex < points.length - 1) {
      const endIndex = Math.min(points.length - 1, startIndex + edgesPerChunk);
      const sourceEnd = points[endIndex].sourceIndex;
      const age = Math.max(0, Math.min(1, sourceEnd / denominator));
      chunks.push({
        id: `${runIndex}-${startIndex}-${endIndex}`,
        points,
        startIndex,
        endIndex,
        opacity: 0.1 + 0.9 * Math.pow(age, 1.45),
        sourceEnd,
        dashOffset: dashPeriod ? -(distanceBefore % dashPeriod) : 0,
      });
      distanceBefore += scopePathLength(points, startIndex, endIndex);
      startIndex = endIndex;
    }
  });

  return chunks;
}

function nearestScopePoint(
  points: ScopePlotPoint[],
  x: number,
  y: number,
): ScopePlotPoint | null {
  let closest: ScopePlotPoint | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point) => {
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance < closestDistance || (distance === closestDistance && point.sourceIndex > (closest?.sourceIndex ?? -1))) {
      closest = point;
      closestDistance = distance;
    }
  });
  return closest;
}

function pointerSeriesIndex(
  event: React.PointerEvent<SVGSVGElement>,
  count: number,
  viewBoxWidth: number,
  left: number,
  right: number,
): number {
  if (count <= 1) return 0;
  const rect = event.currentTarget.getBoundingClientRect();
  const viewX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * viewBoxWidth;
  const fraction = Math.max(0, Math.min(1, (viewX - left) / Math.max(1, right - left)));
  return Math.round(fraction * (count - 1));
}

function inspectLinearSeriesWithKeyboard(
  event: React.KeyboardEvent<SVGSVGElement>,
  dates: string[],
  selectedDate: string | null,
  onSelectedDateChange: (date: string | null) => void,
): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !dates.length) return;
  event.preventDefault();
  const selectedIndex = selectedDate ? dates.indexOf(selectedDate) : dates.length - 1;
  const anchor = selectedIndex >= 0 ? selectedIndex : dates.length - 1;
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? dates.length - 1
      : event.key === "ArrowLeft"
        ? Math.max(0, anchor - 1)
        : Math.min(dates.length - 1, anchor + 1);
  onSelectedDateChange(dates[nextIndex] ?? null);
}

function formatMagnitude(value: number): string {
  return Math.abs(value).toFixed(2);
}

function nearDisplayedZero(value: number): boolean {
  return Math.abs(value) < 0.005;
}

function coordinateComparisonClause({
  label,
  value,
  basis,
  view,
  subject,
  targetSymbol,
  benchmarkSymbol,
}: {
  label: string;
  value: number;
  basis: MarketWeatherComparisonBasis;
  view: MarketWeatherComparisonView;
  subject: string;
  targetSymbol: string;
  benchmarkSymbol: string;
}): string {
  const lowerLabel = label.toLowerCase();
  if (view === "difference") {
    if (nearDisplayedZero(value)) {
      return basis === "context"
        ? `${lowerLabel} is aligned on the two separate fit-relative scales`
        : `${lowerLabel} is equal on the direct model scale`;
    }
    if (basis === "context") {
      return `${targetSymbol}'s ${lowerLabel} is ${formatMagnitude(value)} fit-spread units ${value > 0 ? "more" : "less"} elevated versus its own fit history than ${benchmarkSymbol}'s`;
    }
    return `${targetSymbol}'s ${lowerLabel} is ${formatMagnitude(value)} ${value > 0 ? "higher" : "lower"} than ${benchmarkSymbol}'s on the direct model scale`;
  }

  if (basis === "context") {
    if (nearDisplayedZero(value)) return `${subject}'s ${lowerLabel} is at its frozen fit median`;
    return `${subject}'s ${lowerLabel} is ${formatMagnitude(value)} fit-spread units ${value > 0 ? "above" : "below"} its frozen fit median`;
  }
  return `${subject}'s ${lowerLabel} reads ${formatNumber(value)} on the direct model scale`;
}

function directDirectionalReading(subject: string, x: number, y: number): string {
  if (nearDisplayedZero(x)) {
    if (nearDisplayedZero(y)) return `${subject}'s pressure and pressure change are both visually near zero.`;
    return `${subject}'s pressure is visually near zero while pressure change is moving ${y > 0 ? "more positive" : "more negative"}.`;
  }
  if (nearDisplayedZero(y)) return `${subject} has ${x > 0 ? "positive" : "negative"} pressure with little current pressure change.`;
  const phase = x > 0
    ? y > 0 ? "positive pressure that is strengthening" : "positive pressure that is fading"
    : y < 0 ? "negative pressure that is strengthening" : "negative pressure that is fading";
  return `${subject} has ${phase}. This describes the measured trend state, not expected return.`;
}

function directHigherMotionReading(subject: string, x: number, y: number): string {
  if (nearDisplayedZero(x)) {
    return `${subject}'s acceleration is visually near zero; jerk is ${nearDisplayedZero(y) ? "also near zero" : `moving ${y > 0 ? "more positive" : "more negative"}`}.`;
  }
  if (nearDisplayedZero(y)) return `${subject} has ${x > 0 ? "positive" : "negative"} acceleration with little current change in that acceleration.`;
  const phase = x > 0
    ? y > 0 ? "positive acceleration that is intensifying" : "positive acceleration that is easing"
    : y > 0 ? "negative acceleration that is recovering" : "negative acceleration that is intensifying";
  return `${subject} has ${phase}. Higher-order differences are especially sensitive to noise.`;
}

function scopeReading({
  definition,
  row,
  basis,
  view,
  subject,
  targetSymbol,
  benchmarkSymbol,
}: {
  definition: ScopeDefinition;
  row: { x: number; y: number } | undefined;
  basis: MarketWeatherComparisonBasis;
  view: MarketWeatherComparisonView;
  subject: string;
  targetSymbol: string;
  benchmarkSymbol: string;
}): string {
  if (!row) return "There is not enough supported shared history to interpret this scope.";
  if (basis === "native" && view !== "difference") {
    if (definition.id === "direction") return directDirectionalReading(subject, row.x, row.y);
    if (definition.id === "higher_motion") return directHigherMotionReading(subject, row.x, row.y);
    if (definition.id === "organization") {
      return `${subject}'s activity-and-agreement composite reads ${formatNumber(row.x)}, while ordinal disorder reads ${formatNumber(row.y)}. Neither is a quality or confidence score.`;
    }
    if (definition.id === "propagation") {
      if (row.x < 0.08) {
        return `${subject}'s cross-horizon spread reads ${formatNumber(row.x)}. With propagation near zero, the cascade orientation is not meaningful.`;
      }
      return `${subject}'s cross-horizon spread reads ${formatNumber(row.x)} and is oriented toward ${row.y >= 0 ? "larger, slower" : "smaller, faster"} horizons. This is a propagation analogue, not causal transmission.`;
    }
  }

  const xClause = coordinateComparisonClause({
    label: definition.xMeaning,
    value: row.x,
    basis,
    view,
    subject,
    targetSymbol,
    benchmarkSymbol,
  });
  const yClause = coordinateComparisonClause({
    label: definition.yMeaning,
    value: row.y,
    basis,
    view,
    subject,
    targetSymbol,
    benchmarkSymbol,
  });
  return `${xClause}; ${yClause}.`;
}

function ScopeChart({
  definition,
  coordinates,
  basis,
  view,
  trail,
  scale,
  selectedDate,
  onSelectedDateChange,
  onScaleChange,
  targetSymbol,
  benchmarkSymbol,
}: {
  definition: ScopeDefinition;
  coordinates: Map<string, MarketWeatherComparisonCoordinate>;
  basis: MarketWeatherComparisonBasis;
  view: MarketWeatherComparisonView;
  trail: ScopeTrail;
  scale: ScopeScale;
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;
  onScaleChange: (scale: ScopeScale) => void;
  targetSymbol: string;
  benchmarkSymbol: string;
}) {
  const reactId = useId();
  const instanceId = `scope-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const arrowId = `${instanceId}-arrow`;
  const clipId = `${instanceId}-clip`;
  const meaningId = `${instanceId}-meaning`;
  const coordinateKeyId = `${instanceId}-coordinate-key`;
  const wideFrame = useMinimumWidth(640);
  const frame = wideFrame ? WIDE_SCOPE_FRAME : COMPACT_SCOPE_FRAME;
  const centerX = (frame.left + frame.right) / 2;
  const centerY = (frame.top + frame.bottom) / 2;
  const xRadius = (frame.right - frame.left) * 0.46;
  const yRadius = (frame.bottom - frame.top) * 0.46;
  const xCoordinate = coordinates.get(definition.x);
  const yCoordinate = coordinates.get(definition.y);
  const markerCoordinate = coordinates.get(definition.marker);
  const visibleXSeries = useMemo(
    () => trail === "full" ? xCoordinate?.series ?? [] : xCoordinate?.series.slice(-trail) ?? [],
    [trail, xCoordinate],
  );
  const rows = useMemo<Array<{ date: string; x: number; y: number; marker: number | null } | null>>(() => {
    if (!xCoordinate || !yCoordinate) return [];
    const yByDate = new Map(yCoordinate.series.map((point) => [point.date, point]));
    const markerByDate = new Map(markerCoordinate?.series.map((point) => [point.date, point]) ?? []);
    return visibleXSeries.map((xPoint) => {
      const yPoint = yByDate.get(xPoint.date);
      if (!yPoint) return null;
      const supported = view === "target"
        ? xPoint.target_supported !== false && yPoint.target_supported !== false
        : view === "benchmark"
          ? xPoint.benchmark_supported !== false && yPoint.benchmark_supported !== false
          : xPoint.target_supported !== false
            && xPoint.benchmark_supported !== false
            && xPoint.pair_supported !== false
            && yPoint.target_supported !== false
            && yPoint.benchmark_supported !== false
            && yPoint.pair_supported !== false;
      if (!supported) return null;
      const x = supportedValueForPoint(xPoint, basis, view);
      const y = supportedValueForPoint(yPoint, basis, view);
      if (!finite(x) || !finite(y)) return null;
      const markerPoint = markerByDate.get(xPoint.date);
      return {
        date: xPoint.date,
        x,
        y,
        marker: markerPoint ? supportedValueForPoint(markerPoint, basis, view) : null,
      };
    });
  }, [basis, markerCoordinate, view, visibleXSeries, xCoordinate, yCoordinate]);

  const geometry = useMemo(() => {
    const finiteRows = rows.filter(
      (point): point is { date: string; x: number; y: number; marker: number | null } => point !== null,
    );
    const allSubjects: MarketWeatherComparisonView[] = ["target", "benchmark", "difference"];
    const sharedExtent = (
      coordinate: MarketWeatherComparisonCoordinate | undefined,
    ) => Math.max(
      ...(coordinate?.series
        .slice(trail === "full" ? 0 : -trail)
        .flatMap((point) => allSubjects
          .map((subject) => supportedValueForPoint(point, basis, subject))
          .filter(finite)
          .map(Math.abs)) ?? []),
      1e-6,
    );
    const selectedExtentX = Math.max(...finiteRows.map((row) => Math.abs(row.x)), 1e-6);
    const selectedExtentY = Math.max(...finiteRows.map((row) => Math.abs(row.y)), 1e-6);
    const sharedExtentX = sharedExtent(xCoordinate);
    const sharedExtentY = sharedExtent(yCoordinate);
    const extentX = (scale === "inspect" ? selectedExtentX : sharedExtentX) * 1.08;
    const extentY = (scale === "inspect" ? selectedExtentY : sharedExtentY) * 1.08;
    const rawRuns: ScopePlotPoint[][] = [];
    let run: ScopePlotPoint[] = [];
    rows.forEach((point, sourceIndex) => {
      if (!point) {
        if (run.length) rawRuns.push(run);
        run = [];
        return;
      }
      run.push({
        date: point.date,
        sourceIndex,
        x: centerX + (point.x / extentX) * xRadius,
        y: centerY - (point.y / extentY) * yRadius,
        rawX: point.x,
        rawY: point.y,
        marker: point.marker,
      });
    });
    if (run.length) rawRuns.push(run);
    const rawPlotPoints = rawRuns.flat();
    const totalPlotPoints = rawPlotPoints.length;
    const chartRuns = rawRuns.map((points) => {
      if (totalPlotPoints <= 240 || points.length <= 2) return points;
      const allocated = Math.max(2, Math.floor(240 * points.length / totalPlotPoints));
      return simplifyScopePoints(points, allocated);
    });
    return {
      finiteRows,
      firstPoint: rawPlotPoints[0],
      latestPoint: rawPlotPoints[rawPlotPoints.length - 1],
      rawPlotPoints,
      extentX,
      extentY,
      selectedExtentX,
      selectedExtentY,
      sharedExtentX,
      sharedExtentY,
      strokeChunks: temporalStrokeChunks(chartRuns, rows.length, view),
    };
  }, [basis, centerX, centerY, rows, scale, trail, view, xCoordinate, xRadius, yCoordinate, yRadius]);
  const {
    finiteRows,
    firstPoint,
    latestPoint,
    rawPlotPoints,
    extentX,
    extentY,
    selectedExtentX,
    selectedExtentY,
    sharedExtentX,
    sharedExtentY,
    strokeChunks,
  } = geometry;
  const latestRow = finiteRows[finiteRows.length - 1];
  const latestMarker = finite(latestRow?.marker) ? latestRow.marker : null;
  const stroke = view === "target" ? "#38bdf8" : view === "benchmark" ? "#a78bfa" : "#fbbf24";
  const strokeDasharray = seriesDash(view);
  const finiteMarkerValues = finiteRows.map((row) => row.marker).filter(finite);
  const markerMagnitude = finite(latestMarker)
    ? Math.min(1, Math.abs(latestMarker) / Math.max(...finiteMarkerValues.map(Math.abs), 1e-6))
    : 0;
  const subject = view === "difference"
    ? `${targetSymbol} − ${benchmarkSymbol}`
    : view === "target" ? targetSymbol : benchmarkSymbol;
  const inspectedRow = selectedDate ? finiteRows.find((row) => row.date === selectedDate) : null;
  const displayedRow = inspectedRow ?? latestRow;
  const inspectedPoint = selectedDate ? rawPlotPoints.find((point) => point.date === selectedDate) : null;
  const basisLabel = basis === "context" ? "relative to each instrument's own history" : "direct model scale";
  const firstVisibleDate = visibleXSeries[0]?.date ?? null;
  const currentVisibleDate = visibleXSeries[visibleXSeries.length - 1]?.date ?? null;
  const firstSupportedIsVisibleStart = Boolean(firstPoint?.date && firstPoint.date === firstVisibleDate);
  const latestSupportedIsCurrent = Boolean(latestRow?.date && latestRow.date === currentVisibleDate);
  const reading = scopeReading({
    definition,
    row: displayedRow,
    basis,
    view,
    subject,
    targetSymbol,
    benchmarkSymbol,
  });
  const smallestSharedAxisUse = Math.min(
    selectedExtentX / Math.max(sharedExtentX, 1e-6),
    selectedExtentY / Math.max(sharedExtentY, 1e-6),
  );
  const sharedScaleCompressed = scale === "shared" && finiteRows.length > 1 && smallestSharedAxisUse < 0.18;
  const inspectedLabel = inspectedRow
    ? `Inspected ${inspectedRow.date}`
    : latestRow?.date
      ? `${latestSupportedIsCurrent ? "Latest" : "Latest supported"} ${latestRow.date}`
      : "Unavailable";
  const arrowChunkId = latestPoint
    ? [...strokeChunks].reverse().find((chunk) => chunk.sourceEnd === latestPoint.sourceIndex)?.id ?? null
    : null;
  const chipUnit = basis === "context"
    ? view === "difference" ? "own-history gap" : "vs fit median"
    : "model scale";

  const selectKeyboardPoint = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !rawPlotPoints.length) return;
    event.preventDefault();
    const selectedIndex = selectedDate
      ? rawPlotPoints.findIndex((point) => point.date === selectedDate)
      : rawPlotPoints.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? rawPlotPoints.length - 1
        : event.key === "ArrowLeft"
          ? Math.max(0, (selectedIndex >= 0 ? selectedIndex : rawPlotPoints.length - 1) - 1)
          : Math.min(rawPlotPoints.length - 1, (selectedIndex >= 0 ? selectedIndex : rawPlotPoints.length - 1) + 1);
    onSelectedDateChange(rawPlotPoints[nextIndex]?.date ?? null);
  };

  return (
    <article className="snap-start rounded-2xl border border-stealth-700 bg-slate-950/35 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{definition.title}</h3>
          <p className="mt-0.5 hidden text-[11px] leading-4 text-slate-300 sm:block">{definition.question}</p>
        </div>
        <span className="shrink-0 rounded-full border border-stealth-700 px-2 py-1 text-[10px] text-slate-300">{subject}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          [xCoordinate?.label ?? definition.x, displayedRow?.x],
          [yCoordinate?.label ?? definition.y, displayedRow?.y],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-stealth-800 bg-slate-950/55 px-2.5 py-2">
            <div className="truncate text-[9px] uppercase tracking-[0.1em] text-slate-500">{label}</div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <strong className="font-mono text-sm text-slate-100">{formatNumber(value as number | null | undefined)}</strong>
              <span className="truncate text-[9px] font-medium text-slate-400">{chipUnit}</span>
            </div>
          </div>
        ))}
      </div>
      <p data-scope-reading="true" className="mt-2 text-[10px] leading-4 text-slate-300">
        <span className="font-semibold uppercase tracking-[0.1em] text-sky-300">{inspectedLabel}</span>
        {" · "}{reading}
        {!latestSupportedIsCurrent && !inspectedRow && latestRow ? " The current visible bar is unsupported for this scope." : ""}
      </p>

      <p id={meaningId} className="sr-only">
        {inspectedLabel}. {reading}
        {!latestSupportedIsCurrent && !inspectedRow && latestRow ? " The current visible bar is unsupported for this scope." : ""}
      </p>
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="mx-auto mt-2 h-auto w-full max-w-5xl touch-none rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/40"
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
        data-scope-frame={wideFrame ? "wide" : "compact"}
        role="img"
        tabIndex={0}
        aria-describedby={`${meaningId} ${coordinateKeyId}`}
        aria-label={`${definition.title} trajectory for ${subject}, ${basisLabel}; chronological trail. ${finiteRows.length} of ${rows.length} displayed observations supported. Oldest segments are faintest and newest segments are most opaque. Latest supported date ${latestRow?.date ?? "unavailable"}, x ${formatNumber(latestRow?.x)}, y ${formatNumber(latestRow?.y)}, third coordinate used for marker size ${formatNumber(latestMarker)}. Use Left and Right arrows to inspect supported dates.`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const pointerX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * frame.width;
          const pointerY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * frame.height;
          onSelectedDateChange(nearestScopePoint(rawPlotPoints, pointerX, pointerY)?.date ?? null);
        }}
        onPointerLeave={() => onSelectedDateChange(null)}
        onKeyDown={selectKeyboardPoint}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={frame.left} y={frame.top} width={frame.right - frame.left} height={frame.bottom - frame.top} rx="6" />
          </clipPath>
          <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        </defs>
        <rect x={frame.left} y={frame.top} width={frame.right - frame.left} height={frame.bottom - frame.top} rx="6" fill="rgba(2,6,23,.3)" stroke="rgba(71,85,105,.42)" />
        <line x1={frame.left} x2={frame.right} y1={centerY} y2={centerY} stroke="rgba(100,116,139,.42)" strokeDasharray="3 5" />
        <line x1={centerX} x2={centerX} y1={frame.top} y2={frame.bottom} stroke="rgba(100,116,139,.42)" strokeDasharray="3 5" />
        {finiteRows.length ? (
          <g clipPath={`url(#${clipId})`}>
            {strokeChunks.map((chunk) => (
              <path
                key={`${definition.id}-${chunk.id}`}
                d={smoothPath(chunk.points, chunk.startIndex, chunk.endIndex)}
                fill="none"
                stroke={stroke}
                strokeOpacity={chunk.opacity}
                strokeWidth="2.1"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={chunk.dashOffset}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                markerEnd={chunk.id === arrowChunkId ? `url(#${arrowId})` : undefined}
                data-scope-trail-segment="true"
                data-source-end={chunk.sourceEnd}
                data-age-opacity={chunk.opacity.toFixed(4)}
              />
            ))}
            {firstPoint ? (
              <SeriesPointMarker view={view} x={firstPoint.x} y={firstPoint.y} stroke={stroke} size={2.7} />
            ) : null}
            {latestPoint ? (
              <SeriesPointMarker
                view={view}
                x={latestPoint.x}
                y={latestPoint.y}
                stroke={stroke}
                size={4.2 + markerMagnitude * 2.2}
                emphasized
              />
            ) : null}
            {inspectedPoint ? <circle cx={inspectedPoint.x} cy={inspectedPoint.y} r="6.5" fill="none" stroke="#f8fafc" strokeWidth="1.2" strokeDasharray="2 2" /> : null}
            {firstPoint ? (
              <text
                x={firstPoint.x < centerX ? firstPoint.x + 7 : firstPoint.x - 7}
                y={firstPoint.y > centerY ? firstPoint.y - 8 : firstPoint.y + 14}
                textAnchor={firstPoint.x < centerX ? "start" : "end"}
                fill="#64748b"
                fontSize="8"
              >
                {firstSupportedIsVisibleStart ? "START" : "FIRST SUPPORTED"}
              </text>
            ) : null}
            {latestPoint ? (
              <text
                x={latestPoint.x > centerX ? latestPoint.x - 8 : latestPoint.x + 8}
                y={latestPoint.y < centerY ? latestPoint.y + 14 : latestPoint.y - 8}
                textAnchor={latestPoint.x > centerX ? "end" : "start"}
                fill="#f8fafc"
                fontSize="9"
                fontWeight="700"
              >
                {latestSupportedIsCurrent ? "NOW" : "LATEST SUPPORTED"}
              </text>
            ) : null}
          </g>
        ) : (
          <text x={centerX} y={centerY + 4} textAnchor="middle" fill="#64748b" fontSize="11">Not enough shared support</text>
        )}
        <text x={frame.left} y={frame.xTickY} fill="#64748b" fontSize="8">{formatScopeAxisValue(-extentX, extentX)}</text>
        <text x={frame.right} y={frame.xTickY} textAnchor="end" fill="#64748b" fontSize="8">{formatScopeAxisValue(extentX, extentX)}</text>
        <text x={frame.left - 6} y={frame.top + 7} textAnchor="end" fill="#64748b" fontSize="8">{formatScopeAxisValue(extentY, extentY)}</text>
        <text x={frame.left - 6} y={frame.bottom} textAnchor="end" fill="#64748b" fontSize="8">{formatScopeAxisValue(-extentY, extentY)}</text>
        <text x={centerX} y={frame.xTitleY} textAnchor="middle" fill="#94a3b8" fontSize="10">{xCoordinate?.label ?? definition.x} →</text>
        <text x={frame.yTitleX} y={centerY} textAnchor="middle" fill="#94a3b8" fontSize="10" transform={`rotate(-90 ${frame.yTitleX} ${centerY})`}>{yCoordinate?.label ?? definition.y} →</text>
      </svg>

      <p id={coordinateKeyId} className="sr-only">
        Horizontal axis is {definition.xMeaning}. Vertical axis is {definition.yMeaning}. Marker size is the magnitude of {definition.markerMeaning}. Opacity follows age.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[9px] text-slate-500" aria-hidden="true">
          <span>Older</span>
          <span data-scope-age-key="true" className="h-0.5 w-20" style={{ backgroundImage: `linear-gradient(90deg, transparent, ${stroke})` }} />
          <span className="font-medium text-slate-300">Now</span>
        </div>
        {sharedScaleCompressed ? (
          <button
            type="button"
            onClick={() => onScaleChange("inspect")}
            className="min-h-8 rounded-md border border-amber-400/30 bg-amber-400/[0.08] px-2 text-[9px] font-medium text-amber-200 transition hover:bg-amber-400/[0.14]"
          >
            Fit trail for detail
          </button>
        ) : null}
      </div>
      <details className="group mt-2 rounded-xl border border-stealth-800 bg-slate-950/35 text-[10px] text-slate-400">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between px-3 font-medium text-slate-300">
          How to read this scope
          <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-45">+</span>
        </summary>
        <div className="space-y-1.5 border-t border-stealth-800 px-3 py-2.5 leading-4">
          <p>{definition.question}</p>
          <p><span className="font-semibold text-sky-300">{inspectedLabel}.</span> {reading}{!latestSupportedIsCurrent && !inspectedRow && latestRow ? " The current visible bar is unsupported for this scope." : ""}</p>
          <p>Horizontal: {definition.xMeaning}. Vertical: {definition.yMeaning}. Marker size: {definition.markerMeaning}{finite(latestMarker) ? ` (latest ${formatNumber(latestMarker)})` : " (unavailable)"}.</p>
          <p>{definition.caution} {scale === "shared" ? "The scale is shared across subjects." : "The scale is fit to the selected trail."}</p>
        </div>
      </details>
    </article>
  );
}

function linePath(values: Array<number | null>, width: number, top: number, height: number, extent: number): string {
  const denominator = Math.max(1, values.length - 1);
  const segments: string[] = [];
  let current: Array<{ x: number; y: number }> = [];
  const flush = () => {
    if (current.length) segments.push(smoothPath(current));
    current = [];
  };
  values.forEach((value, index) => {
    if (!finite(value)) {
      flush();
      return;
    }
    current.push({
      x: 48 + (index / denominator) * width,
      y: top + height / 2 - (value / extent) * (height * 0.42),
    });
  });
  flush();
  return segments.join(" ");
}

function scaledLanePath(
  values: Array<number | null>,
  width: number,
  top: number,
  height: number,
  centered = false,
  anchors: number[] = [],
): string {
  const finiteValues = [...values.filter(finite), ...anchors];
  if (!finiteValues.length) return "";
  const minimum = centered ? -Math.max(...finiteValues.map(Math.abs), 1e-9) : Math.min(...finiteValues);
  const maximum = centered ? Math.max(...finiteValues.map(Math.abs), 1e-9) : Math.max(...finiteValues);
  const span = Math.max(maximum - minimum, 1e-9);
  const denominator = Math.max(1, values.length - 1);
  const segments: string[] = [];
  let current: Array<{ x: number; y: number }> = [];
  const flush = () => {
    if (current.length) segments.push(smoothPath(current));
    current = [];
  };
  values.forEach((value, index) => {
    if (!finite(value)) {
      flush();
      return;
    }
    current.push({
      x: 50 + (index / denominator) * width,
      y: top + height - ((value - minimum) / span) * height,
    });
  });
  flush();
  return segments.join(" ");
}

function scaledLaneY(
  value: number,
  values: Array<number | null>,
  top: number,
  height: number,
  centered = false,
): number {
  const finiteValues = values.filter(finite);
  if (!finiteValues.length) return top + height / 2;
  const minimum = centered ? -Math.max(...finiteValues.map(Math.abs), 1e-9) : Math.min(...finiteValues);
  const maximum = centered ? Math.max(...finiteValues.map(Math.abs), 1e-9) : Math.max(...finiteValues);
  const span = Math.max(maximum - minimum, 1e-9);
  return top + height - ((value - minimum) / span) * height;
}

function lastLinePoint(
  values: Array<number | null>,
  width: number,
  top: number,
  height: number,
  extent: number,
): { x: number; y: number; index: number } | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (!finite(value)) continue;
    return {
      x: 48 + (index / Math.max(1, values.length - 1)) * width,
      y: top + height / 2 - (value / extent) * (height * 0.42),
      index,
    };
  }
  return null;
}

function unsupportedBands(
  values: boolean[],
  width: number,
  xStart: number,
): Array<{ x: number; width: number }> {
  const denominator = Math.max(1, values.length - 1);
  const step = width / denominator;
  const bands: Array<{ x: number; width: number }> = [];
  let start: number | null = null;
  values.forEach((supported, index) => {
    if (!supported && start === null) start = index;
    const closesRun = start !== null && (supported || index === values.length - 1);
    if (!closesRun || start === null) return;
    const end = supported ? index - 1 : index;
    bands.push({
      x: Math.max(xStart, xStart + start * step - step / 2),
      width: Math.max(1.5, (end - start + 1) * step),
    });
    start = null;
  });
  return bands;
}

function RelativeProgressTrace({
  data,
  selectedDate,
  onSelectedDateChange,
}: {
  data: MarketWeatherComparisonResponse;
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;
}) {
  const [lane, setLane] = useState<"relative" | "beta">("relative");
  // Keep the complete aligned sequence here so null beta rows remain visible
  // chain breaks rather than being bridged by generic point sampling.
  const rows = data.price_series;
  const relative = rows.map((point) => point.relative_index);
  const betaAdjusted = rows.map((point) => point.beta_adjusted_cumulative_return ?? null);
  const latestRelative = [...relative].reverse().find(finite);
  const latestBetaAdjusted = [...betaAdjusted].reverse().find(finite);
  const fullChainStartDates = new Set(data.price_series.flatMap((point, index) => (
    point.beta_adjusted_chain_start === true
      || (
        finite(point.beta_adjusted_cumulative_return)
        && (index === 0 || !finite(data.price_series[index - 1]?.beta_adjusted_cumulative_return))
      )
      ? [point.date]
      : []
  )));
  const chainStarts = rows.flatMap((point, index) => fullChainStartDates.has(point.date) ? [index] : []);
  const relativeStart = rows[0]?.date ?? null;
  const latestBeta = data.relative_progress.beta;
  const denominator = Math.max(1, rows.length - 1);
  const inspectedIndex = selectedDate ? rows.findIndex((row) => row.date === selectedDate) : -1;
  const inspectedRow = inspectedIndex >= 0 ? rows[inspectedIndex] : null;
  const displayedRelative = inspectedRow ? inspectedRow.relative_index : latestRelative;
  const displayedBetaAdjusted = inspectedRow ? inspectedRow.beta_adjusted_cumulative_return : latestBetaAdjusted;
  const values = lane === "relative" ? relative : betaAdjusted;
  const baseline = lane === "relative" ? 100 : 0;
  const centered = lane === "beta";
  const chartTop = 22;
  const chartHeight = 116;
  const chartWidth = 632;
  const baselineY = scaledLaneY(baseline, [...values, baseline], chartTop, chartHeight, centered);
  const displayedValue = lane === "relative" ? displayedRelative : displayedBetaAdjusted;
  const latestValue = lane === "relative" ? latestRelative : latestBetaAdjusted;
  const cursorX = inspectedIndex >= 0 ? 50 + (inspectedIndex / denominator) * chartWidth : null;
  let latestFiniteIndex = -1;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (finite(values[index])) {
      latestFiniteIndex = index;
      break;
    }
  }
  const latestX = latestFiniteIndex >= 0
    ? 50 + (latestFiniteIndex / denominator) * chartWidth
    : null;
  const latestValueDate = latestFiniteIndex >= 0 ? rows[latestFiniteIndex]?.date ?? null : null;
  const latestRowSupported = latestFiniteIndex === rows.length - 1;
  const displayedDate = inspectedRow?.date
    ?? (lane === "beta" ? latestValueDate : rows[rows.length - 1]?.date)
    ?? "Current";
  const latestStatusValue = lane === "relative"
    ? data.relative_progress.active_return_pct
    : latestBetaAdjusted;
  const latestY = finite(latestValue)
    ? scaledLaneY(latestValue, [...values, baseline], chartTop, chartHeight, centered)
    : null;

  return (
    <section className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="page-kicker">Primary evidence</span>
          <h3 className="mt-1 text-base font-semibold text-white">Relative progress</h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
            <span>{displayedDate} · {lane === "relative" ? "relative index" : "adjusted chain"} <strong className={lane === "relative" ? "text-teal-200" : "text-amber-200"}>{lane === "relative" ? finite(displayedValue) ? displayedValue.toFixed(2) : "—" : formatPercent(displayedValue)}</strong></span>
            {lane === "beta" ? <span>current β <strong className="text-slate-200">{finite(latestBeta) ? latestBeta.toFixed(2) : "—"}</strong></span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className={`rounded-full border px-2.5 py-1 font-mono text-xs ${lane === "relative" ? "border-teal-400/25 bg-teal-400/[0.06] text-teal-200" : "border-amber-400/25 bg-amber-400/[0.06] text-amber-200"}`}>
            {latestRowSupported ? "Current" : `Supported through ${latestValueDate ?? "—"}`} {data.target.symbol} vs {data.benchmark.symbol} {formatPercent(latestStatusValue)}
            {lane === "beta" && !latestRowSupported ? " · current chain unavailable" : ""}
          </span>
          <div className="inline-flex rounded-lg border border-stealth-700 bg-slate-950/60 p-0.5" role="group" aria-label="Relative progress chart">
            {(["relative", "beta"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLane(option)}
                aria-pressed={lane === option}
                className={`min-h-10 rounded-md px-3 text-[11px] font-medium sm:min-h-9 ${lane === option ? "bg-sky-400/15 text-sky-200" : "text-slate-400"}`}
              >
                {option === "relative" ? "Relative performance" : "Beta adjusted"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <svg
        viewBox="0 0 700 176"
        className="mt-2 h-[158px] w-full touch-none rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/40 sm:h-[210px]"
        role="img"
        tabIndex={0}
        aria-label={lane === "relative"
          ? `${data.target.symbol} relative price versus ${data.benchmark.symbol}, based at 100 on ${formatDate(relativeStart, data.timeframe)}; latest ${finite(latestRelative) ? latestRelative.toFixed(2) : "unavailable"}. Use Left and Right arrows to inspect shared dates.`
          : `${latestRowSupported ? "Current" : `Latest supported through ${latestValueDate ?? "an unavailable date"}`} prior-only beta-adjusted chain ${formatPercent(latestBetaAdjusted)} with ${Math.max(0, chainStarts.length - 1)} restart${Math.max(0, chainStarts.length - 1) === 1 ? "" : "s"}; zero is the comparison baseline. Use Left and Right arrows to inspect shared dates.`}
        onPointerMove={(event) => onSelectedDateChange(rows[pointerSeriesIndex(event, rows.length, 700, 50, 682)]?.date ?? null)}
        onPointerLeave={() => onSelectedDateChange(null)}
        onKeyDown={(event) => inspectLinearSeriesWithKeyboard(
          event,
          rows.map((row) => row.date),
          selectedDate,
          onSelectedDateChange,
        )}
      >
        <line x1="50" x2="682" y1={baselineY} y2={baselineY} stroke={lane === "relative" ? "rgba(45,212,191,.42)" : "rgba(251,191,36,.42)"} strokeDasharray="4 4" />
        <text x="46" y={baselineY + 3} textAnchor="end" fill={lane === "relative" ? "#5eead4" : "#fcd34d"} fontSize="10">{baseline}</text>
        {lane === "beta" ? chainStarts.map((index) => {
          const x = 50 + (index / denominator) * chartWidth;
          return (
            <g key={`chain-${index}`}>
              <title>{`${index === chainStarts[0] ? "Beta chain start" : "Beta chain restart"} on ${rows[index]?.date ?? "an unavailable date"}`}</title>
              <line x1={x} x2={x} y1="16" y2="145" stroke="rgba(251,191,36,.52)" strokeWidth="1.1" strokeDasharray="2 4" />
              <path d={`M ${x - 3.5} 18 L ${x + 3.5} 18 L ${x} 24 Z`} fill="#fbbf24" stroke="#0f172a" strokeWidth=".8" />
            </g>
          );
        }) : null}
        <path
          d={scaledLanePath(values, chartWidth, chartTop, chartHeight, centered, [baseline])}
          fill="none"
          stroke={lane === "relative" ? "#2dd4bf" : "#fbbf24"}
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
        />
        {latestX !== null && latestY !== null ? (
          <circle cx={latestX} cy={latestY} r="3.5" fill={lane === "relative" ? "#2dd4bf" : "#fbbf24"} stroke="#f8fafc" strokeWidth="1.1" />
        ) : null}
        {cursorX !== null ? <line x1={cursorX} x2={cursorX} y1="12" y2="145" stroke="rgba(248,250,252,.65)" strokeWidth="1" strokeDasharray="2 3" /> : null}
        <text x="50" y="166" fill="#64748b" fontSize="10">{relativeStart ?? ""}</text>
        <text x="682" y="166" fill="#64748b" fontSize="10" textAnchor="end">{rows[rows.length - 1]?.date ?? ""}</text>
      </svg>
      <div className="flex flex-wrap items-start justify-between gap-2 text-[10px] leading-4 text-slate-400">
        <span>{lane === "relative"
          ? <>100 marks equal progress from the shared start on {formatDate(relativeStart, data.timeframe)}.</>
          : <>Zero is the adjusted-chain baseline; triangles mark starts or resets after unavailable beta.</>}</span>
        <details className="group max-w-xl text-right">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center rounded-lg border border-stealth-700 px-2.5 text-[10px] text-slate-300 hover:border-sky-400/35 hover:text-white">
            How this is measured
          </summary>
          <p className="mt-2 rounded-lg border border-stealth-700 bg-slate-950/75 p-2.5 text-left leading-5 text-slate-400">
            Relative performance rebases the target-to-benchmark price ratio to 100 at the first exact shared observation. The adjusted view applies a beta estimated only from strictly earlier aligned returns. It is a chained descriptive comparison, does not subtract a fitted intercept, and restarts after unsupported beta rows.
          </p>
        </details>
      </div>
      <p className="sr-only">
        Latest relative index {finite(latestRelative) ? latestRelative.toFixed(2) : "unavailable"}.
        Latest cumulative beta-adjusted return {finite(latestBetaAdjusted) ? `${latestBetaAdjusted.toFixed(2)} percent` : "unavailable"}.
      </p>
    </section>
  );
}

function DimensionTrend({
  coordinate,
  basis,
  selectedDate,
  onSelectedDateChange,
  targetSymbol,
  benchmarkSymbol,
}: {
  coordinate: MarketWeatherComparisonCoordinate;
  basis: MarketWeatherComparisonBasis;
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;
  targetSymbol: string;
  benchmarkSymbol: string;
}) {
  const instanceId = useId().replace(/:/g, "");
  const rows = coordinate.series;
  const target = rows.map((point) => point.target_supported === false
    ? null
    : basis === "context" ? point.target_context ?? null : point.target);
  const benchmark = rows.map((point) => point.benchmark_supported === false
    ? null
    : basis === "context" ? point.benchmark_context ?? null : point.benchmark);
  const difference = rows.map((point) => point.target_supported === false || point.benchmark_supported === false || point.pair_supported === false
    ? null
    : basis === "context" ? point.context_difference : point.native_difference);
  const all = [...target, ...benchmark, ...difference].filter(finite);
  const extent = Math.max(...all.map(Math.abs), 1e-6);
  const targetPoint = lastLinePoint(target, 616, 12, 140, extent);
  const benchmarkPoint = lastLinePoint(benchmark, 616, 12, 140, extent);
  const differencePoint = lastLinePoint(difference, 616, 12, 140, extent);
  const supportBands = unsupportedBands(
    rows.map((point) => {
      if (
        point.target_supported === false
        || point.benchmark_supported === false
        || point.pair_supported === false
      ) return false;
      return basis === "context"
        ? finite(point.target_context)
          && finite(point.benchmark_context)
          && finite(point.context_difference)
        : finite(point.target) && finite(point.benchmark) && finite(point.native_difference);
    }),
    616,
    48,
  );
  const hatchId = `pair-unsupported-${instanceId}-${coordinate.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const guidance = COORDINATE_GUIDANCE[coordinate.id] ?? {
    definition: "Implemented coordinate from the shared 15-dimensional field recipe.",
    higher: "Higher means more of this measured quantity, not better expected performance.",
  };
  const latestRow = rows[rows.length - 1];
  const currentGap = latestRow
    ? supportedValueForPoint(latestRow, basis, "difference")
    : latestDifference(coordinate, basis);
  const alternateGap = latestRow
    ? supportedValueForPoint(latestRow, basis === "context" ? "native" : "context", "difference")
    : null;
  const currentChange = fiveBarChange(coordinate, basis);
  const inspectedIndex = selectedDate ? rows.findIndex((row) => row.date === selectedDate) : -1;
  const inspected = inspectedIndex >= 0 ? rows[inspectedIndex] : null;
  const displayedGap = inspected
    ? supportedValueForPoint(inspected, basis, "difference")
    : currentGap;
  const cursorX = inspectedIndex >= 0
    ? 48 + (inspectedIndex / Math.max(1, rows.length - 1)) * 616
    : null;
  const latestTarget = latestRow ? supportedValueForPoint(latestRow, basis, "target") : null;
  const latestBenchmark = latestRow ? supportedValueForPoint(latestRow, basis, "benchmark") : null;
  const selectedBasisAvailable = latestRow?.target_supported !== false
    && latestRow?.benchmark_supported !== false
    && latestRow?.pair_supported !== false
    && finite(currentGap);
  const endpointStatus = (point: { index: number } | null) => (
    point?.index === rows.length - 1 ? "current" : "latest-supported"
  );
  const endpointCandidates: Array<{
    label: string;
    point: { x: number; y: number; index: number } | null;
  }> = [
    { label: targetSymbol, point: targetPoint },
    { label: benchmarkSymbol, point: benchmarkPoint },
    { label: "gap", point: differencePoint },
  ];
  const staleEndpoints = endpointCandidates.flatMap(({ label, point }) => (
    point && point.index !== rows.length - 1
      ? [`${label} through ${rows[point.index]?.date ?? "an unavailable date"}`]
      : []
  ));

  return (
    <div className="self-start rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5 lg:sticky lg:top-20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-white">{coordinate.label} through shared time</div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {basis === "context" ? "Each side uses its fixed proper-fit scale on shared evaluation timestamps." : "Direct coordinate units from the same field recipe."}
          </p>
        </div>
        <span className="rounded-full border border-stealth-700 px-2 py-1 font-mono text-[10px] text-slate-300">
          {inspected?.date ? `${inspected.date} · ` : ""}gap {formatNumber(displayedGap)}
        </span>
      </div>
      <svg
        viewBox="0 0 680 170"
        className="mt-2 h-[180px] w-full touch-none rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/40"
        role="img"
        tabIndex={0}
        aria-label={`${coordinate.label} comparison history on the ${basis === "context" ? "relative-to-own-history" : "direct-model-scale"} basis. Latest ${targetSymbol} ${formatNumber(latestTarget)}, ${benchmarkSymbol} ${formatNumber(latestBenchmark)}, target-minus-benchmark gap ${formatNumber(currentGap)}; current selected-basis value ${selectedBasisAvailable ? "available" : "limited"}. Solid circle is target, dashed diamond is benchmark, dotted square is difference, and hatched periods mean the bilateral pair gap is unavailable even when one subject remains supported. Use Left and Right arrows to inspect shared dates.`}
        onPointerMove={(event) => onSelectedDateChange(rows[pointerSeriesIndex(event, rows.length, 680, 48, 664)]?.date ?? null)}
        onPointerLeave={() => onSelectedDateChange(null)}
        onKeyDown={(event) => inspectLinearSeriesWithKeyboard(
          event,
          rows.map((row) => row.date),
          selectedDate,
          onSelectedDateChange,
        )}
      >
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="6" height="6" fill="rgba(15,23,42,.72)" />
            <line x1="0" x2="0" y1="0" y2="6" stroke="rgba(148,163,184,.34)" strokeWidth="2" />
          </pattern>
        </defs>
        {supportBands.map((band, index) => (
          <rect
            key={`${hatchId}-${index}`}
            x={band.x}
            y="8"
            width={band.width}
            height="146"
            fill={`url(#${hatchId})`}
          />
        ))}
        <line x1="48" x2="664" y1="82" y2="82" stroke="rgba(100,116,139,.35)" strokeDasharray="3 5" />
        <path d={linePath(target, 616, 12, 140, extent)} fill="none" stroke="#38bdf8" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <path d={linePath(benchmark, 616, 12, 140, extent)} fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeDasharray="8 4" vectorEffect="non-scaling-stroke" />
        <path d={linePath(difference, 616, 12, 140, extent)} fill="none" stroke="#fbbf24" strokeWidth="1.7" strokeDasharray="2 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {targetPoint ? (
          <g data-series-endpoint="target" data-endpoint-status={endpointStatus(targetPoint)}>
            <title>{endpointStatus(targetPoint) === "current" ? `${targetSymbol} current endpoint` : `${targetSymbol} latest supported endpoint through ${rows[targetPoint.index]?.date ?? "an unavailable date"}`}</title>
            <SeriesPointMarker view="target" x={targetPoint.x} y={targetPoint.y} stroke="#38bdf8" size={4.1} emphasized={endpointStatus(targetPoint) === "current"} />
          </g>
        ) : null}
        {benchmarkPoint ? (
          <g data-series-endpoint="benchmark" data-endpoint-status={endpointStatus(benchmarkPoint)}>
            <title>{endpointStatus(benchmarkPoint) === "current" ? `${benchmarkSymbol} current endpoint` : `${benchmarkSymbol} latest supported endpoint through ${rows[benchmarkPoint.index]?.date ?? "an unavailable date"}`}</title>
            <SeriesPointMarker view="benchmark" x={benchmarkPoint.x} y={benchmarkPoint.y} stroke="#a78bfa" size={4.1} emphasized={endpointStatus(benchmarkPoint) === "current"} />
          </g>
        ) : null}
        {differencePoint ? (
          <g data-series-endpoint="difference" data-endpoint-status={endpointStatus(differencePoint)}>
            <title>{endpointStatus(differencePoint) === "current" ? "Pair gap current endpoint" : `Pair gap latest supported endpoint through ${rows[differencePoint.index]?.date ?? "an unavailable date"}`}</title>
            <SeriesPointMarker view="difference" x={differencePoint.x} y={differencePoint.y} stroke="#fbbf24" size={4.1} emphasized={endpointStatus(differencePoint) === "current"} />
          </g>
        ) : null}
        {cursorX !== null ? <line x1={cursorX} x2={cursorX} y1="8" y2="154" stroke="rgba(248,250,252,.65)" strokeWidth="1" strokeDasharray="2 3" /> : null}
        <text x="48" y="166" fill="#64748b" fontSize="10">{rows[0]?.date ?? ""}</text>
        <text x="664" y="166" fill="#64748b" fontSize="10" textAnchor="end">{rows[rows.length - 1]?.date ?? ""}</text>
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-white bg-sky-400 align-middle" /><i className="mr-1 inline-block h-0.5 w-3 bg-sky-400 align-middle" />{targetSymbol} · solid/circle</span>
        <span><i className="mr-1 inline-block h-2 w-2 rotate-45 border border-white bg-violet-400 align-middle" /><i className="mr-1 inline-block h-0.5 w-3 border-t-2 border-dashed border-violet-400 align-middle" />{benchmarkSymbol} · dashed/diamond</span>
        <span><i className="mr-1 inline-block h-2 w-2 border border-white bg-amber-300 align-middle" /><i className="mr-1 inline-block h-0.5 w-3 border-t-2 border-dotted border-amber-300 align-middle" />difference · dotted/square</span>
        <span><i className="mr-1 inline-block h-2 w-3 bg-[repeating-linear-gradient(135deg,rgba(148,163,184,.5)_0_1px,transparent_1px_3px)] align-middle" />pair gap unavailable · hatched</span>
      </div>
      {staleEndpoints.length ? (
        <p className="mt-1.5 text-[9px] leading-4 text-amber-200/80">
          Outlined endpoints mark latest supported values: {staleEndpoints.join("; ")}.
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-stealth-700 bg-stealth-700">
        {[
          [targetSymbol, formatNumber(latestTarget), basis === "context" ? "own history" : "model scale"],
          [benchmarkSymbol, formatNumber(latestBenchmark), basis === "context" ? "own history" : "model scale"],
          [basis === "context" ? "Own-history gap" : "Direct gap", formatNumber(currentGap), `${targetSymbol} − ${benchmarkSymbol}`],
        ].map(([label, value, note]) => (
          <div key={label} className="min-w-0 bg-slate-950/75 p-2.5">
            <div className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
            <div className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-200">{value}</div>
            <div className="mt-0.5 truncate text-[9px] text-slate-400">{note}</div>
          </div>
        ))}
      </div>
      <details className="mt-2 rounded-xl border border-stealth-700 bg-slate-950/45">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[10px] font-medium text-slate-300">
          Definition and more evidence
          <span className="text-slate-500">Expand</span>
        </summary>
        <div className="border-t border-stealth-700 p-3 text-[10px] leading-5 text-slate-400">
          <p>{guidance.definition} {guidance.higher}</p>
          <dl className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <dt>{basis === "context" ? "Direct gap" : "Own-history gap"}</dt>
              <dd className="font-mono text-slate-200">{formatNumber(alternateGap)}</dd>
            </div>
            <div>
              <dt>Five-bar change</dt>
              <dd className="font-mono text-slate-200">{formatNumber(currentChange)}</dd>
            </div>
            <div>
              <dt>Support</dt>
              <dd className="font-mono text-slate-200">{coordinate.latest.pair_supported !== false && coordinate.latest.target_supported && coordinate.latest.benchmark_supported ? "Full" : "Limited"}</dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  );
}

export default function MarketWeatherComparisonLab({
  data,
  basis,
  view,
  selectedDimension,
  tab,
  scopeTrail,
  scopeScale,
  coordinateOrder,
  onBasisChange,
  onViewChange,
  onDimensionChange,
  onTabChange,
  onScopeTrailChange,
  onScopeScaleChange,
  onCoordinateOrderChange,
}: MarketWeatherComparisonLabProps) {
  const [localTab, setLocalTab] = useState<PairTab>("overview");
  const [localTrail, setLocalTrail] = useState<ScopeTrail>(24);
  const [localScale, setLocalScale] = useState<ScopeScale>("shared");
  const [localOrder, setLocalOrder] = useState<CoordinateOrder>("recipe");
  const [activeScope, setActiveScope] = useState(SCOPE_DEFINITIONS[0].id);
  const desktopLayout = useDesktopLayout();
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [showAllCoordinates, setShowAllCoordinates] = useState(false);
  const [inspectedDate, setInspectedDate] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "quick" | "full" | "overview_link" | "current_link" | "receipt" | "error"
  >("idle");
  const pairContentRef = useRef<HTMLDivElement>(null);
  const overviewPanelRef = useRef<HTMLDivElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const renderedHashRef = useRef<string | null>(null);
  const interactiveHashRef = useRef<string | null>(null);
  const visibleOverviewHashRef = useRef<string | null>(null);
  const visibleTabsRef = useRef(new Set<string>());
  const activeTab = tab ?? localTab;
  const activeTrail = scopeTrail ?? localTrail;
  const activeScale = scopeScale ?? localScale;
  const activeOrder = coordinateOrder ?? localOrder;
  const setActiveTab = onTabChange ?? setLocalTab;
  const setActiveTrail = onScopeTrailChange ?? setLocalTrail;
  const setActiveScale = onScopeScaleChange ?? setLocalScale;
  const setActiveOrder = onCoordinateOrderChange ?? setLocalOrder;
  const coordinateMap = useMemo(
    () => new Map(data.coordinates.map((coordinate) => [coordinate.id, coordinate])),
    [data.coordinates],
  );
  const coordinateSegments = useMemo(
    () => showAllCoordinates
      ? new Map(data.coordinates.map((coordinate) => [coordinate.id, heatSegments(coordinate, basis)]))
      : new Map<string, ReturnType<typeof heatSegments>>(),
    [basis, data.coordinates, showAllCoordinates],
  );
  const summary = useMemo(() => buildMarketWeatherPairSummary(data), [data]);
  const selected = coordinateMap.get(selectedDimension) ?? data.coordinates[0];
  const fullySupported = data.coordinates.filter(
    (coordinate) => coordinate.latest.target_supported
      && coordinate.latest.benchmark_supported
      && coordinate.latest.pair_supported !== false
  ).length;
  const unsupported = data.coordinates.length - fullySupported;
  const sessionCompatibility = data.compatibility?.session.status
    ?? data.overlap.session_compatibility
    ?? (data.overlap.session_compatible === true
      ? "compatible"
      : data.overlap.session_compatible === false ? "incompatible" : "unknown");
  const sessionCertified = data.compatibility?.session.independently_certified === true;
  const alignmentSupported = data.overlap.alignment_supported !== false
    && data.overlap.alignment_status !== "unsupported";
  const gapTone = (data.relative_progress.active_return_pct ?? 0) > 0
    ? "text-emerald-300"
    : (data.relative_progress.active_return_pct ?? 0) < 0 ? "text-rose-300" : "text-slate-200";
  const chainStart = data.relative_progress.beta_adjusted_chain_start_at ?? betaChainStart(data);
  const fieldSeparation = data.relative_progress.field_separation;
  const separationLookback = fieldSeparation?.lookback_shared_observations ?? 5;
  const stretch = fieldSeparation
    ? { latest: fieldSeparation.latest_stretch, previous: fieldSeparation.prior_stretch }
    : relationshipStretchValues(data);
  const supportPct = Math.round((data.support?.support_fraction ?? data.overlap.support_fraction) * 100);
  const totalWindowCells = data.support?.total_coordinate_cells
    ?? data.overlap.total_coordinate_cells
    ?? data.coordinates.length * data.overlap.common_observations;
  const supportedWindowCells = data.support?.supported_coordinate_cells
    ?? data.overlap.supported_coordinate_cells
    ?? Math.round(totalWindowCells * (data.support?.support_fraction ?? data.overlap.support_fraction));
  const missingValuesCarried = data.support?.missing_values_carried;
  const orderedCoordinates = useMemo(() => {
    if (activeOrder === "largest") {
      return [...data.coordinates].sort((left, right) => {
        const leftValue = left.latest.pair_supported !== false
          && left.latest.target_supported
          && left.latest.benchmark_supported
          && finite(left.latest.context_difference)
          ? Math.abs(left.latest.context_difference)
          : -1;
        const rightValue = right.latest.pair_supported !== false
          && right.latest.target_supported
          && right.latest.benchmark_supported
          && finite(right.latest.context_difference)
          ? Math.abs(right.latest.context_difference)
          : -1;
        return rightValue - leftValue;
      });
    }
    return data.coordinates;
  }, [activeOrder, data.coordinates]);
  const groupedCoordinates = useMemo(
    () => FAMILY_ORDER.map((family) => ({
      family,
      coordinates: orderedCoordinates.filter((coordinate) => coordinate.family === family),
    })).filter((group) => group.coordinates.length),
    [orderedCoordinates],
  );
  const largestCoordinates = useMemo(
    () => {
      const fromSummary = summary.notableGaps
        .map((gap) => coordinateMap.get(gap.id))
        .filter((coordinate): coordinate is MarketWeatherComparisonCoordinate => Boolean(coordinate));
      if (fromSummary.length >= 3) return fromSummary.slice(0, 3);
      const observed = new Set(fromSummary.map((coordinate) => coordinate.id));
      const fallback = [...data.coordinates]
        .filter((coordinate) => (
          !observed.has(coordinate.id)
          && coordinate.latest.target_supported
          && coordinate.latest.benchmark_supported
          && coordinate.latest.pair_supported !== false
          && finite(coordinate.latest.context_difference)
        ))
        .sort((left, right) => (
          Math.abs(right.latest.context_difference ?? 0) - Math.abs(left.latest.context_difference ?? 0)
        ));
      return [...fromSummary, ...fallback].slice(0, 3);
    },
    [coordinateMap, data.coordinates, summary.notableGaps],
  );
  const relativeRead = relativeStanding(
    data.target.symbol,
    data.benchmark.symbol,
    data.relative_progress.active_return_pct,
  );
  const completeFieldCoverage = fullySupported === data.coordinates.length
    && (data.support?.all_returned_coordinate_cells_supported
      ?? supportedWindowCells === totalWindowCells);
  const coverageLabel = completeFieldCoverage
    ? "Complete field coverage"
    : `${supportPct}% field coverage · ${fullySupported}/${data.coordinates.length} current`;
  const fieldRelationshipState = relationshipStateLabel(
    fieldSeparation?.direction ?? data.relative_progress.gap_direction,
  );
  const overviewSynthesis = [
    `${relativeRead.plain} across ${data.overlap.common_observations.toLocaleString()} shared ${observationFrequency(data.timeframe)} observations.`,
    finite(data.relative_progress.beta_adjusted_return_pct)
      ? `After accounting for benchmark sensitivity estimated only from earlier returns, the current adjusted chain is ${formatPercent(data.relative_progress.beta_adjusted_return_pct)}.`
      : "A current prior-only beta-adjusted chain is unavailable.",
    finite(stretch.latest) && finite(stretch.previous)
      ? `Their own-history field distance moved from ${stretch.previous.toFixed(2)} to ${stretch.latest.toFixed(2)}, a ${fieldRelationshipState.toLowerCase()} relationship over the latest ${separationLookback} shared observations.`
      : `Their own-history field relationship is ${fieldRelationshipState.toLowerCase()}; an exact distance change is unavailable in this response.`,
    "Together these describe observed relationships, not future performance.",
  ].join(" ");
  const quickSummaryText = [
    `${data.target.symbol} vs ${data.benchmark.symbol}: ${relativeRead.plain} across ${data.overlap.common_observations.toLocaleString()} shared ${observationFrequency(data.timeframe)} observations.`,
    finite(data.relative_progress.beta_adjusted_return_pct)
      ? `Prior-only beta-adjusted chain: ${formatPercent(data.relative_progress.beta_adjusted_return_pct)} at β ${finite(data.relative_progress.beta) ? data.relative_progress.beta.toFixed(2) : "unavailable"}.`
      : "Prior-only beta-adjusted chain unavailable.",
    `Field relationship: ${fieldRelationshipState}. Descriptive comparison only; not a forecast or trade signal.`,
  ].join(" ");
  const authority = data.authority ?? data.frozen_receipt?.authority;
  const copyStatusMessage: Record<typeof copyStatus, string> = {
    idle: `Summary source: ${summary.summarySource === "server" ? "deterministic server payload" : "legacy client fallback"}.`,
    quick: "Quick summary copied.",
    full: "Full research summary copied.",
    overview_link: "Overview link copied. It will rerun against then-current data.",
    current_link: "Current page link copied. It preserves the report recipe and selected tab, then reruns against then-current data.",
    receipt: "Receipt download started.",
    error: "The requested clipboard or receipt action was unavailable.",
  };

  const selectTab = (nextTab: PairTab, moveFocus = false) => {
    setActiveTab(nextTab);
    if (moveFocus) {
      const destination = document.getElementById(`pair-tab-${nextTab}`);
      destination?.focus({ preventScroll: true });
      destination?.scrollIntoView?.({ block: "start", behavior: "auto" });
    }
  };

  const selectBasis = (nextBasis: MarketWeatherComparisonBasis) => {
    if (nextBasis !== basis) {
      trackPairEvent("pair_basis_changed", data.comparison_hash, {
        basis: nextBasis,
        previous_basis: basis,
        timeframe: data.timeframe,
      });
    }
    onBasisChange(nextBasis);
  };

  const selectDimension = (nextDimension: string) => {
    if (nextDimension !== selectedDimension) {
      trackPairEvent("pair_coordinate_selected", data.comparison_hash, {
        coordinate: nextDimension,
        basis,
        timeframe: data.timeframe,
      });
    }
    onDimensionChange(nextDimension);
  };

  const copyText = async (
    text: string,
    status: "quick" | "full" | "overview_link" | "current_link",
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(status);
      trackPairEvent(
        status === "overview_link" || status === "current_link"
          ? "pair_live_recipe_copied"
          : "pair_summary_copied",
        data.comparison_hash,
        {
          copy_type: status,
          summary_source: summary.summarySource,
          timeframe: data.timeframe,
        },
      );
    } catch {
      setCopyStatus("error");
    }
  };

  const copyOverviewLink = async () => {
    const link = new URL(window.location.href);
    link.searchParams.set("pair_tab", "overview");
    await copyText(link.toString(), "overview_link");
  };

  const copyCurrentLink = async () => {
    const link = new URL(window.location.href);
    link.searchParams.set("pair_tab", activeTab);
    await copyText(link.toString(), "current_link");
  };

  const copyFullSummary = async () => {
    await copyText(summary.copyText, "full");
  };

  const copyQuickSummary = async () => {
    await copyText(quickSummaryText, "quick");
  };

  const exportReceipt = () => {
    const receipt = data.frozen_receipt;
    if (!receipt) {
      setCopyStatus("error");
      return;
    }
    const blob = new Blob([`${JSON.stringify(receipt, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeSymbol = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-");
    link.download = `${safeSymbol(data.target.symbol)}-${safeSymbol(data.benchmark.symbol)}-${data.timeframe}-relative-field-receipt.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setCopyStatus("receipt");
    trackPairEvent("pair_receipt_exported", data.comparison_hash, {
      receipt_schema: receipt.schema_version,
      timeframe: data.timeframe,
    });
  };

  useEffect(() => {
    setShowAllCoordinates(false);
  }, [data.comparison_hash]);

  useEffect(() => {
    if (renderedHashRef.current === data.comparison_hash) return undefined;
    renderedHashRef.current = data.comparison_hash;
    const mountedAt = performance.now();
    trackPairEvent("pair_result_rendered", data.comparison_hash, {
      shared_observations: data.overlap.common_observations,
      timeframe: data.timeframe,
    });
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (interactiveHashRef.current === data.comparison_hash) return;
        interactiveHashRef.current = data.comparison_hash;
        trackPairEvent("pair_surface_second_frame", data.comparison_hash, {
          client_mount_to_second_frame_ms: Math.max(0, Math.round(performance.now() - mountedAt)),
          timeframe: data.timeframe,
        });
      });
      interactiveHashRef.current = `${data.comparison_hash}:pending:${secondFrame}`;
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [data.comparison_hash, data.overlap.common_observations, data.timeframe]);

  useEffect(() => {
    const exposureKey = `${data.comparison_hash}:${activeTab}`;
    if (activeTab === "overview" || visibleTabsRef.current.has(exposureKey)) return;
    visibleTabsRef.current.add(exposureKey);
    trackPairEvent(
      activeTab === "field" ? "pair_field_opened" : "pair_audit_opened",
      data.comparison_hash,
      { timeframe: data.timeframe },
    );
  }, [activeTab, data.comparison_hash, data.timeframe]);

  useEffect(() => {
    if (activeTab !== "overview" || visibleOverviewHashRef.current === data.comparison_hash) return undefined;
    const panel = overviewPanelRef.current;
    if (!panel) return undefined;
    const recordVisible = () => {
      if (visibleOverviewHashRef.current === data.comparison_hash) return;
      visibleOverviewHashRef.current = data.comparison_hash;
      markPairOverviewVisible(data.comparison_hash, data.timeframe);
      trackPairEvent("pair_overview_visible", data.comparison_hash, {
        timeframe: data.timeframe,
      });
    };
    if (typeof IntersectionObserver === "undefined") {
      const frame = window.requestAnimationFrame(() => {
        const rect = panel.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) recordVisible();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          recordVisible();
          observer.disconnect();
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [activeTab, data.comparison_hash, data.timeframe]);

  const mobileSheetOpen = mobileDetailOpen && !desktopLayout;

  useEffect(() => {
    const background = pairContentRef.current as (HTMLDivElement & { inert: boolean }) | null;
    if (background) background.inert = mobileSheetOpen;
    if (!mobileSheetOpen) return undefined;

    if (!previousFocusRef.current) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => mobileCloseRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileDetailOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      if (background) background.inert = false;
      const restoreTarget = previousFocusRef.current;
      previousFocusRef.current = null;
      window.requestAnimationFrame(() => restoreTarget?.focus());
    };
  }, [mobileSheetOpen]);

  useEffect(() => {
    if (desktopLayout && mobileDetailOpen) setMobileDetailOpen(false);
  }, [desktopLayout, mobileDetailOpen]);

  return (
    <>
      <div ref={pairContentRef} aria-hidden={mobileSheetOpen ? true : undefined} className="pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-0">
        <section className="primary-card overflow-hidden" aria-labelledby="pair-field-title">
      <header className="border-b border-stealth-700 p-3.5 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="page-kicker">Relative field pair</span>
              {data.provenance.identity_control ? (
                <span className="page-badge border-amber-400/20 text-amber-200">Identity control</span>
              ) : null}
            </div>
            <h2 id="pair-field-title" className="mt-1 text-xl font-semibold text-white sm:text-2xl">
              {data.target.symbol} vs {data.benchmark.symbol}
            </h2>
            <p className="mt-0.5 hidden text-sm text-slate-300 sm:block">Relative market-path comparison</p>
            <p className="mt-1 text-[10px] leading-4 text-slate-400 sm:text-[11px] sm:leading-5">
              <span className="sm:hidden">{data.overlap.common_observations.toLocaleString()} shared {observationFrequency(data.timeframe)} observations · through {formatDate(data.overlap.end, data.timeframe)}</span>
              <span className="hidden sm:inline">{data.overlap.common_observations.toLocaleString()} shared {observationFrequency(data.timeframe)} observations · {formatDate(data.overlap.start, data.timeframe)} – {formatDate(data.overlap.end, data.timeframe)}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400">
              <span className={completeFieldCoverage ? "text-emerald-200" : "text-amber-200"}>{coverageLabel}</span>
              <span aria-hidden="true" className={alignmentSupported ? "hidden sm:inline" : undefined}>·</span>
              <span className={alignmentSupported ? "hidden sm:inline" : "text-rose-200"}>
                {alignmentSupported ? "Exact date alignment" : "Alignment unsupported"}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">{sessionCompatibility === "incompatible"
                ? "Sessions incompatible"
                : sessionCertified ? "Session equivalence certified" : "Session equivalence unverified"}</span>
            </div>
          </div>
          <span className="page-badge hidden self-start border-sky-400/20 bg-sky-400/[0.05] text-sky-100 sm:inline-flex">
            Descriptive only
          </span>
        </div>
        <nav className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-stealth-700 bg-slate-950/55 p-1 sm:inline-grid sm:min-w-[420px]" role="tablist" aria-label="Relative Field sections">
          {PAIR_TAB_OPTIONS.map(({ id, label }, index) => (
            <button
              key={id}
              id={`pair-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`pair-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => selectTab(id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? PAIR_TAB_OPTIONS.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + PAIR_TAB_OPTIONS.length) % PAIR_TAB_OPTIONS.length;
                const next = PAIR_TAB_OPTIONS[nextIndex].id;
                selectTab(next);
                window.requestAnimationFrame(() => document.getElementById(`pair-tab-${next}`)?.focus());
              }}
              className={`min-h-10 rounded-lg px-3 text-xs font-medium transition sm:min-h-9 ${activeTab === id ? "bg-sky-400/15 text-sky-100 ring-1 ring-sky-400/30" : "text-slate-400 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="p-3 sm:p-4">
        {!alignmentSupported ? (
          <div role="alert" className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-950/20 p-4 text-sm text-rose-100">
            <div className="font-semibold">This timeframe pair cannot be aligned safely.</div>
            <p className="mt-1 text-xs leading-5 text-rose-200/75">{data.overlap.note} No nearest timestamp or carried value was substituted.</p>
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <div id="pair-panel-overview" role="tabpanel" aria-labelledby="pair-tab-overview" className="flex flex-col gap-3.5">
            <section className="grid gap-2.5 lg:grid-cols-[1.2fr_.9fr_.9fr]">
              <article ref={overviewPanelRef} className="rounded-2xl border border-teal-400/25 bg-gradient-to-br from-teal-400/[0.09] via-slate-950/50 to-sky-400/[0.05] p-4 sm:p-5">
                <span className="page-kicker">Relative performance</span>
                <h3 className="mt-1.5 text-lg font-semibold text-white">{relativeRead.headline}</h3>
                <div className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${gapTone}`}>
                  {formatPercent(data.relative_progress.active_return_pct)}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  From the common starting point across {data.overlap.common_observations.toLocaleString()} shared {observationFrequency(data.timeframe)} observations.
                </p>
              </article>

              <article className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-4">
                <span className="page-kicker">After beta adjustment</span>
                <div className="mt-2 font-mono text-2xl font-semibold text-sky-200">{formatPercent(data.relative_progress.beta_adjusted_return_pct)}</div>
                <p className="mt-1 text-[11px] leading-5 text-slate-300">{betaStanding(data.target.symbol, data.benchmark.symbol, data.relative_progress.beta_adjusted_return_pct)}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-400">β {finite(data.relative_progress.beta) ? data.relative_progress.beta.toFixed(2) : "—"}</p>
                <details className="mt-2 text-[10px] text-slate-400">
                  <summary className="min-h-8 cursor-pointer list-none text-sky-200">Measurement details</summary>
                  <p className="leading-5">
                    {data.relative_progress.beta_prior_observations ?? data.relative_progress.lookback_bars} strictly prior returns · chain began {formatDate(chainStart, data.timeframe)} · {data.relative_progress.beta_adjusted_chain_observations ?? "—"} supported observations · {data.relative_progress.beta_adjusted_chain_reset_count ?? 0} resets. This is not an OLS residual and does not subtract a fitted intercept.
                  </p>
                </details>
              </article>

              <article className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-4">
                <span className="page-kicker">Field relationship</span>
                <div className="mt-2 text-xl font-semibold text-amber-200">{fieldRelationshipState}</div>
                <p className="mt-1 font-mono text-sm text-slate-200">
                  {finite(stretch.previous) && finite(stretch.latest) ? `${stretch.previous.toFixed(2)} → ${stretch.latest.toFixed(2)}` : "Current comparison available"}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">Own-history distance over the latest {separationLookback} shared observations.</p>
                <details className="mt-2 text-[10px] text-slate-400">
                  <summary className="min-h-8 cursor-pointer list-none text-amber-200">Classification details</summary>
                  <p className="leading-5">
                    Family-balanced across {fieldSeparation?.compared_families ?? FAMILY_ORDER.length} measurement groups and {fieldSeparation?.compared_coordinates ?? fullySupported} supported coordinates
                    {finite(fieldSeparation?.tolerance) ? `; tolerance ${fieldSeparation.tolerance.toFixed(2)}` : ""}.
                  </p>
                </details>
              </article>
            </section>

            <section className="rounded-2xl border border-stealth-700 bg-slate-950/25 px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <p className="max-w-5xl text-sm leading-6 text-slate-300">{overviewSynthesis}</p>
                <button
                  type="button"
                  onClick={() => selectTab("audit", true)}
                  className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 self-start rounded-full border px-2.5 text-[10px] ${completeFieldCoverage ? "border-emerald-400/20 text-emerald-200" : "border-amber-400/20 text-amber-200"}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> {coverageLabel}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">Descriptive comparison only · Not a forecast or trade signal</p>
            </section>

            <RelativeProgressTrace data={data} selectedDate={inspectedDate} onSelectedDateChange={setInspectedDate} />

            <section className="rounded-2xl border border-stealth-700 bg-slate-950/25 p-3.5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <span className="page-kicker">Current context</span>
                  <h3 className="mt-1 text-sm font-semibold text-white">What is different now?</h3>
                </div>
                <p className="max-w-xl text-[10px] leading-4 text-slate-400">Higher means more of that measured quantity, not better expected performance.</p>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {summary.notableGaps.slice(0, 3).map((gap) => (
                  <button
                    key={gap.id}
                    type="button"
                    onClick={() => {
                      selectDimension(gap.id);
                      selectTab("field", true);
                    }}
                    className="group flex min-h-16 items-center justify-between gap-3 rounded-xl border border-stealth-700 bg-slate-950/45 px-3 py-2.5 text-left transition hover:border-sky-400/40 hover:bg-sky-400/[0.05]"
                  >
                    <span>
                      <span className="block text-xs font-semibold text-slate-200">{gap.label}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {gap.higherSymbol ? `${gap.higherSymbol} higher by ${Math.abs(gap.value).toFixed(2)}` : "Near equal"}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-sky-300" />
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "field" ? (
          <div id="pair-panel-field" role="tabpanel" aria-labelledby="pair-tab-field" className="flex flex-col gap-3 lg:gap-4">
            <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-3 lg:p-3.5">
              {desktopLayout ? (
                <div className="grid gap-2 lg:grid-cols-[1fr_auto_auto] lg:items-end lg:gap-3">
                  <div>
                    <span className="page-kicker">Comparison controls</span>
                    <h3 className="mt-1 text-sm font-semibold text-white">How field coordinates are displayed</h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">
                      {basis === "context"
                        ? "Own-history-relative gap: each instrument is measured against its separate frozen proper-fit history. One fit-spread unit is one stored robust fit scale—not a z-score, probability, or raw market unit."
                        : "Direct model-scale gap: target coordinate minus benchmark coordinate under the shared field recipe."}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">Comparison basis</div>
                    <div className="inline-flex rounded-xl border border-stealth-600 bg-slate-950/55 p-1" role="group" aria-label="Comparison basis">
                      {(["context", "native"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => selectBasis(option)}
                          aria-pressed={basis === option}
                          className={`min-h-9 rounded-lg px-3 text-[11px] font-medium transition ${basis === option ? "bg-teal-400/15 text-teal-200 ring-1 ring-teal-400/30" : "text-slate-400 hover:text-white"}`}
                        >
                          {option === "context" ? "Relative to own history" : "Direct model-scale gap"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">Displayed series</div>
                    <div className="inline-flex rounded-xl border border-stealth-600 bg-slate-950/55 p-1" role="group" aria-label="Displayed series">
                      {(["target", "benchmark", "difference"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => onViewChange(option)}
                          aria-pressed={view === option}
                          className={`min-h-9 rounded-lg px-3 text-[11px] font-medium transition ${view === option ? "bg-violet-400/15 text-violet-200 ring-1 ring-violet-400/30" : "text-slate-400 hover:text-white"}`}
                        >
                          {option === "target" ? data.target.symbol : option === "benchmark" ? data.benchmark.symbol : `${data.target.symbol} − ${data.benchmark.symbol}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <details>
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
                    <span>
                      <span className="page-kicker">Display</span>
                      <span className="mt-1 block text-xs font-semibold text-white">
                        {basis === "context" ? "Own history" : "Model scale"} · {view === "target" ? data.target.symbol : view === "benchmark" ? data.benchmark.symbol : `${data.target.symbol} − ${data.benchmark.symbol}`}
                      </span>
                    </span>
                    <span className="text-[10px] text-sky-200">Change</span>
                  </summary>
                  <div className="mt-2 grid gap-3 border-t border-stealth-700 pt-3">
                    <div>
                      <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">Comparison basis</div>
                      <div className="grid grid-cols-2 rounded-xl border border-stealth-600 bg-slate-950/55 p-1" role="group" aria-label="Comparison basis">
                        {(["context", "native"] as const).map((option) => (
                          <button key={option} type="button" onClick={() => selectBasis(option)} aria-pressed={basis === option} className={`min-h-10 rounded-lg px-2 text-[10px] font-medium ${basis === option ? "bg-teal-400/15 text-teal-200 ring-1 ring-teal-400/30" : "text-slate-400"}`}>
                            {option === "context" ? "Own history" : "Model scale"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">Displayed series</div>
                      <div className="grid grid-cols-3 rounded-xl border border-stealth-600 bg-slate-950/55 p-1" role="group" aria-label="Displayed series">
                        {(["target", "benchmark", "difference"] as const).map((option) => (
                          <button key={option} type="button" onClick={() => onViewChange(option)} aria-pressed={view === option} className={`min-h-10 rounded-lg px-2 text-[10px] font-medium ${view === option ? "bg-violet-400/15 text-violet-200 ring-1 ring-violet-400/30" : "text-slate-400"}`}>
                            {option === "target" ? data.target.symbol : option === "benchmark" ? data.benchmark.symbol : "Difference"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] leading-4 text-slate-400">
                      {basis === "context" ? "Each instrument is compared with its own frozen history." : "Both instruments use the direct model scale."}
                    </p>
                  </div>
                </details>
              )}
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <span className="page-kicker">Relationship scopes</span>
                  <h3 className="mt-1 text-base font-semibold text-white">How the paired field is moving</h3>
                </div>
                <div className="hidden flex-wrap gap-2 sm:flex">
                  <div className="inline-flex rounded-lg border border-stealth-700 bg-slate-950/50 p-0.5" role="group" aria-label="Scope trail length">
                    {([12, 24, 72, "full"] as const).map((option) => (
                      <button key={option} type="button" onClick={() => setActiveTrail(option)} aria-pressed={activeTrail === option} className={`min-h-10 rounded-md px-2.5 text-[10px] ${activeTrail === option ? "bg-sky-400/15 text-sky-200" : "text-slate-400"}`}>
                        {option === "full" ? "Full" : option}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex rounded-lg border border-stealth-700 bg-slate-950/50 p-0.5" role="group" aria-label="Scope scale">
                    {(["shared", "inspect"] as const).map((option) => (
                      <button key={option} type="button" onClick={() => setActiveScale(option)} aria-pressed={activeScale === option} className={`min-h-10 rounded-md px-2.5 text-[10px] ${activeScale === option ? "bg-amber-400/15 text-amber-200" : "text-slate-400"}`}>
                        {option === "shared" ? "Compare subjects" : "Fit selected trail"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mb-2 text-[10px] leading-4 text-slate-400">
                Endpoints identify the first and latest supported states; START and NOW appear only when those window edges are supported. Hover, touch, or use arrow keys to inspect the same shared date{inspectedDate ? ` (${inspectedDate})` : ""}.
              </p>
              <details className="mb-2 rounded-xl border border-stealth-700 bg-slate-950/35 sm:hidden">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[10px] font-medium text-slate-300">
                  Trail {activeTrail === "full" ? "full" : activeTrail} · {activeScale === "shared" ? "compare subjects" : "fit selected trail"}
                  <span className="text-slate-500">Adjust</span>
                </summary>
                <div className="flex flex-wrap gap-2 border-t border-stealth-700 p-2">
                  <div className="inline-flex rounded-lg border border-stealth-700 bg-slate-950/50 p-0.5" role="group" aria-label="Scope trail length">
                    {([12, 24, 72, "full"] as const).map((option) => (
                      <button key={option} type="button" onClick={() => setActiveTrail(option)} aria-pressed={activeTrail === option} className={`min-h-10 rounded-md px-2.5 text-[10px] ${activeTrail === option ? "bg-sky-400/15 text-sky-200" : "text-slate-400"}`}>
                        {option === "full" ? "Full" : option}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex rounded-lg border border-stealth-700 bg-slate-950/50 p-0.5" role="group" aria-label="Scope scale">
                    {(["shared", "inspect"] as const).map((option) => (
                      <button key={option} type="button" onClick={() => setActiveScale(option)} aria-pressed={activeScale === option} className={`min-h-10 rounded-md px-2.5 text-[10px] ${activeScale === option ? "bg-amber-400/15 text-amber-200" : "text-slate-400"}`}>
                        {option === "shared" ? "Compare subjects" : "Fit trail"}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
              <div className="mb-2 grid grid-cols-2 gap-1 sm:grid-cols-4" role="group" aria-label="Relationship scope">
                {SCOPE_DEFINITIONS.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => setActiveScope(definition.id)}
                    aria-pressed={activeScope === definition.id}
                    className={`min-h-10 rounded-lg border px-2 text-[10px] transition ${activeScope === definition.id ? "border-sky-400/45 bg-sky-400/[0.08] text-sky-100" : "border-stealth-700 text-slate-400 hover:text-white"}`}
                  >
                    {definition.title}
                  </button>
                ))}
              </div>
              <div>
                {SCOPE_DEFINITIONS.filter((definition) => definition.id === activeScope).map((definition) => (
                  <ScopeChart
                    key={definition.id}
                    definition={definition}
                    coordinates={coordinateMap}
                    basis={basis}
                    view={view}
                    trail={activeTrail}
                    scale={activeScale}
                    selectedDate={inspectedDate}
                    onSelectedDateChange={setInspectedDate}
                    onScaleChange={setActiveScale}
                    targetSymbol={data.target.symbol}
                    benchmarkSymbol={data.benchmark.symbol}
                  />
                ))}
              </div>
            </section>

            <section aria-labelledby="pair-coordinate-section-title">
              <div className="mb-2">
                <span className="page-kicker">Selected coordinate</span>
                <h3 id="pair-coordinate-section-title" className="mt-1 text-base font-semibold text-white">
                  <span className="lg:hidden">Review the largest differences</span>
                  <span className="hidden lg:inline">Inspect one measurement, then expand the field</span>
                </h3>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)] lg:items-start">
                {selected ? (
                  <>
                    {desktopLayout ? <div>
                      <DimensionTrend
                        coordinate={selected}
                        basis={basis}
                        selectedDate={inspectedDate}
                        onSelectedDateChange={setInspectedDate}
                        targetSymbol={data.target.symbol}
                        benchmarkSymbol={data.benchmark.symbol}
                      />
                    </div> : null}
                    <button
                      type="button"
                      onClick={(event) => {
                        previousFocusRef.current = event.currentTarget;
                        setMobileDetailOpen(true);
                      }}
                      className="inline-flex min-h-11 items-center justify-between gap-3 rounded-xl border border-sky-400/25 bg-sky-400/[0.06] px-3 text-left text-xs text-sky-100 lg:hidden"
                    >
                      <span>Inspect {selected.label}</span>
                      <span className="font-mono text-[10px] text-sky-200">gap {formatNumber(latestDifference(selected, basis))}</span>
                    </button>
                  </>
                ) : (
                  <div className="grid min-h-[160px] place-items-center rounded-2xl border border-stealth-700 text-sm text-slate-400">No comparable coordinates were returned.</div>
                )}

                <div className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-3 lg:p-3.5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <span className="page-kicker">15-coordinate explorer</span>
                      <h3 className="mt-1 text-sm font-semibold text-white">
                        {showAllCoordinates ? "All field measurements" : "Largest current differences"}
                      </h3>
                      <p className="mt-1 text-[10px] leading-4 text-slate-400">
                        {showAllCoordinates
                          ? `${basis === "context" ? "Own-history" : "Direct model-scale"} values · ${data.target.symbol} − ${data.benchmark.symbol}`
                          : "The same supported own-history ranking used in the Overview."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAllCoordinates((current) => !current)}
                      aria-expanded={showAllCoordinates}
                      aria-controls="pair-coordinate-explorer-list"
                      className="inline-flex min-h-10 items-center rounded-xl border border-stealth-600 px-3 text-[10px] text-slate-300 transition hover:border-sky-400/45 hover:text-white"
                    >
                      {showAllCoordinates ? "Show top 3" : `Show all ${data.coordinates.length} coordinates`}
                    </button>
                  </div>

                  {showAllCoordinates ? (
                    <div className="mt-3 inline-flex rounded-lg border border-stealth-700 bg-slate-950/55 p-0.5" role="group" aria-label="Coordinate ordering">
                      {(["recipe", "largest"] as const).map((option) => (
                        <button key={option} type="button" onClick={() => setActiveOrder(option)} aria-pressed={activeOrder === option} className={`min-h-10 rounded-md px-3 text-[10px] sm:min-h-8 ${activeOrder === option ? "bg-violet-400/15 text-violet-200" : "text-slate-400"}`}>
                          {option === "recipe" ? "Recipe order" : "Largest gaps first"}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div id="pair-coordinate-explorer-list" className="mt-3 space-y-3">
                    {(showAllCoordinates
                      ? groupedCoordinates
                      : [{ family: "largest", coordinates: largestCoordinates }]
                    ).map((group) => (
                      <section key={group.family} aria-labelledby={`pair-coordinate-family-${group.family}`}>
                        <h4 id={`pair-coordinate-family-${group.family}`} className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          {group.family === "largest" ? "Largest own-history differences" : FAMILY_LABELS[group.family] ?? group.family}
                        </h4>
                        <div className="space-y-1">
                          {group.coordinates.map((coordinate) => {
                            const displayedBasis: MarketWeatherComparisonBasis = showAllCoordinates ? basis : "context";
                            const currentDifference = latestDifference(coordinate, displayedBasis);
                            const supported = coordinate.latest.target_supported
                              && coordinate.latest.benchmark_supported
                              && coordinate.latest.pair_supported !== false
                              && finite(currentDifference);
                            const active = coordinate.id === selected?.id;
                            const directionNotch = finite(currentDifference)
                              ? currentDifference > 0 ? "→" : currentDifference < 0 ? "←" : "•"
                              : "×";
                            const segments = showAllCoordinates
                              ? coordinateSegments.get(coordinate.id) ?? []
                              : heatSegments(coordinate, "context");
                            return (
                              <button
                                key={coordinate.id}
                                type="button"
                                onClick={(event) => {
                                  selectDimension(coordinate.id);
                                  if (typeof window !== "undefined" && window.innerWidth < 640) {
                                    previousFocusRef.current = event.currentTarget;
                                    setMobileDetailOpen(true);
                                  }
                                }}
                                aria-pressed={active}
                                aria-label={`${coordinate.label}; ${displayedBasis === "context" ? "relative-to-own-history" : "direct-model-scale"} target-minus-benchmark gap ${supported ? formatNumber(currentDifference) : "limited"}; current direction ${directionNotch === "→" ? "target higher" : directionNotch === "←" ? "benchmark higher" : directionNotch === "•" ? "near equal" : "unsupported"}; selected-basis value ${supported ? "available" : "limited"}.`}
                                className={`grid min-h-10 w-full grid-cols-[104px_minmax(80px,1fr)_58px] items-center gap-2 rounded-lg border px-2 text-left transition sm:grid-cols-[138px_minmax(100px,1fr)_66px] ${active ? "border-sky-400/50 bg-sky-400/[0.08]" : "border-transparent hover:border-stealth-600 hover:bg-white/[0.025]"}`}
                              >
                                <span className="min-w-0 truncate text-[11px] font-medium leading-3.5 text-slate-200">{coordinate.label}</span>
                                <span className="relative flex h-7 min-w-0 overflow-hidden rounded border border-white/[0.08] bg-slate-950/75" aria-hidden="true">
                                  {segments.map((segment, index) => (
                                    <i key={`${coordinate.id}-segment-${index}`} className="relative min-w-px flex-1">
                                      {segment.supported ? (
                                        <i
                                          className="absolute inset-x-0 min-h-px"
                                          style={{
                                            backgroundColor: segment.color,
                                            height: `${Math.max(12, segment.magnitude * 80)}%`,
                                            ...(finite(segment.value) && segment.value < 0
                                              ? { top: "50%" }
                                              : { bottom: "50%" }),
                                          }}
                                        />
                                      ) : (
                                        <i
                                          className="absolute inset-0"
                                          style={{
                                            backgroundColor: segment.color,
                                            backgroundImage: "repeating-linear-gradient(135deg, rgba(226,232,240,.38) 0 1px, transparent 1px 4px)",
                                          }}
                                        />
                                      )}
                                    </i>
                                  ))}
                                  <i className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-px bg-slate-200/45" />
                                  <i className="pointer-events-none absolute inset-y-0 right-0 grid w-5 place-items-center bg-slate-950/55 text-[11px] not-italic text-white shadow-[-4px_0_8px_rgba(2,6,23,.45)]">
                                    {directionNotch}
                                  </i>
                                </span>
                                <span className={`text-right font-mono text-[10px] ${supported ? "text-slate-300" : "text-amber-300"}`}>
                                  {supported ? formatNumber(currentDifference) : "limited"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2.5 text-[11px] leading-5 text-amber-100/80">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>Positive coordinate gaps mean more of that measured quantity in the target—not higher quality, a forecast, or a trade signal.</div>
            </div>
          </div>
        ) : null}

        {activeTab === "audit" ? (
          <div id="pair-panel-audit" role="tabpanel" aria-labelledby="pair-tab-audit" className="space-y-3">
            <section className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.04] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <span className="page-kicker">Share and evidence</span>
                  <h3 className="mt-1 text-base font-semibold text-white">Reuse the reading, rerun the recipe, or preserve the compact receipt</h3>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    Text copies are human-readable. Links rerun against then-current data. The compact JSON preserves aligned keys, latest measurements, support, identities, and the zero-authority boundary—without full chart histories.
                  </p>
                  {data.frozen_receipt ? (
                    <p className="mt-2 font-mono text-[10px] text-slate-500">
                      evidence through {data.frozen_receipt.frozen_as_of ?? data.overlap.end ?? "—"} · {data.frozen_receipt.schema_version} · checksum {data.frozen_receipt.receipt_hash.slice(0, 12)}…
                    </p>
                  ) : (
                    <p className="mt-2 text-[10px] text-amber-300">Compact receipt unavailable for this response; reanalyze to request a current receipt.</p>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:max-w-[560px]">
                  <button type="button" onClick={() => void copyQuickSummary()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">
                    <ClipboardCopy className="h-4 w-4" /> Copy quick summary
                  </button>
                  <button type="button" onClick={() => void copyFullSummary()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">
                    <ClipboardCopy className="h-4 w-4" /> Copy full research summary
                  </button>
                  <button type="button" onClick={() => void copyOverviewLink()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">
                    <ClipboardCopy className="h-4 w-4" /> Copy overview link
                  </button>
                  <button type="button" onClick={() => void copyCurrentLink()} aria-describedby="pair-current-link-limit" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">
                    <ClipboardCopy className="h-4 w-4" /> Copy current page link
                  </button>
                  <button
                    type="button"
                    onClick={exportReceipt}
                    disabled={!data.frozen_receipt}
                    aria-describedby="pair-receipt-limit"
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2"
                  >
                    <Download className="h-4 w-4" /> Export compact receipt · JSON
                  </button>
                </div>
              </div>
              <p id="pair-receipt-limit" className="mt-3 text-[10px] leading-4 text-slate-500">
                The receipt checksum detects mutation; it is not a digital signature, proof of origin, provider attestation, or bar-completeness certification.
              </p>
              <p id="pair-current-link-limit" className="mt-1 text-[10px] leading-4 text-slate-500">
                Current page links preserve the report recipe and selected tab. Local chart-lane, scope-card, and coordinate-expansion toggles reset when reopened.
              </p>
              <p className={`mt-2 text-[10px] ${copyStatus === "error" ? "text-rose-300" : "text-slate-400"}`} role="status" aria-live="polite">
                {copyStatusMessage[copyStatus]}
              </p>
            </section>

            <div className="space-y-2">
              <AuditGroup
                code="A"
                title="Data alignment"
                summary={`${data.overlap.common_observations.toLocaleString()} exact shared observations · ${formatDate(data.overlap.start, data.timeframe)} – ${formatDate(data.overlap.end, data.timeframe)}`}
                initiallyOpen={!alignmentSupported}
              >
                <dl className="grid gap-x-6 gap-y-2 text-[10px] text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Requested observations", String(data.window?.requested_shared_observations ?? data.overlap.common_observations)],
                    ["Returned exact shared", String(data.window?.returned_exact_shared_observations ?? data.overlap.common_observations)],
                    ["Latest aligned", formatDate(data.overlap.latest_aligned_at, data.timeframe)],
                    [`${data.target.symbol} aligned close`, formatLevel(data.relative_progress.latest_target_close)],
                    [`${data.benchmark.symbol} aligned close`, formatLevel(data.relative_progress.latest_benchmark_close)],
                    [`${data.target.symbol} unmatched`, String(data.overlap.target_dropped)],
                    [`${data.benchmark.symbol} unmatched`, String(data.overlap.benchmark_dropped)],
                    ["Alignment rule", data.overlap.alignment_rule ?? "exact shared key"],
                  ].map(([label, value], index) => <div key={`${index}-${label}`}><dt>{label}</dt><dd className="mt-0.5 text-slate-200">{value}</dd></div>)}
                </dl>
                <p className="mt-3 text-[10px] leading-5 text-slate-400">Exact shared keys only. No price or coordinate was forward-filled, interpolated, or nearest-neighbor matched.</p>
              </AuditGroup>

              <AuditGroup code="B" title="Field support" summary={`${supportPct}% window cells · ${fullySupported}/${data.coordinates.length} current coordinates`}>
                <dl className="grid gap-x-6 gap-y-2 text-[10px] text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Supported coordinate cells", supportedWindowCells.toLocaleString()],
                    ["Total coordinate cells", totalWindowCells.toLocaleString()],
                    ["Current bilateral coordinates", `${fullySupported} / ${data.coordinates.length}`],
                    ["Support rule", data.support?.support_rule ?? "bilateral full dependency support"],
                    ["Missing values carried", missingValuesCarried === false ? "No" : missingValuesCarried === true ? "Yes" : "Not reported"],
                    ["Latest unsupported", String(unsupported)],
                  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-0.5 text-slate-200">{value}</dd></div>)}
                </dl>
              </AuditGroup>

              <AuditGroup code="C" title="Beta calculation" summary={`prior-only β ${finite(data.relative_progress.beta) ? data.relative_progress.beta.toFixed(2) : "unavailable"} · ${data.relative_progress.beta_adjusted_chain_reset_count ?? 0} resets`}>
                <dl className="grid gap-x-6 gap-y-2 text-[10px] text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Configured lookback", String(data.relative_progress.beta_configured_lookback_returns ?? data.relative_progress.lookback_bars)],
                    ["Minimum prior returns", String(data.relative_progress.beta_minimum_prior_returns ?? "—")],
                    ["Actual prior returns", String(data.relative_progress.beta_prior_observations ?? "—")],
                    ["Current beta", finite(data.relative_progress.beta) ? data.relative_progress.beta.toFixed(4) : "Unavailable"],
                    ["Chain start", formatDate(chainStart, data.timeframe)],
                    ["Chain end", formatDate(data.relative_progress.beta_adjusted_chain_end_at ?? data.overlap.end, data.timeframe)],
                    ["Chain observations", String(data.relative_progress.beta_adjusted_chain_observations ?? "—")],
                    ["Chain resets", String(data.relative_progress.beta_adjusted_chain_reset_count ?? 0)],
                  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-0.5 text-slate-200">{value}</dd></div>)}
                </dl>
                <p className="mt-3 text-[10px] leading-5 text-slate-400">Each beta estimate uses only strictly earlier aligned returns. The chain does not subtract a fitted intercept, is not an OLS residual, and restarts after unavailable beta rows.</p>
              </AuditGroup>

              <AuditGroup code="D" title="Compatibility" summary={`${sessionCompatibility.replace(/_/g, " ")} sessions · ${sessionCertified ? "certified" : "not independently certified"}`}>
                <dl className="grid gap-x-6 gap-y-2 text-[10px] text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Session status", data.compatibility?.session.status ?? sessionCompatibility],
                    ["Session basis", data.compatibility?.session.basis ?? "Response contract"],
                    ["Currency", data.compatibility?.currency.status ?? "Unknown"],
                    ["Price adjustment", data.compatibility?.price_adjustment.status ?? "Provider as returned"],
                    ["Timestamp status", data.compatibility?.timestamp_alignment.status ?? (alignmentSupported ? "Supported" : "Unsupported")],
                    ["Timezone metadata", data.compatibility?.timestamp_alignment.timezone_status ?? (data.compatibility?.timestamp_alignment.timezone_metadata_available ? "Available" : "Unavailable")],
                    ["Session certification", sessionCertified ? "Independent" : "Not independent"],
                    ["Adjustment certification", data.compatibility?.price_adjustment.independently_certified ? "Independent" : "Not independent"],
                  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-0.5 capitalize text-slate-200">{String(value).replace(/_/g, " ")}</dd></div>)}
                </dl>
              </AuditGroup>

              <AuditGroup code="E" title="Identity and authority" summary="Ordered hashes · research display only · no decision authority">
                <p className="text-[11px] leading-5 text-slate-400">{data.provenance.note}</p>
                <dl className="mt-3 grid gap-2 font-mono text-[10px] text-slate-400">
                  <div><dt>Comparison hash</dt><dd className="break-all text-slate-300">{data.comparison_hash}</dd></div>
                  <div><dt>Target analysis hash</dt><dd className="break-all text-slate-300">{data.target.analysis_hash}</dd></div>
                  <div><dt>Benchmark analysis hash</dt><dd className="break-all text-slate-300">{data.benchmark.analysis_hash}</dd></div>
                  {data.provenance.component_recipe_hash ? <div><dt>Component recipe hash</dt><dd className="break-all text-slate-300">{data.provenance.component_recipe_hash}</dd></div> : null}
                  {data.frozen_receipt?.receipt_hash ? <div><dt>Receipt checksum</dt><dd className="break-all text-slate-300">{data.frozen_receipt.receipt_hash}</dd></div> : null}
                </dl>
                {data.provenance.identity_control ? <p className="mt-3 text-[10px] text-amber-300">Same-analysis identity control: every bilaterally supported signed difference should be zero.</p> : null}
                <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.045] p-3 text-[10px] leading-5 text-amber-100/80">
                  Pair comparison is research display only. Scanner weight {authority?.scanner_weight ?? 0}%; pair option-learning weight {authority?.option_learning_weight ?? 0}%; veto {authority?.veto ? "enabled" : "disabled"}; sizing {authority?.sizing ? "enabled" : "disabled"}; execution {authority?.execution ? "enabled" : "disabled"}.
                </div>
              </AuditGroup>

              <AuditGroup code="F" title="Methodology" summary="Definitions, chronology, evidence limits, and operational metadata">
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    ["Relative index", "Target divided by benchmark, rebased to 100 at the first exact shared observation. It measures observed relative progress."],
                    ["Direct model-scale gap", "Target coordinate minus benchmark coordinate on the implemented 15-dimensional recipe scale, not raw market units."],
                    ["Relative to own history", "Each coordinate is measured against its instrument's separate frozen proper-fit median and robust scale, then differenced on shared evaluation timestamps."],
                    ["Prior-only beta adjustment", "A chained price comparison using beta estimated from strictly prior aligned returns, with explicit breaks and restarts."],
                    ["Field relationship", `Family-balanced mean absolute own-history distance compared with ${separationLookback} shared observations earlier on the same supported-coordinate intersection.`],
                    ["Evidence boundary", "Exact date alignment does not independently prove exchange-session equivalence, provider truth, or complete economic simultaneity."],
                  ].map(([title, body]) => (
                    <article key={title} className="rounded-xl border border-stealth-700 bg-slate-950/45 p-3">
                      <h4 className="text-[11px] font-semibold text-slate-200">{title}</h4>
                      <p className="mt-1 text-[10px] leading-5 text-slate-400">{body}</p>
                    </article>
                  ))}
                </div>
                {data.caveats.length ? (
                  <div className="mt-3">
                    <h4 className="text-[11px] font-semibold text-slate-200">Response-specific caveats</h4>
                    <ul className="mt-1 grid gap-1 text-[10px] leading-5 text-slate-400 md:grid-cols-2 md:gap-x-6">{data.caveats.map((caveat) => <li key={caveat}>• {caveat}</li>)}</ul>
                  </div>
                ) : null}
                <dl className="mt-3 grid gap-2 border-t border-stealth-700 pt-3 text-[10px] text-slate-400 sm:grid-cols-3">
                  <div><dt>Generated</dt><dd className="mt-0.5 text-slate-300">{data.generated_at ? formatDate(data.generated_at, data.timeframe) : "Not reported"}</dd></div>
                  <div><dt>Analysis cache</dt><dd className="mt-0.5 text-slate-300">{data.cache?.analysis?.status ?? data.runtime?.cache.status ?? "Not reported"}</dd></div>
                  <div><dt>Backend response-ready</dt><dd className="mt-0.5 text-slate-300">{data.runtime ? formatMilliseconds(data.runtime.response.handler_to_response_ready_ms) : "Not measured"}</dd></div>
                </dl>
                <p className="mt-2 text-[9px] leading-4 text-slate-500">Runtime excludes browser paint; analytical identities exclude cache and timing metadata.</p>
              </AuditGroup>
            </div>
          </div>
        ) : null}
        </div>
      </section>
        <aside
          className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-[180] rounded-2xl border border-sky-400/25 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl lg:hidden"
          aria-label="Research next"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Research next</div>
              <div className="truncate text-[10px] text-slate-300">
                {activeTab === "overview"
                  ? !alignmentSupported
                    ? "Alignment needs review"
                    : largestCoordinates[0]
                      ? `${largestCoordinates[0].label} is the largest current field difference`
                      : "Review the available data support"
                  : activeTab === "field"
                    ? `${selected?.label ?? "Coordinate"} is selected`
                    : data.frozen_receipt ? "Preserve the compact evidence receipt" : "Return to the concise reading"}
              </div>
            </div>
            <button
              type="button"
              disabled={activeTab === "field" && !selected}
              onClick={(event) => {
                if (activeTab === "overview") {
                  if (!alignmentSupported || !largestCoordinates[0]) {
                    selectTab("audit", true);
                    return;
                  }
                  const nextCoordinate = largestCoordinates[0];
                  if (nextCoordinate) selectDimension(nextCoordinate.id);
                  selectTab(nextCoordinate ? "field" : "audit", true);
                  return;
                }
                if (activeTab === "field") {
                  previousFocusRef.current = event.currentTarget;
                  setMobileDetailOpen(true);
                  return;
                }
                if (data.frozen_receipt) exportReceipt();
                else selectTab("overview", true);
              }}
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-400 px-3 text-[10px] font-semibold text-slate-950 disabled:opacity-40"
              aria-controls={activeTab === "overview"
                ? alignmentSupported && largestCoordinates[0] ? "pair-panel-field" : "pair-panel-audit"
                : activeTab === "field" ? "pair-mobile-coordinate-dialog" : undefined}
              aria-haspopup={activeTab === "field" ? "dialog" : undefined}
            >
              {activeTab === "overview"
                ? !alignmentSupported ? "Review limits" : largestCoordinates[0] ? `Inspect ${largestCoordinates[0].label}` : "Review data support"
                : activeTab === "field" ? `Inspect ${selected?.label ?? "coordinate"}`
                  : data.frozen_receipt ? "Export receipt" : "View overview"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <nav className="mt-1.5 grid grid-cols-3 gap-1" aria-label="Pair sections">
            {PAIR_TAB_OPTIONS.map((option) => (
              <button
                key={`mobile-rail-${option.id}`}
                type="button"
                onClick={() => selectTab(option.id, true)}
                aria-pressed={activeTab === option.id}
                aria-controls={`pair-panel-${option.id}`}
                className={`min-h-8 rounded-lg text-[9px] font-medium ${activeTab === option.id ? "bg-white/[0.08] text-white" : "text-slate-500"}`}
              >
                {option.label}
              </button>
            ))}
          </nav>
        </aside>
      </div>
      {mobileSheetOpen && selected ? (
        <div
            className="fixed inset-0 z-[300] flex items-end bg-slate-950/75 p-2 backdrop-blur-sm lg:hidden"
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) setMobileDetailOpen(false);
          }}
        >
          <div
            id="pair-mobile-coordinate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pair-mobile-coordinate-title"
            className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-stealth-600 bg-slate-900 p-2 shadow-2xl"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMobileDetailOpen(false);
                return;
              }
              if (event.key !== "Tab") return;
              const focusable = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
              ).filter((element) => element.getAttribute("aria-hidden") !== "true");
              if (!focusable.length) {
                event.preventDefault();
                return;
              }
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-2xl bg-slate-900/95 px-2 py-2 backdrop-blur">
              <div>
                <div className="page-kicker text-slate-400">Selected coordinate</div>
                <h3 id="pair-mobile-coordinate-title" className="mt-0.5 text-sm font-semibold text-white">{selected.label}</h3>
              </div>
              <button
                ref={mobileCloseRef}
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-stealth-600 text-slate-300"
                aria-label="Close coordinate detail"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <DimensionTrend
              coordinate={selected}
              basis={basis}
              selectedDate={inspectedDate}
              onSelectedDateChange={setInspectedDate}
              targetSymbol={data.target.symbol}
              benchmarkSymbol={data.benchmark.symbol}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
