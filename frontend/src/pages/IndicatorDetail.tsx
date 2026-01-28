import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { IndicatorHistoryPoint } from "../types";
import StateSparkline from "../components/widgets/StateSparkline";
import { ComponentChart } from "../components/widgets/ComponentChart";
import { ComponentCard } from "../components/widgets/ComponentCard";
import { processComponentData, calculateDateRange, extendStaleData, filterByDateRange } from "../utils/chartDataUtils";
import { prepareExtendedComponentData } from "../utils/indicatorDetailHelpers";
import { formatDateTime } from "../utils/styleUtils";
import { CHART_ANIMATION, CHART_MARGIN, CHART_NEUTRAL } from "../utils/chartUtils";
import { getFamilyColor, getMetricColor, statePalette } from "../theme/metricColors";
import { muniPublicSectorThresholds, muniPublicSectorWeights } from "../theme/metricRegistry";
import { apiFetch } from "../utils/apiUtils";
import MarketLoading from "../components/ui/MarketLoading";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

interface IndicatorMetadata {
  name: string;
  description: string;
  relevance: string;
  scoring: string;
  typical_range: string;
  impact: string;
}

interface IndicatorDetailResponse {
  code: string;
  name: string;
  latest?: {
    timestamp: string;
    raw_value: number;
    normalized_value: number;
    score: number;
    state: "GREEN" | "YELLOW" | "RED";
  };
  metadata?: IndicatorMetadata;
  has_data?: boolean;
}

interface ComponentData {
  date: string;
  pce: { value: number; mom_pct: number; is_filled?: boolean; as_of?: string };
  cpi: { value: number; mom_pct: number; is_filled?: boolean; as_of?: string };
  pi: { value: number; mom_pct: number; is_filled?: boolean; as_of?: string };
  spreads: {
    pce_spread: number;
    pi_spread: number;
    consumer_health: number;
  };
}

