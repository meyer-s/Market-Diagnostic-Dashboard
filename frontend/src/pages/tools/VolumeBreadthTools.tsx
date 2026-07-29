import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch, getErrorMessage } from "../../utils/apiUtils";
import { CHART_MARGIN } from "../../utils/chartUtils";

type TrendPeriod = 90 | 180 | 365;

interface BreadthHistoryPoint {
  date: string;
  advancing_pct: number;
  declining_pct: number;
  ad_rate: number;
  volume_advancing_pct: number;
  participation_pct: number;
}

interface BreadthBucket {
  label: string;
  source?: string;
  advancing: number;
  declining: number;
  advancing_pct: number;
  declining_pct: number;
  volume_advancing: number;
  volume_declining: number;
  volume_advancing_pct: number;
  volume_declining_pct: number;
  new_highs: number;
  new_lows: number;
  new_highs_pct: number;
  new_lows_pct: number;
  participation_pct: number;
  universe_size: number;
  history: BreadthHistoryPoint[];
}

interface BreadthResponse {
  as_of: string;
  exchanges: {
    amex: BreadthBucket;
    nyse: BreadthBucket;
    nsdq: BreadthBucket;
  };
}

type LoadStatus = "loading" | "ready" | "error";

const REQUEST_TIMEOUT_MS = 20_000;
const EXCHANGES = [
  { key: "amex", name: "AMEX" },
  { key: "nyse", name: "NYSE" },
  { key: "nsdq", name: "Nasdaq" },
] as const;

const formatLarge = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const formatTimestamp = (value: string | null) => {
  if (!value) return "not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const isStaleTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  return Date.now() - parsed.getTime() > 4 * 24 * 60 * 60 * 1000;
};

const hasUsableExchange = (bucket: BreadthBucket | undefined) =>
  Boolean(
    bucket &&
      bucket.source !== "unavailable" &&
      bucket.advancing + bucket.declining > 0 &&
      Number.isFinite(bucket.advancing_pct) &&
      Number.isFinite(bucket.declining_pct) &&
      Number.isFinite(bucket.participation_pct) &&
      bucket.universe_size > 0,
  );

