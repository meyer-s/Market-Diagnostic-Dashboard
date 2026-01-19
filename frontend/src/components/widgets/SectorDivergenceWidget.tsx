/**
 * Sector Divergence Widget
 * 
 * Dashboard widget displaying sector leadership patterns and regime alignment.
 * Helps identify macro market positioning by comparing defensive vs cyclical sector performance.
 * 
 * Key Metrics:
 * - Defensive Average: XLU (Utilities), XLP (Staples), XLV (Healthcare)
 * - Cyclical Average: XLE (Energy), XLF (Financials), XLK (Tech), XLY (Discretionary)
 * - Regime Alignment: How well sector leadership matches expected patterns for current market state
 * - Sector Breadth: Count of improving vs deteriorating sectors across horizons
 * 
 * Interpretations:
 * - RED market + defensive lead = Flight to safety (expected)
 * - RED market + cyclical lead = Risk appetite emerging (potential reversal signal)
 * - GREEN market + cyclical lead = Risk-on mode (healthy)
 * - GREEN market + defensive lead = Caution creeping in (early warning)
 * 
 * @component
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
import { getLegacyApiUrl } from "../../utils/apiUtils";
import { CHART_MARGIN, commonGridProps, commonTooltipStyle } from "../../utils/chartUtils";
import {
  analyzeSeries,
  getTrendTone,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";

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
        const apiUrl = getLegacyApiUrl();
        const historyUrl = `${apiUrl}/sectors/projections/history?days=${trendPeriod}`;
        const [summaryRes, historyRes, alertsRes] = await Promise.all([
          fetch(`${apiUrl}/sectors/summary`),
          fetch(historyUrl),
          fetch(`${apiUrl}/sectors/alerts`)
        ]);
        if (!summaryRes.ok) throw new Error("Failed to fetch sector summary");
        const summaryData = await summaryRes.json();
        setData(summaryData);

        if (historyRes.ok) {
          const historyData: SectorProjectionHistory = await historyRes.json();
          setHistory(buildHistorySeries(historyData));
        } else {
          setHistory([]);
        }

        const alertsData = alertsRes.ok ? await alertsRes.json() : { alerts: [] };
        setAlerts(alertsData.alerts || []);
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
  const spreadTone = getTrendTone(primaryGapSignal);
  const leadValue = data?.defensive_vs_cyclical ?? 0;
  const leadSide =
    Math.abs(leadValue) < 2 ? "balanced" : leadValue > 0 ? "defense" : "growth";
  const breadthBalance = (data?.sector_breadth.improving ?? 0) - (data?.sector_breadth.deteriorating ?? 0);
  const breadthPhrase =
    breadthBalance > 2
      ? "breadth is improving"
      : breadthBalance < -2
      ? "breadth is thinning"
      : "breadth is mixed";
  const toneClause = spreadTone === "mixed" ? "" : `, and the move feels ${spreadTone}`;
  const secondaryBiasSignal = analyzeSeries(spreadSeries, trendWindows.secondary);
  const primaryDirection =
    leadSide === "growth" ? "up" : leadSide === "defense" ? "down" : "flat";
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
        confidence: getConfidenceFromSignal(primaryGapSignal),
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

  const getAlignmentColor = (score: number) => {
    if (score >= 65) return "text-green-400";
    if (score >= 45) return "text-yellow-400";
    return "text-red-400";
  };

  // Interpret the defensive vs cyclical spread
  const getMarketInterpretation = () => {
    const spread = data.defensive_vs_cyclical;
    const isRed = data.system_state === "RED";
    const isGreen = data.system_state === "GREEN";
    
    if (isRed && spread > 5) {
      return { text: "Flight to Safety", color: "text-blue-400", desc: "Investors seeking defensive positioning amid stress" };
    } else if (isRed && spread < -5) {
      return { text: "Risk Appetite Emerging", color: "text-green-400", desc: "Cyclicals gaining despite red regime - potential reversal signal" };
    } else if (isGreen && spread < -5) {
      return { text: "Risk-On Mode", color: "text-orange-400", desc: "Growth sectors leading as expected in healthy market" };
    } else if (isGreen && spread > 5) {
      return { text: "Caution Creeping In", color: "text-yellow-400", desc: "Defensives outperforming in green market - early warning sign" };
    } else {
      return { text: "Balanced Rotation", color: "text-gray-400", desc: "No clear defensive or cyclical bias" };
    }
  };

  const interpretation = getMarketInterpretation();
  const periodLabel = trendPeriod === 365 ? "1yr" : trendPeriod === 180 ? "6mo" : "90d";
  const timestamps = chartData.map((point) => point.timestampNum);
  const minTime = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTime = timestamps.length ? Math.max(...timestamps) : 0;
  const tickPositions = timestamps.length > 1
    ? Array.from({ length: 5 }, (_, i) => minTime + ((maxTime - minTime) * (i / 4)))
    : timestamps;
  const secondaryClause =
    secondaryGapSignal.direction === primaryGapSignal.direction
      ? "Recent move agrees."
      : `Recent move is ${secondarySpreadPhrase}.`;
  const sectorSummary =
    leadSide === "balanced"
      ? `Compares defensive vs growth sectors. ${trendWindows.label} gap is ${spreadTrendPhrase}${toneClause}, ${breadthPhrase}. ${secondaryClause} Growth-linked jobs and portfolios feel it first, so stay balanced.`
      : leadSide === "defense"
      ? `Compares defensive vs growth sectors. Defense is ahead and the ${trendWindows.label.toLowerCase()} gap is ${spreadTrendPhrase}${toneClause}, ${breadthPhrase}. ${secondaryClause} Growth-linked jobs and portfolios feel it first, so keep a defensive tilt.`
      : `Compares defensive vs growth sectors. Growth is ahead and the ${trendWindows.label.toLowerCase()} gap is ${spreadTrendPhrase}${toneClause}, ${breadthPhrase}. ${secondaryClause} Growth-linked jobs and portfolios benefit first, so lean into growth.`;

  return (
    <div className="bg-stealth-800 rounded-lg p-6 shadow-lg border border-stealth-700">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Sector Divergence Analysis</h3>
        <Link 
          to="/sector-projections" 
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View Details &gt;
        </Link>
      </div>

      {/* Market Interpretation - Prominent Card */}
      <div className="bg-gradient-to-br from-stealth-900 to-stealth-850 rounded-lg p-4 mb-6 border border-stealth-600">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className={`text-lg font-bold ${interpretation.color} mb-2`}>
              {interpretation.text}
            </div>
            <div className="text-sm text-gray-400">
              {interpretation.desc}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-xs text-gray-500 mb-1">Def vs Cyc</div>
            <div className={`text-2xl font-bold ${data.defensive_vs_cyclical > 0 ? 'text-blue-400' : 'text-orange-400'}`}>
              {data.defensive_vs_cyclical > 0 ? '+' : ''}{data.defensive_vs_cyclical}
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-stealth-900 rounded-lg p-4 border border-stealth-700">
          <div className="text-xs text-gray-400 mb-2">Regime Alignment</div>
          <div className="flex items-end justify-between">
            <div className={`text-3xl font-bold ${getAlignmentColor(data.regime_alignment_score)}`}>
              {data.regime_alignment_score}
            </div>
            <div className="text-xs text-gray-500">/100</div>
          </div>
          <div className="text-xs text-gray-500 mt-2 leading-tight">
            {data.regime_alignment_score >= 65 && "Sectors aligned"}
            {data.regime_alignment_score >= 45 && data.regime_alignment_score < 65 && "Mixed positioning"}
            {data.regime_alignment_score < 45 && "Diverged regime"}
          </div>
        </div>

        <div className="bg-stealth-900 rounded-lg p-4 border border-stealth-700">
          <div className="text-xs text-gray-400 mb-2">Sector Breadth</div>
          <div className="flex justify-between items-end mb-2 gap-2 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="text-green-400 font-bold text-2xl truncate">{data.sector_breadth.improving}</div>
              <div className="text-xs text-gray-500 truncate">Improving</div>
            </div>
            <div className="flex-1 min-w-0 text-center">
              <div className="text-gray-400 font-bold text-lg truncate">{data.sector_breadth.stable}</div>
              <div className="text-xs text-gray-500 truncate">Stable</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-red-400 font-bold text-2xl truncate">{data.sector_breadth.deteriorating}</div>
              <div className="text-xs text-gray-500 truncate">Falling</div>
            </div>
          </div>
        </div>
      </div>

      {/* Trend Chart */}
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
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  stroke="#555560"
                  tickFormatter={(value: number) =>
                    new Date(value).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  stroke="#555560"
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
                  stroke="#60a5fa"
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

      {/* Sector Divergence Alerts */}
      {alerts.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-stealth-200 mb-3">Divergence Alerts</h4>
          <div className="space-y-3">
            {alerts.map((alert, idx) => (
              <div
                key={idx}
                className={`bg-stealth-900 rounded p-4 border-l-4 ${
                  alert.severity === "WARNING" 
                    ? "border-yellow-400" 
                    : "border-blue-400"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${
                      alert.severity === "WARNING" ? "text-yellow-400" : "text-blue-400"
                    }`}>
                      {alert.severity === "WARNING" ? "⚠" : "ℹ"}
                    </span>
                    <span className="text-sm font-semibold text-stealth-100">
                      {alert.title}
                    </span>
                  </div>
                </div>
                
                <p className="text-xs text-gray-300 mb-3">
                  {alert.message}
                </p>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-stealth-800 rounded p-2">
                    <div className="text-gray-500">System State</div>
                    <div className={`font-bold ${
                      alert.details.system_state === "RED" ? "text-red-400" :
                      alert.details.system_state === "GREEN" ? "text-green-400" :
                      "text-yellow-400"
                    }`}>
                      {alert.details.system_state}
                    </div>
                  </div>
                  
                  <div className="bg-stealth-800 rounded p-2">
                    <div className="text-gray-500">Spread</div>
                    <div className="font-bold text-stealth-200">
                      {alert.details.spread > 0 ? "+" : ""}{alert.details.spread} pts
                    </div>
                  </div>
                  
                  <div className="bg-stealth-800 rounded p-2">
                    <div className="text-gray-500">Defensive Avg</div>
                    <div className="font-bold text-blue-400">
                      {alert.details.defensive_avg}
                    </div>
                  </div>
                  
                  <div className="bg-stealth-800 rounded p-2">
                    <div className="text-gray-500">Cyclical Avg</div>
                    <div className="font-bold text-orange-400">
                      {alert.details.cyclical_avg}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 bg-stealth-900 border border-stealth-700 rounded p-3">
        <p className="text-xs text-stealth-300 leading-relaxed">{sectorSummary}</p>
      </div>
    </div>
  );
}
