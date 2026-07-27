import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileCheck2,
  Info,
  ShieldCheck,
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
  description: string;
  x: string;
  y: string;
  color: string;
}

const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  {
    id: "direction",
    title: "Directional phase",
    description: "Pressure × velocity; the current-point halo reflects Structure.",
    x: "pressure",
    y: "velocity",
    color: "structure",
  },
  {
    id: "higher_motion",
    title: "Higher motion",
    description: "Acceleration × jerk; the current-point halo reflects Snap.",
    x: "acceleration",
    y: "jerk",
    color: "snap",
  },
  {
    id: "organization",
    title: "Structure & information",
    description: "Structure × information; the current-point halo reflects Kinematics.",
    x: "structure",
    y: "information",
    color: "kinematics",
  },
  {
    id: "propagation",
    title: "Propagation & carriers",
    description: "Propagation × cascade bias; the current-point halo reflects Liquidity Stress.",
    x: "propagation",
    y: "cascade_bias",
    color: "liquidity_stress_carrier",
  },
];

const FAMILY_LABELS: Record<string, string> = {
  pressure_state: "Motion",
  field_transform: "Field",
  ohlcv_carrier: "Carrier",
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

function separationLabel(value: string): string {
  if (value === "widening") return "Field separation widening";
  if (value === "converging") return "Field separation narrowing";
  if (value === "mixed") return "No clear net change";
  return "Insufficient shared support";
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

function latestRelativeIndex(data: MarketWeatherComparisonResponse): number | null {
  for (let index = data.price_series.length - 1; index >= 0; index -= 1) {
    const value = data.price_series[index]?.relative_index;
    if (finite(value)) return value;
  }
  return null;
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
  const currentValue = basis === "context" ? current?.context_difference : current?.native_difference;
  const previousValue = basis === "context" ? previous?.context_difference : previous?.native_difference;
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

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}

function downsample<T>(values: T[], maximum = 120): T[] {
  if (values.length <= maximum) return values;
  const result: T[] = [];
  for (let index = 0; index < maximum; index += 1) {
    result.push(values[Math.round(index * (values.length - 1) / (maximum - 1))]);
  }
  return result;
}

function downsampleNullable(values: Array<number | null>, maximum = 180): Array<number | null> {
  if (values.length <= maximum) return values;
  const result: Array<number | null> = [];
  for (let index = 0; index < maximum; index += 1) {
    const start = Math.floor(index * values.length / maximum);
    const end = Math.max(start + 1, Math.floor((index + 1) * values.length / maximum));
    const bucket = values.slice(start, end);
    const finiteBucket = bucket.filter(finite);
    result.push(
      finiteBucket.length === bucket.length && finiteBucket.length
        ? finiteBucket.reduce((sum, value) => sum + value, 0) / finiteBucket.length
        : null,
    );
  }
  return result;
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

function ScopeChart({
  definition,
  coordinates,
  basis,
  view,
  trail,
  scale,
  selectedDate,
  onSelectedDateChange,
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
  targetSymbol: string;
  benchmarkSymbol: string;
}) {
  const xCoordinate = coordinates.get(definition.x);
  const yCoordinate = coordinates.get(definition.y);
  const colorCoordinate = coordinates.get(definition.color);
  const visibleXSeries = useMemo(
    () => trail === "full" ? xCoordinate?.series ?? [] : xCoordinate?.series.slice(-trail) ?? [],
    [trail, xCoordinate],
  );
  const rows = useMemo<Array<{ date: string; x: number; y: number; color: number | null } | null>>(() => {
    if (!xCoordinate || !yCoordinate) return [];
    const yByDate = new Map(yCoordinate.series.map((point) => [point.date, point]));
    const colorByDate = new Map(colorCoordinate?.series.map((point) => [point.date, point]) ?? []);
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
      const colorPoint = colorByDate.get(xPoint.date);
      return { date: xPoint.date, x, y, color: colorPoint ? supportedValueForPoint(colorPoint, basis, view) : null };
    });
  }, [basis, colorCoordinate, view, visibleXSeries, xCoordinate, yCoordinate]);

  const finiteRows = rows.filter((point): point is { date: string; x: number; y: number; color: number | null } => point !== null);
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
  const extentX = scale === "inspect"
    ? Math.max(...finiteRows.map((row) => Math.abs(row.x)), 1e-6)
    : sharedExtent(xCoordinate);
  const extentY = scale === "inspect"
    ? Math.max(...finiteRows.map((row) => Math.abs(row.y)), 1e-6)
    : sharedExtent(yCoordinate);
  const chartSegments: Array<Array<{ x: number; y: number }>> = [];
  let segment: Array<{ x: number; y: number }> = [];
  rows.forEach((point) => {
    if (!point) {
      if (segment.length) chartSegments.push(downsample(segment));
      segment = [];
      return;
    }
    segment.push({
      x: 160 + (point.x / extentX) * 136,
      y: 90 - (point.y / extentY) * 66,
    });
  });
  if (segment.length) chartSegments.push(downsample(segment));
  const firstPoint = chartSegments[0]?.[0];
  const latestPoint = chartSegments[chartSegments.length - 1]?.[chartSegments[chartSegments.length - 1].length - 1];
  const latestColor = finiteRows[finiteRows.length - 1]?.color ?? 0;
  const stroke = view === "target" ? "#38bdf8" : view === "benchmark" ? "#a78bfa" : "#fbbf24";
  const strokeDasharray = seriesDash(view);
  const thirdMagnitude = Math.min(1, Math.abs(latestColor) / Math.max(
    ...finiteRows.map((row) => Math.abs(row.color ?? 0)),
    1e-6,
  ));
  const thirdTone = latestColor > 0 ? "positive" : latestColor < 0 ? "negative" : "near zero";
  const subject = view === "difference"
    ? `${targetSymbol} − ${benchmarkSymbol}`
    : view === "target" ? targetSymbol : benchmarkSymbol;
  const latestRow = finiteRows[finiteRows.length - 1];
  const inspectedRow = selectedDate ? finiteRows.find((row) => row.date === selectedDate) : null;
  const displayedRow = inspectedRow ?? latestRow;
  const inspectedPoint = inspectedRow
    ? {
      x: 160 + (inspectedRow.x / extentX) * 136,
      y: 90 - (inspectedRow.y / extentY) * 66,
    }
    : null;
  const basisLabel = basis === "context" ? "relative to each instrument's own history" : "direct model scale";

  return (
    <article className="snap-start rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{definition.title}</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{definition.description}</p>
        </div>
        <div className="text-right">
          <span className="shrink-0 rounded-full border border-stealth-700 px-2 py-1 text-[10px] text-slate-300">{subject}</span>
          <p className="mt-1 font-mono text-[9px] text-slate-400">
            {inspectedRow?.date ? `${inspectedRow.date} · ` : ""}x {formatNumber(displayedRow?.x)} · y {formatNumber(displayedRow?.y)} · third {formatNumber(displayedRow?.color)}
          </p>
        </div>
      </div>
      <svg
        viewBox="0 0 320 180"
        className="mt-2 h-[154px] w-full touch-none"
        role="img"
        aria-label={`${definition.title} trajectory for ${subject}, ${basisLabel}. ${finiteRows.length} of ${rows.length} displayed observations supported. Latest supported x ${formatNumber(latestRow?.x)}, y ${formatNumber(latestRow?.y)}, third coordinate ${formatNumber(latestRow?.color)}.`}
        onPointerMove={(event) => {
          const index = pointerSeriesIndex(event, visibleXSeries.length, 320, 24, 306);
          onSelectedDateChange(visibleXSeries[index]?.date ?? null);
        }}
        onPointerLeave={() => onSelectedDateChange(null)}
      >
        <defs>
          <linearGradient id={`scope-${definition.id}-${view}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={stroke} stopOpacity=".12" />
            <stop offset="66%" stopColor={stroke} stopOpacity=".55" />
            <stop offset="100%" stopColor={stroke} stopOpacity="1" />
          </linearGradient>
          <marker id={`scope-arrow-${definition.id}-${view}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        </defs>
        <line x1="24" x2="306" y1="90" y2="90" stroke="rgba(100,116,139,.3)" strokeDasharray="3 5" />
        <line x1="160" x2="160" y1="19" y2="158" stroke="rgba(100,116,139,.3)" strokeDasharray="3 5" />
        {finiteRows.length ? (
          <>
            {chartSegments.map((points, index) => (
              <path
                key={`${definition.id}-${index}`}
                d={smoothPath(points)}
                fill="none"
                stroke={`url(#scope-${definition.id}-${view})`}
                strokeWidth="2.1"
                strokeDasharray={strokeDasharray}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {firstPoint ? (
              <SeriesPointMarker view={view} x={firstPoint.x} y={firstPoint.y} stroke={stroke} size={2.7} />
            ) : null}
            {latestPoint && chartSegments[chartSegments.length - 1]?.length > 1 ? (
              <line
                x1={chartSegments[chartSegments.length - 1][chartSegments[chartSegments.length - 1].length - 2].x}
                y1={chartSegments[chartSegments.length - 1][chartSegments[chartSegments.length - 1].length - 2].y}
                x2={latestPoint.x}
                y2={latestPoint.y}
                stroke={stroke}
                strokeWidth="2.1"
                strokeDasharray={strokeDasharray}
                markerEnd={`url(#scope-arrow-${definition.id}-${view})`}
              />
            ) : null}
            {latestPoint ? (
              <SeriesPointMarker
                view={view}
                x={latestPoint.x}
                y={latestPoint.y}
                stroke={stroke}
                size={4.2 + thirdMagnitude * 2.2}
                emphasized
              />
            ) : null}
            {inspectedPoint ? <circle cx={inspectedPoint.x} cy={inspectedPoint.y} r="6.5" fill="none" stroke="#f8fafc" strokeWidth="1.2" strokeDasharray="2 2" /> : null}
          </>
        ) : (
          <text x="160" y="94" textAnchor="middle" fill="#64748b" fontSize="11">Not enough shared support</text>
        )}
        <text x="160" y="176" textAnchor="middle" fill="#64748b" fontSize="9">{xCoordinate?.label ?? definition.x} →</text>
        <text x="7" y="90" textAnchor="middle" fill="#64748b" fontSize="9" transform="rotate(-90 7 90)">{yCoordinate?.label ?? definition.y} →</text>
      </svg>
      <p className="text-[10px] leading-4 text-slate-400">
        {scale === "shared" ? "Shared subject scale" : "Zoomed to the selected trajectory"} · {view === "target" ? "solid/circle target" : view === "benchmark" ? "dashed/diamond benchmark" : "dotted/square difference"} · older observations fade · third measure is {thirdTone} and changes current-marker size
      </p>
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
): { x: number; y: number } | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (!finite(value)) continue;
    return {
      x: 48 + (index / Math.max(1, values.length - 1)) * width,
      y: top + height / 2 - (value / extent) * (height * 0.42),
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
  const [mobileLane, setMobileLane] = useState<"relative" | "beta">("relative");
  // Keep the complete aligned sequence here so null beta rows remain visible
  // chain breaks rather than being bridged by generic point sampling.
  const rows = data.price_series;
  const relative = rows.map((point) => point.relative_index);
  const betaAdjusted = rows.map((point) => point.beta_adjusted_cumulative_return ?? null);
  const latestRelative = [...relative].reverse().find(finite);
  const latestBetaAdjusted = [...betaAdjusted].reverse().find(finite);
  const relativeBaselineY = scaledLaneY(100, [...relative, 100], 18, 62);
  const betaBaselineY = scaledLaneY(0, [...betaAdjusted, 0], 111, 64, true);
  const latestRelativeY = finite(latestRelative)
    ? scaledLaneY(latestRelative, [...relative, 100], 18, 62)
    : 27;
  const latestBetaAdjustedY = finite(latestBetaAdjusted)
    ? scaledLaneY(latestBetaAdjusted, [...betaAdjusted, 0], 111, 64, true)
    : 121;
  const chainStart = data.relative_progress.beta_adjusted_chain_start_at ?? betaChainStart(data);
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
  const displayedRelative = inspectedRow?.relative_index ?? latestRelative;
  const displayedBetaAdjusted = inspectedRow?.beta_adjusted_cumulative_return ?? latestBetaAdjusted;
  const cursorX = inspectedIndex >= 0 ? 50 + (inspectedIndex / denominator) * 632 : null;
  const mobileCursorX = inspectedIndex >= 0 ? 50 + (inspectedIndex / denominator) * 292 : null;

  return (
    <section className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="page-kicker">Price progress</span>
          <h3 className="mt-1 text-sm font-semibold text-white">Relative price and prior-only beta-adjusted path</h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
            <span>{inspectedRow?.date ? `${inspectedRow.date} · ` : ""}Relative index <strong className="text-teal-200">{finite(displayedRelative) ? displayedRelative.toFixed(2) : "—"}</strong></span>
            <span>Beta-adjusted chain <strong className="text-amber-200">{formatPercent(displayedBetaAdjusted)}</strong></span>
            <span>Current β <strong className="text-slate-200">{finite(latestBeta) ? latestBeta.toFixed(2) : "—"}</strong></span>
          </div>
        </div>
        <span className="rounded-full border border-stealth-700 px-2 py-1 text-[10px] text-slate-400">
          {data.overlap.common_observations.toLocaleString()} exact shared bars
        </span>
      </div>
      <div className="mt-3 inline-flex rounded-lg border border-stealth-700 bg-slate-950/60 p-0.5 sm:hidden" role="group" aria-label="Mobile price chart">
        {(["relative", "beta"] as const).map((lane) => (
          <button
            key={lane}
            type="button"
            onClick={() => setMobileLane(lane)}
            aria-pressed={mobileLane === lane}
            className={`min-h-10 rounded-md px-3 text-[11px] font-medium ${mobileLane === lane ? "bg-sky-400/15 text-sky-200" : "text-slate-400"}`}
          >
            {lane === "relative" ? "Relative price" : "Beta adjusted"}
          </button>
        ))}
      </div>
      <svg
        viewBox="0 0 700 190"
        className="mt-1 hidden h-[176px] w-full touch-none sm:block"
        role="img"
        aria-label={`${data.target.symbol} relative price versus ${data.benchmark.symbol}, based at 100 on ${formatDate(relativeStart, data.timeframe)}; latest ${finite(latestRelative) ? latestRelative.toFixed(2) : "unavailable"}. Prior-only beta-adjusted current chain ${formatPercent(latestBetaAdjusted)} with ${Math.max(0, chainStarts.length - 1)} restart${Math.max(0, chainStarts.length - 1) === 1 ? "" : "s"}.`}
        onPointerMove={(event) => onSelectedDateChange(rows[pointerSeriesIndex(event, rows.length, 700, 50, 682)]?.date ?? null)}
        onPointerLeave={() => onSelectedDateChange(null)}
      >
        <line x1="50" x2="682" y1={relativeBaselineY} y2={relativeBaselineY} stroke="rgba(45,212,191,.38)" strokeDasharray="4 4" />
        <text x="688" y={relativeBaselineY + 3} fill="#5eead4" fontSize="9">100</text>
        <line x1="50" x2="682" y1="96" y2="96" stroke="rgba(71,85,105,.45)" />
        <line x1="50" x2="682" y1={betaBaselineY} y2={betaBaselineY} stroke="rgba(251,191,36,.38)" strokeDasharray="4 4" />
        <text x="688" y={betaBaselineY + 3} fill="#fcd34d" fontSize="9">0</text>
        {chainStarts.map((index) => {
          const x = 50 + (index / denominator) * 632;
          return (
            <g key={`chain-${index}`}>
              <title>{`${index === chainStarts[0] ? "Beta chain start" : "Beta chain restart"} on ${rows[index]?.date ?? "an unavailable date"}`}</title>
              <line x1={x} x2={x} y1="107" y2="179" stroke="rgba(251,191,36,.58)" strokeWidth="1.2" strokeDasharray="2 4" />
              <path d={`M ${x - 3.5} 108 L ${x + 3.5} 108 L ${x} 114 Z`} fill="#fbbf24" stroke="#0f172a" strokeWidth=".8" />
            </g>
          );
        })}
        <path d={scaledLanePath(relative, 632, 18, 62, false, [100])} fill="none" stroke="#2dd4bf" strokeWidth="2.1" vectorEffect="non-scaling-stroke" />
        <path d={scaledLanePath(betaAdjusted, 632, 111, 64, true, [0])} fill="none" stroke="#fbbf24" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        {cursorX !== null ? <line x1={cursorX} x2={cursorX} y1="10" y2="179" stroke="rgba(248,250,252,.65)" strokeWidth="1" strokeDasharray="2 3" /> : null}
        <text x="5" y="32" fill="#94a3b8" fontSize="10">relative</text>
        <text x="5" y="45" fill="#64748b" fontSize="9">index</text>
        <text x="5" y="133" fill="#94a3b8" fontSize="10">β-adjusted</text>
        <text x="5" y="146" fill="#64748b" fontSize="9">cumulative</text>
        <text x="676" y={Math.max(14, Math.min(92, latestRelativeY - 5))} textAnchor="end" fill="#5eead4" fontSize="10">{finite(latestRelative) ? latestRelative.toFixed(2) : "—"}</text>
        <text x="676" y={Math.max(108, Math.min(178, latestBetaAdjustedY - 5))} textAnchor="end" fill="#fcd34d" fontSize="10">{formatPercent(latestBetaAdjusted)}</text>
        <text x="50" y="187" fill="#64748b" fontSize="10">{relativeStart ?? ""}</text>
        <text x="682" y="187" fill="#64748b" fontSize="10" textAnchor="end">{rows[rows.length - 1]?.date ?? ""}</text>
      </svg>
      <svg
        viewBox="0 0 360 128"
        className="mt-1 h-[128px] w-full touch-none sm:hidden"
        role="img"
        aria-label={mobileLane === "relative"
          ? `Relative price index based at 100 on ${formatDate(relativeStart, data.timeframe)}; latest ${finite(latestRelative) ? latestRelative.toFixed(2) : "unavailable"}.`
          : `Current prior-only beta-adjusted return chain ${formatPercent(latestBetaAdjusted)}; began ${formatDate(chainStart, data.timeframe)} with ${Math.max(0, chainStarts.length - 1)} restart${Math.max(0, chainStarts.length - 1) === 1 ? "" : "s"}.`}
        onPointerMove={(event) => onSelectedDateChange(rows[pointerSeriesIndex(event, rows.length, 360, 50, 342)]?.date ?? null)}
        onPointerLeave={() => onSelectedDateChange(null)}
      >
        {mobileLane === "relative" ? (
          <>
            <line x1="50" x2="342" y1={scaledLaneY(100, [...relative, 100], 18, 82)} y2={scaledLaneY(100, [...relative, 100], 18, 82)} stroke="rgba(45,212,191,.4)" strokeDasharray="4 4" />
            <text x="46" y={scaledLaneY(100, [...relative, 100], 18, 82) + 3} textAnchor="end" fill="#5eead4" fontSize="10">100</text>
            <path d={scaledLanePath(relative, 292, 18, 82, false, [100])} fill="none" stroke="#2dd4bf" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
            <text x="338" y="15" textAnchor="end" fill="#5eead4" fontSize="11">{finite(latestRelative) ? latestRelative.toFixed(2) : "—"}</text>
          </>
        ) : (
          <>
            <line x1="50" x2="342" y1={scaledLaneY(0, [...betaAdjusted, 0], 18, 82, true)} y2={scaledLaneY(0, [...betaAdjusted, 0], 18, 82, true)} stroke="rgba(251,191,36,.4)" strokeDasharray="4 4" />
            <text x="46" y={scaledLaneY(0, [...betaAdjusted, 0], 18, 82, true) + 3} textAnchor="end" fill="#fcd34d" fontSize="10">0</text>
            {chainStarts.map((index) => {
              const x = 50 + (index / denominator) * 292;
              return (
                <g key={`mobile-chain-${index}`}>
                  <title>{`${index === chainStarts[0] ? "Beta chain start" : "Beta chain restart"} on ${rows[index]?.date ?? "an unavailable date"}`}</title>
                  <line x1={x} x2={x} y1="16" y2="104" stroke="rgba(251,191,36,.58)" strokeWidth="1.2" strokeDasharray="2 4" />
                  <path d={`M ${x - 3.5} 18 L ${x + 3.5} 18 L ${x} 24 Z`} fill="#fbbf24" stroke="#0f172a" strokeWidth=".8" />
                </g>
              );
            })}
            <path d={scaledLanePath(betaAdjusted, 292, 18, 82, true, [0])} fill="none" stroke="#fbbf24" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
            <text x="338" y="15" textAnchor="end" fill="#fcd34d" fontSize="11">{formatPercent(latestBetaAdjusted)}</text>
          </>
        )}
        {mobileCursorX !== null ? <line x1={mobileCursorX} x2={mobileCursorX} y1="10" y2="105" stroke="rgba(248,250,252,.65)" strokeWidth="1" strokeDasharray="2 3" /> : null}
        <text x="50" y="122" fill="#64748b" fontSize="10">{relativeStart ?? ""}</text>
        <text x="342" y="122" fill="#64748b" fontSize="10" textAnchor="end">{rows[rows.length - 1]?.date ?? ""}</text>
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] leading-4 text-slate-400">
        <span className={mobileLane === "relative" ? "" : "hidden sm:inline"}><i className="mr-1 inline-block h-0.5 w-4 bg-teal-400 align-middle" />relative index began {formatDate(relativeStart, data.timeframe)} at 100</span>
        <span className={mobileLane === "beta" ? "" : "hidden sm:inline"}><i className="mr-1 inline-block h-0 w-0 border-x-[4px] border-t-[7px] border-x-transparent border-t-amber-300 align-middle" />current chain began {formatDate(chainStart, data.timeframe)}; triangle + dashed line marks every start/restart after unavailable beta</span>
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
  const rows = coordinate.series;
  const target = downsampleNullable(rows.map((point) => point.target_supported === false
    ? null
    : basis === "context" ? point.target_context ?? null : point.target));
  const benchmark = downsampleNullable(rows.map((point) => point.benchmark_supported === false
    ? null
    : basis === "context" ? point.benchmark_context ?? null : point.benchmark));
  const difference = downsampleNullable(rows.map((point) => point.target_supported === false || point.benchmark_supported === false || point.pair_supported === false
    ? null
    : basis === "context" ? point.context_difference : point.native_difference));
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
  const hatchId = `pair-unsupported-${coordinate.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const guidance = COORDINATE_GUIDANCE[coordinate.id] ?? {
    definition: "Implemented coordinate from the shared 15-dimensional field recipe.",
    higher: "Higher means more of this measured quantity, not better expected performance.",
  };
  const currentGap = latestDifference(coordinate, basis);
  const currentChange = fiveBarChange(coordinate, basis);
  const inspectedIndex = selectedDate ? rows.findIndex((row) => row.date === selectedDate) : -1;
  const inspected = inspectedIndex >= 0 ? rows[inspectedIndex] : null;
  const displayedGap = inspected
    ? basis === "context" ? inspected.context_difference : inspected.native_difference
    : currentGap;
  const cursorX = inspectedIndex >= 0
    ? 48 + (inspectedIndex / Math.max(1, rows.length - 1)) * 616
    : null;
  const latestRow = rows[rows.length - 1];
  const latestTarget = latestRow ? supportedValueForPoint(latestRow, basis, "target") : null;
  const latestBenchmark = latestRow ? supportedValueForPoint(latestRow, basis, "benchmark") : null;
  const selectedBasisAvailable = latestRow?.target_supported !== false
    && latestRow?.benchmark_supported !== false
    && latestRow?.pair_supported !== false
    && finite(currentGap);

  return (
    <div className="self-start rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5 xl:sticky xl:top-20">
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
        className="mt-2 h-[180px] w-full touch-none"
        role="img"
        aria-label={`${coordinate.label} comparison history on the ${basis === "context" ? "relative-to-own-history" : "direct-model-scale"} basis. Latest ${targetSymbol} ${formatNumber(latestTarget)}, ${benchmarkSymbol} ${formatNumber(latestBenchmark)}, target-minus-benchmark gap ${formatNumber(currentGap)}; current selected-basis value ${selectedBasisAvailable ? "available" : "limited"}. Solid circle is target, dashed diamond is benchmark, dotted square is difference, and hatched periods are unsupported.`}
        onPointerMove={(event) => onSelectedDateChange(rows[pointerSeriesIndex(event, rows.length, 680, 48, 664)]?.date ?? null)}
        onPointerLeave={() => onSelectedDateChange(null)}
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
        {targetPoint ? <SeriesPointMarker view="target" x={targetPoint.x} y={targetPoint.y} stroke="#38bdf8" size={4.1} emphasized /> : null}
        {benchmarkPoint ? <SeriesPointMarker view="benchmark" x={benchmarkPoint.x} y={benchmarkPoint.y} stroke="#a78bfa" size={4.1} emphasized /> : null}
        {differencePoint ? <SeriesPointMarker view="difference" x={differencePoint.x} y={differencePoint.y} stroke="#fbbf24" size={4.1} emphasized /> : null}
        {cursorX !== null ? <line x1={cursorX} x2={cursorX} y1="8" y2="154" stroke="rgba(248,250,252,.65)" strokeWidth="1" strokeDasharray="2 3" /> : null}
        <text x="48" y="166" fill="#64748b" fontSize="10">{rows[0]?.date ?? ""}</text>
        <text x="664" y="166" fill="#64748b" fontSize="10" textAnchor="end">{rows[rows.length - 1]?.date ?? ""}</text>
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-white bg-sky-400 align-middle" /><i className="mr-1 inline-block h-0.5 w-3 bg-sky-400 align-middle" />{targetSymbol} · solid/circle</span>
        <span><i className="mr-1 inline-block h-2 w-2 rotate-45 border border-white bg-violet-400 align-middle" /><i className="mr-1 inline-block h-0.5 w-3 border-t-2 border-dashed border-violet-400 align-middle" />{benchmarkSymbol} · dashed/diamond</span>
        <span><i className="mr-1 inline-block h-2 w-2 border border-white bg-amber-300 align-middle" /><i className="mr-1 inline-block h-0.5 w-3 border-t-2 border-dotted border-amber-300 align-middle" />difference · dotted/square</span>
        <span><i className="mr-1 inline-block h-2 w-3 bg-[repeating-linear-gradient(135deg,rgba(148,163,184,.5)_0_1px,transparent_1px_3px)] align-middle" />unsupported · hatched gap</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stealth-700 bg-stealth-700 sm:grid-cols-3">
        {[
          [targetSymbol, formatNumber(coordinate.latest.target), "direct model scale"],
          [benchmarkSymbol, formatNumber(coordinate.latest.benchmark), "direct model scale"],
          ["Direct gap", formatNumber(coordinate.latest.native_difference), `${targetSymbol} − ${benchmarkSymbol}`],
          ["Own-history gap", formatNumber(coordinate.latest.context_difference), "separate fixed-fit scales"],
          ["Five-bar change", formatNumber(currentChange), basis === "context" ? "own-history basis" : "direct model scale"],
          ["Support", coordinate.latest.pair_supported !== false && coordinate.latest.target_supported && coordinate.latest.benchmark_supported ? "Full" : "Limited", "bilateral dependencies"],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-slate-950/75 p-2.5">
            <div className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
            <div className="mt-0.5 font-mono text-xs font-semibold text-slate-200">{value}</div>
            <div className="mt-0.5 text-[9px] text-slate-400">{note}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-stealth-700 bg-slate-950/55 p-3 text-[11px] leading-5 text-slate-400">
        <p>{guidance.definition}</p>
        <p className="mt-1 text-slate-400">{guidance.higher}</p>
      </div>
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
  const [activeMobileScope, setActiveMobileScope] = useState(SCOPE_DEFINITIONS[0].id);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [inspectedDate, setInspectedDate] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "summary" | "receipt" | "error">("idle");
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
    () => new Map(data.coordinates.map((coordinate) => [coordinate.id, heatSegments(coordinate, basis)])),
    [basis, data.coordinates],
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
  const relativeIndex = data.relative_progress.relative_index ?? latestRelativeIndex(data);
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
  const relativeBaseDate = data.price_series[0]?.date ?? data.overlap.start;
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

  const selectTab = (nextTab: PairTab) => {
    setActiveTab(nextTab);
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

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary.copyText);
      setCopyStatus("summary");
      trackPairEvent("pair_summary_copied", data.comparison_hash, {
        summary_source: summary.summarySource,
        timeframe: data.timeframe,
      });
    } catch {
      setCopyStatus("error");
    }
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

  useEffect(() => {
    const background = pairContentRef.current as (HTMLDivElement & { inert: boolean }) | null;
    if (background) background.inert = mobileDetailOpen;
    if (!mobileDetailOpen) return undefined;

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
  }, [mobileDetailOpen]);

  return (
    <>
      <div ref={pairContentRef} aria-hidden={mobileDetailOpen ? true : undefined}>
        <div className="sticky top-16 z-[80] sm:hidden">
          <div className="mb-2 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-stealth-600 bg-slate-950/92 px-3 py-2 shadow-xl backdrop-blur-xl">
            <div className="min-w-0 truncate text-xs font-semibold text-white">
              {data.target.symbol} vs {data.benchmark.symbol}
              <span className="font-normal text-slate-400"> · {data.timeframe} · {data.overlap.common_observations.toLocaleString()} shared</span>
            </div>
            <span className="shrink-0 rounded-full border border-stealth-700 px-2 py-1 text-[9px] text-slate-400">
              {PAIR_TAB_OPTIONS.find((option) => option.id === activeTab)?.label}
            </span>
          </div>
        </div>
        <section className="primary-card overflow-hidden" aria-labelledby="pair-field-title">
      <header className="border-b border-stealth-700 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="page-kicker">Relative field</span>
              <span className="page-badge border-teal-400/20 text-teal-200"><ArrowRightLeft className="h-3.5 w-3.5" /> Exact shared bars</span>
              <span className={`page-badge ${sessionCertified ? "border-emerald-400/20 text-emerald-200" : "border-amber-400/20 text-amber-200"}`}>
                Sessions {sessionCompatibility === "incompatible"
                  ? "incompatible"
                  : sessionCertified
                    ? "independently certified"
                    : sessionCompatibility === "compatible" ? "marked compatible · not independently certified" : "not independently certified"}
              </span>
              {data.provenance.identity_control ? (
                <span className="page-badge border-amber-400/20 text-amber-200">Identity control</span>
              ) : null}
            </div>
            <h2 id="pair-field-title" className="mt-1 text-xl font-semibold text-white sm:text-2xl">
              {data.target.symbol} compared with {data.benchmark.symbol}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              Relative price measures progress. Coordinate differences describe how the two fields arrived there; they do not declare one instrument better.
            </p>
          </div>
          <div className="rounded-xl border border-stealth-700 bg-slate-950/40 px-3 py-2 text-right text-[10px] leading-4 text-slate-400">
            <div className="font-mono text-slate-300">{data.timeframe} · {data.overlap.common_observations.toLocaleString()} shared</div>
            <div>Through {formatDate(data.overlap.latest_aligned_at, data.timeframe)}</div>
          </div>
        </div>
        <nav className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-stealth-700 bg-slate-950/55 p-1 sm:inline-grid sm:min-w-[420px]" role="tablist" aria-label="Relative Field sections">
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
          <div id="pair-panel-overview" role="tabpanel" aria-labelledby="pair-tab-overview" className="flex flex-col gap-4">
            <section ref={overviewPanelRef} className="order-2 rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-400/[0.08] via-slate-950/40 to-violet-400/[0.06] p-4 sm:order-1 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="page-kicker">Descriptive read</span>
                  <h3 className="mt-1 text-lg font-semibold text-white">{summary.title}</h3>
                </div>
                <span className="rounded-full border border-stealth-600 bg-slate-950/45 px-3 py-1 text-[10px] text-slate-400">
                  Deterministic {summary.summarySource === "server" ? "server summary" : "legacy client fallback"} · not a forecast
                </span>
              </div>
              <div className="mt-3 max-w-5xl space-y-2 text-sm leading-6 text-slate-300">
                <p>{summary.relativeProgressSentence}</p>
                <p>{summary.betaAdjustedSentence}</p>
                <button type="button" onClick={() => selectTab("field")} className="block text-left text-slate-300 transition hover:text-sky-200">
                  {summary.coordinateGapSentence} <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
                </button>
                <p>{summary.separationSentence}</p>
                <button type="button" onClick={() => selectTab("audit")} className="block text-left text-xs text-amber-200/80 transition hover:text-amber-100">
                  {summary.supportCaveat} <FileCheck2 className="ml-1 inline h-3.5 w-3.5" />
                </button>
              </div>
            </section>

            <section className="order-1 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-700 sm:order-2 lg:grid-cols-5">
              {[
                ["Relative index", finite(relativeIndex) ? relativeIndex.toFixed(2) : "—", `100 on ${formatDate(relativeBaseDate, data.timeframe)} · equal progress at the base`, "text-teal-200"],
                ["Relative price progress", formatPercent(data.relative_progress.active_return_pct), `${data.overlap.common_observations.toLocaleString()} exact shared bars`, gapTone],
                ["Beta-adjusted chain", formatPercent(data.relative_progress.beta_adjusted_return_pct), `β ${finite(data.relative_progress.beta) ? data.relative_progress.beta.toFixed(2) : "—"} from ${data.relative_progress.beta_prior_observations ?? data.relative_progress.lookback_bars} prior returns · began ${formatDate(chainStart, data.timeframe)}`, "text-sky-200"],
                ["Field separation", fieldSeparation?.label ?? separationLabel(data.relative_progress.gap_direction), finite(stretch.latest) && finite(stretch.previous) ? `${stretch.latest.toFixed(2)} now vs ${stretch.previous.toFixed(2)} ${separationLookback} shared bars earlier` : "own-history basis", "text-amber-200"],
              ].map(([label, value, note, tone]) => (
                <div key={label} role="group" aria-label={`${label}: ${value}. ${note}`} className="min-w-0 bg-slate-950/80 p-3.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</div>
                  <div className={`mt-1 text-base font-semibold ${tone}`}>{value}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-slate-400">{note}</div>
                </div>
              ))}
              <div
                role="group"
                aria-label={`Data support: ${supportedWindowCells} of ${totalWindowCells} window coordinate cells; ${fullySupported} of ${data.coordinates.length} current coordinates; missing values carried ${missingValuesCarried === false ? "no" : missingValuesCarried === true ? "yes" : "not reported"}; session status ${sessionCompatibility}; ${sessionCertified ? "independently certified" : "not independently certified"}.`}
                className="col-span-2 min-w-0 bg-slate-950/80 p-3.5 lg:col-span-1"
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Data support</div>
                <div className={`mt-1 text-base font-semibold ${fullySupported === data.coordinates.length ? "text-emerald-200" : "text-amber-200"}`}>{supportPct}% window cells</div>
                <dl className="mt-1 grid gap-0.5 text-[10px] leading-4 text-slate-400">
                  <div className="flex justify-between gap-2"><dt>Window cells</dt><dd className="font-mono text-slate-300">{supportedWindowCells.toLocaleString()} / {totalWindowCells.toLocaleString()}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Current coordinates</dt><dd className="font-mono text-slate-300">{fullySupported} / {data.coordinates.length}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Missing values carried</dt><dd className="text-slate-300">{missingValuesCarried === false ? "No" : missingValuesCarried === true ? "Yes" : "Not reported"}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Session status</dt><dd className="text-right capitalize text-slate-300">{sessionCompatibility.replace(/_/g, " ")}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Session certification</dt><dd className="text-right text-slate-300">{sessionCertified ? "Independently certified" : "Not independently certified"}</dd></div>
                </dl>
              </div>
            </section>

            <div className="order-3">
              <RelativeProgressTrace data={data} selectedDate={inspectedDate} onSelectedDateChange={setInspectedDate} />
            </div>

            <section className="order-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="grid gap-2 sm:grid-cols-3">
                {summary.notableGaps.map((gap) => (
                  <button
                    key={gap.id}
                    type="button"
                    onClick={() => {
                      selectDimension(gap.id);
                      selectTab("field");
                    }}
                    className="rounded-xl border border-stealth-700 bg-slate-950/35 p-3 text-left transition hover:border-sky-400/40 hover:bg-sky-400/[0.05]"
                  >
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Own-history difference</div>
                    <div className="mt-1 text-xs font-semibold text-slate-200">{gap.label}</div>
                    <div className="mt-1 font-mono text-sm text-sky-200">{formatNumber(gap.value)}</div>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => selectTab("audit")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">
                <FileCheck2 className="h-4 w-4" /> Self-checking compact receipt
              </button>
            </section>
          </div>
        ) : null}

        {activeTab === "field" ? (
          <div id="pair-panel-field" role="tabpanel" aria-labelledby="pair-tab-field" className="space-y-4">
            <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-3.5">
              <div className="grid gap-3 xl:grid-cols-[1fr_auto_auto] xl:items-end">
                <div>
                  <span className="page-kicker">Comparison controls</span>
                  <h3 className="mt-1 text-sm font-semibold text-white">How field coordinates are displayed</h3>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    {basis === "context"
                      ? "Own-history-relative gap: the difference after each instrument is standardized against its separate frozen proper-fit history."
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
                        className={`min-h-10 rounded-lg px-3 text-[11px] font-medium transition sm:min-h-9 ${basis === option ? "bg-teal-400/15 text-teal-200 ring-1 ring-teal-400/30" : "text-slate-400 hover:text-white"}`}
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
                        className={`min-h-10 rounded-lg px-3 text-[11px] font-medium transition sm:min-h-9 ${view === option ? "bg-violet-400/15 text-violet-200 ring-1 ring-violet-400/30" : "text-slate-400 hover:text-white"}`}
                      >
                        {option === "target" ? data.target.symbol : option === "benchmark" ? data.benchmark.symbol : `${data.target.symbol} − ${data.benchmark.symbol}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <span className="page-kicker">Relationship scopes</span>
                  <h3 className="mt-1 text-base font-semibold text-white">How the paired field is moving</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="inline-flex rounded-lg border border-stealth-700 bg-slate-950/50 p-0.5" role="group" aria-label="Scope trail length">
                    {([12, 24, 72, "full"] as const).map((option) => (
                      <button key={option} type="button" onClick={() => setActiveTrail(option)} aria-pressed={activeTrail === option} className={`min-h-10 rounded-md px-2.5 text-[10px] sm:min-h-8 ${activeTrail === option ? "bg-sky-400/15 text-sky-200" : "text-slate-400"}`}>
                        {option === "full" ? "Full" : option}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex rounded-lg border border-stealth-700 bg-slate-950/50 p-0.5" role="group" aria-label="Scope scale">
                    {(["shared", "inspect"] as const).map((option) => (
                      <button key={option} type="button" onClick={() => setActiveScale(option)} aria-pressed={activeScale === option} className={`min-h-10 rounded-md px-2.5 text-[10px] sm:min-h-8 ${activeScale === option ? "bg-amber-400/15 text-amber-200" : "text-slate-400"}`}>
                        {option === "shared" ? "Shared scale" : "Inspect selected"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mb-2 text-[10px] leading-4 text-slate-400">
                Redundant encodings identify {data.target.symbol} (cyan, solid, circle), {data.benchmark.symbol} (purple, dashed, diamond), and their difference (amber, dotted, square). Hover or touch a chart to inspect the same shared date across visible field charts{inspectedDate ? ` (${inspectedDate})` : ""}. Older observations fade; unsupported paths remain broken; trajectories are not inferred cycles.
              </p>
              <div className="lg:hidden">
                <div className="mb-2 grid grid-cols-2 gap-1 sm:grid-cols-4" role="group" aria-label="Relationship scope">
                  {SCOPE_DEFINITIONS.map((definition) => (
                    <button
                      key={definition.id}
                      type="button"
                      onClick={() => setActiveMobileScope(definition.id)}
                      aria-pressed={activeMobileScope === definition.id}
                      className={`min-h-10 rounded-lg border px-2 text-[10px] transition ${activeMobileScope === definition.id ? "border-sky-400/45 bg-sky-400/[0.08] text-sky-100" : "border-stealth-700 text-slate-400 hover:text-white"}`}
                    >
                      {definition.title}
                    </button>
                  ))}
                </div>
                {SCOPE_DEFINITIONS.filter((definition) => definition.id === activeMobileScope).map((definition) => (
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
                    targetSymbol={data.target.symbol}
                    benchmarkSymbol={data.benchmark.symbol}
                  />
                ))}
              </div>
              <div className="hidden gap-3 lg:grid lg:grid-cols-2">
                {SCOPE_DEFINITIONS.map((definition) => (
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
                    targetSymbol={data.target.symbol}
                    benchmarkSymbol={data.benchmark.symbol}
                  />
                ))}
              </div>
            </section>

            <section className="grid gap-3 xl:grid-cols-[minmax(320px,.74fr)_minmax(0,1.26fr)]">
              <div className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <span className="page-kicker">15-coordinate comparison</span>
                    <h3 className="mt-1 text-sm font-semibold text-white">How the field measurements differ through time</h3>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{data.target.symbol} − {data.benchmark.symbol}</p>
                  </div>
                  <div className="text-right text-[9px] leading-4 text-slate-400">
                    <div><span className="text-violet-300">benchmark higher ←</span> · <span className="text-teal-300">→ target higher</span></div>
                    <div>above/below center = sign · height/intensity = magnitude · end arrow = current sign · hatch = unsupported</div>
                  </div>
                </div>
                <div className="mt-3 inline-flex rounded-lg border border-stealth-700 bg-slate-950/55 p-0.5" role="group" aria-label="Coordinate ordering">
                  {(["recipe", "largest"] as const).map((option) => (
                    <button key={option} type="button" onClick={() => setActiveOrder(option)} aria-pressed={activeOrder === option} className={`min-h-10 rounded-md px-3 text-[10px] sm:min-h-8 ${activeOrder === option ? "bg-violet-400/15 text-violet-200" : "text-slate-400"}`}>
                      {option === "recipe" ? "Recipe order" : "Largest own-history gaps"}
                    </button>
                  ))}
                </div>
                <div className="mt-3 space-y-3">
                  {(activeOrder === "recipe"
                    ? groupedCoordinates
                    : [{ family: "ranked", coordinates: orderedCoordinates }]
                  ).map((group) => (
                    <details
                      key={group.family}
                      open={group.family === "pressure_state" || group.family === "ranked"}
                      className="group rounded-lg"
                    >
                      <summary className="mb-1 flex min-h-10 cursor-pointer list-none items-center justify-between text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400 sm:min-h-7">
                        {group.family === "ranked" ? "Ranked by absolute own-history gap" : FAMILY_LABELS[group.family] ?? group.family}
                        <span className="text-slate-700 group-open:rotate-45" aria-hidden="true">+</span>
                      </summary>
                      <div className="space-y-1">
                        {group.coordinates.map((coordinate) => {
                          const supported = coordinate.latest.target_supported
                            && coordinate.latest.benchmark_supported
                            && coordinate.latest.pair_supported !== false
                            && finite(latestDifference(coordinate, basis));
                          const active = coordinate.id === selected?.id;
                          const currentDifference = latestDifference(coordinate, basis);
                          const directionNotch = finite(currentDifference)
                            ? currentDifference > 0 ? "→" : currentDifference < 0 ? "←" : "•"
                            : "×";
                          const segments = coordinateSegments.get(coordinate.id) ?? [];
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
                              aria-label={`${coordinate.label}; ${basis === "context" ? "relative-to-own-history" : "direct-model-scale"} target-minus-benchmark gap ${supported ? formatNumber(currentDifference) : "limited"}; current direction ${directionNotch === "→" ? "target higher" : directionNotch === "←" ? "benchmark higher" : directionNotch === "•" ? "near equal" : "unsupported"}; selected-basis value ${supported ? "available" : "limited"}.`}
                              className={`grid min-h-10 w-full grid-cols-[104px_minmax(80px,1fr)_58px] items-center gap-2 rounded-lg border px-2 text-left transition sm:grid-cols-[138px_minmax(100px,1fr)_66px] ${active ? "border-sky-400/50 bg-sky-400/[0.08]" : "border-transparent hover:border-stealth-600 hover:bg-white/[0.025]"}`}
                            >
                              <span className="min-w-0 truncate text-[11px] font-medium leading-3.5 text-slate-200">{coordinate.label}</span>
                              <span className="relative flex h-5 min-w-0 overflow-hidden rounded border border-white/[0.08] bg-slate-950/75" aria-hidden="true">
                                {segments.map((segment, index) => (
                                  <i
                                    key={`${coordinate.id}-segment-${index}`}
                                    className="relative min-w-px flex-1"
                                  >
                                    {segment.supported ? (
                                      <i
                                        className="absolute inset-x-0 min-h-px"
                                        style={{
                                          backgroundColor: segment.color,
                                          height: `${Math.max(8, segment.magnitude * 48)}%`,
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
                                {supported ? formatNumber(latestDifference(coordinate, basis)) : "limited"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
              {selected ? (
                <>
                  <div className="hidden xl:block">
                    <DimensionTrend
                      coordinate={selected}
                      basis={basis}
                      selectedDate={inspectedDate}
                      onSelectedDateChange={setInspectedDate}
                      targetSymbol={data.target.symbol}
                      benchmarkSymbol={data.benchmark.symbol}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      previousFocusRef.current = event.currentTarget;
                      setMobileDetailOpen(true);
                    }}
                    className="inline-flex min-h-11 items-center justify-between gap-3 rounded-xl border border-sky-400/25 bg-sky-400/[0.06] px-3 text-left text-xs text-sky-100 xl:hidden"
                  >
                    <span>Inspect {selected.label}</span>
                    <span className="font-mono text-[10px] text-sky-200">gap {formatNumber(latestDifference(selected, basis))}</span>
                  </button>
                </>
              ) : (
                <div className="grid min-h-[240px] place-items-center rounded-2xl border border-stealth-700 text-sm text-slate-400">No comparable coordinates were returned.</div>
              )}
            </section>

            <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2.5 text-[11px] leading-5 text-amber-100/80">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>Positive coordinate gaps mean more of that measured quantity in the target—not higher quality, a forecast, or a trade signal.</div>
            </div>
          </div>
        ) : null}

        {activeTab === "audit" ? (
          <div id="pair-panel-audit" role="tabpanel" aria-labelledby="pair-tab-audit" className="space-y-4">
            <section className="flex flex-col gap-3 rounded-2xl border border-sky-400/20 bg-sky-400/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="page-kicker">Self-checking compact receipt</span>
                <h3 className="mt-1 text-sm font-semibold text-white">Share the live recipe or preserve this compact evidence boundary</h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">The page URL reruns against then-current data. The JSON receipt freezes hashes, aligned keys, current measurements, and authority boundaries.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copySummary()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">
                  <ClipboardCopy className="h-4 w-4" /> {copyStatus === "summary" ? "Summary copied" : "Copy summary"}
                </button>
                <button
                  type="button"
                  onClick={exportReceipt}
                  disabled={!data.frozen_receipt}
                  title="Preserves aligned keys, current measurements, support, identities, disclosures, and authority. Does not preserve full chart histories and is not digitally signed."
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stealth-600 px-3 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white disabled:opacity-40"
                >
                  <Download className="h-4 w-4" /> {copyStatus === "receipt" ? "Receipt exported" : "Export compact receipt · JSON"}
                </button>
              </div>
            </section>
            <p className={`-mt-2 text-[10px] ${copyStatus === "error" ? "text-rose-300" : "text-slate-400"}`} role="status" aria-live="polite">
              {copyStatus === "error"
                ? "The requested clipboard or receipt action was unavailable."
                : `Summary source: ${summary.summarySource === "server" ? "deterministic server payload" : "legacy client fallback; refresh to obtain a frozen server receipt"}.`}
            </p>

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-3.5">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <div>
                    <h3 className="text-xs font-semibold text-white">Alignment, support, and compatibility</h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">
                      Requested {data.window?.requested_shared_observations ?? data.overlap.common_observations} bars; returned {data.window?.returned_exact_shared_observations ?? data.overlap.common_observations} exact shared bars from {formatDate(data.overlap.start, data.timeframe)} to {formatDate(data.overlap.end, data.timeframe)}.
                      {" "}{supportPct}% coordinate-cell support; {data.overlap.target_dropped} target and {data.overlap.benchmark_dropped} benchmark timestamps were excluded without carrying values.
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-400">
                      <div><dt>Session</dt><dd className="text-slate-300">{data.compatibility?.session.status ?? sessionCompatibility} · {data.compatibility?.session.independently_certified ? "certified" : "not independently certified"}</dd></div>
                      <div><dt>Currency</dt><dd className="text-slate-300">{data.compatibility?.currency.status ?? "unknown"}</dd></div>
                      <div><dt>Adjustment</dt><dd className="text-slate-300">{data.compatibility?.price_adjustment.status ?? "provider as returned"}</dd></div>
                      <div><dt>Timestamp rule</dt><dd className="text-slate-300">{data.overlap.alignment_rule ?? "exact shared key"}</dd></div>
                    </dl>
                    {unsupported ? <p className="mt-2 text-[10px] text-amber-300">{unsupported} latest coordinate{unsupported === 1 ? " lacks" : "s lack"} bilateral support.</p> : null}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-3.5">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                  <div>
                    <h3 className="text-xs font-semibold text-white">Identity & authority boundary</h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">{data.provenance.note}</p>
                    <p className="mt-1 break-all font-mono text-[10px] leading-4 text-slate-400" title={data.comparison_hash}>
                      comparison {data.comparison_hash} · target {data.target.analysis_hash} · benchmark {data.benchmark.analysis_hash}
                    </p>
                    {data.frozen_receipt?.receipt_hash ? <p className="mt-1 break-all font-mono text-[10px] leading-4 text-slate-400">receipt {data.frozen_receipt.receipt_hash}</p> : null}
                    {data.provenance.identity_control ? (
                      <p className="mt-2 text-[10px] text-amber-300">Same-analysis identity control: every bilaterally supported signed difference should be zero.</p>
                    ) : null}
                    <p className="mt-2 text-[10px] text-amber-200">Research display only · zero scanner, option-learning, veto, sizing, or execution authority.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-px overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-700 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [`${data.target.symbol} aligned close`, formatLevel(data.relative_progress.latest_target_close), data.target.provider_symbol ?? data.target.symbol],
                [`${data.benchmark.symbol} aligned close`, formatLevel(data.relative_progress.latest_benchmark_close), data.benchmark.provider_symbol ?? data.benchmark.symbol],
                ["Beta chain", `${data.relative_progress.beta_adjusted_chain_observations ?? "—"} observations`, `${data.relative_progress.beta_adjusted_chain_reset_count ?? 0} resets`],
                [
                  "Cache / runtime",
                  data.cache?.analysis?.status ?? data.runtime?.cache.status ?? "not reported",
                  data.runtime
                    ? `${formatMilliseconds(data.runtime.response.handler_to_response_ready_ms)} backend response-ready · single response; JSON, transfer, and browser paint excluded`
                    : data.generated_at ? `generated ${formatDate(data.generated_at, data.timeframe)}` : "generation time unavailable",
                ],
              ].map(([label, value, note], index) => (
                <div key={`${index}-${label}`} className="bg-slate-950/75 p-3">
                  <div className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-200">{value}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{note}</div>
                </div>
              ))}
            </section>

            <details className="group overflow-hidden rounded-2xl border border-stealth-700 bg-slate-950/25">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left">
                <div><span className="page-kicker">Relative Field methodology</span><h3 className="mt-1 text-sm font-semibold text-white">Definitions, chronology, and limits</h3></div>
                <span className="text-xs text-slate-400 transition group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <div className="grid gap-px border-t border-stealth-700 bg-stealth-700 md:grid-cols-2">
                {[
                  ["Relative index", "The target level divided by the benchmark level is rebased to 100 at the first shared returned bar. It measures observed relative progress, not field quality."],
                  ["Direct model-scale gap", "For coordinate k, the direct gap is target minus benchmark on the coordinate's implemented 15D scale—not raw market or economic units."],
                  ["Relative to own history", "Each coordinate is standardized against its instrument's separate fixed proper-fit median and robust scale, then differenced only on shared evaluation timestamps."],
                  ["Prior-only beta adjustment", "The beta-adjusted chain starts after the minimum prior aligned returns and uses a beta fit only on strictly earlier observations. It does not subtract the fitted intercept and is not an OLS residual or alpha."],
                  ["Field separation", `The family-balanced mean absolute own-history gap is compared with ${separationLookback} shared bars earlier on the same supported-coordinate intersection. Inside tolerance is reported as no clear net change.`],
                  ["Alignment & support", "Only exact timestamp intersections are used. No price or coordinate is forward-filled, interpolated, or nearest-neighbor matched."],
                  ["Identity & authority", "The ordered comparison hash binds both component analyses, alignment, and normalization. Pair v1 remains descriptive and has no decision or execution authority."],
                ].map(([title, body]) => (
                  <article key={title} className="bg-slate-950/75 p-4"><h4 className="text-xs font-semibold text-slate-200">{title}</h4><p className="mt-1 text-[11px] leading-5 text-slate-400">{body}</p></article>
                ))}
              </div>
              {data.caveats.length ? (
                <div className="border-t border-stealth-700 bg-slate-950/70 p-4">
                  <h4 className="text-xs font-semibold text-slate-200">Response-specific caveats</h4>
                  <ul className="mt-2 grid gap-1 text-[11px] leading-5 text-slate-400 md:grid-cols-2 md:gap-x-6">{data.caveats.map((caveat) => <li key={caveat}>• {caveat}</li>)}</ul>
                </div>
              ) : null}
            </details>
          </div>
        ) : null}
        </div>
      </section>
      </div>
      {mobileDetailOpen && selected ? (
        <div
          className="fixed inset-0 z-[300] flex items-end bg-slate-950/75 p-2 backdrop-blur-sm xl:hidden"
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) setMobileDetailOpen(false);
          }}
        >
          <div
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