function ExchangeChart({
  name,
  bucket,
}: {
  name: string;
  bucket: BreadthBucket;
}) {
  const headingId = `breadth-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const chartData = useMemo(
    () =>
      (bucket.history || []).map((point) => ({
        ...point,
        label: point.date.slice(5),
      })),
    [bucket.history],
  );
  const recentRows = useMemo(() => [...chartData].slice(-10).reverse(), [chartData]);
  const latest = chartData[chartData.length - 1];

  return (
    <section className="primary-card min-w-0 p-4 sm:p-5" aria-labelledby={headingId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-stealth-100">
            {name}
          </h2>
          <p className="mt-1 text-xs text-stealth-300">
            Source: {bucket.source || "not reported"}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:text-right">
          <div>
            <dt className="text-xs text-stealth-400">Advance / decline</dt>
            <dd className="font-semibold text-stealth-100">
              {bucket.advancing_pct.toFixed(0)}% / {bucket.declining_pct.toFixed(0)}%
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stealth-400">Universe</dt>
            <dd className="font-semibold text-stealth-100">
              {bucket.universe_size.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>

      <p className="mt-3 text-sm leading-6 text-stealth-300">
        {latest
          ? `Latest history point: ${latest.advancing_pct.toFixed(1)}% advancing, ${latest.volume_advancing_pct.toFixed(1)}% advancing volume, and ${latest.participation_pct.toFixed(1)}% participation.`
          : "No historical series was returned for this exchange. Snapshot metrics may still be available."}
      </p>

      {chartData.length > 0 && (
        <div className="mt-3 h-48 min-w-0" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart
              data={chartData}
              margin={CHART_MARGIN}
              accessibilityLayer={false}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-tooltip-border)" />
              <XAxis
                dataKey="label"
                minTickGap={24}
                tick={{ fill: "#cbd5e1", fontSize: 12 }}
                axisLine={{ stroke: "#475569" }}
                tickLine={{ stroke: "#475569" }}
              />
              <YAxis
                yAxisId="pct"
                domain={[0, 100]}
                tick={{ fill: "#cbd5e1", fontSize: 12 }}
                axisLine={{ stroke: "#475569" }}
                tickLine={{ stroke: "#475569" }}
                width={34}
              />
              <YAxis
                yAxisId="rate"
                hide
                orientation="right"
                domain={["dataMin - 2", "dataMax + 2"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--chart-tooltip-border)",
                  borderRadius: 8,
                  color: "var(--chart-tooltip-label)",
                }}
                formatter={(value: number, seriesName: string) => {
                  if (seriesName === "A/D pace") return [Number(value).toFixed(0), seriesName];
                  return [`${Number(value).toFixed(1)}%`, seriesName];
                }}
              />
              <Bar
                yAxisId="pct"
                dataKey="advancing_pct"
                stackId="breadth"
                fill="#4ade80"
                fillOpacity={0.9}
                name="Advancing"
              />
              <Bar
                yAxisId="pct"
                dataKey="declining_pct"
                stackId="breadth"
                fill="#f87171"
                fillOpacity={0.85}
                name="Declining"
              />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="volume_advancing_pct"
                stroke="#22d3ee"
                strokeWidth={1.7}
                dot={false}
                name="Volume adv %"
              />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="participation_pct"
                stroke="#a78bfa"
                strokeWidth={1.6}
                dot={false}
                name="Participation %"
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="ad_rate"
                stroke="#facc15"
                strokeWidth={1.8}
                dot={false}
                name="A/D pace"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm xs:grid-cols-3">
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/50 p-3">
          <dt className="text-xs text-stealth-300">Advancing volume</dt>
          <dd className="mt-1 font-semibold text-green-300">
            {bucket.volume_advancing_pct.toFixed(0)}%
          </dd>
          <dd className="text-xs text-stealth-300">
            {formatLarge(bucket.volume_advancing)}
          </dd>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/50 p-3">
          <dt className="text-xs text-stealth-300">New highs</dt>
          <dd className="mt-1 font-semibold text-green-300">
            {bucket.new_highs_pct.toFixed(0)}%
          </dd>
          <dd className="text-xs text-stealth-300">
            {bucket.new_highs.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/50 p-3">
          <dt className="text-xs text-stealth-300">Participation</dt>
          <dd className="mt-1 font-semibold text-violet-300">
            {bucket.participation_pct.toFixed(0)}%
          </dd>
          <dd className="text-xs text-stealth-300">active names</dd>
        </div>
      </dl>

      <details className="mt-4 rounded-xl border border-stealth-700 bg-stealth-900/40">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-stealth-100">
          Read the latest data points
        </summary>
        {recentRows.length > 0 ? (
          <div
            className="max-w-full overflow-x-auto border-t border-stealth-700"
            role="region"
            aria-label={`${name} recent breadth data table`}
            tabIndex={0}
          >
            <table className="min-w-[680px] w-full border-collapse text-left text-xs text-stealth-200">
              <thead className="bg-stealth-850">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Advancing</th>
                  <th className="px-3 py-2 font-semibold">Declining</th>
                  <th className="px-3 py-2 font-semibold">Adv. volume</th>
                  <th className="px-3 py-2 font-semibold">Participation</th>
                  <th className="px-3 py-2 font-semibold">A/D pace</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((row) => (
                  <tr key={row.date} className="border-t border-stealth-700">
                    <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium">
                      {row.date}
                    </th>
                    <td className="px-3 py-2">{row.advancing_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2">{row.declining_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2">{row.volume_advancing_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2">{row.participation_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2">{row.ad_rate.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="border-t border-stealth-700 p-3 text-sm text-stealth-300">
            No history was returned.
          </p>
        )}
      </details>
    </section>
  );
}

export default function VolumeBreadthTools() {
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>(90);
  const [data, setData] = useState<BreadthResponse | null>(null);
  const [dataPeriod, setDataPeriod] = useState<TrendPeriod | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastResponseLoad, setLastResponseLoad] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const loadBreadth = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setStatus("loading");
    setError(null);

    try {
      const response = await apiFetch<BreadthResponse>(
        `/market-internals/overview?days=${trendPeriod}`,
        { signal: controller.signal },
      );
      if (!response || typeof response !== "object" || !response.exchanges) {
        throw new Error("The breadth service returned a malformed response.");
      }
      setData(response);
      setDataPeriod(trendPeriod);
      setLastResponseLoad(new Date().toISOString());
      setStatus("ready");
    } catch (requestError) {
      if (controllerRef.current !== controller) {
        return;
      }
      if (controller.signal.aborted) {
        setError(
          "The breadth request stopped after 20 seconds. The service may still be calculating the exchange history.",
        );
      } else {
        setError(getErrorMessage(requestError));
      }
      setStatus("error");
    } finally {
      window.clearTimeout(timeoutId);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [trendPeriod]);

  useEffect(() => {
    void loadBreadth();
    return () => {
      const activeController = controllerRef.current;
      controllerRef.current = null;
      activeController?.abort();
    };
  }, [loadBreadth]);

  const usableExchanges = data
    ? EXCHANGES.filter(({ key }) => hasUsableExchange(data.exchanges[key]))
    : [];
  const incompleteExchanges = data
    ? EXCHANGES.filter(({ key }) => !hasUsableExchange(data.exchanges[key]))
    : [];
  const fallbackSources = data
    ? EXCHANGES.filter(({ key }) =>
        /proxy|fallback|unknown|not reported/i.test(data.exchanges[key]?.source || "unknown"),
      )
    : [];
  const stale = data ? isStaleTimestamp(data.as_of) : false;
  const showingRetainedData = Boolean(data && dataPeriod !== trendPeriod);

  return (
    <div className="page-shell page-stack">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="page-kicker">Tools</span>
          <h1 className="page-title">Volume &amp; Breadth</h1>
          <p className="page-subtitle">
            Exchange-level advance/decline, participation, and volume diagnostics with
            explicit source and freshness cues.
          </p>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-stealth-300">History window</legend>
          <div className="control-strip" aria-label="Breadth history window">
            {(
              [
                { value: 90, label: "90d" },
                { value: 180, label: "6mo" },
                { value: 365, label: "1yr" },
              ] as Array<{ value: TrendPeriod; label: string }>
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={trendPeriod === option.value}
                onClick={() => setTrendPeriod(option.value)}
                className={`min-h-11 min-w-16 flex-1 rounded-full px-3 text-sm font-semibold ${
                  trendPeriod === option.value
                    ? "bg-stealth-700 text-white"
                    : "text-stealth-300 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </header>

      {status === "loading" && !data && (
        <div
          className="primary-card p-5 text-sm leading-6 text-stealth-200"
          role="status"
          aria-live="polite"
        >
          <p className="font-semibold text-stealth-100">Loading exchange breadth</p>
          <p className="mt-1">
            Historical breadth can take longer than snapshot data. This request stops after
            20 seconds and will offer a retry rather than waiting indefinitely.
          </p>
        </div>
      )}

      {status === "loading" && data && (
        <div
          className="rounded-xl border border-sky-400/35 bg-sky-500/10 p-4 text-sm text-sky-100"
          role="status"
          aria-live="polite"
        >
          Refreshing the {trendPeriod}-day view. The last received{" "}
          {dataPeriod ? `${dataPeriod}-day` : ""} response remains visible.
        </div>
      )}

      {status === "error" && (
        <div
          className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4"
          role="alert"
        >
          <h2 className="text-base font-semibold text-amber-100">
            {data ? "Breadth refresh did not complete" : "Breadth data is unavailable"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-50/90">{error}</p>
          {data && (
            <p className="mt-1 text-sm text-amber-100/80">
              Showing the retained response received {formatTimestamp(lastResponseLoad)}.
            </p>
          )}
          <button
            type="button"
            onClick={() => void loadBreadth()}
            className="mt-3 min-h-11 rounded-xl border border-amber-300/60 px-4 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/10"
          >
            Retry breadth request
          </button>
        </div>
      )}

      {data && (
        <>
          {usableExchanges.length === 0 && (
            <section
              className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4"
              role="alert"
              aria-labelledby="breadth-empty-response"
            >
              <h2 id="breadth-empty-response" className="text-base font-semibold text-amber-100">
                No usable exchange snapshots
              </h2>
              <p className="mt-2 text-sm leading-6 text-amber-50/90">
                The service returned exchange-universe metadata, but every direct or full-universe
                breadth source was unavailable. Zero placeholders are not being presented as
                market observations.
              </p>
              <button
                type="button"
                onClick={() => void loadBreadth()}
                className="mt-3 min-h-11 rounded-xl border border-amber-300/60 px-4 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/10"
              >
                Retry breadth request
              </button>
            </section>
          )}

          <section
            className="surface-card p-4 sm:p-5"
            aria-labelledby="breadth-data-status"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 id="breadth-data-status" className="text-base font-semibold text-stealth-100">
                  Data status
                </h2>
                <p className="mt-1 text-sm text-stealth-300">
                  Response timestamp {formatTimestamp(data.as_of)}. Received locally{" "}
                  {formatTimestamp(lastResponseLoad)}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="page-badge">
                  {usableExchanges.length} of {EXCHANGES.length} exchanges usable
                </span>
                {stale && (
                  <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-amber-100">
                    Older than four days
                  </span>
                )}
                {fallbackSources.length > 0 && (
                  <span className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-sky-100">
                    {fallbackSources.length} fallback source
                    {fallbackSources.length === 1 ? "" : "s"}
                  </span>
                )}
                {showingRetainedData && (
                  <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-amber-100">
                    Retained {dataPeriod}-day view
                  </span>
                )}
              </div>
            </div>
            {(incompleteExchanges.length > 0 || fallbackSources.length > 0 || stale) && (
              <p className="mt-3 text-sm leading-6 text-stealth-300">
                Treat this view as partial when an exchange is missing, a fallback source is
                named, or the observation is stale. Those conditions are not scored as a normal
                successful refresh.
              </p>
            )}
          </section>

          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
            {EXCHANGES.map(({ key, name }) =>
              hasUsableExchange(data.exchanges[key]) ? (
                <ExchangeChart key={key} name={name} bucket={data.exchanges[key]} />
              ) : (
                <section
                  key={key}
                  className="surface-card min-w-0 p-5"
                  aria-labelledby={`breadth-${key}-missing`}
                >
                  <h2
                    id={`breadth-${key}-missing`}
                    className="text-lg font-semibold text-stealth-100"
                  >
                    {name}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-amber-200">
                    This exchange did not return enough fields for a reliable snapshot.
                  </p>
                </section>
              ),
            )}
          </div>

          <section className="surface-card-strong p-4 sm:p-5" aria-labelledby="breadth-methodology">
            <h2 id="breadth-methodology" className="text-base font-semibold text-stealth-100">
              Methodology &amp; scoring
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-stealth-300">
              <li>Exchange universes come from Nasdaq symbol-directory files refreshed daily.</li>
              <li>
                Each exchange computes advancing and declining names, volume, and new highs
                versus lows for each session.
              </li>
              <li>
                Participation is the share of listed symbols with valid daily data, not a
                measure of directional strength.
              </li>
              <li>
                A/D pace is advancing minus declining and indicates breadth acceleration or
                deterioration.
              </li>
              <li>
                Each exchange names its direct feed or proxy fallback so source quality stays
                visible.
              </li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
