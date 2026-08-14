/*
THESIS: All reports should resolve into one commodity brief and one evidence-weighted price scenario, with individual effects inspected in place.
OWN-WORLD: Evidence Field — dark, exacting, source-forward, and operational.
STORY: See the combined price pressure, trace how reports reinforce or conflict, then inspect the historical effect behind one contribution.
FIRST VIEWPORT: A total five-session futures scenario and signed report contributions beside one selected report relationship plot.
FORM: A two-mode master-detail research inbox; Price impact leads and Market brief preserves the official-data view.
*/

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
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
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  commodity: { symbol: string; name: string; usda: string; ticker: string; price_unit: string };
  commodities: Array<{ symbol: string; name: string; usda: string; ticker: string; price_unit: string }>;
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
  impact_model: ImpactModel;
  takeaways: Array<{ tone: "positive" | "negative" | "warning" | "neutral"; title: string; body: string }>;
  methodology: Record<string, string>;
  warnings: string[];
};

type ImpactStatistics = {
  sample_size: number;
  correlation: number | null;
  slope: number | null;
  alignment_rate: number | null;
  residual_pct: number | null;
};

type ImpactObservation = {
  release_date: string;
  price_event_date: string;
  raw_signal: number;
  signal_z: number | null;
  signal_basis: string;
  reaction_1d_pct: number | null;
  reaction_5d_pct: number | null;
};

type ReportImpact = {
  report_id: string;
  report: string;
  channel: string;
  latest_release_date: string | null;
  price_event_date: string | null;
  signal_z: number | null;
  signal_basis: string | null;
  latest_reaction_1d_pct: number | null;
  latest_reaction_5d_pct: number | null;
  historical_1d: ImpactStatistics;
  historical_5d: ImpactStatistics;
  model_5d_pct: number | null;
  contribution_5d_pct: number | null;
  confidence: "Established" | "Moderate" | "Weak" | "Insufficient";
  reliability: number;
  freshness: number;
  model_weight: number;
  observations: ImpactObservation[];
};

type ImpactRelationship = {
  source_report_id: string;
  target_report_id: string;
  source_report: string;
  target_report: string;
  kind: string;
  status: "Confirming" | "Conflicting" | "Mixed" | "Unavailable";
  description: string;
};