interface BondComponentData {
  date: string;
  credit_spread_stress: {
    hy_oas: number;
    ig_oas: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  yield_curve_stress: {
    spread_10y2y: number;
    spread_10y3m: number;
    spread_30y5y: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  rates_momentum_stress: {
    roc_2y: number;
    roc_10y: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  treasury_volatility_stress: {
    calculated_volatility: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  composite: {
    stress_score: number;
    stability_score: number;
  };
}

interface LiquidityComponentData {
  date: string;
  m2_money_supply: {
    value: number;
    yoy_pct: number;
    z_score: number;
  };
  fed_balance_sheet: {
    value: number;
    delta: number;
    z_score: number;
  };
  reverse_repo: {
    value: number;
    z_score: number;
  };
  composite: {
    liquidity_proxy: number;
    stress_score: number;
  };
}

interface SentimentCompositeComponentData {
  date: string;
  michigan_sentiment: {
    value: number;
    confidence_score: number;
    weight: number;
    contribution: number;
  };
  nfib_optimism?: {
    value: number;
    confidence_score: number;
    weight: number;
    contribution: number;
  };
  ism_new_orders?: {
    value: number;
    confidence_score: number;
    weight: number;
    contribution: number;
  };
  capex_proxy?: {
    value: number;
    confidence_score: number;
    weight: number;
    contribution: number;
  };
  composite: {
    confidence_score: number;
  };
}

interface AnalystAnxietyComponentData {
  date: string;
  vix: {
    value: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  hy_oas: {
    value: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  move?: {
    value: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  erp_proxy?: {
    bbb_yield: number;
    treasury_10y: number;
    spread: number;
    stress_score: number;
    stability_score: number;
    weight: number;
    contribution: number;
  };
  composite: {
    stress_score: number;
    stability_score: number;
  };
}

interface MuniSeriesPoint {
  date: string;
  value: number | null;
  stability_score: number | null;
  z_score?: number | null;
}

interface MuniSeries {
  key: string;
  name?: string;
  label: string;
  source?: string;
  unit?: string;
  is_proxy?: boolean;
  is_live?: boolean;
  as_of?: string | null;
  value?: number | null;
  stability_score?: number | null;
  notes?: string;
  latest?: MuniSeriesPoint | null;
  trend?: string;
  history?: MuniSeriesPoint[];
  stress_cues?: {
    stress_level?: "normal" | "stress" | "severe";
    [key: string]: any;
  };
}

interface MuniCurvePoint {
  date: string;
  yields?: Record<string, number | null>;
  level?: number | null;
  slope?: number | null;
  score?: number | null;
}

interface MuniCurve {
  label?: string;
  source?: string;
  notes?: string;
  latest?: MuniCurvePoint | null;
  trend?: string;
  history?: MuniCurvePoint[];
  status?: string;
  reason?: string;
}

interface MuniSubsystemResponse {
  as_of?: string;
  series: MuniSeries[];
  composite?: {
    score: number | null;
    state: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
    as_of?: string;
    coverage_live: number;
    coverage_total: number;
    missing_keys: string[];
    weights_used: Record<string, number>;
    near_threshold?: "GREEN" | "RED" | null;
  };
  relationship_signal?: {
    name: string;
    state: "GREEN" | "YELLOW" | "RED";
    message?: string | null;
    inputs?: {
      public_sector_score?: number | null;
      bond_market_score?: number | null;
      muni_spread_z_60d?: number | null;
    };
  };
  curve?: MuniCurve | null;
}

export default function IndicatorDetail() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();
  const normalizedCode = routeCode?.toUpperCase();
  const apiCode =
    normalizedCode === "ANALYST_CONFIDENCE" ? "ANALYST_ANXIETY" : normalizedCode;
  const isAnalystConfidence = apiCode === "ANALYST_ANXIETY";
  const [isRefetching, setIsRefetching] = React.useState(false);
  const [refetchMessage, setRefetchMessage] = React.useState<string | null>(null);
  const [bondTab, setBondTab] = React.useState<"core" | "public">("core");

  React.useEffect(() => {
    if (normalizedCode === "ANALYST_ANXIETY") {
      navigate("/indicators/ANALYST_CONFIDENCE", { replace: true });
    }
  }, [normalizedCode, navigate]);
  
  // Determine appropriate lookback period based on data freshness
  const getHistoryDays = () => {
    // For now, always request 730 days (2 years) to have more data available
    // The component will intelligently display the appropriate range
    return 730;
  };
  
  const { data: meta } = useApi<IndicatorDetailResponse>(
    apiCode ? `/indicators/${apiCode}` : ""
  );
  const { data: history, refetch: refetchHistory } = useApi<IndicatorHistoryPoint[]>(
    apiCode ? `/indicators/${apiCode}/history?days=${getHistoryDays()}` : ""
  );
  const { data: components, refetch: refetchComponents } = useApi<ComponentData[]>(
    apiCode === "CONSUMER_HEALTH"
      ? `/indicators/${apiCode}/components?days=${getHistoryDays()}`
      : ""
  );
  const { data: bondComponents, refetch: refetchBondComponents } = useApi<BondComponentData[]>(
    apiCode === "BOND_MARKET_STABILITY"
      ? `/indicators/${apiCode}/components?days=${getHistoryDays()}`
      : ""
  );
  const { data: liquidityComponents, refetch: refetchLiquidityComponents } = useApi<LiquidityComponentData[]>(
    apiCode === "LIQUIDITY_PROXY"
      ? `/indicators/${apiCode}/components?days=${getHistoryDays()}`
      : ""
  );
  const { data: analystAnxietyComponents, refetch: refetchAnalystAnxietyComponents } = useApi<AnalystAnxietyComponentData[]>(
    apiCode === "ANALYST_ANXIETY"
      ? `/indicators/${apiCode}/components?days=${getHistoryDays()}`
      : ""
  );
  const { data: sentimentCompositeComponents, refetch: refetchSentimentCompositeComponents } = useApi<SentimentCompositeComponentData[]>(
    apiCode === "SENTIMENT_COMPOSITE"
      ? `/indicators/${apiCode}/components?days=${getHistoryDays()}`
      : ""
  );
  const { data: muniSubsystem, loading: muniLoading, error: muniError } = useApi<MuniSubsystemResponse>(
    apiCode === "BOND_MARKET_STABILITY"
      ? `/indicators/${apiCode}/muni?days=${getHistoryDays()}`
      : ""
  );

  const getLatestComponentEntry = (
    items: ComponentData[],
    key: "pce" | "pi" | "cpi"
  ) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const component = items[i][key];
      if (component && component.is_filled === false) {
        return items[i];
      }
    }
    return items[items.length - 1];
  };

  const handleClearAndRefetch = async () => {
    if (!apiCode) return;
    
    const confirmLabel = isAnalystConfidence ? "Analyst Confidence" : apiCode;
    if (!confirm(`Are you sure you want to clear and refetch all data for ${confirmLabel}? This will delete all existing records and fetch fresh data (365 days).`)) {
      return;
    }
    
    setIsRefetching(true);
    setRefetchMessage(null);
    
    try {
      const result = await apiFetch<any>(`/admin/clear-refetch/${apiCode}?days=365`, {
        method: 'POST'
      });
      const deletedCount = result.deleted_records || 0;
      const backfilledCount = result.result?.backfilled || 0;
      
      if (deletedCount === 0 && backfilledCount === 0) {
        setRefetchMessage(`OK: Data already up to date`);
      } else if (deletedCount === 0) {
        setRefetchMessage(`OK: Refetched ${backfilledCount} new data points`);
      } else {
        setRefetchMessage(`OK: Cleared ${deletedCount} records and refetched ${backfilledCount} data points`);
      }
      
      // Refetch all data to update the UI
      refetchHistory?.();
      refetchComponents?.();
      refetchBondComponents?.();
      refetchLiquidityComponents?.();
      refetchAnalystAnxietyComponents?.();
      
      // Clear message after 5 seconds
      setTimeout(() => setRefetchMessage(null), 5000);
    } catch (error) {
      setRefetchMessage(`Error: Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRefetching(false);
    }
  };

  if (!apiCode) {
    return <div className="p-3 md:p-6 text-gray-200">No indicator code provided.</div>;
  }

  const displayName = isAnalystConfidence ? "Analyst Confidence" : meta?.name ?? apiCode;
  
  // Check if data is stale and needs extended view
  const getChartRange = () => {
    if (!history || history.length === 0) return { days: 365, label: "365 days" };
    
    const latestDataDate = new Date(history[history.length - 1].timestamp);
    const today = new Date();
    const daysStale = Math.floor((today.getTime() - latestDataDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // If data is stale for more than 30 days, show longer timeframe for context
    if (daysStale > 30) {
      return { days: 730, label: "2 years (extended due to data delay)" };
    }
    
    return { days: 365, label: "365 days" };
  };
  
  const chartRange = getChartRange();

  const stateColor = {
    GREEN: "text-green-400 bg-green-500/10 border-green-500/30",
    YELLOW: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    RED: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  // Helper to prepare chart data with date range and deduplication
  const prepareChartData = <T extends { date: string }>(
    components: T[],
    daysBack: number
  ): { data: (T & { dateNum: number })[]; dateRange: { startTime: number; endTime: number } } => {
    return processComponentData(components, daysBack);
  };

  return (
    <div className="p-3 md:p-6 text-gray-200 max-w-7xl mx-auto">
      <h2 className="text-2xl sm:text-3xl font-bold mb-4 md:mb-6">
        {displayName}
      </h2>

      {/* Metadata Section */}
      {meta?.metadata && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6 space-y-3 md:space-y-4">
          <div>
            <h3 className="text-base md:text-lg font-semibold text-stealth-100 mb-2">Description</h3>
            <p className="text-sm md:text-base text-stealth-300 leading-relaxed">{meta.metadata.description}</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <div>
              <h4 className="text-xs md:text-sm font-semibold text-stealth-200 mb-1">Relevance</h4>
              <p className="text-xs md:text-sm text-stealth-400">{meta.metadata.relevance}</p>
            </div>
            <div>
              <h4 className="text-xs md:text-sm font-semibold text-stealth-200 mb-1">Impact</h4>
              <p className="text-xs md:text-sm text-stealth-400">{meta.metadata.impact}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <div>
              <h4 className="text-xs md:text-sm font-semibold text-stealth-200 mb-1">Scoring Method</h4>
              <p className="text-xs md:text-sm text-stealth-400">{meta.metadata.scoring}</p>
            </div>
            <div>
              <h4 className="text-xs md:text-sm font-semibold text-stealth-200 mb-1">Typical Range</h4>
              <p className="text-xs md:text-sm text-stealth-400">{meta.metadata.typical_range}</p>
            </div>
          </div>
        </div>
      )}

      {/* Component Breakdown for Consumer Health */}
      {apiCode === "CONSUMER_HEALTH" && components && components.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
          <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-xs md:text-sm text-stealth-400 mb-2">
            Measures real consumer financial capacity by comparing spending and income growth against inflation.
          </p>
          <p className="text-xs md:text-sm text-stealth-400 mb-3 md:mb-4 font-mono break-all">
            Consumer Health = [(PCE Growth - CPI Growth) + (PI Growth - CPI Growth)] / 2
          </p>
          
          <div className="bg-stealth-900 border border-stealth-600 rounded p-2 md:p-3 mb-4 md:mb-6">
            <p className="text-xs text-stealth-300">
              <span className="text-green-400">Positive values</span> indicate spending and income are outpacing inflation (healthy consumer capacity). 
              <span className="text-red-400 ml-2">Negative values</span> indicate inflation is eroding real purchasing power (consumer stress).
              Data updates monthly with ~2 month lag as PCE/PI are released by the BEA.
            </p>
          </div>
          
          {/* Latest Values */}
          {(() => {
            const latestDate = components[components.length - 1]?.date;
            const latestPceEntry = getLatestComponentEntry(components, "pce");
            const latestPiEntry = getLatestComponentEntry(components, "pi");
            const latestCpiEntry = getLatestComponentEntry(components, "cpi");
            const formatAsOf = (date?: string) =>
              date
                ? new Date(date).toLocaleDateString("en-US", { month: "short", year: "numeric" })
                : "-";
            const isWaiting = (entryDate?: string) =>
              Boolean(latestDate && entryDate && entryDate < latestDate);

            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-6">
                <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                  <div className="text-xs text-stealth-400 mb-1">PCE (Spending)</div>
                  <div className="text-lg font-bold text-blue-400">
                    {latestPceEntry.pce.mom_pct.toFixed(3)}%
                  </div>
                  <div className="text-xs text-stealth-500 mt-1">
                    MoM Growth
                  </div>
                  <div className="text-xs text-stealth-500">
                    vs CPI: {latestPceEntry.spreads.pce_spread.toFixed(3)}%
                  </div>
                  <div className="text-xs text-stealth-600 mt-1">
                    As of {formatAsOf(latestPceEntry.pce.as_of || latestPceEntry.date)}
                  </div>
                  {isWaiting(latestPceEntry.pce.as_of || latestPceEntry.date) && (
                    <div className="text-[11px] text-amber-400 mt-1">Waiting on release</div>
                  )}
                </div>
                
                <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                  <div className="text-xs text-stealth-400 mb-1">PI (Income)</div>
                  <div className="text-lg font-bold text-green-400">
                    {latestPiEntry.pi.mom_pct.toFixed(3)}%
                  </div>
                  <div className="text-xs text-stealth-500 mt-1">
                    MoM Growth
                  </div>
                  <div className="text-xs text-stealth-500">
                    vs CPI: {latestPiEntry.spreads.pi_spread.toFixed(3)}%
                  </div>
                  <div className="text-xs text-stealth-600 mt-1">
                    As of {formatAsOf(latestPiEntry.pi.as_of || latestPiEntry.date)}
                  </div>
                  {isWaiting(latestPiEntry.pi.as_of || latestPiEntry.date) && (
                    <div className="text-[11px] text-amber-400 mt-1">Waiting on release</div>
                  )}
                </div>
                
                <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                  <div className="text-xs text-stealth-400 mb-1">CPI (Inflation)</div>
                  <div className="text-lg font-bold text-red-400">
                    {latestCpiEntry.cpi.mom_pct.toFixed(3)}%
                  </div>
                  <div className="text-xs text-stealth-500 mt-1">
                    MoM Growth
                  </div>
                  <div className="text-xs text-stealth-500">
                    Baseline
                  </div>
                  <div className="text-xs text-stealth-600 mt-1">
                    As of {formatAsOf(latestCpiEntry.cpi.as_of || latestCpiEntry.date)}
                  </div>
                  {isWaiting(latestCpiEntry.cpi.as_of || latestCpiEntry.date) && (
                    <div className="text-[11px] text-amber-400 mt-1">Waiting on release</div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Component MoM Growth Chart */}
          <div className="h-80 mb-6">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Component Month-over-Month Growth</h4>
            {(() => {
              const { data: extendedData, dateRange } = prepareExtendedComponentData({
                components,
                chartRangeDays: chartRange.days,
                extendToToday: true
              });
              
              return (
                <ComponentChart
                  data={extendedData}
                  lines={[
                    { dataKey: "pce.mom_pct", name: "PCE Growth", stroke: getMetricColor("PCE") },
                    { dataKey: "pi.mom_pct", name: "PI Growth", stroke: getMetricColor("PI", "muted") },
                    { dataKey: "cpi.mom_pct", name: "CPI (Inflation)", stroke: getMetricColor("CPI") }
                  ]}
                  referenceLines={[
                    { y: 0, stroke: getFamilyColor("benchmark"), label: "Neutral", labelFill: getFamilyColor("benchmark") }
                  ]}
                  yAxisLabel="MoM % Growth"
                  dateRange={dateRange}
                />
              );
            })()}
          </div>

          {/* Consumer Health Index Chart */}
          <div className="h-80">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Consumer Health Index</h4>
            <p className="text-xs text-stealth-400 mb-2">
              Positive = Spending/Income outpacing inflation (healthy). Negative = Inflation eroding consumer capacity (stress).
            </p>
            {(() => {
              const { data: extendedData, dateRange } = prepareExtendedComponentData({
                components,
                chartRangeDays: chartRange.days,
                extendToToday: true
              });
              
              return (
                <ComponentChart
                  data={extendedData}
                  lines={[
                    { dataKey: "spreads.pce_spread", name: "PCE vs CPI", stroke: getMetricColor("PCE", "muted") },
                    { dataKey: "spreads.pi_spread", name: "PI vs CPI", stroke: getMetricColor("PI", "faint") },
                    { dataKey: "spreads.consumer_health", name: "Consumer Health", stroke: getMetricColor("CONSUMER_HEALTH"), strokeWidth: 3 }
                  ]}
                  referenceLines={[
                    { y: 0, stroke: getFamilyColor("benchmark"), label: "Neutral", labelFill: getFamilyColor("benchmark") },
                    { y: 65, stroke: statePalette.green, label: "GREEN", labelFill: statePalette.green },
                    { y: 35, stroke: statePalette.red, label: "RED", labelFill: statePalette.red }
                  ]}
                  yAxisLabel="Spread vs Inflation (%)"
                  dateRange={dateRange}
                />
              );
            })()}
          </div>
        </div>
      )}

      {apiCode === "BOND_MARKET_STABILITY" && (
        <div className="mb-4 md:mb-6 border-b border-stealth-700 flex gap-4">
          <button
            onClick={() => setBondTab("core")}
            className={`pb-3 px-2 font-semibold border-b-2 transition ${
              bondTab === "core"
                ? "border-blue-500 text-blue-300"
                : "border-transparent text-stealth-400 hover:text-gray-300"
            }`}
          >
            Core Bond Stability
          </button>
          <button
            onClick={() => setBondTab("public")}
            className={`pb-3 px-2 font-semibold border-b-2 transition ${
              bondTab === "public"
                ? "border-emerald-500 text-emerald-300"
                : "border-transparent text-stealth-400 hover:text-gray-300"
            }`}
          >
            Public-sector credit &amp; funding stress
          </button>
        </div>
      )}

      {/* Component Breakdown for Bond Market Stability */}
      {apiCode === "BOND_MARKET_STABILITY" && bondTab === "core" && bondComponents && bondComponents.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
          <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-xs md:text-sm text-stealth-400 mb-3 md:mb-4 break-all">
            Composite Stability = 100 - (Credit x 44% + Curve x 23% + Momentum x 17% + Volatility x 16%)
          </p>
          
          {/* Latest Component Values */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Credit Spreads</div>
              <div className="text-lg font-bold text-red-400">
                {bondComponents[bondComponents.length - 1].credit_spread_stress.stability_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Weight: {(bondComponents[bondComponents.length - 1].credit_spread_stress.weight * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-stealth-500">
                Contrib: {bondComponents[bondComponents.length - 1].credit_spread_stress.contribution.toFixed(1)}
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Yield Curves</div>
              <div className="text-lg font-bold text-yellow-400">
                {bondComponents[bondComponents.length - 1].yield_curve_stress.stability_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Weight: {(bondComponents[bondComponents.length - 1].yield_curve_stress.weight * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-stealth-500">
                Contrib: {bondComponents[bondComponents.length - 1].yield_curve_stress.contribution.toFixed(1)}
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Rates Momentum</div>
              <div className="text-lg font-bold text-orange-400">
                {bondComponents[bondComponents.length - 1].rates_momentum_stress.stability_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Weight: {(bondComponents[bondComponents.length - 1].rates_momentum_stress.weight * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-stealth-500">
                Contrib: {bondComponents[bondComponents.length - 1].rates_momentum_stress.contribution.toFixed(1)}
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Treasury Vol</div>
              <div className="text-lg font-bold text-purple-400">
                {bondComponents[bondComponents.length - 1].treasury_volatility_stress.stability_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Weight: {(bondComponents[bondComponents.length - 1].treasury_volatility_stress.weight * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-stealth-500">
                Contrib: {bondComponents[bondComponents.length - 1].treasury_volatility_stress.contribution.toFixed(1)}
              </div>
            </div>
          </div>

          {/* Component Stability Levels Chart */}
          <div className="h-80 mb-6">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Component Stability Levels Over Time</h4>
            <p className="text-xs text-stealth-400 mb-2">
              Note: Higher component stability contributes to a stronger overall stability score.
            </p>
            {(() => {
              const { data, dateRange } = processComponentData(bondComponents, chartRange.days);
              
              return (
                <ComponentChart
                  data={data}
                  lines={[
                    { dataKey: "credit_spread_stress.stability_score", name: "Credit Spreads", stroke: getMetricColor("credit_spread_stress") },
                    { dataKey: "yield_curve_stress.stability_score", name: "Yield Curves", stroke: getMetricColor("yield_curve_stress") },
                    { dataKey: "rates_momentum_stress.stability_score", name: "Rates Momentum", stroke: getMetricColor("rates_momentum_stress", "muted") },
                    { dataKey: "treasury_volatility_stress.stability_score", name: "Treasury Volatility", stroke: getMetricColor("treasury_volatility_stress") }
                  ]}
                  referenceLines={[
                    { y: 70, stroke: statePalette.green, label: "GREEN", labelFill: statePalette.green },
                    { y: 40, stroke: statePalette.red, label: "RED", labelFill: statePalette.red }
                  ]}
                  yAxisLabel="Stability Score (0-100)"
                  dateRange={dateRange}
                />
              );
            })()}
          </div>

            {/* Composite Stability Calculation */}
            <div className="h-80">
              <h4 className="text-sm font-semibold mb-2 text-stealth-200">Composite Stability Score</h4>
              <p className="text-xs text-stealth-400 mb-2">
                Note: Composite stability aggregates the component stability readings over time.
              </p>
              {(() => {
                const { data, dateRange } = processComponentData(bondComponents, chartRange.days);
                
                return (
                  <ComponentChart
                    data={data}
                    lines={[
                      { dataKey: "composite.stability_score", name: "Composite Stability", stroke: getFamilyColor("system"), strokeWidth: 3 }
                    ]}
                    referenceLines={[
                      { y: 70, stroke: statePalette.green, label: "GREEN", labelFill: statePalette.green },
                      { y: 40, stroke: statePalette.red, label: "RED", labelFill: statePalette.red }
                    ]}
                    yAxisLabel="Composite Stability Score"
                    dateRange={dateRange}
                  />
                );
              })()}
            </div>
        </div>
      )}

      {apiCode === "BOND_MARKET_STABILITY" && bondTab === "public" && (
        <MuniStressPanel
          data={muniSubsystem}
          loading={muniLoading}
          error={muniError}
          chartRangeDays={chartRange.days}
        />
      )}

      {apiCode === "BREADTH_HEALTH" && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
          <h3 className="text-lg font-semibold text-stealth-100 mb-3">Methodology</h3>
          <ul className="text-xs md:text-sm text-stealth-400 space-y-2">
            <li>- Uses the RSP/SPY ratio (equal-weight vs cap-weight) as a participation proxy.</li>
            <li>- Combines level stability (z-score) and 30-day change stability, weighted 65%/35%.</li>
            <li>- Proxy-based breadth signal; higher scores reflect broader participation.</li>
          </ul>
        </div>
      )}

      {/* Component Breakdown for Liquidity Proxy */}
      {apiCode === "LIQUIDITY_PROXY" && liquidityComponents && liquidityComponents.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
          <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-xs md:text-sm text-stealth-400 mb-3 md:mb-4 break-all">
            Liquidity Proxy = z(M2 YoY%) + z(Fed BS Delta) - z(RRP Usage) {"->"} Smoothed {"->"} Stability Score
          </p>
          
          {/* Latest Component Values */}
          <div className="grid grid-cols-1 gap-3 md:gap-4 mb-4 md:mb-6">
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">M2 Money Supply</div>
              <div className="text-lg font-bold text-blue-400">
                {liquidityComponents[liquidityComponents.length - 1].m2_money_supply.yoy_pct.toFixed(2)}%
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                YoY Growth
              </div>
              <div className="text-xs text-stealth-500">
                Z-Score: {liquidityComponents[liquidityComponents.length - 1].m2_money_supply.z_score.toFixed(2)}
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Fed Balance Sheet</div>
              <div className="text-lg font-bold text-green-400">
                ${(liquidityComponents[liquidityComponents.length - 1].fed_balance_sheet.delta / 1000).toFixed(1)}B
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Monthly Delta
              </div>
              <div className="text-xs text-stealth-500">
                Z-Score: {liquidityComponents[liquidityComponents.length - 1].fed_balance_sheet.z_score.toFixed(2)}
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Reverse Repo (RRP)</div>
              <div className="text-lg font-bold text-purple-400">
                ${(liquidityComponents[liquidityComponents.length - 1].reverse_repo.value / 1000).toFixed(1)}B
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Usage Level
              </div>
              <div className="text-xs text-stealth-500">
                Z-Score: {liquidityComponents[liquidityComponents.length - 1].reverse_repo.z_score.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Component Z-Scores Chart */}
          <div className="h-80 mb-6">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Component Z-Scores Over Time</h4>
            {(() => {
              const { data, dateRange } = processComponentData(liquidityComponents, chartRange.days);
              
              return (
                <ComponentChart
                  data={data}
                  lines={[
                    { dataKey: "m2_money_supply.z_score", name: "M2 YoY%", stroke: getFamilyColor("liquidity") },
                    { dataKey: "fed_balance_sheet.z_score", name: "Fed BS Delta", stroke: getFamilyColor("liquidity", "muted") },
                    { dataKey: "reverse_repo.z_score", name: "RRP Usage", stroke: getFamilyColor("liquidity", "faint") }
                  ]}
                  referenceLines={[
                    { y: 0, stroke: getFamilyColor("benchmark"), label: "Neutral", labelFill: getFamilyColor("benchmark") }
                  ]}
                  yAxisLabel="Z-Score"
                  dateRange={dateRange}
                />
              );
            })()}
          </div>

          {/* Liquidity Stability Score Chart */}
          <div className="h-80">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Liquidity Stability Score (30-day smoothed)</h4>
            <p className="text-xs text-stealth-400 mb-2">
              Higher score = abundant liquidity (QE, M2 growth) | Lower score = liquidity drought (QT, RRP peak)
            </p>
            {(() => {
              const { data, dateRange } = processComponentData(liquidityComponents, chartRange.days);
              
              return (
                <ComponentChart
                  data={data}
                  lines={[
                    { dataKey: "composite.stress_score", name: "Liquidity Stress", stroke: getFamilyColor("liquidity"), strokeWidth: 3 }
                  ]}
                  referenceLines={[
                    { y: 60, stroke: statePalette.red, label: "HIGH STRESS", labelFill: statePalette.red },
                    { y: 30, stroke: statePalette.green, label: "LOW STRESS", labelFill: statePalette.green }
                  ]}
                  yAxisLabel="Stress Score (0-100)"
                  dateRange={dateRange}
                />
              );
            })()}
          </div>
        </div>
      )}

      {/* Component Breakdown for Analyst Confidence */}
      {apiCode === "ANALYST_ANXIETY" && analystAnxietyComponents && analystAnxietyComponents.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
          <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-xs md:text-sm text-stealth-400 mb-3 md:mb-4 break-all">
            Analyst Confidence measures institutional market calm through volatility and credit stress indicators. 
            Higher stability scores indicate high confidence and calm markets.
          </p>
          
          {/* Latest Component Values */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">VIX (Equity Vol)</div>
              <div className="text-lg font-bold text-blue-400">
                {analystAnxietyComponents[analystAnxietyComponents.length - 1].vix.value.toFixed(2)}
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Stability: {analystAnxietyComponents[analystAnxietyComponents.length - 1].vix.stability_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500">
                Weight: {(analystAnxietyComponents[analystAnxietyComponents.length - 1].vix.weight * 100).toFixed(0)}%
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">HY OAS (Credit)</div>
              <div className="text-lg font-bold text-red-400">
                {analystAnxietyComponents[analystAnxietyComponents.length - 1].hy_oas.value.toFixed(0)} bps
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Stability: {analystAnxietyComponents[analystAnxietyComponents.length - 1].hy_oas.stability_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500">
                Weight: {(analystAnxietyComponents[analystAnxietyComponents.length - 1].hy_oas.weight * 100).toFixed(0)}%
              </div>
            </div>
            
            {analystAnxietyComponents[analystAnxietyComponents.length - 1].move && (
              <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                <div className="text-xs text-stealth-400 mb-1">MOVE (Rates Vol)</div>
                <div className="text-lg font-bold text-yellow-400">
                  {analystAnxietyComponents[analystAnxietyComponents.length - 1].move!.value.toFixed(2)}
                </div>
                <div className="text-xs text-stealth-500 mt-1">
                  Stability: {analystAnxietyComponents[analystAnxietyComponents.length - 1].move!.stability_score.toFixed(1)}
                </div>
                <div className="text-xs text-stealth-500">
                  Weight: {(analystAnxietyComponents[analystAnxietyComponents.length - 1].move!.weight * 100).toFixed(0)}%
                </div>
              </div>
            )}
            
            {analystAnxietyComponents[analystAnxietyComponents.length - 1].erp_proxy && (
              <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                <div className="text-xs text-stealth-400 mb-1">ERP Proxy (BBB-10Y)</div>
                <div className="text-lg font-bold text-purple-400">
                  {analystAnxietyComponents[analystAnxietyComponents.length - 1].erp_proxy!.spread.toFixed(2)}%
                </div>
                <div className="text-xs text-stealth-500 mt-1">
                  Stability: {analystAnxietyComponents[analystAnxietyComponents.length - 1].erp_proxy!.stability_score.toFixed(1)}
                </div>
                <div className="text-xs text-stealth-500">
                  Weight: {(analystAnxietyComponents[analystAnxietyComponents.length - 1].erp_proxy!.weight * 100).toFixed(0)}%
                </div>
              </div>
            )}
          </div>

          {/* Component Stability Scores Chart (90-day default) */}
          <div className="h-80 mb-6">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Component Stability Scores (90-Day View)</h4>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              // Default to 90 days for Analyst Confidence as per spec
              daysBack.setDate(today.getDate() - 90);
              
              const chartData = analystAnxietyComponents
                .map(item => ({
                  ...item,
                  dateNum: new Date(item.date).getTime()
                }))
                .filter(item => item.dateNum >= daysBack.getTime());
              
              // Deduplicate by date
              const dateMap7 = new Map();
              chartData.forEach(item => dateMap7.set(item.date, item));
              const deduplicatedData7 = Array.from(dateMap7.values()).sort((a, b) => a.dateNum - b.dateNum);
              
              const maxDate = deduplicatedData7.length > 0 ? Math.max(...deduplicatedData7.map(d => d.dateNum)) : today.getTime();
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={deduplicatedData7} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), maxDate]}
                      scale="time"
                      tickFormatter={(v: number) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          year: "2-digit",
                        })
                      }
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      width={72}
                      tickMargin={8}
                      label={{ value: 'Stability Score (0-100)', angle: -90, position: 'insideLeft', fill: CHART_NEUTRAL.label, offset: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: CHART_NEUTRAL.tooltipBg,
                        borderColor: CHART_NEUTRAL.tooltipBorder,
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: CHART_NEUTRAL.label, marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="vix.stability_score"
                      name="VIX Stability"
                      stroke={getMetricColor("VIX")}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="hy_oas.stability_score"
                      name="Credit Stability"
                      stroke={getFamilyColor("credit")}
                      strokeWidth={2}
                      dot={false}
                    />
                    {deduplicatedData7.some(d => d.move) && (
                      <Line
                        type="monotone"
                        dataKey="move.stability_score"
                        name="MOVE Stability"
                        stroke={getFamilyColor("volatility", "muted")}
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                    {deduplicatedData7.some(d => d.erp_proxy) && (
                      <Line
                        type="monotone"
                        dataKey="erp_proxy.stability_score"
                        name="ERP Stability"
                        stroke={getFamilyColor("sentiment")}
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                    <ReferenceLine y={70} stroke={statePalette.green} strokeDasharray="3 3" label={{ value: 'GREEN', position: 'right', fill: statePalette.green }} />
                    <ReferenceLine y={40} stroke={statePalette.red} strokeDasharray="3 3" label={{ value: 'RED', position: 'right', fill: statePalette.red }} />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Composite Stability Score Chart (smooth Bezier style) */}
          <div className="h-80">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Composite Stability Score (90-Day Smooth)</h4>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - 90);
              
              const chartData = analystAnxietyComponents
                .map(item => ({
                  ...item,
                  dateNum: new Date(item.date).getTime()
                }))
                .filter(item => item.dateNum >= daysBack.getTime());
              
              // Deduplicate by date
              const dateMap8 = new Map();
              chartData.forEach(item => dateMap8.set(item.date, item));
              const deduplicatedData8 = Array.from(dateMap8.values()).sort((a, b) => a.dateNum - b.dateNum);
              
              const maxDate = deduplicatedData8.length > 0 ? Math.max(...deduplicatedData8.map(d => d.dateNum)) : today.getTime();
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={deduplicatedData8} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), maxDate]}
                      scale="time"
                      tickFormatter={(v: number) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          year: "2-digit",
                        })
                      }
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      width={72}
                      tickMargin={8}
                      label={{ value: 'Stability Score', angle: -90, position: 'insideLeft', fill: CHART_NEUTRAL.label, offset: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: CHART_NEUTRAL.tooltipBg,
                        borderColor: CHART_NEUTRAL.tooltipBorder,
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: CHART_NEUTRAL.label, marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="composite.stability_score"
                      name="Analyst Confidence Stability"
                      stroke={getFamilyColor("sentiment")}
                      strokeWidth={3}
                      dot={false}
                    />
                    <ReferenceLine y={70} stroke={statePalette.green} strokeDasharray="3 3" label={{ value: 'GREEN Threshold', position: 'insideTopRight', fill: statePalette.green, fontSize: 11 }} />
                    <ReferenceLine y={40} stroke={statePalette.red} strokeDasharray="3 3" label={{ value: 'RED Threshold', position: 'insideBottomRight', fill: statePalette.red, fontSize: 11 }} />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      )}

      {/* Component Breakdown for Sentiment Composite */}
      {apiCode === "SENTIMENT_COMPOSITE" && sentimentCompositeComponents && sentimentCompositeComponents.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
          <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-xs md:text-sm text-stealth-400 mb-3 md:mb-4 break-all">
            Consumer & Corporate Sentiment measures economic confidence through consumer and business surveys, 
            forward-looking demand indicators (new orders), and capital expenditure commitments.
          </p>
          
          {/* Latest Component Values */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Michigan Sentiment</div>
              <div className="text-lg font-bold text-blue-400">
                {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].michigan_sentiment.value.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Confidence: {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].michigan_sentiment.confidence_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500">
                Weight: {(sentimentCompositeComponents[sentimentCompositeComponents.length - 1].michigan_sentiment.weight * 100).toFixed(0)}%
              </div>
            </div>
            
            {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].nfib_optimism && (
              <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                <div className="text-xs text-stealth-400 mb-1">NFIB Small Biz</div>
                <div className="text-lg font-bold text-green-400">
                  {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].nfib_optimism!.value.toFixed(1)}
                </div>
                <div className="text-xs text-stealth-500 mt-1">
                  Confidence: {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].nfib_optimism!.confidence_score.toFixed(1)}
                </div>
                <div className="text-xs text-stealth-500">
                  Weight: {(sentimentCompositeComponents[sentimentCompositeComponents.length - 1].nfib_optimism!.weight * 100).toFixed(0)}%
                </div>
              </div>
            )}
            
            {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].ism_new_orders && (
              <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                <div className="text-xs text-stealth-400 mb-1">ISM New Orders</div>
                <div className="text-lg font-bold text-yellow-400">
                  {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].ism_new_orders!.value.toFixed(1)}
                </div>
                <div className="text-xs text-stealth-500 mt-1">
                  Confidence: {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].ism_new_orders!.confidence_score.toFixed(1)}
                </div>
                <div className="text-xs text-stealth-500">
                  Weight: {(sentimentCompositeComponents[sentimentCompositeComponents.length - 1].ism_new_orders!.weight * 100).toFixed(0)}%
                </div>
              </div>
            )}
            
            {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].capex_proxy && (
              <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
                <div className="text-xs text-stealth-400 mb-1">CapEx Orders (Billions)</div>
                <div className="text-lg font-bold text-purple-400">
                  ${(sentimentCompositeComponents[sentimentCompositeComponents.length - 1].capex_proxy!.value / 1000).toFixed(1)}B
                </div>
                <div className="text-xs text-stealth-500 mt-1">
                  Confidence: {sentimentCompositeComponents[sentimentCompositeComponents.length - 1].capex_proxy!.confidence_score.toFixed(1)}
                </div>
                <div className="text-xs text-stealth-500">
                  Weight: {(sentimentCompositeComponents[sentimentCompositeComponents.length - 1].capex_proxy!.weight * 100).toFixed(0)}%
                </div>
              </div>
            )}
          </div>

          {/* Component Confidence Scores Chart (365-day for monthly data) */}
          <div className="h-80 mb-6">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Component Confidence Scores (12-Month View)</h4>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - 365);
              
              const chartData = sentimentCompositeComponents
                .map(item => ({
                  ...item,
                  dateNum: new Date(item.date).getTime()
                }))
                .filter(item => item.dateNum >= daysBack.getTime());
              
              // Deduplicate by date
              const dateMap9 = new Map();
              chartData.forEach(item => dateMap9.set(item.date, item));
              const deduplicatedData9 = Array.from(dateMap9.values()).sort((a, b) => a.dateNum - b.dateNum);
              
              const maxDate = deduplicatedData9.length > 0 ? Math.max(...deduplicatedData9.map(d => d.dateNum)) : today.getTime();
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={deduplicatedData9} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), maxDate]}
                      scale="time"
                      tickFormatter={(v: number) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          year: "2-digit",
                        })
                      }
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      width={72}
                      tickMargin={8}
                      label={{ value: 'Confidence Score (0-100)', angle: -90, position: 'insideLeft', fill: CHART_NEUTRAL.label, offset: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: CHART_NEUTRAL.tooltipBg,
                        borderColor: CHART_NEUTRAL.tooltipBorder,
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: CHART_NEUTRAL.label, marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="michigan_sentiment.confidence_score"
                      name="Michigan"
                      stroke={getFamilyColor("sentiment")}
                      strokeWidth={2}
                      dot={false}
                    />
                    {chartData.some(d => d.nfib_optimism) && (
                      <Line
                        type="monotone"
                        dataKey="nfib_optimism.confidence_score"
                        name="NFIB"
                        stroke={getFamilyColor("sentiment", "muted")}
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                    {chartData.some(d => d.ism_new_orders) && (
                      <Line
                        type="monotone"
                        dataKey="ism_new_orders.confidence_score"
                        name="ISM"
                        stroke={getFamilyColor("growth")}
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                    {chartData.some(d => d.capex_proxy) && (
                      <Line
                        type="monotone"
                        dataKey="capex_proxy.confidence_score"
                        name="CapEx"
                        stroke={getFamilyColor("growth", "muted")}
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                    <ReferenceLine y={70} stroke={statePalette.green} strokeDasharray="3 3" label={{ value: 'GREEN', position: 'right', fill: statePalette.green }} />
                    <ReferenceLine y={40} stroke={statePalette.red} strokeDasharray="3 3" label={{ value: 'RED', position: 'right', fill: statePalette.red }} />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Composite Confidence Score Chart */}
          <div className="h-80">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Composite Confidence Score (12-Month View)</h4>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - 365);
              
              const chartData = sentimentCompositeComponents
                .map(item => ({
                  ...item,
                  dateNum: new Date(item.date).getTime()
                }))
                .filter(item => item.dateNum >= daysBack.getTime());
              
              // Deduplicate by date
              const dateMap10 = new Map();
              chartData.forEach(item => dateMap10.set(item.date, item));
              const deduplicatedData10 = Array.from(dateMap10.values()).sort((a, b) => a.dateNum - b.dateNum);
              
              const maxDate = deduplicatedData10.length > 0 ? Math.max(...deduplicatedData10.map(d => d.dateNum)) : today.getTime();
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={deduplicatedData10} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), maxDate]}
                      scale="time"
                      tickFormatter={(v: number) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          year: "2-digit",
                        })
                      }
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      width={72}
                      tickMargin={8}
                      label={{ value: 'Confidence Score', angle: -90, position: 'insideLeft', fill: CHART_NEUTRAL.label, offset: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: CHART_NEUTRAL.tooltipBg,
                        borderColor: CHART_NEUTRAL.tooltipBorder,
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: CHART_NEUTRAL.label, marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="composite.confidence_score"
                      name="Sentiment Composite"
                      stroke={getFamilyColor("sentiment")}
                      strokeWidth={3}
                      dot={false}
                    />
                    <ReferenceLine y={70} stroke={statePalette.green} strokeDasharray="3 3" label={{ value: 'GREEN Threshold', position: 'insideTopRight', fill: statePalette.green, fontSize: 11 }} />
                    <ReferenceLine y={40} stroke={statePalette.red} strokeDasharray="3 3" label={{ value: 'RED Threshold', position: 'insideBottomRight', fill: statePalette.red, fontSize: 11 }} />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      )}

      {/* Stale Data Warning */}
      {meta?.latest && (() => {
        const latestDate = new Date(meta.latest.timestamp);
        const now = new Date();
        const daysOld = Math.floor((now.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
        const isStale = daysOld > 45;
        
        return isStale ? (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <div className="text-yellow-400 text-xl">Warning</div>
              <div>
                <div className="text-yellow-400 font-semibold mb-1">Data May Be Delayed</div>
                <div className="text-sm text-stealth-300">
                  Latest data is from {latestDate.toLocaleDateString()} ({daysOld} days ago). 
                  This indicator may be affected by the government shutdown or delayed reporting.
                  Data will update automatically when new releases become available.
                </div>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      {/* Current Status */}
      {meta?.latest && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4">
            <div className="text-sm text-stealth-400 mb-1">Current Value</div>
            <div className="text-2xl font-bold text-stealth-100">
              {meta.latest.raw_value.toFixed(2)}
            </div>
          </div>
          
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4">
            <div className="text-sm text-stealth-400 mb-1">Stability Score</div>
            <div className="text-2xl font-bold text-stealth-100">
              {meta.latest.score}
              <span className="text-sm text-stealth-400 ml-1">/ 100</span>
            </div>
          </div>
          
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4">
            <div className="text-sm text-stealth-400 mb-1">Current State</div>
            <div className={`inline-block px-3 py-1 rounded-full border font-semibold ${
              meta.latest.state ? stateColor[meta.latest.state] : ""
            }`}>
              {meta.latest.state}
            </div>
            <div className="text-xs text-stealth-400 mt-2">
              {formatDateTime(meta.latest.timestamp)}
            </div>
          </div>
        </div>
      )}

      {/* Historical Charts */}
      <div className="space-y-6">
        {/* Raw Value History Chart - Hidden as it's redundant with Stability Score
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold text-stealth-100">
              Raw Value History ({chartRange.label})
            </h3>
            <div className="flex items-center gap-3">
              {refetchMessage && (
                <span className={`text-sm ${refetchMessage.startsWith('OK:') ? 'text-green-400' : 'text-red-400'}`}>
                  {refetchMessage}
                </span>
              )}
              <button
                onClick={handleClearAndRefetch}
                disabled={isRefetching}
                className="px-2 py-1 text-stealth-400 hover:text-stealth-200 disabled:text-stealth-600 disabled:cursor-not-allowed text-xs transition-colors flex items-center gap-1.5"
                title="Clear all data for this indicator and fetch fresh data from source"
              >
                {isRefetching ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="opacity-70">refetching...</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="opacity-70">refetch</span>
                  </>
                )}
              </button>
            </div>
          </div>
          <div className="h-80">
            {history && history.length > 0 ? (() => {
              const today = new Date();
              today.setHours(23, 59, 59, 999);
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              daysBack.setHours(0, 0, 0, 0);
              
              const lastPoint = history[history.length - 1];
              const lastDate = new Date(lastPoint.timestamp);
              
              const intermediatePoints = [];
              const currentDate = new Date(lastDate);
              currentDate.setMonth(currentDate.getMonth() + 1);
              currentDate.setDate(1);
              
              while (currentDate <= today) {
                intermediatePoints.push({
                  ...lastPoint,
                  timestamp: currentDate.toISOString(),
                  timestampNum: currentDate.getTime()
                });
                currentDate.setMonth(currentDate.getMonth() + 1);
              }
              
              if (intermediatePoints.length === 0 || intermediatePoints[intermediatePoints.length - 1].timestampNum < today.getTime()) {
                intermediatePoints.push({
                  ...lastPoint,
                  timestamp: today.toISOString(),
                  timestampNum: today.getTime()
                });
              }
              
              const chartData = [
                ...history.map(item => ({
                  ...item,
                  timestampNum: new Date(item.timestamp).getTime()
                })),
                ...intermediatePoints
              ].filter(item => item.timestampNum >= daysBack.getTime());
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ ...CHART_MARGIN, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="timestampNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
                      scale="time"
                      tickFormatter={(v: number) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      width={72}
                      tickMargin={8}
                      label={{ value: 'Raw Value', angle: -90, position: 'insideLeft', fill: CHART_NEUTRAL.label, offset: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: CHART_NEUTRAL.tooltipBg,
                        borderColor: CHART_NEUTRAL.tooltipBorder,
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: CHART_NEUTRAL.label, marginBottom: "8px" }}
                      itemStyle={{ color: CHART_NEUTRAL.text }}
                      formatter={(value: number) => [value.toFixed(2), "Value"]}
                      labelFormatter={(label: string | number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="raw_value"
                      stroke={getFamilyColor("system")}
                      strokeWidth={2}
                      dot={false}
                      animationDuration={CHART_ANIMATION.duration}
                      animationEasing={CHART_ANIMATION.easing}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              );
            })() : (
              <div className="flex items-center justify-center h-full text-stealth-400">
                No history available
              </div>
            )}
          </div>
        </div>
        */}
        
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">
            Stability Score History ({chartRange.label})
          </h3>
          <div className="h-80">
            {history && history.length > 0 ? (() => {
              const today = new Date();
              today.setHours(23, 59, 59, 999);
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              daysBack.setHours(0, 0, 0, 0);
              
              // Get the last data point
              const lastPoint = history[history.length - 1];
              const lastDate = new Date(lastPoint.timestamp);
              
              // Create monthly points from last data to today
              const intermediatePoints = [];
              const currentDate = new Date(lastDate);
              currentDate.setMonth(currentDate.getMonth() + 1);
              currentDate.setDate(1);
              
              while (currentDate <= today) {
                intermediatePoints.push({
                  ...lastPoint,
                  timestamp: currentDate.toISOString(),
                  timestampNum: currentDate.getTime()
                });
                currentDate.setMonth(currentDate.getMonth() + 1);
              }
              
              // Add today
              if (intermediatePoints.length === 0 || intermediatePoints[intermediatePoints.length - 1].timestampNum < today.getTime()) {
                intermediatePoints.push({
                  ...lastPoint,
                  timestamp: today.toISOString(),
                  timestampNum: today.getTime()
                });
              }
              
              const chartData = [
                ...history.map(item => ({
                  ...item,
                  timestampNum: new Date(item.timestamp).getTime()
                })),
                ...intermediatePoints
              ].filter(item => item.timestampNum >= daysBack.getTime());
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ ...CHART_MARGIN, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="timestampNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
                      scale="time"
                    tickFormatter={(v: number) =>
                      new Date(v).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                    stroke={CHART_NEUTRAL.axis}
                  />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                      stroke={CHART_NEUTRAL.axis}
                      width={72}
                      tickMargin={8}
                      label={{ value: 'Score (0-100)', angle: -90, position: 'insideLeft', fill: CHART_NEUTRAL.label, offset: 12 }}
                    />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CHART_NEUTRAL.tooltipBg,
                      borderColor: CHART_NEUTRAL.tooltipBorder,
                      borderRadius: "8px",
                      padding: "12px",
                    }}
                    labelStyle={{ color: CHART_NEUTRAL.label, marginBottom: "8px" }}
                    itemStyle={{ color: CHART_NEUTRAL.text }}
                    formatter={(value: number) => {
                      const score = Number(value);
                      const state = score < 30 ? "RED" : score < 60 ? "YELLOW" : "GREEN";
                      return [
                        <span key="value">
                          {score.toFixed(0)} <span className="text-stealth-400">({state})</span>
                        </span>,
                        "Score"
                      ];
                    }}
                    labelFormatter={(label: string | number) =>
                      new Date(label).toLocaleDateString()
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={getFamilyColor("system")}
                    strokeWidth={2}
                    dot={false}
                    animationDuration={CHART_ANIMATION.duration}
                    animationEasing={CHART_ANIMATION.easing}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
              );
            })() : (
              <div className="flex items-center justify-center h-full text-stealth-400">
                No history available
              </div>
            )}
          </div>
        </div>

        {/* State Trend Sparkline */}
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">
            State Trend
          </h3>
          <div className="flex items-center justify-center py-8">
            <StateSparkline history={history || []} width={800} height={40} />
          </div>
          <div className="flex justify-center gap-6 mt-4 text-sm text-stealth-400">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span>Green (Stable)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span>Yellow (Caution)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span>Red (Stress)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MuniStressPanel({
  data,
  loading,
  error,
  chartRangeDays,
}: {
  data: MuniSubsystemResponse | null;
  loading: boolean;
  error: string | null;
  chartRangeDays: number;
}) {
  if (loading) {
    return (
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
        <div className="flex justify-center py-6">
          <MarketLoading size={90} variant="pulse" label="Loading municipal stress data..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 text-red-200 p-4 rounded mb-6">
        Error loading municipal subsystem: {error}
      </div>
    );
  }

  if (!data || !data.series || data.series.length === 0) {
    return (
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
        <div className="text-stealth-400">No municipal subsystem data available.</div>
      </div>
    );
  }

  const formatValue = (value: number | null | undefined, unit?: string) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
    if (unit === "percent") return `${value.toFixed(2)}%`;
    return value.toFixed(2);
  };

  const trendClass = (trend?: string) => {
    switch (trend) {
      case "improving":
        return "text-green-400";
      case "worsening":
      case "deteriorating":
        return "text-red-400";
      case "stable":
        return "text-stealth-300";
      default:
        return "text-stealth-500";
    }
  };

  const seriesColors = (key: string) => {
    switch (key) {
      case "MUNI_LONG_SPREAD":
        return getFamilyColor("credit");
      case "SIFMA_INDEX":
        return getFamilyColor("liquidity");
      case "MUNI_CURVE_SLOPE_STABILITY":
        return getFamilyColor("rates");
      case "MUNI_REVENUE_PROXY":
        return getFamilyColor("system");
      default:
        return getFamilyColor("system");
    }
  };

  const hasLineData = (rows: any[], dataKey: string, minPoints = 2) => {
    let count = 0;
    for (const row of rows) {
      const value = row?.[dataKey];
      if (Number.isFinite(value)) {
        count += 1;
        if (count >= minPoints) return true;
      }
    }
    return false;
  };

  const orderedSeries = React.useMemo(() => {
    const weightMap = muniPublicSectorWeights;
    return [...data.series].sort((a, b) => {
      const weightA = weightMap[a.key as keyof typeof weightMap] ?? 0;
      const weightB = weightMap[b.key as keyof typeof weightMap] ?? 0;
      if ((a.is_live ?? true) !== (b.is_live ?? true)) {
        return (b.is_live ? 1 : 0) - (a.is_live ? 1 : 0);
      }
      return weightB - weightA;
    });
  }, [data.series]);

  const combined = React.useMemo(() => {
    const map = new Map<string, any>();
    data.series.forEach((series) => {
      series.history?.forEach((point) => {
        if (!point?.date) return;
        const existing = map.get(point.date) || { date: point.date };
        existing[`${series.key}_score`] = point.stability_score;
        map.set(point.date, existing);
      });
    });

    if (data.curve?.history) {
      data.curve.history.forEach((point) => {
        if (!point?.date) return;
        const existing = map.get(point.date) || { date: point.date };
        existing.curve_score = point.score;
        existing.curve_level = point.level;
        existing.curve_slope = point.slope;
        map.set(point.date, existing);
      });
    }

    return Array.from(map.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [data]);

  const { data: chartData, dateRange } = processComponentData(combined, chartRangeDays);
  const missingSeries = data.series.filter((series) => !(series.history && series.history.length > 0));
  const hasCurveLevel = hasLineData(chartData, "curve_level");
  const hasCurveSlope = hasLineData(chartData, "curve_slope");
  const hasCurveScore = hasLineData(chartData, "curve_score");

  return (
    <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-6">
      <div className="flex items-start justify-between flex-col gap-2 md:flex-row md:items-center mb-4">
        <div>
          <h3 className="text-lg md:text-xl font-semibold text-stealth-100">
            Public-sector credit &amp; funding stress
          </h3>
          <p className="text-xs md:text-sm text-stealth-400 mt-1 max-w-3xl">
            Isolates tax-exempt and public-finance funding conditions, which often move
            before stress appears in corporate credit or equities.
          </p>
        </div>
        <div className="text-xs text-stealth-500">
          {data.as_of && <div>As of {data.as_of}</div>}
          {data.composite && (
            <div className="mt-1">
              Coverage: {data.composite.coverage_live}/{data.composite.coverage_total}
              {data.composite.missing_keys?.length > 0 && (
                <span className="text-amber-400"> (missing: {data.composite.missing_keys.join(", ")})</span>
              )}
            </div>
          )}
        </div>
      </div>

      {data.relationship_signal && data.relationship_signal.state !== "GREEN" && (
        <div className="bg-stealth-900 border border-stealth-600 rounded p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stealth-400">{data.relationship_signal.name}</div>
            <div
              className={`text-xs font-semibold ${
                data.relationship_signal.state === "RED"
                  ? "text-red-400"
                  : "text-yellow-400"
              }`}
            >
              {data.relationship_signal.state}
            </div>
          </div>
          {data.relationship_signal.message && (
            <div className="text-xs text-stealth-300 mt-2">
              {data.relationship_signal.message}
            </div>
          )}
        </div>
      )}

      {data.composite && (
        <div className="bg-stealth-900 border border-stealth-600 rounded p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stealth-400">Composite Stability</div>
            <div className="text-xs text-stealth-500">
              Green ≥ {muniPublicSectorThresholds.green}, Yellow ≥ {muniPublicSectorThresholds.yellow}
            </div>
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <div className="text-2xl font-bold text-stealth-100">
              {data.composite.score !== null && data.composite.score !== undefined
                ? data.composite.score.toFixed(1)
                : "n/a"}
            </div>
            <div
              className={`text-sm font-semibold ${
                data.composite.state === "GREEN"
                  ? "text-green-400"
                  : data.composite.state === "YELLOW"
                  ? "text-yellow-400"
                  : data.composite.state === "RED"
                  ? "text-red-400"
                  : "text-stealth-400"
              }`}
            >
              {data.composite.state}
              {data.composite.near_threshold ? " ±" : ""}
            </div>
          </div>
          {data.composite.near_threshold && (
            <div className="text-xs text-amber-400 mt-1">
              Near {data.composite.near_threshold} boundary
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6">
        {orderedSeries.map((series) => (
          <div key={series.key} className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-stealth-400 mb-1">{series.label}</div>
              <div className="flex items-center gap-2">
                {series.is_live === false && (
                  <span className="text-[10px] text-stealth-300 bg-stealth-500/10 border border-stealth-500/30 px-2 py-0.5 rounded-full">
                    archived
                  </span>
                )}
                {series.is_proxy && (
                <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  proxy
                </span>
                )}
              </div>
            </div>
            <div className="text-lg font-bold" style={{ color: seriesColors(series.key) }}>
              {formatValue(series.latest?.value ?? null, series.unit)}
            </div>
            <div className="text-xs text-stealth-500 mt-1">
              Stability: {series.latest?.stability_score !== null && series.latest?.stability_score !== undefined ? series.latest?.stability_score.toFixed(0) : "n/a"}
            </div>
            <div className={`text-xs mt-1 ${trendClass(series.trend)}`}>
              Trend: {series.trend || "n/a"}
            </div>
            {series.stress_cues?.stress_level && series.stress_cues.stress_level !== "normal" && (
              <div className={`text-[11px] mt-1 ${series.stress_cues.stress_level === "severe" ? "text-red-400" : "text-amber-300"}`}>
                {series.stress_cues.stress_level === "severe" ? "Severe stress cue" : "Stress cue"}
              </div>
            )}
            {series.notes && (
              <div className="text-[11px] text-stealth-500 mt-2">{series.notes}</div>
            )}
          </div>
        ))}
      </div>

      {missingSeries.length > 0 && (
        <div className="text-[11px] text-stealth-500 mb-5">
          No recent data available for: {missingSeries.map((series) => series.label).join(", ")}.
        </div>
      )}

      <div className="bg-stealth-900 border border-stealth-700 rounded p-4 mb-6 text-xs text-stealth-400">
        <div className="text-stealth-200 font-semibold mb-2">Methodology (summary)</div>
        <div>
          Components &amp; default weights: Spread {(muniPublicSectorWeights.MUNI_LONG_SPREAD * 100).toFixed(0)}% ·
          SIFMA {(muniPublicSectorWeights.SIFMA_INDEX * 100).toFixed(0)}% · Slope Stability {(muniPublicSectorWeights.MUNI_CURVE_SLOPE_STABILITY * 100).toFixed(0)}% ·
          Revenue Proxy {(muniPublicSectorWeights.MUNI_REVENUE_PROXY * 100).toFixed(0)}%.
          Missing live inputs are dropped and remaining weights re-normalized.
        </div>
        <div className="mt-2">
          Stability scoring uses rolling z-scores with direction adjustment, mapped to 0–100.
          Composite states: Green ≥ {muniPublicSectorThresholds.green}, Yellow ≥ {muniPublicSectorThresholds.yellow}, Red &lt; {muniPublicSectorThresholds.yellow}.
        </div>
      </div>

      <div className="h-80 mb-6">
        <h4 className="text-sm font-semibold mb-2 text-stealth-200">Municipal Stability Scores</h4>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stealth-400">
            No history available
          </div>
        ) : (
          <ComponentChart
            data={chartData}
            lines={[
              ...data.series.map((series) => ({
                dataKey: `${series.key}_score`,
                name: series.label,
                stroke: seriesColors(series.key),
                conditional: (rows) => hasLineData(rows, `${series.key}_score`),
                connectNulls: true,
              })),
              ...(data.curve && data.curve.status !== "unavailable"
                ? [{
                    dataKey: "curve_score",
                    name: data.curve.label || "Muni Yield Curve",
                    stroke: getFamilyColor("system"),
                    strokeWidth: 3,
                    conditional: () => hasCurveScore,
                    connectNulls: true,
                  }]
                : []),
            ]}
            referenceLines={[
              { y: muniPublicSectorThresholds.green, stroke: statePalette.green, label: "GREEN", labelFill: statePalette.green },
              { y: muniPublicSectorThresholds.yellow, stroke: statePalette.red, label: "RED", labelFill: statePalette.red },
            ]}
            yAxisLabel="Stability Score (0-100)"
            yAxisDomain={[0, 100]}
            dateRange={dateRange}
          />
        )}
      </div>

      {data.curve?.status === "unavailable" ? (
        <div className="bg-stealth-900 border border-stealth-600 rounded p-4 text-xs text-stealth-400">
          Yield curve data unavailable: {data.curve.reason}
        </div>
      ) : data.curve?.history && data.curve.history.length > 0 ? (
        <div className="h-80">
          <h4 className="text-sm font-semibold mb-2 text-stealth-200">
            Municipal Yield Curve Structure (Level &amp; Slope)
          </h4>
          <ComponentChart
            data={chartData}
            lines={[
              {
                dataKey: "curve_level",
                name: "Long-End Level",
                stroke: getFamilyColor("rates"),
                conditional: () => hasCurveLevel,
                connectNulls: true,
              },
              {
                dataKey: "curve_slope",
                name: "10y-2y Slope",
                stroke: getFamilyColor("growth"),
                conditional: () => hasCurveSlope,
                connectNulls: true,
              },
            ]}
            yAxisLabel="Yield (%)"
            dateRange={dateRange}
          />
        </div>
      ) : null}
    </div>
  );
}
