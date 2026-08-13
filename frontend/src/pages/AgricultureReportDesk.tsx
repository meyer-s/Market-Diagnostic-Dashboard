/*
THESIS: Raw releases and an interpretive lens live side by side; neither a document-only nor chart-only dashboard is enough.
OWN-WORLD: Evidence Field — dark, exacting, source-forward, and operational.
STORY: Next catalyst and current official read, then raw evidence, then standardized cross-series interpretation.
FIRST VIEWPORT: Current strip above a 40/60 raw-release and insights split.
FORM: Approved combined composition with a vertical Evidence Field spine and the chart inspector behavior of direction 5 (seed 309fdfcf).
*/

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Info,
  Save,
  TriangleAlert,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import DataScroller from "../components/ui/DataScroller";
import PageState from "../components/ui/PageState";
import SegmentedControl from "../components/ui/SegmentedControl";
import { useApi } from "../hooks/useApi";
import { buildApiUrl } from "../utils/apiUtils";

type ReportCoverage = "chart_ready" | "latest_snapshot" | "official_archive";

type ReportCatalogItem = {
  id: string;
  name: string;
  agency: string;
  cadence: string;
  release_time: string;
  coverage: ReportCoverage;
  coverage_label: string;
  description: string;
  source_url: string;
  archive_url: string;
};

type ReleaseEvent = {
  report_id: string;
  report: string;
  release_at: string;
  date: string;
  time_label: string;
  confidence: "official" | "recurring" | "expected";
};

type MetricPoint = {
  release_date: string;
  value: number;
  prior_value: number | null;
  revision: number | null;
  revision_z: number | null;
  bullish_signal_z: number | null;
  reaction_1d_pct: number | null;
  reaction_5d_pct: number | null;
  unit: string;
  market_year: string;
  projection_status: string | null;
  normalization: {
    basis: string;
    mean_revision: number;
    revision_std_dev: number;
    positive_means: string;
  };
};

type ReportSeries = {
  id: string;
  report_id: string;
  report: string;
  metric_id: string;
  label: string;
  bullish_when: string;
  unit: string;
  points: MetricPoint[];
};

type ReportDeskData = {
  as_of: string;
  commodity: { symbol: string; name: string; usda: string; ticker: string };
  commodities: Array<{ symbol: string; name: string; usda: string; ticker: string }>;
  selected_metric: string;
  years: number;
  next_release: ReleaseEvent | null;
  latest_release: MetricPoint | null;
  reports: ReportCatalogItem[];
  schedule: ReleaseEvent[];
  metrics: Array<{ id: string; label: string; orientation: number; bullish_when: string }>;
  series: ReportSeries[];
  price_history: Array<{ date: string; value: number; rebased: number; ticker: string }>;
  takeaways: Array<{ tone: "positive" | "negative" | "warning" | "neutral"; title: string; body: string }>;
  methodology: Record<string, string>;
  warnings: string[];
};

type SavedExpectation = {
  value: number;
  note: string;
  savedAt: string;
};

type Expectations = Record<string, SavedExpectation>;

const EXPECTATION_STORAGE_KEY = "agriculture-report-expectations-v1";
const SERIES_COLORS = ["#69d6a3", "#83bfff", "#f3cb69", "#c9a8ff"];
const INPUT_CLASS = "mt-1 w-full rounded-lg border border-stealth-600 bg-stealth-900 px-3 py-2.5 text-sm text-stealth-100 outline-none transition focus:border-sky-400";

function formatDate(value: string, includeYear = true) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(parsed);
}

