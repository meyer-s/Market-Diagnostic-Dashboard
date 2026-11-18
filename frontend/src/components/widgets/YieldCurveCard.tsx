import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useApi } from "../../hooks/useApi";
import DetailsDisclosure from "../ui/DetailsDisclosure";


interface CurvePoint {
  maturity: string;
  yield: number;
  basis?: string;
}

interface CurveEntry {
  date: string;
  curve: CurvePoint[];
}

interface ComparisonObservation {
  period_label: string;
  curve: CurvePoint[];
  source?: { name: string; url: string };
}

interface ComparisonCurve extends ComparisonObservation {
  period_start: string;
  period_end: string;
  source: { name: string; url: string };
  input_source?: { name: string; url: string };
  data_quality: { stale: boolean; partial: boolean; published_snapshot?: boolean };
  history?: ComparisonObservation[];
}

interface YieldCurveResponse {
  as_of?: string;
  fetched_at?: string;
  source?: {
    name?: string;
    url?: string;
    series?: string;
    frequency?: string;
  };
  data_quality?: {
    status?: "complete" | "partial" | "stale";
    stale?: boolean;
    latest_observation_age_days?: number;
    maturities_received?: number;
    maturities_expected?: number;
  };
  warnings?: string[];
  curves: CurveEntry[];
}

interface CurveTooltipItem {
  color?: string;
  dataKey?: string | number;
  name?: string;
  value?: number | string | null;
}

interface CurveTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly CurveTooltipItem[];
}

const MATURITY_ORDER = ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
const DAILY_CURVE_STYLES = [
  { color: "#83bfff", opacity: 1, width: 3 },
  { color: "#68a9ee", opacity: 0.72, width: 2.1 },
  { color: "#5796d9", opacity: 0.55, width: 1.7 },
  { color: "#477ead", opacity: 0.42, width: 1.4 },
  { color: "#3b668d", opacity: 0.3, width: 1.2 },
];
const MONTHLY_CURVE_STYLES = [
  { opacity: 0.55, width: 1.8 },
  { opacity: 0.45, width: 1.6 },
  { opacity: 0.36, width: 1.4 },
  { opacity: 0.28, width: 1.2 },
  { opacity: 0.2, width: 1.1 },
];
const MONTHLY_CURVE_COLOR = "#fbbf24";
const MOVING_AVERAGE_COLOR = "#d5dfec";
const COMPARISON_PATH = "/indicators/BOND_MARKET_STABILITY/yield-curve";
const COMPARISONS = [
  {
    key: "corporate",
    label: "Corporate bonds",
    lineName: "HQM corporate",
    color: "#f0abfc",
    dash: "6 3",
    description: "Treasury HQM month-end investment-grade corporate par yields at 2Y, 5Y, 10Y and 30Y.",
    historyLabel: "earlier month-ends",
  },
  {
    key: "municipal",
    label: "Muni bonds",
    lineName: "NYC tax-exempt GO",
    color: "#6ee7b7",
    dash: "2 4",
    description: "Selected NYC general-obligation offerings. Yields are tax-exempt, quoted at issuance, and may be to first call. Terms are approximate calendar-year buckets.",
    historyLabel: "earlier offerings",
  },
  {
    key: "infrastructure",
    label: "Infrastructure loans",
    lineName: "EPA WIFIA benchmark",
    color: "#fb923c",
    dash: "8 3 2 3",
    description: "Estimated federal water infrastructure loan rates using SLGS plus 1 bp by weighted-average loan life. Actual rates are set at closing.",
    historyLabel: "earlier rate dates",
  },
] as const;
const HISTORY_OPACITY = [0.48, 0.34, 0.26, 0.2];
const maturityMonths = (label: string) => parseInt(label, 10) * (label.endsWith("Y") ? 12 : 1);

const formatObservationDate = (value?: string) => {
  if (!value) return "Date unavailable";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};

