import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import { IndicatorStatus } from "../types";
import {
  PieChart,
  Pie,
  Cell,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { apiFetch } from "../utils/apiUtils";
import MarketLoading from "../components/ui/MarketLoading";
import { 
  getStateFromScore, 
  getStateColor, 
  STATE_DESCRIPTIONS,
  STABILITY_THRESHOLDS,
  type StabilityState 
} from "../utils/stabilityConstants";
import { getFamilyColor } from "../theme/metricColors";

interface HeatmapDataPoint {
  date: string;
  indicator: string;
  state: string;
  score: number;
}

interface IndicatorHistoryPoint {
  timestamp: string;
  state: string;
  score: number;
}

interface IndicatorMetadata {
  code: string;
  name: string;
  weight: number;
  // Note: direction is a backend normalization detail, not exposed to UI
  // All scores displayed are stability scores (higher = better)
}

interface WeightedExampleRow {
  code: string;
  name: string;
  score: number;
  weight: number;
  contribution: number;
}

const getIndicatorDisplayName = (code: string, name: string) =>
  code === "ANALYST_ANXIETY" ? "Analyst Confidence" : name;

export default function SystemBreakdown() {
  const { data: indicators } = useApi<IndicatorStatus[]>("/indicators");
  const [metadata, setMetadata] = useState<IndicatorMetadata[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [breadthTrend, setBreadthTrend] = useState<"broadening" | "narrowing" | "steady">("steady");

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch indicator metadata from backend
        const indicatorData = await apiFetch<IndicatorStatus[]>("/indicators");
        
        const metaWithWeights: IndicatorMetadata[] = indicatorData.map((ind: IndicatorStatus) => ({
          code: ind.code,
          name: getIndicatorDisplayName(ind.code, ind.name),
          weight: ind.weight ?? 1.0,
        }));
        
        setMetadata(metaWithWeights);
        
        // Build data structure: Map<date, Map<indicator_code, {state, score}>>
        const dateIndicatorMap = new Map<string, Map<string, { state: string; score: number }>>();
        const indicatorCodes = indicatorData.map((ind: IndicatorStatus) => ind.code);
        
        await Promise.all(
          indicatorCodes.map(async (code: string) => {
            try {
              const data = await apiFetch<IndicatorHistoryPoint[]>(`/indicators/${code}/history?days=365`);

              if (Array.isArray(data)) {
                // Aggregate by date, keeping only the latest timestamp per day
                const dailyData = new Map<string, IndicatorHistoryPoint>();
                data.forEach((point) => {
                  const dateKey = point.timestamp.split('T')[0];
                  // Keep the latest timestamp for each date
                  if (!dailyData.has(dateKey) || point.timestamp > (dailyData.get(dateKey)?.timestamp ?? "")) {
                    dailyData.set(dateKey, point);
                  }
                });
                
                // Add consolidated daily data to main map
                dailyData.forEach((point, dateKey) => {
                  if (!dateIndicatorMap.has(dateKey)) {
                    dateIndicatorMap.set(dateKey, new Map());
                  }
                  const indicatorMap = dateIndicatorMap.get(dateKey)!;
                  const state = point.state || getStateFromScore(point.score);
                  indicatorMap.set(code, { state, score: point.score });
                });
              }
            } catch (error) {
              console.error(`Failed to fetch history for ${code}:`, error);
            }
          })
        );
        
        // Build heatmap visualization data
        const heatmapPoints: HeatmapDataPoint[] = [];
        
        // Get indicator names for heatmap
        const indicatorNames = new Map(
          indicatorData.map((ind: IndicatorStatus) => [
            ind.code,
            getIndicatorDisplayName(ind.code, ind.name),
          ])
        );
        
        // Process each date
        const sortedDates = Array.from(dateIndicatorMap.keys()).sort();
        sortedDates.forEach(date => {
          const indicatorMap = dateIndicatorMap.get(date)!;
          
          // Count state distribution for this date
          let redCount = 0;
          let yellowCount = 0;
          let greenCount = 0;
          
          // Populate heatmap data points for all indicators on this date
          indicatorCodes.forEach((code: string) => {
            const indicatorData = indicatorMap.get(code);
            if (indicatorData) {
              heatmapPoints.push({
                date,
                indicator: indicatorNames.get(code) || code,
                state: indicatorData.state,
                score: indicatorData.score,
              });
              
              // Increment state counters
              if (indicatorData.state === 'RED') redCount++;
              else if (indicatorData.state === 'YELLOW') yellowCount++;
              else greenCount++;
            }
          });
          
        });

        const breadthScores: number[] = [];
        sortedDates.forEach(date => {
          const indicatorMap = dateIndicatorMap.get(date);
          const breadthEntry = indicatorMap?.get("BREADTH_HEALTH");
          if (breadthEntry && Number.isFinite(breadthEntry.score)) {
            breadthScores.push(breadthEntry.score);
          }
        });
        if (breadthScores.length > 10) {
          const lookback = Math.min(30, breadthScores.length - 1);
          const delta = breadthScores[breadthScores.length - 1] - breadthScores[breadthScores.length - 1 - lookback];
          if (delta >= 3) {
            setBreadthTrend("broadening");
          } else if (delta <= -3) {
            setBreadthTrend("narrowing");
          } else {
            setBreadthTrend("steady");
          }
        } else {
          setBreadthTrend("steady");
        }
        
        setHeatmapData(heatmapPoints);
        
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch system breakdown data:", error);
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Direction field removed - all scores are stability scores (higher = better)
  // Backend handles normalization; frontend only displays final scores

  if (loading) {
    return (
      <div className="page-shell page-stack">
        <div className="flex flex-col">
          <span className="page-kicker">Methodology</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">System Breakdown</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">See how the composite state is built, how the indicators distribute over time, and where weight is concentrated.</p>
        </div>
        <div className="flex justify-center py-6">
          <MarketLoading size={110} variant="scan" label="Loading system overview..." />
        </div>
      </div>
    );
  }

  // Calculate current distribution
  const currentDistribution = indicators
    ? indicators.reduce(
        (acc, ind) => {
          acc[ind.state]++;
          return acc;
        },
        { GREEN: 0, YELLOW: 0, RED: 0 } as Record<string, number>
      )
    : { GREEN: 0, YELLOW: 0, RED: 0 };

  const pieData = [
    { name: "Green", value: currentDistribution.GREEN, color: getStateColor("GREEN") },
    { name: "Yellow", value: currentDistribution.YELLOW, color: getStateColor("YELLOW") },
    { name: "Red", value: currentDistribution.RED, color: getStateColor("RED") },
  ].filter(d => d.value > 0);

  const indicatorMap = new Map((indicators ?? []).map(ind => [ind.code, ind]));
  const totalWeight = metadata.reduce((sum, m) => sum + m.weight, 0);
  const indicatorCount = metadata.length || indicators?.length || 0;
  const weightedExampleRows: WeightedExampleRow[] = metadata
    .map((meta) => {
      const indicator = indicatorMap.get(meta.code);
      if (!indicator || !Number.isFinite(indicator.score)) {
        return null;
      }

      return {
        code: meta.code,
        name: meta.name,
        score: indicator.score,
        weight: meta.weight,
        contribution: indicator.score * meta.weight,
      };
    })
    .filter((row): row is WeightedExampleRow => row !== null);
  const weightedExampleTotal = weightedExampleRows.reduce((sum, row) => sum + row.contribution, 0);
  const exampleCompositeScore = totalWeight > 0 ? weightedExampleTotal / totalWeight : null;
  const exampleCompositeState = exampleCompositeScore !== null ? getStateFromScore(exampleCompositeScore) : null;
  const topWeightedSummary = [...metadata]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 3)
    .map((meta) => `${meta.name} (${meta.weight.toFixed(1)})`)
    .join(", ");

  return (
    <div className="page-shell page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Methodology</span>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">System Breakdown & Methodology</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Assess market regime with confidence, spot inflection points early, and align positioning with macroeconomic reality.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="page-badge">{indicatorCount} live inputs</span>
          <span className="page-badge">Breadth {breadthTrend}</span>
        </div>
      </div>

      {/* Overview Section */}
      <div className="surface-card-strong p-4 md:p-6">
        <div className="flex items-center gap-2 mb-3 md:mb-4">
          <h3 className="text-lg md:text-xl font-semibold text-stealth-100">System Overview</h3>
          <div className="group relative">
            <svg className="w-4 h-4 text-stealth-400 hover:text-stealth-200 cursor-help" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="invisible group-hover:visible absolute left-6 top-0 w-80 bg-stealth-850 border border-stealth-500 rounded-lg p-3 text-xs text-stealth-100 shadow-2xl z-10">
              Several indicators capture overlapping aspects of risk appetite (e.g., equity prices, breadth, liquidity). This redundancy is intentional, reflecting the empirical tendency for equity stress to propagate rapidly across financial conditions. Weights are capped to prevent any single domain from dominating the composite.
            </div>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-stealth-300 leading-relaxed mb-3 md:mb-4">
          This Market Diagnostic Dashboard provides a comprehensive, real-time assessment of market stability by monitoring 
          and analyzing <strong>{indicatorCount} critical indicators</strong> across seven domains: <strong>volatility</strong> (VIX),
          <strong>equities</strong> (SPY, Breadth Health), <strong>interest rates</strong> (T10Y2Y), <strong>employment</strong> (UNRATE),
          <strong>bonds</strong> (Bond Market Stability), <strong>liquidity</strong> (Liquidity Proxy), <strong>consumers</strong> (Consumer Health),
          <strong>sentiment</strong> (Analyst Confidence, Consumer & Corporate Sentiment), and <strong>sector positioning</strong> (Sector Regime Alignment).
          Each indicator is independently scored on a 0-100 scale using statistical normalization techniques, then combined into 
          a weighted composite score that reflects overall market health.
        </p>
        <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3 md:mb-4">
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">VIX + SPY</div>
            <div className="text-xs text-stealth-400">Volatility & Equity</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">Breadth Health</div>
            <div className="text-xs text-stealth-400">RSP/SPY + Sector ETFs</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">T10Y2Y</div>
            <div className="text-xs text-stealth-400">Yield Curve Spread</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">UNRATE</div>
            <div className="text-xs text-stealth-400">Employment</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">Consumer Health</div>
            <div className="text-xs text-stealth-400">PCE, PI, CPI + XLY/XLP</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">Bond Market</div>
            <div className="text-xs text-stealth-400">Credit + Curve + Volatility</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">Liquidity Proxy</div>
            <div className="text-xs text-stealth-400">M2 + Fed BS + RRP</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">Analyst Confidence</div>
            <div className="text-xs text-stealth-400">VIX + MOVE + HY OAS + ERP</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">Sentiment Composite</div>
            <div className="text-xs text-stealth-400">Michigan + NFIB + ISM + CapEx</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 text-center">
            <div className="text-xs font-semibold text-stealth-200">Sector Regime</div>
            <div className="text-xs text-stealth-400">Defensive vs Cyclical Alignment</div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 md:p-4">
            <div className="flex items-center gap-2 text-xl md:text-2xl mb-1 md:mb-2">
              <svg className="w-5 h-5 md:w-6 md:h-6" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill={getStateColor("GREEN")} />
              </svg>
              <span className="text-green-400">{STATE_DESCRIPTIONS.GREEN.label}</span>
            </div>
            <div className="text-xs text-stealth-400 mb-1">{STATE_DESCRIPTIONS.GREEN.range}</div>
            <div className="text-xs text-stealth-300">{STATE_DESCRIPTIONS.GREEN.description}</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 md:p-4">
            <div className="flex items-center gap-2 text-xl md:text-2xl mb-1 md:mb-2">
              <svg className="w-5 h-5 md:w-6 md:h-6" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill={getStateColor("YELLOW")} />
              </svg>
              <span className="text-yellow-400">{STATE_DESCRIPTIONS.YELLOW.label}</span>
            </div>
            <div className="text-xs text-stealth-400 mb-1">{STATE_DESCRIPTIONS.YELLOW.range}</div>
            <div className="text-xs text-stealth-300">{STATE_DESCRIPTIONS.YELLOW.description}</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded p-3 md:p-4">
            <div className="flex items-center gap-2 text-xl md:text-2xl mb-1 md:mb-2">
              <svg className="w-5 h-5 md:w-6 md:h-6" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill={getStateColor("RED")} />
              </svg>
              <span className="text-red-400">{STATE_DESCRIPTIONS.RED.label}</span>
            </div>
            <div className="text-xs text-stealth-400 mb-1">{STATE_DESCRIPTIONS.RED.range}</div>
            <div className="text-xs text-stealth-300">{STATE_DESCRIPTIONS.RED.description}</div>
          </div>
        </div>
      </div>

      {/* Current Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="surface-card p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">Current State Distribution</h3>
          <div className="flex items-center justify-center" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={100}
                  fill={getFamilyColor("benchmark")}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-card p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">State Ratios</h3>
          <div className="space-y-4 mt-8">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-green-400 font-semibold">Green</span>
                <span className="text-stealth-300">{currentDistribution.GREEN} / {indicators?.length || 0}</span>
              </div>
              <div className="w-full bg-stealth-900 rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full transition-all"
                  style={{ width: `${((currentDistribution.GREEN / (indicators?.length || 1)) * 100)}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-yellow-400 font-semibold">Yellow</span>
                <span className="text-stealth-300">{currentDistribution.YELLOW} / {indicators?.length || 0}</span>
              </div>
              <div className="w-full bg-stealth-900 rounded-full h-3">
                <div
                  className="bg-yellow-500 h-3 rounded-full transition-all"
                  style={{ width: `${((currentDistribution.YELLOW / (indicators?.length || 1)) * 100)}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-red-400 font-semibold">Red</span>
                <span className="text-stealth-300">{currentDistribution.RED} / {indicators?.length || 0}</span>
              </div>
              <div className="w-full bg-stealth-900 rounded-full h-3">
                <div
                  className="bg-red-500 h-3 rounded-full transition-all"
                  style={{ width: `${((currentDistribution.RED / (indicators?.length || 1)) * 100)}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Historical State Distribution Heatmap - Moved here */}
      <div className="surface-card p-4 md:p-6">
        <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100">Historical State Distribution (1 Year)</h3>
        <p className="text-xs sm:text-sm text-stealth-400 mb-3 md:mb-4">Each row represents an indicator. Color shows state: Green (healthy), Yellow (caution), Red (stress)</p>
        
        <div className="overflow-x-auto">
          <div style={{ minWidth: '800px' }}>
            {/* Get unique indicator names */}
            {Array.from(new Set(heatmapData.map(d => d.indicator))).sort().map((indicatorName) => {
              // Get all data points for this indicator, sorted by date
              const indicatorPoints = heatmapData
                .filter(d => d.indicator === indicatorName)
                .sort((a, b) => a.date.localeCompare(b.date));
              
              // Sample every Nth point to avoid too many cells
              const samplingRate = Math.max(1, Math.floor(indicatorPoints.length / 100));
              const sampledPoints = indicatorPoints.filter((_, idx) => idx % samplingRate === 0);
              
              return (
                <div key={indicatorName} className="mb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-48 text-xs text-stealth-300 font-medium truncate" title={indicatorName}>
                      {indicatorName}
                    </div>
                    <div className="flex-1 flex gap-0.5">
                      {sampledPoints.map((point, idx) => (
                        <div
                          key={idx}
                          className="flex-1 h-8 rounded-sm transition-opacity hover:opacity-75 cursor-pointer"
                          style={{ 
                            backgroundColor: getStateColor(point.state as StabilityState),
                            minWidth: '2px',
                          }}
                          title={`${point.date}: ${point.state} (${point.score.toFixed(1)})`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            
            {/* Time axis labels */}
            <div className="flex items-center gap-2 mt-4">
              <div className="w-48"></div>
              <div className="flex-1 flex justify-between text-xs text-stealth-400">
                <span>1 year ago</span>
                <span>6 months ago</span>
                <span>Today</span>
              </div>
            </div>
            
            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 justify-center text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getStateColor('GREEN') }}></div>
                <span className="text-stealth-300">
                  Green ({">="}{STABILITY_THRESHOLDS.YELLOW_MAX})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getStateColor('YELLOW') }}></div>
                <span className="text-stealth-300">Yellow ({STABILITY_THRESHOLDS.RED_MAX}-{STABILITY_THRESHOLDS.YELLOW_MAX - 1})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getStateColor('RED') }}></div>
                <span className="text-stealth-300">Red (&lt;{STABILITY_THRESHOLDS.RED_MAX})</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Composite Score Calculation */}
      <div className="collapsible-section" data-section="methodology">
        <button
          onClick={() => toggleSection('methodology')}
          className="collapsible-header"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-lg md:text-xl font-semibold text-stealth-100">Composite Score Calculation</h3>
          </div>
          <span className="text-stealth-400 text-xl">{expandedSections.has('methodology') ? '-' : '+'}</span>
        </button>
        {expandedSections.has('methodology') && (
          <div className="collapsible-content">
            <div className="space-y-4">
              <div className="bg-stealth-900/60 border border-stealth-700 rounded p-4 relative">
                <div className="group absolute top-4 right-4">
                  <svg className="w-4 h-4 text-stealth-400 hover:text-stealth-200 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <div className="invisible group-hover:visible absolute right-6 top-0 w-80 bg-stealth-850 border border-stealth-600 rounded-lg p-3 text-xs text-stealth-100 shadow-xl z-10">
                    Indicator state thresholds are derived from rolling historical distributions rather than fixed absolute levels, reducing sensitivity to long-term structural drift.
                  </div>
                </div>
                <div className="text-sm font-mono text-cyan-400 mb-3">
                  Composite Score = Sum (Indicator Score x Weight) / Sum Weights
                </div>
                <div className="text-xs text-stealth-300 space-y-2">
                  <p><strong>Step 1:</strong> Each indicator is normalized to a 0-100 stability score where higher scores indicate better market stability.</p>
                  <p><strong>Step 2:</strong> Individual scores are multiplied by their assigned weights to reflect importance.</p>
                  <p><strong>Step 3:</strong> Weighted scores are summed and divided by total weight to produce the composite.</p>
                  <p><strong>Step 4:</strong> The composite score is classified: GREEN ({">="}{STABILITY_THRESHOLDS.YELLOW_MAX}), YELLOW ({STABILITY_THRESHOLDS.RED_MAX}-{STABILITY_THRESHOLDS.YELLOW_MAX - 1}), or RED (&lt;{STABILITY_THRESHOLDS.RED_MAX}).</p>
                </div>
              </div>
              
              <div className="bg-stealth-900/60 border border-stealth-700 rounded p-4">
                <h4 className="text-sm font-semibold text-stealth-200 mb-2">Example Calculation</h4>
                <div className="text-xs font-mono text-stealth-300 space-y-1">
                  {weightedExampleRows.length > 0 ? (
                    <>
                      {weightedExampleRows.map((row) => (
                        <div key={row.code}>{row.name}: {row.score.toFixed(1)} x Weight: {row.weight.toFixed(1)} = {row.contribution.toFixed(1)}</div>
                      ))}
                      <div className="pt-2 border-t border-stealth-700 mt-2">
                        Total Weighted: {weightedExampleTotal.toFixed(1)} / Total Weight: {totalWeight.toFixed(1)} ={" "}
                        <strong
                          className={
                            exampleCompositeState === "GREEN"
                              ? "text-green-400"
                              : exampleCompositeState === "YELLOW"
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        >
                          {exampleCompositeScore?.toFixed(1)} {exampleCompositeState ? `(${exampleCompositeState})` : ""}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <div>Live indicator scores are unavailable, so the example calculation cannot be rendered.</div>
                  )}
                  <div className="text-stealth-400 text-xs mt-2">This panel uses the current live scores and weights shown above, so the example stays aligned with model updates.</div>
                </div>
              </div>
              
              <div className="bg-stealth-900/60 border border-stealth-700 rounded p-4">
                <h4 className="text-sm font-semibold text-stealth-200 mb-2">Data Timing & Lag Note</h4>
                <div className="text-xs text-stealth-300 leading-relaxed">
                  Several inputs (e.g., CPI, sentiment surveys) update with known reporting lags and revisions. 
                  The system reflects currently available information, not final historical values, and should be 
                  interpreted as a contemporaneous risk snapshot rather than a hindsight-optimized measure.
                  <div className="mt-2 space-y-1">
                    <div className="flex items-start gap-2">
                      <span className="text-stealth-500">-</span>
                      <span><strong className="text-stealth-400">Monthly indicators</strong> (CPI, PCE, Unemployment): ~2-4 week publication lag</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-stealth-500">-</span>
                      <span><strong className="text-stealth-400">Sentiment surveys</strong> (Michigan, NFIB, ISM): Released monthly with 1-2 week delay</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-stealth-500">-</span>
                      <span><strong className="text-stealth-400">Market data</strong> (VIX, SPY, yields): Real-time or 1-day lag</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Indicator Weights & Configuration */}
      <div className="collapsible-section" data-section="weights">
        <button
          onClick={() => toggleSection('weights')}
          className="collapsible-header"
        >
          <h3 className="text-lg md:text-xl font-semibold text-stealth-100">Indicator Weights & Configuration</h3>
          <span className="text-stealth-400 text-xl">{expandedSections.has('weights') ? '-' : '+'}</span>
        </button>
        {expandedSections.has('weights') && (
          <div className="collapsible-content">
            <p className="text-xs sm:text-sm text-stealth-300 mb-3 md:mb-4">
              Each indicator is assigned a weight based on its historical association with market stability shifts. 
              Weights reflect how strongly each metric influences the composite score and overall system state. The values below come directly from the live API configuration.
            </p>
            <div className="space-y-3">
              {metadata.map((meta) => {
                const indicator = indicators?.find(i => i.code === meta.code);
                const weightPercentage = ((meta.weight / totalWeight) * 100).toFixed(1);
                
                // Composite indicators with expandable details
                const compositeIndicators = ['BOND_MARKET_STABILITY', 'LIQUIDITY_PROXY', 'CONSUMER_HEALTH', 'ANALYST_ANXIETY', 'SENTIMENT_COMPOSITE', 'BREADTH_HEALTH'];
                const isComposite = compositeIndicators.includes(meta.code);
                const isExpanded = expandedSections.has(`indicator_${meta.code}`);
                
                // Detailed descriptions for each indicator
                const descriptions: Record<string, string> = {
                  VIX: "CBOE Volatility Index - Market fear gauge. Higher values indicate increased expected volatility and investor anxiety. Real-time measure of equity market stress.",
                  SPY: "S&P 500 ETF - 50-day EMA gap analysis. Measures momentum and trend strength of broad equity market. Negative gap (price below EMA) signals distribution and weakness.",
                  T10Y2Y: "10Y-2Y Treasury Spread - Yield curve indicator. Inversions (negative spread) have historically coincided with weaker growth regimes and tighter policy expectations.",
                  UNRATE: "Unemployment Rate - 6-month unemployment change tracks labor market momentum. Rising unemployment (positive change) signals deteriorating conditions and stress; falling unemployment indicates economic strength.",
                  CONSUMER_HEALTH: "Blends real consumer momentum from PCE, PI, and CPI with a 15% XLY/XLP wants-vs-needs overlay to capture whether discretionary appetite is confirming the macro data.",
                  BREADTH_HEALTH: `Three-part participation composite using RSP/SPY, sector participation above 50-day moving averages, and 20-day sector return breadth. Participation is currently ${breadthTrend}.`,
                  BOND_MARKET_STABILITY: "Composite of credit spreads (HY, IG), yield curve stress, rate momentum, and Treasury volatility. Captures systemic stress in fixed income markets.",
                  LIQUIDITY_PROXY: "Combines M2 money supply growth, Fed balance sheet changes, and overnight reverse repo usage. Measures systemic liquidity availability and tightness.",
                  ANALYST_ANXIETY: "Composite sentiment indicator aggregating VIX (equity vol), MOVE (rates vol), high-yield credit spreads, and equity risk premium. Captures institutional confidence.",
                  SENTIMENT_COMPOSITE: "Consumer & corporate confidence composite from Michigan Consumer Sentiment, business confidence, regional new-orders momentum, and CapEx commitments. Forward-looking demand indicator.",
                  SECTOR_REGIME_ALIGNMENT: "Checks whether defensive versus cyclical sector leadership matches the current market regime. Alignment is supportive; divergence is a warning signal."
                };
                
                return (
                  <div key={meta.code} className="bg-stealth-900/60 border border-stealth-700 rounded p-4">
                    <div 
                      className={`flex items-center justify-between mb-2 ${isComposite ? 'cursor-pointer hover:bg-stealth-800/50 -m-4 p-4 rounded-t' : ''}`}
                      onClick={isComposite ? () => toggleSection(`indicator_${meta.code}`) : undefined}
                    >
                      <div className="flex items-center gap-4">
                        <div className="font-semibold text-stealth-100 min-w-[180px]">{meta.name}</div>
                        <div className="text-sm text-stealth-400">
                          Weight: <span className="text-stealth-200 font-mono">{meta.weight.toFixed(1)}</span> ({weightPercentage}%)
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {indicator && (
                          <div className={`px-3 py-1 rounded font-semibold ${
                            indicator.state === "GREEN" ? "bg-green-500/20 text-green-400" :
                            indicator.state === "YELLOW" ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-red-500/20 text-red-400"
                          }`}>
                            {indicator.state}
                          </div>
                        )}
                        {isComposite && (
                          <span className="text-stealth-400 text-lg">{isExpanded ? '-' : '+'}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-stealth-400 mt-2">
                      {descriptions[meta.code] || "Market stability indicator"}
                    </div>
                    
                    {/* Expanded details for composite indicators */}
                    {isComposite && isExpanded && meta.code === 'BOND_MARKET_STABILITY' && (
                      <div className="mt-4 pt-4 border-t border-stealth-700 space-y-3 text-sm">
                        <div className="bg-stealth-950/80 border border-stealth-700/60 rounded p-3 space-y-2">
                          <div className="font-mono text-xs text-stealth-300">
                            <div className="mb-2"><strong className="text-stealth-200">Components (Normalized to Stability Scores):</strong></div>
                            <div className="ml-3 space-y-1">
                              <div>- <span className="text-blue-400">Credit Spread Stability (44%)</span>: HY OAS + IG OAS z-scores, inverted (narrow spreads = high score)</div>
                              <div>- <span className="text-blue-400">Yield Curve Stability (23%)</span>: 10Y-2Y, 10Y-3M, 30Y-5Y spreads, inverted (normal curve = high score)</div>
                              <div>- <span className="text-blue-400">Rates Momentum Stability (17%)</span>: 3-month ROC of 2Y and 10Y yields, inverted (stable rates = high score)</div>
                              <div>- <span className="text-blue-400">Treasury Volatility Stability (16%)</span>: 20-day rolling std dev of DGS10, inverted (low vol = high score)</div>
                            </div>
                          </div>
                          <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
                            composite_stability = (0.44 x credit_stability) + (0.23 x curve_stability) + (0.17 x momentum_stability) + (0.16 x volatility_stability)
                            <br />
                            <span className="text-stealth-500">// All components normalized so higher score = more stable bond markets</span>
                          </div>
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Rationale:</strong> Bond markets are leading indicators of systemic stress. 
                          Credit spreads often widen ahead of equity stress, yield curves invert during tighter cycles, and Treasury volatility spikes during 
                          liquidity crises. This composite captures bond market health where higher scores indicate stable fixed income conditions.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          Bond Market Stability: Evaluates Treasury behavior and corporate credit risk to assess whether
                          broad bond markets are functioning normally.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          Public-Sector Credit &amp; Funding Stress: Isolates tax-exempt and public-finance funding conditions, which often move
                          before stress appears in corporate credit or equities.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          These systems usually move together. When public-sector funding tightens
                          while corporate credit remains calm, the divergence itself is the signal.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Typical Ranges (Stability Score):</strong> 
                          <span className="ml-2 text-emerald-400">HIGH: 70-100</span> (stable credit, normal curves, low vol) - 
                          <span className="ml-2 text-yellow-400">MODERATE: 40-69</span> (widening spreads, curve flattening) - 
                          <span className="ml-2 text-red-400">LOW: 0-39</span> (credit stress, inversions, volatility spikes)
                        </div>
                      </div>
                    )}

                    {isComposite && isExpanded && meta.code === 'BREADTH_HEALTH' && (
                      <div className="mt-4 pt-4 border-t border-stealth-700 space-y-3 text-sm">
                        <div className="bg-stealth-950/80 border border-stealth-700/60 rounded p-3 space-y-2">
                          <div className="font-mono text-xs text-stealth-300">
                            <div className="mb-2"><strong className="text-stealth-200">What it measures:</strong></div>
                            <div className="ml-3 space-y-1">
                              <div>- <span className="text-blue-400">RSP/SPY ratio (35%)</span>: equal-weight vs cap-weight participation, with a 65/35 blend of level and 30-day trend</div>
                              <div>- <span className="text-blue-400">Sector participation (40%)</span>: share of 11 SPDR sector ETFs trading above their 50-day moving average</div>
                              <div>- <span className="text-blue-400">Sector return breadth (25%)</span>: share of sectors with a positive 20-day return</div>
                            </div>
                          </div>
                          <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
                            rsp_component = 0.65 x normalize(RSP/SPY level) + 0.35 x normalize(30d change)
                            <br />
                            participation_component = normalize(% sectors above 50d MA)
                            <br />
                            return_breadth_component = normalize(% sectors with positive 20d return)
                            <br />
                            stability_score = (0.35 x rsp_component) + (0.40 x participation_component) + (0.25 x return_breadth_component)
                            <br />
                            <span className="text-stealth-500">// Higher score = broader, healthier participation beyond mega-cap leadership</span>
                          </div>
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Interpretation:</strong> High scores mean more sectors are confirming the move. Low scores mean the tape is being carried by a narrow leadership cohort.
                        </div>
                      </div>
                    )}
                    
                    {isComposite && isExpanded && meta.code === 'LIQUIDITY_PROXY' && (
                      <div className="mt-4 pt-4 border-t border-stealth-700 space-y-3 text-sm">
                        <div className="bg-stealth-950/80 border border-stealth-700/60 rounded p-3 space-y-2">
                          <div className="font-mono text-xs text-stealth-300">
                            <div className="mb-2"><strong className="text-stealth-200">Components (Normalized to Stability Scores):</strong></div>
                            <div className="ml-3 space-y-1">
                              <div>- <span className="text-purple-400">M2 Money Supply</span>: Year-over-year % growth (higher growth = more liquidity)</div>
                              <div>- <span className="text-purple-400">Fed Balance Sheet</span>: Month-over-month delta (QE expansion = more liquidity)</div>
                              <div>- <span className="text-purple-400">Reverse Repo (RRP)</span>: Daily usage level (lower usage = more market liquidity)</div>
                            </div>
                          </div>
                          <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
                            liquidity_z = z_score(M2_YoY) + z_score(Delta_FedBS) - z_score(RRP_level)
                            <br />
                            smoothed_liquidity = moving_average_30day(liquidity_z)
                            <br />
                            final_stability_score = normalize(smoothed_liquidity, direction=-1)
                            <br />
                            <span className="text-stealth-500">// Higher liquidity z-score {"->"} higher stability score (direction=-1 preserves positive values)</span>
                          </div>
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Rationale:</strong> Liquidity is the lifeblood of markets. When M2 grows and the 
                          Fed expands its balance sheet (QE), asset prices rise across the board. When the Fed tightens (QT) and RRP usage surges 
                          (indicating idle reserves), liquidity drains from markets, causing broad-based sell-offs. Higher scores indicate abundant liquidity.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Typical Ranges (Stability Score):</strong> 
                          <span className="ml-2 text-emerald-400">HIGH: 70-100</span> (M2 growth, QE, low RRP) - 
                          <span className="ml-2 text-yellow-400">MODERATE: 40-69</span> (slowing M2, neutral Fed) - 
                          <span className="ml-2 text-red-400">LOW: 0-39</span> (M2 decline, QT, RRP peak)
                        </div>
                      </div>
                    )}
                    
                    {isComposite && isExpanded && meta.code === 'CONSUMER_HEALTH' && (
                      <div className="mt-4 pt-4 border-t border-stealth-700 space-y-3 text-sm">
                        <div className="bg-stealth-950/80 border border-stealth-700/60 rounded p-3 space-y-2">
                          <div className="font-mono text-xs text-stealth-300">
                            <div className="mb-2"><strong className="text-stealth-200">Components:</strong></div>
                            <div className="ml-3 space-y-1">
                              <div>- <span className="text-green-400">Personal Consumption Expenditures (PCE)</span>: Month-over-month % change</div>
                              <div>- <span className="text-green-400">Personal Income (PI)</span>: Month-over-month % change</div>
                              <div>- <span className="text-green-400">Consumer Price Index (CPI)</span>: Month-over-month % change (inflation baseline)</div>
                              <div>- <span className="text-green-400">XLY/XLP ratio</span>: discretionary versus staples leadership, blended in at 15% when market data is available</div>
                            </div>
                          </div>
                          <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
                            real_spending = PCE_MoM% - CPI_MoM%
                            <br />
                            real_income = PI_MoM% - CPI_MoM%
                            <br />
                            macro_consumer_health = average(real_spending, real_income)
                            <br />
                            stability_score = (0.85 x normalize(macro_consumer_health)) + (0.15 x normalize(XLY/XLP))
                            <br />
                            <span className="text-stealth-500">// Positive macro spreads and discretionary leadership both support higher consumer-health stability</span>
                          </div>
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Rationale:</strong> Consumer spending drives ~70% of US GDP. When real incomes rise and 
                          consumers can afford to spend freely, economic growth accelerates. When inflation outpaces income/spending growth, consumers 
                          cut discretionary spending, causing economic contraction. The XLY/XLP overlay helps confirm whether discretionary demand is actually showing up in market behavior.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Typical Ranges (Stability Score):</strong> 
                          <span className="ml-2 text-emerald-400">HEALTHY: 70-100</span> (real growth outpacing inflation) - 
                          <span className="ml-2 text-yellow-400">NEUTRAL: 40-69</span> (keeping pace with inflation) - 
                          <span className="ml-2 text-red-400">STRESS: 0-39</span> (inflation eroding power)
                        </div>
                      </div>
                    )}
                    
                    {isComposite && isExpanded && meta.code === 'ANALYST_ANXIETY' && (
                      <div className="mt-4 pt-4 border-t border-stealth-700 space-y-3 text-sm">
                        <div className="bg-stealth-950/80 border border-stealth-700/60 rounded p-3 space-y-2">
                          <div className="font-mono text-xs text-stealth-300">
                            <div className="mb-2"><strong className="text-stealth-200">Components (Normalized to Stability Scores):</strong></div>
                            <div className="ml-3 space-y-1">
                              <div>- <span className="text-red-400">VIX (Equity Volatility) - 40%</span>: CBOE Volatility Index (inverted: low VIX = high score)</div>
                              <div>- <span className="text-red-400">MOVE Index (Rates Volatility) - 25%</span>: Bond market volatility (inverted: low MOVE = high score)</div>
                              <div>- <span className="text-red-400">HY OAS (Credit Stress) - 25%</span>: High-yield spreads (inverted: narrow spreads = high score)</div>
                              <div>- <span className="text-red-400">ERP Proxy (Risk Premium) - 10%</span>: BBB yield minus 10Y Treasury (inverted: low premium = high score)</div>
                            </div>
                          </div>
                          <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
                            component_stability = 100 - (((z_blended + 3) / 6) x 100)
                            <br />
                            composite_stability = Sum(component_stability x weight)
                            <br />
                            <span className="text-stealth-500">// Higher score = calm markets (low anxiety), Lower score = fearful markets (high anxiety)</span>
                          </div>
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Rationale:</strong> Institutional investors manage trillions and react quickly 
                          to perceived risks. When VIX spikes, MOVE rises, credit spreads widen, and equity risk premiums expand, it signals professionals 
                          are hedging aggressively. These fear indicators typically precede retail panic. Higher scores indicate calm, confident markets.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Typical Ranges (Stability Score):</strong> 
                          <span className="ml-2 text-emerald-400">CALM: 70-100</span> (VIX &lt;20, low spreads, confident) - 
                          <span className="ml-2 text-yellow-400">ELEVATED: 40-69</span> (VIX 20-30, cautious) - 
                          <span className="ml-2 text-red-400">ANXIOUS: 0-39</span> (VIX &gt;30, panic hedging)
                        </div>
                      </div>
                    )}
                    
                    {isComposite && isExpanded && meta.code === 'SENTIMENT_COMPOSITE' && (
                      <div className="mt-4 pt-4 border-t border-stealth-700 space-y-3 text-sm">
                        <div className="bg-stealth-950/80 border border-stealth-700/60 rounded p-3 space-y-2">
                          <div className="font-mono text-xs text-stealth-300">
                            <div className="mb-2"><strong className="text-stealth-200">Components (Normalized to Stability Scores):</strong></div>
                            <div className="ml-3 space-y-1">
                              <div>- <span className="text-yellow-400">Michigan Consumer Sentiment - 30%</span>: Consumer confidence (higher = more confident)</div>
                              <div>- <span className="text-yellow-400">NFIB Small Business Optimism - 30%</span>: Business owner confidence (higher = more optimistic)</div>
                              <div>- <span className="text-yellow-400">Regional New Orders Proxy - 25%</span>: Forward demand indicator based on current regional factory surveys</div>
                              <div>- <span className="text-yellow-400">CapEx Proxy (Capital Goods Orders) - 15%</span>: Corporate investment (higher = more investment)</div>
                            </div>
                          </div>
                          <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
                            confidence_score(component) = ((z + 3) / 6) x 100 {"->"} [0, 100]
                            <br />
                            composite_confidence = Sum(confidence_score x weight)
                            <br />
                            <span className="text-stealth-500">// Higher confidence = willingness to spend/invest/expand = higher stability</span>
                          </div>
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Rationale:</strong> Economic activity is driven by confidence. 
                          When consumers feel optimistic, they make big purchases. When businesses are confident, they hire and invest. 
                          New orders and CapEx represent commitments made today that drive production 3-12 months forward. Higher scores indicate stronger confidence.
                        </div>
                        <div className="text-stealth-400 text-xs">
                          <strong className="text-stealth-300">Typical Ranges (Stability Score):</strong> 
                          <span className="ml-2 text-emerald-400">OPTIMISTIC: 70-100</span> (Michigan 90+, NFIB 100+, strong CapEx) - 
                          <span className="ml-2 text-yellow-400">CAUTIOUS: 40-69</span> (Michigan 70-90, moderate activity) - 
                          <span className="ml-2 text-red-400">PESSIMISTIC: 0-39</span> (Michigan &lt;70, contraction signals)
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-stealth-600">
              <div className="text-sm text-stealth-400 mb-2">
                Total Weight: <span className="text-stealth-200 font-mono">{totalWeight.toFixed(1)}</span>
              </div>
              <div className="text-xs text-stealth-500">
                Note: Weights are calibrated in the backend based on historical diagnostic relevance and are exposed live through the API. 
                Highest current weights: {topWeightedSummary || "Unavailable"}. All indicators output stability scores where higher values indicate better market conditions.
                <br /><br />
                <strong className="text-stealth-400">Tip:</strong> Click on any expandable indicator (Bond Market Stability, Liquidity Proxy, Consumer Health, 
                Analyst Confidence, Consumer & Corporate Sentiment, or Breadth Health) to view calculation notes and context.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Known Limitations */}
      <div className="bg-gradient-to-br from-red-950/20 to-stealth-850 border border-red-900/30 rounded-lg p-4 md:p-6 mt-4 md:mt-6">
        <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Known Limitations
        </h3>
        <div className="space-y-3">
          <div className="bg-stealth-900/50 border border-stealth-700 rounded p-3">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <div className="text-sm font-semibold text-stealth-200 mb-1">Exogenous Shock Risk</div>
                <div className="text-xs text-stealth-400">Does not capture geopolitical events, sudden policy announcements, or black swan events that can rapidly shift market conditions outside historical patterns.</div>
              </div>
            </div>
          </div>
          <div className="bg-stealth-900/50 border border-stealth-700 rounded p-3">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              <div>
                <div className="text-sm font-semibold text-stealth-200 mb-1">Macro Indicator Lag</div>
                <div className="text-xs text-stealth-400">Economic indicators (CPI, employment, sentiment) update monthly and may lag rapid market repricing by days or weeks during high-volatility periods.</div>
              </div>
            </div>
          </div>
          <div className="bg-stealth-900/50 border border-stealth-700 rounded p-3">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              <div>
                <div className="text-sm font-semibold text-stealth-200 mb-1">Daily Context Only</div>
                <div className="text-xs text-stealth-400">Designed for daily strategic context and risk assessment, not intraday signal generation or high-frequency trading decisions.</div>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 p-3 bg-stealth-900/30 border border-stealth-700 rounded">
          <p className="text-xs text-stealth-400 leading-relaxed">
            <strong className="text-stealth-300">Important:</strong> This dashboard is a decision support tool, not a trading signal. 
            Always combine quantitative metrics with fundamental analysis, risk management, and professional judgment. 
            Past statistical patterns do not guarantee future market behavior.
          </p>
        </div>
      </div>
    </div>
  );
}