function formatValue(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatSigned(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function expectationKey(symbol: string, reportId: string, metricId: string, releaseDate: string) {
  return `${symbol}:${reportId}:${metricId}:${releaseDate}`;
}

function readExpectations(): Expectations {
  try {
    const raw = window.localStorage.getItem(EXPECTATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Expectations : {};
  } catch {
    return {};
  }
}

function confidenceLabel(confidence: ReleaseEvent["confidence"]) {
  if (confidence === "official") return "Official date";
  if (confidence === "recurring") return "Recurring time";
  return "Expected date";
}

function coverageTone(coverage: ReportCoverage) {
  if (coverage === "chart_ready") return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
  if (coverage === "latest_snapshot") return "border-sky-400/40 bg-sky-400/10 text-sky-200";
  return "border-stealth-600 bg-stealth-800 text-stealth-300";
}

function takeawayTone(tone: ReportDeskData["takeaways"][number]["tone"]) {
  if (tone === "positive") return "border-emerald-400/45 bg-emerald-400/[0.07]";
  if (tone === "negative") return "border-rose-400/45 bg-rose-400/[0.07]";
  if (tone === "warning") return "border-amber-300/45 bg-amber-300/[0.07]";
  return "border-stealth-600 bg-stealth-900/40";
}

function signalLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unscored";
  if (value >= 0.75) return "Bullish revision";
  if (value <= -0.75) return "Bearish revision";
  return "Near historical norm";
}

function chartDateLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(new Date(timestamp));
}

function ReportTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: number }) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className="max-w-[280px] rounded-lg border border-stealth-600 bg-stealth-900/95 p-3 shadow-xl">
      <p className="text-xs font-semibold text-stealth-200">{formatDate(new Date(label).toISOString())}</p>
      <div className="mt-2 space-y-1.5">
        {payload.filter((item) => item.value !== null && item.value !== undefined).map((item) => (
          <p key={item.name} className="flex items-center justify-between gap-4 text-xs text-stealth-300">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.name}</span>
            <strong className="text-stealth-100">{formatSigned(Number(item.value))}</strong>
          </p>
        ))}
      </div>
    </div>
  );
}

