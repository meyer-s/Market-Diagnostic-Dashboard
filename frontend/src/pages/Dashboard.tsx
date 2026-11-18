import { useState, useEffect, useMemo } from "react";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";
import SectorDivergenceWidget from "../components/widgets/SectorDivergenceWidget";
import AASWidget from "../components/widgets/AASWidget";
import YieldCurveCard from "../components/widgets/YieldCurveCard";
import EconomicDriverSnapshots from "../components/widgets/EconomicDriverSnapshots";
import DashboardRecaps from "../components/widgets/DashboardRecaps";
import MarketLoading from "../components/ui/MarketLoading";
import SegmentedControl from "../components/ui/SegmentedControl";
import LiveNewsSection from "../components/news/LiveNewsSection";
import { apiFetch, getErrorMessage } from "../utils/apiUtils";

export default function Dashboard() {
  const [indicators, setIndicators] = useState<IndicatorStatus[] | null>(null);
  const [indicatorsLoading, setIndicatorsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [trendPeriod, setTrendPeriod] = useState<90 | 180 | 365>(90);

  useEffect(() => {
    let mounted = true;
    setIndicatorsLoading(true);
    void apiFetch<IndicatorStatus[]>("/indicators")
      .then((result) => {
        if (!mounted) return;
        setIndicators(result);
        setDashboardError(null);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setIndicators(null);
        setDashboardError(getErrorMessage(error));
      })
      .finally(() => {
        if (mounted) {
          setIndicatorsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [retryNonce]);

  const activeIndicators = useMemo(
    () => indicators?.filter((indicator) => indicator.code !== "AAS" && indicator.code !== "AAP") ?? [],
    [indicators]
  );
  const snapshotCodes = useMemo(
    () => new Set(["REAL_ESTATE_STABILITY", "AGRICULTURE_STABILITY", "ENERGY_STABILITY"]),
    []
  );
  const visibleIndicators = useMemo(
    () => activeIndicators.filter((indicator) => !snapshotCodes.has(indicator.code)),
    [activeIndicators, snapshotCodes]
  );
  return (
    <div className="dashboard-surface page-shell page-stack">
      <div className="dashboard-masthead flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="dashboard-masthead-copy flex flex-col">
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Dashboard</h1>
          {indicators && <p className="mt-1 text-xs text-stealth-300">{activeIndicators.length} active indicators</p>}
        </div>

        <div className="dashboard-command-dock flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-stealth-300" aria-hidden="true">Trend window</span>
          <SegmentedControl<90 | 180 | 365>
            label="Trend window"
            value={trendPeriod}
            onChange={setTrendPeriod}
            options={[{ value: 90, label: "90d" }, { value: 180, label: "6mo" }, { value: 365, label: "1yr" }]}
          />
        </div>
      </div>

      {dashboardError && (
        <div className="surface-card border-red-800/70 p-4 sm:p-5" role="alert">
          <p className="text-sm font-semibold text-red-200">Some dashboard evidence is unavailable.</p>
          <p className="mt-1 text-sm text-red-300">{dashboardError}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((value) => value + 1)}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-red-700 bg-red-950/50 px-4 text-sm font-semibold text-red-100 transition-colors hover:bg-red-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry unavailable data
          </button>
        </div>
      )}
      <section id="drivers" aria-labelledby="drivers-title" className="dashboard-drivers scroll-mt-32">
        <div className="mb-3">
          <div className="page-kicker">Drivers</div>
          <h2 id="drivers-title" className="mt-1 text-xl font-semibold text-stealth-100 sm:text-2xl">What is moving the read</h2>
        </div>
        <div className="dashboard-driver-grid grid grid-cols-1 gap-3 md:gap-6 lg:grid-cols-2">
          <div className="dashboard-driver-shell dashboard-driver-system">
            <SystemOverviewWidget trendPeriod={trendPeriod} />
          </div>
          <div className="dashboard-driver-shell dashboard-driver-dow">
            <DowTheoryWidget trendPeriod={trendPeriod} />
          </div>
          <div className="dashboard-driver-shell dashboard-driver-sector">
            <SectorDivergenceWidget trendPeriod={trendPeriod} />
          </div>
          <div className="dashboard-driver-shell dashboard-driver-aas">
            <AASWidget
              timeframe={trendPeriod === 90 ? '90d' : trendPeriod === 180 ? '180d' : '365d'}
            />
          </div>
        </div>
        <div className="mt-6 md:mt-8">
          <EconomicDriverSnapshots />
        </div>
      </section>

      <LiveNewsSection compact />
      <DashboardRecaps />

      <section id="rates-pulse" aria-labelledby="rates-pulse-title" className="scroll-mt-32">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="page-kicker">Rates pulse</div>
            <h2 id="rates-pulse-title" className="mt-1 text-xl font-semibold text-stealth-100 sm:text-2xl">
              The Treasury curve at a glance
            </h2>
          </div>
        </div>
        <YieldCurveCard />
      </section>

      <section id="indicator-breadth" aria-labelledby="indicator-breadth-title" className="dashboard-breadth scroll-mt-32">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="page-kicker">Breadth</div>
          <h2 id="indicator-breadth-title" className="mt-1 text-xl font-semibold text-stealth-100 sm:text-2xl">Indicators</h2>
        </div>
      </div>
      {indicatorsLoading && (
        <div className="flex justify-center">
          <MarketLoading size={96} variant="scan" />
        </div>
      )}
      <div className="dashboard-indicator-array grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {visibleIndicators.map((i) => (
          <IndicatorCard key={i.code} indicator={i} compact />
        ))}
      </div>
      </section>
    </div>
  );
}
