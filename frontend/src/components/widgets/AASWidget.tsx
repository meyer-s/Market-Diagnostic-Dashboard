import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { Link } from "react-router-dom";
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { analyzeSeries, getTrendTone, getConfidenceFromSignal, type InsightSignal } from "../../utils/insightUtils";

interface AASData {
  stability_score: number;
  regime: string;
  primary_driver: string;
  metals_contribution: number;
  crypto_contribution: number;
  pressure_index: number;
}

interface HistoricalData {
  date: string;
  stability_score: number;
  metals_contribution: number;
  crypto_contribution: number;
  sma20?: number;
  sma200?: number;
}

interface AASWidgetProps {
  timeframe?: '30d' | '90d' | '180d' | '365d';
  onInsight?: (insight: InsightSignal) => void;
}

export default function AASWidget({ timeframe = '90d', onInsight }: AASWidgetProps) {
  const { data: aasData, loading } = useApi<AASData>('/aap/current');
  const { data: historyData } = useApi<any>(`/aap/history?days=${parseInt(timeframe)}`);
  const [metalsPercent, setMetalsPercent] = useState(50);
  const [cryptoPercent, setCryptoPercent] = useState(50);
  const [chartData, setChartData] = useState<HistoricalData[]>([]);

  useEffect(() => {
    if (aasData) {
      const total = aasData.metals_contribution + aasData.crypto_contribution;
      if (total > 0) {
        setMetalsPercent((aasData.metals_contribution / total) * 100);
        setCryptoPercent((aasData.crypto_contribution / total) * 100);
      }
    }
  }, [aasData]);

  useEffect(() => {
    if (historyData && historyData.data && Array.isArray(historyData.data)) {
      const days = parseInt(timeframe);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const processed = historyData.data
        .filter((d: any) => new Date(d.date) >= cutoffDate)
        .map((d: any) => ({
          date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          stability_score: d.stability_score || 0,
          metals_contribution: (d.metals_contribution || 0) * 100,
          crypto_contribution: (d.crypto_contribution || 0) * 100,
          sma20: d.sma_20 || 0,
          sma200: d.sma_200 || 0
        }));
      setChartData(processed);
    }
  }, [historyData, timeframe]);

  const getScoreColor = (score: number): string => {
    if (score >= 67) return 'text-green-400';
    if (score >= 34) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getRegimeColor = (regime: string): string => {
    const colors: Record<string, string> = {
      'normal_confidence': '#10b981',
      'mild_caution': '#f59e0b',
      'monetary_stress': '#f59e0b',
      'liquidity_crisis': '#ef4444',
      'systemic_breakdown': '#dc2626'
    };
    return colors[regime] || '#6b7280';
  };

  const getRegimeLabel = (regime: string): string => {
    const labels: Record<string, string> = {
      'normal_confidence': 'Normal Confidence',
      'mild_caution': 'Mild Caution',
      'monetary_stress': 'Monetary Stress',
      'liquidity_crisis': 'Liquidity Crisis',
      'systemic_breakdown': 'Systemic Breakdown'
    };
    return labels[regime] || regime.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-stealth-700 rounded mb-3 w-1/3"></div>
          <div className="h-12 bg-stealth-700 rounded mb-4"></div>
        </div>
      </div>
    );
  }

  if (!aasData) {
    return (
      <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6">
        <p className="text-stealth-400 text-sm">Unable to load AAS data</p>
      </div>
    );
  }

  const averageValue = (points: HistoricalData[], key: keyof HistoricalData) => {
    if (!points.length) return 0;
    const sum = points.reduce((total, point) => total + (Number(point[key]) || 0), 0);
    return sum / points.length;
  };
  const stabilitySeries = chartData.map((point) => point.stability_score);
  const trendSignal = analyzeSeries(stabilitySeries, { recent: 7, prior: 7 });
  const trendTone = getTrendTone(trendSignal);
  const trendWord =
    trendSignal.direction === "up"
      ? "improving"
      : trendSignal.direction === "down"
      ? "slipping"
      : "holding";
  const momentumClause =
    trendSignal.momentum === "steady"
      ? ""
      : `, momentum is ${trendSignal.momentum === "accelerating" ? "building" : "fading"}`;
  const toneClause = trendTone === "mixed" ? "" : `, the signal feels ${trendTone}`;
  const last7 = chartData.slice(-7);
  const prev7 = chartData.slice(-14, -7);
  const fallbackMetals = aasData.metals_contribution ?? 0;
  const fallbackCrypto = aasData.crypto_contribution ?? 0;
  const recentMetals = last7.length ? averageValue(last7, "metals_contribution") : fallbackMetals;
  const recentCrypto = last7.length ? averageValue(last7, "crypto_contribution") : fallbackCrypto;
  const priorMetals = prev7.length ? averageValue(prev7, "metals_contribution") : recentMetals;
  const priorCrypto = prev7.length ? averageValue(prev7, "crypto_contribution") : recentCrypto;
  const recentLeader = recentMetals >= recentCrypto ? "metals" : "crypto";
  const priorLeader = prev7.length ? (priorMetals >= priorCrypto ? "metals" : "crypto") : recentLeader;
  const leaderShifted = recentLeader !== priorLeader;
  const leaderPhrase =
    recentLeader === "metals"
      ? leaderShifted
        ? "Metals just took the lead"
        : "Metals are doing more of the lifting"
      : leaderShifted
      ? "Crypto just took the lead"
      : "Crypto is doing more of the lifting";
  const leaderImpact =
    recentLeader === "metals"
      ? "that usually shows up first in inflation-sensitive budgets"
      : "that usually shows up first in risk-taking and fast money moves";
  let actionSentence = "Stay balanced while the signal firms up.";
  if (trendSignal.direction === "up" && trendTone !== "noisy") {
    actionSentence = "Measured exposure can make sense while this holds.";
  } else if (trendSignal.direction === "down") {
    actionSentence = "Keep size light and lean on hedges until it steadies.";
  }
  const aasSummary = `Alternative assets often move early when stress builds. It is ${trendWord}${momentumClause}${toneClause}. ${leaderPhrase}, ${leaderImpact}; ${actionSentence}`;
  const leaderShort = recentLeader === "metals" ? "metals lead" : "crypto lead";
  const summaryShort = `${trendWord}, ${leaderShort}`;
  const regimeLower = (aasData.regime || "").toLowerCase();
  const stressRegime =
    regimeLower.includes("stress") ||
    regimeLower.includes("crisis") ||
    regimeLower.includes("breakdown");
  const stance =
    aasData.stability_score >= 67 && trendSignal.direction !== "down"
      ? "risk-on"
      : aasData.stability_score <= 34 || stressRegime || trendSignal.direction === "down"
      ? "risk-off"
      : "mixed";
  const aasInsight: InsightSignal = {
    id: "aas",
    label: "Alts",
    direction: trendSignal.direction,
    stance,
    confidence: getConfidenceFromSignal(trendSignal),
    summary: summaryShort,
  };

  useEffect(() => {
    if (!onInsight) return;
    onInsight(aasInsight);
  }, [onInsight, aasInsight.direction, aasInsight.stance, aasInsight.confidence, aasInsight.summary]);

  return (
    <Link to="/alternative-assets">
      <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6 hover:border-stealth-600 transition cursor-pointer h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-stealth-100">Alternative Asset Stability</h3>
          <svg className="w-5 h-5 text-stealth-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>

        {/* Stability Score */}
        <div className="mb-4">
          <div className="flex items-end gap-2 mb-2">
            <div className={`text-4xl font-bold ${getScoreColor(aasData.stability_score)}`}>
              {aasData.stability_score.toFixed(1)}
            </div>
            <div className="text-xs text-stealth-400 mb-1">/ 100</div>
          </div>
          <div className="w-full bg-stealth-700 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all ${
                aasData.stability_score >= 67 ? 'bg-green-500' :
                aasData.stability_score >= 34 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${aasData.stability_score}%` }}
            ></div>
          </div>
        </div>

        {/* Regime */}
        <div className="mb-4">
          <p className="text-xs text-stealth-400 mb-1">Current Regime</p>
          <div 
            className="text-base font-semibold"
            style={{ color: getRegimeColor(aasData.regime) }}
          >
            {getRegimeLabel(aasData.regime)}
          </div>
        </div>

        {/* Primary Driver */}
        <div className="mb-4">
          <p className="text-xs text-stealth-400 mb-2">Current Breakdown</p>
          <div className="flex gap-2">
            <div className={`flex-1 p-2 rounded text-center text-xs font-semibold ${
              aasData.primary_driver === 'metals' 
                ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300' 
                : 'bg-stealth-700/50 border border-stealth-600 text-stealth-400'
            }`}>
              Metals {metalsPercent.toFixed(0)}%
            </div>
            <div className={`flex-1 p-2 rounded text-center text-xs font-semibold ${
              aasData.primary_driver === 'crypto' 
                ? 'bg-blue-500/20 border border-blue-500/50 text-blue-300' 
                : 'bg-stealth-700/50 border border-stealth-600 text-stealth-400'
            }`}>
              Crypto {cryptoPercent.toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Historical Chart */}
        <div className="mb-4">
          <p className="text-xs text-stealth-400 mb-2">{parseInt(timeframe)}-Day Contribution Trend</p>
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#9ca3af" 
                    tick={{ fontSize: 10 }}
                    interval={Math.floor(Math.max(0, chartData.length / 4))}
                  />
                  <YAxis 
                    stroke="#9ca3af" 
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1f2937', 
                      border: '1px solid #374151',
                      borderRadius: '0.5rem',
                      fontSize: '12px'
                    }}
                    formatter={(value) => (value as number).toFixed(3)}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="metals_contribution" 
                    stackId="1" 
                    fill="#f59e0b" 
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    fillOpacity={0.5}
                    name="Metals"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="crypto_contribution" 
                    stackId="1" 
                    fill="#3b82f6" 
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    fillOpacity={0.5}
                    name="Crypto"
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="sma20" 
                    stroke="#f59e0b" 
                    strokeWidth={3}
                    dot={false}
                    name="20-Day SMA"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-stealth-400 text-sm">
              Loading chart data...
            </div>
          )}
        </div>

        {/* Conclusion */}
        <div className="text-xs text-stealth-400 border-t border-stealth-700 pt-3">
          <p className="leading-relaxed">{aasSummary}</p>
        </div>
      </div>
    </Link>
  );
}
