import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";

interface Alert {
  id: number;
  timestamp: string;
  type: string;
  message: string;
  affected_indicators: string[];
}

export default function Dashboard() {
  const { data: indicators } = useApi<IndicatorStatus[]>("/indicators");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [trendPeriod, setTrendPeriod] = useState<90 | 180 | 365>(90);

  useEffect(() => {
    // Fetch active alerts
    fetch("http://localhost:8000/alerts?hours=24")
      .then(res => res.json())
      .then(data => setAlerts(data))
      .catch(() => setAlerts([]));
  }, []);

  const activeAlertCount = alerts.length;

  return (
    <div className="p-6 text-gray-200">
      {/* Header with Alert Badge */}
      <div className="flex flex-col mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold">Dashboard</h2>
          {activeAlertCount > 0 && (
            <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/50 rounded-full px-3 py-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span className="text-sm font-semibold text-red-400">
                {activeAlertCount} Active Alert{activeAlertCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          </div>

          {/* Trend Period Toggle */}
          <div className="flex items-center gap-2 bg-stealth-800 border border-stealth-700 rounded-lg p-1">
          <button
            onClick={() => setTrendPeriod(90)}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              trendPeriod === 90
                ? 'bg-stealth-600 text-stealth-100'
                : 'text-stealth-400 hover:text-stealth-200'
            }`}
          >
            90 Days
          </button>
          <button
            onClick={() => setTrendPeriod(180)}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              trendPeriod === 180
                ? 'bg-stealth-600 text-stealth-100'
                : 'text-stealth-400 hover:text-stealth-200'
            }`}
          >
            6 Months
          </button>
          <button
            onClick={() => setTrendPeriod(365)}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              trendPeriod === 365
                ? 'bg-stealth-600 text-stealth-100'
                : 'text-stealth-400 hover:text-stealth-200'
            }`}
          >
            1 Year
          </button>
          </div>
        </div>

        {/* System Description */}
        <div className="bg-stealth-850/50 border border-stealth-700/50 rounded-lg p-4">
          <p className="text-sm text-stealth-300 leading-relaxed">
            Comprehensive market diagnostic system monitoring <strong className="text-stealth-100">8 critical indicators</strong> across 
            <strong className="text-stealth-100"> volatility</strong> (VIX), 
            <strong className="text-stealth-100"> equities</strong> (SPY), 
            <strong className="text-stealth-100"> interest rates</strong> (DFF, T10Y2Y), 
            <strong className="text-stealth-100"> employment</strong> (UNRATE), 
            <strong className="text-stealth-100"> bond markets</strong> (Bond Stability Composite), 
            <strong className="text-stealth-100"> liquidity</strong> (Liquidity Proxy), and 
            <strong className="text-stealth-100"> consumer health</strong> (PCE, PI, CPI). 
            Each indicator is statistically normalized and weighted to detect early signs of market stress, regime shifts, 
            and systemic risks before they cascade into broader crises.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <SystemOverviewWidget trendPeriod={trendPeriod} />
        <DowTheoryWidget />
      </div>

      <h3 className="text-xl font-semibold mb-4">Indicators</h3>
      <div className="grid grid-cols-3 gap-4">
        {indicators?.map((i) => (
          <IndicatorCard key={i.code} indicator={i} />
        ))}
      </div>
    </div>
  );
}