import { useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { IndicatorHistoryPoint } from "../types";
import StateSparkline from "../components/widgets/StateSparkline";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
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
  pce: { value: number; mom_pct: number };
  cpi: { value: number; mom_pct: number };
  pi: { value: number; mom_pct: number };
  spreads: {
    pce_vs_cpi: number;
    pi_vs_cpi: number;
    consumer_health: number;
  };
}

interface BondComponentData {
  date: string;
  credit_spread_stress: {
    hy_oas: number;
    ig_oas: number;
    stress_score: number;
    weight: number;
    contribution: number;
  };
  yield_curve_stress: {
    spread_10y2y: number;
    spread_10y3m: number;
    spread_30y5y: number;
    stress_score: number;
    weight: number;
    contribution: number;
  };
  rates_momentum_stress: {
    roc_2y: number;
    roc_10y: number;
    stress_score: number;
    weight: number;
    contribution: number;
  };
  treasury_volatility_stress: {
    calculated_volatility: number;
    stress_score: number;
    weight: number;
    contribution: number;
  };
  composite: {
    stress_score: number;
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

export default function IndicatorDetail() {
  const { code } = useParams();
  
  // Determine appropriate lookback period based on data freshness
  const getHistoryDays = () => {
    // For now, always request 730 days (2 years) to have more data available
    // The component will intelligently display the appropriate range
    return 730;
  };
  
  const { data: meta } = useApi<IndicatorDetailResponse>(`/indicators/${code}`);
  const { data: history } = useApi<IndicatorHistoryPoint[]>(
    `/indicators/${code}/history?days=${getHistoryDays()}`
  );
  const { data: components } = useApi<ComponentData[]>(
    code === "CONSUMER_HEALTH" ? `/indicators/${code}/components?days=${getHistoryDays()}` : ""
  );
  const { data: bondComponents } = useApi<BondComponentData[]>(
    code === "BOND_MARKET_STABILITY" ? `/indicators/${code}/components?days=${getHistoryDays()}` : ""
  );
  const { data: liquidityComponents } = useApi<LiquidityComponentData[]>(
    code === "LIQUIDITY_PROXY" ? `/indicators/${code}/components?days=${getHistoryDays()}` : ""
  );

  if (!code) return <div className="p-6 text-gray-200">No code provided.</div>;
  
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

  return (
    <div className="p-6 text-gray-200 max-w-7xl">
      <h2 className="text-3xl font-bold mb-6">
        {meta?.name ?? code}
      </h2>

      {/* Metadata Section */}
      {meta?.metadata && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-stealth-100 mb-2">Description</h3>
            <p className="text-stealth-300 leading-relaxed">{meta.metadata.description}</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Relevance</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.relevance}</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Impact</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.impact}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Scoring Method</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.scoring}</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Typical Range</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.typical_range}</p>
            </div>
          </div>
        </div>
      )}

      {/* Component Breakdown for Consumer Health */}
      {code === "CONSUMER_HEALTH" && components && components.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-sm text-stealth-400 mb-4">
            Consumer Health = (PCE Growth - CPI Growth) + (PI Growth - CPI Growth)
          </p>
          
          {/* Latest Values */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">PCE (Spending)</div>
              <div className="text-lg font-bold text-blue-400">
                {components[components.length - 1].pce.mom_pct.toFixed(3)}%
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                MoM Growth
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">PI (Income)</div>
              <div className="text-lg font-bold text-green-400">
                {components[components.length - 1].pi.mom_pct.toFixed(3)}%
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                MoM Growth
              </div>
            </div>
            
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">CPI (Inflation)</div>
              <div className="text-lg font-bold text-red-400">
                {components[components.length - 1].cpi.mom_pct.toFixed(3)}%
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                MoM Growth
              </div>
            </div>
          </div>

          {/* Spread Chart */}
          <div className="h-80">
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = components.map(item => ({
                ...item,
                dateNum: new Date(item.date).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
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
                  label={{ value: 'MoM % Growth', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#161619",
                    borderColor: "#555560",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                  labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                  formatter={(value: number) => `${value.toFixed(3)}%`}
                  labelFormatter={(label: string) =>
                    new Date(label).toLocaleDateString()
                  }
                />
                <Line
                  type="monotone"
                  dataKey="pce.mom_pct"
                  name="PCE Growth"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="pi.mom_pct"
                  name="PI Growth"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="cpi.mom_pct"
                  name="CPI (Inflation)"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Spread vs Inflation Chart */}
          <div className="h-80 mt-6">
            <h4 className="text-lg font-semibold mb-2 text-stealth-100">Real Consumer Capacity vs Inflation</h4>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = components.map(item => ({
                ...item,
                dateNum: new Date(item.date).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
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
                  label={{ value: 'Spread %', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#161619",
                    borderColor: "#555560",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                  labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                  formatter={(value: number) => `${value.toFixed(3)}%`}
                  labelFormatter={(label: string) =>
                    new Date(label).toLocaleDateString()
                  }
                />
                <Line
                  type="monotone"
                  dataKey="spreads.pce_vs_cpi"
                  name="PCE vs CPI"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="spreads.pi_vs_cpi"
                  name="PI vs CPI"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="spreads.consumer_health"
                  name="Consumer Health"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      )}

      {/* Component Breakdown for Bond Market Stability */}
      {code === "BOND_MARKET_STABILITY" && bondComponents && bondComponents.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-sm text-stealth-400 mb-4">
            Composite Stress = (Credit × 44%) + (Curve × 23%) + (Momentum × 17%) + (Volatility × 16%)
          </p>
          
          {/* Latest Component Values */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-stealth-900 border border-stealth-600 rounded p-4">
              <div className="text-xs text-stealth-400 mb-1">Credit Spreads</div>
              <div className="text-lg font-bold text-red-400">
                {bondComponents[bondComponents.length - 1].credit_spread_stress.stress_score.toFixed(1)}
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
                {bondComponents[bondComponents.length - 1].yield_curve_stress.stress_score.toFixed(1)}
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
                {bondComponents[bondComponents.length - 1].rates_momentum_stress.stress_score.toFixed(1)}
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
                {bondComponents[bondComponents.length - 1].treasury_volatility_stress.stress_score.toFixed(1)}
              </div>
              <div className="text-xs text-stealth-500 mt-1">
                Weight: {(bondComponents[bondComponents.length - 1].treasury_volatility_stress.weight * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-stealth-500">
                Contrib: {bondComponents[bondComponents.length - 1].treasury_volatility_stress.contribution.toFixed(1)}
              </div>
            </div>
          </div>

          {/* Component Stress Scores Chart */}
          <div className="h-80 mb-6">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Component Stress Scores Over Time</h4>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = bondComponents.map(item => ({
                ...item,
                dateNum: new Date(item.date).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
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
                      label={{ value: 'Stress Score (0-100)', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#161619",
                        borderColor: "#555560",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="credit_spread_stress.stress_score"
                      name="Credit Spreads"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="yield_curve_stress.stress_score"
                      name="Yield Curves"
                      stroke="#eab308"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="rates_momentum_stress.stress_score"
                      name="Rates Momentum"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="treasury_volatility_stress.stress_score"
                      name="Treasury Volatility"
                      stroke="#a855f7"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Composite Stress Score Chart */}
          <div className="h-80">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Composite Stress Score</h4>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = bondComponents.map(item => ({
                ...item,
                dateNum: new Date(item.date).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
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
                      label={{ value: 'Composite Stress Score', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#161619",
                        borderColor: "#555560",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="composite.stress_score"
                      name="Composite Stress"
                      stroke="#60a5fa"
                      strokeWidth={3}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      )}

      {/* Component Breakdown for Liquidity Proxy */}
      {code === "LIQUIDITY_PROXY" && liquidityComponents && liquidityComponents.length > 0 && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">Component Breakdown</h3>
          <p className="text-sm text-stealth-400 mb-4">
            Liquidity Proxy = z(M2 YoY%) + z(Fed BS Delta) - z(RRP Usage) → Stress Score
          </p>
          
          {/* Latest Component Values */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = liquidityComponents.map(item => ({
                ...item,
                dateNum: new Date(item.date).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
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
                      label={{ value: 'Z-Score', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#161619",
                        borderColor: "#555560",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="m2_money_supply.z_score"
                      name="M2 YoY%"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="fed_balance_sheet.z_score"
                      name="Fed BS Delta"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="reverse_repo.z_score"
                      name="RRP Usage"
                      stroke="#a855f7"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Liquidity Stress Score Chart */}
          <div className="h-80">
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">Liquidity Stress Score</h4>
            <p className="text-xs text-stealth-400 mb-2">
              Lower stress = abundant liquidity (QE, M2 growth) | Higher stress = liquidity drought (QT, RRP peak)
            </p>
            {(() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = liquidityComponents.map(item => ({
                ...item,
                dateNum: new Date(item.date).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                    <XAxis
                      dataKey="dateNum"
                      type="number"
                      domain={[daysBack.getTime(), today.getTime()]}
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
                      label={{ value: 'Stress Score (0-100)', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#161619",
                        borderColor: "#555560",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                      formatter={(value: number) => value.toFixed(2)}
                      labelFormatter={(label: number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="composite.stress_score"
                      name="Liquidity Stress"
                      stroke="#f59e0b"
                      strokeWidth={3}
                      dot={false}
                    />
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
              <div className="text-yellow-400 text-xl">⚠️</div>
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
              {new Date(meta.latest.timestamp).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Historical Charts */}
      <div className="space-y-6">
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">
            Raw Value History ({chartRange.label})
          </h3>
          <div className="h-80">
            {history && history.length > 0 ? (() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = history.map(item => ({
                ...item,
                timestampNum: new Date(item.timestamp).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
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
                      tick={{ fill: "#a4a4b0", fontSize: 12 }}
                      stroke="#555560"
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: "#a4a4b0", fontSize: 12 }}
                      stroke="#555560"
                      label={{ value: 'Raw Value', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#161619",
                        borderColor: "#555560",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                      labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                      itemStyle={{ color: "#ffffff" }}
                      formatter={(value: number) => [value.toFixed(2), "Value"]}
                      labelFormatter={(label: string | number) =>
                        new Date(label).toLocaleDateString()
                      }
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="raw_value"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={false}
                      animationDuration={300}
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

        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">
            Stability Score History ({chartRange.label})
          </h3>
          <div className="h-80">
            {history && history.length > 0 ? (() => {
              const today = new Date();
              const daysBack = new Date(today);
              daysBack.setDate(today.getDate() - chartRange.days);
              
              const chartData = history.map(item => ({
                ...item,
                timestampNum: new Date(item.timestamp).getTime()
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
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
                    tick={{ fill: "#a4a4b0", fontSize: 12 }}
                    stroke="#555560"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#a4a4b0", fontSize: 12 }}
                    stroke="#555560"
                    label={{ value: 'Score (0-100)', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#161619",
                      borderColor: "#555560",
                      borderRadius: "8px",
                      padding: "12px",
                    }}
                    labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                    itemStyle={{ color: "#ffffff" }}
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
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={300}
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