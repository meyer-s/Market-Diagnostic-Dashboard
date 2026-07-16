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
 * - Risk (20%): Volatility + drawdown (inverted - lower risk = higher score)
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

const HORIZONS = ["3m", "6m", "12m"];
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

interface SectorAnalyticsSignal {
  sector_symbol: string;
  sector_name: string;
  horizons: Record<string, StableHorizonSignal>;
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
  positive_symbols: string[];
  negative_symbols: string[];
  description: string;
  series: Omit<SectorHistoryPoint, "timestampNum">[];
  sample_count: number;
}

interface SectorProjectionAnalyticsResponse {
  as_of_date: string;
  analytics_version: string;
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
      <span className="w-12 sm:w-14 text-gray-400">{label}</span>
      <div className="flex-1 bg-gray-700 rounded h-2">
        <div
          className="h-2 rounded"
          style={{ width: `${value}%`, background: color }}
        ></div>
      </div>
      <span className="w-8 text-right text-gray-300 tabular-nums">{Math.round(value)}</span>
    </div>
  );
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
        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-stealth-200">
          {Math.round(value)}
        </span>
      </div>
      {metadata ? (
        <div className="mt-1 truncate text-[8px] tabular-nums text-stealth-500" title={metadata}>
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
  const { data, loading, error } = useApi<SectorProjectionsResponse>("/sectors/projections/latest");
  const {
    data: analyticsData,
    loading: analyticsLoading,
    error: analyticsError,
  } = useApi<SectorProjectionAnalyticsResponse>("/sectors/projections/analytics?days=365&scanner_days=45");
  const [projections, setProjections] = useState<Record<string, SectorProjectionItem[]>>({});
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [selectedHorizon, setSelectedHorizon] = useState<"T" | "3m" | "6m" | "12m">("12m");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedComparison, setSelectedComparison] = useState("cyclical_defensive");
  const [readingGuideOpen, setReadingGuideOpen] = useState(false);
  const pageLoading = loading || analyticsLoading;
  const pageError = error || analyticsError;
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

      // Collect scores for each horizon
      CHART_HORIZONS.forEach((h) => {
        const horizonData = displayProjections[h] || [];
        const match = horizonData.find((s) => s.sector_symbol === sector.sector_symbol);
        if (match) {
          sectorData.scores[h] = match.score_total;
          const stable = analyticsData?.sectors[sector.sector_symbol]?.horizons[h];
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
  const oscillatorRead = latestOscillator === null
    ? "Unavailable"
    : latestOscillator >= 35
      ? activeComparison?.positive_label ?? "Positive leadership"
      : latestOscillator <= -35
        ? activeComparison?.negative_label ?? "Negative leadership"
        : "Balanced leadership";
  const selectedSectorAnalytics = selectedSector ? analyticsData?.sectors[selectedSector] ?? null : null;
  const selectedSectorHistory = (selectedSectorAnalytics?.history_3m ?? []).map((point) => ({
    ...point,
    timestampNum: new Date(`${point.as_of_date}T00:00:00Z`).getTime(),
  }));
  const oscillatorComparisons = [...(analyticsData?.leadership_comparisons ?? [])].sort((a, b) => {
    if (a.key === selectedComparison) return 1;
    if (b.key === selectedComparison) return -1;
    return 0;
  });

  return (
    <div className="page-shell-narrow page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Rotation Monitor</span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Sector Projections</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Track persistent sector leadership across multiple lookback horizons, with bounded scanner confirmation and transparent scenario ranges.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
          {data && <span className="page-badge">System {data.system_state}</span>}
          {data && <span className="page-badge">As of {data.as_of_date}</span>}
        </div>
      </div>

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
      {pageError && <div className="text-red-400">Error: {pageError}</div>}
      
      {/* Sector leadership oscillator - historical trend */}
      {!pageLoading && !pageError && (
        <div className="surface-card-strong p-4 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold sm:text-lg">Sector Leadership Oscillator</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-stealth-400">
                All four rotation lenses share the same scale. Select one to emphasize it and update the summary; positive favors its first basket and negative favors its second.
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 text-xs tabular-nums sm:flex">
              <div className="rounded-lg border border-stealth-700 bg-stealth-950/40 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wide text-stealth-500">Current</div>
                <div className="mt-0.5 font-semibold text-stealth-100">{latestOscillator !== null ? latestOscillator.toFixed(0) : "—"}</div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-950/40 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wide text-stealth-500">20-run move</div>
                <div className={`mt-0.5 font-semibold ${oscillatorChange !== null && oscillatorChange >= 0 ? "text-sky-200" : "text-amber-200"}`}>
                  {oscillatorChange !== null ? `${oscillatorChange >= 0 ? "+" : ""}${oscillatorChange.toFixed(0)}` : "—"}
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
                title={`${comparison.positive_label}: ${comparison.positive_symbols.join(", ")} · ${comparison.negative_label}: ${comparison.negative_symbols.join(", ")}`}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition ${selectedComparison === comparison.key ? "border-stealth-500 bg-stealth-900/70 text-stealth-100" : "border-stealth-700 bg-stealth-950/30 text-stealth-400 hover:border-stealth-600"}`}
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
                  <AreaChart data={combinedOscillatorHistory} margin={CHART_MARGIN}>
                    <CartesianGrid {...commonGridProps} />
                    <ReferenceArea y1={35} y2={100} fill={getFamilyColor("market")} fillOpacity={0.025} />
                    <ReferenceArea y1={-100} y2={-35} fill={getFamilyColor("volatility")} fillOpacity={0.025} />
                    <ReferenceLine y={0} stroke={CHART_NEUTRAL.axis} strokeWidth={1.5} />
                    <ReferenceLine y={35} stroke={CHART_NEUTRAL.grid} strokeDasharray="3 4" />
                    <ReferenceLine y={-35} stroke={CHART_NEUTRAL.grid} strokeDasharray="3 4" />
                    <XAxis
                      dataKey="timestampNum"
                      type="number"
                      domain={[divergenceMinTime, divergenceMaxTime]}
                      ticks={divergenceTicks}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      stroke={CHART_NEUTRAL.axis}
                      tickFormatter={(value: number) =>
                        new Date(value).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                    <YAxis
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      stroke={CHART_NEUTRAL.axis}
                      domain={[-100, 100]}
                      ticks={[-100, -50, 0, 50, 100]}
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
                      formatter={(value: number, name: string) => [
                        value.toFixed(1),
                        name,
                      ]}
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
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-stealth-500">
                <span>{activeComparison?.title} · {oscillatorRead}</span>
                <span>{activeComparison?.sample_count ?? 0} observations per series · bands at ±35</span>
              </div>
            </div>
          ) : (
            <div className="surface-card-muted p-6 text-center text-xs text-stealth-400">
              No history available yet.
            </div>
          )}
        </div>
      )}
      
      
      {/* Overview Chart - Sector Score Trends Across Horizons */}
      {!pageLoading && !pageError && Object.keys(projections).length > 0 && (
        <div className="surface-card-strong p-4 sm:p-6">
          <h2 className="mb-2 text-base font-semibold sm:text-lg">Stabilized Sector Paths &amp; Scenario Envelopes</h2>
          <p className="mb-3 max-w-4xl text-xs leading-relaxed text-stealth-400">
            Center lines use a robust rolling score instead of a one-day percentile rank. Select a sector to see its observed-variability envelope; persistent rank improvement and reliable scanner breadth can tilt the envelope, while scanner impact is capped at ±{analyticsData?.scanner_coverage.max_overlay_points ?? 4} points.
          </p>
          {analyticsData ? (
            <div className={`mb-3 inline-flex rounded-md border px-2.5 py-1 text-[10px] tabular-nums ${analyticsData.scanner_coverage.classification_coverage_pct >= 70 ? "border-emerald-700/40 bg-emerald-950/20 text-emerald-200" : "border-amber-700/40 bg-amber-950/20 text-amber-200"}`}>
              Scanner mapping · {analyticsData.scanner_coverage.classified_events}/{analyticsData.scanner_coverage.total_events} events classified ({analyticsData.scanner_coverage.classification_coverage_pct.toFixed(0)}%) · {analyticsData.scanner_coverage.lookback_days}d
            </div>
          ) : null}
          {tInterpolated && (
            <p className="text-xs text-amber-300/90 mb-3">
              Some current values fall back to the stabilized 3M reading because a valid T observation is unavailable.
            </p>
          )}
          
          {/* Smooth Line Chart */}
          <div className="surface-card-muted mb-2 p-2 sm:p-4">
            <div className="w-full" style={{ aspectRatio: '2 / 1', maxHeight: '240px' }}>
              <svg width="100%" height="100%" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet">
                {/* Gradient definitions for uncertainty cones */}
                <defs>
                  {chartData.map((sector, idx) => {
                    const color = getSectorColor(sector.symbol, "muted");
                    const gradientId = `grad_${idx}`;
                    return (
                      <linearGradient key={gradientId} id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor={color} stopOpacity="0.02" />
                        <stop offset="30%" stopColor={color} stopOpacity="0.08" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.12" />
                      </linearGradient>
                    );
                  })}
                  {/* Radial gradients for fading cone edges */}
                  {chartData.map((sector, idx) => {
                    const color = getSectorColor(sector.symbol, "muted");
                    const radialId = `radial_${idx}`;
                    return (
                      <radialGradient key={radialId} id={radialId} cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor={color} stopOpacity="0.08" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                      </radialGradient>
                    );
                  })}
                </defs>
                
                {/* Grid lines */}
                {[0, 25, 50, 75, 100].map((y) => (
                  <g key={y}>
                    <line x1="50" y1={260 - (y * 2.4)} x2="960" y2={260 - (y * 2.4)} stroke={CHART_NEUTRAL.grid} strokeWidth="1" strokeDasharray="4 4" />
                    <text x="40" y={264 - (y * 2.4)} fill={CHART_NEUTRAL.tick} fontSize="10" textAnchor="end">{y}</text>
                  </g>
                ))}
                
                {/* X-axis labels */}
                <text x="150" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">T</text>
                <text x="400" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">3M</text>
                <text x="650" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">6M</text>
                <text x="900" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">12M</text>
                
                {/* Uncertainty cones and lines for each sector */}
                {chartData.map((sector, idx) => {
                  const color = getSectorColor(sector.symbol);
                  const isSelected = selectedSector === sector.symbol;
                  const opacity = !selectedSector || isSelected ? 0.7 : 0.1;
                  
                  // Stable center path plus an observed-variability scenario envelope.
                  const score3m = sector.scores["3m"] ?? 0;
                  const score6m = sector.scores["6m"] ?? 0;
                  const score12m = sector.scores["12m"] ?? 0;
                  const scoreT = sector.scores["T"] !== null && sector.scores["T"] !== undefined
                    ? sector.scores["T"]
                    : score3m;

                  const x0 = 150;      // T (Now)
                  const y0 = 260 - (scoreT * 2.4);
                  const x1 = 400;      // 3M
                  const y1 = 260 - (score3m * 2.4);
                  const x2 = 650;      // 6M
                  const y2 = 260 - (score6m * 2.4);
                  const x3 = 900;      // 12M
                  const y3 = 260 - (score12m * 2.4);
                  const upper0 = 260 - ((sector.upper["T"] ?? scoreT) * 2.4);
                  const lower0 = 260 - ((sector.lower["T"] ?? scoreT) * 2.4);
                  const upper1 = 260 - ((sector.upper["3m"] ?? score3m) * 2.4);
                  const lower1 = 260 - ((sector.lower["3m"] ?? score3m) * 2.4);
                  const upper2 = 260 - ((sector.upper["6m"] ?? score6m) * 2.4);
                  const lower2 = 260 - ((sector.lower["6m"] ?? score6m) * 2.4);
                  const upper3 = 260 - ((sector.upper["12m"] ?? score12m) * 2.4);
                  const lower3 = 260 - ((sector.lower["12m"] ?? score12m) * 2.4);
                  
                  // Future path (from T forward with uncertainty cone)
                  const pathData = `
                    M ${x0} ${y0}
                    Q ${(x0 + x1) / 2} ${(y0 + y1) / 2}, ${x1} ${y1}
                    Q ${(x1 + x2) / 2} ${(y1 + y2) / 2}, ${x2} ${y2}
                    Q ${(x2 + x3) / 2} ${(y2 + y3) / 2}, ${x3} ${y3}
                  `;
                  
                  // Create smooth uncertainty cone envelope
                  const conePathUpper = `
                    M ${x0} ${upper0}
                    Q ${(x0 + x1) / 2} ${(upper0 + upper1) / 2}, ${x1} ${upper1}
                    Q ${(x1 + x2) / 2} ${(upper1 + upper2) / 2}, ${x2} ${upper2}
                    Q ${(x2 + x3) / 2} ${(upper2 + upper3) / 2}, ${x3} ${upper3}
                  `;
                  
                  const conePathLower = `
                    M ${x0} ${lower0}
                    Q ${(x0 + x1) / 2} ${(lower0 + lower1) / 2}, ${x1} ${lower1}
                    Q ${(x1 + x2) / 2} ${(lower1 + lower2) / 2}, ${x2} ${lower2}
                    Q ${(x2 + x3) / 2} ${(lower2 + lower3) / 2}, ${x3} ${lower3}
                  `;
                  
                  return (
                    <g key={sector.symbol} onClick={() => setSelectedSector(isSelected ? null : sector.symbol)} style={{ cursor: 'pointer' }}>
                      {/* Uncertainty cone - filled area between upper and lower bounds */}
                      {isSelected && (
                        <g opacity={0.4}>
                          <path
                            d={`${conePathUpper} L ${x3} ${lower3} Q ${(x2 + x3) / 2} ${(lower2 + lower3) / 2}, ${x2} ${lower2} Q ${(x1 + x2) / 2} ${(lower1 + lower2) / 2}, ${x1} ${lower1} Q ${(x0 + x1) / 2} ${(lower0 + lower1) / 2}, ${x0} ${lower0} Z`}
                            fill={`url(#grad_${idx})`}
                          />
                        </g>
                      )}
                      
                      {/* Upper and lower cone boundaries - subtle when not selected */}
                      {isSelected && (
                        <>
                          <path 
                            d={conePathUpper}
                            stroke={color}
                            strokeWidth="1"
                            fill="none"
                            opacity={0.3}
                            strokeDasharray="3 3"
                            strokeLinecap="round"
                          />
                          <path 
                            d={conePathLower}
                            stroke={color}
                            strokeWidth="1"
                            fill="none"
                            opacity={0.3}
                            strokeDasharray="3 3"
                            strokeLinecap="round"
                          />
                        </>
                      )}
                      
                      {/* Main trend line */}
                      <path 
                        d={pathData} 
                        stroke={color} 
                        strokeWidth={isSelected ? "3.5" : "2.5"} 
                        fill="none" 
                        opacity={opacity}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
                      {/* Vertical "T" line - only show once, not per sector */}
                      {idx === 0 && (
                        <line 
                          x1={x0} 
                          y1={20} 
                          x2={x0} 
                          y2={280} 
                          stroke={getFamilyColor("benchmark")} 
                          strokeWidth="2" 
                          strokeDasharray="5 5"
                          opacity={0.4}
                        />
                      )}
                      
                      {/* Stable score anchors */}
                      <circle cx={x0} cy={y0} r={isSelected ? "5" : "4"} fill={color} opacity={opacity} stroke={idx === 0 ? getFamilyColor("benchmark") : "none"} strokeWidth="1" />
                      <circle cx={x1} cy={y1} r={isSelected ? "5" : "4"} fill={color} opacity={opacity} />
                      <circle cx={x2} cy={y2} r={isSelected ? "5" : "4"} fill={color} opacity={opacity} />
                      <circle cx={x3} cy={y3} r={isSelected ? "5" : "4"} fill={color} opacity={opacity} />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
          
          {/* Legend - Compact and scrollable */}
          <div className="mt-2 mb-4 overflow-x-auto">
            <div className="flex flex-wrap gap-1 sm:gap-2 pb-2 min-w-min">
              {chartData.map((sector) => {
                const color = getSectorColor(sector.symbol);
                const isSelected = selectedSector === sector.symbol;
                return (
                  <button
                    key={sector.symbol}
                    onClick={() => setSelectedSector(isSelected ? null : sector.symbol)}
                    className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 sm:py-2 rounded whitespace-nowrap transition-all text-xs sm:text-sm ${
                      isSelected 
                        ? 'ring-2 bg-gray-700' 
                        : 'bg-transparent hover:bg-gray-800'
                    }`}
                    style={isSelected ? { outline: `2px solid ${color}` } : {}}
                  >
                    <div style={{ width: "10px", height: "10px", backgroundColor: color, borderRadius: "2px", opacity: 0.9, flexShrink: 0 }}></div>
                    <span className={`${isSelected ? 'text-white font-semibold' : 'text-gray-400'}`}>{sector.symbol}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedSectorAnalytics && selectedSectorHistory.length > 1 ? (
            <div className="mb-4 grid gap-3 border-t border-stealth-700 pt-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="min-w-0 rounded-lg border border-stealth-800 bg-stealth-950/30 p-2.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                  <div>
                    <div className="text-xs font-semibold text-stealth-200">{selectedSectorAnalytics.sector_symbol} · observed 3M-score history</div>
                    <div className="text-[10px] text-stealth-500">Raw daily rank score versus the stabilized score used above</div>
                  </div>
                  <div className="text-[10px] text-stealth-500">{selectedSectorHistory.length} observations</div>
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={selectedSectorHistory} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid {...commonGridProps} />
                      <XAxis dataKey="timestampNum" type="number" domain={["dataMin", "dataMax"]} tick={false} axisLine={{ stroke: CHART_NEUTRAL.axis }} />
                      <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 9 }} stroke={CHART_NEUTRAL.axis} />
                      <Tooltip
                        contentStyle={commonTooltipStyle}
                        labelFormatter={(label: number) => new Date(label).toLocaleDateString()}
                        formatter={(value: number, name: string) => [value.toFixed(1), name === "stable_score" ? "Stable score" : "Raw score"]}
                      />
                      <Line type="monotone" dataKey="raw_score" stroke={CHART_NEUTRAL.tick} strokeWidth={1} strokeOpacity={0.45} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="stable_score" stroke={getSectorColor(selectedSectorAnalytics.sector_symbol)} strokeWidth={2.25} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] lg:grid-cols-1">
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
          
          {/* Top Performers by Horizon */}
          <div className="border-t border-gray-700 pt-3 mt-3">
            <h3 className="text-xs sm:text-sm font-semibold mb-2 text-gray-300">Top Performers</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-2 text-xs">
              {HORIZONS.map((h) => {
                const topSectors = (displayProjections[h] || [])
                  .sort((a, b) => a.rank - b.rank)
                  .slice(0, 3);
                return (
                  <div key={h} className="bg-gray-900 rounded p-1.5 sm:p-2">
                    <div className="text-gray-500 mb-1 font-semibold text-xs">{h.toUpperCase()}</div>
                    {topSectors.map((s, i) => (
                      <div key={s.sector_symbol} className="flex items-center gap-1 mb-0.5">
                        <span className="text-green-400 font-bold text-xs">#{i + 1}</span>
                        <span className="text-gray-300 truncate text-xs">{s.sector_symbol}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Detailed Tables with Horizon Selector */}
      {(displayProjections[selectedHorizon === "T" ? "T" : selectedHorizon] || selectedHorizon === "T") && (
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4">
            <h2 className="text-base sm:text-lg font-semibold">Sector Rankings</h2>
            <div className="flex flex-wrap gap-1 sm:gap-2">
              {["T", "3m", "6m", "12m"].map((h) => {
                if (h === "T" && !tScoresValid) return null;
                return (
                  <button
                    key={h}
                    onClick={() => setSelectedHorizon(h as "T" | "3m" | "6m" | "12m")}
                    className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition min-h-10 ${
                      selectedHorizon === h
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {h === "T" ? "T" : h === "3m" ? "T+3M" : h === "6m" ? "T+6M" : "T+12M"}
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
          
          <div className="overflow-hidden rounded-lg bg-gray-800 shadow">
            <div className="hidden md:block">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[5%]" />
                  <col className="w-[25%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-stealth-700 bg-stealth-900/40 text-[10px] uppercase tracking-wide text-stealth-500">
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Sector</th>
                    <th className="px-2 py-2 text-left">Stable score</th>
                    <th className="px-2 py-2 text-left">Type</th>
                    <th className="px-2 py-2 text-left">Trend</th>
                    <th className="px-2 py-2 text-left">Rel</th>
                    <th className="px-2 py-2 text-left">Risk</th>
                    <th className="px-2 py-2 text-left">Regime</th>
                  </tr>
                </thead>
                <tbody>
                  {(displayProjections[selectedHorizon])?.sort((a, b) => a.rank - b.rank).map((row) => (
                    <tr key={row.sector_symbol} className={`border-b border-stealth-800/70 last:border-b-0 ${
                      row.classification === "Winner"
                        ? "bg-green-900/30"
                        : row.classification === "Loser"
                        ? "bg-red-900/20"
                        : ""
                    }`}>
                      <td className="px-2 py-1.5 align-middle tabular-nums text-stealth-300">{row.rank}</td>
                      <td className="min-w-0 px-2 py-1.5 align-middle">
                        <div className="truncate font-medium text-stealth-100" title={`${row.sector_name} (${row.sector_symbol})`}>
                          {row.sector_name}
                        </div>
                        <div className="text-[9px] text-stealth-500">{row.sector_symbol}</div>
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
                            : "text-gray-400"
                        }>
                          {row.classification}
                        </span>
                      </td>
                      <td className="px-2 py-1 align-middle"><CompactScoreBar value={row.score_trend} color={scoreBarColors.trend} /></td>
                      <td className="px-2 py-1 align-middle"><CompactScoreBar value={row.score_rel} color={scoreBarColors.rel} /></td>
                      <td className="px-2 py-1 align-middle"><CompactScoreBar value={row.score_risk} color={scoreBarColors.risk} /></td>
                      <td className="px-2 py-1 align-middle"><CompactScoreBar value={row.score_regime} color={scoreBarColors.regime} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 p-4 md:hidden sm:space-y-3">
              {(selectedHorizon === "T" ? displayProjections["T"] : displayProjections[selectedHorizon])?.sort((a, b) => a.rank - b.rank).map((row) => (
                <div
                  key={row.sector_symbol}
                  className={`rounded-lg border border-gray-700 overflow-hidden ${
                    row.classification === "Winner"
                      ? "bg-green-900/20"
                      : row.classification === "Loser"
                      ? "bg-red-900/20"
                      : "bg-gray-900/40"
                  }`}
                >
                  <button
                    onClick={() => setExpandedCard(expandedCard === row.sector_symbol ? null : row.sector_symbol)}
                    className="w-full p-2 sm:p-3 flex items-start justify-between gap-2 sm:gap-3 hover:bg-black/20 transition-colors"
                    aria-expanded={expandedCard === row.sector_symbol}
                  >
                    <div className="text-left">
                      <div className="text-xs sm:text-sm font-semibold text-gray-100">
                        #{row.rank} {row.sector_name}
                      </div>
                      <div className="text-xs text-gray-500">{row.sector_symbol}</div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <span className={
                        row.classification === "Winner"
                          ? "text-green-400 text-xs font-semibold"
                          : row.classification === "Loser"
                          ? "text-red-400 text-xs font-semibold"
                          : "text-gray-400 text-xs font-semibold"
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
                    <ScoreBar label="Total" value={row.score_total} color={scoreBarColors.total} />
                    {row.raw_score !== undefined ? (
                      <div className="mt-1 text-right text-[9px] text-stealth-500">
                        raw {row.raw_score.toFixed(0)} · scanner {row.scanner_overlay !== undefined && row.scanner_overlay >= 0 ? "+" : ""}{row.scanner_overlay?.toFixed(1) ?? "0.0"}
                      </div>
                    ) : null}
                  </div>
                  <div className={`collapsible-panel ${expandedCard === row.sector_symbol ? 'collapsible-panel-open' : ''}`}>
                    <div className="collapsible-panel-inner">
                      <div className="border-t border-gray-700 bg-black/20 p-3 space-y-2">
                        <ScoreBar label="Trend" value={row.score_trend} color={scoreBarColors.trend} />
                        <ScoreBar label="Rel" value={row.score_rel} color={scoreBarColors.rel} />
                        <ScoreBar label="Risk" value={row.score_risk} color={scoreBarColors.risk} />
                        <ScoreBar label="Regime" value={row.score_regime} color={scoreBarColors.regime} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* How to Read This Chart */}
      <div className="mb-6">
        <button
          onClick={() => setReadingGuideOpen(!readingGuideOpen)}
          className="w-full bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 sm:p-4 text-left hover:bg-blue-900/30 transition"
          aria-expanded={readingGuideOpen}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-semibold text-blue-200">How to Read This Chart</h3>
            <span className={`collapsible-icon ${readingGuideOpen ? 'collapsible-icon-open' : ''} border-blue-700/50 bg-blue-950/30 text-blue-300`} aria-hidden="true">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </div>
        </button>
        <div className={`collapsible-panel ${readingGuideOpen ? 'collapsible-panel-open' : ''}`}>
          <div className="collapsible-panel-inner">
            <div className="bg-blue-900/20 border border-blue-700/50 border-t-0 rounded-b-lg p-3 sm:p-4 text-xs sm:text-sm text-blue-200/80 space-y-2 leading-relaxed">
              <p><strong>Oscillator:</strong> Positive readings favor the first basket named in the selected comparison; negative readings favor the second. The ±35 zones are visual leadership thresholds, not statistical significance tests.</p>
              <p><strong>Stable Score (0-100):</strong> The displayed rank blends a rolling EWMA, a five-run median, and the latest raw score. This reduces one-day percentile jumps without hiding the raw reading.</p>
              <p><strong>Scenario Envelope:</strong> The selected sector's band uses observed 20-run score variability. Persistent rank improvement and reliable directional scanner breadth can skew the band, but it is not a probability confidence interval.</p>
              <p><strong>Scanner Overlay:</strong> Calls and puts are deduplicated by symbol, day, and side; breadth, recency, and opportunity rank determine reliability. The overlay is capped at ±4 points and decays beyond 3M.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Methodology Explanation - Collapsible */}
      <div className="mb-6 bg-gray-800 rounded-lg shadow">
        <button
          onClick={() => setMethodologyOpen(!methodologyOpen)}
          className="w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between hover:bg-gray-750 transition-colors rounded-lg"
          aria-expanded={methodologyOpen}
        >
          <h2 className="text-base sm:text-lg font-semibold">Methodology & Algorithm Details</h2>
          <span className={`collapsible-icon ${methodologyOpen ? 'collapsible-icon-open' : ''}`} aria-hidden="true">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>
        <div className={`collapsible-panel ${methodologyOpen ? 'collapsible-panel-open' : ''}`}>
          <div className="collapsible-panel-inner">
            <div className="px-4 sm:px-6 pb-6 text-xs sm:text-sm text-gray-300 space-y-5">
            <div>
              <h3 className="font-semibold text-gray-100 mb-3 text-sm sm:text-base">Transparent Rule-Based Scoring</h3>
              <p className="text-gray-400 mb-2 text-xs sm:text-sm">
                Ranks 11 sector ETFs (XLE, XLF, XLK, XLY, XLP, XLV, XLI, XLU, XLB, XLRE, XLC) using 8000 days of historical data. Each sector receives a composite score (0-100) from four weighted components.
              </p>
              <p className="text-gray-400 text-xs sm:text-sm">
                Computed independently for 3-month (63 days), 6-month (126 days), and 12-month (252 days) horizons.
              </p>
            </div>
            
            <div className="border-t border-gray-700 pt-4">
              <h3 className="font-semibold text-gray-100 mb-3 text-sm sm:text-base">Component Calculations</h3>
              
              <div className="space-y-4">
                <div className="bg-gray-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-yellow-400 mb-2 text-xs sm:text-sm">1. Trend Score (45% weight)</h4>
                  <p className="text-xs text-gray-400 mb-2">
                    Measures price momentum and technical positioning relative to moving averages.
                  </p>
                  <div className="text-xs text-gray-400 space-y-1 ml-3">
                    <p><strong>Return:</strong> Total return over the horizon period: (Price_end / Price_start) - 1</p>
                    <p><strong>SMA Distance:</strong> Distance from 200-day simple moving average: (Price_current / SMA_200) - 1</p>
                    <p><strong>Composite:</strong> Return + (0.5 x SMA Distance), then percentile-ranked across all sectors and scaled to 0-100</p>
                  </div>
                </div>
                
                <div className="bg-gray-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-lime-400 mb-2 text-xs sm:text-sm">2. Relative Strength Score (30% weight)</h4>
                  <p className="text-xs text-gray-400 mb-2">
                    Quantifies outperformance versus the broad market (SPY) over the same period.
                  </p>
                  <div className="text-xs text-gray-400 space-y-1 ml-3">
                    <p><strong>Calculation:</strong> Sector Return - SPY Return (both measured over the horizon)</p>
                    <p><strong>Normalization:</strong> Percentile-ranked across sectors and scaled to 0-100</p>
                    <p>Higher scores indicate sectors beating the market; lower scores indicate underperformance</p>
                  </div>
                </div>
                
                <div className="bg-gray-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-red-400 mb-2 text-xs sm:text-sm">3. Risk Score (20% weight, inverted)</h4>
                  <p className="text-xs text-gray-400 mb-2">
                    Evaluates price stability and downside protection. Lower risk = higher score (inverse ranking).
                  </p>
                  <div className="text-xs text-gray-400 space-y-1 ml-3">
                    <p><strong>Realized Volatility:</strong> 20-day rolling standard deviation of daily returns, annualized (x sqrt252)</p>
                    <p><strong>Max Drawdown:</strong> Largest peak-to-trough decline over the full horizon period</p>
                    <p><strong>Composite:</strong> Volatility + (0.5 x |Drawdown|), inverted percentile rank scaled to 0-100</p>
                    <p>Sectors with lower volatility and smaller drawdowns receive higher risk scores</p>
                  </div>
                </div>
                
                <div className="bg-gray-900 rounded p-3 sm:p-4">
                  <h4 className="font-semibold text-indigo-400 mb-2 text-xs sm:text-sm">4. Regime Adjustment (5% weight)</h4>
                  <p className="text-xs text-gray-400 mb-2">
                    Context-aware modifier based on the current system state (RED/YELLOW/GREEN market environment).
                  </p>
                  <div className="text-xs text-gray-400 space-y-1 ml-3">
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
            
            <div className="border-t border-gray-700 pt-4">
              <h3 className="font-semibold text-gray-100 mb-3 text-sm sm:text-base">Final Score & Ranking</h3>
              <div className="text-xs sm:text-sm text-gray-400 space-y-2">
                <p className="font-mono bg-gray-950 p-2 rounded text-xs">
                  Composite Score = (0.45 x Trend) + (0.30 x Rel_Strength) + (0.20 x Risk) + (0.05 x Regime)
                </p>
                <p className="text-xs sm:text-sm">
                  The raw score remains auditable. Displayed ranks use 55% EWMA, 30% five-run median, and 15% latest raw score, followed by a reliability-gated scanner overlay capped at ±4 points.
                </p>
              </div>
            </div>
            
            <div className="border-t border-gray-700 pt-4">
              <h3 className="font-semibold text-gray-100 mb-3 text-sm sm:text-base">Scanner Confirmation &amp; Scenario Envelopes</h3>
              <p className="text-xs sm:text-sm text-gray-400 mb-3">
                Scanner evidence confirms or challenges the price-based path without becoming the primary model.
              </p>
              <div className="text-xs sm:text-sm text-gray-400 space-y-2">
                <p><strong>Scanner input:</strong> Direction comes from selected calls versus puts. Duplicate symbol/day/side events are collapsed, then recency, unique-name breadth, distinct days, and opportunity rank determine reliability.</p>
                <p><strong>Bounded influence:</strong> Scanner evidence can move the 3M stabilized score by no more than four points; influence decays by half at 6M and to one quarter at 12M.</p>
                <p><strong>Envelope width:</strong> Uses the sector's observed score variability over the latest 20 valid runs, expanding with the horizon.</p>
                <p><strong>Envelope skew:</strong> Repeated rank improvement and reliable bullish scanner breadth allow more upside room; weakening persistence or bearish breadth does the reverse.</p>
                <p><strong>Important:</strong> The envelope is a transparent scenario range, not a calibrated probability confidence interval.</p>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-4">
              <h3 className="font-semibold text-gray-100 mb-3 text-sm sm:text-base">Leadership Oscillators</h3>
              <div className="text-xs sm:text-sm text-gray-400 space-y-2">
                <p>Each oscillator starts with the average daily 3M score of the first basket minus the second basket. A 25% EWMA reduces one-run reversals.</p>
                <p>The smoothed spread is normalized against its rolling 60-run variability and bounded from -100 to +100. Cyclical/defensive, broad offense/shelter, growth/reflation, and discretionary/staples expose different rotation regimes; the broad split uses all 11 sectors.</p>
              </div>
            </div>
            
            <div className="border-t border-gray-700 pt-3">
              <h4 className="font-semibold text-gray-100 mb-2 text-xs sm:text-sm">Classification Thresholds</h4>
              <div className="grid grid-cols-3 gap-2 sm:gap-4 text-xs">
                <div className="bg-gray-950 p-2 sm:p-3 rounded">
                  <span className="text-green-400 font-semibold text-xs">Winner</span>
                  <p className="text-gray-400 mt-1 text-xs">Ranks 1-3</p>
                </div>
                <div className="bg-gray-950 p-2 sm:p-3 rounded">
                  <span className="text-gray-400 font-semibold text-xs">Neutral</span>
                  <p className="text-gray-400 mt-1 text-xs">Ranks 4-8</p>
                </div>
                <div className="bg-gray-950 p-2 sm:p-3 rounded">
                  <span className="text-red-400 font-semibold text-xs">Loser</span>
                  <p className="text-gray-400 mt-1 text-xs">Ranks 9-11</p>
                </div>
              </div>
            </div>
            
            <div className="border-t border-gray-700 pt-3">
              <h4 className="font-semibold text-gray-100 mb-2 text-xs sm:text-sm">Data Sources & Frequency</h4>
              <div className="text-xs sm:text-sm text-gray-400 space-y-1">
                <p><strong>Price Data:</strong> Yahoo Finance API (adjusted close prices)</p>
                <p><strong>Lookback:</strong> 8000 trading days for 12-month calculation reliability</p>
                <p><strong>Updates:</strong> Every 4 hours during market hours (Monday-Friday, 8am-8pm ET)</p>
                <p><strong>System State:</strong> Market Stability Dashboard composite indicator model</p>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mb-6 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 sm:p-4">
        <p className="text-xs sm:text-sm text-yellow-200/90 leading-relaxed">
          <strong>Disclaimer:</strong> These projections are theoretical models for educational purposes only. Not financial advice, investment recommendations, or performance guarantees. Always conduct your own research and consult a qualified financial advisor before making investment decisions.
        </p>
      </div>
    </div>
  );
}
