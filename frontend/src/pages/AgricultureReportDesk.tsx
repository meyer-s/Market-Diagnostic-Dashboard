/*
THESIS: One report, one primary read, and one visual should answer what changed before deeper evidence is opened.
OWN-WORLD: Evidence Field — dark, exacting, source-forward, and operational.
STORY: Choose a report, understand its latest change, then open source evidence or the expectation journal only when needed.
FIRST VIEWPORT: A complete report navigator above one focused report workspace.
FORM: A linear evidence workspace with progressive disclosure for supporting detail.
*/

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Clock3,
  Download,
  ExternalLink,
  Info,
  Save,
  TriangleAlert,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
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

type ReportCoverage = "chart_ready" | "history_ready" | "latest_snapshot" | "official_archive";

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
  release_count: number;
  observed_start_date: string | null;
  observed_end_date: string | null;
};

type ReportReleaseMetric = {
  id: string;
  label: string;
  value: number;
  unit: string;
  previous_week?: number | null;
  previous_year?: number | null;
  five_year_average?: number | null;
  chart_group?: "condition" | "progress";
  comparison_quality?: "implied_from_published_rounded_percent";
};

type ReportReleaseDocument = {
  label: string;
  format: string;
  url: string;
};

type ReportRelease = {
  release_date: string;
  title: string;
  source_url: string;
  documents: ReportReleaseDocument[];
  metrics: ReportReleaseMetric[];
};

type ReportHistory = {
  report_id: string;
  scope_key: string | null;
  scope_label: string | null;
  requested_start_date: string;
  observed_start_date: string | null;
  observed_end_date: string | null;
  release_count: number;
  returned_count: number;
  truncated: boolean;
  releases: ReportRelease[];
  analysis: {
    chart_kind: "production_trend" | "progress_benchmark" | "sales_flow" | "inspection_pace" | "stocks_composition" | "acreage_comparison" | "positioning_balance";
    title: string;
    subtitle: string;
    primary_metric_id: string;
    latest_release_date: string;
    latest_value: number;
    previous_value: number | null;
    four_report_average: number | null;
    unit: string;
    headline: string;
    body: string;
    comparison_basis: string;
  } | null;
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
  history_coverage: {
    structured_start_date: string;
    requested_start_date: string;
    observed_start_date: string | null;
    observed_end_date: string | null;
    release_count: number;
    complete: boolean;
    source: string;
  };
  next_release: ReleaseEvent | null;
  latest_release: MetricPoint | null;
  reports: ReportCatalogItem[];
  report_histories: Record<string, ReportHistory>;
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
  if (coverage === "history_ready") return "border-sky-400/40 bg-sky-400/10 text-sky-200";
  if (coverage === "latest_snapshot") return "border-sky-400/40 bg-sky-400/10 text-sky-200";
  return "border-stealth-600 bg-stealth-800 text-stealth-300";
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

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ArchiveTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; fill?: string }>; label?: number | string }) {
  if (!active || !payload?.length || label === undefined) return null;
  const heading = typeof label === "number" ? formatDate(new Date(label).toISOString()) : String(label);
  return (
    <div className="max-w-[290px] rounded-lg border border-stealth-600 bg-stealth-900/95 p-3 shadow-xl">
      <p className="text-xs font-semibold text-stealth-200">{heading}</p>
      <div className="mt-2 space-y-1.5">
        {payload.filter((item) => item.value !== null && item.value !== undefined).map((item) => (
          <p key={item.name} className="flex items-center justify-between gap-5 text-xs text-stealth-300">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: item.color ?? item.fill }} />{item.name}</span>
            <strong className="tabular-nums text-stealth-100">{formatValue(Number(item.value), 2)}</strong>
          </p>
        ))}
      </div>
    </div>
  );
}

function releaseMetric(release: ReportRelease, metricId: string) {
  return release.metrics.find((metric) => metric.id === metricId) ?? null;
}

function archiveTimeSeries(history: ReportHistory, metricIds: string[], limit = 104) {
  return [...history.releases]
    .reverse()
    .map((release) => {
      const row: Record<string, number | string | null> = {
        timestamp: new Date(`${release.release_date}T12:00:00`).getTime(),
        releaseDate: release.release_date,
      };
      metricIds.forEach((metricId) => { row[metricId] = releaseMetric(release, metricId)?.value ?? null; });
      return row;
    })
    .filter((row) => metricIds.some((metricId) => row[metricId] !== null))
    .slice(-limit);
}

type ComparisonTile = {
  label: string;
  display: string;
  detail: string;
  currentLabel: string;
  currentValue: number;
  baselineLabel: string;
  baselineValue: number;
  unit?: string;
};

function metricDigits(value: number) {
  return Math.abs(value) < 1_000 && !Number.isInteger(value) ? 1 : 0;
}

function signedPercentChange(current: number, baseline: number | null | undefined) {
  if (baseline === null || baseline === undefined || baseline === 0) return null;
  return (current / baseline - 1) * 100;
}

function comparisonDisplay(delta: number | null, suffix = "%") {
  if (delta === null || Number.isNaN(delta)) return "—";
  const digits = suffix === " pts" ? 0 : 1;
  return `${delta > 0 ? "↑ " : delta < 0 ? "↓ " : "→ "}${delta > 0 ? "+" : ""}${delta.toFixed(digits)}${suffix}`;
}

