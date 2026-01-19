/**
 * Sector Divergence Widget
 * 
 * Dashboard widget displaying sector leadership patterns and regime alignment.
 * Helps identify macro market positioning by comparing defensive vs cyclical sector performance.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { apiFetch } from "../../utils/apiUtils";
import { CHART_MARGIN, CHART_NEUTRAL, commonGridProps, commonTooltipStyle } from "../../utils/chartUtils";
import {
  analyzeSeries,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";
import { useProgressiveCommitment } from "../../hooks/useProgressiveCommitment";
import { getFamilyColor } from "../../theme/metricColors";
import { dashboardCardDetails } from "../../config/dashboardCards";

interface SectorSummary {
  as_of_date: string;
  system_state: string;
  defensive_avg: number;
  cyclical_avg: number;
  defensive_vs_cyclical: number;
  regime_alignment_score: number;
  sector_breadth: {
    improving: number;
    deteriorating: number;
    stable: number;
  };
  top_defensive: Array<{ symbol: string; name: string; score: number }>;
  top_cyclical: Array<{ symbol: string; name: string; score: number }>;
}

interface SectorHistoryEntry {
  as_of_date: string;
  score_total: number;
}

type SectorProjectionHistory = Record<string, Record<string, SectorHistoryEntry[]>>;

interface SectorAlert {
  type: string;
  severity: "INFO" | "WARNING";
  title: string;
  message: string;
  details: any;
  timestamp: string;
}

interface Props {
  trendPeriod?: 90 | 180 | 365;
  onInsight?: (insight: InsightSignal) => void;
}

interface SectorHistoryPoint {
  as_of_date: string;
  timestampNum: number;
  defensive_avg: number;
  cyclical_avg: number;
  spread: number;
}

const DEFENSIVE_SECTORS = new Set(["XLU", "XLP", "XLV"]);
const CYCLICAL_SECTORS = new Set(["XLE", "XLF", "XLK", "XLY"]);

export default function SectorDivergenceWidget({ trendPeriod = 90, onInsight }: Props) {
  const [data, setData] = useState<SectorSummary | null>(null);
  const [history, setHistory] = useState<SectorHistoryPoint[]>([]);
  const [alerts, setAlerts] = useState<SectorAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const commitment = useProgressiveCommitment({ mode: "inline" });

  const buildHistorySeries = (historyData: SectorProjectionHistory | null): SectorHistoryPoint[] => {
    if (!historyData) return [];
    const buckets = new Map<string, { defensive: number[]; cyclical: number[] }>();

    Object.entries(historyData).forEach(([symbol, horizons]) => {
      const entries = horizons?.["3m"];
      if (!entries) return;
      const isDefensive = DEFENSIVE_SECTORS.has(symbol);
      const isCyclical = CYCLICAL_SECTORS.has(symbol);
      if (!isDefensive && !isCyclical) return;

      entries.forEach((entry) => {
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
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const historyUrl = `/sectors/projections/history?days=${trendPeriod}`;
        const summaryData = await apiFetch<SectorSummary>("/sectors/summary");
        setData(summaryData);

        const [historyResult, alertsResult] = await Promise.allSettled([
          apiFetch<SectorProjectionHistory>(historyUrl),
          apiFetch<{ alerts?: SectorAlert[] }>("/sectors/alerts"),
        ]);

        if (historyResult.status === "fulfilled") {
          setHistory(buildHistorySeries(historyResult.value));
        } else {
          setHistory([]);
        }

        if (alertsResult.status === "fulfilled") {
          setAlerts(alertsResult.value.alerts || []);
        } else {
          setAlerts([]);
        }
      } catch (error) {
        console.error("Failed to fetch sector data:", error);
        setHistory([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [trendPeriod]);

  const chartData = history;
  const trendWindows = getTrendWindows(trendPeriod);
  const spreadSeries = chartData.map((point) => point.spread).filter((value) => Number.isFinite(value));
  const gapSeries = spreadSeries.map((value) => Math.abs(value));
  const primaryGapSignal = analyzeSeries(gapSeries, trendWindows.primary);
  const secondaryGapSignal = analyzeSeries(gapSeries, trendWindows.secondary);
  const sectorConfidence = getConfidenceFromSignal(primaryGapSignal);
  const spreadTrendPhrase =
    primaryGapSignal.direction === "up"
      ? "widening"
      : primaryGapSignal.direction === "down"
      ? "narrowing"
      : "steady";
  const secondarySpreadPhrase =
    secondaryGapSignal.direction === "up"
      ? "widening"
      : secondaryGapSignal.direction === "down"
      ? "narrowing"
      : "steady";
  const leadValue = data?.defensive_vs_cyclical ?? 0;
  const leadSide = Math.abs(leadValue) < 2 ? "balanced" : leadValue > 0 ? "defense" : "growth";
  const breadthBalance = (data?.sector_breadth.improving ?? 0) - (data?.sector_breadth.deteriorating ?? 0);
  const breadthPhrase =
    breadthBalance > 2
      ? "breadth is improving"
      : breadthBalance < -2
      ? "breadth is thinning"
      : "breadth is mixed";
  const secondaryBiasSignal = analyzeSeries(spreadSeries, trendWindows.secondary);
  const primaryDirection = leadSide === "growth" ? "up" : leadSide === "defense" ? "down" : "flat";
  const secondaryDirection =
    secondaryBiasSignal.direction === "up"
      ? "down"
      : secondaryBiasSignal.direction === "down"
      ? "up"
      : "flat";
  const summaryShort =
    leadSide === "balanced"
      ? `balanced, gap ${spreadTrendPhrase}${
          secondaryGapSignal.direction === primaryGapSignal.direction
            ? ""
            : ` / recent ${secondarySpreadPhrase}`
        }`
      : `${leadSide} lead, gap ${spreadTrendPhrase}${
          secondaryGapSignal.direction === primaryGapSignal.direction
            ? ""
            : ` / recent ${secondarySpreadPhrase}`
        }`;
  const sectorInsight: InsightSignal | null = data
    ? {
        id: "sector",
        label: "Sectors",
        primaryDirection,
        secondaryDirection,
        stance: leadSide === "growth" ? "risk-on" : leadSide === "defense" ? "risk-off" : "mixed",
        confidence: sectorConfidence,
        summary: summaryShort,
      }
    : null;

  useEffect(() => {
    if (!onInsight || !sectorInsight) return;
    onInsight(sectorInsight);
  }, [
    onInsight,
    sectorInsight?.primaryDirection,
    sectorInsight?.secondaryDirection,
    sectorInsight?.stance,
    sectorInsight?.confidence,
    sectorInsight?.summary,
  ]);

  if (loading) {
    return (
      <div className="bg-stealth-800 rounded-lg p-6 shadow-lg border border-stealth-700">
        <h3 className="text-lg font-semibold mb-4">Sector Divergence</h3>
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const signalLine =
    leadSide === "growth" ? "Growth lead" : leadSide === "defense" ? "Defense lead" : "Balanced rotation";
  const contextLine = dashboardCardDetails.sector.context;
  const focusLine = `Confidence: ${sectorConfidence} - gap ${spreadTrendPhrase}`;
  const spreadLineColor = getFamilyColor("market", "base");
  const periodLabel = trendPeriod === 365 ? "1yr" : trendPeriod === 180 ? "6mo" : "90d";
  const timestamps = chartData.map((point) => point.timestampNum);
  const minTime = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTime = timestamps.length ? Math.max(...timestamps) : 0;
  const tickPositions = timestamps.length > 1
    ? Array.from({ length: 5 }, (_, i) => minTime + ((maxTime - minTime) * (i / 4)))
    : timestamps;

  return (
    <div
      {...commitment.getContainerProps<HTMLDivElement>()}
      className="bg-stealth-800 rounded-lg p-4 sm:p-6 shadow-lg border border-stealth-700 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stealth-500/60"
      aria-expanded={commitment.isExpanded}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">Sector Divergence</h3>
        <span className="text-xs text-stealth-500">{periodLabel}</span>
      </div>
      <div className="text-sm text-stealth-200">
        <span className="text-stealth-500">Signal:</span> {signalLine}
      </div>
      <div className="text-sm text-stealth-400">
        <span className="text-stealth-500">Context:</span> {contextLine}
      </div>
      {commitment.state === "focus" && (
        <div className="text-xs text-stealth-500 transition-opacity duration-150 motion-reduce:transition-none">
          {focusLine} (recent {secondarySpreadPhrase})
        </div>
      )}

      {commitment.isExpanded && (
        <div className="pt-3 border-t border-stealth-700 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-stealth-300">
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Alignment score</div>
              <div className="mt-1 text-sm text-stealth-200">{data.regime_alignment_score}</div>
            </div>
            <div className="bg-stealth-900 border border-stealth-700 rounded p-3">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Spread</div>
              <div className="mt-1 text-sm text-stealth-200">
                {leadValue > 0 ? "+" : ""}{leadValue}
              </div>
            </div>
          </div>
          <div className="text-xs text-stealth-300 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-stealth-500">Why it matters</div>
            <p>{dashboardCardDetails.sector.why}</p>
          </div>
          <div className="text-xs text-stealth-300 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-stealth-500">Related signals</div>
            <div className="flex flex-wrap gap-2">
              {dashboardCardDetails.sector.related.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 rounded-full border border-stealth-600 bg-stealth-900 px-2 py-1 text-[11px] text-stealth-300"
                >
                  {item.label}
                  <span className="text-stealth-500">-</span>
                  {item.reason}
                </span>
              ))}
            </div>
          </div>
          <div className="text-xs text-stealth-300 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-stealth-500">Methodology note</div>
            <p>{dashboardCardDetails.sector.methodology}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-stealth-900 rounded-lg p-4 border border-stealth-700">
              <div className="text-xs text-gray-400 mb-2">Regime Alignment</div>
              <div className="flex items-end justify-between">
                <div className="text-3xl font-bold text-stealth-200">{data.regime_alignment_score}</div>
                <div className="text-xs text-gray-500">/100</div>
              </div>
              <div className="text-xs text-gray-500 mt-2 leading-tight">{breadthPhrase}</div>
            </div>

            <div className="bg-stealth-900 rounded-lg p-4 border border-stealth-700">
              <div className="text-xs text-gray-400 mb-2">Sector Breadth</div>
              <div className="flex justify-between items-end mb-2 gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="text-stealth-200 font-bold text-2xl truncate">
                    {data.sector_breadth.improving}
                  </div>
                  <div className="text-xs text-gray-500 truncate">Improving</div>
                </div>
                <div className="flex-1 min-w-0 text-center">
                  <div className="text-gray-400 font-bold text-lg truncate">{data.sector_breadth.stable}</div>
                  <div className="text-xs text-gray-500 truncate">Stable</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-stealth-200 font-bold text-2xl truncate">
                    {data.sector_breadth.deteriorating}
                  </div>
                  <div className="text-xs text-gray-500 truncate">Falling</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-stealth-900 rounded-lg p-4 border border-stealth-700">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-stealth-200">Defensive vs Cyclical Spread</div>
              <div className="text-xs text-stealth-500">{periodLabel}</div>
            </div>
            {chartData.length > 0 ? (
              <div className="h-40 sm:h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={CHART_MARGIN}>
                    <CartesianGrid {...commonGridProps} />
                    <XAxis
                      dataKey="timestampNum"
                      type="number"
                      domain={[minTime, maxTime]}
                      ticks={tickPositions}
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
                      stroke={spreadLineColor}
                      strokeWidth={2}
                      dot={false}
                      animationDuration={300}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-40 sm:h-44 flex items-center justify-center text-xs text-stealth-400">
                No history available yet.
              </div>
            )}
          </div>

          {alerts.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-stealth-200 mb-3">Divergence Alerts</div>
              <div className="space-y-3">
                {alerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className="bg-stealth-900 rounded p-4 border-l-4 border-stealth-600"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-stealth-100">{alert.title}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 mb-3">{alert.message}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-stealth-800 rounded p-2">
                        <div className="text-gray-500">System State</div>
                        <div className="font-bold text-stealth-200">{alert.details.system_state}</div>
                      </div>
                      <div className="bg-stealth-800 rounded p-2">
                        <div className="text-gray-500">Spread</div>
                        <div className="font-bold text-stealth-200">
                          {alert.details.spread > 0 ? "+" : ""}{alert.details.spread} pts
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2">
            <Link
              to="/sector-projections"
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              onClick={(event) => event.stopPropagation()}
            >
              View sector details
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
