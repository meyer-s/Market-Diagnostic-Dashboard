import { useState, useEffect, useCallback, useMemo } from "react";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";
import SectorDivergenceWidget from "../components/widgets/SectorDivergenceWidget";
import AASWidget from "../components/widgets/AASWidget";
import YieldCurveCard from "../components/widgets/YieldCurveCard";
import EconomicDriverSnapshots from "../components/widgets/EconomicDriverSnapshots";
import DetailsDisclosure from "../components/ui/DetailsDisclosure";
import MarketLoading from "../components/ui/MarketLoading";
import SegmentedControl from "../components/ui/SegmentedControl";
import LiveNewsSection from "../components/news/LiveNewsSection";
import { apiFetch, getErrorMessage } from "../utils/apiUtils";
import { getTrendWindows, type InsightSignal } from "../utils/insightUtils";

type OverallInsight = {
  label: string;
  color: string;
  summary: string;
  posture: InsightSignal["stance"];
  primaryDirection: InsightSignal["primaryDirection"];
  secondaryDirection: InsightSignal["secondaryDirection"];
  confidence: InsightSignal["confidence"];
};

const describeDirection = (direction: InsightSignal["primaryDirection"]) => {
  if (direction === "up") return "an uptrend";
  if (direction === "down") return "a downtrend";
  return "a sideways move";
};

const capitalize = (value: string) =>
  value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;

const buildOverallInsight = (
  signals: InsightSignal[],
  trendLabel: string
): OverallInsight | null => {
  if (signals.length < 4) return null;

  const stanceScore = signals.reduce((sum, item) => {
    if (item.stance === "risk-on") return sum + 1;
    if (item.stance === "risk-off") return sum - 1;
    return sum;
  }, 0);
  const primaryDirectionScore = signals.reduce((sum, item) => {
    if (item.primaryDirection === "up") return sum + 1;
    if (item.primaryDirection === "down") return sum - 1;
    return sum;
  }, 0);
  const secondaryDirectionScore = signals.reduce((sum, item) => {
    if (item.secondaryDirection === "up") return sum + 1;
    if (item.secondaryDirection === "down") return sum - 1;
    return sum;
  }, 0);
  const confidenceScore = signals.reduce((sum, item) => {
    if (item.confidence === "high") return sum + 1;
    if (item.confidence === "low") return sum - 1;
    return sum;
  }, 0);

  const posture: InsightSignal["stance"] =
    stanceScore >= 2 ? "risk-on" : stanceScore <= -2 ? "risk-off" : "mixed";
  const primaryDirection: InsightSignal["primaryDirection"] =
    primaryDirectionScore >= 2 ? "up" : primaryDirectionScore <= -2 ? "down" : "flat";
  const secondaryDirection: InsightSignal["secondaryDirection"] =
    secondaryDirectionScore >= 2 ? "up" : secondaryDirectionScore <= -2 ? "down" : "flat";
  let confidence: InsightSignal["confidence"] =
    confidenceScore >= 2 ? "high" : confidenceScore <= -2 ? "low" : "medium";
  if (
    primaryDirection !== "flat" &&
    secondaryDirection !== "flat" &&
    primaryDirection !== secondaryDirection
  ) {
    confidence = "low";
  }

  const label =
    posture === "risk-on" ? "Positive" : posture === "risk-off" ? "Cautious" : "Mixed";
  const color =
    posture === "risk-on"
      ? "text-green-400"
      : posture === "risk-off"
      ? "text-red-400"
      : "text-yellow-400";
  const primaryPhrase = describeDirection(primaryDirection);
  const secondaryPhrase = describeDirection(secondaryDirection);
  let summary = "";
  if (posture === "risk-on") {
    summary = `Tailwinds lead. ${trendLabel} shows ${primaryPhrase}, with ${secondaryPhrase} recently.`;
  } else if (posture === "risk-off") {
    summary = `Caution leads. ${trendLabel} shows ${primaryPhrase}, with ${secondaryPhrase} recently.`;
  } else {
    summary = `Signals are split. ${trendLabel} shows ${primaryPhrase}, with ${secondaryPhrase} recently.`;
  }

  if (confidence === "low") {
    summary += " Noisy read.";
  } else if (confidence === "high") {
    summary += " Clear read.";
  }

  return {
    label,
    color,
    summary,
    posture,
    primaryDirection,
    secondaryDirection,
    confidence,
  };
};

