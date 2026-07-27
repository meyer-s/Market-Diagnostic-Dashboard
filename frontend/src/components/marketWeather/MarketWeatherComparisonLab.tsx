import { useMemo } from "react";
import { ArrowRightLeft, CheckCircle2, Info, ShieldCheck } from "lucide-react";

import type {
  MarketWeatherComparisonBasis,
  MarketWeatherComparisonCoordinate,
  MarketWeatherComparisonResponse,
  MarketWeatherComparisonSeriesPoint,
  MarketWeatherComparisonView,
  MarketWeatherTimeframe,
} from "../../types/marketWeather";

interface MarketWeatherComparisonLabProps {
  data: MarketWeatherComparisonResponse;
  basis: MarketWeatherComparisonBasis;
  view: MarketWeatherComparisonView;
  selectedDimension: string;
  onBasisChange: (basis: MarketWeatherComparisonBasis) => void;
  onViewChange: (view: MarketWeatherComparisonView) => void;
  onDimensionChange: (dimension: string) => void;
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
    description: "Pressure × velocity; latest supported hue reflects organization.",
    x: "pressure",
    y: "velocity",
    color: "structure",
  },
  {
    id: "higher_motion",
    title: "Higher motion",
    description: "Acceleration × jerk; latest supported hue reflects snap.",
    x: "acceleration",
    y: "jerk",
    color: "snap",
  },
  {
    id: "organization",
    title: "Organization",
    description: "Structure × information; latest supported hue reflects kinematics.",
    x: "structure",
    y: "information",
    color: "kinematics",
  },
  {
    id: "propagation",
    title: "Propagation & carriers",
    description: "Propagation × cascade bias; latest supported hue reflects liquidity stress.",
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

function formatDate(value: string | null | undefined, timeframe: MarketWeatherTimeframe): string {
  if (!value) return "Unavailable";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return ["1D", "1W"].includes(timeframe)
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

function heatGradient(coordinate: MarketWeatherComparisonCoordinate, basis: MarketWeatherComparisonBasis): string {
  const points = coordinate.series.slice(-72);
  const values = points.map((point) => (
    point.target_supported !== false && point.benchmark_supported !== false && point.pair_supported !== false
      ? basis === "context" ? point.context_difference : point.native_difference
      : null
  ));
  const finiteValues = values.filter(finite);
  if (!finiteValues.length) return "linear-gradient(to right, rgba(30,41,59,.65), rgba(30,41,59,.65))";
  const maximum = Math.max(...finiteValues.map(Math.abs), 1e-9);
  const denominator = Math.max(1, values.length - 1);
  const stops = values.map((value, index) => {
    const color = finite(value) ? colorForValue(value, maximum) : "rgba(15,23,42,.9)";
    return `${color} ${(index / denominator) * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(",")})`;
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

function ScopeChart({
  definition,
  coordinates,
  basis,
  view,
  targetSymbol,
  benchmarkSymbol,
}: {
  definition: ScopeDefinition;
  coordinates: Map<string, MarketWeatherComparisonCoordinate>;
  basis: MarketWeatherComparisonBasis;
  view: MarketWeatherComparisonView;
  targetSymbol: string;
  benchmarkSymbol: string;
}) {
  const xCoordinate = coordinates.get(definition.x);
  const yCoordinate = coordinates.get(definition.y);
  const colorCoordinate = coordinates.get(definition.color);
  const rows = useMemo<Array<{ x: number; y: number; color: number | null } | null>>(() => {
    if (!xCoordinate || !yCoordinate) return [];
    const yByDate = new Map(yCoordinate.series.map((point) => [point.date, point]));
    const colorByDate = new Map(colorCoordinate?.series.map((point) => [point.date, point]) ?? []);
    return xCoordinate.series.map((xPoint) => {
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
      return { x, y, color: colorPoint ? supportedValueForPoint(colorPoint, basis, view) : null };
    });
  }, [basis, colorCoordinate, view, xCoordinate, yCoordinate]);

  const finiteRows = rows.filter((point): point is { x: number; y: number; color: number | null } => point !== null);
  const allSubjects: MarketWeatherComparisonView[] = ["target", "benchmark", "difference"];
  const extentX = Math.max(
    ...(xCoordinate?.series.flatMap((point) => allSubjects.map((subject) => supportedValueForPoint(point, basis, subject)).filter(finite).map(Math.abs)) ?? []),
    1e-6,
  );
  const extentY = Math.max(
    ...(yCoordinate?.series.flatMap((point) => allSubjects.map((subject) => supportedValueForPoint(point, basis, subject)).filter(finite).map(Math.abs)) ?? []),
    1e-6,
  );
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
  const latestPoint = chartSegments[chartSegments.length - 1]?.[chartSegments[chartSegments.length - 1].length - 1];
  const latestColor = finiteRows[finiteRows.length - 1]?.color ?? 0;
  const stroke = latestColor >= 0 ? "#5eead4" : "#c4b5fd";
  const subject = view === "difference"
    ? `${targetSymbol} − ${benchmarkSymbol}`
    : view === "target" ? targetSymbol : benchmarkSymbol;

  return (
    <article className="snap-start rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{definition.title}</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{definition.description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-stealth-700 px-2 py-1 text-[10px] text-slate-400">{subject}</span>
      </div>
      <svg viewBox="0 0 320 180" className="mt-2 h-[154px] w-full" role="img" aria-label={`${definition.title} phase path for ${subject}`}>
        <defs>
          <linearGradient id={`scope-${definition.id}-${view}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#334155" stopOpacity=".25" />
            <stop offset="66%" stopColor={stroke} stopOpacity=".58" />
            <stop offset="100%" stopColor={stroke} stopOpacity="1" />
          </linearGradient>
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
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {latestPoint ? <circle cx={latestPoint.x} cy={latestPoint.y} r="4.5" fill={stroke} stroke="#e2e8f0" strokeWidth="1.5" /> : null}
          </>
        ) : (
          <text x="160" y="94" textAnchor="middle" fill="#64748b" fontSize="11">Not enough shared support</text>
        )}
        <text x="160" y="176" textAnchor="middle" fill="#64748b" fontSize="9">{xCoordinate?.label ?? definition.x} →</text>
        <text x="7" y="90" textAnchor="middle" fill="#64748b" fontSize="9" transform="rotate(-90 7 90)">{yCoordinate?.label ?? definition.y} →</text>
      </svg>
      <p className="text-[10px] leading-4 text-slate-500">Shared subject domain · latest supported hue: teal ≥ 0, violet &lt; 0 · gaps remain broken · no cycle inference</p>
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
): string {
  const finiteValues = values.filter(finite);
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

function RelativeProgressTrace({
  data,
}: {
  data: MarketWeatherComparisonResponse;
}) {
  const rows = downsample(data.price_series, 180);
  const relative = rows.map((point) => point.relative_index);
  const betaResidual = rows.map((point) => point.beta_adjusted_cumulative_return ?? null);
  const latestRelative = [...relative].reverse().find(finite);
  const latestResidual = [...betaResidual].reverse().find(finite);

  return (
    <section className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="page-kicker">Observed progress</span>
          <h3 className="mt-1 text-sm font-semibold text-white">Relative price and prior-only beta residual</h3>
        </div>
        <span className="rounded-full border border-stealth-700 px-2 py-1 text-[10px] text-slate-400">
          {data.overlap.common_observations.toLocaleString()} exact shared bars
        </span>
      </div>
      <svg viewBox="0 0 700 190" className="mt-1 h-[176px] w-full" role="img" aria-label={`${data.target.symbol} relative price and prior-only beta residual versus ${data.benchmark.symbol}`}>
        <line x1="50" x2="682" y1="96" y2="96" stroke="rgba(71,85,105,.45)" />
        <line x1="50" x2="682" y1="143" y2="143" stroke="rgba(100,116,139,.3)" strokeDasharray="3 5" />
        <path d={scaledLanePath(relative, 632, 18, 62)} fill="none" stroke="#2dd4bf" strokeWidth="2.1" vectorEffect="non-scaling-stroke" />
        <path d={scaledLanePath(betaResidual, 632, 111, 64, true)} fill="none" stroke="#fbbf24" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <text x="5" y="32" fill="#94a3b8" fontSize="10">relative</text>
        <text x="5" y="45" fill="#64748b" fontSize="9">index</text>
        <text x="5" y="133" fill="#94a3b8" fontSize="10">β residual</text>
        <text x="5" y="146" fill="#64748b" fontSize="9">cumulative</text>
        <text x="50" y="187" fill="#64748b" fontSize="10">{rows[0]?.date ?? ""}</text>
        <text x="682" y="187" fill="#64748b" fontSize="10" textAnchor="end">{rows[rows.length - 1]?.date ?? ""}</text>
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] leading-4 text-slate-500">
        <span><i className="mr-1 inline-block h-0.5 w-4 bg-teal-400 align-middle" />target / benchmark, rebased at shared-window start</span>
        <span><i className="mr-1 inline-block h-0.5 w-4 bg-amber-300 align-middle" />current contiguous prior-only beta-residual chain</span>
      </div>
      <p className="sr-only">
        Latest relative index {finite(latestRelative) ? latestRelative.toFixed(2) : "unavailable"}.
        Latest cumulative beta residual {finite(latestResidual) ? `${latestResidual.toFixed(2)} percent` : "unavailable"}.
      </p>
    </section>
  );
}

function DimensionTrend({
  coordinate,
  basis,
  targetSymbol,
  benchmarkSymbol,
}: {
  coordinate: MarketWeatherComparisonCoordinate;
  basis: MarketWeatherComparisonBasis;
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

  return (
    <div className="self-start rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-white">{coordinate.label} through shared time</div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {basis === "context" ? "Each side uses its fixed proper-fit scale on shared evaluation timestamps." : "Direct coordinate units from the same field recipe."}
          </p>
        </div>
        <span className="rounded-full border border-stealth-700 px-2 py-1 font-mono text-[10px] text-slate-300">
          gap {formatNumber(latestDifference(coordinate, basis))}
        </span>
      </div>
      <svg viewBox="0 0 680 170" className="mt-2 h-[180px] w-full" role="img" aria-label={`${coordinate.label} comparison history`}>
        <line x1="48" x2="664" y1="82" y2="82" stroke="rgba(100,116,139,.35)" strokeDasharray="3 5" />
        <path d={linePath(target, 616, 12, 140, extent)} fill="none" stroke="#38bdf8" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <path d={linePath(benchmark, 616, 12, 140, extent)} fill="none" stroke="#a78bfa" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <path d={linePath(difference, 616, 12, 140, extent)} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <text x="48" y="166" fill="#64748b" fontSize="10">{rows[0]?.date ?? ""}</text>
        <text x="664" y="166" fill="#64748b" fontSize="10" textAnchor="end">{rows[rows.length - 1]?.date ?? ""}</text>
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
        <span><i className="mr-1 inline-block h-0.5 w-4 bg-sky-400 align-middle" />{targetSymbol}</span>
        <span><i className="mr-1 inline-block h-0.5 w-4 bg-violet-400 align-middle" />{benchmarkSymbol}</span>
        <span><i className="mr-1 inline-block h-0.5 w-4 border-t border-dashed border-amber-300 align-middle" />difference</span>
      </div>
    </div>
  );
}

export default function MarketWeatherComparisonLab({
  data,
  basis,
  view,
  selectedDimension,
  onBasisChange,
  onViewChange,
  onDimensionChange,
}: MarketWeatherComparisonLabProps) {
  const coordinateMap = useMemo(
    () => new Map(data.coordinates.map((coordinate) => [coordinate.id, coordinate])),
    [data.coordinates],
  );
  const selected = coordinateMap.get(selectedDimension) ?? data.coordinates[0];
  const fullySupported = data.coordinates.filter(
    (coordinate) => coordinate.latest.target_supported
      && coordinate.latest.benchmark_supported
      && coordinate.latest.pair_supported !== false
      && finite(latestDifference(coordinate, basis)),
  ).length;
  const unsupported = data.coordinates.length - fullySupported;
  const sessionCompatibility = data.overlap.session_compatibility
    ?? (data.overlap.session_compatible === true
      ? "compatible"
      : data.overlap.session_compatible === false ? "incompatible" : "unknown");
  const alignmentSupported = data.overlap.alignment_supported !== false
    && data.overlap.alignment_status !== "unsupported";
  const gapTone = (data.relative_progress.active_return_pct ?? 0) > 0
    ? "text-emerald-300"
    : (data.relative_progress.active_return_pct ?? 0) < 0 ? "text-rose-300" : "text-slate-200";

  return (
    <section className="primary-card overflow-hidden" aria-labelledby="pair-field-title">
      <header className="border-b border-stealth-700 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="page-kicker">Relative field</span>
              <span className="page-badge border-teal-400/20 text-teal-200"><ArrowRightLeft className="h-3.5 w-3.5" /> Shared bars only</span>
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
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-xl border border-stealth-600 bg-slate-950/55 p-1" role="group" aria-label="Comparison basis">
              {(["context", "native"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onBasisChange(option)}
                  aria-pressed={basis === option}
                  className={`min-h-9 rounded-lg px-3 text-xs font-medium transition ${basis === option ? "bg-teal-400/15 text-teal-200 ring-1 ring-teal-400/30" : "text-slate-400 hover:text-white"}`}
                  title={option === "context" ? "Difference after each side is scaled using its fixed proper-fit segment, emitted only on shared evaluation timestamps" : "Direct difference in common coordinate units"}
                >
                  {option === "context" ? "Fit-relative context" : "Native units"}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-xl border border-stealth-600 bg-slate-950/55 p-1" role="group" aria-label="Scope subject">
              {(["target", "benchmark", "difference"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onViewChange(option)}
                  aria-pressed={view === option}
                  className={`min-h-9 rounded-lg px-3 text-xs font-medium capitalize transition ${view === option ? "bg-violet-400/15 text-violet-200 ring-1 ring-violet-400/30" : "text-slate-400 hover:text-white"}`}
                >
                  {option === "target" ? data.target.symbol : option === "benchmark" ? data.benchmark.symbol : "Difference"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-4 p-3 sm:p-4">
        {!alignmentSupported ? (
          <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-950/20 p-4 text-sm text-rose-100">
            <div className="font-semibold">This timeframe pair cannot be aligned safely.</div>
            <p className="mt-1 text-xs leading-5 text-rose-200/75">{data.overlap.note} No nearest timestamp or carried value was substituted.</p>
          </div>
        ) : null}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-700 lg:grid-cols-5">
          {[
            ["Active progress", formatPercent(data.relative_progress.active_return_pct), `${data.overlap.common_observations} aligned bars`, gapTone],
            ["Beta-adjusted", formatPercent(data.relative_progress.beta_adjusted_return_pct), `prior-only β ${finite(data.relative_progress.beta) ? data.relative_progress.beta.toFixed(2) : "—"} · up to ${data.relative_progress.lookback_bars} bars`, "text-sky-200"],
            [data.target.symbol, formatLevel(data.relative_progress.latest_target_close), "latest aligned level", "text-white"],
            [data.benchmark.symbol, formatLevel(data.relative_progress.latest_benchmark_close), "latest aligned level", "text-white"],
            ["Fit-relative stretch", data.relative_progress.gap_direction.replace(/_/g, " "), "family-balanced magnitude vs 5 bars prior", "text-amber-200"],
          ].map(([label, value, note, tone], index) => (
            <div key={`${index}-${label}`} className={`min-w-0 bg-slate-950/80 p-3.5 ${index === 4 ? "col-span-2 lg:col-span-1" : ""}`}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
              <div className={`mt-1 text-base font-semibold capitalize ${tone}`}>{value}</div>
              <div className="mt-0.5 text-[10px] leading-4 text-slate-500">{note}</div>
            </div>
          ))}
        </section>

        <RelativeProgressTrace data={data} />

        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <span className="page-kicker">Relationship scopes</span>
              <h3 className="mt-1 text-base font-semibold text-white">How the paired field is moving</h3>
            </div>
            <p className="text-[11px] text-slate-500">Same observations · one shared axis domain per scope · descriptive trajectories</p>
          </div>
          <p className="mb-2 text-[10px] text-slate-500 lg:hidden" aria-hidden="true">Swipe to explore all four scopes →</p>
          <div className="grid auto-cols-[84vw] grid-flow-col gap-3 overflow-x-auto pb-2 snap-x snap-mandatory sm:auto-cols-[62vw] lg:auto-cols-auto lg:grid-flow-row lg:grid-cols-2 lg:overflow-visible lg:pb-0">
            {SCOPE_DEFINITIONS.map((definition) => (
              <ScopeChart
                key={definition.id}
                definition={definition}
                coordinates={coordinateMap}
                basis={basis}
                view={view}
                targetSymbol={data.target.symbol}
                benchmarkSymbol={data.benchmark.symbol}
              />
            ))}
          </div>
        </section>

        <section className="grid gap-3 xl:grid-cols-[minmax(300px,.72fr)_minmax(0,1.28fr)]">
          <div className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-3.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <span className="page-kicker">15-coordinate differential</span>
                <h3 className="mt-1 text-sm font-semibold text-white">State separation through time</h3>
              </div>
              <span className="text-[10px] text-slate-500">latest ≤72 bars · older → newer</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {data.coordinates.map((coordinate) => {
                const supported = coordinate.latest.target_supported
                  && coordinate.latest.benchmark_supported
                  && coordinate.latest.pair_supported !== false
                  && finite(latestDifference(coordinate, basis));
                const active = coordinate.id === selected?.id;
                return (
                  <button
                    key={coordinate.id}
                    type="button"
                    onClick={() => onDimensionChange(coordinate.id)}
                    aria-pressed={active}
                    className={`grid min-h-10 w-full grid-cols-[96px_minmax(80px,1fr)_58px] items-center gap-2 rounded-lg border px-2 text-left transition sm:grid-cols-[128px_minmax(100px,1fr)_66px] ${active ? "border-sky-400/50 bg-sky-400/[0.08]" : "border-transparent hover:border-stealth-600 hover:bg-white/[0.025]"}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium leading-3.5 text-slate-200">{coordinate.label}</span>
                      <span className="block truncate text-[9px] uppercase tracking-[0.1em] text-slate-600">{FAMILY_LABELS[coordinate.family] ?? coordinate.family}</span>
                    </span>
                    <span
                      className={`h-5 rounded ${supported ? "" : "opacity-35 grayscale"}`}
                      style={{ backgroundImage: heatGradient(coordinate, basis) }}
                      aria-hidden="true"
                    />
                    <span className={`text-right font-mono text-[10px] ${supported ? "text-slate-300" : "text-amber-300"}`}>
                      {supported ? formatNumber(latestDifference(coordinate, basis)) : "limited"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-stealth-700 pt-2 text-[10px] text-slate-500">
              <span className="text-violet-300">benchmark higher ←</span>
              <span className="text-teal-300">→ target higher</span>
            </div>
          </div>
          {selected ? (
            <DimensionTrend
              coordinate={selected}
              basis={basis}
              targetSymbol={data.target.symbol}
              benchmarkSymbol={data.benchmark.symbol}
            />
          ) : (
            <div className="grid min-h-[240px] place-items-center rounded-2xl border border-stealth-700 text-sm text-slate-500">
              No comparable coordinates were returned.
            </div>
          )}
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-3.5">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <div>
                <h3 className="text-xs font-semibold text-white">Alignment & support</h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">
                  {data.overlap.common_observations.toLocaleString()} common provider/cache bars from {formatDate(data.overlap.start, data.timeframe)} to {formatDate(data.overlap.end, data.timeframe)}.
                  {" "}{Math.round(data.overlap.support_fraction * 100)}% shared support; {data.overlap.target_dropped} target and {data.overlap.benchmark_dropped} benchmark timestamps were excluded without forward-filling.
                </p>
                {data.generated_at || data.cache?.analysis?.status ? (
                  <p className="mt-1 text-[10px] text-slate-500">
                    {data.cache?.analysis?.status ? `Pair calculation: ${data.cache.analysis.status}. ` : ""}
                    {data.generated_at ? `Generated ${formatDate(data.generated_at, data.timeframe)}.` : ""}
                  </p>
                ) : null}
                <p className={`mt-1 text-[10px] ${sessionCompatibility === "compatible" ? "text-emerald-300" : "text-amber-300"}`}>
                  {sessionCompatibility === "compatible"
                    ? "Sessions are marked compatible by the response contract."
                    : sessionCompatibility === "incompatible"
                      ? "Sessions are incompatible; the relationship is unavailable or materially limited."
                      : "Session compatibility is unknown and is not certified."}
                  {unsupported ? ` ${unsupported} latest coordinate${unsupported === 1 ? " lacks" : "s lack"} bilateral support.` : ""}
                </p>
                {(data.overlap.target_unmatched_after_latest_aligned ?? 0) > 0 || (data.overlap.benchmark_unmatched_after_latest_aligned ?? 0) > 0 ? (
                  <p className="mt-1 text-[10px] leading-4 text-amber-300">
                    Latest returned rows do not share an anchor: {data.target.symbol} {formatDate(data.overlap.target_latest_returned_at, data.timeframe)} · {data.benchmark.symbol} {formatDate(data.overlap.benchmark_latest_returned_at, data.timeframe)}. The summary remains pinned to {formatDate(data.overlap.latest_aligned_at, data.timeframe)}.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
              <div>
                <h3 className="text-xs font-semibold text-white">Identity & authority boundary</h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">{data.provenance.note}</p>
                <p className="mt-1 break-all font-mono text-[9px] text-slate-600" title={data.comparison_hash}>
                  comparison {data.comparison_hash.slice(0, 16)} · target {data.target.analysis_hash.slice(0, 10)} · benchmark {data.benchmark.analysis_hash.slice(0, 10)}
                </p>
                {data.target.provider_symbol || data.benchmark.provider_symbol ? (
                  <p className="mt-1 text-[10px] text-slate-500">
                    Provider symbols: {data.target.symbol} → {data.target.provider_symbol ?? data.target.symbol} · {data.benchmark.symbol} → {data.benchmark.provider_symbol ?? data.benchmark.symbol}
                  </p>
                ) : null}
                {data.provenance.identity_control ? (
                  <p className="mt-1 text-[10px] text-amber-300">
                    Same-analysis identity control: supported signed differences should be zero.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2.5 text-[11px] leading-5 text-amber-100/80">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            Relative price and beta-adjusted progress remain separate from field differences. Positive coordinate gaps mean “more of this measured quantity” in the target—not higher quality, a forecast, or a trade signal.
          </div>
        </div>

        <details className="group overflow-hidden rounded-2xl border border-stealth-700 bg-slate-950/25">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left">
            <div>
              <span className="page-kicker">Relative Field methodology</span>
              <h3 className="mt-1 text-sm font-semibold text-white">Definitions, chronology, and limits</h3>
            </div>
            <span className="text-xs text-slate-500 transition group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <div className="grid gap-px border-t border-stealth-700 bg-stealth-700 md:grid-cols-2">
            {[
              ["Relative index", "The target level divided by the benchmark level is rebased to 100 at the first shared returned bar. It measures observed relative progress, not field quality."],
              ["Native gap", "For coordinate k, the direct gap is x(target,k) − x(benchmark,k) on the coordinate's own 15D scale—not raw market units. A positive result means more of that measured quantity in the target."],
              ["Context gap", "The displayed context gap is target_context − benchmark_context. Each side uses median and IQR fixed on its proper fit segment; values appear only on shared evaluation timestamps, and evaluation values never refit the scale."],
              ["Active progress & beta", "Active progress is the target/benchmark relative index minus 100. A residual chain begins only after 20 prior aligned log returns and uses up to 60 strictly prior observations. It resets when benchmark variation is too small or beta fails its quality gate; stale beta is never carried forward. Field coordinates are never multiplied by price beta."],
              ["Fit-relative stretch", "This label family-balances the mean absolute context gaps over the same supported coordinate intersection and compares the latest value with five bars earlier. Changes smaller than max(0.05, 5% of the earlier value) are labeled mixed."],
              ["Alignment & support", "Only timestamp intersections of provider/cache rows are used. No prices or coordinates are forward-filled. The endpoint does not independently certify the latest row as exchange-complete. A pair value is supported only when both component coordinates are measured and dependency-supported."],
              ["Identity & authority", "The ordered comparison hash binds the two component analysis hashes, recipe, and alignment. Pair output is descriptive research with zero scanner, sizing, execution, or manager-decision authority."],
            ].map(([title, body]) => (
              <article key={title} className="bg-slate-950/75 p-4">
                <h4 className="text-xs font-semibold text-slate-200">{title}</h4>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">{body}</p>
              </article>
            ))}
          </div>
          {data.caveats.length ? (
            <div className="border-t border-stealth-700 bg-slate-950/70 p-4">
              <h4 className="text-xs font-semibold text-slate-200">Response-specific caveats</h4>
              <ul className="mt-2 grid gap-1 text-[11px] leading-5 text-slate-500 md:grid-cols-2 md:gap-x-6">
                {data.caveats.map((caveat) => <li key={caveat}>• {caveat}</li>)}
              </ul>
            </div>
          ) : null}
        </details>
      </div>
    </section>
  );
}
