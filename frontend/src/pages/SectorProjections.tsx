/**
 * Sector Projections Page
 * 
 * Displays forward-looking sector rankings across 3 time horizons (3m, 6m, 12m)
 * using a transparent, rule-based scoring model (Option B).
 * 
 * Features:
 * - Line chart showing score trends across horizons for all 11 sectors
 * - Detailed tables with composite scores and component breakdowns
 * - Methodology explanation for transparency
 */

/**
 * Sector Projections Page
 * 
 * Displays transparent, rules-based sector ETF performance projections across multiple time horizons.
 * Unlike black-box models, every score component is calculable and interpretable by analysts.
 * 
 * Features:
 * - Multi-horizon analysis: 3-month, 6-month, and 12-month projections
 * - Smooth line chart visualization tracking score evolution
 * - Detailed scoring breakdown for each sector and horizon
 * - Winner/Neutral/Loser classifications
 * - Collapsible methodology section with technical details
 * 
 * Scoring Components (Total = 100):
 * - Trend (45%): Return + momentum indicator (SMA distance)
 * - Relative Strength (30%): Outperformance vs SPY benchmark
 * - Stability (20%): Volatility + drawdown (inverted - lower risk = higher score)
 * - Regime (5%): Context-aware adjustments based on market state
 * 
 * @component
 */

import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/useApi";
import MarketLoading from "../components/ui/MarketLoading";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import {
  CHART_ANIMATION,
  CHART_MARGIN,
  CHART_NEUTRAL,
  commonGridProps,
  commonTooltipStyle,
} from "../utils/chartUtils";
import { getFamilyColor, getMetricColor } from "../theme/metricColors";
import "../index.css";

const CHART_HORIZONS = ["T", "3m", "6m", "12m"];
const getSectorColor = (
  symbol: string,
  variant: "base" | "muted" | "faint" = "base"
) => getMetricColor(symbol, variant);

const OSCILLATOR_STYLES: Record<string, { color: string; dash?: string }> = {
  cyclical_defensive: { color: getFamilyColor("market") },
  broad_risk_appetite: { color: getFamilyColor("volatility"), dash: "8 4" },
  growth_reflation: { color: getFamilyColor("inflation"), dash: "3 3" },
  consumer_appetite: { color: getFamilyColor("sentiment"), dash: "10 3 2 3" },
};

interface SectorHistoryPoint {
  as_of_date: string;
  timestampNum: number;
  positive_avg: number;
  negative_avg: number;
  raw_spread: number;
  smoothed_spread: number;
  oscillator: number;
}

interface CombinedOscillatorPoint {
  as_of_date: string;
  timestampNum: number;
  [comparisonKey: string]: string | number;
}

interface SectorProjectionItem {
  sector_symbol: string;
  sector_name: string;
  score_total: number;
  score_trend: number;
  score_rel: number;
  score_risk: number;
  score_regime: number;
  rank: number;
  classification: string;
  raw_score?: number;
  scanner_overlay?: number;
  metrics?: {
    return?: number | null;
    sma_dist?: number | null;
    rel_ret?: number | null;
    vol?: number | null;
    drawdown?: number | null;
  };
}

interface DataWarning {
  type: string;
  details: unknown[];
}

interface ChartDataPoint {
  name: string;
  symbol: string;
  scores: Record<string, number | null>;
  lower: Record<string, number | null>;
  upper: Record<string, number | null>;
}

interface StableHorizonSignal {
  raw_score: number;
  stable_core_score: number;
  stable_score: number;
  scanner_overlay: number;
  uncertainty_low: number;
  uncertainty_high: number;
  observed_score_std: number;
  sample_count: number;
  raw_rank: number | null;
  stable_rank: number;
}

interface ForwardScenarioSignal {
  months_forward: number;
  projected_score: number;
  projected_low: number;
  projected_high: number;
  projected_rank: number;
  current_core_score: number;
  anchor_score: number;
  momentum_points: number;
  scanner_points: number;
}

interface SectorAnalyticsSignal {
  sector_symbol: string;
  sector_name: string;
  horizons: Record<string, StableHorizonSignal>;
  forward_scenarios: Record<string, ForwardScenarioSignal>;
  persistence: {
    sample_count: number;
    rank_slope_per_run: number;
    rank_signal: number;
    top3_rate: number;
    direction: "improving" | "stable" | "weakening";
  };
  scanner: {
    hits: number;
    recent_hits: number;
    prior_hits: number;
    unique_symbols: number;
    distinct_days: number;
    directional_balance: number;
    scanner_score: number;
    reliability: number;
    overlay_points: number;
    evidence_status: "usable" | "thin";
  };
  history_3m: Array<{
    as_of_date: string;
    raw_score: number;
    stable_score: number | null;
    rank: number | null;
  }>;
}

interface LeadershipComparison {
  key: string;
  title: string;
  positive_label: string;
  negative_label: string;
  positive_axis_label: string;
  negative_axis_label: string;
  positive_symbols: string[];
  negative_symbols: string[];
  description: string;
  series: Omit<SectorHistoryPoint, "timestampNum">[];
  sample_count: number;
}

interface SectorProjectionAnalyticsResponse {
  as_of_date: string;
  analytics_version: string;
  leadership_method: string;
  leadership_band: number;
  forward_scenario_method: string;
  score_method: string;
  scanner_method: string;
  uncertainty_method: string;
  scanner_coverage: {
    lookback_days: number;
    total_events: number;
    classified_events: number;
    deduplicated_events: number;
    classification_coverage_pct: number;
    max_overlay_points: number;
  };
  sectors: Record<string, SectorAnalyticsSignal>;
  leadership_comparisons: LeadershipComparison[];
}

const BLOCKING_WARNING_TYPES = new Set([
  "empty_sector_projection_run",
  "missing_sector_projections",
  "partial_sector_metrics",
]);

function hasBlockingDataWarnings(warnings?: DataWarning[]) {
  return (warnings || []).some((warning) => BLOCKING_WARNING_TYPES.has(warning.type));
}

function isSuspiciousProjectionSet(projectionSet?: Record<string, SectorProjectionItem[]>) {
  if (!projectionSet) return false;
  const expectedSectorCount = 11;
  return Object.entries(projectionSet).some(([, rows]) => {
    if (!rows || rows.length === 0) return true;
    if (rows.length < expectedSectorCount) return true;
    const zeroFilledRows = rows.filter((row) => {
      const metrics = row.metrics || {};
      const coreValues = [metrics.return, metrics.sma_dist, metrics.rel_ret];
      return coreValues.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e-12);
    });
    return zeroFilledRows.length > Math.max(3, Math.floor(expectedSectorCount * 0.4));
  });
}

/**
 * Visual score bar component for displaying normalized 0-100 scores
 */
