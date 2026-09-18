import { useMemo } from "react";
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


interface CurvePoint {
  maturity: string;
  yield: number;
}

interface CurveEntry {
  date: string;
  curve: CurvePoint[];
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

const MATURITY_ORDER = ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

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

const formatBasisPointMove = (current: number | null, prior: number | null) => {
  if (current === null || prior === null) return "No comparison";
  const basisPoints = (current - prior) * 100;
  const prefix = basisPoints > 0 ? "+" : "";
  return `${prefix}${basisPoints.toFixed(0)} bp d/d`;
};

const getCurveMap = (entry?: CurveEntry) =>
  new Map((entry?.curve ?? []).map((point) => [point.maturity, point.yield]));

const describeSlope = (spread: number | null) => {
  if (spread === null) return { label: "Unavailable", tone: "text-stealth-300" };
  if (spread < 0) return { label: "Inverted", tone: "text-red-300" };
  if (spread < 0.5) return { label: "Positive, flat", tone: "text-amber-300" };
  return { label: "Upward sloping", tone: "text-green-300" };
};

export default function YieldCurveCard() {
  const { data, loading, error, refetch } = useApi<YieldCurveResponse>(
    "/indicators/BOND_MARKET_STABILITY/yield-curve?months=3",
    { timeoutMs: 30_000 },
  );

  const latest = data?.curves?.[0];
  const previous = data?.curves?.[1];

  const chartData = useMemo(() => {
    if (!latest) return [];
    const previousMap = getCurveMap(previous);
    const latestMap = getCurveMap(latest);

    return MATURITY_ORDER.map((maturity) => ({
      maturity,
      latest: latestMap.get(maturity) ?? null,
      previous: previousMap.get(maturity) ?? null,
    }));
  }, [latest, previous]);

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
              Latest close {formatObservationDate(data?.as_of ?? latest.date)} · prior session comparison
            </p>
          </div>
          <Link
            to="/bond_health_stability"
            className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-sky-300 underline decoration-sky-500/50 underline-offset-4 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            Open bond evidence
          </Link>
        </div>

        <div className="mt-5 h-64 sm:h-72 lg:h-96">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart
              accessibilityLayer
              aria-label={`Treasury yield curve for ${latest.date} compared with ${previous?.date ?? "the prior available session"}`}
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
              <Tooltip
                formatter={(value) => value === null ? "—" : `${Number(value).toFixed(2)}%`}
                contentStyle={{
                  background: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--chart-tooltip-border)",
                  borderRadius: 8,
                }}
                labelStyle={{ color: "var(--chart-tooltip-label)" }}
              />
              <Line
                type="monotone"
                dataKey="previous"
                stroke="#91a4bd"
                strokeWidth={1.75}
                strokeDasharray="5 4"
                dot={false}
                name={previous ? `Prior · ${previous.date}` : "Prior"}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="latest"
                stroke="#83bfff"
                strokeWidth={3}
                dot={{ r: 2.5, fill: "#83bfff" }}
                activeDot={{ r: 5 }}
                name={`Latest · ${latest.date}`}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-stealth-700 pt-3 text-xs text-stealth-300">
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 bg-sky-300" />Latest official close</span>
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 border-t border-dashed border-stealth-300" />Prior session</span>
          <a
            href={data?.source?.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-stealth-200 underline decoration-stealth-500 underline-offset-4 hover:text-white"
          >
            Source: {data?.source?.name ?? "U.S. Department of the Treasury"}
          </a>
        </div>

        <details className="mt-3 border-t border-stealth-700 pt-3 text-sm text-stealth-300">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-stealth-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
            Read latest yields as values
          </summary>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 pb-2 sm:grid-cols-4">
            {latest.curve.map((point) => (
              <div key={point.maturity} className="flex items-baseline justify-between gap-2 border-b border-stealth-800 py-1">
                <dt className="text-stealth-400">{point.maturity}</dt>
                <dd className="font-mono font-semibold tabular-nums text-stealth-100">{point.yield.toFixed(2)}%</dd>
              </div>
            ))}
          </dl>
        </details>
      </article>

      <div className="grid content-start gap-3">
        <article className="surface-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-stealth-100">Curve shape</h3>
              <p className="mt-1 text-xs text-stealth-400">Term-spread state, not a forecast</p>
            </div>
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
          <p className="mt-4 text-sm leading-6 text-stealth-300">{curveRead}</p>
          <p className="mt-2 text-xs font-semibold text-stealth-400">
            {spreadMove === null
              ? "Daily slope change unavailable"
              : `${spreadMove >= 0 ? "Steepened" : "Flattened"} ${Math.abs(spreadMove).toFixed(0)} bp vs prior session`}
          </p>
        </article>

        <article className="surface-card p-5">
          <div>
            <h3 className="text-lg font-semibold text-stealth-100">Benchmark yields</h3>
            <p className="mt-1 text-xs text-stealth-400">Levels and one-session change</p>
          </div>
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