function comparisonDetail(delta: number | null, baselineLabel: string) {
  if (delta === null) return `No usable ${baselineLabel.toLowerCase()} baseline`;
  if (Math.abs(delta) < 0.05) return `In line with ${baselineLabel.toLowerCase()}`;
  return `${delta > 0 ? "Higher" : "Lower"} than ${baselineLabel.toLowerCase()}`;
}

function ComparisonBars({ tile, unit }: { tile: ComparisonTile; unit: string }) {
  const scale = Math.max(Math.abs(tile.currentValue), Math.abs(tile.baselineValue), 1);
  const currentWidth = `${Math.max(4, Math.abs(tile.currentValue) / scale * 100)}%`;
  const baselineWidth = `${Math.max(4, Math.abs(tile.baselineValue) / scale * 100)}%`;
  const digits = metricDigits(Math.max(Math.abs(tile.currentValue), Math.abs(tile.baselineValue)));

  return (
    <div className="mt-4 hidden space-y-2 sm:block" role="img" aria-label={`${tile.currentLabel} ${formatValue(tile.currentValue, digits)} ${tile.unit ?? unit}; ${tile.baselineLabel} ${formatValue(tile.baselineValue, digits)} ${tile.unit ?? unit}`}>
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 text-xs text-stealth-400">
        <span>{tile.currentLabel}</span>
        <span className="h-2 overflow-hidden rounded-full bg-stealth-900"><span className="block h-full rounded-full bg-sky-300" style={{ width: currentWidth }} /></span>
        <span className="tabular-nums text-stealth-200">{formatValue(tile.currentValue, digits)}</span>
      </div>
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 text-xs text-stealth-500">
        <span>{tile.baselineLabel}</span>
        <span className="h-2 overflow-hidden rounded-full bg-stealth-900"><span className="block h-full rounded-full bg-stealth-500" style={{ width: baselineWidth }} /></span>
        <span className="tabular-nums text-stealth-300">{formatValue(tile.baselineValue, digits)}</span>
      </div>
    </div>
  );
}

function chartShell(chart: ReactNode, ariaLabel: string) {
  return (
    <div className="mt-5 h-[360px] min-w-0 rounded-xl bg-stealth-900/35 px-1 pt-3 md:h-[410px] md:px-3" aria-label={ariaLabel}>
      {chart}
    </div>
  );
}