const formatRate = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}%`;
const formatCurveValue = (value: number) => `${value.toFixed(2)}%`;

function CurveValues({ points }: { points: CurvePoint[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-2 pb-2 sm:grid-cols-4">
      {points.map((point) => (
        <div key={point.maturity} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 border-b border-stealth-800 py-1">
          <dt className="text-stealth-400">{point.maturity}</dt>
          <dd className="text-right font-mono font-semibold tabular-nums text-stealth-100">{formatCurveValue(point.yield)}</dd>
          {point.basis && <dd className="col-span-2 text-xs text-stealth-300">{point.basis}</dd>}
        </div>
      ))}
    </dl>
  );
}


const formatBasisPointMove = (current: number | null, prior: number | null) => {
  if (current === null || prior === null) return "No comparison";
  const basisPoints = (current - prior) * 100;
  const prefix = basisPoints > 0 ? "+" : "";
  return `${prefix}${basisPoints.toFixed(0)} bp d/d`;
};

const getCurveMap = (entry?: CurveEntry) =>
  new Map((entry?.curve ?? []).map((point) => [point.maturity, point.yield]));

const getTooltipSection = (dataKey?: string | number) => {
  if (typeof dataKey !== "string") return "other";
  if (dataKey.startsWith("daily_")) return "daily";
  if (COMPARISONS.some(({ key }) => key === dataKey)) return "comparison";
  if (dataKey.startsWith("monthly_")) return "monthly";
  if (dataKey === "moving_average") return "average";
  return "other";
};

const getTooltipOrder = (dataKey?: string | number) => {
  const section = getTooltipSection(dataKey);
  if (section === "daily") return 0;
  if (section === "comparison") return 1;
  if (section === "monthly") return 2;
  if (section === "average") return 3;
  return 4;
};

const renderCurveTooltip = ({ active, payload, label }: CurveTooltipProps) => {
  if (!active || !payload?.length) return null;

  const visibleItems = payload
    .filter((item) => typeof item.value === "number" && !String(item.dataKey).includes("_history_"))
    .sort((left, right) => getTooltipOrder(left.dataKey) - getTooltipOrder(right.dataKey));
  if (!visibleItems.length) return null;

  let currentSection = "";
  return (
    <div className="min-w-56 rounded-lg border border-stealth-600 bg-stealth-950/95 p-3 shadow-[0_10px_30px_rgba(2,6,23,0.55)]">
      <p className="mb-2 text-sm font-semibold text-stealth-100">{label} maturity</p>
      <div className="space-y-1.5">
        {visibleItems.map((item, index) => {
          const section = getTooltipSection(item.dataKey);
          const showSectionLabel = section !== currentSection;
          currentSection = section;
          const sectionLabel = {
            daily: "Recent sessions",
            comparison: "Comparison curves",
            monthly: "Monthly checkpoints",
            average: "Long-run reference",
            other: "Other",
          }[section];

          return (
            <Fragment key={`${String(item.dataKey)}-${index}`}>
              {showSectionLabel ? (
                <p className="pt-1 text-xs font-semibold text-stealth-400">{sectionLabel}</p>
              ) : null}
              <div className="flex items-center justify-between gap-5 text-xs">
                <span className="flex items-center gap-2 text-stealth-200">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color ?? MOVING_AVERAGE_COLOR }} />
                  {item.name ?? "Curve"}
                </span>
                <span className="font-mono font-semibold tabular-nums text-stealth-100">
                  {formatCurveValue(Number(item.value))}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};

const describeSlope = (spread: number | null) => {
  if (spread === null) return { label: "Unavailable", tone: "text-stealth-300" };
  if (spread < 0) return { label: "Inverted", tone: "text-red-300" };
  if (spread < 0.5) return { label: "Positive, flat", tone: "text-amber-300" };
  return { label: "Upward sloping", tone: "text-green-300" };
};

export default function YieldCurveCard() {
  const [showCorporate, setShowCorporate] = useState(false);
  const [showMunicipal, setShowMunicipal] = useState(false);
  const [showInfrastructure, setShowInfrastructure] = useState(false);
  const { data, loading, error, refetch } = useApi<YieldCurveResponse>(
    "/indicators/BOND_MARKET_STABILITY/yield-curve?months=12",
    { timeoutMs: 50_000 },
  );
  const corporate = useApi<ComparisonCurve>(showCorporate ? `${COMPARISON_PATH}/corporate` : "");
  const municipal = useApi<ComparisonCurve>(showMunicipal ? `${COMPARISON_PATH}/municipal` : "");
  const infrastructure = useApi<ComparisonCurve>(showInfrastructure ? `${COMPARISON_PATH}/infrastructure` : "");
  const comparisons = [
    { ...COMPARISONS[0], enabled: showCorporate, toggle: setShowCorporate, request: corporate },
    { ...COMPARISONS[1], enabled: showMunicipal, toggle: setShowMunicipal, request: municipal },
    { ...COMPARISONS[2], enabled: showInfrastructure, toggle: setShowInfrastructure, request: infrastructure },
  ];
  const loadedComparisons = comparisons.flatMap((item) => {
    const series = item.request.data;
    return item.enabled && series?.curve?.length
      ? [{ ...item, series }]
      : [];
  });

  const latest = data?.curves?.[0];
  const previous = data?.curves?.[1];

  const onionSkin = useMemo(() => {
    const curves = data?.curves ?? [];
    const dailyCurves = curves.slice(0, 5);
    const latestMonth = dailyCurves[0]?.date.slice(0, 7);
    const seenMonths = new Set(latestMonth ? [latestMonth] : []);
    const monthlyCurves: CurveEntry[] = [];

    for (const entry of curves) {
      const month = entry.date.slice(0, 7);
      if (seenMonths.has(month)) continue;
      monthlyCurves.push(entry);
      seenMonths.add(month);
      if (monthlyCurves.length === 5) break;
    }

    const movingAverageWindow = curves.slice(0, 200);
    const dailyCurveMaps = dailyCurves.map(getCurveMap);
    const monthlyCurveMaps = monthlyCurves.map(getCurveMap);
    const movingAverageMaps = movingAverageWindow.map(getCurveMap);
    const chartData = MATURITY_ORDER.map((maturity) => {
      const row: Record<string, string | number | null> = { maturity };

      dailyCurveMaps.forEach((curveMap, index) => {
        row[`daily_${index}`] = curveMap.get(maturity) ?? null;
      });
      monthlyCurveMaps.forEach((curveMap, index) => {
        row[`monthly_${index}`] = curveMap.get(maturity) ?? null;
      });

      const averageValues = movingAverageMaps
        .map((curveMap) => curveMap.get(maturity))
        .filter((value): value is number => typeof value === "number");
      row.moving_average = averageValues.length
        ? averageValues.reduce((sum, value) => sum + value, 0) / averageValues.length
        : null;
      return row;
    });

    return {
      chartData,
      dailyCurves,
      monthlyCurves,
      movingAverageSessions: movingAverageWindow.length,
    };
  }, [data?.curves]);

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-3" role="status" aria-label="Loading Treasury yield-curve evidence">
        <div className="surface-card-strong min-h-80 animate-pulse p-5 sm:p-6 lg:col-span-2 lg:row-span-2">
          <div className="h-5 w-52 rounded bg-stealth-700" />
          <div className="mt-5 h-60 rounded-xl bg-stealth-800" />
        </div>
        {["shape", "benchmarks"].map((key) => (
          <div key={key} className="surface-card min-h-36 animate-pulse p-5">
            <div className="h-4 w-28 rounded bg-stealth-700" />
            <div className="mt-5 h-14 rounded bg-stealth-800" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !latest || !latest.curve?.length) {
    return (
      <div className="surface-card-strong border-red-800/70 p-5 sm:p-6" role="alert">
        <h3 className="text-lg font-semibold text-red-200">Treasury yield curve unavailable</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-red-200/90">
          The latest official Treasury curve could not be loaded. Other dashboard evidence remains available.
        </p>
        <button
          type="button"
          onClick={refetch}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-red-700 bg-red-950/50 px-4 text-sm font-semibold text-red-100 transition-colors hover:bg-red-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          Retry Treasury curve
        </button>
      </div>
    );
  }

  const latestMap = getCurveMap(latest);
  const previousMap = getCurveMap(previous);
  const y3m = latestMap.get("3M") ?? null;
  const y2 = latestMap.get("2Y") ?? null;
  const y5 = latestMap.get("5Y") ?? null;
  const y10 = latestMap.get("10Y") ?? null;
  const y30 = latestMap.get("30Y") ?? null;
  const spread10y2y = y10 !== null && y2 !== null ? y10 - y2 : null;
  const spread10y3m = y10 !== null && y3m !== null ? y10 - y3m : null;
  const spread30y5y = y30 !== null && y5 !== null ? y30 - y5 : null;
  const previousY10 = previousMap.get("10Y") ?? null;
  const previousY2 = previousMap.get("2Y") ?? null;
  const previousSpread10y2y = previousY10 !== null && previousY2 !== null
    ? previousY10 - previousY2
    : null;
  const slope = describeSlope(spread10y2y);
  const qualityStatus = data?.data_quality?.status ?? "complete";
  const isStale = qualityStatus === "stale" || data?.data_quality?.stale === true;
  const qualityLabel = isStale
    ? "Last known official curve"
    : qualityStatus === "partial"
      ? "Partial official curve"
      : "Current official curve";
  const qualityTone = isStale || qualityStatus === "partial"
    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
    : "border-green-500/35 bg-green-500/10 text-green-200";
  const spreadMove = spread10y2y !== null && previousSpread10y2y !== null
    ? (spread10y2y - previousSpread10y2y) * 100
    : null;
  const curveRead = spread10y2y === null
    ? "The 10Y–2Y shape cannot be calculated from the available maturities."
    : spread10y2y < 0
      ? "The 10Y remains below the 2Y, so the closely watched curve segment is inverted."
      : spread10y2y < 0.5
        ? "The 10Y is above the 2Y, but the term spread remains compressed."
        : "The 10Y sits clearly above the 2Y, producing an upward-sloping curve segment.";

  const benchmarks = [
    { label: "2Y", value: y2, prior: previousMap.get("2Y") ?? null, context: "Policy-sensitive" },
    { label: "10Y", value: y10, prior: previousMap.get("10Y") ?? null, context: "Growth + inflation" },
    { label: "30Y", value: y30, prior: previousMap.get("30Y") ?? null, context: "Long-duration" },
  ];
  const comparisonLines = loadedComparisons.flatMap(({ key, lineName, color, dash, series }) =>
    [series, ...(series.history ?? [])].map((observation, age) => ({
      key: age === 0 ? key : `${key}_history_${age}`,
      name: `${lineName} · ${observation.period_label}`,
      values: new Map(observation.curve.map((point) => [point.maturity, point.yield])),
      age, color, dash,
    })),
  );
  const treasuryRows = new Map(onionSkin.chartData.map((row) => [String(row.maturity), row]));
  const maturities = [...new Set([...MATURITY_ORDER, ...comparisonLines.flatMap(({ values }) => [...values.keys()])])]
    .sort((left, right) => maturityMonths(left) - maturityMonths(right));
  const chartData = maturities.map((maturity) => ({
    ...treasuryRows.get(maturity),
    maturity,
    ...Object.fromEntries(comparisonLines.map(({ key, values }) => [key, values.get(maturity) ?? null])),
  }));
  const chartComparisons = loadedComparisons.map(({ lineName, series }) => `${lineName} (${series.period_label})`);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <article className="surface-card-strong p-5 sm:p-6 lg:col-span-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold text-stealth-100">Official Treasury curve</h3>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${qualityTone}`}>
                {qualityLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-stealth-300">
              Latest close {formatObservationDate(data?.as_of ?? latest.date)} · onion skin: {onionSkin.dailyCurves.length} sessions, {onionSkin.monthlyCurves.length} monthly checkpoints, {onionSkin.movingAverageSessions}-session mean
            </p>
          </div>
          <Link
            to="/bond_health_stability"
            className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-sky-300 underline decoration-sky-500/50 underline-offset-4 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            Open bond evidence
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold text-stealth-300" aria-hidden="true">Compare</span>
          <div className="segmented-control flex-wrap" role="group" aria-label="Compare lending curves">
            {comparisons.map(({ key, label, color, dash, enabled, toggle }) => (
              <button
                key={key}
                type="button"
                className="segmented-control-option inline-flex items-center gap-2"
                aria-pressed={enabled}
                data-selected={enabled}
                onClick={() => toggle(!enabled)}
              >
                <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
                  <path d="M0 4h18" stroke={color} strokeWidth="2" strokeDasharray={dash} />
                </svg>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 h-64 sm:h-72 lg:h-96">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart
              accessibilityLayer
              aria-label={`Onion-skinned Treasury yield curves through ${latest.date}, including recent sessions, monthly checkpoints, and a ${onionSkin.movingAverageSessions}-session mean${chartComparisons.length ? `. Overlays: ${chartComparisons.join(", ")}` : ""}`}
              data={chartData}
              margin={{ top: 8, right: 10, left: -10, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis
                dataKey="maturity"
                tick={{ fontSize: 12, fill: "#b7c3d3" }}
                axisLine={{ stroke: "#62758e" }}
                tickLine={{ stroke: "#62758e" }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#b7c3d3" }}
                axisLine={{ stroke: "#62758e" }}
                tickLine={{ stroke: "#62758e" }}
                tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                domain={["dataMin - 0.2", "dataMax + 0.2"]}
                width={52}
              />
              <Tooltip content={renderCurveTooltip} />
              {[...onionSkin.monthlyCurves].reverse().map((entry) => {
                const index = onionSkin.monthlyCurves.indexOf(entry);
                const style = MONTHLY_CURVE_STYLES[index] ?? MONTHLY_CURVE_STYLES[MONTHLY_CURVE_STYLES.length - 1];
                return (
                  <Line
                    key={`monthly_${entry.date}`}
                    type="monotone"
                    dataKey={`monthly_${index}`}
                    stroke={MONTHLY_CURVE_COLOR}
                    strokeOpacity={style.opacity}
                    strokeWidth={style.width}
                    dot={false}
                    name={formatObservationDate(entry.date)}
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              })}
              <Line
                type="monotone"
                dataKey="moving_average"
                stroke={MOVING_AVERAGE_COLOR}
                strokeOpacity={0.8}
                strokeWidth={2}
                strokeDasharray="2 6"
                dot={false}
                name={`${onionSkin.movingAverageSessions}-session mean`}
                connectNulls
                isAnimationActive={false}
              />
              {[...onionSkin.dailyCurves].reverse().map((entry) => {
                const index = onionSkin.dailyCurves.indexOf(entry);
                const style = DAILY_CURVE_STYLES[index] ?? DAILY_CURVE_STYLES[DAILY_CURVE_STYLES.length - 1];
                return (
                  <Line
                    key={`daily_${entry.date}`}
                    type="monotone"
                    dataKey={`daily_${index}`}
                    stroke={style.color}
                    strokeOpacity={style.opacity}
                    strokeWidth={style.width}
                    dot={index === 0 ? { r: 2.5, fill: style.color } : false}
                    activeDot={index === 0 ? { r: 5 } : undefined}
                    name={index === 0 ? `Latest · ${formatObservationDate(entry.date)}` : formatObservationDate(entry.date)}
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              })}
              {[...comparisonLines].sort((left, right) => right.age - left.age).map(({ key, name, color, dash, age }) => (
                <Line
                  key={key}
                  type="linear"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={age === 0 ? 2.4 : 1.6}
                  strokeOpacity={age === 0 ? 1 : HISTORY_OPACITY[age - 1]}
                  strokeDasharray={dash}
                  dot={age === 0 ? { r: 3, fill: color } : false}
                  activeDot={age === 0}
                  name={name}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-stealth-700 pt-3 text-xs text-stealth-300">
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 bg-sky-300" />Latest official close</span>
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 bg-sky-700/60" />Recent sessions fade with age</span>
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 bg-amber-400/60" />Monthly checkpoints</span>
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 border-t border-dashed border-stealth-200" />{onionSkin.movingAverageSessions}-session mean</span>
          <a
            href={data?.source?.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-stealth-200 underline decoration-stealth-500 underline-offset-4 hover:text-white"
          >
            Source: {data?.source?.name ?? "U.S. Department of the Treasury"}
          </a>
        </div>

        {comparisons.some(({ enabled }) => enabled) && (
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-stealth-300" aria-label="Comparison sources and dates">
            {comparisons.filter(({ enabled }) => enabled).map(({ key, label, request }) => (
              <li key={key}>
                {request.loading ? <span role="status">Loading {label.toLowerCase()} curve…</span> : request.error || !request.data?.curve?.length ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span role="status">{label} curve unavailable.</span>
                    <button type="button" className="field-button field-button-secondary" onClick={request.refetch}>Retry {label.toLowerCase()}</button>
                  </div>
                ) : (
                  <>
                    <span className="font-semibold text-stealth-100">{label} · {request.data.period_label}</span>
                    {" · "}
                    <a href={request.data.source.url} target="_blank" rel="noreferrer" className="font-semibold text-stealth-200 underline underline-offset-4">
                      {request.data.source.name}
                    </a>
                    {request.data.input_source && (
                      <>{" · "}<a href={request.data.input_source.url} target="_blank" rel="noreferrer" className="font-semibold text-stealth-200 underline underline-offset-4">{request.data.input_source.name}</a></>
                    )}
                    {request.data.data_quality.published_snapshot && <span className="block">Verified published schedule. Automatic refresh unavailable.</span>}
                    {request.data.data_quality.stale && <span className="block text-amber-200">Older data. Check the reporting period above.</span>}
                    {request.data.data_quality.partial && <span className="block text-amber-200">Some maturity points are missing.</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {loadedComparisons.length > 0 && (
          <DetailsDisclosure label="Comparison methodology" className="mt-3">
            <p>Dates, rate types, and tax treatment differ by series. Dots mark the latest plotted points.</p>
            {loadedComparisons.map(({ key, label, description, historyLabel, series }) => (
              <p key={key}>
                <strong>{label}</strong> · {description}
                {!!series.history?.length && <> {series.history.length} {historyLabel} shown as faded curves.</>}
                {key === "municipal" && <> Issuer examples come from reviewed statements. Coverage expands as offerings are reviewed.</>}
              </p>
            ))}
          </DetailsDisclosure>
        )}

        <details className="mt-3 border-t border-stealth-700 pt-3 text-sm text-stealth-300">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-stealth-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
            Read latest yields as values
          </summary>
          <CurveValues points={latest.curve} />
          {loadedComparisons.map(({ key, lineName, series }) => (
            <div key={key} className="mt-3">
              <p className="mb-1 font-semibold text-stealth-200">{lineName} · {series.period_label}</p>
              <CurveValues points={series.curve} />
              {!!series.history?.length && (
                <details className="mt-2 border-b border-stealth-700 pb-2">
                  <summary className="cursor-pointer py-2 text-xs font-semibold text-stealth-200">{lineName} history</summary>
                  {series.history.map((entry) => (
                    <div key={entry.period_label} className="mt-2">
                      <p className="mb-1 text-xs text-stealth-300">
                        {entry.period_label}
                        {entry.source && <>{" · "}<a href={entry.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">{entry.source.name}</a></>}
                      </p>
                      <CurveValues points={entry.curve} />
                    </div>
                  ))}
                </details>
              )}
            </div>
          ))}
        </details>
      </article>

      <div className="grid content-start gap-3">
        <article className="surface-card p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-stealth-100">Curve shape</h3>
            <span className={`text-sm font-semibold ${slope.tone}`}>{slope.label}</span>
          </div>
          <dl className="mt-5 divide-y divide-stealth-700 border-y border-stealth-700">
            {[
              { label: "10Y − 2Y", value: spread10y2y },
              { label: "10Y − 3M", value: spread10y3m },
              { label: "30Y − 5Y", value: spread30y5y },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-sm text-stealth-300">{item.label}</dt>
                <dd className="font-mono text-base font-semibold tabular-nums text-stealth-100">{formatRate(item.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs font-semibold text-stealth-400">
            {spreadMove === null
              ? "Daily slope change unavailable"
              : `${spreadMove >= 0 ? "Steepened" : "Flattened"} ${Math.abs(spreadMove).toFixed(0)} bp vs prior session`}
          </p>
          <DetailsDisclosure label="How to read the curve" className="mt-3">
            <p>{curveRead}</p>
            <p>The spreads describe the current curve shape.</p>
          </DetailsDisclosure>
        </article>

        <article className="surface-card p-5">
          <h3 className="text-lg font-semibold text-stealth-100">Benchmark yields</h3>
          <dl className="mt-5 divide-y divide-stealth-700 border-y border-stealth-700">
            {benchmarks.map((benchmark) => (
              <div key={benchmark.label} className="grid grid-cols-[1fr_auto] gap-x-4 py-2.5">
                <dt className="text-sm font-semibold text-stealth-200">
                  {benchmark.label}
                  <span className="mt-0.5 block text-xs font-normal text-stealth-500">{benchmark.context}</span>
                </dt>
                <dd className="text-right font-mono text-base font-semibold tabular-nums text-stealth-100">
                  {formatRate(benchmark.value)}
                  <span className="mt-0.5 block font-sans text-xs font-normal text-stealth-400">
                    {formatBasisPointMove(benchmark.value, benchmark.prior)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs leading-5 text-stealth-400">
            {isStale
              ? "Live refresh failed; values are the last known official close."
              : data?.source?.frequency ?? "Official Treasury business-day close."}
          </p>
        </article>
      </div>
    </div>
  );
}
