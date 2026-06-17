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
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
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
const DEFENSIVE_SECTORS = new Set(["XLU", "XLP", "XLV"]);
const CYCLICAL_SECTORS = new Set(["XLE", "XLF", "XLK", "XLY"]);
const getSectorColor = (
  symbol: string,
  variant: "base" | "muted" | "faint" = "base"
) => getMetricColor(symbol, variant);

interface SectorHistoryEntry {
  as_of_date: string;
  created_at?: string | null;
  run_id?: number | null;
  score_total: number;
  data_warnings?: DataWarning[];
  quality_status?: string;
}

type SectorProjectionHistory = Record<string, Record<string, SectorHistoryEntry[]>>;

interface SectorHistoryPoint {
  as_of_date: string;
  timestampNum: number;
  defensive_avg: number;
  cyclical_avg: number;
  spread: number;
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

function isFlaggedHistoryEntry(entry: SectorHistoryEntry) {
  return entry.quality_status === "blocked" || hasBlockingDataWarnings(entry.data_warnings);
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
  const { data: historyData } = useApi("/sectors/projections/history?days=365");
  const [projections, setProjections] = useState<Record<string, SectorProjectionItem[]>>({});
  const [historicalScores, setHistoricalScores] = useState<Record<string, number>>({});
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [selectedHorizon, setSelectedHorizon] = useState<"T" | "3m" | "6m" | "12m">("12m");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [readingGuideOpen, setReadingGuideOpen] = useState(false);
  const divergenceHistory = useMemo(() => {
    const history = historyData as SectorProjectionHistory | null;
    if (!history) return [];
    const buckets = new Map<string, { defensive: number[]; cyclical: number[] }>();

    Object.entries(history).forEach(([symbol, horizons]) => {
      const entries = horizons?.["3m"];
      if (!entries) return;
      const isDefensive = DEFENSIVE_SECTORS.has(symbol);
      const isCyclical = CYCLICAL_SECTORS.has(symbol);
      if (!isDefensive && !isCyclical) return;

      entries.filter((entry) => !isFlaggedHistoryEntry(entry)).forEach((entry) => {
        if (!Number.isFinite(entry.score_total)) return;
        const dateKey = entry.as_of_date;
        if (!buckets.has(dateKey)) {
          buckets.set(dateKey, { defensive: [], cyclical: [] });
        }
        const bucket = buckets.get(dateKey)!;
        if (isDefensive) bucket.defensive.push(entry.score_total);
        if (isCyclical) bucket.cyclical.push(entry.score_total);
      });
    });

    const points: SectorHistoryPoint[] = [];
    for (const [dateKey, bucket] of buckets.entries()) {
      if (!bucket.defensive.length || !bucket.cyclical.length) continue;
      const defensiveAvg = bucket.defensive.reduce((sum, val) => sum + val, 0) / bucket.defensive.length;
      const cyclicalAvg = bucket.cyclical.reduce((sum, val) => sum + val, 0) / bucket.cyclical.length;
      points.push({
        as_of_date: dateKey,
        timestampNum: new Date(`${dateKey}T00:00:00Z`).getTime(),
        defensive_avg: Number(defensiveAvg.toFixed(2)),
        cyclical_avg: Number(cyclicalAvg.toFixed(2)),
        spread: Number((defensiveAvg - cyclicalAvg).toFixed(2)),
      });
    }

    return points.sort((a, b) => a.timestampNum - b.timestampNum);
  }, [historyData]);
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
      setHistoricalScores(data.historical || {});
      
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

  // Prepare data for line chart: track each sector's score across horizons
  const getChartData = () => {
    if (!projections["3m"]) return [];
    
    // Get all unique sectors from 3m data (use 3m as reference since it should always exist)
    const sectors = projections["3m"] || [];
    
    return sectors.map((sector) => {
      const sectorData: ChartDataPoint = {
        name: sector.sector_name,
        symbol: sector.sector_symbol,
        scores: {},
      };

      // Collect scores for each horizon
      CHART_HORIZONS.forEach((h) => {
        const horizonData = projections[h] || [];
        const match = horizonData.find((s) => s.sector_symbol === sector.sector_symbol);
        if (match) {
          sectorData.scores[h] = match.score_total;
        } else {
          // If no data for this horizon, use null to indicate missing data
          sectorData.scores[h] = null;
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
  const divergenceTimestamps = divergenceHistory.map((point) => point.timestampNum);
  const divergenceMinTime = divergenceTimestamps.length ? Math.min(...divergenceTimestamps) : 0;
  const divergenceMaxTime = divergenceTimestamps.length ? Math.max(...divergenceTimestamps) : 0;
  const divergenceTicks = divergenceTimestamps.length > 1
    ? Array.from({ length: 5 }, (_, i) => divergenceMinTime + ((divergenceMaxTime - divergenceMinTime) * (i / 4)))
    : divergenceTimestamps;

  return (
    <div className="page-shell-narrow page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Rotation Monitor</span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Sector Projections</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Identify sector leadership across multiple time horizons with quantified confidence levels.</p>
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
      
      {loading && (
        <div className="flex justify-center py-6">
          <MarketLoading size={110} variant="scan" label="Loading sector projections..." />
        </div>
      )}
      {error && <div className="text-red-400">Error: {error}</div>}
      
      {/* Defensive vs Cyclical Spread - Historical Trend */}
      {!loading && !error && (
        <div className="surface-card-strong p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-2">Defensive vs Cyclical Spread</h2>
          <p className="mb-4 text-xs text-stealth-400">
            Rolling history of the defensive minus cyclical average (3M projection scores).
          </p>
          {divergenceHistory.length > 0 ? (
            <div className="surface-card-muted p-2 sm:p-4">
              <div className="h-44 sm:h-56">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={divergenceHistory} margin={CHART_MARGIN}>
                    <CartesianGrid {...commonGridProps} />
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
                      domain={["dataMin - 5", "dataMax + 5"]}
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
                      formatter={(value: number) => [`${value.toFixed(2)}`, "Spread"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="spread"
                      stroke={getFamilyColor("market")}
                      strokeWidth={2}
                      dot={false}
                      animationDuration={CHART_ANIMATION.duration}
                      animationEasing={CHART_ANIMATION.easing}
                    />
                  </LineChart>
                </ResponsiveContainer>
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
      {!loading && !error && Object.keys(projections).length > 0 && (
        <div className="surface-card-strong p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-3">Sector Score Trends Across Time Horizons</h2>
          <p className="mb-3 text-xs text-stealth-400">Each line shows how a sector's composite score evolves from current to forward projections</p>
          {tInterpolated && (
            <p className="text-xs text-amber-300/90 mb-3">
              Note: Some T values are estimated from historical and 3M data due to missing current readings.
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
                <text x="150" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">-3M</text>
                <text x="350" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">T</text>
                <text x="550" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">3M</text>
                <text x="725" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">6M</text>
                <text x="900" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">12M</text>
                
                {/* Uncertainty cones and lines for each sector */}
                {chartData.map((sector, idx) => {
                  const color = getSectorColor(sector.symbol);
                  const isSelected = selectedSector === sector.symbol;
                  const opacity = !selectedSector || isSelected ? 0.7 : 0.1;
                  
                  // Calculate points - 5 data points: -3M, T(now), 3M, 6M, 12M
                  // Use real historical score from backend, fallback to estimation if unavailable
                  const score3m = sector.scores["3m"] ?? 0;
                  const score6m = sector.scores["6m"] ?? 0;
                  const score12m = sector.scores["12m"] ?? 0;
                  const histScore = historicalScores[sector.symbol] !== undefined
                    ? historicalScores[sector.symbol]
                    : score3m - 8; // Fallback estimation

                  // For T (current), use data if available, otherwise interpolate from historical and 3m
                  const scoreT = sector.scores["T"] !== null && sector.scores["T"] !== undefined
                    ? sector.scores["T"]
                    : histScore + ((score3m - histScore) / 2); // Interpolate midpoint

                  const xHist = 150;   // -3M
                  const yHist = 260 - (histScore * 2.4);
                  const x0 = 350;      // T (Now)
                  const y0 = 260 - (scoreT * 2.4);
                  const x1 = 550;      // 3M
                  const y1 = 260 - (score3m * 2.4);
                  const x2 = 725;      // 6M
                  const y2 = 260 - (score6m * 2.4);
                  const x3 = 900;      // 12M
                  const y3 = 260 - (score12m * 2.4);

                  // Calculate expanding uncertainty cone starting from now
                  // Uncertainty grows progressively and smoothly
                  const initialSigma = 2; // Small initial uncertainty at "now"
                  const midSigma = Math.abs(score6m - score3m) * 0.3 + 5;
                  const finalSigma = Math.abs(score12m - score6m) * 0.4 + 8;
                  
                  // Create smooth cone envelope by calculating bounds at each point
                  const sigma0 = initialSigma;
                  const sigma1 = midSigma * 0.4;
                  const sigma2 = midSigma * 0.85;
                  const sigma3 = finalSigma;
                  
                  const upper0 = y0 - (sigma0 * 2.4);
                  const lower0 = y0 + (sigma0 * 2.4);
                  const upper1 = y1 - (sigma1 * 2.4);
                  const lower1 = y1 + (sigma1 * 2.4);
                  const upper2 = y2 - (sigma2 * 2.4);
                  const lower2 = y2 + (sigma2 * 2.4);
                  const upper3 = y3 - (sigma3 * 2.4);
                  const lower3 = y3 + (sigma3 * 2.4);
                  
                  // Historical path (solid, no cone, -3M to T)
                  const historicalPath = `
                    M ${xHist} ${yHist}
                    Q ${(xHist + x0) / 2} ${(yHist + y0) / 2}, ${x0} ${y0}
                  `;
                  
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
                      {/* Historical line (solid, no cone, -3M to T) */}
                      <path 
                        d={historicalPath} 
                        stroke={color} 
                        strokeWidth={isSelected ? "3" : "2"} 
                        fill="none" 
                        opacity={opacity * 1.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
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
                      
                      {/* Points - 5 data points */}
                      <circle cx={xHist} cy={yHist} r={isSelected ? "4" : "3"} fill={color} opacity={opacity * 0.9} />
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
          
          {/* Top Performers by Horizon */}
          <div className="border-t border-gray-700 pt-3 mt-3">
            <h3 className="text-xs sm:text-sm font-semibold mb-2 text-gray-300">Top Performers</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-2 text-xs">
              {HORIZONS.map((h) => {
                const topSectors = (projections[h] || [])
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
      {(projections[selectedHorizon === "T" ? "T" : selectedHorizon] || selectedHorizon === "T") && (
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
          
          <div className="bg-gray-800 rounded-lg p-4 shadow">
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left">Rank</th>
                    <th className="text-left">Sector</th>
                    <th className="text-left">Score</th>
                    <th className="text-left">Type</th>
                    <th className="text-left">Trend</th>
                    <th className="text-left">Rel</th>
                    <th className="text-left">Risk</th>
                    <th className="text-left">Regime</th>
                  </tr>
                </thead>
                <tbody>
                  {(projections[selectedHorizon])?.sort((a, b) => a.rank - b.rank).map((row) => (
                    <tr key={row.sector_symbol} className={
                      row.classification === "Winner"
                        ? "bg-green-900/30"
                        : row.classification === "Loser"
                        ? "bg-red-900/20"
                        : ""
                    }>
                      <td>{row.rank}</td>
                      <td>{row.sector_name} <span className="text-xs text-gray-500">({row.sector_symbol})</span></td>
                      <td>
                        <ScoreBar label="" value={row.score_total} color={scoreBarColors.total} />
                      </td>
                      <td>
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
                      <td><ScoreBar label="" value={row.score_trend} color={scoreBarColors.trend} /></td>
                      <td><ScoreBar label="" value={row.score_rel} color={scoreBarColors.rel} /></td>
                      <td><ScoreBar label="" value={row.score_risk} color={scoreBarColors.risk} /></td>
                      <td><ScoreBar label="" value={row.score_regime} color={scoreBarColors.regime} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-2 sm:space-y-3">
              {(selectedHorizon === "T" ? projections["T"] : projections[selectedHorizon])?.sort((a, b) => a.rank - b.rank).map((row) => (
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
              <p><strong>Score (0-100):</strong> Higher scores indicate stronger technical outlook based on trend, relative strength vs SPY, risk metrics, and market regime alignment. Compare sectors vertically-higher is better.</p>
              <p><strong>Score Changes:</strong> Lines moving up show improving outlook; lines moving down show deteriorating conditions. Crossing lines indicate sector rotation.</p>
              <p><strong>Uncertainty Cones (Click a Sector):</strong> The shaded area shows confidence range based on score divergence. Larger gaps create wider cones; smaller gaps keep them tighter.</p>
              <p><strong>Historical (-3M):</strong> Score from 3 months ago, or estimated offset to preserve trend shape.</p>
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
                  Sectors ranked 1-11 by composite score (descending) using minimum rank method for ties.
                </p>
              </div>
            </div>
            
            <div className="border-t border-gray-700 pt-4">
              <h3 className="font-semibold text-gray-100 mb-3 text-sm sm:text-base">Uncertainty Cones</h3>
              <p className="text-xs sm:text-sm text-gray-400 mb-3">
                Interactive projection confidence intervals visualized as expanding "uncertainty cones" for each sector.
              </p>
              <div className="text-xs sm:text-sm text-gray-400 space-y-2">
                <p><strong>What they represent:</strong> Cone boundary shows range of possible scores based on score volatility across projection horizons (3M, 6M, 12M).</p>
                <p><strong>How they expand:</strong> Cone starts narrow at current date (high confidence) and widens toward longer horizons (lower confidence).</p>
                <p><strong>Calculating width:</strong> Width scales with absolute score changes between 3M, 6M, and 12M projections.</p>
                <p><strong>Interpreting:</strong> Wide cone = higher projection uncertainty; narrow cone = more stable positioning.</p>
                <p><strong>Interactive selection:</strong> Click sector line or legend item to isolate that sector and highlight its uncertainty cone.</p>
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