function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 sm:w-14 text-stealth-400">{label}</span>
      <div className="flex-1 bg-stealth-700 rounded h-2">
        <div
          className="h-2 rounded"
          style={{ width: `${value}%`, background: color }}
        ></div>
      </div>
      <span className="w-8 text-right text-stealth-300 tabular-nums">{Math.round(value)}</span>
    </div>
  );
}

function formatMetricPercent(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "—";
}

function CompactScoreBar({
  value,
  color,
  metadata,
}: {
  value: number;
  color: string;
  metadata?: string;
}) {
  return (
    <div className="min-w-0 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stealth-700">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
          />
        </div>
        <span className="w-6 shrink-0 text-right text-xs tabular-nums text-stealth-200">
          {Math.round(value)}
        </span>
      </div>
      {metadata ? (
        <div className="mt-1 truncate text-xs tabular-nums text-stealth-500" title={metadata}>
          {metadata}
        </div>
      ) : null}
    </div>
  );
}

export default function SectorProjections() {
  interface SectorProjectionsResponse {
    projections: Record<string, SectorProjectionItem[]>;
    historical: Record<string, number>;
    as_of_date: string;
    system_state: string;
    data_warnings: DataWarning[];
    quality_status?: string;
    excluded_from_latest?: boolean;
  }
  const { data, loading, error, refetch: refetchProjections } = useApi<SectorProjectionsResponse>("/sectors/projections/latest");
  const {
    data: analyticsData,
    error: analyticsError,
    refetch: refetchAnalytics,
  } = useApi<SectorProjectionAnalyticsResponse>("/sectors/projections/analytics?days=365&scanner_days=45");
  const [projections, setProjections] = useState<Record<string, SectorProjectionItem[]>>({});
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [selectedHorizon, setSelectedHorizon] = useState<"T" | "3m" | "6m" | "12m">("12m");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedComparison, setSelectedComparison] = useState("cyclical_defensive");
  const pageLoading = loading && !data;
  const pageError = !data ? error : null;
  const activeComparison = analyticsData?.leadership_comparisons.find((comparison) => comparison.key === selectedComparison)
    ?? analyticsData?.leadership_comparisons[0]
    ?? null;
  const divergenceHistory = useMemo(() => {
    return (activeComparison?.series ?? []).map((point) => ({
      ...point,
      timestampNum: new Date(`${point.as_of_date}T00:00:00Z`).getTime(),
    }));
  }, [activeComparison]);
  const combinedOscillatorHistory = useMemo(() => {
    const byDate = new Map<string, CombinedOscillatorPoint>();
    (analyticsData?.leadership_comparisons ?? []).forEach((comparison) => {
      comparison.series.forEach((point) => {
        const existing = byDate.get(point.as_of_date) ?? {
          as_of_date: point.as_of_date,
          timestampNum: new Date(`${point.as_of_date}T00:00:00Z`).getTime(),
        };
        existing[comparison.key] = point.oscillator;
        byDate.set(point.as_of_date, existing);
      });
    });
    return Array.from(byDate.values()).sort((a, b) => a.timestampNum - b.timestampNum);
  }, [analyticsData]);
  const scoreBarColors = {
    total: getFamilyColor("system"),
    trend: getFamilyColor("growth"),
    rel: getFamilyColor("equity"),
    risk: getFamilyColor("volatility"),
    regime: getFamilyColor("sentiment"),
  };

  useEffect(() => {
    if (data && data.projections) {
      const excludeLatestRun =
        data.excluded_from_latest ||
        data.quality_status === "blocked" ||
        hasBlockingDataWarnings(data.data_warnings) ||
        isSuspiciousProjectionSet(data.projections);
      setProjections(excludeLatestRun ? {} : data.projections);
      
      // If T data is invalid and currently selected, switch to 3m
      const tData = data.projections["T"] || [];
      const tScoresValid = tData.length > 0 && (
        new Set(tData.map(s => Math.round(s.score_total))).size > 1
      );
      if (selectedHorizon === "T" && !tScoresValid) {
        setSelectedHorizon("3m");
      }
    }
  }, [data]);

  useEffect(() => {
    if (selectedSector || !analyticsData) return;
    const leader = Object.values(analyticsData.sectors)
      .filter((sector) => sector.horizons["3m"])
      .sort((a, b) => a.horizons["3m"].stable_rank - b.horizons["3m"].stable_rank)[0];
    if (leader) setSelectedSector(leader.sector_symbol);
  }, [analyticsData, selectedSector]);

  const displayProjections = useMemo(() => {
    const output: Record<string, SectorProjectionItem[]> = {};
    Object.entries(projections).forEach(([horizon, rows]) => {
      output[horizon] = rows.map((row) => {
        const stable = analyticsData?.sectors[row.sector_symbol]?.horizons[horizon];
        return stable
          ? {
              ...row,
              raw_score: row.score_total,
              score_total: stable.stable_score,
              rank: stable.stable_rank,
              scanner_overlay: stable.scanner_overlay,
              classification: stable.stable_rank <= 3 ? "Winner" : stable.stable_rank >= 9 ? "Loser" : "Neutral",
            }
          : row;
      });
    });
    return output;
  }, [analyticsData, projections]);

  // Prepare data for line chart: track each sector's score across horizons
  const getChartData = () => {
    if (!displayProjections["3m"]) return [];
    
    // Get all unique sectors from 3m data (use 3m as reference since it should always exist)
    const sectors = displayProjections["3m"] || [];
    
    return sectors.map((sector) => {
      const sectorData: ChartDataPoint = {
        name: sector.sector_name,
        symbol: sector.sector_symbol,
        scores: {},
        lower: {},
        upper: {},
      };

      // The chart uses the explicit forward scenario layer. Trailing-window
      // scores remain available below as model inputs and audit evidence.
      CHART_HORIZONS.forEach((h) => {
        const scenario = analyticsData?.sectors[sector.sector_symbol]?.forward_scenarios?.[h];
        const horizonData = displayProjections[h] || [];
        const match = horizonData.find((s) => s.sector_symbol === sector.sector_symbol);
        if (scenario) {
          sectorData.scores[h] = scenario.projected_score;
          sectorData.lower[h] = scenario.projected_low;
          sectorData.upper[h] = scenario.projected_high;
        } else if (match) {
          const stable = analyticsData?.sectors[sector.sector_symbol]?.horizons[h];
          sectorData.scores[h] = stable?.stable_score ?? match.score_total;
          sectorData.lower[h] = stable?.uncertainty_low ?? match.score_total;
          sectorData.upper[h] = stable?.uncertainty_high ?? match.score_total;
        } else {
          // If no data for this horizon, use null to indicate missing data
          sectorData.scores[h] = null;
          sectorData.lower[h] = null;
          sectorData.upper[h] = null;
        }
      });
      
      return sectorData;
    });
  };

  const chartData = getChartData();
  const latestRunSuspicious =
    data?.excluded_from_latest ||
    data?.quality_status === "blocked" ||
    hasBlockingDataWarnings(data?.data_warnings) ||
    isSuspiciousProjectionSet(data?.projections);
  const tInterpolated = chartData.some((sector) =>
    sector.scores["T"] === null || sector.scores["T"] === undefined
  );
  
  // Detect if T data is valid (should have variation across sectors)
  // If all sectors have identical scores, T data is likely stale/unavailable
  const tData = projections["T"] || [];
  const tScoresValid = tData.length > 0 && (
    new Set(tData.map(s => Math.round(s.score_total))).size > 1
  );
  const divergenceTimestamps = combinedOscillatorHistory.map((point) => point.timestampNum);
  const divergenceMinTime = divergenceTimestamps.length ? Math.min(...divergenceTimestamps) : 0;
  const divergenceMaxTime = divergenceTimestamps.length ? Math.max(...divergenceTimestamps) : 0;
  const divergenceTicks = divergenceTimestamps.length > 1
    ? Array.from({ length: 5 }, (_, i) => divergenceMinTime + ((divergenceMaxTime - divergenceMinTime) * (i / 4)))
    : divergenceTimestamps;
  const latestOscillator = divergenceHistory.length
    ? divergenceHistory[divergenceHistory.length - 1]?.oscillator ?? null
    : null;
  const priorOscillator = divergenceHistory.length > 20
    ? divergenceHistory[divergenceHistory.length - 21]?.oscillator ?? null
    : divergenceHistory[0]?.oscillator ?? null;
  const oscillatorChange = latestOscillator !== null && priorOscillator !== null ? latestOscillator - priorOscillator : null;
  const leadershipBand = analyticsData?.leadership_band ?? 15;
  const positiveAxisLabel = activeComparison?.positive_axis_label ?? "First basket";
  const negativeAxisLabel = activeComparison?.negative_axis_label ?? "Second basket";
  const oscillatorValues = combinedOscillatorHistory.flatMap((point) =>
    (analyticsData?.leadership_comparisons ?? [])
      .map((comparison) => point[comparison.key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  );
  const oscillatorDomain = Math.max(
    30,
    Math.ceil((oscillatorValues.length ? Math.max(...oscillatorValues.map((value) => Math.abs(value))) : 30) / 10) * 10
  );
  const oscillatorRead = latestOscillator === null
    ? "Unavailable"
    : latestOscillator >= leadershipBand
      ? activeComparison?.positive_label ?? "Positive leadership"
      : latestOscillator <= -leadershipBand
        ? activeComparison?.negative_label ?? "Negative leadership"
        : "Balanced leadership";
  const oscillatorNowLabel = latestOscillator === null
    ? "Unavailable"
    : latestOscillator >= leadershipBand
      ? positiveAxisLabel
      : latestOscillator <= -leadershipBand
        ? negativeAxisLabel
        : "Balanced";
  const oscillatorShiftLabel = oscillatorChange === null
    ? "Unavailable"
    : Math.abs(oscillatorChange) < 2
      ? "Little change"
      : oscillatorChange > 0
        ? `Toward ${positiveAxisLabel}`
        : `Toward ${negativeAxisLabel}`;
  const selectedSectorAnalytics = selectedSector ? analyticsData?.sectors[selectedSector] ?? null : null;
  const selectedSectorHistory = (selectedSectorAnalytics?.history_3m ?? []).map((point) => ({
    ...point,
    timestampNum: new Date(`${point.as_of_date}T00:00:00Z`).getTime(),
  }));
  const selectedRankingRows = displayProjections[selectedHorizon] ?? [];
  const showRegimeColumn = new Set(selectedRankingRows.map((row) => Math.round(row.score_regime))).size > 1;
  const oscillatorComparisons = [...(analyticsData?.leadership_comparisons ?? [])].sort((a, b) => {
    if (a.key === selectedComparison) return 1;
    if (b.key === selectedComparison) return -1;
    return 0;
  });

  return (
    <div className="page-shell-narrow page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Rotation Monitor</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Sector Rotation</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300 md:text-[15px]">Compare stabilized forward leadership scenarios built from trailing sector evidence, rank persistence, and bounded scanner confirmation.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-stealth-300">
          {data && <span className="page-badge">System {data.system_state}</span>}
          {data && <span className="page-badge">As of {data.as_of_date}</span>}
        </div>
      </div>

      {analyticsError && data && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-4" role="status">
          <h2 className="text-sm font-semibold text-amber-200">Partial sector update</h2>
          <p className="mt-1 text-sm text-amber-100">Current projection rows are available, but leadership history and stabilization analytics are unavailable.</p>
          <button type="button" onClick={refetchAnalytics} className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-amber-600 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
            Retry sector analytics
          </button>
        </div>
      )}

      {(data?.data_warnings?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-yellow-700/50 bg-yellow-900/20 p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-yellow-200/90 leading-relaxed">
            <strong>Data Warning:</strong> Recent projections contain data quality flags that may reduce accuracy.
          </p>
          <ul className="mt-2 text-xs text-yellow-200/80 space-y-0.5">
            {data?.data_warnings?.map((warning, idx) => (
              <li key={`${warning.type}-${idx}`}>
                {warning.type.replace(/_/g, " ")} - {Array.isArray(warning.details) ? warning.details.length : 0} issue(s)
              </li>
            ))}
          </ul>
        </div>
      )}
      {latestRunSuspicious && (
        <div className="rounded-2xl border border-red-700/50 bg-red-950/30 p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-red-100/90 leading-relaxed">
            <strong>Projection run excluded:</strong> The latest sector projection payload appears partial or quality-blocked, so it is not used in charts.
          </p>
        </div>
      )}
      
      {pageLoading && (
        <div className="flex justify-center py-6">
          <MarketLoading size={110} variant="scan" label="Loading sector projections..." />
        </div>
      )}
      {pageError && (
        <div className="surface-card border-red-800/70 p-5" role="alert">
          <h2 className="text-lg font-semibold text-red-200">Sector projections are unavailable</h2>
          <p className="mt-2 text-sm text-red-300">{pageError}</p>
          <button
            type="button"
            onClick={() => {
              refetchProjections();
              refetchAnalytics();
            }}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-red-700 bg-red-950/50 px-4 text-sm font-semibold text-red-100 hover:bg-red-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry sector projections
          </button>
        </div>
      )}
      
      {/* Sector leadership oscillator - historical trend */}
      {!pageLoading && !pageError && (
        <section id="sector-leadership" className="surface-card-strong scroll-mt-32 p-4 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold sm:text-lg">Sector Leadership Oscillator</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-stealth-400">
                All four lenses show the smoothed score spread between two sector baskets. Higher favors the first basket; lower favors the second. Select a lens to label the direction.
              </p>
            </div>
            <div className="shrink-0">
              <div className="mb-1 text-right text-xs uppercase tracking-wide text-stealth-400">Selected · {activeComparison?.title ?? "—"}</div>
              <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                <div className="rounded-lg border border-stealth-700 bg-stealth-950/40 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-stealth-400">Leading now</div>
                  <div className="mt-0.5 font-semibold text-stealth-100">{oscillatorNowLabel}</div>
                </div>
                <div className="rounded-lg border border-stealth-700 bg-stealth-950/40 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-stealth-400">20-run shift</div>
                  <div className="mt-0.5 font-semibold text-stealth-200">
                    {oscillatorShiftLabel}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(analyticsData?.leadership_comparisons ?? []).map((comparison) => (
              <button
                key={comparison.key}
                type="button"
                onClick={() => setSelectedComparison(comparison.key)}
                aria-pressed={selectedComparison === comparison.key}
                title={`${comparison.positive_label}: ${comparison.positive_symbols.join(", ")} · ${comparison.negative_label}: ${comparison.negative_symbols.join(", ")}`}
                className={`flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition ${selectedComparison === comparison.key ? "border-stealth-500 bg-stealth-900/70 text-stealth-100" : "border-stealth-700 bg-stealth-950/30 text-stealth-300 hover:border-stealth-600"}`}
              >
                <span
                  className="h-0.5 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: OSCILLATOR_STYLES[comparison.key]?.color ?? CHART_NEUTRAL.tick }}
                  aria-hidden="true"
                />
                {comparison.title}
              </button>
            ))}
          </div>
          {combinedOscillatorHistory.length > 0 ? (
            <div className="surface-card-muted mt-4 p-2 sm:p-4">
              <div className="h-44 sm:h-56">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart
                    accessibilityLayer
                    aria-label={`${activeComparison?.title ?? "Selected sector comparison"} leadership oscillator history`}
                    data={combinedOscillatorHistory}
                    margin={{ ...CHART_MARGIN, right: 8 }}
                  >
                    <CartesianGrid {...commonGridProps} />
                    <ReferenceArea y1={leadershipBand} y2={oscillatorDomain} fill={getFamilyColor("market")} fillOpacity={0.025} />
                    <ReferenceArea y1={-oscillatorDomain} y2={-leadershipBand} fill={getFamilyColor("volatility")} fillOpacity={0.025} />
                    <ReferenceLine y={0} stroke={CHART_NEUTRAL.axis} strokeWidth={1.5} />
                    <ReferenceLine y={leadershipBand} stroke={CHART_NEUTRAL.grid} strokeDasharray="3 4" />
                    <ReferenceLine y={-leadershipBand} stroke={CHART_NEUTRAL.grid} strokeDasharray="3 4" />
                    <XAxis
                      dataKey="timestampNum"
                      type="number"
                      domain={[divergenceMinTime, divergenceMaxTime]}
                      ticks={divergenceTicks}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      tickFormatter={(value: number) =>
                        new Date(value).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                    <YAxis
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      axisLine={false}
                      tickLine={false}
                      width={82}
                      domain={[-oscillatorDomain, oscillatorDomain]}
                      ticks={[-oscillatorDomain, 0, oscillatorDomain]}
                      tickFormatter={(value: number) => value > 0 ? positiveAxisLabel : value < 0 ? negativeAxisLabel : "Balanced"}
                    />
                    <Tooltip
                      contentStyle={commonTooltipStyle}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      }
                      formatter={(value: number, name: string) => {
                        const comparison = analyticsData?.leadership_comparisons.find((row) => row.title === name);
                        const leader = value >= 0
                          ? comparison?.positive_axis_label ?? "First basket"
                          : comparison?.negative_axis_label ?? "Second basket";
                        return [`${leader} by ${Math.abs(value).toFixed(1)} score points`, name];
                      }}
                    />
                    {oscillatorComparisons.map((comparison) => {
                      const style = OSCILLATOR_STYLES[comparison.key] ?? { color: CHART_NEUTRAL.tick };
                      const isActive = comparison.key === selectedComparison;
                      return (
                        <Area
                          key={comparison.key}
                          type="monotone"
                          dataKey={comparison.key}
                          name={comparison.title}
                          baseValue={0}
                          stroke={style.color}
                          strokeWidth={isActive ? 2.5 : 1.5}
                          strokeOpacity={isActive ? 1 : 0.72}
                          strokeDasharray={style.dash}
                          fill={style.color}
                          fillOpacity={isActive ? 0.09 : 0.025}
                          dot={false}
                          connectNulls={false}
                          animationDuration={CHART_ANIMATION.duration}
                          animationEasing={CHART_ANIMATION.easing}
                        />
                      );
                    })}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-stealth-400">
                <span>{activeComparison?.title} · {oscillatorRead}</span>
                <span>{activeComparison?.sample_count ?? 0} observations per series · shaded zones mark clear leadership</span>
              </div>
            </div>
          ) : (
            <div className="surface-card-muted p-6 text-center text-xs text-stealth-400">
              No history available yet.
            </div>
          )}
        </section>
      )}
      
      
      {/* Multi-sector forward score scenarios. */}
      {!pageLoading && !pageError && Object.keys(projections).length > 0 && (
        <section id="sector-scenarios" className="surface-card-strong scroll-mt-32 p-4 sm:p-6">
          <h2 className="mb-2 text-base font-semibold sm:text-lg">Stabilized Sector Forward Scenarios</h2>
          <p className="mb-3 max-w-4xl text-xs leading-relaxed text-stealth-400">
            Projected leadership scores blend today's stabilized reading toward longer-run anchors, then apply bounded rank persistence and scanner confirmation. Select a sector to emphasize its path and scenario range.
          </p>
          {tInterpolated && (
            <p className="mb-3 text-xs text-amber-300/90">
              Some current values fall back to the stabilized 3M reading because a valid current observation is unavailable.
            </p>
          )}

          <div className="surface-card-muted mb-2 p-2 sm:p-4">
            <div className="w-full" style={{ aspectRatio: "2 / 1", maxHeight: "240px" }}>
              <svg width="100%" height="100%" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Projected sector scores now, in three months, six months, and twelve months. Select a sector below for exact values.">
                <defs>
                  {chartData.map((sector, index) => (
                    <linearGradient key={sector.symbol} id={`sector-range-${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={getSectorColor(sector.symbol, "muted")} stopOpacity="0.03" />
                      <stop offset="100%" stopColor={getSectorColor(sector.symbol, "muted")} stopOpacity="0.16" />
                    </linearGradient>
                  ))}
                </defs>
                {[0, 25, 50, 75, 100].map((score) => (
                  <g key={score}>
                    <line x1="50" y1={260 - score * 2.4} x2="960" y2={260 - score * 2.4} stroke={CHART_NEUTRAL.grid} strokeWidth="1" strokeDasharray="4 4" />
                    <text x="40" y={264 - score * 2.4} fill={CHART_NEUTRAL.tick} fontSize="12" textAnchor="end">{score.toFixed(0)}</text>
                  </g>
                ))}
                <text x="150" y="285" fill={CHART_NEUTRAL.tick} fontSize="12" textAnchor="middle" fontWeight="500">NOW</text>
                <text x="400" y="285" fill={CHART_NEUTRAL.tick} fontSize="12" textAnchor="middle" fontWeight="500">+3 MONTHS</text>
                <text x="650" y="285" fill={CHART_NEUTRAL.tick} fontSize="12" textAnchor="middle" fontWeight="500">+6 MONTHS</text>
                <text x="900" y="285" fill={CHART_NEUTRAL.tick} fontSize="12" textAnchor="middle" fontWeight="500">+12 MONTHS</text>

                {chartData.map((sector, index) => {
                  const color = getSectorColor(sector.symbol);
                  const isSelected = selectedSector === sector.symbol;
                  const opacity = isSelected ? 1 : 0.16;
                  const score3m = sector.scores["3m"] ?? 0;
                  const score6m = sector.scores["6m"] ?? 0;
                  const score12m = sector.scores["12m"] ?? 0;
                  const scoreT = sector.scores["T"] ?? score3m;
                  const points = [
                    { x: 150, y: 260 - scoreT * 2.4, upper: 260 - (sector.upper["T"] ?? scoreT) * 2.4, lower: 260 - (sector.lower["T"] ?? scoreT) * 2.4 },
                    { x: 400, y: 260 - score3m * 2.4, upper: 260 - (sector.upper["3m"] ?? score3m) * 2.4, lower: 260 - (sector.lower["3m"] ?? score3m) * 2.4 },
                    { x: 650, y: 260 - score6m * 2.4, upper: 260 - (sector.upper["6m"] ?? score6m) * 2.4, lower: 260 - (sector.lower["6m"] ?? score6m) * 2.4 },
                    { x: 900, y: 260 - score12m * 2.4, upper: 260 - (sector.upper["12m"] ?? score12m) * 2.4, lower: 260 - (sector.lower["12m"] ?? score12m) * 2.4 },
                  ];
                  const centerPath = `M ${points[0].x} ${points[0].y} Q 275 ${(points[0].y + points[1].y) / 2}, ${points[1].x} ${points[1].y} Q 525 ${(points[1].y + points[2].y) / 2}, ${points[2].x} ${points[2].y} Q 775 ${(points[2].y + points[3].y) / 2}, ${points[3].x} ${points[3].y}`;
                  const upperPath = `M ${points[0].x} ${points[0].upper} Q 275 ${(points[0].upper + points[1].upper) / 2}, ${points[1].x} ${points[1].upper} Q 525 ${(points[1].upper + points[2].upper) / 2}, ${points[2].x} ${points[2].upper} Q 775 ${(points[2].upper + points[3].upper) / 2}, ${points[3].x} ${points[3].upper}`;
                  const rangePath = `${upperPath} L ${points[3].x} ${points[3].lower} Q 775 ${(points[2].lower + points[3].lower) / 2}, ${points[2].x} ${points[2].lower} Q 525 ${(points[1].lower + points[2].lower) / 2}, ${points[1].x} ${points[1].lower} Q 275 ${(points[0].lower + points[1].lower) / 2}, ${points[0].x} ${points[0].lower} Z`;

                  return (
                    <g key={sector.symbol}>
                      {isSelected ? <path d={rangePath} fill={`url(#sector-range-${index})`} /> : null}
                      <path d={centerPath} stroke={color} strokeWidth={isSelected ? 3.5 : 1.5} fill="none" opacity={opacity} strokeLinecap="round" strokeLinejoin="round" />
                      {points.map((point, pointIndex) => (
                        <circle key={pointIndex} cx={point.x} cy={point.y} r={isSelected ? 5 : 3} fill={color} opacity={opacity} />
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="mb-4 mt-2 max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" role="region" aria-label="Sector selector. Scroll horizontally if needed." tabIndex={0}>
            <div className="flex min-w-min flex-wrap gap-1 pb-2 sm:gap-2">
              {chartData.map((sector) => {
                const color = getSectorColor(sector.symbol);
                const isSelected = selectedSector === sector.symbol;
                return (
                  <button
                    key={sector.symbol}
                    type="button"
                    onClick={() => setSelectedSector(sector.symbol)}
                    aria-pressed={isSelected}
                    className={`flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs whitespace-nowrap transition ${isSelected ? "border-stealth-500 bg-stealth-800 font-semibold text-white" : "border-transparent text-stealth-300 hover:border-stealth-700 hover:bg-stealth-900/50"}`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
                    {sector.symbol}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedSectorAnalytics && selectedSectorHistory.length > 1 ? (
            <div className="mb-1 grid gap-3 border-t border-stealth-700 pt-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="min-w-0 rounded-lg border border-stealth-800 bg-stealth-950/30 p-2.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                  <div>
                    <div className="text-xs font-semibold text-stealth-200">{selectedSectorAnalytics.sector_symbol} · observed 3M-score history</div>
                    <div className="text-xs text-stealth-500">Raw daily score versus the stabilized score used above</div>
                  </div>
                  <div className="text-xs text-stealth-500">{selectedSectorHistory.length} observations</div>
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart
                      accessibilityLayer
                      aria-label={`${selectedSectorAnalytics.sector_symbol} raw and stabilized three-month score history`}
                      data={selectedSectorHistory}
                      margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
                    >
                      <CartesianGrid {...commonGridProps} />
                      <XAxis dataKey="timestampNum" type="number" domain={["dataMin", "dataMax"]} tick={false} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} stroke={CHART_NEUTRAL.axis} />
                      <Tooltip contentStyle={commonTooltipStyle} labelFormatter={(label: number) => new Date(label).toLocaleDateString()} formatter={(value: number, name: string) => [value.toFixed(1), name === "stable_score" ? "Stable score" : "Raw score"]} />
                      <Line type="monotone" dataKey="raw_score" stroke={CHART_NEUTRAL.tick} strokeWidth={1} strokeOpacity={0.45} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="stable_score" stroke={getSectorColor(selectedSectorAnalytics.sector_symbol)} strokeWidth={2.25} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-1">
                <div className="rounded-lg border border-stealth-800 bg-stealth-950/30 p-2.5">
                  <div className="uppercase tracking-wide text-stealth-500">Rank persistence</div>
                  <div className="mt-1 font-semibold text-stealth-100">{selectedSectorAnalytics.persistence.direction}</div>
                  <div className="mt-0.5 text-stealth-500">Top-3 in {(selectedSectorAnalytics.persistence.top3_rate * 100).toFixed(0)}% of recent runs</div>
                </div>
                <div className="rounded-lg border border-stealth-800 bg-stealth-950/30 p-2.5">
                  <div className="uppercase tracking-wide text-stealth-500">Scanner confirmation</div>
                  <div className="mt-1 font-semibold text-stealth-100">{selectedSectorAnalytics.scanner.hits} deduped hits · {selectedSectorAnalytics.scanner.unique_symbols} names</div>
                  <div className="mt-0.5 text-stealth-500">Overlay {selectedSectorAnalytics.scanner.overlay_points >= 0 ? "+" : ""}{selectedSectorAnalytics.scanner.overlay_points.toFixed(1)} · reliability {(selectedSectorAnalytics.scanner.reliability * 100).toFixed(0)}%</div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* Detailed Tables with Horizon Selector */}
      {(displayProjections[selectedHorizon === "T" ? "T" : selectedHorizon] || selectedHorizon === "T") && (
        <section id="sector-rankings" className="scroll-mt-32 mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4">
            <div>
              <h2 className="text-base sm:text-lg font-semibold">Trailing Input Rankings</h2>
              <p className="mt-1 text-xs text-stealth-500">These backward-looking windows are model evidence, not the forward scenario dates shown above. Leadership score is the smoothed composite plus scanner adjustment.</p>
            </div>
            <div className="flex flex-wrap gap-1 sm:gap-2">
              {["T", "3m", "6m", "12m"].map((h) => {
                if (h === "T" && !tScoresValid) return null;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setSelectedHorizon(h as "T" | "3m" | "6m" | "12m")}
                    aria-pressed={selectedHorizon === h}
                    title={h === "T" ? "Current input reading" : `${h.toUpperCase()} trailing input window`}
                    className={`min-h-11 rounded-lg px-4 py-2 text-xs font-medium transition sm:text-sm ${
                      selectedHorizon === h
                        ? "bg-blue-600 text-white"
                        : "bg-stealth-700 text-stealth-300 hover:bg-stealth-600"
                    }`}
                  >
                    {h === "T" ? "Current" : `${h.toUpperCase()} input`}
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Show warning if T data is not available or invalid */}
          {selectedHorizon === "T" && (!projections["T"] || !tScoresValid) && (
            <div className="mb-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 sm:p-4">
              <p className="text-xs sm:text-sm text-yellow-200/90">
                <strong>Note:</strong> {!tScoresValid ? "Current time (T) projections appear uniform (likely market closed). " : "Current time (T) projections are not available yet. "}
                {!tScoresValid ? "Select another time horizon." : "Check back when the market is open."}
              </p>
            </div>
          )}
          
          <div className="overflow-hidden rounded-lg bg-stealth-800 shadow">
            <div className="hidden md:block">
              <table className="w-full table-fixed text-xs">
                <caption className="sr-only">Sector rankings and component scores for the selected horizon</caption>
                <colgroup>
                  <col className="w-[5%]" />
                  <col className="w-[25%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col style={{ width: showRegimeColumn ? "10%" : "13.333%" }} />
                  <col style={{ width: showRegimeColumn ? "10%" : "13.333%" }} />
                  <col style={{ width: showRegimeColumn ? "10%" : "13.334%" }} />
                  {showRegimeColumn ? <col className="w-[10%]" /> : null}
                </colgroup>
                <thead>
                  <tr className="border-b border-stealth-700 bg-stealth-900/40 text-xs uppercase tracking-wide text-stealth-500">
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Sector</th>
                    <th className="px-2 py-2 text-left">Leadership</th>
                    <th className="px-2 py-2 text-left">Tier</th>
                    <th className="px-2 py-2 text-left">Trend</th>
                    <th className="px-2 py-2 text-left" title="Relative strength versus SPY">Vs. SPY</th>
                    <th className="px-2 py-2 text-left" title="Higher means more stable. Zero means riskiest in the 11-sector peer set—not zero risk.">Stability ↑</th>
                    {showRegimeColumn ? <th className="px-2 py-2 text-left">Regime adj.</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {[...selectedRankingRows].sort((a, b) => a.rank - b.rank).map((row) => (
                    <tr key={row.sector_symbol} className={`border-b border-stealth-800/70 last:border-b-0 ${selectedSector === row.sector_symbol ? "ring-1 ring-inset ring-sky-500/60" : ""} ${
                      row.classification === "Winner"
                        ? "bg-green-900/30"
                        : row.classification === "Loser"
                        ? "bg-red-900/20"
                        : ""
                    }`}>
                      <td className="px-2 py-1.5 align-middle tabular-nums text-stealth-300">{row.rank}</td>
                      <td className="min-w-0 px-2 py-1.5 align-middle">
                        <button
                          type="button"
                          onClick={() => setSelectedSector(row.sector_symbol)}
                          aria-pressed={selectedSector === row.sector_symbol}
                          className="block min-h-11 w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                          title={`Show evidence for ${row.sector_name} (${row.sector_symbol})`}
                        >
                          <div className="truncate font-medium text-stealth-100">{row.sector_name}</div>
                          <div className="text-xs text-stealth-500">{row.sector_symbol}</div>
                        </button>
                      </td>
                      <td className="px-2 py-1 align-middle">
                        <CompactScoreBar
                          value={row.score_total}
                          color={scoreBarColors.total}
                          metadata={row.raw_score !== undefined
                            ? `raw ${row.raw_score.toFixed(0)} · scan ${row.scanner_overlay !== undefined && row.scanner_overlay >= 0 ? "+" : ""}${row.scanner_overlay?.toFixed(1) ?? "0.0"}`
                            : undefined}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <span className={
                          row.classification === "Winner"
                            ? "text-green-400"
                            : row.classification === "Loser"
                            ? "text-red-400"
                            : "text-stealth-400"
                        }>
                          {row.classification}
                        </span>
                      </td>
                      <td className="px-2 py-1 align-middle"><CompactScoreBar value={row.score_trend} color={scoreBarColors.trend} /></td>
                      <td className="px-2 py-1 align-middle"><CompactScoreBar value={row.score_rel} color={scoreBarColors.rel} /></td>
                      <td
                        className="px-2 py-1 align-middle"
                        title={`Stability ${Math.round(row.score_risk)}. Annualized volatility ${formatMetricPercent(row.metrics?.vol)}; maximum drawdown ${formatMetricPercent(row.metrics?.drawdown)}. Higher is safer relative to the other sectors.`}
                      >
                        <CompactScoreBar
                          value={row.score_risk}
                          color={scoreBarColors.risk}
                          metadata={`vol ${formatMetricPercent(row.metrics?.vol)} · DD ${formatMetricPercent(row.metrics?.drawdown)}`}
                        />
                      </td>
                      {showRegimeColumn ? <td className="px-2 py-1 align-middle"><CompactScoreBar value={row.score_regime} color={scoreBarColors.regime} /></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 p-4 md:hidden sm:space-y-3">
              {[...selectedRankingRows].sort((a, b) => a.rank - b.rank).map((row) => (
                <div
                  key={row.sector_symbol}
                  className={`rounded-lg border border-stealth-700 overflow-hidden ${
                    row.classification === "Winner"
                      ? "bg-green-900/20"
                      : row.classification === "Loser"
                      ? "bg-red-900/20"
                      : "bg-stealth-900/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSector(row.sector_symbol);
                      setExpandedCard(expandedCard === row.sector_symbol ? null : row.sector_symbol);
                    }}
                    className="flex min-h-11 w-full items-start justify-between gap-2 p-3 transition-colors hover:bg-stealth-950/50 sm:gap-3"
                    aria-expanded={expandedCard === row.sector_symbol}
                    aria-controls={`sector-card-${row.sector_symbol}`}
                  >
                    <div className="text-left">
                      <div className="text-xs sm:text-sm font-semibold text-stealth-100">
                        #{row.rank} {row.sector_name}
                      </div>
                      <div className="text-xs text-stealth-500">{row.sector_symbol}</div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <span className={
                        row.classification === "Winner"
                          ? "text-green-400 text-xs font-semibold"
                          : row.classification === "Loser"
                          ? "text-red-400 text-xs font-semibold"
                          : "text-stealth-400 text-xs font-semibold"
                      }>
                        {row.classification}
                      </span>
                      <span className={`collapsible-icon ${expandedCard === row.sector_symbol ? 'collapsible-icon-open' : ''}`} aria-hidden="true">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </span>
                    </div>
                  </button>
                  <div className="px-3 pt-2 pb-3">
                    <ScoreBar label="Score" value={row.score_total} color={scoreBarColors.total} />
                    {row.raw_score !== undefined ? (
                      <div className="mt-1 text-right text-xs text-stealth-500">
                        raw {row.raw_score.toFixed(0)} · scanner {row.scanner_overlay !== undefined && row.scanner_overlay >= 0 ? "+" : ""}{row.scanner_overlay?.toFixed(1) ?? "0.0"}
                      </div>
                    ) : null}
                  </div>
                  <div id={`sector-card-${row.sector_symbol}`} className={`collapsible-panel ${expandedCard === row.sector_symbol ? 'collapsible-panel-open' : ''}`}>
                    <div className="collapsible-panel-inner">
                      <div className="border-t border-stealth-700 bg-stealth-950/50 p-3 space-y-2">
                        <ScoreBar label="Trend" value={row.score_trend} color={scoreBarColors.trend} />
                        <ScoreBar label="Relative" value={row.score_rel} color={scoreBarColors.rel} />
                        <ScoreBar label="Stability" value={row.score_risk} color={scoreBarColors.risk} />
                        <div className="pl-14 text-xs leading-relaxed text-stealth-500">
                          {formatMetricPercent(row.metrics?.vol)} annualized volatility · {formatMetricPercent(row.metrics?.drawdown)} max drawdown · higher stability is safer
                        </div>
                        {showRegimeColumn ? <ScoreBar label="Regime" value={row.score_regime} color={scoreBarColors.regime} /> : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Methodology Explanation - Collapsible */}
      <div id="sector-methodology" className="mb-6 scroll-mt-32 bg-stealth-800 rounded-lg shadow">
        <button
          type="button"
          onClick={() => setMethodologyOpen(!methodologyOpen)}
          className="w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between hover:bg-stealth-750 transition-colors rounded-lg"
          aria-expanded={methodologyOpen}
          aria-controls="sector-methodology-content"
        >
          <h2 className="text-base sm:text-lg font-semibold">Methodology & Algorithm Details</h2>
          <span className={`collapsible-icon ${methodologyOpen ? 'collapsible-icon-open' : ''}`} aria-hidden="true">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>
        <div id="sector-methodology-content" className={`collapsible-panel ${methodologyOpen ? 'collapsible-panel-open' : ''}`}>
          <div className="collapsible-panel-inner">
            <div className="px-4 sm:px-6 pb-6 text-xs sm:text-sm text-stealth-300 space-y-5">
            <div>
              <h3 className="font-semibold text-stealth-100 mb-3 text-sm sm:text-base">Transparent Rule-Based Scoring</h3>
              <p className="text-stealth-400 mb-2 text-xs sm:text-sm">
                Ranks 11 sector ETFs (XLE, XLF, XLK, XLY, XLP, XLV, XLI, XLU, XLB, XLRE, XLC) using 8000 days of historical data. Each sector receives a composite score (0-100) from four weighted components.
              </p>
              <p className="text-stealth-400 text-xs sm:text-sm">
                Raw evidence is computed independently from trailing 3-month (63 trading days), 6-month (126), and 12-month (252) windows. The forward chart then converts those inputs into separate +3M, +6M, and +12M score scenarios.
              </p>
            </div>
            
            <div className="border-t border-stealth-700 pt-4">
              <h3 className="font-semibold text-stealth-100 mb-3 text-sm sm:text-base">Component Calculations</h3>
              
              <div className="space-y-4">
                <div className="bg-stealth-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-yellow-400 mb-2 text-xs sm:text-sm">1. Trend Score (45% weight)</h4>
                  <p className="text-xs text-stealth-400 mb-2">
                    Measures price momentum and technical positioning relative to moving averages.
                  </p>
                  <div className="text-xs text-stealth-400 space-y-1 ml-3">
                    <p><strong>Return:</strong> Total return over the horizon period: (Price_end / Price_start) - 1</p>
                    <p><strong>SMA Distance:</strong> Distance from 200-day simple moving average: (Price_current / SMA_200) - 1</p>
                    <p><strong>Composite:</strong> Return + (0.5 x SMA Distance), scored from peer rank plus robust distance from the peer median on a 0-100 scale</p>
                  </div>
                </div>
                
                <div className="bg-stealth-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-lime-400 mb-2 text-xs sm:text-sm">2. Relative Strength Score (30% weight)</h4>
                  <p className="text-xs text-stealth-400 mb-2">
                    Quantifies outperformance versus the broad market (SPY) over the same period.
                  </p>
                  <div className="text-xs text-stealth-400 space-y-1 ml-3">
                    <p><strong>Calculation:</strong> Sector Return - SPY Return (both measured over the horizon)</p>
                    <p><strong>Normalization:</strong> Blends cross-sector rank with robust outperformance magnitude on a 0-100 scale</p>
                    <p>Higher scores indicate sectors beating the market; lower scores indicate underperformance</p>
                  </div>
                </div>
                
                <div className="bg-stealth-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-red-400 mb-2 text-xs sm:text-sm">3. Stability Score (20% weight; risk inverted)</h4>
                  <p className="text-xs text-stealth-400 mb-2">
                    Evaluates price stability and downside protection. Lower risk = higher score (inverse ranking).
                  </p>
                  <div className="text-xs text-stealth-400 space-y-1 ml-3">
                    <p><strong>Realized Volatility:</strong> 20-day rolling standard deviation of daily returns, annualized (x sqrt252)</p>
                    <p><strong>Max Drawdown:</strong> Largest peak-to-trough decline over the full horizon period</p>
                    <p><strong>Composite:</strong> Volatility + (0.5 x |Drawdown|), with peer rank and robust magnitude both inverted so lower risk scores higher</p>
                    <p>Sectors with lower volatility and smaller drawdowns receive higher stability scores. The magnitude blend prevents a merely last-place sector from automatically reading as zero.</p>
                  </div>
                </div>
                
                <div className="bg-stealth-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-indigo-400 mb-2 text-xs sm:text-sm">4. Regime Adjustment (5% weight)</h4>
                  <p className="text-xs text-stealth-400 mb-2">
                    Context-aware modifier based on the current system state (RED/YELLOW/GREEN market environment).
                  </p>
                  <div className="text-xs text-stealth-400 space-y-1 ml-3">
                    <p><strong>Base Score:</strong> 50 (neutral)</p>
                    <p><strong>RED Market Adjustments:</strong></p>
                    <ul className="ml-4 list-disc">
                      <li>Defensive sectors (Utilities, Consumer Staples, Health Care): +5 points</li>
                      <li>High-volatility sectors (volatility above median): -5 points</li>
                    </ul>
                    <p><strong>YELLOW/GREEN Markets:</strong> No adjustments applied (all sectors score 50)</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="border-t border-stealth-700 pt-4">
              <h3 className="font-semibold text-stealth-100 mb-3 text-sm sm:text-base">Final Score & Ranking</h3>
              <div className="text-xs sm:text-sm text-stealth-400 space-y-2">
                <p className="font-mono bg-stealth-950 p-2 rounded text-xs">
                  Composite Score = (0.45 x Trend) + (0.30 x Rel_Strength) + (0.20 x Stability) + (0.05 x Regime)
                </p>
                <p className="text-xs sm:text-sm">
                  Trend, relative strength, and stability each blend 55% peer order with 45% robust distance from the peer median. A sector can therefore strengthen or weaken while retaining the same rank.
                </p>
                <p className="text-xs sm:text-sm">
                  The raw score remains auditable. Displayed ranks use 55% EWMA, 30% five-run median, and 15% latest raw score, followed by a reliability-gated scanner overlay capped at ±4 points.
                </p>
              </div>
            </div>
            
            <div className="border-t border-stealth-700 pt-4">
              <h3 className="font-semibold text-stealth-100 mb-3 text-sm sm:text-base">Scanner Confirmation &amp; Scenario Ranges</h3>
              <p className="text-xs sm:text-sm text-stealth-400 mb-3">
                Forward score scenarios blend the current stabilized reading toward the matching longer-run input anchor. Recent rank persistence and scanner evidence can tilt that path without becoming the primary model.
              </p>
              <div className="text-xs sm:text-sm text-stealth-400 space-y-2">
                <p><strong>Scanner input:</strong> Direction comes from selected calls versus puts. Duplicate symbol/day/side events are collapsed, then recency, unique-name breadth, distinct days, and opportunity rank determine reliability.</p>
                <p><strong>Projected center:</strong> The current stabilized score receives the most weight at +3M; longer scenarios blend progressively toward the sector's 6M and 12M structural anchors.</p>
                <p><strong>Bounded influence:</strong> Recent rank persistence contributes at most 3, 5, and 7 points across +3M, +6M, and +12M. Scanner influence remains capped at four points and decays by half at +6M and to one quarter at +12M.</p>
                <p><strong>Range width:</strong> Uses the sector's observed score variability over the latest 20 valid runs, expanding with forecast distance.</p>
                <p><strong>Range skew:</strong> Repeated rank improvement and reliable bullish scanner breadth allow more upside room; weakening persistence or bearish breadth does the reverse.</p>
                <p><strong>Important:</strong> The displayed intervals are transparent scenario ranges, not calibrated probability confidence intervals.</p>
              </div>
            </div>

            <div className="border-t border-stealth-700 pt-4">
              <h3 className="font-semibold text-stealth-100 mb-3 text-sm sm:text-base">Leadership Oscillators</h3>
              <div className="text-xs sm:text-sm text-stealth-400 space-y-2">
                <p>Each oscillator starts with the average daily 3M score of the first basket minus the second basket. A 25% EWMA reduces one-run reversals.</p>
                <p>The smoothed spread remains in native sector score points because every basket already uses the same 0-100 scoring scale. This preserves magnitude without rolling-volatility rescaling or artificial plateaus. Cyclical/defensive, broad offense/shelter, growth/reflation, and discretionary/staples expose different rotation regimes; the broad split uses all 11 sectors.</p>
              </div>
            </div>
            
            <div className="border-t border-stealth-700 pt-3">
              <h4 className="font-semibold text-stealth-100 mb-2 text-xs sm:text-sm">Classification Thresholds</h4>
              <div className="grid grid-cols-3 gap-2 sm:gap-4 text-xs">
                <div className="bg-stealth-950 p-2 sm:p-3 rounded">
                  <span className="text-green-400 font-semibold text-xs">Winner</span>
                  <p className="text-stealth-400 mt-1 text-xs">Ranks 1-3</p>
                </div>
                <div className="bg-stealth-950 p-2 sm:p-3 rounded">
                  <span className="text-stealth-400 font-semibold text-xs">Neutral</span>
                  <p className="text-stealth-400 mt-1 text-xs">Ranks 4-8</p>
                </div>
                <div className="bg-stealth-950 p-2 sm:p-3 rounded">
                  <span className="text-red-400 font-semibold text-xs">Loser</span>
                  <p className="text-stealth-400 mt-1 text-xs">Ranks 9-11</p>
                </div>
              </div>
            </div>
            
            <div className="border-t border-stealth-700 pt-3">
              <h4 className="font-semibold text-stealth-100 mb-2 text-xs sm:text-sm">Data Sources & Frequency</h4>
              <div className="text-xs sm:text-sm text-stealth-400 space-y-1">
                <p><strong>Price Data:</strong> Yahoo Finance API (adjusted close prices)</p>
                <p><strong>Lookback:</strong> 8000 trading days for 12-month calculation reliability</p>
                <p><strong>Updates:</strong> Every 4 hours during market hours (Monday-Friday, 8am-8pm ET)</p>
                <p><strong>System State:</strong> Market Diagnostic Dashboard composite indicator model</p>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mb-6 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 sm:p-4">
        <p className="text-xs sm:text-sm text-yellow-200/90 leading-relaxed">
          <strong>Disclaimer:</strong> These relative sector scores are theoretical models for educational purposes only. Not financial advice, investment recommendations, or performance guarantees. Always conduct your own research and consult a qualified financial advisor before making investment decisions.
        </p>
      </div>
    </div>
  );
}
