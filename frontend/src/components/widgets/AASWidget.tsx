import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from "recharts";
import {
  analyzeSeries,
  getTrendTone,
  getConfidenceFromSignal,
  getTrendWindows,
  type InsightSignal,
} from "../../utils/insightUtils";
import { useProgressiveCommitment } from "../../hooks/useProgressiveCommitment";
import { getFamilyColor } from "../../theme/metricColors";
import { CHART_ANIMATION } from "../../utils/chartUtils";

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
  timeframe?: "30d" | "90d" | "180d" | "365d";
  onInsight?: (insight: InsightSignal) => void;
}

export default function AASWidget({ timeframe = "90d", onInsight }: AASWidgetProps) {
  const { data: aasData, loading } = useApi<AASData>("/aap/current");
  const { data: historyData } = useApi<any>(`/aap/history?days=${parseInt(timeframe)}`);
  const [chartData, setChartData] = useState<HistoricalData[]>([]);
  const navigate = useNavigate();
  const commitment = useProgressiveCommitment({
    mode: "navigate",
    onCommit: () => navigate("/alternative-assets"),
  });

  useEffect(() => {
    if (historyData && historyData.data && Array.isArray(historyData.data)) {
      const days = parseInt(timeframe);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const processed = historyData.data
        .filter((d: any) => new Date(d.date) >= cutoffDate)
        .map((d: any) => ({
          date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          stability_score: d.stability_score || 0,
          metals_contribution: (d.metals_contribution || 0) * 100,
          crypto_contribution: (d.crypto_contribution || 0) * 100,
          sma20: d.sma_20 || 0,
          sma200: d.sma_200 || 0,
        }));
      setChartData(processed);
    }
  }, [historyData, timeframe]);

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
  const trendTone = getTrendTone(primarySignal);
  const aasConfidence = getConfidenceFromSignal(primarySignal);
  const signalLine =
    primarySignal.direction === "up"
      ? "Alt stability improving"
      : primarySignal.direction === "down"
      ? "Alt stability slipping"
      : "Alt stability steady";
  const contextLine =
    recentLeader === "metals"
      ? "Metals leading the pressure mix"
      : "Crypto leading the pressure mix";
  const hoverNote = leaderShifted ? "leader shift" : `${trendTone} trend`;
  const summaryShort = `${trendWindows.shortLabel} ${primarySignal.direction}${
    secondarySignal.direction === primarySignal.direction
      ? ""
      : ` / recent ${secondarySignal.direction}`
  }`;
  const miniSeries = chartData.length
    ? chartData.map((point) => ({ date: point.date, stability_score: point.stability_score }))
    : aasData
    ? [{ date: "Now", stability_score: aasData.stability_score }]
    : [];
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
        confidence: aasConfidence,
        summary: summaryShort,
      }
    : null;
  const showDetails = commitment.state !== "rest";
  const detailWrapClass = `overflow-hidden transition-[max-height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
    showDetails ? "max-h-80" : "max-h-0"
  }`;
  const detailContentClass = `transition-opacity duration-200 ease-in-out ${
    showDetails ? "opacity-100 delay-75" : "opacity-0"
  }`;
  const accentColor = getFamilyColor("market", "muted");

  const getScoreClass = (score: number): string => {
    if (score >= 67) return "text-green-400";
    if (score >= 34) return "text-yellow-400";
    return "text-red-400";
  };

  const getRegimeClass = (regime: string): string => {
    if (regime.includes("breakdown") || regime.includes("crisis")) return "text-red-400";
    if (regime.includes("stress") || regime.includes("caution")) return "text-yellow-400";
    return "text-green-400";
  };

  const getRegimeLabel = (regime: string): string => {
    const labels: Record<string, string> = {
      normal_confidence: "Normal Confidence",
      mild_caution: "Mild Caution",
      monetary_stress: "Monetary Stress",
      liquidity_crisis: "Liquidity Crisis",
      systemic_breakdown: "Systemic Breakdown",
    };
    return labels[regime] ||
      regime
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  };

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

  return (
    <div
      {...commitment.getContainerProps<HTMLDivElement>()}
      className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg p-4 md:p-6 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stealth-500/60"
      aria-expanded={commitment.isExpanded}
    >
      <div className="h-1 rounded-full mb-3" style={{ backgroundColor: accentColor }} />
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-stealth-100">Alternative Asset Stability</h3>
        <span className="text-xs text-stealth-500">{trendWindows.shortLabel}</span>
      </div>

      <div className="text-sm text-stealth-200">
        <span className="text-stealth-500">Signal:</span> {signalLine}
      </div>
      <div className="text-sm text-stealth-400">
        <span className="text-stealth-500">Context:</span> {contextLine}
      </div>
      {commitment.state === "focus" && (
        <div className="text-xs text-stealth-500 transition-opacity duration-150 motion-reduce:transition-none">
          Confidence: {aasConfidence} - leader {recentLeader} ({hoverNote})
        </div>
      )}
      {miniSeries.length > 0 && (
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={miniSeries}>
              <XAxis dataKey="date" hide />
              <YAxis domain={[0, 100]} hide />
              <Line
                type="monotone"
                dataKey="stability_score"
                stroke={getFamilyColor("market")}
                strokeWidth={2}
                dot={false}
                animationDuration={CHART_ANIMATION.duration}
                animationEasing={CHART_ANIMATION.easing}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className={`${detailWrapClass} ${showDetails ? "mt-2" : ""}`}>
        <div className={detailContentClass}>
          <div className="flex items-end gap-2 mb-2">
            <div className={`text-3xl font-bold ${getScoreClass(aasData.stability_score)}`}>
              {aasData.stability_score.toFixed(1)}
            </div>
            <div className="text-xs text-stealth-400 mb-1">/ 100</div>
          </div>
          <div className="text-xs text-stealth-400 mb-1">Current Regime</div>
          <div className={`text-sm font-semibold ${getRegimeClass(aasData.regime)}`}>
            {getRegimeLabel(aasData.regime)}
          </div>
        </div>
      </div>
    </div>
  );
}
