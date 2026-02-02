import { useState, useEffect } from "react";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { OverviewTab } from "../components/aap/OverviewTab";
import PreciousMetalsDiagnostic from "./PreciousMetalsDiagnostic";
import MarketLoading from "../components/ui/MarketLoading";

export default function AlternativeAssetStability() {
  const [searchParams] = useSearchParams();
  const { data: aapData, loading } = useApi<any>('/aap/components/breakdown');
  const { data: historyData } = useApi<any>('/aap/history?days=365');
  const { data: componentHistory } = useApi<any>('/aap/components/history?days=365');
  const [timeframe, setTimeframe] = useState<'30d' | '90d' | '180d' | '365d'>('90d');
  const [selectedTab, setSelectedTab] = useState<'overview' | 'metals'>('overview');

  // Handle tab query parameter
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'metals' || tabParam === 'overview') {
      setSelectedTab(tabParam);
    }
  }, [searchParams]);

  // Filter history based on timeframe
  const history = React.useMemo(() => {
    if (!historyData || !historyData.data || !Array.isArray(historyData.data)) return [];
    
    const days = parseInt(timeframe);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return historyData.data
      .filter((d: any) => new Date(d.date) >= cutoffDate)
      .map((d: any) => ({
        date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        score: d.stability_score || 0,
        regime: d.regime || '',
        sma20: d.sma_20 || 0,
        sma200: d.sma_200 || 0,
        metals_contribution: (d.metals_contribution || 0) * 100,
        crypto_contribution: (d.crypto_contribution || 0) * 100
      }));
  }, [historyData, timeframe]);

  if (loading || !aapData) {
    return (
      <div className="min-h-screen bg-stealth-900 flex items-center justify-center">
        <MarketLoading size={120} variant="pulse" label="Loading AAS diagnostic..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stealth-900 text-stealth-100">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        
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
        </div>

        {/* Tab Content */}
        {selectedTab === "overview" && (
          <OverviewTab 
            aapData={aapData}
            history={history}
            componentHistory={componentHistory}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
          />
        )}

        {selectedTab === "metals" && (
          <div className="text-stealth-100">
            <PreciousMetalsDiagnostic embedded={true} />
          </div>
        )}
      </div>
    </div>
  );
}
