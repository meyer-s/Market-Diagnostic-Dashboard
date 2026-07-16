/**
 * Compact dashboard view of the stabilized sector-rotation analytics.
 *
 * The detailed Sector Rotation page owns the full four-lens comparison and
 * forward scenarios. This widget answers three faster questions: who leads
 * now, how leadership is moving, and how broad that move is.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getLegacyApiUrl } from "../../utils/apiUtils";
import {
  CHART_ANIMATION,
  CHART_MARGIN,
  CHART_NEUTRAL,
  commonGridProps,
  commonTooltipStyle,
} from "../../utils/chartUtils";
import { getFamilyColor } from "../../theme/metricColors";
import {
  analyzeSeries,
  getConfidenceFromSignal,
  type InsightSignal,
} from "../../utils/insightUtils";

interface SectorLatestResponse {
  as_of_date: string;
  model_version: string;
  system_state: string;
  quality_status?: string;
  data_warnings?: Array<{ type: string }>;
}

interface LeadershipPoint {
  as_of_date: string;
  positive_avg: number;
  negative_avg: number;
  raw_spread: number;
  smoothed_spread: number;
  oscillator: number;
}

interface LeadershipComparison {
  key: string;
  title: string;
  positive_label: string;
  negative_label: string;
  positive_axis_label: string;
  negative_axis_label: string;
  description: string;
  sample_count: number;
  series: LeadershipPoint[];
}

interface SectorAnalyticsSignal {
  sector_symbol: string;
  sector_name: string;
  horizons: Record<string, {
    stable_score: number;
    stable_rank: number;
  }>;
  persistence: {
    direction: "improving" | "stable" | "weakening";
  };
}

interface SectorAnalyticsResponse {
  as_of_date: string;
  analytics_version: string;
  leadership_band: number;
  sectors: Record<string, SectorAnalyticsSignal>;
  leadership_comparisons: LeadershipComparison[];
}

interface Props {
  trendPeriod?: 90 | 180 | 365;
  onInsight?: (insight: InsightSignal) => void;
}

interface ChartPoint extends LeadershipPoint {
  timestampNum: number;
}

const PRIMARY_COMPARISON = "cyclical_defensive";

function latestComparisonValue(comparison: LeadershipComparison): number | null {
  const value = comparison.series[comparison.series.length - 1]?.oscillator;
  return Number.isFinite(value) ? value : null;
}

function formatLeadershipValue(value: number | null, comparison: LeadershipComparison) {
  if (value === null) return "Unavailable";
  if (Math.abs(value) < 2) return "Balanced";
  const leader = value > 0 ? comparison.positive_axis_label : comparison.negative_axis_label;
  return `${leader} +${Math.abs(value).toFixed(1)}`;
}

function getLeadershipRead(value: number | null, band: number, comparison: LeadershipComparison) {
  if (value === null) {
    return { title: "Leadership unavailable", description: "No valid oscillator history", color: "text-stealth-400" };
  }
  if (value >= band) {
    return { title: comparison.positive_label, description: `${comparison.positive_axis_label} leadership is above the clear-signal band`, color: "text-cyan-300" };
  }
  if (value <= -band) {
    return { title: comparison.negative_label, description: `${comparison.negative_axis_label} leadership is above the clear-signal band`, color: "text-violet-300" };
  }
  if (value > 2) {
    return { title: `Balanced, leaning ${comparison.positive_axis_label.toLowerCase()}`, description: "The tilt remains inside the clear-leadership band", color: "text-stealth-200" };
  }
  if (value < -2) {
    return { title: `Balanced, leaning ${comparison.negative_axis_label.toLowerCase()}`, description: "The tilt remains inside the clear-leadership band", color: "text-stealth-200" };
  }
  return { title: "Balanced rotation", description: "Neither basket has a meaningful leadership edge", color: "text-stealth-200" };
}

export default function SectorDivergenceWidget({ trendPeriod = 90, onInsight }: Props) {
  const [latest, setLatest] = useState<SectorLatestResponse | null>(null);
  const [analytics, setAnalytics] = useState<SectorAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = getLegacyApiUrl();
        const [latestResponse, analyticsResponse] = await Promise.all([
          fetch(`${apiUrl}/sectors/projections/latest`, { signal: controller.signal }),
          fetch(`${apiUrl}/sectors/projections/analytics?days=365&scanner_days=45`, { signal: controller.signal }),
        ]);
        if (!latestResponse.ok || !analyticsResponse.ok) {
          throw new Error("Sector rotation data is unavailable");
        }
        const [latestPayload, analyticsPayload] = await Promise.all([
          latestResponse.json() as Promise<SectorLatestResponse>,
          analyticsResponse.json() as Promise<SectorAnalyticsResponse>,
        ]);
        setLatest(latestPayload);
        setAnalytics(analyticsPayload);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        console.error("Failed to fetch sector rotation data:", requestError);
        setError(requestError instanceof Error ? requestError.message : "Sector rotation data is unavailable");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void fetchData();
    return () => controller.abort();
  }, []);

  const primaryComparison = analytics?.leadership_comparisons.find(
    (comparison) => comparison.key === PRIMARY_COMPARISON
  ) ?? analytics?.leadership_comparisons[0] ?? null;
  const leadershipBand = analytics?.leadership_band ?? 15;

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!primaryComparison?.series.length) return [];
    const allPoints = primaryComparison.series.map((point) => ({
      ...point,
      timestampNum: new Date(`${point.as_of_date}T00:00:00Z`).getTime(),
    }));
    const latestTimestamp = allPoints[allPoints.length - 1].timestampNum;
    const cutoff = latestTimestamp - trendPeriod * 24 * 60 * 60 * 1000;
    return allPoints.filter((point) => point.timestampNum >= cutoff);
  }, [primaryComparison, trendPeriod]);

  const latestOscillator = primaryComparison ? latestComparisonValue(primaryComparison) : null;
  const priorOscillator = primaryComparison?.series.length
    ? primaryComparison.series[Math.max(0, primaryComparison.series.length - 21)]?.oscillator ?? null
    : null;
  const oscillatorShift = latestOscillator !== null && priorOscillator !== null
    ? latestOscillator - priorOscillator
    : null;
  const interpretation = primaryComparison
    ? getLeadershipRead(latestOscillator, leadershipBand, primaryComparison)
    : null;

  const persistenceCounts = useMemo(() => {
    const counts = { improving: 0, stable: 0, weakening: 0 };
    Object.values(analytics?.sectors ?? {}).forEach((sector) => {
      counts[sector.persistence.direction] += 1;
    });
    return counts;
  }, [analytics]);

  const leaders = useMemo(() => {
    return Object.values(analytics?.sectors ?? {})
      .filter((sector) => sector.horizons["3m"])
      .sort((a, b) => a.horizons["3m"].stable_rank - b.horizons["3m"].stable_rank)
      .slice(0, 3);
  }, [analytics]);

  const sectorInsight = useMemo<InsightSignal | null>(() => {
    if (!primaryComparison || latestOscillator === null) return null;
    const values = primaryComparison.series.map((point) => point.oscillator);
    const comparisonWindow = Math.max(2, Math.min(10, Math.floor(values.length / 2)));
    const trendSignal = analyzeSeries(values, { recent: comparisonWindow, prior: comparisonWindow });
    const primaryDirection = latestOscillator >= leadershipBand
      ? "up"
      : latestOscillator <= -leadershipBand
        ? "down"
        : "flat";
    const secondaryDirection = oscillatorShift === null || Math.abs(oscillatorShift) < 2
      ? "flat"
      : oscillatorShift > 0
        ? "up"
        : "down";
    const shiftText = oscillatorShift === null || Math.abs(oscillatorShift) < 2
      ? "little 20-run change"
      : `${Math.abs(oscillatorShift).toFixed(1)} pts toward ${oscillatorShift > 0 ? primaryComparison.positive_axis_label : primaryComparison.negative_axis_label}`;
    return {
      id: "sector",
      label: "Sectors",
      primaryDirection,
      secondaryDirection,
      stance: primaryDirection === "up" ? "risk-on" : primaryDirection === "down" ? "risk-off" : "mixed",
      confidence: getConfidenceFromSignal(trendSignal),
      summary: `${interpretation?.title ?? "Balanced rotation"}; ${shiftText}`,
    };
  }, [interpretation?.title, latestOscillator, leadershipBand, oscillatorShift, primaryComparison]);

  useEffect(() => {
    if (onInsight && sectorInsight) onInsight(sectorInsight);
  }, [onInsight, sectorInsight]);

  if (loading) {
    return (
      <div className="primary-card p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-1/3 rounded bg-stealth-700" />
          <div className="h-24 rounded-xl bg-stealth-800" />
          <div className="h-40 rounded-xl bg-stealth-800" />
        </div>
      </div>
    );
  }

  if (error || !analytics || !latest || !primaryComparison || !interpretation) {
    return (
      <div className="primary-card p-6">
        <h3 className="text-lg font-semibold">Sector Rotation</h3>
        <p className="mt-3 text-sm text-red-300">{error ?? "Sector rotation data is unavailable"}</p>
      </div>
    );
  }

  const timestamps = chartData.map((point) => point.timestampNum);
  const minTime = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTime = timestamps.length ? Math.max(...timestamps) : 0;
  const tickPositions = timestamps.length > 1
    ? Array.from({ length: 4 }, (_, index) => minTime + (maxTime - minTime) * (index / 3))
    : timestamps;
  const maxMagnitude = chartData.length
    ? Math.max(...chartData.map((point) => Math.abs(point.oscillator)))
    : 30;
  const oscillatorDomain = Math.max(30, Math.ceil(maxMagnitude / 10) * 10);
  const periodLabel = trendPeriod === 365 ? "1yr" : trendPeriod === 180 ? "6mo" : "90d";
  const shiftLeader = oscillatorShift === null || Math.abs(oscillatorShift) < 2
    ? "Little change"
    : `Toward ${oscillatorShift > 0 ? primaryComparison.positive_axis_label : primaryComparison.negative_axis_label}`;
  const qualityWarning = latest.quality_status === "blocked" || (latest.data_warnings?.length ?? 0) > 0;
  const breadthSummary = persistenceCounts.improving > persistenceCounts.weakening
    ? "more sectors are improving than weakening"
    : persistenceCounts.improving < persistenceCounts.weakening
      ? "more sectors are weakening than improving"
      : "improving and weakening breadth are even";
  const narrative = `${interpretation.title}. ${oscillatorShift === null ? "The 20-run shift is unavailable" : `${shiftLeader} by ${Math.abs(oscillatorShift).toFixed(1)} points over 20 runs`}; ${breadthSummary}.`;

  return (
    <Link to="/sector-projections" className="group block h-full" aria-label="View sector rotation details">
      <div className="primary-card primary-card-hover h-full cursor-pointer p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Sector Rotation</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-stealth-500">
              <span>{latest.system_state} regime</span>
              <span aria-hidden="true">·</span>
              <span>As of {new Date(`${latest.as_of_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span aria-hidden="true">·</span>
              <span>{analytics.analytics_version.replace("sector_stability_", "analytics ")}</span>
            </div>
          </div>
          <span className="text-stealth-400 transition-colors group-hover:text-stealth-200" aria-hidden="true">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </span>
        </div>

        {qualityWarning && (
          <div className="mt-4 rounded-lg border border-yellow-700/50 bg-yellow-950/20 px-3 py-2 text-xs text-yellow-200">
            Sector data includes a quality warning; treat the current read cautiously.
          </div>
        )}

        <div className="secondary-card mt-5 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className={`text-lg font-semibold ${interpretation.color}`}>{interpretation.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-stealth-400">{interpretation.description}</div>
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <div className="text-[10px] uppercase tracking-wide text-stealth-500">Cyclical − defensive</div>
              <div className="mt-1 text-2xl font-semibold text-stealth-100">
                {latestOscillator !== null && latestOscillator > 0 ? "+" : ""}{latestOscillator?.toFixed(1) ?? "—"}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-stealth-700/70 pt-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stealth-500">20-run shift</div>
              <div className="mt-1 font-semibold text-stealth-200">{shiftLeader}</div>
              <div className="mt-0.5 text-[10px] text-stealth-500">{oscillatorShift === null ? "—" : `${Math.abs(oscillatorShift).toFixed(1)} pts`}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stealth-500">Clear signal</div>
              <div className="mt-1 font-semibold text-stealth-200">Beyond ±{leadershipBand}</div>
              <div className="mt-0.5 text-[10px] text-stealth-500">Smoothed basket spread</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="secondary-card p-4">
            <div className="text-xs text-stealth-400">3M leadership</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {leaders.map((sector) => (
                <span key={sector.sector_symbol} className="rounded-md border border-stealth-700 bg-stealth-950/30 px-2 py-1 text-[11px] text-stealth-200">
                  <strong>#{sector.horizons["3m"].stable_rank} {sector.sector_symbol}</strong>
                  <span className="ml-1 text-stealth-500">{sector.horizons["3m"].stable_score.toFixed(0)}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="secondary-card p-4">
            <div className="text-xs text-stealth-400">Rank persistence</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center tabular-nums">
              <div><div className="text-xl font-semibold text-green-400">{persistenceCounts.improving}</div><div className="text-[10px] text-stealth-500">Improving</div></div>
              <div><div className="text-xl font-semibold text-stealth-300">{persistenceCounts.stable}</div><div className="text-[10px] text-stealth-500">Stable</div></div>
              <div><div className="text-xl font-semibold text-red-400">{persistenceCounts.weakening}</div><div className="text-[10px] text-stealth-500">Weakening</div></div>
            </div>
          </div>
        </div>

        <div className="secondary-card mt-4 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-stealth-200">Cyclical vs defensive oscillator</div>
              <div className="mt-0.5 text-[10px] text-stealth-500">Native score-point spread · 25% EWMA</div>
            </div>
            <div className="text-xs text-stealth-500">{periodLabel}</div>
          </div>
          {chartData.length > 0 ? (
            <div className="mt-3 h-44">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={chartData} margin={{ ...CHART_MARGIN, left: 12, right: 4 }}>
                  <CartesianGrid {...commonGridProps} />
                  <ReferenceArea y1={leadershipBand} y2={oscillatorDomain} fill={getFamilyColor("market")} fillOpacity={0.035} />
                  <ReferenceArea y1={-oscillatorDomain} y2={-leadershipBand} fill={getFamilyColor("volatility")} fillOpacity={0.035} />
                  <ReferenceLine y={0} stroke={CHART_NEUTRAL.axis} strokeWidth={1.5} />
                  <ReferenceLine y={leadershipBand} stroke={CHART_NEUTRAL.grid} strokeDasharray="3 4" />
                  <ReferenceLine y={-leadershipBand} stroke={CHART_NEUTRAL.grid} strokeDasharray="3 4" />
                  <XAxis
                    dataKey="timestampNum"
                    type="number"
                    domain={[minTime, maxTime]}
                    ticks={tickPositions}
                    tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                    stroke={CHART_NEUTRAL.axis}
                    tickFormatter={(value: number) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  />
                  <YAxis
                    width={58}
                    axisLine={false}
                    tickLine={false}
                    domain={[-oscillatorDomain, oscillatorDomain]}
                    ticks={[-oscillatorDomain, 0, oscillatorDomain]}
                    tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                    tickFormatter={(value: number) => value > 0 ? "Cyclical" : value < 0 ? "Defensive" : "Balanced"}
                  />
                  <Tooltip
                    contentStyle={commonTooltipStyle}
                    labelFormatter={(label: number) => new Date(label).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    formatter={(value: number) => {
                      const leader = value >= 0 ? primaryComparison.positive_axis_label : primaryComparison.negative_axis_label;
                      return [`${leader} by ${Math.abs(value).toFixed(1)} score points`, primaryComparison.title];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="oscillator"
                    name={primaryComparison.title}
                    baseValue={0}
                    stroke={getFamilyColor("market")}
                    strokeWidth={2.5}
                    fill={getFamilyColor("market")}
                    fillOpacity={0.09}
                    dot={false}
                    animationDuration={CHART_ANIMATION.duration}
                    animationEasing={CHART_ANIMATION.easing}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-44 items-center justify-center text-xs text-stealth-400">No oscillator history available.</div>
          )}
        </div>

        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wide text-stealth-500">Other rotation lenses</div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {analytics.leadership_comparisons
              .filter((comparison) => comparison.key !== PRIMARY_COMPARISON)
              .map((comparison) => {
                const value = latestComparisonValue(comparison);
                return (
                  <div key={comparison.key} className="rounded-lg border border-stealth-700 bg-stealth-950/20 px-3 py-2">
                    <div className="truncate text-[10px] text-stealth-500">{comparison.title}</div>
                    <div className="mt-1 text-xs font-semibold text-stealth-200">{formatLeadershipValue(value, comparison)}</div>
                  </div>
                );
              })}
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-stealth-300">{narrative}</p>
      </div>
    </Link>
  );
}