export default function Dashboard() {
  const [indicators, setIndicators] = useState<IndicatorStatus[] | null>(null);
  const [indicatorsLoading, setIndicatorsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [trendPeriod, setTrendPeriod] = useState<90 | 180 | 365>(90);
  const [insights, setInsights] = useState<Partial<Record<InsightSignal["id"], InsightSignal>>>({});

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
  const insightOrder: InsightSignal["id"][] = ["system", "dow", "sector", "aas"];
  const insightList = useMemo(
    () => insightOrder.map((id) => insights[id]).filter(Boolean) as InsightSignal[],
    [insights]
  );
  const overallTrendLabel = useMemo(() => getTrendWindows(trendPeriod).label, [trendPeriod]);
  const overallInsight = useMemo(
    () => buildOverallInsight(insightList, overallTrendLabel),
    [insightList, overallTrendLabel]
  );
  const confidenceLabel = overallInsight
    ? overallInsight.confidence === "high"
      ? "Clear read"
      : overallInsight.confidence === "low"
      ? "Noisy read"
      : "Mixed read"
    : "";
  const handleInsight = useCallback((insight: InsightSignal) => {
    setInsights((prev) => {
      const existing = prev[insight.id];
      if (
        existing &&
        existing.summary === insight.summary &&
        existing.primaryDirection === insight.primaryDirection &&
        existing.secondaryDirection === insight.secondaryDirection &&
        existing.stance === insight.stance &&
        existing.confidence === insight.confidence
      ) {
        return prev;
      }
      return { ...prev, [insight.id]: insight };
    });
  }, []);

  const directionLabel = {
    up: "Uptrend",
    down: "Downtrend",
    flat: "Sideways",
  } as const;
  const directionStyles = {
    up: "text-green-300",
    down: "text-red-300",
    flat: "text-stealth-300",
  } as const;

  const formatInsightSummary = (insight: InsightSignal) => {
    const primary = capitalize(describeDirection(insight.primaryDirection));
    const secondary = capitalize(describeDirection(insight.secondaryDirection));
    return `${overallTrendLabel}: ${primary}. Recent: ${secondary}.`;
  };
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

      <section id="current-read" aria-labelledby="current-read-title" className="dashboard-current-read scroll-mt-32">
        <h2 id="current-read-title" className="sr-only">Current market read</h2>
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
        {!overallInsight && (
          <div className="dashboard-current-read-console surface-card-strong p-4 sm:p-5" role="status" aria-live="polite">
            <div className="dashboard-current-read-heading">
              <p className="dashboard-current-read-read text-lg font-semibold text-stealth-100">Reading signals…</p>
            </div>
            <div className="dashboard-direction-strip mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" aria-hidden="true">
              {["System", "Dow", "Sectors", "Alts"].map((label) => (
                <div key={label} className="direction-card dashboard-current-read-loading-card">
                  <div className="text-xs font-semibold text-stealth-300">{label}</div>
                  <div className="mt-3 h-2 w-16 rounded-full bg-stealth-700" />
                  <div className="mt-2 h-2 w-24 max-w-full rounded-full bg-stealth-800" />
                </div>
              ))}
            </div>
          </div>
        )}
        {overallInsight && (
          <div className="dashboard-current-read-console surface-card-strong p-4 sm:p-5">
            <div className="dashboard-current-read-heading flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-stealth-400 uppercase tracking-wide">Overall Summary</div>
                <h2 className={`dashboard-current-read-read text-lg font-semibold ${overallInsight.color}`}>{overallInsight.label}</h2>
              </div>
              <div className="dashboard-current-read-confidence text-xs text-stealth-500 text-right">
                {confidenceLabel}
              </div>
            </div>
            <div className="dashboard-direction-strip mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {insightList.map((insight) => (
                <div
                  key={insight.id}
                  className={`direction-card direction-card-${insight.primaryDirection}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                    <span className="text-xs font-semibold text-stealth-100">
                      {insight.label}
                    </span>
                    <span className={`text-xs uppercase ${directionStyles[insight.primaryDirection]}`}>
                      {directionLabel[insight.primaryDirection]}
                    </span>
                  </div>
                  {insight.secondaryDirection !== insight.primaryDirection && (
                    <p className="mt-1 text-xs text-stealth-300">Recent · {directionLabel[insight.secondaryDirection]}</p>
                  )}
                </div>
              ))}
            </div>
            <DetailsDisclosure label="How to read the market summary" className="mt-3">
              <p>{overallInsight.summary}</p>
              <dl className="grid gap-2 sm:grid-cols-2">
                {insightList.map((insight) => (
                  <div key={insight.id}>
                    <dt className="font-semibold text-stealth-100">{insight.label}</dt>
                    <dd>{formatInsightSummary(insight)}</dd>
                  </div>
                ))}
              </dl>
            </DetailsDisclosure>
          </div>
        )}
      </section>

      <section id="drivers" aria-labelledby="drivers-title" className="dashboard-drivers scroll-mt-32">
        <div className="mb-3">
          <div className="page-kicker">Drivers</div>
          <h2 id="drivers-title" className="mt-1 text-xl font-semibold text-stealth-100 sm:text-2xl">What is moving the read</h2>
        </div>
        <div className="dashboard-driver-grid grid grid-cols-1 gap-3 md:gap-6 lg:grid-cols-2">
          <div className="dashboard-driver-shell dashboard-driver-system">
            <SystemOverviewWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
          </div>
          <div className="dashboard-driver-shell dashboard-driver-dow">
            <DowTheoryWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
          </div>
          <div className="dashboard-driver-shell dashboard-driver-sector">
            <SectorDivergenceWidget trendPeriod={trendPeriod} onInsight={handleInsight} />
          </div>
          <div className="dashboard-driver-shell dashboard-driver-aas">
            <AASWidget
              timeframe={trendPeriod === 90 ? '90d' : trendPeriod === 180 ? '180d' : '365d'}
              onInsight={handleInsight}
            />
          </div>
        </div>
        <div className="mt-6 md:mt-8">
          <EconomicDriverSnapshots />
        </div>
      </section>

      <LiveNewsSection compact />

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