export default function AgricultureReportDesk() {
  const [symbol, setSymbol] = useState("ZC");
  const [years, setYears] = useState<1 | 2 | 3>(2);
  const [metric, setMetric] = useState("ending_stocks");
  const [selectedReportId, setSelectedReportId] = useState("wasde");
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(["ending_stocks", "production", "exports"]);
  const [expectations, setExpectations] = useState<Expectations>(() => readExpectations());
  const [selectedReleaseDate, setSelectedReleaseDate] = useState("");
  const [expectationInput, setExpectationInput] = useState("");
  const [expectationNote, setExpectationNote] = useState("");
  const endpoint = `/agriculture/report-desk?symbol=${encodeURIComponent(symbol)}&years=${years}&metric=${encodeURIComponent(metric)}`;
  const { data, loading, error, refetch } = useApi<ReportDeskData>(endpoint, { timeoutMs: 60_000, retainPreviousData: false });

  const selectedSeries = useMemo(
    () => data?.series.find((layer) => layer.metric_id === metric) ?? data?.series[0] ?? null,
    [data, metric],
  );
  const selectedReport = data?.reports.find((report) => report.id === selectedReportId) ?? data?.reports[0] ?? null;
  const nextSelectedReportRelease = data?.schedule.find((event) => event.report_id === selectedReportId) ?? null;

  useEffect(() => {
    if (!data) return;
    const availableReleaseDates = new Set([
      ...(selectedSeries?.points.map((point) => point.release_date) ?? []),
      ...data.schedule.filter((event) => event.report_id === "wasde").map((event) => event.date),
    ]);
    if (selectedReleaseDate && availableReleaseDates.has(selectedReleaseDate)) return;
    const nextWasde = data.schedule.find((event) => event.report_id === "wasde");
    setSelectedReleaseDate(selectedSeries?.points.at(-1)?.release_date ?? nextWasde?.date ?? "");
  }, [data, selectedReleaseDate, selectedSeries]);

  useEffect(() => {
    if (!selectedReleaseDate) return;
    const saved = expectations[expectationKey(symbol, "wasde", metric, selectedReleaseDate)];
    setExpectationInput(saved ? String(saved.value) : "");
    setExpectationNote(saved?.note ?? "");
  }, [expectations, metric, selectedReleaseDate, symbol]);

  const activePoint = selectedSeries?.points.find((point) => point.release_date === selectedReleaseDate) ?? null;
  const savedExpectation = selectedReleaseDate
    ? expectations[expectationKey(symbol, "wasde", metric, selectedReleaseDate)]
    : undefined;
  const canSaveExpectation = expectationInput.trim() !== "" && Number.isFinite(Number(expectationInput));

  const signalChartData = useMemo(() => {
    if (!data) return [];
    const merged = new Map<number, Record<string, number | string | null>>();
    for (const price of data.price_history) {
      const timestamp = new Date(`${price.date}T12:00:00`).getTime();
      merged.set(timestamp, { timestamp, date: price.date, futures: price.rebased });
    }
    for (const layer of data.series) {
      for (const point of layer.points) {
        const timestamp = new Date(`${point.release_date}T12:00:00`).getTime();
        const datum = merged.get(timestamp) ?? { timestamp, date: point.release_date };
        datum[`signal_${layer.metric_id}`] = point.bullish_signal_z;
        const saved = expectations[expectationKey(symbol, "wasde", layer.metric_id, point.release_date)];
        if (saved && point.prior_value !== null && point.normalization.revision_std_dev > 0) {
          const definition = data.metrics.find((item) => item.id === layer.metric_id);
          const expectedRevision = saved.value - point.prior_value;
          datum[`expected_${layer.metric_id}`] = (
            (expectedRevision - point.normalization.mean_revision)
            / point.normalization.revision_std_dev
          ) * (definition?.orientation ?? 1);
        }
        merged.set(timestamp, datum);
      }
    }
    for (const event of data.schedule.filter((item) => item.report_id === "wasde")) {
      for (const layer of data.series) {
        const saved = expectations[expectationKey(symbol, "wasde", layer.metric_id, event.date)];
        if (!saved) continue;
        const priorPoint = [...layer.points].reverse().find((point) => point.release_date < event.date);
        if (!priorPoint || priorPoint.normalization.revision_std_dev <= 0) continue;
        const definition = data.metrics.find((item) => item.id === layer.metric_id);
        const timestamp = new Date(`${event.date}T12:00:00`).getTime();
        const datum = merged.get(timestamp) ?? { timestamp, date: event.date };
        datum[`expected_${layer.metric_id}`] = (
          (saved.value - priorPoint.value - priorPoint.normalization.mean_revision)
          / priorPoint.normalization.revision_std_dev
        ) * (definition?.orientation ?? 1);
        merged.set(timestamp, datum);
      }
    }
    return Array.from(merged.values()).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  }, [data, expectations, symbol]);

  const rawChartData = useMemo(() => {
    if (!selectedSeries) return [];
    const rows: Array<{ timestamp: number; actual: number | null; expectation: number | null }> = selectedSeries.points.map((point) => ({
      timestamp: new Date(`${point.release_date}T12:00:00`).getTime(),
      actual: point.value,
      expectation: expectations[expectationKey(symbol, "wasde", selectedSeries.metric_id, point.release_date)]?.value ?? null,
    }));
    for (const event of data?.schedule.filter((item) => item.report_id === "wasde") ?? []) {
      if (selectedSeries.points.some((point) => point.release_date === event.date)) continue;
      const saved = expectations[expectationKey(symbol, "wasde", selectedSeries.metric_id, event.date)];
      if (saved) rows.push({ timestamp: new Date(`${event.date}T12:00:00`).getTime(), actual: null, expectation: saved.value });
    }
    return rows.sort((a, b) => a.timestamp - b.timestamp);
  }, [data?.schedule, expectations, selectedSeries, symbol]);

  const expectedMetricIds = useMemo(() => new Set(
    Object.keys(expectations)
      .filter((key) => key.startsWith(`${symbol}:wasde:`))
      .map((key) => key.split(":")[2]),
  ), [expectations, symbol]);

  function toggleMetric(metricId: string) {
    setVisibleMetrics((current) => current.includes(metricId)
      ? current.length > 1 ? current.filter((item) => item !== metricId) : current
      : [...current, metricId]);
  }

  function saveExpectation() {
    const parsed = Number(expectationInput);
    if (!selectedReleaseDate || !canSaveExpectation) return;
    const key = expectationKey(symbol, "wasde", metric, selectedReleaseDate);
    const next = {
      ...expectations,
      [key]: { value: parsed, note: expectationNote.trim(), savedAt: new Date().toISOString() },
    };
    setExpectations(next);
    window.localStorage.setItem(EXPECTATION_STORAGE_KEY, JSON.stringify(next));
  }

  if (loading && !data) {
    return (
      <div className="page-shell-wide page-stack" aria-busy="true">
        <PageState variant="loading" headingLevel={1} title="Opening Agriculture Report Desk" message="Loading official USDA release history and matching futures closes." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-shell-wide page-stack">
        <PageState
          variant="error"
          headingLevel={1}
          title="Report history is unavailable"
          message={error ?? "The report desk could not be loaded."}
          actions={<button type="button" className="field-button field-button-primary" onClick={refetch}>Try again</button>}
        />
      </div>
    );
  }

  const latest = selectedSeries?.points.at(-1) ?? null;
  const latestSignal = latest?.bullish_signal_z;

  return (
    <div className="page-shell-wide page-stack space-y-5 md:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/agriculture" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-stealth-300 transition hover:text-sky-300">
            <ArrowLeft size={16} aria-hidden="true" /> Agriculture Index
          </Link>
          <p className="page-kicker">Evidence workspace</p>
          <h1 className="page-title">Agriculture Report Desk</h1>
          <p className="page-subtitle max-w-4xl">Official releases on the left. Standardized revisions, expectations, and associated futures reactions on the right.</p>
        </div>
        <a className="field-button field-button-secondary gap-2" href={buildApiUrl("/agriculture/report-desk/calendar.ics")} download>
          <Download size={16} aria-hidden="true" /> Add release calendar
        </a>
      </header>

      <section aria-labelledby="report-desk-now" className="surface-card-strong overflow-hidden">
        <h2 id="report-desk-now" className="sr-only">Current report desk read</h2>
        <div className="grid divide-y divide-stealth-700 lg:grid-cols-[1.15fr_0.85fr_0.85fr_0.85fr] lg:divide-x lg:divide-y-0">
          <div className="p-4 md:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stealth-500">Next agriculture release</p>
            {data.next_release ? (
              <>
                <p className="mt-2 text-xl font-semibold text-stealth-100">{data.next_release.report}</p>
                <p className="mt-1 flex items-center gap-2 text-sm text-stealth-300"><CalendarDays size={15} aria-hidden="true" /> {formatDate(data.next_release.release_at)} · {data.next_release.time_label}</p>
                <p className="mt-2 text-xs text-stealth-500">{confidenceLabel(data.next_release.confidence)} · holiday exceptions should be verified</p>
              </>
            ) : <p className="mt-2 text-stealth-300">No future release is in the current calendar window.</p>}
          </div>
          <label className="p-4 md:p-5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stealth-500">Commodity</span>
            <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setSelectedReleaseDate(""); }} className={INPUT_CLASS}>
              {data.commodities.map((item) => <option key={item.symbol} value={item.symbol}>{item.name}</option>)}
            </select>
            <span className="mt-2 block text-xs text-stealth-500">{data.commodity.ticker} futures response</span>
          </label>
          <label className="p-4 md:p-5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stealth-500">Primary metric</span>
            <select value={metric} onChange={(event) => { setMetric(event.target.value); setSelectedReleaseDate(""); }} className={INPUT_CLASS}>
              {data.metrics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <span className="mt-2 block text-xs text-stealth-500">Latest market year: {latest?.market_year ?? "—"}</span>
          </label>
          <div className="p-4 md:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stealth-500">History window</p>
            <div className="mt-3">
              <SegmentedControl label="Report history window" value={years} options={[{ value: 1, label: "1Y" }, { value: 2, label: "2Y" }, { value: 3, label: "3Y" }]} onChange={setYears} accent="emerald" />
            </div>
            <p className="mt-2 text-xs text-stealth-500">As-reported monthly snapshots</p>
          </div>
        </div>
      </section>

      {data.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300/40 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100" role="status">
          <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" /><p>{data.warnings.join(" ")}</p></div>
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div className="surface-card min-w-0 overflow-hidden">
          <div className="border-b border-stealth-700 p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="page-kicker">Raw release viewer</p>
                <h2 className="mt-1 text-xl font-semibold text-stealth-100">What the report says</h2>
              </div>
              {selectedReport ? <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${coverageTone(selectedReport.coverage)}`}>{selectedReport.coverage_label}</span> : null}
            </div>
            <DataScroller label="Agriculture report families" hint="Scroll to inspect every report family.">
              <div className="mt-4 flex min-w-max gap-2 pb-1">
                {data.reports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    aria-pressed={selectedReportId === report.id}
                    onClick={() => setSelectedReportId(report.id)}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-semibold transition ${selectedReportId === report.id ? "border-emerald-400 bg-emerald-400/10 text-emerald-100" : "border-stealth-700 bg-stealth-900/50 text-stealth-300 hover:border-stealth-500"}`}
                  >
                    {report.name}
                  </button>
                ))}
              </div>
            </DataScroller>
          </div>

          {selectedReport ? (
            <div className="space-y-5 p-4 md:p-5">
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold text-stealth-100">{selectedReport.name}</h3>
                  <p className="text-xs text-stealth-500">{selectedReport.agency} · {selectedReport.cadence} · {selectedReport.release_time}</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-stealth-300">{selectedReport.description}</p>
                {nextSelectedReportRelease ? <p className="mt-2 flex items-center gap-2 text-xs text-sky-200"><Clock3 size={14} aria-hidden="true" /> Next: {formatDate(nextSelectedReportRelease.release_at)} at {nextSelectedReportRelease.time_label} · {confidenceLabel(nextSelectedReportRelease.confidence)}</p> : null}
              </div>

              {selectedReport.coverage === "chart_ready" && selectedSeries && latest ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="surface-card-muted p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Latest result</p>
                      <p className="mt-1 text-2xl font-semibold text-stealth-100">{formatValue(latest.value)}</p>
                      <p className="mt-1 text-xs text-stealth-400">{latest.unit} · {latest.market_year}</p>
                    </div>
                    <div className="surface-card-muted p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Prior estimate</p>
                      <p className="mt-1 text-2xl font-semibold text-stealth-100">{formatValue(latest.prior_value)}</p>
                      <p className="mt-1 text-xs text-stealth-400">Revision {formatSigned(latest.revision)}</p>
                    </div>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-stealth-100">As-reported {selectedSeries.label.toLowerCase()}</h3>
                        <p className="mt-1 text-xs text-stealth-500">Solid line = result · dotted hollow series = your expectation</p>
                      </div>
                    </div>
                    <div className="mt-3 h-56 min-w-0">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <LineChart data={rawChartData} margin={{ top: 10, right: 12, bottom: 4, left: 0 }} accessibilityLayer aria-label={`${selectedSeries.label} result and saved expectations`}>
                          <CartesianGrid stroke="rgba(63,80,104,0.38)" vertical={false} />
                          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#6f8199" tick={{ fill: "#9aa9bc", fontSize: 11 }} />
                          <YAxis width={52} stroke="#6f8199" tick={{ fill: "#9aa9bc", fontSize: 11 }} domain={["auto", "auto"]} />
                          <Tooltip content={<ReportTooltip />} />
                          <Line type="monotone" dataKey="actual" name="Result" stroke="#69d6a3" strokeWidth={2.25} dot={{ r: 3, fill: "#69d6a3" }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                          <Line type="monotone" dataKey="expectation" name="Your expectation" stroke="#f3cb69" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 4, fill: "#0e1520", stroke: "#f3cb69", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-stealth-600 bg-stealth-900/35 p-5">
                  <FileText size={22} className="text-stealth-400" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-semibold text-stealth-100">Official raw source connected</h3>
                  <p className="mt-2 text-sm leading-6 text-stealth-400">This family is scheduled and linked, but its historical observations are not standardized into chart layers yet. Open the official release without losing your place in the desk.</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-stealth-700 pt-4">
                <a href={selectedReport.source_url} target="_blank" rel="noreferrer" className="field-button field-button-primary gap-2">Open latest official report <ExternalLink size={15} aria-hidden="true" /></a>
                <a href={selectedReport.archive_url} target="_blank" rel="noreferrer" className="field-button field-button-secondary gap-2">Browse archive <ExternalLink size={15} aria-hidden="true" /></a>
              </div>
            </div>
          ) : null}
        </div>

        <div className="surface-card-strong min-w-0 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="page-kicker">Insights pane</p>
              <h2 className="mt-1 text-xl font-semibold text-stealth-100">What changed — and did price agree?</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-400">Different units are converted to like-series revision z-scores. Positive always means the report moved in a price-supportive direction.</p>
            </div>
            <div className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${latestSignal !== null && latestSignal !== undefined && latestSignal >= 0.5 ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : latestSignal !== null && latestSignal !== undefined && latestSignal <= -0.5 ? "border-rose-400/50 bg-rose-400/10 text-rose-200" : "border-stealth-600 bg-stealth-800 text-stealth-300"}`}>
              {signalLabel(latestSignal)}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {data.takeaways.map((takeaway) => (
              <article key={takeaway.title} className={`rounded-lg border p-3.5 ${takeawayTone(takeaway.tone)}`}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-300">{takeaway.title}</h3>
                <p className="mt-2 text-sm leading-5 text-stealth-200">{takeaway.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 border-t border-stealth-700 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-stealth-100">Report layers vs. rebased futures</h3>
                <p className="mt-1 text-xs text-stealth-500">Report scale ±3σ (left) · futures indexed to 100 (right)</p>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Visible report layers">
                {data.series.map((layer, index) => (
                  <button
                    key={layer.metric_id}
                    type="button"
                    aria-pressed={visibleMetrics.includes(layer.metric_id)}
                    onClick={() => toggleMetric(layer.metric_id)}
                    className="min-h-11 rounded-lg border px-3 text-xs font-semibold transition"
                    style={{
                      borderColor: visibleMetrics.includes(layer.metric_id) ? SERIES_COLORS[index % SERIES_COLORS.length] : "#3f5068",
                      backgroundColor: visibleMetrics.includes(layer.metric_id) ? `${SERIES_COLORS[index % SERIES_COLORS.length]}18` : "rgba(14,21,32,.45)",
                      color: visibleMetrics.includes(layer.metric_id) ? SERIES_COLORS[index % SERIES_COLORS.length] : "#9aa9bc",
                    }}
                  >
                    {layer.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 h-[390px] min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart data={signalChartData} margin={{ top: 12, right: 8, bottom: 8, left: 0 }} accessibilityLayer aria-label="Standardized USDA report revisions compared with rebased agriculture futures">
                  <CartesianGrid stroke="rgba(63,80,104,0.38)" vertical={false} />
                  <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#6f8199" tick={{ fill: "#9aa9bc", fontSize: 11 }} />
                  <YAxis yAxisId="signal" width={42} domain={[-3, 3]} ticks={[-3, -2, -1, 0, 1, 2, 3]} stroke="#6f8199" tick={{ fill: "#9aa9bc", fontSize: 11 }} />
                  <YAxis yAxisId="price" orientation="right" width={48} domain={["auto", "auto"]} stroke="#6f8199" tick={{ fill: "#9aa9bc", fontSize: 11 }} />
                  <Tooltip content={<ReportTooltip />} />
                  <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 11, color: "#b7c3d3" }} />
                  <ReferenceLine yAxisId="signal" y={0} stroke="#6f8199" strokeDasharray="3 3" />
                  <Line yAxisId="price" type="monotone" dataKey="futures" name={`${data.commodity.name} futures (100)`} stroke="#f4f7fb" strokeWidth={1.5} dot={false} opacity={0.62} isAnimationActive={false} />
                  {data.series.map((layer, index) => visibleMetrics.includes(layer.metric_id) ? (
                    <Line key={layer.metric_id} yAxisId="signal" type="monotone" dataKey={`signal_${layer.metric_id}`} name={`${layer.report} · ${layer.label}`} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={2.25} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  ) : null)}
                  {data.series.map((layer, index) => visibleMetrics.includes(layer.metric_id) && expectedMetricIds.has(layer.metric_id) ? (
                    <Line key={`expectation-${layer.metric_id}`} yAxisId="signal" type="monotone" dataKey={`expected_${layer.metric_id}`} name={`${layer.label} expectation`} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={1.25} strokeDasharray="4 5" dot={{ r: 4, fill: "#0e1520", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                  ) : null)}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-stealth-500">
              <span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-emerald-300" /> Filled result series</span>
              <span className="flex items-center gap-2"><span className="w-5 border-t border-dashed border-amber-200" /> Hollow expectation series</span>
              <span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-white/60" /> Rebased futures, context only</span>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card-strong p-4 md:p-5" aria-labelledby="release-inspector-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="page-kicker">Event inspector</p>
            <h2 id="release-inspector-title" className="mt-1 text-xl font-semibold text-stealth-100">Expectation, result, and price response</h2>
            <p className="mt-2 text-sm text-stealth-400">Select any release to reconstruct what was known. Expectations are yours, are never backfilled, and stay in this browser.</p>
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {data.schedule.filter((event) => event.report_id === "wasde").slice(0, 4).map((event) => (
              <button key={event.release_at} type="button" onClick={() => setSelectedReleaseDate(event.date)} aria-pressed={selectedReleaseDate === event.date} className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold ${selectedReleaseDate === event.date ? "border-sky-400 bg-sky-400/10 text-sky-100" : "border-stealth-700 text-stealth-300"}`}>
                {formatDate(event.date)}
              </button>
            ))}
            {selectedSeries?.points.slice(-8).reverse().map((point) => (
              <button key={point.release_date} type="button" onClick={() => setSelectedReleaseDate(point.release_date)} aria-pressed={selectedReleaseDate === point.release_date} className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold ${selectedReleaseDate === point.release_date ? "border-sky-400 bg-sky-400/10 text-sky-100" : "border-stealth-700 text-stealth-300"}`}>
                {formatDate(point.release_date)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div className="surface-card p-4">
            <h3 className="text-sm font-semibold text-stealth-100">Set your expectation</h3>
            <p className="mt-1 text-xs leading-5 text-stealth-500">No third-party consensus is labeled or inferred. Enter the number you want judged against the release.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
              <label className="form-field">
                <span className="form-field-label">Expected {selectedSeries?.label.toLowerCase() ?? "result"}</span>
                <input type="number" step="any" value={expectationInput} onChange={(event) => setExpectationInput(event.target.value)} className={INPUT_CLASS} placeholder="Enter value" />
                <span className="form-field-hint">{selectedSeries?.unit ?? "Report units"}</span>
              </label>
              <label className="form-field">
                <span className="form-field-label">Thesis note <span className="form-field-required">Optional</span></span>
                <input type="text" value={expectationNote} onChange={(event) => setExpectationNote(event.target.value)} className={INPUT_CLASS} placeholder="Why this is your expectation" />
                <span className="form-field-hint">Saved only on this device.</span>
              </label>
            </div>
            <button type="button" className="field-button field-button-primary mt-4 gap-2" onClick={saveExpectation} disabled={!selectedReleaseDate || !canSaveExpectation}>
              {savedExpectation ? <Check size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} {savedExpectation ? "Update expectation" : "Save expectation"}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="surface-card-muted p-3.5">
              <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Expectation</p>
              <p className="mt-2 text-xl font-semibold text-amber-200">{savedExpectation ? formatValue(savedExpectation.value) : "Not set"}</p>
              <p className="mt-1 text-xs text-stealth-500">{selectedSeries?.unit ?? "—"}</p>
            </div>
            <div className="surface-card-muted p-3.5">
              <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Official result</p>
              <p className="mt-2 text-xl font-semibold text-stealth-100">{formatValue(activePoint?.value)}</p>
              <p className="mt-1 text-xs text-stealth-500">{activePoint?.market_year ?? "Awaiting release"}</p>
            </div>
            <div className="surface-card-muted p-3.5">
              <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Report signal</p>
              <p className={`mt-2 text-xl font-semibold ${activePoint?.bullish_signal_z === null || activePoint?.bullish_signal_z === undefined ? "text-stealth-300" : activePoint.bullish_signal_z >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{formatSigned(activePoint?.bullish_signal_z, "σ")}</p>
              <p className="mt-1 text-xs text-stealth-500">Positive = price-supportive</p>
            </div>
            <div className="surface-card-muted p-3.5">
              <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Futures reaction</p>
              <p className="mt-2 text-xl font-semibold text-sky-200">{formatSigned(activePoint?.reaction_1d_pct, "%")}</p>
              <p className="mt-1 text-xs text-stealth-500">5 sessions {formatSigned(activePoint?.reaction_5d_pct, "%")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="surface-card min-w-0 p-4 md:p-5">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 shrink-0 text-sky-300" size={18} aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-stealth-100">How to read the standardized chart</h2>
              <dl className="mt-3 space-y-3 text-sm leading-6">
                {Object.entries(data.methodology).map(([key, value]) => (
                  <div key={key}><dt className="inline font-semibold capitalize text-stealth-200">{key}: </dt><dd className="inline text-stealth-400">{value}</dd></div>
                ))}
              </dl>
            </div>
          </div>
        </div>
        <div className="surface-card min-w-0 p-4 md:p-5">
          <h2 className="text-sm font-semibold text-stealth-100">Upcoming release board</h2>
          <DataScroller label="Upcoming agriculture report schedule" hint="Official dates, recurring times, and expected dates are labeled separately.">
            <table className="mt-3 min-w-[680px] w-full text-left text-xs">
              <thead className="border-b border-stealth-700 text-stealth-500"><tr><th className="py-2 pr-4 font-semibold">Report</th><th className="py-2 pr-4 font-semibold">Date</th><th className="py-2 pr-4 font-semibold">Time</th><th className="py-2 font-semibold">Timing status</th></tr></thead>
              <tbody className="divide-y divide-stealth-800">
                {data.schedule.slice(0, 9).map((event) => (
                  <tr key={`${event.report_id}-${event.release_at}`} className="text-stealth-300"><td className="py-2.5 pr-4 font-semibold text-stealth-200">{event.report}</td><td className="py-2.5 pr-4">{formatDate(event.release_at)}</td><td className="py-2.5 pr-4">{event.time_label}</td><td className="py-2.5">{confidenceLabel(event.confidence)}</td></tr>
                ))}
              </tbody>
            </table>
          </DataScroller>
        </div>
      </section>
    </div>
  );
}