function ArchiveReportInsights({ history, commodityName }: { history: ReportHistory; commodityName: string }) {
  const analysis = history.analysis;
  if (!analysis) {
    return (
      <div>
        <p className="page-kicker">Report interpretation</p>
        <h2 className="mt-1 text-xl font-semibold text-stealth-100">Chart metrics are not available for this selection</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stealth-400">The dated source files remain available in the raw viewer. This commodity/report pairing does not expose a national metric that can be compared honestly.</p>
      </div>
    );
  }

  const latestRelease = history.releases.find((release) => release.release_date === analysis.latest_release_date) ?? history.releases[0];
  const primaryMetric = latestRelease ? releaseMetric(latestRelease, analysis.primary_metric_id) : null;
  const comparisons: ComparisonTile[] = [];
  const addPercentComparison = (label: string, baseline: number | null | undefined, baselineLabel: string) => {
    if (baseline === null || baseline === undefined) return;
    const delta = signedPercentChange(analysis.latest_value, baseline);
    comparisons.push({
      label,
      display: comparisonDisplay(delta),
      detail: comparisonDetail(delta, baselineLabel),
      currentLabel: "Now",
      currentValue: analysis.latest_value,
      baselineLabel,
      baselineValue: baseline,
    });
  };
  const addPointComparison = (label: string, baseline: number | null | undefined, baselineLabel: string) => {
    if (baseline === null || baseline === undefined) return;
    const delta = analysis.latest_value - baseline;
    comparisons.push({
      label,
      display: comparisonDisplay(delta, " pts"),
      detail: comparisonDetail(delta, baselineLabel),
      currentLabel: "Now",
      currentValue: analysis.latest_value,
      baselineLabel,
      baselineValue: baseline,
    });
  };
  const addRawComparison = (label: string, baseline: number | null | undefined, baselineLabel: string) => {
    if (baseline === null || baseline === undefined) return;
    const delta = analysis.latest_value - baseline;
    comparisons.push({
      label,
      display: `${delta > 0 ? "↑ +" : delta < 0 ? "↓ " : "→ "}${compactNumber(delta)}`,
      detail: comparisonDetail(delta, baselineLabel),
      currentLabel: "Now",
      currentValue: analysis.latest_value,
      baselineLabel,
      baselineValue: baseline,
    });
  };

  if (analysis.chart_kind === "progress_benchmark") {
    addPointComparison("Week over week", primaryMetric?.previous_week, "Prior week");
    addPointComparison(
      primaryMetric?.five_year_average !== null && primaryMetric?.five_year_average !== undefined ? "Against normal" : "Year over year",
      primaryMetric?.five_year_average ?? primaryMetric?.previous_year,
      primaryMetric?.five_year_average !== null && primaryMetric?.five_year_average !== undefined ? "5Y avg" : "Last year",
    );
  } else if (analysis.chart_kind === "production_trend") {
    addPercentComparison("Year over year", releaseMetric(latestRelease, "production_year_ago")?.value, "Year ago");
    addPercentComparison("Latest revision", analysis.previous_value, "Prior est.");
  } else if (analysis.chart_kind === "stocks_composition") {
    addPercentComparison("Year over year", releaseMetric(latestRelease, "total_stocks_year_ago")?.value, "Year ago");
    const total = releaseMetric(latestRelease, "total_stocks")?.value;
    const onFarm = releaseMetric(latestRelease, "on_farm_stocks")?.value;
    if (total && onFarm !== null && onFarm !== undefined) {
      const share = onFarm / total * 100;
      comparisons.push({ label: "Storage mix", display: `${share.toFixed(1)}%`, detail: "Of total stocks held on farm", currentLabel: "On farm", currentValue: share, baselineLabel: "Total", baselineValue: 100, unit: "Percent" });
    }
  } else if (analysis.chart_kind === "acreage_comparison") {
    addPercentComparison("Year over year", releaseMetric(latestRelease, "planted_area_year_ago")?.value, "Year ago");
    const planted = releaseMetric(latestRelease, "planted_area")?.value;
    const harvested = releaseMetric(latestRelease, "harvested_area")?.value;
    if (planted && harvested !== null && harvested !== undefined) {
      const share = harvested / planted * 100;
      comparisons.push({ label: "Harvest footprint", display: `${share.toFixed(1)}%`, detail: "Of planted area expected harvested", currentLabel: "Harvest", currentValue: share, baselineLabel: "Planted", baselineValue: 100, unit: "Percent" });
    }
  } else if (analysis.chart_kind === "positioning_balance") {
    addRawComparison("Weekly move", analysis.previous_value, "Prior report");
    addRawComparison("Against recent positioning", analysis.four_report_average, "4-report avg");
  } else if (analysis.chart_kind === "sales_flow") {
    addRawComparison("Versus last report", analysis.previous_value, "Prior report");
    addRawComparison("Versus recent pace", analysis.four_report_average, "4-report avg");
  } else {
    addPercentComparison("Versus last report", analysis.previous_value, "Prior report");
    addPercentComparison("Versus recent pace", analysis.four_report_average, "4-report avg");
  }

  let chart: ReactNode = null;

  if (analysis.chart_kind === "production_trend") {
    const rows = archiveTimeSeries(history, ["production", "production_year_ago"], 60);
    const hasImpliedComparison = history.releases.some((release) => releaseMetric(release, "production_year_ago")?.comparison_quality);
    chart = chartShell(
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={rows} margin={{ top: 12, right: 10, bottom: 6, left: 2 }} accessibilityLayer aria-label="Published production estimate history and year-ago crop comparison">
          <CartesianGrid stroke="rgba(98,117,142,0.38)" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis width={58} tickFormatter={compactNumber} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} domain={["auto", "auto"]} />
          <Tooltip content={<ArchiveTooltip />} />
          <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
          <Line type="monotone" dataKey="production" name="Current estimate" stroke="#a8d2ff" strokeWidth={3.25} dot={{ r: 3, fill: "#a8d2ff" }} activeDot={{ r: 6 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="production_year_ago" name={hasImpliedComparison ? "Implied year-ago crop" : "Year-ago crop"} stroke="#91a4bd" strokeWidth={2} strokeDasharray="7 5" dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>,
      `${commodityName} published production estimates and year-ago crop comparisons`,
    );
  } else if (analysis.chart_kind === "progress_benchmark") {
    const metrics = (latestRelease?.metrics ?? []).filter((metric) => metric.chart_group).slice(0, 6);
    const rows = metrics.map((metric) => ({
      name: metric.label,
      current: metric.value,
      previous: metric.previous_week ?? null,
      benchmark: metric.five_year_average ?? metric.previous_year ?? null,
    }));
    chart = chartShell(
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} margin={{ top: 12, right: 8, bottom: 45, left: 0 }} accessibilityLayer aria-label="Latest crop progress and condition compared with published benchmarks">
          <CartesianGrid stroke="rgba(98,117,142,0.38)" vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-18} textAnchor="end" height={72} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis width={44} domain={[0, 100]} tickFormatter={(value) => `${value}%`} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <Tooltip content={<ArchiveTooltip />} />
          <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
          <Bar dataKey="current" name="Current" fill="#a8d2ff" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false} />
          <Bar dataKey="previous" name="Previous week" fill="#62758e" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false} />
          <Bar dataKey="benchmark" name="5Y avg / prior year" fill="#f3cb69" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>,
      `${commodityName} crop progress and condition against USDA benchmarks`,
    );
  } else if (analysis.chart_kind === "sales_flow") {
    const rows = archiveTimeSeries(history, ["net_sales", "weekly_exports"], 52);
    chart = chartShell(
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={rows} margin={{ top: 12, right: 10, bottom: 6, left: 2 }} accessibilityLayer aria-label="Weekly net export sales and exports shipped history">
          <CartesianGrid stroke="rgba(98,117,142,0.38)" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis width={62} tickFormatter={compactNumber} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <Tooltip content={<ArchiveTooltip />} />
          <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
          <ReferenceLine y={0} stroke="#6f8199" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="net_sales" name="Net sales" stroke="#a8d2ff" strokeWidth={3.1} dot={false} activeDot={{ r: 6 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="weekly_exports" name="Exports shipped" stroke="#91a4bd" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>,
      `${commodityName} weekly net export sales and exports shipped`,
    );
  } else if (analysis.chart_kind === "inspection_pace") {
    const rawRows = archiveTimeSeries(history, ["inspected_volume"], 56);
    const rows = rawRows.map((row, index) => {
      const window = rawRows.slice(Math.max(0, index - 3), index + 1).map((item) => Number(item.inspected_volume));
      return { ...row, rolling_average: window.reduce((sum, value) => sum + value, 0) / window.length };
    });
    chart = chartShell(
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={rows} margin={{ top: 12, right: 10, bottom: 6, left: 2 }} accessibilityLayer aria-label="Weekly export inspections and four-week moving average history">
          <CartesianGrid stroke="rgba(98,117,142,0.38)" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis width={62} tickFormatter={compactNumber} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <Tooltip content={<ArchiveTooltip />} />
          <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
          <Bar dataKey="inspected_volume" name="Weekly inspections" fill="#62758e" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          <Line type="monotone" dataKey="rolling_average" name="4-week pace" stroke="#a8d2ff" strokeWidth={3.2} dot={false} activeDot={{ r: 6 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>,
      `${commodityName} weekly export inspections and four-week moving average`,
    );
  } else if (analysis.chart_kind === "stocks_composition") {
    const yearAgoStocks = releaseMetric(latestRelease, "total_stocks_year_ago");
    const rows = [
      { name: "Total", current: releaseMetric(latestRelease, "total_stocks")?.value ?? null, yearAgo: yearAgoStocks?.value ?? null },
      { name: "On farm", current: releaseMetric(latestRelease, "on_farm_stocks")?.value ?? null, yearAgo: releaseMetric(latestRelease, "on_farm_stocks_year_ago")?.value ?? null },
      { name: "Off farm", current: releaseMetric(latestRelease, "off_farm_stocks")?.value ?? null, yearAgo: releaseMetric(latestRelease, "off_farm_stocks_year_ago")?.value ?? null },
    ];
    chart = chartShell(
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} layout="vertical" margin={{ top: 12, right: 18, bottom: 8, left: 6 }} accessibilityLayer aria-label="Latest total on-farm and off-farm stocks compared with year ago">
          <CartesianGrid stroke="rgba(98,117,142,0.38)" horizontal={false} />
          <XAxis type="number" tickFormatter={compactNumber} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis dataKey="name" type="category" width={68} stroke="#62758e" tick={{ fill: "#d6dee9", fontSize: 12 }} />
          <Tooltip content={<ArchiveTooltip />} />
          <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
          <Bar dataKey="current" name="Current stocks" fill="#a8d2ff" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="yearAgo" name={yearAgoStocks?.comparison_quality ? "Implied year ago" : "Year ago"} fill="#62758e" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>,
      `${commodityName} latest stocks by storage position compared with year ago where published`,
    );
  } else if (analysis.chart_kind === "acreage_comparison") {
    const yearAgoArea = releaseMetric(latestRelease, "planted_area_year_ago");
    const rows = [
      { name: "Planted", current: releaseMetric(latestRelease, "planted_area")?.value ?? null, yearAgo: yearAgoArea?.value ?? null },
      { name: "Harvested", current: releaseMetric(latestRelease, "harvested_area")?.value ?? null, yearAgo: releaseMetric(latestRelease, "harvested_area_year_ago")?.value ?? null },
    ];
    chart = chartShell(
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} layout="vertical" margin={{ top: 12, right: 18, bottom: 8, left: 6 }} accessibilityLayer aria-label="Latest planted and harvested acreage compared with year ago">
          <CartesianGrid stroke="rgba(98,117,142,0.38)" horizontal={false} />
          <XAxis type="number" stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis dataKey="name" type="category" width={78} stroke="#62758e" tick={{ fill: "#d6dee9", fontSize: 12 }} />
          <Tooltip content={<ArchiveTooltip />} />
          <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
          <Bar dataKey="current" name="Current acreage" fill="#a8d2ff" radius={[0, 4, 4, 0]} maxBarSize={32} isAnimationActive={false} />
          <Bar dataKey="yearAgo" name={yearAgoArea?.comparison_quality ? "Implied year ago" : "Year ago"} fill="#62758e" radius={[0, 4, 4, 0]} maxBarSize={32} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>,
      `${commodityName} planted and harvested acreage compared with year ago`,
    );
  } else {
    const rows = archiveTimeSeries(history, ["noncommercial_net", "open_interest"], 104);
    chart = chartShell(
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={rows} margin={{ top: 12, right: 5, bottom: 6, left: 0 }} accessibilityLayer aria-label="Noncommercial net futures position and open interest history">
          <CartesianGrid stroke="rgba(98,117,142,0.38)" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis yAxisId="net" width={62} tickFormatter={compactNumber} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <YAxis yAxisId="oi" orientation="right" width={62} tickFormatter={compactNumber} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
          <Tooltip content={<ArchiveTooltip />} />
          <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
          <ReferenceLine yAxisId="net" y={0} stroke="#6f8199" strokeDasharray="3 3" />
          <Bar yAxisId="oi" dataKey="open_interest" name="Open interest" fill="#62758e" opacity={0.45} maxBarSize={18} isAnimationActive={false} />
          <Line yAxisId="net" type="monotone" dataKey="noncommercial_net" name="Noncommercial net" stroke="#a8d2ff" strokeWidth={3.2} dot={false} activeDot={{ r: 6 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>,
      `${commodityName} noncommercial net position and total open interest`,
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-kicker">Report interpretation</p>
          <h2 className="mt-1 text-xl font-semibold text-stealth-100">{analysis.title}</h2>
        </div>
        <span className="rounded-full border border-sky-400/45 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-200">{formatDate(analysis.latest_release_date)}</span>
      </div>

      <section className="mt-5 overflow-hidden rounded-xl border border-stealth-600 bg-stealth-900/30" aria-labelledby="archive-at-a-glance">
        <h3 id="archive-at-a-glance" className="sr-only">What this report is saying</h3>
        <div className={`grid ${comparisons.length > 1 ? "grid-cols-2 md:grid-cols-3" : "md:grid-cols-2"}`}>
          <div className={`border-b border-stealth-700 bg-sky-300/[0.06] p-4 md:col-span-1 md:border-b-0 md:p-5 ${comparisons.length > 1 ? "col-span-2" : ""}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-200">Latest reading</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-stealth-100 md:text-4xl">{formatValue(analysis.latest_value, metricDigits(analysis.latest_value))}</p>
            <p className="mt-1 text-sm text-stealth-300">{primaryMetric?.label ?? analysis.headline} · {analysis.unit}</p>
          </div>
          {comparisons.slice(0, 2).map((tile, index) => (
            <div key={tile.label} className={`p-4 md:border-l md:border-stealth-700 md:p-5 ${index === 0 && comparisons.length > 1 ? "border-r border-stealth-700 md:border-r-0" : ""}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-400">{tile.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-sky-100 md:text-3xl">{tile.display}</p>
              <p className="mt-1 text-sm text-stealth-300">{tile.detail}</p>
              <ComparisonBars tile={tile} unit={analysis.unit} />
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 border-t border-stealth-700 px-4 py-3.5 md:px-5">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-300" aria-hidden="true" />
          <p className="text-sm leading-6 text-stealth-200"><strong className="font-semibold text-stealth-100">Bottom line:</strong> {analysis.body}</p>
        </div>
      </section>

      {chart}
      <p className="mt-3 text-xs leading-5 text-stealth-500">{analysis.subtitle} · Native report units · Gaps indicate no safely comparable national observation.</p>
    </>
  );
}

export default function AgricultureReportDesk() {
  const [symbol, setSymbol] = useState("ZC");
  const [years, setYears] = useState<1 | 3 | 5 | 10 | 150>(3);
  const [metric, setMetric] = useState("ending_stocks");
  const [selectedReportId, setSelectedReportId] = useState("wasde");
  const [showFutures, setShowFutures] = useState(false);
  const [expectations, setExpectations] = useState<Expectations>(() => readExpectations());
  const [selectedReleaseDate, setSelectedReleaseDate] = useState("");
  const [selectedArchiveReleaseDate, setSelectedArchiveReleaseDate] = useState("");
  const [expectationInput, setExpectationInput] = useState("");
  const [expectationNote, setExpectationNote] = useState("");
  const endpoint = `/agriculture/report-desk?symbol=${encodeURIComponent(symbol)}&years=${years}&metric=${encodeURIComponent(metric)}`;
  const { data, loading, error, refetch } = useApi<ReportDeskData>(endpoint, { timeoutMs: 60_000, retainPreviousData: false });

  const selectedSeries = useMemo(
    () => data?.series.find((layer) => layer.metric_id === metric) ?? data?.series[0] ?? null,
    [data, metric],
  );
  const selectedReport = data?.reports.find((report) => report.id === selectedReportId) ?? data?.reports[0] ?? null;
  const selectedReportHistory = data?.report_histories?.[selectedReportId] ?? null;
  const selectedArchiveRelease = selectedReportHistory?.releases.find(
    (release) => release.release_date === selectedArchiveReleaseDate,
  ) ?? selectedReportHistory?.releases[0] ?? null;
  const nextSelectedReportRelease = data?.schedule.find((event) => event.report_id === selectedReportId) ?? null;

  useEffect(() => {
    const releases = selectedReportHistory?.releases ?? [];
    if (releases.some((release) => release.release_date === selectedArchiveReleaseDate)) return;
    setSelectedArchiveReleaseDate(releases[0]?.release_date ?? "");
  }, [selectedArchiveReleaseDate, selectedReportHistory]);

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

  const focusedWasdeChartData = useMemo(() => {
    const merged = new Map<number, { timestamp: number; actual?: number | null; expectation?: number | null; futures?: number | null }>();
    rawChartData.forEach((row) => merged.set(row.timestamp, { ...row }));
    data?.price_history.forEach((price) => {
      const timestamp = new Date(`${price.date}T12:00:00`).getTime();
      merged.set(timestamp, { ...(merged.get(timestamp) ?? { timestamp }), futures: price.rebased });
    });
    return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [data?.price_history, rawChartData]);

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
          <p className="page-subtitle max-w-4xl">Choose a report, read the latest change, then open the source only when you need it.</p>
        </div>
        <a className="field-button field-button-secondary gap-2" href={buildApiUrl("/agriculture/report-desk/calendar.ics")} download>
          <Download size={16} aria-hidden="true" /> Add release calendar
        </a>
      </header>

      <section aria-labelledby="report-family-title" className="surface-card overflow-hidden">
        <div className="border-b border-stealth-700 px-4 py-3 md:px-5">
          <h2 id="report-family-title" className="text-sm font-semibold text-stealth-100">Choose a report</h2>
        </div>
        <label className="block p-4 md:hidden">
          <span className="sr-only">Report family</span>
          <select value={selectedReportId} onChange={(event) => { setSelectedReportId(event.target.value); setSelectedArchiveReleaseDate(""); }} className={INPUT_CLASS}>
            {data.reports.map((report) => <option key={report.id} value={report.id}>{report.name} · {(report.release_count ?? 0).toLocaleString()} releases</option>)}
          </select>
        </label>
        <div className="hidden grid-cols-4 gap-px bg-stealth-700 md:grid xl:grid-cols-8" role="group" aria-label="Agriculture report families">
          {data.reports.map((report) => (
            <button
              key={report.id}
              type="button"
              aria-pressed={selectedReportId === report.id}
              onClick={() => { setSelectedReportId(report.id); setSelectedArchiveReleaseDate(""); }}
              className={`min-h-[4.5rem] bg-stealth-900 px-3 py-3 text-left transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 ${selectedReportId === report.id ? "bg-sky-300/[0.10] text-sky-100" : "text-stealth-300 hover:bg-stealth-800 hover:text-stealth-100"}`}
            >
              <span className="block text-sm font-semibold leading-5">{report.name}</span>
              <span className="mt-1 block text-xs tabular-nums text-stealth-500">{(report.release_count ?? 0).toLocaleString()} releases</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Report filters" className="surface-card overflow-hidden">
        <div className="grid divide-y divide-stealth-700 md:grid-cols-3 md:divide-x md:divide-y-0">
          <label className="p-4">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Commodity</span>
            <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setSelectedReleaseDate(""); setSelectedArchiveReleaseDate(""); }} className={INPUT_CLASS}>
              {data.commodities.map((item) => <option key={item.symbol} value={item.symbol}>{item.name}</option>)}
            </select>
          </label>
          {selectedReportId === "wasde" ? (
            <label className="p-4">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">WASDE metric</span>
              <select value={metric} onChange={(event) => { setMetric(event.target.value); setSelectedReleaseDate(""); }} className={INPUT_CLASS}>
                {data.metrics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          ) : (
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Comparison</p>
              <p className="mt-2 text-sm font-semibold text-stealth-100">{selectedReportHistory?.analysis?.title ?? "Official source history"}</p>
              <p className="mt-1 text-xs text-stealth-500">{selectedReportHistory?.analysis?.comparison_basis ?? "No comparable national metric"}</p>
            </div>
          )}
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">History</p>
            <div className="mt-2"><SegmentedControl label="Report history window" value={years} options={[{ value: 1, label: "1Y" }, { value: 3, label: "3Y" }, { value: 5, label: "5Y" }, { value: 10, label: "10Y" }, { value: 150, label: "All" }]} onChange={setYears} accent="emerald" /></div>
          </div>
        </div>
      </section>

      {data.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300/40 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100" role="status">
          <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" /><p>{data.warnings.join(" ")}</p></div>
        </div>
      ) : null}

      <section className="surface-card-strong min-w-0 overflow-hidden">
        {selectedReport ? (
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stealth-700 px-4 py-4 md:px-6 md:py-5">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold text-stealth-100">{selectedReport.name}</h2>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${coverageTone(selectedReport.coverage)}`}>{selectedReport.coverage_label}</span>
              </div>
              <p className="mt-1 text-sm text-stealth-400">{selectedReport.agency} · {selectedReport.cadence} · {selectedReport.release_time}</p>
              {nextSelectedReportRelease ? <p className="mt-2 flex items-center gap-2 text-sm text-sky-200"><Clock3 size={15} aria-hidden="true" /> Next release {formatDate(nextSelectedReportRelease.release_at)} at {nextSelectedReportRelease.time_label}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={selectedReport.source_url} target="_blank" rel="noreferrer" className="field-button field-button-primary gap-2">Official report <ExternalLink size={15} aria-hidden="true" /></a>
              <a href={selectedReport.archive_url} target="_blank" rel="noreferrer" className="field-button field-button-secondary gap-2">Archive <ExternalLink size={15} aria-hidden="true" /></a>
            </div>
          </div>
        ) : null}

        <div className="p-4 md:p-6">
          {selectedReportId === "wasde" && selectedSeries && latest ? (
            <>
              <div className="grid divide-y divide-stealth-700 border-b border-stealth-700 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
                <div className="pb-4 sm:pr-5 xl:pb-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Latest {selectedSeries.label.toLowerCase()}</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums text-stealth-100">{formatValue(latest.value)}</p>
                  <p className="mt-1 text-sm text-stealth-400">{latest.unit} · {latest.market_year}</p>
                </div>
                <div className="py-4 sm:pl-5 sm:pt-0 xl:px-5 xl:pb-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Revision</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-stealth-100">{formatSigned(latest.revision)}</p>
                  <p className="mt-1 text-sm text-stealth-400">From {formatValue(latest.prior_value)}</p>
                </div>
                <div className="py-4 sm:border-t sm:border-stealth-700 sm:pr-5 xl:border-t-0 xl:px-5 xl:pt-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Supply-demand read</p>
                  <p className="mt-2 text-2xl font-semibold text-stealth-100">{signalLabel(latestSignal)}</p>
                  <p className="mt-1 text-sm text-stealth-400">{formatSigned(latestSignal, "σ")} versus history</p>
                </div>
                <div className="pt-4 sm:border-t sm:border-stealth-700 sm:pl-5 xl:border-t-0 xl:pl-5 xl:pt-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Futures response</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-stealth-100">{formatSigned(latest.reaction_1d_pct, "%")}</p>
                  <p className="mt-1 text-sm text-stealth-400">Release-day close · 5D {formatSigned(latest.reaction_5d_pct, "%")}</p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-stealth-100">{selectedSeries.label} history</h3>
                  <p className="mt-1 text-sm text-stealth-400">Official values as published. Saved expectations appear as a dashed line.</p>
                </div>
                <button type="button" aria-pressed={showFutures} onClick={() => setShowFutures((current) => !current)} className={`field-button gap-2 ${showFutures ? "field-button-primary" : "field-button-secondary"}`}>
                  {showFutures ? "Hide futures context" : "Compare with futures"}
                </button>
              </div>

              <div className="mt-4 h-[360px] min-w-0 rounded-xl bg-stealth-900/35 px-1 pt-3 md:h-[470px] md:px-3">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={focusedWasdeChartData} margin={{ top: 12, right: showFutures ? 8 : 18, bottom: 8, left: 0 }} accessibilityLayer aria-label={`${selectedSeries.label} official history${showFutures ? ` compared with ${data.commodity.name} futures` : ""}`}>
                    <CartesianGrid stroke="rgba(98,117,142,0.38)" vertical={false} />
                    <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
                    <YAxis yAxisId="report" width={64} domain={["auto", "auto"]} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
                    {showFutures ? <YAxis yAxisId="price" orientation="right" width={52} domain={["auto", "auto"]} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} /> : null}
                    <Tooltip content={<ArchiveTooltip />} />
                    <Legend verticalAlign="top" height={34} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
                    <Line yAxisId="report" type="monotone" dataKey="actual" name={`Official ${selectedSeries.label}`} stroke="#a8d2ff" strokeWidth={3.2} dot={{ r: 3, fill: "#a8d2ff" }} activeDot={{ r: 6 }} connectNulls isAnimationActive={false} />
                    <Line yAxisId="report" type="monotone" dataKey="expectation" name="Your expectation" stroke="#f3cb69" strokeWidth={2} strokeDasharray="7 5" dot={{ r: 4, fill: "#0e1520", stroke: "#f3cb69", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                    {showFutures ? <Line yAxisId="price" type="monotone" dataKey="futures" name={`${data.commodity.name} futures (100)`} stroke="#91a4bd" strokeWidth={1.6} dot={false} opacity={0.8} isAnimationActive={false} /> : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-sm leading-6 text-stealth-300"><strong className="font-semibold text-stealth-100">Latest read:</strong> {data.takeaways[0]?.body}</p>
            </>
          ) : selectedReportHistory ? (
            <ArchiveReportInsights history={selectedReportHistory} commodityName={selectedReportHistory.scope_label ?? data.commodity.name} />
          ) : null}
        </div>
      </section>

      <details className="surface-card group overflow-hidden">
        <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5">
          <span>
            <span className="block text-sm font-semibold text-stealth-100">Release details</span>
            <span className="mt-1 block text-xs text-stealth-500">Raw metrics, dated records, and source documents</span>
          </span>
          <span className="text-xs font-semibold text-sky-200 group-open:hidden">Open</span>
          <span className="hidden text-xs font-semibold text-sky-200 group-open:inline">Close</span>
        </summary>
        <div className="border-t border-stealth-700 p-4 md:p-5">
          {selectedReport ? <p className="max-w-3xl text-sm leading-6 text-stealth-300">{selectedReport.description}</p> : null}
          {selectedReportId === "wasde" && selectedSeries && latest ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-stealth-900/45 p-4"><p className="text-xs text-stealth-500">Latest result</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatValue(latest.value)}</p><p className="text-xs text-stealth-500">{latest.unit} · {latest.market_year}</p></div>
              <div className="rounded-lg bg-stealth-900/45 p-4"><p className="text-xs text-stealth-500">Prior estimate</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatValue(latest.prior_value)}</p><p className="text-xs text-stealth-500">Revision {formatSigned(latest.revision)}</p></div>
            </div>
          ) : selectedReportHistory && selectedArchiveRelease ? (
            <div className="mt-4 space-y-4">
              <label className="block max-w-2xl">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Release date</span>
                <select value={selectedArchiveRelease.release_date} onChange={(event) => setSelectedArchiveReleaseDate(event.target.value)} className={INPUT_CLASS}>
                  {selectedReportHistory.releases.map((release) => <option key={release.release_date} value={release.release_date}>{formatDate(release.release_date)} · {release.title}</option>)}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {selectedArchiveRelease.metrics.slice(0, 4).map((releaseMetric) => (
                  <div key={releaseMetric.id} className="rounded-lg bg-stealth-900/45 p-4"><p className="text-xs text-stealth-500">{releaseMetric.label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatValue(releaseMetric.value, 1)}</p><p className="text-xs text-stealth-500">{releaseMetric.unit}</p></div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedArchiveRelease.documents.map((document) => <a key={`${document.format}:${document.url}`} href={document.url} target="_blank" rel="noreferrer" className="field-button field-button-secondary gap-2">Open {document.label} <ExternalLink size={14} aria-hidden="true" /></a>)}
                {selectedArchiveRelease.documents.length === 0 ? <a href={selectedArchiveRelease.source_url} target="_blank" rel="noreferrer" className="field-button field-button-secondary gap-2">Open release <ExternalLink size={14} aria-hidden="true" /></a> : null}
              </div>
            </div>
          ) : <p className="mt-4 text-sm text-stealth-400">No dated release is available for this selection.</p>}
        </div>
      </details>

      {selectedReportId === "wasde" ? <details className="surface-card group overflow-hidden">
        <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5">
          <span><span className="block text-sm font-semibold text-stealth-100">Expectation journal</span><span className="mt-1 block text-xs text-stealth-500">Record your number and review past release reactions</span></span>
          <span className="text-xs font-semibold text-sky-200 group-open:hidden">Open</span><span className="hidden text-xs font-semibold text-sky-200 group-open:inline">Close</span>
        </summary>
        <div className="border-t border-stealth-700 p-4 md:p-5">
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
        </div>
      </details> : null}

      <section className="space-y-4">
        <div className="surface-card min-w-0 p-4 md:p-5">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
              <span className="flex items-center gap-3">
                <Info className="shrink-0 text-sky-300" size={18} aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-stealth-100">Method and source notes</span>
                  <span className="mt-0.5 block text-xs text-stealth-500">Definitions, units, and interpretation limits</span>
                </span>
              </span>
              <span className="text-xs font-semibold text-sky-200 group-open:hidden">Show</span>
              <span className="hidden text-xs font-semibold text-sky-200 group-open:inline">Hide</span>
            </summary>
            <div className="mt-4 border-t border-stealth-700 pt-4">
              {selectedReportId === "wasde" ? (
                <dl className="mt-3 space-y-3 text-sm leading-6">
                  {Object.entries(data.methodology).map(([key, value]) => (
                    <div key={key}><dt className="inline font-semibold capitalize text-stealth-200">{key}: </dt><dd className="inline text-stealth-400">{value}</dd></div>
                  ))}
                </dl>
              ) : (
                <dl className="mt-3 space-y-3 text-sm leading-6">
                  <div><dt className="inline font-semibold text-stealth-200">Comparison basis: </dt><dd className="inline text-stealth-400">{selectedReportHistory?.analysis?.comparison_basis ?? "No comparable national metric is available for this release."}</dd></div>
                  <div><dt className="inline font-semibold text-stealth-200">Units: </dt><dd className="inline text-stealth-400">Values stay in the official source units shown on the chart; unlike WASDE signals, these series are not standardized across unlike measures.</dd></div>
                  <div><dt className="inline font-semibold text-stealth-200">Archive scope: </dt><dd className="inline text-stealth-400">The visualization uses comparable observations within the selected history window. Older source documents remain available in the raw viewer when their layouts cannot be compared safely.</dd></div>
                  <div><dt className="inline font-semibold text-stealth-200">Interpretation boundary: </dt><dd className="inline text-stealth-400">The summary describes the latest official release relative to its stated baseline; it does not infer market causation or unpublished consensus estimates.</dd></div>
                </dl>
              )}
            </div>
          </details>
        </div>
        <div className="surface-card min-w-0 p-4 md:p-5">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
              <span className="flex items-center gap-3">
                <Clock3 className="shrink-0 text-sky-300" size={18} aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-stealth-100">Upcoming release board</span>
                  <span className="mt-0.5 block text-xs text-stealth-500">{data.schedule.length} scheduled agriculture releases</span>
                </span>
              </span>
              <span className="text-xs font-semibold text-sky-200 group-open:hidden">Show</span>
              <span className="hidden text-xs font-semibold text-sky-200 group-open:inline">Hide</span>
            </summary>
            <div className="mt-4 border-t border-stealth-700 pt-1">
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
          </details>
        </div>
      </section>
    </div>
  );
}