type ImpactModel = {
  as_of: string | null;
  price_unit: string;
  horizon_sessions: number;
  aggregate: {
    direction: "Price-supportive" | "Price-restrictive" | "Balanced" | "Unavailable";
    current_price: number | null;
    projected_5d_pct: number | null;
    projected_5d_price: number | null;
    lower_5d_price: number | null;
    upper_5d_price: number | null;
    uncertainty_5d_pct: number | null;
    contributors_included: number;
  };
  reports: ReportImpact[];
  relationships: ImpactRelationship[];
  methodology: Record<string, string>;
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

function formatFreshness(value: number) {
  return `${Math.round(value * 100)}% fresh`;
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

function metricDigits(value: number) {
  return Math.abs(value) < 1_000 && !Number.isInteger(value) ? 1 : 0;
}

function signedPercentChange(current: number, baseline: number | null | undefined) {
  if (baseline === null || baseline === undefined || baseline === 0) return null;
  return (current / baseline - 1) * 100;
}

function chartShell(chart: ReactNode, ariaLabel: string) {
  return (
    <div className="h-[230px] min-w-0 bg-stealth-900/25 px-1 pt-2 md:h-[320px] md:px-2" aria-label={ariaLabel}>
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
      {chart}
    </>
  );
}

type ReportDigest = {
  date: string | null;
  value: string;
  comparison: string;
};

type BriefingLine = {
  label: string;
  text: string;
  reportId: string;
};

function movement(delta: number | null, suffix = "%") {
  if (delta === null || Number.isNaN(delta)) return "No comparison";
  const digits = suffix === " pts" ? 0 : 1;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(digits)}${suffix}`;
}

function signedCompact(value: number | null) {
  if (value === null || Number.isNaN(value)) return "No comparison";
  return `${value > 0 ? "+" : ""}${compactNumber(value)}`;
}

function compactMetric(value: number, unit: string) {
  const normalized = unit.toLowerCase();
  if (normalized === "percent") return `${formatValue(value, 1)}%`;
  if (normalized.includes("million bushel")) return `${formatValue(value, 0)}M bu`;
  if (normalized.includes("million acre")) return `${formatValue(value, 1)}M acres`;
  if (normalized.includes("metric ton")) return `${compactNumber(value)} MT`;
  if (normalized.includes("contract")) return `${compactNumber(value)} contracts`;
  return `${formatValue(value, metricDigits(value))} ${unit}`;
}

function reportDigest(reportId: string, history: ReportHistory | null, endingStocks: MetricPoint | null): ReportDigest {
  if (reportId === "wasde") {
    return endingStocks ? {
      date: endingStocks.release_date,
      value: compactMetric(endingStocks.value, endingStocks.unit),
      comparison: `${movement(endingStocks.revision, endingStocks.unit.toLowerCase().includes("million bushel") ? "M bu" : "")} revision`,
    } : { date: null, value: "No release", comparison: "Awaiting structured history" };
  }

  const analysis = history?.analysis;
  if (!history || !analysis) return { date: null, value: "Source archive", comparison: "No comparable national metric" };
  const latestRelease = history.releases.find((release) => release.release_date === analysis.latest_release_date) ?? history.releases[0];
  const primary = latestRelease ? releaseMetric(latestRelease, analysis.primary_metric_id) : null;
  let delta: number | null = null;
  let suffix = "%";
  let baselineLabel = "vs prior report";

  if (analysis.chart_kind === "progress_benchmark") {
    const baseline = primary?.previous_year ?? primary?.five_year_average ?? primary?.previous_week;
    delta = baseline === null || baseline === undefined ? null : analysis.latest_value - baseline;
    suffix = " pts";
    baselineLabel = primary?.previous_year !== null && primary?.previous_year !== undefined
      ? "vs last year"
      : primary?.five_year_average !== null && primary?.five_year_average !== undefined ? "vs 5Y avg" : "vs prior week";
  } else if (analysis.chart_kind === "production_trend") {
    delta = signedPercentChange(analysis.latest_value, analysis.previous_value);
    baselineLabel = "vs prior estimate";
  } else if (analysis.chart_kind === "stocks_composition") {
    delta = signedPercentChange(analysis.latest_value, releaseMetric(latestRelease, "total_stocks_year_ago")?.value);
    baselineLabel = "vs last year";
  } else if (analysis.chart_kind === "acreage_comparison") {
    delta = signedPercentChange(analysis.latest_value, releaseMetric(latestRelease, "planted_area_year_ago")?.value);
    baselineLabel = "vs last year";
  } else if (analysis.chart_kind === "positioning_balance") {
    const baseline = analysis.four_report_average ?? analysis.previous_value;
    const rawDelta = baseline === null ? null : analysis.latest_value - baseline;
    return {
      date: analysis.latest_release_date,
      value: compactMetric(analysis.latest_value, analysis.unit),
      comparison: `${signedCompact(rawDelta)} contracts vs ${analysis.four_report_average !== null ? "4-report avg" : "prior report"}`,
    };
  } else {
    delta = signedPercentChange(analysis.latest_value, analysis.four_report_average ?? analysis.previous_value);
    baselineLabel = analysis.four_report_average !== null ? "vs 4-report pace" : "vs prior report";
  }

  return {
    date: analysis.latest_release_date,
    value: compactMetric(analysis.latest_value, analysis.unit),
    comparison: `${movement(delta, suffix)} ${baselineLabel}`,
  };
}

function buildBriefing(data: ReportDeskData): BriefingLine[] {
  const endingStocks = data.series.find((series) => series.metric_id === "ending_stocks")?.points.at(-1) ?? null;
  const grainStocks = data.report_histories.grain_stocks?.analysis ?? null;
  const grainRelease = data.report_histories.grain_stocks?.releases[0] ?? null;
  const grainYearAgo = grainRelease ? releaseMetric(grainRelease, "total_stocks_year_ago")?.value : null;
  const grainDelta = grainStocks ? signedPercentChange(grainStocks.latest_value, grainYearAgo) : null;

  const production = data.report_histories.crop_production?.analysis ?? null;
  const productionDelta = production ? signedPercentChange(production.latest_value, production.previous_value) : null;
  const progressHistory = data.report_histories.crop_progress ?? null;
  const progress = progressHistory?.analysis ?? null;
  const progressRelease = progressHistory?.releases.find((release) => release.release_date === progress?.latest_release_date) ?? progressHistory?.releases[0];
  const progressMetric = progressRelease && progress ? releaseMetric(progressRelease, progress.primary_metric_id) : null;
  const progressDelta = progress && progressMetric?.previous_year !== null && progressMetric?.previous_year !== undefined
    ? progress.latest_value - progressMetric.previous_year
    : null;
  const acreage = data.report_histories.acreage?.analysis ?? null;
  const acreageRelease = data.report_histories.acreage?.releases[0] ?? null;
  const acreageYearAgo = acreageRelease ? releaseMetric(acreageRelease, "planted_area_year_ago")?.value : null;
  const acreageDelta = acreage ? signedPercentChange(acreage.latest_value, acreageYearAgo) : null;

  const sales = data.report_histories.export_sales?.analysis ?? null;
  const inspections = data.report_histories.export_inspections?.analysis ?? null;
  const salesDelta = sales ? signedPercentChange(sales.latest_value, sales.four_report_average) : null;
  const inspectionsDelta = inspections ? signedPercentChange(inspections.latest_value, inspections.four_report_average) : null;

  const positioning = data.report_histories.cot?.analysis ?? null;
  const positioningDelta = positioning && positioning.four_report_average !== null
    ? positioning.latest_value - positioning.four_report_average
    : null;

  return [
    {
      label: "Balance sheet",
      reportId: "wasde",
      text: endingStocks
        ? `Ending stocks ${endingStocks.revision !== null && endingStocks.revision < 0 ? "cut" : "raised"} ${formatValue(Math.abs(endingStocks.revision ?? 0), 0)}M bu; quarterly stocks ${movement(grainDelta)} year over year.`
        : "Balance-sheet history is not available for this commodity.",
    },
    {
      label: "Supply & fields",
      reportId: "crop_production",
      text: `Production ${movement(productionDelta)} vs prior estimate; conditions ${movement(progressDelta, " pts")} year over year; acreage ${movement(acreageDelta)} year over year.`,
    },
    {
      label: "Demand",
      reportId: "export_sales",
      text: `Export sales ${movement(salesDelta)} and inspections ${movement(inspectionsDelta)} vs their four-report pace.`,
    },
    {
      label: "Positioning",
      reportId: "cot",
      text: positioning
        ? `Noncommercial net ${compactNumber(positioning.latest_value)} contracts, ${signedCompact(positioningDelta)} vs the four-report average.`
        : "Positioning history is not available for this commodity.",
    },
  ];
}

function formatFuturesPrice(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (unit.startsWith("dollars")) return `$${value.toFixed(2)}`;
  return `${value.toFixed(2)}¢`;
}

function pressureLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unscored";
  if (value >= 0.25) return "Price-supportive";
  if (value <= -0.25) return "Price-restrictive";
  return "Mixed";
}

function relationshipTone(status: ImpactRelationship["status"]) {
  if (status === "Confirming") return "border-sky-300/40 bg-sky-300/[0.08] text-sky-100";
  if (status === "Conflicting") return "border-amber-300/40 bg-amber-300/[0.08] text-amber-100";
  return "border-stealth-600 bg-stealth-800/70 text-stealth-300";
}

function ImpactTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ImpactObservation }> }) {
  const observation = payload?.[0]?.payload;
  if (!active || !observation) return null;
  return (
    <div className="max-w-[280px] rounded-lg border border-stealth-600 bg-stealth-900/95 p-3 shadow-xl">
      <p className="text-xs font-semibold text-stealth-100">{formatDate(observation.release_date)}</p>
      <p className="mt-2 text-xs text-stealth-300">Report pressure <strong className="text-stealth-100">{formatSigned(observation.signal_z, "σ")}</strong></p>
      <p className="mt-1 text-xs text-stealth-300">Five-session futures <strong className="text-stealth-100">{formatSigned(observation.reaction_5d_pct, "%")}</strong></p>
    </div>
  );
}

function PriceImpactWorkspace({
  data,
  selectedReportId,
  onSelectReport,
}: {
  data: ReportDeskData;
  selectedReportId: string;
  onSelectReport: (reportId: string) => void;
}) {
  const model = data.impact_model;
  const aggregate = model.aggregate;
  const selectedImpact = model.reports.find((report) => report.report_id === selectedReportId) ?? model.reports[0] ?? null;
  const selectedCatalog = data.reports.find((report) => report.id === selectedImpact?.report_id) ?? null;
  const related = model.relationships.filter((relationship) => (
    relationship.source_report_id === selectedImpact?.report_id || relationship.target_report_id === selectedImpact?.report_id
  ));
  const scatterData = selectedImpact?.observations.filter((observation) => (
    observation.signal_z !== null && observation.reaction_5d_pct !== null
  )) ?? [];
  const latestScatter = scatterData.at(-1) ?? null;
  const historicalScatter = latestScatter ? scatterData.slice(0, -1) : scatterData;
  const maxContribution = Math.max(0.1, ...model.reports.map((report) => Math.abs(report.contribution_5d_pct ?? 0)));
  const correlation = selectedImpact?.historical_5d.correlation ?? null;
  const alignment = selectedImpact?.historical_5d.alignment_rate ?? null;

  return (
    <section className="surface-card-strong min-w-0 overflow-hidden lg:grid lg:grid-cols-[minmax(21rem,0.78fr)_minmax(0,1.5fr)]" aria-label={`${data.commodity.name} report price impact`}>
      <div className="border-b border-stealth-700 lg:border-b-0 lg:border-r">
        <div className="px-4 py-4 md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stealth-100">Combined report-price association</h2>
              <p className="mt-1 text-xs text-stealth-400">Evidence-weighted five-session scenario · {model.as_of ? formatDate(model.as_of) : "price unavailable"}</p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${aggregate.projected_5d_pct !== null && aggregate.projected_5d_pct < -0.15 ? "border-amber-300/40 bg-amber-300/[0.08] text-amber-100" : "border-sky-300/40 bg-sky-300/[0.08] text-sky-100"}`}>{aggregate.direction}</span>
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-y border-stealth-700 py-3">
            <div>
              <p className="text-xs text-stealth-500">Current futures</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-stealth-100">{formatFuturesPrice(aggregate.current_price, model.price_unit)}</p>
            </div>
            <ArrowRight size={18} className="text-stealth-500" aria-hidden="true" />
            <div className="text-right">
              <p className="text-xs text-stealth-500">Association-implied marker</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-100">{formatFuturesPrice(aggregate.projected_5d_price, model.price_unit)}</p>
              <p className="text-xs font-semibold tabular-nums text-sky-200">{formatSigned(aggregate.projected_5d_pct, "%")}</p>
            </div>
          </div>
          <p className="mt-2 border-l-2 border-amber-300/70 pl-3 text-xs leading-5 text-stealth-300">
            <strong className="font-semibold text-amber-100">Association-based scenario, not a forecast.</strong> Same-session reports share one event weight; the range does not estimate cross-report covariance.
          </p>
          <p className="mt-2 text-xs leading-5 text-stealth-500">
            Historical residual span {formatFuturesPrice(aggregate.lower_5d_price, model.price_unit)}–{formatFuturesPrice(aggregate.upper_5d_price, model.price_unit)} · {aggregate.contributors_included} report models included
          </p>
        </div>

        <div className="border-t border-stealth-700">
          <div className="flex items-center justify-between px-4 py-2.5 md:px-5">
            <h3 className="text-xs font-semibold text-stealth-300">Report contributions</h3>
            <span className="text-xs text-stealth-500">Sum = {formatSigned(aggregate.projected_5d_pct, "%")}</span>
          </div>
          <div className="grid grid-cols-2 lg:block lg:divide-y lg:divide-stealth-700" role="group" aria-label="Report price contributions">
            {model.reports.map((report) => {
              const selected = report.report_id === selectedImpact?.report_id;
              const contribution = report.contribution_5d_pct;
              const width = contribution === null ? 0 : Math.min(50, Math.abs(contribution) / maxContribution * 50);
              return (
                <button
                  key={report.report_id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${report.report}: ${pressureLabel(report.signal_z)}, ${contribution === null ? "model unavailable" : `${formatSigned(contribution, "%")} five-session contribution`}`}
                  onClick={() => onSelectReport(report.report_id)}
                  className={`grid min-h-[5.25rem] w-full grid-cols-[minmax(0,1fr)_auto] content-center gap-x-2 gap-y-2 border-t border-stealth-700 px-3 py-2 text-left transition odd:border-r focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 lg:min-h-[3.75rem] lg:grid-cols-[minmax(7.5rem,0.9fr)_minmax(6rem,1fr)_4.2rem] lg:items-center lg:gap-3 lg:border-r-0 lg:border-t-0 lg:px-5 ${selected ? "bg-sky-300/[0.10]" : "hover:bg-stealth-800/70"}`}
                >
                  <span className="min-w-0 lg:col-start-1 lg:row-start-1">
                    <span className={`block truncate text-sm font-semibold ${selected ? "text-sky-100" : "text-stealth-200"}`}>{report.report}</span>
                    <span className="mt-0.5 block truncate text-xs text-stealth-500"><span className="hidden lg:inline">{report.channel} · </span>{report.latest_release_date ? formatDate(report.latest_release_date, false) : "No release"} · {formatFreshness(report.freshness)}</span>
                  </span>
                  <span className={`text-right text-xs font-semibold tabular-nums lg:col-start-3 lg:row-start-1 ${contribution === null ? "text-stealth-500" : contribution >= 0 ? "text-sky-200" : "text-amber-200"}`}>{formatSigned(contribution, "%")}</span>
                  <span className="relative col-span-2 row-start-2 block h-2 rounded-full bg-stealth-800 lg:col-span-1 lg:col-start-2 lg:row-start-1" aria-hidden="true">
                    <span className="absolute inset-y-[-2px] left-1/2 w-px bg-stealth-500" />
                    {contribution !== null && contribution >= 0 ? <span className="absolute inset-y-0 left-1/2 rounded-r-full bg-sky-300" style={{ width: `${width}%` }} /> : null}
                    {contribution !== null && contribution < 0 ? <span className="absolute inset-y-0 right-1/2 rounded-l-full bg-amber-300" style={{ width: `${width}%` }} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <article className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stealth-700 px-4 py-4 md:px-5">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-2xl font-semibold text-stealth-100">{selectedImpact?.report ?? "Report effect"}</h2>
              {selectedImpact ? <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${selectedImpact.confidence === "Insufficient" ? "border-stealth-600 bg-stealth-800 text-stealth-300" : "border-sky-300/40 bg-sky-300/[0.08] text-sky-100"}`}>{selectedImpact.confidence} evidence</span> : null}
            </div>
            <p className="mt-1 text-sm text-stealth-400">Historical report pressure and subsequent {data.commodity.name} futures returns</p>
          </div>
          {selectedCatalog ? <div className="flex gap-2"><a href={selectedCatalog.source_url} target="_blank" rel="noreferrer" className="field-button field-button-primary gap-2">Source <ExternalLink size={14} aria-hidden="true" /></a><a href={selectedCatalog.archive_url} target="_blank" rel="noreferrer" className="field-button field-button-secondary gap-2">Archive <ExternalLink size={14} aria-hidden="true" /></a></div> : null}
        </div>

        {selectedImpact ? <div className="px-4 py-4 md:px-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-stealth-700 pb-3 sm:grid-cols-4">
            <div><p className="text-xs text-stealth-500">Current pressure</p><p className="mt-1 text-lg font-semibold text-stealth-100">{pressureLabel(selectedImpact.signal_z)}</p><p className="text-xs text-stealth-400">{formatSigned(selectedImpact.signal_z, "σ")}</p></div>
            <div><p className="text-xs text-stealth-500">Latest next close</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatSigned(selectedImpact.latest_reaction_1d_pct, "%")}</p><p className="text-xs text-stealth-400">Observed</p></div>
            <div><p className="text-xs text-stealth-500">Five-session model</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatSigned(selectedImpact.model_5d_pct, "%")}</p><p className="text-xs text-stealth-400">Before blend weight</p></div>
            <div><p className="text-xs text-stealth-500">Combined contribution</p><p className="mt-1 text-xl font-semibold tabular-nums text-sky-100">{formatSigned(selectedImpact.contribution_5d_pct, "%")}</p><p className="text-xs text-stealth-400">Weight {formatValue(selectedImpact.model_weight * 100, 0)}%</p></div>
          </div>

          <div className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold text-stealth-100">Connected reports</h3><p className="mt-0.5 text-xs text-stealth-500">Current directional agreement; arrows show information flow, not causation.</p></div>
              <span className="text-xs text-stealth-500">{related.length} links</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {related.length ? related.map((relationship) => {
                const otherId = relationship.source_report_id === selectedImpact.report_id ? relationship.target_report_id : relationship.source_report_id;
                const sourceSelected = relationship.source_report_id === selectedImpact.report_id;
                return <button key={`${relationship.source_report_id}:${relationship.target_report_id}`} type="button" onClick={() => onSelectReport(otherId)} title={relationship.description} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${relationshipTone(relationship.status)}`}><span>{sourceSelected ? selectedImpact.report : relationship.source_report}</span><ArrowRight size={13} aria-hidden="true" /><span>{sourceSelected ? relationship.target_report : selectedImpact.report}</span><span className="font-normal opacity-80">· {relationship.status}</span></button>;
              }) : <p className="text-xs text-stealth-500">No direct report-to-report link is defined for this selection.</p>}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><h3 className="text-sm font-semibold text-stealth-100">Report pressure vs. five-session futures return</h3><p className="mt-0.5 text-xs text-stealth-500">Each point is one published release · x = standardized report pressure · y = subsequent futures return</p></div>
              <span className="text-xs text-stealth-400">n={selectedImpact.historical_5d.sample_size} · r={correlation === null ? "—" : correlation.toFixed(2)}</span>
            </div>
            {selectedImpact.historical_5d.sample_size >= 8 ? <div className="mt-2 h-[250px] min-w-0 bg-stealth-900/25 md:h-[315px]" aria-label={`${selectedImpact.report} report pressure relationship with five-session futures returns`}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ScatterChart margin={{ top: 12, right: 14, bottom: 24, left: 4 }} accessibilityLayer aria-label={`${selectedImpact.report} report pressure and five-session futures return by release`}>
                  <CartesianGrid stroke="rgba(98,117,142,0.34)" />
                  <XAxis type="number" dataKey="signal_z" name="Report pressure" unit="σ" domain={["auto", "auto"]} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} label={{ value: "Report pressure (σ)", position: "insideBottom", offset: -14, fill: "#91a4bd", fontSize: 12 }} />
                  <YAxis type="number" dataKey="reaction_5d_pct" name="Five-session return" unit="%" domain={["auto", "auto"]} width={54} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
                  <ReferenceLine x={0} stroke="#91a4bd" strokeDasharray="4 4" />
                  <ReferenceLine y={0} stroke="#91a4bd" strokeDasharray="4 4" />
                  <Tooltip content={<ImpactTooltip />} />
                  <Scatter name="Historical releases" data={historicalScatter} fill="#8ebdea" opacity={0.7} isAnimationActive={false} />
                  {latestScatter ? <Scatter name="Latest complete release" data={[latestScatter]} fill="#f3cb69" stroke="#0e1520" strokeWidth={2} isAnimationActive={false} /> : null}
                </ScatterChart>
              </ResponsiveContainer>
            </div> : <div className="mt-2 flex h-[250px] items-center justify-center border-y border-stealth-700 px-6 text-center md:h-[315px]"><div><p className="text-sm font-semibold text-stealth-200">Historical model withheld</p><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-stealth-500">{selectedImpact.report} has {selectedImpact.historical_5d.sample_size} complete five-session observations. At least 8 are required before plotting or contributing to the scenario.</p></div></div>}
            {scatterData.length ? <details className="group mt-2 border-y border-stealth-700">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-xs font-semibold text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><span>View plotted release values</span><span className="group-open:hidden">Open</span><span className="hidden group-open:inline">Close</span></summary>
              <div className="max-h-64 overflow-auto border-t border-stealth-700">
                <table className="w-full min-w-[31rem] text-left text-xs">
                  <caption className="sr-only">{selectedImpact.report} plotted historical values</caption>
                  <thead className="sticky top-0 bg-stealth-900 text-stealth-400"><tr><th className="px-2 py-2 font-semibold">Release</th><th className="px-2 py-2 text-right font-semibold">Pressure</th><th className="px-2 py-2 text-right font-semibold">5-session return</th><th className="px-2 py-2 font-semibold">Point</th></tr></thead>
                  <tbody className="divide-y divide-stealth-700 text-stealth-300">{[...scatterData].reverse().map((observation) => <tr key={`${observation.release_date}:${observation.price_event_date}`}><td className="px-2 py-2 tabular-nums">{formatDate(observation.release_date)}</td><td className="px-2 py-2 text-right tabular-nums">{formatSigned(observation.signal_z, "σ")}</td><td className="px-2 py-2 text-right tabular-nums">{formatSigned(observation.reaction_5d_pct, "%")}</td><td className="px-2 py-2">{observation === latestScatter ? "Latest complete release" : "Historical release"}</td></tr>)}</tbody>
                </table>
              </div>
            </details> : null}
            <p className="mt-3 text-sm leading-6 text-stealth-300"><strong className="font-semibold text-stealth-100">Read:</strong> {selectedImpact.signal_basis ?? "A comparable report pressure is unavailable."} {alignment !== null ? `${formatValue(alignment * 100, 0)}% of comparable historical releases moved in the same direction over five sessions.` : "Historical directional alignment is not yet stable enough to report."}</p>
          </div>
        </div> : null}

        <details className="group border-t border-stealth-700">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5"><span className="flex items-center gap-2.5"><Info size={16} className="text-sky-300" aria-hidden="true" /><span><span className="block text-sm font-semibold text-stealth-100">Impact method</span><span className="block text-xs text-stealth-500">Timing, weighting, uncertainty, and interpretation limits</span></span></span><span className="text-xs font-semibold text-sky-200 group-open:hidden">Open</span><span className="hidden text-xs font-semibold text-sky-200 group-open:inline">Close</span></summary>
          <dl className="space-y-2 border-t border-stealth-700 px-4 py-4 text-sm leading-6 md:px-5">{Object.entries(model.methodology).map(([key, value]) => <div key={key}><dt className="inline font-semibold capitalize text-stealth-200">{key}: </dt><dd className="inline text-stealth-400">{value}</dd></div>)}</dl>
        </details>
      </article>
    </section>
  );
}

export default function AgricultureReportDesk() {
  const [symbol, setSymbol] = useState("ZC");
  const [years, setYears] = useState<1 | 3 | 5 | 10 | 150>(3);
  const [deskView, setDeskView] = useState<"impact" | "brief">("impact");
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
  const endingStocksPoint = data.series.find((series) => series.metric_id === "ending_stocks")?.points.at(-1) ?? null;
  const briefing = buildBriefing(data);
  const selectedAnalysis = selectedReportHistory?.analysis ?? null;
  const selectedDigest = reportDigest(selectedReportId, selectedReportHistory, endingStocksPoint);
  const expectationReleaseDates = Array.from(new Set([
    ...data.schedule.filter((event) => event.report_id === "wasde").map((event) => event.date),
    ...(selectedSeries?.points.map((point) => point.release_date) ?? []),
  ])).sort().reverse();

  return (
    <div className="page-shell-wide space-y-4 md:space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Link to="/agriculture" className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-stealth-300 transition hover:text-sky-300">
            <ArrowLeft size={16} aria-hidden="true" /> Agriculture Index
          </Link>
          <h1 className="page-title">Agriculture Report Desk</h1>
          <p className="mt-1 text-sm text-stealth-300">One brief across every major USDA release for {data.commodity.name}.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="block text-xs font-semibold text-stealth-400">View</span>
            <div className="mt-1"><SegmentedControl label="Report desk view" value={deskView} options={[{ value: "impact", label: "Price impact" }, { value: "brief", label: "Market brief" }]} onChange={setDeskView} accent="sky" /></div>
          </div>
          <label className="min-w-[12rem] flex-1 sm:flex-none">
            <span className="block text-xs font-semibold text-stealth-400">Commodity</span>
            <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setSelectedReleaseDate(""); setSelectedArchiveReleaseDate(""); }} className={INPUT_CLASS}>
              {data.commodities.map((item) => <option key={item.symbol} value={item.symbol}>{item.name}</option>)}
            </select>
          </label>
          <div>
            <span className="block text-xs font-semibold text-stealth-400">History</span>
            <div className="mt-1"><SegmentedControl label="Report history window" value={years} options={[{ value: 1, label: "1Y" }, { value: 3, label: "3Y" }, { value: 5, label: "5Y" }, { value: 10, label: "10Y" }, { value: 150, label: "All" }]} onChange={setYears} accent="emerald" /></div>
          </div>
          <a aria-label="Download release calendar" className="field-button field-button-secondary gap-2" href={buildApiUrl("/agriculture/report-desk/calendar.ics")} download>
            <Download size={16} aria-hidden="true" /> <span className="hidden sm:inline">Calendar</span>
          </a>
        </div>
      </header>

      {data.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300/40 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100" role="status">
          <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" /><p>{data.warnings.join(" ")}</p></div>
        </div>
      ) : null}

      {deskView === "impact" ? (
        <PriceImpactWorkspace data={data} selectedReportId={selectedReportId} onSelectReport={(reportId) => { setSelectedReportId(reportId); setSelectedArchiveReleaseDate(""); }} />
      ) : (
      <section className="surface-card-strong min-w-0 overflow-hidden lg:grid lg:grid-cols-[minmax(20rem,0.72fr)_minmax(0,1.55fr)]" aria-label={`${data.commodity.name} agriculture briefing`}>
        <div className="border-b border-stealth-700 lg:border-b-0 lg:border-r">
          <div className="px-4 py-4 md:px-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-stealth-100">The whole picture</h2>
                <p className="mt-1 text-xs text-stealth-400">Latest official releases · {formatDate(data.as_of)}</p>
              </div>
              <span className="rounded-full border border-stealth-600 px-2.5 py-1 text-xs font-semibold text-stealth-300">{data.reports.length} reports</span>
            </div>
            <div className="mt-3 divide-y divide-stealth-700 border-y border-stealth-700">
              {briefing.map((item) => (
                <button key={item.label} type="button" onClick={() => setSelectedReportId(item.reportId)} className="grid min-h-14 w-full grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2.5 text-left transition hover:text-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300">
                  <span className="text-xs font-semibold text-sky-200">{item.label}</span>
                  <span className="text-xs leading-5 text-stealth-300">{item.text}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-stealth-700">
            <div className="flex items-center justify-between px-4 py-2.5 md:px-5">
              <h3 className="text-xs font-semibold text-stealth-300">Report feed</h3>
              <span className="text-xs text-stealth-500">Select to inspect</span>
            </div>
            <label className="block border-t border-stealth-700 p-4 lg:hidden">
              <span className="sr-only">Report family</span>
              <select value={selectedReportId} onChange={(event) => { setSelectedReportId(event.target.value); setSelectedArchiveReleaseDate(""); }} className={INPUT_CLASS}>
                {data.reports.map((report) => <option key={report.id} value={report.id}>{report.name} · {reportDigest(report.id, data.report_histories[report.id] ?? null, endingStocksPoint).comparison}</option>)}
              </select>
            </label>
            <div className="hidden divide-y divide-stealth-700 lg:block" role="group" aria-label="Agriculture report feed">
              {data.reports.map((report) => {
                const digest = reportDigest(report.id, data.report_histories[report.id] ?? null, endingStocksPoint);
                const selected = report.id === selectedReportId;
                return (
                  <button key={report.id} type="button" aria-pressed={selected} onClick={() => { setSelectedReportId(report.id); setSelectedArchiveReleaseDate(""); }} className={`grid min-h-[3.45rem] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5 ${selected ? "bg-sky-300/[0.10]" : "hover:bg-stealth-800/70"}`}>
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-semibold ${selected ? "text-sky-100" : "text-stealth-200"}`}>{report.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-stealth-500">{digest.date ? formatDate(digest.date, false) : report.coverage_label} · {digest.comparison}</span>
                    </span>
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-stealth-300">{digest.value}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <article id="report-detail" className="min-w-0">
          {selectedReport ? (
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stealth-700 px-4 py-4 md:px-5">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-2xl font-semibold text-stealth-100">{selectedReport.name}</h2>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${coverageTone(selectedReport.coverage)}`}>{selectedReport.coverage_label}</span>
                </div>
                <p className="mt-1 text-sm text-stealth-400">{selectedAnalysis?.title ?? selectedReport.description}</p>
                {nextSelectedReportRelease ? <p className="mt-1.5 flex items-center gap-2 text-xs text-sky-200"><Clock3 size={14} aria-hidden="true" /> Next {formatDate(nextSelectedReportRelease.release_at)} · {nextSelectedReportRelease.time_label}</p> : null}
              </div>
              <div className="flex gap-2">
                <a href={selectedReport.source_url} target="_blank" rel="noreferrer" className="field-button field-button-primary gap-2">Source <ExternalLink size={14} aria-hidden="true" /></a>
                <a href={selectedReport.archive_url} target="_blank" rel="noreferrer" className="field-button field-button-secondary gap-2">Archive <ExternalLink size={14} aria-hidden="true" /></a>
              </div>
            </div>
          ) : null}

          <div className="px-4 py-4 md:px-5">
            {selectedReportId === "wasde" && selectedSeries && latest ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1" role="group" aria-label="WASDE metric">
                    {data.metrics.map((item) => <button key={item.id} type="button" aria-pressed={metric === item.id} onClick={() => { setMetric(item.id); setSelectedReleaseDate(""); }} className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${metric === item.id ? "bg-sky-300 text-stealth-950" : "text-stealth-300 hover:bg-stealth-800"}`}>{item.label}</button>)}
                  </div>
                  <button type="button" aria-pressed={showFutures} onClick={() => setShowFutures((current) => !current)} className={`field-button gap-2 ${showFutures ? "field-button-primary" : "field-button-secondary"}`}>
                    {showFutures ? "Hide futures" : "Add futures"}
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-stealth-700 py-3 sm:grid-cols-4">
                  <div><p className="text-xs text-stealth-500">Latest</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatValue(latest.value)}</p><p className="text-xs text-stealth-400">{latest.market_year}</p></div>
                  <div><p className="text-xs text-stealth-500">Revision</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatSigned(latest.revision)}</p><p className="text-xs text-stealth-400">From {formatValue(latest.prior_value)}</p></div>
                  <div><p className="text-xs text-stealth-500">Report read</p><p className="mt-1 text-lg font-semibold text-stealth-100">{signalLabel(latestSignal)}</p><p className="text-xs text-stealth-400">{formatSigned(latestSignal, "σ")}</p></div>
                  <div><p className="text-xs text-stealth-500">Futures response</p><p className="mt-1 text-xl font-semibold tabular-nums text-stealth-100">{formatSigned(latest.reaction_1d_pct, "%")}</p><p className="text-xs text-stealth-400">Release day</p></div>
                </div>
                <div className="mt-3 h-[230px] min-w-0 bg-stealth-900/25 px-1 pt-2 md:h-[320px] md:px-2">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={focusedWasdeChartData} margin={{ top: 10, right: showFutures ? 6 : 14, bottom: 4, left: 0 }} accessibilityLayer aria-label={`${selectedSeries.label} official history${showFutures ? ` compared with ${data.commodity.name} futures` : ""}`}>
                      <CartesianGrid stroke="rgba(98,117,142,0.34)" vertical={false} />
                      <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartDateLabel} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
                      <YAxis yAxisId="report" width={60} domain={["auto", "auto"]} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} />
                      {showFutures ? <YAxis yAxisId="price" orientation="right" width={48} domain={["auto", "auto"]} stroke="#62758e" tick={{ fill: "#b7c3d3", fontSize: 12 }} /> : null}
                      <Tooltip content={<ArchiveTooltip />} />
                      <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 12, color: "#d6dee9" }} />
                      <Line yAxisId="report" type="monotone" dataKey="actual" name={selectedSeries.label} stroke="#a8d2ff" strokeWidth={3} dot={{ r: 2.5, fill: "#a8d2ff" }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                      <Line yAxisId="report" type="monotone" dataKey="expectation" name="Your expectation" stroke="#f3cb69" strokeWidth={2} strokeDasharray="7 5" dot={{ r: 3.5, fill: "#0e1520", stroke: "#f3cb69", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                      {showFutures ? <Line yAxisId="price" type="monotone" dataKey="futures" name={`${data.commodity.name} futures (100)`} stroke="#91a4bd" strokeWidth={1.6} dot={false} opacity={0.8} isAnimationActive={false} /> : null}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-3 text-sm leading-6 text-stealth-300"><strong className="font-semibold text-stealth-100">Read:</strong> {data.takeaways[0]?.body}</p>
              </>
            ) : selectedReportHistory && selectedAnalysis ? (
              <>
                <div className="grid gap-3 border-b border-stealth-700 pb-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end sm:gap-6">
                  <div>
                    <p className="text-xs text-stealth-500">Latest · {formatDate(selectedAnalysis.latest_release_date)}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums text-stealth-100">{selectedDigest.value}</p>
                    <p className="mt-1 text-sm font-semibold text-sky-200">{selectedDigest.comparison}</p>
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-stealth-200"><strong className="font-semibold text-stealth-100">Read:</strong> {selectedAnalysis.body}</p>
                </div>
                <div className="mt-3"><ArchiveReportInsights history={selectedReportHistory} commodityName={selectedReportHistory.scope_label ?? data.commodity.name} /></div>
                <p className="mt-2 text-xs leading-5 text-stealth-500">{selectedAnalysis.subtitle} · Native report units · Gaps indicate no safely comparable national observation.</p>
              </>
            ) : <p className="py-12 text-center text-sm text-stealth-400">Comparable chart data is not available for this selection.</p>}
          </div>

          <details className="group border-t border-stealth-700">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5">
              <span className="flex items-center gap-2.5"><Info size={16} className="text-sky-300" aria-hidden="true" /><span><span className="block text-sm font-semibold text-stealth-100">Evidence & sources</span><span className="block text-xs text-stealth-500">Raw release, definitions, and methodology</span></span></span>
              <span className="text-xs font-semibold text-sky-200 group-open:hidden">Open</span><span className="hidden text-xs font-semibold text-sky-200 group-open:inline">Close</span>
            </summary>
            <div className="border-t border-stealth-700 px-4 py-4 md:px-5">
              {selectedReport ? <p className="max-w-3xl text-sm leading-6 text-stealth-300">{selectedReport.description}</p> : null}
              {selectedReportId === "wasde" ? (
                <dl className="mt-3 space-y-2 text-sm leading-6">
                  {Object.entries(data.methodology).map(([key, value]) => <div key={key}><dt className="inline font-semibold capitalize text-stealth-200">{key}: </dt><dd className="inline text-stealth-400">{value}</dd></div>)}
                </dl>
              ) : selectedReportHistory && selectedArchiveRelease ? (
                <div className="mt-3 space-y-3">
                  <label className="block max-w-xl"><span className="text-xs font-semibold text-stealth-400">Release date</span><select value={selectedArchiveRelease.release_date} onChange={(event) => setSelectedArchiveReleaseDate(event.target.value)} className={INPUT_CLASS}>{selectedReportHistory.releases.map((release) => <option key={release.release_date} value={release.release_date}>{formatDate(release.release_date)} · {release.title}</option>)}</select></label>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{selectedArchiveRelease.metrics.slice(0, 4).map((item) => <div key={item.id}><p className="text-xs text-stealth-500">{item.label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-stealth-100">{formatValue(item.value, 1)}</p><p className="text-xs text-stealth-500">{item.unit}</p></div>)}</div>
                  <div className="flex flex-wrap gap-2">{selectedArchiveRelease.documents.map((document) => <a key={`${document.format}:${document.url}`} href={document.url} target="_blank" rel="noreferrer" className="field-button field-button-secondary gap-2">Open {document.label} <ExternalLink size={14} aria-hidden="true" /></a>)}</div>
                  <p className="text-xs leading-5 text-stealth-500">{selectedAnalysis?.comparison_basis} Values remain in official source units; the summary does not infer market causation or unpublished consensus.</p>
                </div>
              ) : null}
            </div>
          </details>

          {selectedReportId === "wasde" ? <details className="group border-t border-stealth-700">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5">
              <span><span className="block text-sm font-semibold text-stealth-100">Expectation journal</span><span className="block text-xs text-stealth-500">Record a pre-release number in this browser</span></span>
              <span className="text-xs font-semibold text-sky-200 group-open:hidden">Open</span><span className="hidden text-xs font-semibold text-sky-200 group-open:inline">Close</span>
            </summary>
            <div className="border-t border-stealth-700 px-4 py-4 md:px-5">
              <div className="grid gap-3 md:grid-cols-3">
                <label><span className="text-xs font-semibold text-stealth-400">Release</span><select value={selectedReleaseDate} onChange={(event) => setSelectedReleaseDate(event.target.value)} className={INPUT_CLASS}>{expectationReleaseDates.map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</select></label>
                <label><span className="text-xs font-semibold text-stealth-400">Expected {selectedSeries?.label.toLowerCase()}</span><input type="number" step="any" value={expectationInput} onChange={(event) => setExpectationInput(event.target.value)} className={INPUT_CLASS} placeholder="Enter value" /></label>
                <label><span className="text-xs font-semibold text-stealth-400">Thesis note · optional</span><input type="text" value={expectationNote} onChange={(event) => setExpectationNote(event.target.value)} className={INPUT_CLASS} placeholder="Why this is your expectation" /></label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-stealth-400"><span>Your expectation <strong className="text-amber-200">{savedExpectation ? formatValue(savedExpectation.value) : "not set"}</strong></span><span>Official <strong className="text-stealth-100">{formatValue(activePoint?.value)}</strong></span><span>Signal <strong className="text-stealth-100">{formatSigned(activePoint?.bullish_signal_z, "σ")}</strong></span><span>Futures <strong className="text-sky-200">{formatSigned(activePoint?.reaction_1d_pct, "%")}</strong></span></div>
              <button type="button" className="field-button field-button-primary mt-3 gap-2" onClick={saveExpectation} disabled={!selectedReleaseDate || !canSaveExpectation}>{savedExpectation ? <Check size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{savedExpectation ? "Update expectation" : "Save expectation"}</button>
            </div>
          </details> : null}
        </article>
      </section>
      )}
    </div>
  );
}
