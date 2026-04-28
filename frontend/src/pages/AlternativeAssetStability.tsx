import { useState, useEffect } from "react";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { OverviewTab } from "../components/aas/OverviewTab";
import PreciousMetalsDiagnostic from "./PreciousMetalsDiagnostic";
import CryptoDiagnostic from "./CryptoDiagnostic";
import MarketLoading from "../components/ui/MarketLoading";

interface AASHistoryPoint {
  date: string;
  stability_score: number;
  regime: string;
  sma_20?: number;
  sma_200?: number;
  metals_contribution: number;
  crypto_contribution: number;
}

interface AASComponent {
  name: string;
  category: string;
  value: number;
  weight: number;
  contribution: number;
  status: "active" | "missing";
  description: string;
}

interface AASBreakdownData {
  components: AASComponent[];
  metals_contribution: number;
  crypto_contribution: number;
  stability_score: number;
  regime: string;
  data_completeness?: number;
}

type AASComponentHistoryResponse = { data: Record<string, { date: string; value: number | null }[]> };

export default function AlternativeAssetStability() {
  const [searchParams] = useSearchParams();
  const { data: aasData, loading } = useApi<AASBreakdownData>("/aas/components/breakdown");
  const { data: historyData } = useApi<{ data: AASHistoryPoint[] }>("/aas/history?days=365");
  const { data: componentHistory } = useApi<AASComponentHistoryResponse>("/aas/components/history?days=365");
  const [timeframe, setTimeframe] = useState<"30d" | "90d" | "180d" | "365d">("90d");
  const [selectedTab, setSelectedTab] = useState<"overview" | "metals" | "crypto">("overview");

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "metals" || tabParam === "overview" || tabParam === "crypto") {
      setSelectedTab(tabParam);
    }
  }, [searchParams]);

  const history = React.useMemo(() => {
    if (!historyData || !historyData.data || !Array.isArray(historyData.data)) {
      return [];
    }

    const days = parseInt(timeframe, 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const toStabilityLine = (contribution: number) => {
      const contributionPct = contribution * 100;
      return Math.max(0, Math.min(100, 100 - contributionPct));
    };

    return historyData.data
      .filter((point: AASHistoryPoint) => new Date(point.date) >= cutoffDate)
      .map((point: AASHistoryPoint) => ({
        date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        score: point.stability_score || 0,
        regime: point.regime || "",
        sma20: point.sma_20 || 0,
        sma200: point.sma_200 || 0,
        metals_stability: toStabilityLine(point.metals_contribution || 0),
        crypto_stability: toStabilityLine(point.crypto_contribution || 0),
      }));
  }, [historyData, timeframe]);

  if (loading || !aasData) {
    return (
      <div className="page-shell-wide flex min-h-[60vh] items-center justify-center">
        <MarketLoading size={120} variant="pulse" label="Loading AAS diagnostic..." />
      </div>
    );
  }

  return (
    <div className="page-shell-wide page-stack">
        
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-2 h-8 bg-gradient-to-b from-amber-400 to-blue-500 rounded"></div>
            <h1 className="text-2xl md:text-4xl font-bold text-stealth-100">
              Alternative Asset Stability (AAS)
            </h1>
          </div>
          <p className="text-sm md:text-base text-stealth-400 max-w-4xl">
            Comprehensive 18-component indicator measuring systemic stability through precious metals and cryptocurrency signals.
            Tracks alternative asset adoption as a proxy for confidence in traditional financial assets and fiat currencies.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 border-b border-stealth-700 flex gap-4">
          <button
            onClick={() => setSelectedTab("overview")}
            className={`pb-3 px-2 font-semibold border-b-2 transition ${
              selectedTab === "overview"
                ? "border-emerald-500 text-emerald-300"
                : "border-transparent text-stealth-400 hover:text-gray-300"
            }`}
          >
            Stability Overview
          </button>
          <button
            onClick={() => setSelectedTab("metals")}
            className={`pb-3 px-2 font-semibold border-b-2 transition ${
              selectedTab === "metals"
                ? "border-amber-500 text-amber-300"
                : "border-transparent text-stealth-400 hover:text-gray-300"
            }`}
          >
            Precious Metals
          </button>
          <button
            onClick={() => setSelectedTab("crypto")}
            className={`pb-3 px-2 font-semibold border-b-2 transition ${
              selectedTab === "crypto"
                ? "border-blue-500 text-blue-300"
                : "border-transparent text-stealth-400 hover:text-gray-300"
            }`}
          >
            Crypto
          </button>
        </div>

        {/* Tab Content */}
        {selectedTab === "overview" && (
          <OverviewTab 
            aasData={aasData}
            history={history}
            componentHistory={componentHistory ?? undefined}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
          />
        )}

        {selectedTab === "metals" && (
          <div className="text-stealth-100">
            <PreciousMetalsDiagnostic embedded={true} />
          </div>
        )}

        {selectedTab === "crypto" && (
          <div className="text-stealth-100">
            <CryptoDiagnostic
              embedded={true}
              aasData={aasData}
              componentHistory={componentHistory ?? undefined}
            />
          </div>
        )}
    </div>
  );
}
