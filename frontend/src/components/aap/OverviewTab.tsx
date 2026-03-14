import { useMemo, useState } from "react";
import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { MetalsSubsystemPanel } from './MetalsSubsystemPanel';
import { CryptoSubsystemPanel } from './CryptoSubsystemPanel';
import { MethodologyPanel } from './MethodologyPanel';
import { CHART_NEUTRAL } from "../../utils/chartUtils";
import { getFamilyColor, statePalette } from "../../theme/metricColors";

interface HistoricalData {
  date: string;
  score: number;
  regime: string;
  sma20?: number;
  sma200?: number;
}

interface AAPComponent {
  name: string;
  category: string;
  value: number;
  weight: number;
  contribution: number;
  status: 'active' | 'missing';
  description: string;
}

interface AAPData {
  components: AAPComponent[];
  metals_contribution: number;
  crypto_contribution: number;
  stability_score: number;
  regime: string;
  data_completeness?: number;
  primary_driver?: string;
}

interface OverviewTabProps {
  aapData: AAPData;
  history: HistoricalData[];
  componentHistory?: { data: Record<string, ComponentSeries> };
  timeframe: '30d' | '90d' | '180d' | '365d';
  setTimeframe: (tf: '30d' | '90d' | '180d' | '365d') => void;
}

type ComponentSeries = { date: string; value: number | null }[];

function smoothSeries(
  series: ComponentSeries,
  windowSize: number
): ComponentSeries {
  const smoothed: ComponentSeries = [];

  for (let i = 0; i < series.length; i += 1) {
    const start = Math.max(0, i - windowSize + 1);
    const window = series.slice(start, i + 1);
    const values = window
      .map((entry) => entry.value)
      .filter((value): value is number => value !== null && value !== undefined);

    if (values.length === 0) {
      smoothed.push({ date: series[i].date, value: null });
      continue;
    }

    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    smoothed.push({ date: series[i].date, value: avg });
  }

  return smoothed;
}

