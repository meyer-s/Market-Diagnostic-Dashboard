import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import { IndicatorStatus } from "../types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface SystemHistoryPoint {
  timestamp: string;
  composite_score: number;
  state: string;
  red_count: number;
  yellow_count: number;
  green_count: number;
}

interface IndicatorMetadata {
  code: string;
  name: string;
  weight: number;
  direction: number;
}

export default function SystemBreakdown() {
  const { data: indicators } = useApi<IndicatorStatus[]>("/indicators");
  const [metadata, setMetadata] = useState<IndicatorMetadata[]>([]);
  const [history, setHistory] = useState<SystemHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch indicator metadata from backend
        const metaResponse = await fetch("http://localhost:8000/indicators");
        const indicatorData = await metaResponse.json();
        
        // For now, we'll use hardcoded weights (should come from backend)
        const metaWithWeights: IndicatorMetadata[] = indicatorData.map((ind: IndicatorStatus) => ({
          code: ind.code,
          name: ind.name,
          weight: getIndicatorWeight(ind.code),
          direction: getIndicatorDirection(ind.code),
        }));
        
        setMetadata(metaWithWeights);
        
        // Generate historical composite data (would need backend endpoint)
        const mockHistory: SystemHistoryPoint[] = [];
        const now = new Date();
        for (let i = 365; i >= 0; i--) {
          const timestamp = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const variation = Math.random() * 20 - 10;
          const baseScore = 65 + variation;
          const score = Math.max(0, Math.min(100, baseScore));
          
          const redCount = score < 40 ? Math.floor(Math.random() * 3) + 1 : 0;
          const yellowCount = score < 70 ? Math.floor(Math.random() * 2) + 1 : 0;
          const greenCount = 6 - redCount - yellowCount;
          
          mockHistory.push({
            timestamp: timestamp.toISOString(),
            composite_score: score,
            state: score < 40 ? "RED" : score < 70 ? "YELLOW" : "GREEN",
            red_count: redCount,
            yellow_count: yellowCount,
            green_count: greenCount,
          });
        }
        setHistory(mockHistory);
        
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch system breakdown data:", error);
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Helper functions for weights and directions (should come from backend)
  const getIndicatorWeight = (code: string): number => {
    const weights: Record<string, number> = {
      VIX: 1.8,
      SPY: 1.5,
      DFF: 1.2,
      T10Y2Y: 1.5,
      UNRATE: 1.3,
      CONSUMER_HEALTH: 1.5,
    };
    return weights[code] || 1.0;
  };

  const getIndicatorDirection = (code: string): number => {
    const directions: Record<string, number> = {
      VIX: -1,
      SPY: 1,
      DFF: -1,
      T10Y2Y: 1,
      UNRATE: -1,
      CONSUMER_HEALTH: -1,
    };
    return directions[code] || 1;
  };

  if (loading) {
    return (
      <div className="p-6 text-gray-200">
        <h2 className="text-2xl font-bold mb-6">System Breakdown</h2>
        <div className="animate-pulse space-y-4">
          <div className="h-64 bg-stealth-800 rounded"></div>
          <div className="h-64 bg-stealth-800 rounded"></div>
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
    { name: "Green", value: currentDistribution.GREEN, color: "#10b981" },
    { name: "Yellow", value: currentDistribution.YELLOW, color: "#eab308" },
    { name: "Red", value: currentDistribution.RED, color: "#ef4444" },
  ].filter(d => d.value > 0);

  // Prepare chart data with numeric timestamps
  const chartData = history.map(point => ({
    ...point,
    timestampNum: new Date(point.timestamp).getTime(),
  }));

  const totalWeight = metadata.reduce((sum, m) => sum + m.weight, 0);

  return (
    <div className="p-6 text-gray-200">
      <h2 className="text-2xl font-bold mb-6">System Breakdown & Methodology</h2>

      {/* Overview Section */}
      <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-stealth-100">System Overview</h3>
        <p className="text-sm text-stealth-300 leading-relaxed mb-4">
          This Market Diagnostic Dashboard provides a comprehensive, real-time assessment of market stability by monitoring 
          and analyzing <strong>eight critical indicators</strong> across five domains: <strong>volatility</strong> (VIX), 
          <strong>equities</strong> (SPY), <strong>interest rates</strong> (DFF, T10Y2Y), <strong>employment</strong> (UNRATE), 
          <strong>bonds</strong> (Bond Market Stability), <strong>liquidity</strong> (Liquidity Proxy), and <strong>consumers</strong> (Consumer Health). 
          Each indicator is independently scored on a 0-100 scale using statistical normalization techniques, then combined into 
          a weighted composite score that reflects overall market health.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 text-center">
            <div className="text-2xl mb-1">📈</div>
            <div className="text-xs font-semibold text-stealth-200">VIX + SPY</div>
            <div className="text-xs text-stealth-400">Volatility & Equity</div>
          </div>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 text-center">
            <div className="text-2xl mb-1">💵</div>
            <div className="text-xs font-semibold text-stealth-200">DFF + T10Y2Y</div>
            <div className="text-xs text-stealth-400">Rates & Yield Curve</div>
          </div>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 text-center">
            <div className="text-2xl mb-1">🏢</div>
            <div className="text-xs font-semibold text-stealth-200">UNRATE</div>
            <div className="text-xs text-stealth-400">Employment</div>
          </div>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 text-center">
            <div className="text-2xl mb-1">🛒</div>
            <div className="text-xs font-semibold text-stealth-200">Consumer Health</div>
            <div className="text-xs text-stealth-400">PCE, PI, CPI</div>
          </div>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 text-center">
            <div className="text-2xl mb-1">📊</div>
            <div className="text-xs font-semibold text-stealth-200">Bond Market</div>
            <div className="text-xs text-stealth-400">Credit + Curve + Volatility</div>
          </div>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 text-center">
            <div className="text-2xl mb-1">💧</div>
            <div className="text-xs font-semibold text-stealth-200">Liquidity Proxy</div>
            <div className="text-xs text-stealth-400">M2 + Fed BS + RRP</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <div className="text-green-400 text-2xl mb-2">🟢 GREEN</div>
            <div className="text-xs text-stealth-400 mb-1">Composite Score: 0-39</div>
            <div className="text-xs text-stealth-300">Market conditions are <strong>stable</strong>. Low volatility, healthy growth, minimal systemic risks.</div>
          </div>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <div className="text-yellow-400 text-2xl mb-2">🟡 YELLOW</div>
            <div className="text-xs text-stealth-400 mb-1">Composite Score: 40-69</div>
            <div className="text-xs text-stealth-300">Market shows <strong>caution signals</strong>. Increased volatility, mixed indicators, elevated monitoring required.</div>
          </div>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <div className="text-red-400 text-2xl mb-2">🔴 RED</div>
            <div className="text-xs text-stealth-400 mb-1">Composite Score: 70-100</div>
            <div className="text-xs text-stealth-300">Market under <strong>stress</strong>. High volatility, recession signals, significant systemic concerns.</div>
          </div>
        </div>
      </div>

      {/* Composite Score Calculation */}
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-stealth-100">Composite Score Calculation</h3>
        <div className="space-y-4">
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <div className="text-sm font-mono text-cyan-400 mb-3">
              Composite Score = Σ (Indicator Score × Weight) / Σ Weights
            </div>
            <div className="text-xs text-stealth-300 space-y-2">
              <p><strong>Step 1:</strong> Each indicator is normalized to a 0-100 scale where lower scores indicate better market stability.</p>
              <p><strong>Step 2:</strong> Individual scores are multiplied by their assigned weights to reflect importance.</p>
              <p><strong>Step 3:</strong> Weighted scores are summed and divided by total weight to produce the composite.</p>
              <p><strong>Step 4:</strong> The composite score is classified: GREEN (&lt;40), YELLOW (40-69), or RED (≥70).</p>
            </div>
          </div>
          
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <h4 className="text-sm font-semibold text-stealth-200 mb-2">Example Calculation</h4>
            <div className="text-xs font-mono text-stealth-300 space-y-1">
              <div>VIX Score: 45 × Weight: 1.8 = 81.0</div>
              <div>SPY Score: 30 × Weight: 1.5 = 45.0</div>
              <div>DFF Score: 50 × Weight: 1.2 = 60.0</div>
              <div>T10Y2Y Score: 35 × Weight: 1.5 = 52.5</div>
              <div>UNRATE Score: 25 × Weight: 1.3 = 32.5</div>
              <div>CONSUMER_HEALTH Score: 40 × Weight: 1.5 = 60.0</div>
              <div className="pt-2 border-t border-stealth-700 mt-2">Total Weighted: 331.0 / Total Weight: 8.8 = <strong className="text-yellow-400">37.6 (GREEN)</strong></div>
            </div>
          </div>
        </div>
      </div>

      {/* Indicator Weights */}
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-stealth-100">Indicator Weights & Configuration</h3>
        <p className="text-sm text-stealth-300 mb-4">
          Each indicator is assigned a weight based on its historical significance in predicting market instability. 
          Weights reflect how strongly each metric influences the composite score and overall system state.
        </p>
        <div className="space-y-3">
          {metadata.map((meta) => {
            const indicator = indicators?.find(i => i.code === meta.code);
            const weightPercentage = ((meta.weight / totalWeight) * 100).toFixed(1);
            
            // Detailed descriptions for each indicator
            const descriptions: Record<string, string> = {
              VIX: "CBOE Volatility Index - Market fear gauge. Higher values indicate increased expected volatility and investor anxiety.",
              SPY: "S&P 500 ETF - 50-day EMA gap analysis. Measures momentum and trend strength of broad equity market.",
              DFF: "Federal Funds Rate - Rate-of-change tracks Fed monetary policy aggressiveness and economic cooling/heating.",
              T10Y2Y: "10Y-2Y Treasury Spread - Yield curve indicator. Inversions historically precede recessions by 12-18 months.",
              UNRATE: "Unemployment Rate - Labor market health. Rising unemployment signals economic slowdown and consumer stress.",
              CONSUMER_HEALTH: "Derived indicator combining PCE, Personal Income, and CPI to assess real consumer purchasing power."
            };
            
            return (
              <div key={meta.code} className="bg-stealth-900 border border-stealth-600 rounded p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-4">
                    <div className="font-semibold text-stealth-100 min-w-[180px]">{meta.name}</div>
                    <div className="text-sm text-stealth-400">
                      Weight: <span className="text-stealth-200 font-mono">{meta.weight.toFixed(1)}</span> ({weightPercentage}%)
                    </div>
                    <div className="text-sm text-stealth-400">
                      Direction: <span className="text-stealth-200 font-mono">{meta.direction === 1 ? "↑ Higher is better" : "↓ Lower is better"}</span>
                    </div>
                  </div>
                  {indicator && (
                    <div className={`px-3 py-1 rounded font-semibold ${
                      indicator.state === "GREEN" ? "bg-green-500/20 text-green-400" :
                      indicator.state === "YELLOW" ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-red-500/20 text-red-400"
                    }`}>
                      {indicator.state}
                    </div>
                  )}
                </div>
                <div className="text-xs text-stealth-400 mt-2">
                  {descriptions[meta.code] || "Market stability indicator"}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-stealth-600">
          <div className="text-sm text-stealth-400 mb-2">
            Total Weight: <span className="text-stealth-200 font-mono">{totalWeight.toFixed(1)}</span>
          </div>
          <div className="text-xs text-stealth-500">
            Note: Weights are calibrated based on historical correlation with market downturns and systemic crises. 
            VIX receives highest weight (1.8) due to its real-time volatility measurement and proven predictive power.
          </div>
        </div>
      </div>

      {/* Current Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
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
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#161619",
                    borderColor: "#555560",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
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

      {/* Individual Indicator Scoring Methodology */}
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-stealth-100">Individual Indicator Scoring Methodology</h3>
        <p className="text-sm text-stealth-300 mb-4">
          Each indicator uses specialized scoring logic tailored to its characteristics and market significance.
        </p>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* VIX */}
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <h4 className="text-sm font-bold text-cyan-400 mb-2">VIX (CBOE Volatility Index)</h4>
            <div className="text-xs text-stealth-300 space-y-2">
              <p className="font-mono bg-stealth-950 p-2 rounded">
                Score = min(100, max(0, (VIX - 12) × 3.33))
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>12-20:</strong> Normal market conditions (0-26 score)</li>
                <li><strong>20-30:</strong> Elevated volatility (26-60 score)</li>
                <li><strong>30-40:</strong> High stress (60-93 score)</li>
                <li><strong>&gt;40:</strong> Extreme fear (93-100 score)</li>
              </ul>
              <p className="text-stealth-400 italic">Rationale: VIX above 30 historically signals market crises (2008, 2020).</p>
            </div>
          </div>

          {/* SPY */}
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <h4 className="text-sm font-bold text-cyan-400 mb-2">SPY (S&P 500 ETF - 50-day EMA Gap)</h4>
            <div className="text-xs text-stealth-300 space-y-2">
              <p className="font-mono bg-stealth-950 p-2 rounded">
                Gap% = ((Price - EMA₅₀) / EMA₅₀) × 100<br/>
                Score = 50 - (Gap% × 2)
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>&gt;+10%:</strong> Strong uptrend (0-30 score - stable)</li>
                <li><strong>0 to +10%:</strong> Moderate uptrend (30-50 score)</li>
                <li><strong>-5% to 0:</strong> Consolidation (50-60 score)</li>
                <li><strong>&lt;-5%:</strong> Downtrend/breakdown (60-100 score)</li>
              </ul>
              <p className="text-stealth-400 italic">Rationale: Sustained divergence from EMA indicates trend weakness.</p>
            </div>
          </div>

          {/* DFF */}
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <h4 className="text-sm font-bold text-cyan-400 mb-2">DFF (Federal Funds Rate - Rate of Change)</h4>
            <div className="text-xs text-stealth-300 space-y-2">
              <p className="font-mono bg-stealth-950 p-2 rounded">
                ROC = DFF(today) - DFF(previous)<br/>
                Score = 50 + (ROC × 20)
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Declining:</strong> Easing policy (0-40 score - supportive)</li>
                <li><strong>Stable:</strong> Neutral policy (40-60 score)</li>
                <li><strong>Rising fast:</strong> Tightening cycle (60-100 score - restrictive)</li>
              </ul>
              <p className="text-stealth-400 italic">Rationale: Rapid rate hikes historically precede market corrections.</p>
            </div>
          </div>

          {/* T10Y2Y */}
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <h4 className="text-sm font-bold text-cyan-400 mb-2">T10Y2Y (10Y-2Y Treasury Spread)</h4>
            <div className="text-xs text-stealth-300 space-y-2">
              <p className="font-mono bg-stealth-950 p-2 rounded">
                Spread = 10Y Yield - 2Y Yield<br/>
                Score = 50 - (Spread × 20)
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>&gt;+1.5%:</strong> Steep curve (0-20 score - healthy)</li>
                <li><strong>0 to +1.5%:</strong> Normal curve (20-50 score)</li>
                <li><strong>-0.5% to 0:</strong> Flattening (50-60 score)</li>
                <li><strong>&lt;-0.5%:</strong> Inverted curve (60-100 score - recession warning)</li>
              </ul>
              <p className="text-stealth-400 italic">Rationale: Inversions preceded every recession since 1955.</p>
            </div>
          </div>

          {/* UNRATE */}
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <h4 className="text-sm font-bold text-cyan-400 mb-2">UNRATE (Unemployment Rate)</h4>
            <div className="text-xs text-stealth-300 space-y-2">
              <p className="font-mono bg-stealth-950 p-2 rounded">
                Score = (UNRATE - 3.5) × 10
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>&lt;4%:</strong> Full employment (0-5 score)</li>
                <li><strong>4-5%:</strong> Healthy labor market (5-15 score)</li>
                <li><strong>5-7%:</strong> Weakening (15-35 score)</li>
                <li><strong>&gt;7%:</strong> Recession conditions (35-100 score)</li>
              </ul>
              <p className="text-stealth-400 italic">Rationale: Rising unemployment reduces consumer spending and GDP growth.</p>
            </div>
          </div>

          {/* CONSUMER_HEALTH */}
          <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
            <h4 className="text-sm font-bold text-cyan-400 mb-2">CONSUMER_HEALTH (Derived Indicator)</h4>
            <div className="text-xs text-stealth-300 space-y-2">
              <p className="font-mono bg-stealth-950 p-2 rounded">
                CH = (PCE_MoM% - CPI_MoM%) + (PI_MoM% - CPI_MoM%)<br/>
                Score = 50 - (CH × 50)
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Positive CH:</strong> Real income/spending growth outpaces inflation (0-40 score)</li>
                <li><strong>Near 0:</strong> Neutral consumer capacity (40-60 score)</li>
                <li><strong>Negative CH:</strong> Inflation eroding purchasing power (60-100 score)</li>
              </ul>
              <p className="text-stealth-400 italic">Rationale: Consumer spending drives 70% of US GDP. Negative spreads signal demand destruction.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Historical Composite Score */}
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-stealth-100">Historical Composite Score (1 Year)</h3>
        <p className="text-sm text-stealth-300 mb-4">
          Track the evolution of overall market stability over time. Extended periods in RED zones typically correlate with 
          major market events, recessions, or systemic crises. GREEN periods indicate low-risk environments conducive to growth.
        </p>
        <div style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
              <XAxis
                dataKey="timestampNum"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(v: number) =>
                  new Date(v).toLocaleDateString(undefined, {
                    month: "short",
                    year: "2-digit",
                  })
                }
                tick={{ fill: "#a4a4b0", fontSize: 12 }}
                stroke="#555560"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#a4a4b0", fontSize: 12 }}
                stroke="#555560"
                label={{ value: "Composite Score", angle: -90, position: "insideLeft", fill: "#a4a4b0" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#161619",
                  borderColor: "#555560",
                  borderRadius: "8px",
                  padding: "12px",
                }}
                labelStyle={{ color: "#a4a4b0" }}
                itemStyle={{ color: "#ffffff" }}
                labelFormatter={(label: number) => new Date(label).toLocaleDateString()}
              />
              <Line
                type="monotone"
                dataKey="composite_score"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                animationDuration={300}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bond Market Stability Composite */}
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
        <h4 className="text-lg font-semibold mb-3 text-stealth-100">Bond Market Stability Composite</h4>
        <div className="space-y-3 text-sm">
          <p className="text-stealth-300">
            <strong className="text-stealth-200">Weight: 1.8</strong> · Aggregates five bond market signals into a comprehensive stability score.
          </p>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 space-y-2">
            <div className="font-mono text-xs text-stealth-300">
              <div className="mb-2"><strong className="text-stealth-200">Components:</strong></div>
              <div className="ml-3 space-y-1">
                <div>• <span className="text-blue-400">Credit Spread Stress (40%)</span>: HY OAS + IG OAS z-scores</div>
                <div>• <span className="text-blue-400">Yield Curve Health (20%)</span>: 10Y-2Y, 10Y-3M spreads (inverted)</div>
                <div>• <span className="text-blue-400">Rates Momentum (15%)</span>: 3-month ROC of 2Y and 10Y yields</div>
                <div>• <span className="text-blue-400">Treasury Volatility (15%)</span>: MOVE Index z-score</div>
                <div>• <span className="text-blue-400">Term Premium (10%)</span>: ACMTP10 z-score</div>
              </div>
            </div>
            <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
              composite_stress = (0.40 × credit) + (0.20 × curve) + (0.15 × rates) + (0.15 × move) + (0.10 × term)
              <br />
              composite_stability = 100 - composite_stress
            </div>
          </div>
          <div className="text-stealth-400">
            <strong className="text-stealth-300">Rationale:</strong> Bond markets are leading indicators of systemic stress. 
            Credit spreads widen before equity crashes, yield curves invert before recessions, and the MOVE index spikes during 
            liquidity crises. This composite captures bond market dislocations that precede broader market turmoil.
          </div>
          <div className="text-stealth-400">
            <strong className="text-stealth-300">Typical Ranges:</strong> 
            <span className="ml-2 text-emerald-400">GREEN: 0-35</span> (stable credit, normal curves, low vol) · 
            <span className="ml-2 text-yellow-400">YELLOW: 35-65</span> (widening spreads, curve flattening) · 
            <span className="ml-2 text-red-400">RED: 65-100</span> (credit stress, inversions, MOVE spikes)
          </div>
        </div>
      </div>

      {/* Liquidity Proxy Indicator */}
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mt-6">
        <h4 className="text-lg font-semibold mb-3 text-stealth-100">Liquidity Proxy Indicator</h4>
        <div className="space-y-3 text-sm">
          <p className="text-stealth-300">
            <strong className="text-stealth-200">Weight: 1.6</strong> · Measures systemic liquidity by combining money supply growth, 
            Fed balance sheet changes, and reverse repo usage.
          </p>
          <div className="bg-stealth-900 border border-stealth-600 rounded p-3 space-y-2">
            <div className="font-mono text-xs text-stealth-300">
              <div className="mb-2"><strong className="text-stealth-200">Components:</strong></div>
              <div className="ml-3 space-y-1">
                <div>• <span className="text-purple-400">M2 Money Supply</span>: Year-over-year % growth</div>
                <div>• <span className="text-purple-400">Fed Balance Sheet</span>: Month-over-month delta (QE/QT)</div>
                <div>• <span className="text-purple-400">Reverse Repo (RRP)</span>: Daily usage level (inverse indicator)</div>
              </div>
            </div>
            <div className="font-mono text-xs text-stealth-400 pt-2 border-t border-stealth-700">
              liquidity_proxy = z_score(M2_YoY) + z_score(Δ_FedBS) - z_score(RRP_level)
              <br />
              liquidity_stress = 50 - (liquidity_proxy × 15) → clipped to [0, 100]
            </div>
          </div>
          <div className="text-stealth-400">
            <strong className="text-stealth-300">Rationale:</strong> Liquidity is the lifeblood of markets. When M2 grows and the 
            Fed expands its balance sheet (QE), asset prices rise across the board. When the Fed tightens (QT) and RRP usage surges 
            (indicating idle reserves), liquidity drains from markets, causing broad-based sell-offs. This indicator captures the 
            liquidity regime driving all asset classes.
          </div>
          <div className="text-stealth-400">
            <strong className="text-stealth-300">Typical Ranges:</strong> 
            <span className="ml-2 text-emerald-400">GREEN: 0-30</span> (M2 growth, QE, low RRP) · 
            <span className="ml-2 text-yellow-400">YELLOW: 30-60</span> (slowing M2, neutral Fed, rising RRP) · 
            <span className="ml-2 text-red-400">RED: 60-100</span> (M2 decline, aggressive QT, RRP peak)
          </div>
          <div className="text-stealth-400">
            <strong className="text-stealth-300">Historical Context:</strong> 
            2020-2021 QE era: <span className="text-emerald-400">GREEN</span> (M2 +25%, Fed +$4T, RRP near zero) · 
            2022 aggressive tightening: <span className="text-red-400">RED</span> (M2 declining, QT -$95B/month, RRP $2.5T) · 
            2023-2024 recovery: <span className="text-yellow-400">YELLOW</span> (stabilizing M2, slowing QT, RRP declining)
          </div>
        </div>
      </div>

      {/* Historical State Distribution */}
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mt-6">
        <h3 className="text-xl font-semibold mb-4 text-stealth-100">Historical State Counts (1 Year)</h3>
        <div style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
              <XAxis
                dataKey="timestampNum"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(v: number) =>
                  new Date(v).toLocaleDateString(undefined, {
                    month: "short",
                    year: "2-digit",
                  })
                }
                tick={{ fill: "#a4a4b0", fontSize: 12 }}
                stroke="#555560"
              />
              <YAxis
                tick={{ fill: "#a4a4b0", fontSize: 12 }}
                stroke="#555560"
                label={{ value: "Indicator Count", angle: -90, position: "insideLeft", fill: "#a4a4b0" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#161619",
                  borderColor: "#555560",
                  borderRadius: "8px",
                  padding: "12px",
                }}
                labelStyle={{ color: "#a4a4b0" }}
                labelFormatter={(label: number) => new Date(label).toLocaleDateString()}
              />
              <Line
                type="monotone"
                dataKey="green_count"
                name="Green"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="yellow_count"
                name="Yellow"
                stroke="#eab308"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="red_count"
                name="Red"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
              />
              <Legend />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
