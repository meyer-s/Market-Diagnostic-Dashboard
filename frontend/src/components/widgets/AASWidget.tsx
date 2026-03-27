import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { Link, useNavigate } from "react-router-dom";
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getFamilyColor, getMetricColor } from "../../theme/metricColors";
import { CHART_NEUTRAL } from "../../utils/chartUtils";
import {
  buildTechnicalProjections,
  type TechnicalProjection,
} from "../../utils/technicalProjections";
import {
  analyzeSeries,
  getTrendTone,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";

interface AASData {
  stability_score: number;
  regime: string;
  primary_driver: string;
  metals_contribution: number;
  crypto_contribution: number;
  pressure_index: number;
}

interface AASHistoryPoint {
  date: string;
  stability_score: number;
  metals_contribution: number;
  crypto_contribution: number;
  sma_20?: number;
  sma_200?: number;
}

interface MetalProjection {
  metal: string;
  metal_name: string;
  current_price: number;
  score_total: number;
  relative_classification: "Winner" | "Neutral" | "Loser";
  rank: number;
}

interface MetalsProjectionResponse {
  projections: MetalProjection[];
}

interface CryptoAsset {
  symbol: string;
  name: string;
  color: string;
  current_price: number | null;
  change_24h: number | null;
  change_30d: number | null;
}

interface CryptoMarketOverviewResponse {
  assets: CryptoAsset[];
}

interface RelativeCryptoRanking extends CryptoAsset {
  rank: number;
  score_total: number;
  relativeClassification: "Winner" | "Neutral" | "Loser";
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
  const navigate = useNavigate();
  const { data: aasData, loading } = useApi<AASData>('/aas/current');
  const { data: historyData } = useApi<{ data: AASHistoryPoint[] }>(`/aas/history?days=${parseInt(timeframe)}`);
  const { data: metalsProjectionData } = useApi<MetalsProjectionResponse>('/precious-metals/projections/latest');
  const { data: cryptoMarketData } = useApi<CryptoMarketOverviewResponse>('/crypto/market-overview?days=365');
  const [metalsPercent, setMetalsPercent] = useState(50);
  const [cryptoPercent, setCryptoPercent] = useState(50);
  const [chartData, setChartData] = useState<HistoricalData[]>([]);
  const metalsColor = getFamilyColor("metals");
  const cryptoColor = getFamilyColor("crypto");
  const metalsFill = getFamilyColor("metals");
  const cryptoFill = getFamilyColor("crypto");
  const metalsSoft = getFamilyColor("metals", "faint");
  const cryptoSoft = getFamilyColor("crypto", "faint");
  const benchmarkColor = getFamilyColor("benchmark");

  const buildRelativeRankings = (assets: CryptoAsset[]): RelativeCryptoRanking[] => {
    const projections = buildTechnicalProjections<CryptoAsset>(assets);

    return projections.map((projection: TechnicalProjection<CryptoAsset>) => ({
      symbol: projection.symbol,
      name: projection.name,
      color: projection.color,
      current_price: projection.current_price,
      change_24h: projection.change_24h,
      change_30d: projection.change_30d,
      rank: projection.rank,
      score_total: projection.score_total,
      relativeClassification: projection.relativeClassification,
    }));
  };

  const getRelativeClassStyles = (classification: "Winner" | "Neutral" | "Loser") => {
    switch (classification) {
      case "Winner":
        return "border-emerald-500/50 bg-emerald-500/10 text-emerald-300";
      case "Loser":
        return "border-red-500/50 bg-red-500/10 text-red-300";
      default:
        return "border-blue-500/40 bg-blue-500/10 text-blue-300";
    }
  };

  const formatMiniPrice = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "n/a";
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
  };

  const getMetalColor = (metal: string) => getMetricColor(metal);

  const metalsRankings = (metalsProjectionData?.projections ?? []).slice().sort((left, right) => left.rank - right.rank);
  const cryptoRankings: RelativeCryptoRanking[] = buildRelativeRankings(cryptoMarketData?.assets ?? []);

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
        .filter((d: AASHistoryPoint) => new Date(d.date) >= cutoffDate)
        .map((d: AASHistoryPoint) => ({
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

  const days = parseInt(timeframe);
  const trendWindows = getTrendWindows(days);
  const stabilitySeries = chartData.map((point) => point.stability_score);
  const primarySignal = analyzeSeries(stabilitySeries, trendWindows.primary);
  const secondarySignal = analyzeSeries(stabilitySeries, trendWindows.secondary);
  const averageValue = (points: HistoricalData[], key: keyof HistoricalData) => {
    if (!points.length) return 0;
    const sum = points.reduce((total, point) => total + (Number(point[key]) || 0), 0);
    return sum / points.length;
  };
  const fallbackMetals = aasData?.metals_contribution ?? 0;
  const fallbackCrypto = aasData?.crypto_contribution ?? 0;
  const lastWindow = chartData.slice(-trendWindows.secondary.recent);
  const prevWindow = chartData.slice(
    -(trendWindows.secondary.recent + trendWindows.secondary.prior),
    -trendWindows.secondary.recent
  );
  const recentMetals = lastWindow.length
    ? averageValue(lastWindow, "metals_contribution")
    : fallbackMetals;
  const recentCrypto = lastWindow.length
    ? averageValue(lastWindow, "crypto_contribution")
    : fallbackCrypto;
  const priorMetals = prevWindow.length
    ? averageValue(prevWindow, "metals_contribution")
    : recentMetals;
  const priorCrypto = prevWindow.length
    ? averageValue(prevWindow, "crypto_contribution")
    : recentCrypto;
  const recentLeader = recentMetals >= recentCrypto ? "metals" : "crypto";
  const priorLeader = prevWindow.length ? (priorMetals >= priorCrypto ? "metals" : "crypto") : recentLeader;
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
  const trendTone = getTrendTone(primarySignal);
  const primaryWord =
    primarySignal.direction === "up"
      ? "improving"
      : primarySignal.direction === "down"
      ? "slipping"
      : "holding";
  const secondaryWord =
    secondarySignal.direction === "up"
      ? "improving"
      : secondarySignal.direction === "down"
      ? "slipping"
      : "flat";
  const trendClause =
    secondarySignal.direction === primarySignal.direction
      ? `${trendWindows.label} is ${primaryWord}.`
      : `${trendWindows.label} is ${primaryWord}, but the recent move is ${secondaryWord}.`;
  const toneClause = trendTone === "mixed" ? "" : ` It feels ${trendTone}.`;
  let actionSentence = "Context remains mixed.";
  if (primarySignal.direction === "up" && trendTone !== "noisy") {
    actionSentence = "Participation is improving within alternative assets.";
  } else if (primarySignal.direction === "down") {
    actionSentence = "Participation is softening within alternative assets.";
  }
  const aasSummary = `Alternative assets reflect shifts in risk appetite and liquidity. ${trendClause}${toneClause} ${leaderPhrase}, ${leaderImpact}; ${actionSentence}`;
  const summaryShort = `${trendWindows.shortLabel} ${primarySignal.direction}${
    secondarySignal.direction === primarySignal.direction
      ? ""
      : ` / recent ${secondarySignal.direction}`
  }, ${recentLeader}`;
  const stabilityScore = aasData?.stability_score ?? 0;
  const regimeLower = (aasData?.regime || "").toLowerCase();
  const stressRegime =
    regimeLower.includes("stress") ||
    regimeLower.includes("crisis") ||
    regimeLower.includes("breakdown");
  const stance: InsightSignal["stance"] =
    stabilityScore >= 67 && primarySignal.direction !== "down"
      ? "risk-on"
      : stabilityScore <= 34 || stressRegime || primarySignal.direction === "down"
      ? "risk-off"
      : "mixed";
  const aasInsight: InsightSignal | null = aasData
    ? {
        id: "aas",
        label: "Alts",
        primaryDirection: primarySignal.direction,
        secondaryDirection: secondarySignal.direction,
        stance,
        confidence: getConfidenceFromSignal(primarySignal),
        summary: summaryShort,
      }
    : null;

  useEffect(() => {
    if (!onInsight || !aasInsight) return;
    onInsight(aasInsight);
  }, [
    onInsight,
    aasInsight?.primaryDirection,
    aasInsight?.secondaryDirection,
    aasInsight?.stance,
    aasInsight?.confidence,
    aasInsight?.summary,
  ]);

  if (loading) {
    return (
      <div className="primary-card p-4 md:p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-stealth-700 rounded mb-3 w-1/3"></div>
          <div className="h-12 bg-stealth-700 rounded mb-4"></div>
        </div>
      </div>
    );
  }

  if (!aasData) {
    return (
      <div className="primary-card p-4 md:p-6">
        <p className="text-stealth-400 text-sm">Unable to load AAS data</p>
      </div>
    );
  }

  return (
      <div
        className="primary-card primary-card-hover p-4 md:p-6 cursor-pointer h-full"
        onClick={() => navigate('/alternative-assets')}
      >
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
            <div
              className={`flex-1 p-2 rounded text-center text-xs font-semibold ${
                aasData.primary_driver === "metals"
                  ? ""
                  : "bg-stealth-700/50 border border-stealth-600 text-stealth-400"
              }`}
              style={
                aasData.primary_driver === "metals"
                  ? {
                      backgroundColor: metalsSoft,
                      border: `1px solid ${metalsColor}`,
                      color: metalsColor,
                    }
                  : undefined
              }
            >
              Metals {metalsPercent.toFixed(0)}%
            </div>
            <div
              className={`flex-1 p-2 rounded text-center text-xs font-semibold ${
                aasData.primary_driver === "crypto"
                  ? ""
                  : "bg-stealth-700/50 border border-stealth-600 text-stealth-400"
              }`}
              style={
                aasData.primary_driver === "crypto"
                  ? {
                      backgroundColor: cryptoSoft,
                      border: `1px solid ${cryptoColor}`,
                      color: cryptoColor,
                    }
                  : undefined
              }
            >
              Crypto {cryptoPercent.toFixed(0)}%
            </div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Link
            to="/alternative-assets?tab=metals"
            onClick={(event) => event.stopPropagation()}
            className="group secondary-card block p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-stealth-500/80 hover:bg-stealth-800/80"
            aria-label="Open Precious Metals detail"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: metalsColor }}>
                Metals Leaders
              </p>
              <span className="text-[11px] text-stealth-500 transition-colors group-hover:text-stealth-300">ranked basket</span>
            </div>
            <div className="space-y-2">
              {metalsRankings.length > 0 ? (
                metalsRankings.map((metal) => (
                  <div key={metal.metal} className="flex items-center justify-between gap-3 rounded border border-stealth-700/80 bg-stealth-800/60 px-2.5 py-2 text-xs transition-colors group-hover:border-amber-500/40 group-hover:bg-stealth-800/90">
                    <div className="min-w-0">
                      <div className="font-semibold text-stealth-100">
                        #{metal.rank} <span style={{ color: getMetalColor(metal.metal) }}>{metal.metal_name}</span>
                      </div>
                      <div className="text-stealth-400">{formatMiniPrice(metal.current_price)} · Score {metal.score_total.toFixed(0)}</div>
                    </div>
                    <span className={`shrink-0 rounded border px-2 py-1 text-[11px] font-semibold ${getRelativeClassStyles(metal.relative_classification)}`}>
                      {metal.relative_classification}
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded border border-stealth-700/80 bg-stealth-800/60 px-2.5 py-2 text-xs text-stealth-400">
                  Loading metals ranking...
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-end text-[11px] text-stealth-500 transition-colors group-hover:text-amber-300">
              View metals tab
              <span className="ml-1">→</span>
            </div>
          </Link>

          <Link
            to="/alternative-assets?tab=crypto"
            onClick={(event) => event.stopPropagation()}
            className="group secondary-card block p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-stealth-500/80 hover:bg-stealth-800/80"
            aria-label="Open Crypto detail"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: cryptoColor }}>
                Crypto Leaders
              </p>
              <span className="text-[11px] text-stealth-500 transition-colors group-hover:text-stealth-300">technical basket</span>
            </div>
            <div className="space-y-2">
              {cryptoRankings.length > 0 ? (
                cryptoRankings.map((asset) => (
                  <div key={asset.symbol} className="flex items-center justify-between gap-3 rounded border border-stealth-700/80 bg-stealth-800/60 px-2.5 py-2 text-xs transition-colors group-hover:border-blue-500/40 group-hover:bg-stealth-800/90">
                    <div className="min-w-0">
                      <div className="font-semibold text-stealth-100">
                        #{asset.rank} <span style={{ color: asset.color }}>{asset.name}</span>
                      </div>
                      <div className="text-stealth-400">{formatMiniPrice(asset.current_price)} · Score {asset.score_total.toFixed(0)}</div>
                    </div>
                    <span className={`shrink-0 rounded border px-2 py-1 text-[11px] font-semibold ${getRelativeClassStyles(asset.relativeClassification)}`}>
                      {asset.relativeClassification}
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded border border-stealth-700/80 bg-stealth-800/60 px-2.5 py-2 text-xs text-stealth-400">
                  Loading crypto ranking...
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-end text-[11px] text-stealth-500 transition-colors group-hover:text-blue-300">
              View crypto tab
              <span className="ml-1">→</span>
            </div>
          </Link>
        </div>

        {/* Historical Chart */}
        <div className="mb-4">
          <p className="text-xs text-stealth-400 mb-2">{parseInt(timeframe)}-Day Contribution Trend</p>
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                  <XAxis 
                    dataKey="date" 
                    stroke={CHART_NEUTRAL.tick}
                    tick={{ fontSize: 10 }}
                    interval={Math.floor(Math.max(0, chartData.length / 4))}
                  />
                  <YAxis 
                    stroke={CHART_NEUTRAL.tick}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis yAxisId="right" orientation="right" stroke={CHART_NEUTRAL.tick} tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: CHART_NEUTRAL.tooltipBg,
                      border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`,
                      borderRadius: '0.5rem',
                      fontSize: '12px'
                    }}
                    formatter={(value) => (value as number).toFixed(3)}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="metals_contribution" 
                    stackId="1" 
                    fill={metalsFill}
                    stroke={metalsColor}
                    strokeWidth={1.5}
                    fillOpacity={0.3}
                    name="Metals"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="crypto_contribution" 
                    stackId="1" 
                    fill={cryptoFill}
                    stroke={cryptoColor}
                    strokeWidth={1.5}
                    fillOpacity={0.3}
                    name="Crypto"
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="sma20" 
                    stroke={benchmarkColor}
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
  );
}