export function OverviewTab({ aapData, history, componentHistory, timeframe, setTimeframe }: OverviewTabProps) {
  const [showComponentHealth, setShowComponentHealth] = useState(false);
  
  const getScoreColor = (score: number): string => {
    if (score >= 67) return 'text-green-600';
    if (score >= 34) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getRegimeColor = (regime: string): string => {
    const colors: Record<string, string> = {
      'LOW': statePalette.green,
      'MODERATE': statePalette.yellow,
      'HIGH': statePalette.red,
      'normal_confidence': statePalette.green,
      'mild_caution': statePalette.yellow,
      'monetary_stress': statePalette.yellow,
      'liquidity_crisis': statePalette.red,
      'systemic_breakdown': statePalette.red
    };
    return colors[regime] || statePalette.neutral;
  };

  const getRegimeLabel = (regime: string): string => {
    const labels: Record<string, string> = {
      'LOW': 'High Stability',
      'MODERATE': 'Moderate Stability',
      'HIGH': 'Low Stability',
      'normal_confidence': 'Normal Confidence',
      'mild_caution': 'Mild Caution',
      'monetary_stress': 'Monetary Stress',
      'liquidity_crisis': 'Liquidity Crisis',
      'systemic_breakdown': 'Systemic Breakdown'
    };
    return labels[regime] || regime.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const components: AAPComponent[] = aapData.components || [];
  const activeCount = components.filter((c) => c.status === 'active').length;
  const totalCount = components.length;
  const completenessPercent = totalCount > 0 ? (activeCount / totalCount) * 100 : 0;

  const metalsComponents = components.filter((c) => c.category === 'metals');
  const cryptoComponents = components.filter((c) => c.category === 'crypto');

  const rawComponentHistory = useMemo(() => {
    return componentHistory?.data ?? {};
  }, [componentHistory]);

  const smoothedComponentHistory = useMemo(() => {
    const windowSize = 7;
    const output: Record<string, ComponentSeries> = {};

    Object.entries(rawComponentHistory).forEach(([key, series]) => {
      if (!Array.isArray(series)) {
        output[key] = [];
        return;
      }
      output[key] = smoothSeries(series, windowSize);
    });

    return output;
  }, [rawComponentHistory]);

  // Calculate relative contributions as percentages
  const totalContribution = aapData.metals_contribution + aapData.crypto_contribution;
  const metalsPercent = totalContribution > 0 ? (aapData.metals_contribution / totalContribution) * 100 : 50;
  const cryptoPercent = totalContribution > 0 ? (aapData.crypto_contribution / totalContribution) * 100 : 50;
  const metalsColor = getFamilyColor("metals");
  const metalsFill = getFamilyColor("metals");
  const cryptoColor = getFamilyColor("crypto");
  const cryptoFill = getFamilyColor("crypto");
  const benchmarkColor = getFamilyColor("benchmark");

  return (
    <div className="space-y-6">
      {/* Key Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {/* Stability Score */}
        <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-stealth-400 text-xs md:text-sm font-medium">Stability Score</span>
            <svg className="w-5 h-5 text-stealth-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className={`text-3xl md:text-5xl font-bold mb-2 ${getScoreColor(aapData.stability_score)}`}>
            {aapData.stability_score.toFixed(1)}
          </div>
          <div className="flex items-center gap-2 text-xs md:text-sm text-stealth-500">
            <span>0 = Min Stability</span>
            <span>-</span>
            <span>100 = Normal</span>
          </div>
          <div className="mt-3 w-full bg-stealth-700 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all ${
                aapData.stability_score >= 67 ? 'bg-green-500' :
                aapData.stability_score >= 34 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${aapData.stability_score}%` }}
            ></div>
          </div>
        </div>

        {/* Regime */}
        <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-stealth-400 text-xs md:text-sm font-medium">Current Regime</span>
          </div>
          <div 
            className="text-xl md:text-2xl font-bold mb-2"
            style={{ color: getRegimeColor(aapData.regime) }}
          >
            {getRegimeLabel(aapData.regime)}
          </div>
          <div className="text-xs md:text-sm text-stealth-500">
            Primary: <span className="text-stealth-300 capitalize">{aapData.primary_driver}</span>
          </div>
        </div>

        {/* Component Status */}
        <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-stealth-400 text-xs md:text-sm font-medium">Component Status</span>
          </div>
          <div className="text-3xl md:text-5xl font-bold text-stealth-100 mb-2">
            {activeCount}<span className="text-2xl md:text-3xl text-stealth-400">/{totalCount}</span>
          </div>
          <div className="text-xs md:text-sm text-stealth-500">
            {completenessPercent.toFixed(1)}% operational 
            {completenessPercent >= 70 ? 
              <span className="text-emerald-400 ml-2">Above threshold</span> : 
              <span className="text-red-400 ml-2">Below threshold</span>
            }
          </div>
        </div>

        {/* Subsystem Balance */}
        <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-stealth-400 text-xs md:text-sm font-medium">Subsystem Balance</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <div className="text-sm font-medium" style={{ color: metalsColor }}>Metals</div>
              <div className="text-2xl font-bold text-stealth-100">{metalsPercent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: cryptoColor }}>Crypto</div>
              <div className="text-2xl font-bold text-stealth-100">{cryptoPercent.toFixed(1)}%</div>
            </div>
          </div>
          <div className="text-xs text-stealth-500">Relative contribution to instability</div>
        </div>
      </div>

      {/* Historical Chart */}
      <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <h2 className="text-lg md:text-xl font-semibold text-stealth-100">Stability Score History</h2>
          <div className="flex gap-2">
            {(['30d', '90d', '180d', '365d'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 rounded text-sm ${
                  timeframe === tf
                    ? 'bg-emerald-500 text-white'
                    : 'bg-stealth-700 text-stealth-300 hover:bg-stealth-600'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="h-64 md:h-96">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
              <XAxis 
                dataKey="date" 
                stroke={CHART_NEUTRAL.axis} 
                tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
              />
              <YAxis 
                stroke={CHART_NEUTRAL.axis}
                domain={[0, 100]}
                tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: CHART_NEUTRAL.tooltipBg, 
                  border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`,
                  borderRadius: '0.5rem',
                  color: CHART_NEUTRAL.text
                }}
              />
              <Area 
                type="monotone" 
                dataKey="metals_contribution" 
                stackId="1" 
                fill={metalsFill} 
                stroke={metalsColor}
                strokeWidth={2}
                fillOpacity={0.3}
                name="Metals"
              />
              <Area 
                type="monotone" 
                dataKey="crypto_contribution" 
                stackId="1" 
                fill={cryptoFill} 
                stroke={cryptoColor}
                strokeWidth={2}
                fillOpacity={0.3}
                name="Crypto"
              />
              <Line 
                type="monotone" 
                dataKey="sma20" 
                stroke={benchmarkColor} 
                strokeWidth={3}
                dot={false}
                name="20-Day SMA"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <div>
              <div className="text-stealth-400">High Stability</div>
              <div className="text-green-400 font-semibold">67-100</div>
            </div>
            <div>
              <div className="text-stealth-400">Moderate</div>
              <div className="text-yellow-400 font-semibold">34-66</div>
            </div>
            <div>
              <div className="text-stealth-400">Low Stability</div>
              <div className="text-red-400 font-semibold">0-33</div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="w-6 h-1" viewBox="0 0 24 4" preserveAspectRatio="none">
                <line x1="0" y1="2" x2="24" y2="2" stroke={statePalette.green} strokeWidth="2"/>
              </svg>
              <span className="text-stealth-300 text-xs">Current Score</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-6 h-1" viewBox="0 0 24 4" preserveAspectRatio="none">
                <line x1="0" y1="2" x2="24" y2="2" stroke={benchmarkColor} strokeWidth="1.5" strokeDasharray="2 2"/>
              </svg>
              <span className="text-stealth-300 text-xs">20-Day SMA</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-6 h-1" viewBox="0 0 24 4" preserveAspectRatio="none">
                <line x1="0" y1="2" x2="24" y2="2" stroke={statePalette.red} strokeWidth="1.5" strokeDasharray="2 2"/>
              </svg>
              <span className="text-stealth-300 text-xs">200-Day SMA</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Interpretation */}
      <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
        <h3 className="text-lg font-semibold text-stealth-100 mb-3">Quick Interpretation</h3>
        <div className="space-y-3 text-sm text-stealth-300">
          <p>
            <strong className="text-stealth-100">Current State:</strong> The AAS Stability Score of {aapData.stability_score.toFixed(1)} 
            indicates <strong className={aapData.stability_score >= 67 ? 'text-green-400' : aapData.stability_score >= 34 ? 'text-yellow-400' : 'text-red-400'}>
              {aapData.stability_score >= 67 ? 'high stability' : aapData.stability_score >= 34 ? 'moderate stability' : 'low stability'}
            </strong> in alternative asset markets.
          </p>
          <p>
            <strong className="text-stealth-100">Primary Driver:</strong> The dominant signal is coming from <strong className="text-emerald-400 capitalize">{aapData.primary_driver}</strong> markets, 
            contributing {aapData.primary_driver === 'metals' ? metalsPercent.toFixed(1) : cryptoPercent.toFixed(1)}% of the instability signal.
          </p>
          <p>
            <strong className="text-stealth-100">System Health:</strong> {activeCount} of {totalCount} components are operational 
            ({completenessPercent.toFixed(1)}%), {completenessPercent >= 70 ? 
              'meeting the 70% threshold for reliable calculation' : 
              'below the 70% threshold - results may be less reliable'
            }.
          </p>
        </div>
      </div>

      {/* Expandable Component Health Section */}
      <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg">
        <button
          onClick={() => setShowComponentHealth(!showComponentHealth)}
          className="w-full flex justify-between items-center p-4 md:p-6 hover:bg-stealth-700/30 transition-colors text-left"
        >
          <div>
            <h3 className="text-lg font-semibold text-stealth-100 mb-1">Component Health & Methodology</h3>
            <p className="text-xs text-stealth-400">
              Detailed breakdown of all 18 components, subsystem analysis, and indicator methodology
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-sm text-stealth-400">
              {activeCount}/{totalCount} Active
            </span>
            <svg 
              className={`w-6 h-6 text-stealth-400 transition-transform ${showComponentHealth ? 'rotate-180' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        
        {showComponentHealth && (
          <div className="border-t border-stealth-700 p-4 md:p-6 space-y-6">
            {/* Subsystem Breakdown */}
            <div>
              <h4 className="text-md font-semibold text-stealth-100 mb-4">Subsystem Breakdown</h4>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <MetalsSubsystemPanel
                  components={metalsComponents}
                  contribution={aapData.metals_contribution}
                  sharePercent={metalsPercent}
                  rawHistory={rawComponentHistory}
                  smoothedHistory={smoothedComponentHistory}
                />
                <CryptoSubsystemPanel
                  components={cryptoComponents}
                  contribution={aapData.crypto_contribution}
                  sharePercent={cryptoPercent}
                  rawHistory={rawComponentHistory}
                  smoothedHistory={smoothedComponentHistory}
                />
              </div>
            </div>

            {/* Methodology */}
            <div>
              <MethodologyPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
