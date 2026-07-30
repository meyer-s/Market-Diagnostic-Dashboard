import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";
import SectorDivergenceWidget from "../components/widgets/SectorDivergenceWidget";
import AASWidget from "../components/widgets/AASWidget";
import MarketLoading from "../components/ui/MarketLoading";
import SectionNav from "../components/ui/SectionNav";
import { apiFetch, getErrorMessage } from "../utils/apiUtils";
import { getTrendWindows, type InsightSignal } from "../utils/insightUtils";

interface NewsArticle {
  id: number;
  symbol: string;
  sector?: string | null;
  title: string;
  link: string;
  source: string;
  published_at: string;
}

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
  const driverGridRef = useRef<HTMLDivElement>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [indicators, setIndicators] = useState<IndicatorStatus[] | null>(null);
  const [indicatorsLoading, setIndicatorsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [trendPeriod, setTrendPeriod] = useState<90 | 180 | 365>(90);
  const [insights, setInsights] = useState<Partial<Record<InsightSignal["id"], InsightSignal>>>({});

  useEffect(() => {
    let mounted = true;
    setIndicatorsLoading(true);
    Promise.allSettled([
      apiFetch<IndicatorStatus[]>("/indicators"),
      apiFetch<NewsArticle[]>("/news?hours=24&limit=200"),
    ])
      .then(([indicatorsResult, newsResult]) => {
        if (!mounted) return;
        let nextError: string | null = null;
        if (indicatorsResult.status === "fulfilled") {
          setIndicators(indicatorsResult.value);
        } else {
          setIndicators(null);
          nextError = getErrorMessage(indicatorsResult.reason);
        }

        if (newsResult.status === "fulfilled") {
          setNews(newsResult.value);
        } else {
          setNews([]);
          if (!nextError) {
            nextError = getErrorMessage(newsResult.reason);
          }
        }
        setDashboardError(nextError);
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

  useEffect(() => {
    const grid = driverGridRef.current;
    if (!grid || typeof window.matchMedia !== "function") return;

    const shells = Array.from(
      grid.querySelectorAll<HTMLElement>(":scope > .dashboard-driver-shell"),
    );
    const wideViewport = window.matchMedia("(min-width: 1024px)");
    let frameId: number | null = null;

    const resetRows = () => {
      shells.forEach((shell) => shell.style.removeProperty("grid-row-end"));
    };

    const applyRows = () => {
      frameId = null;
      if (
        document.documentElement.dataset.theme !== "observatory"
        || !wideViewport.matches
      ) {
        resetRows();
        return;
      }

      const gap = Number.parseFloat(
        getComputedStyle(grid).getPropertyValue("--observatory-driver-gap"),
      ) || 24;
      shells.forEach((shell) => {
        const content = shell.firstElementChild as HTMLElement | null;
        if (!content) return;
        const span = Math.max(
          1,
          Math.ceil(content.getBoundingClientRect().height + gap),
        );
        shell.style.gridRowEnd = `span ${span}`;
      });
    };

    const scheduleRows = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(applyRows);
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleRows);
    shells.forEach((shell) => {
      const content = shell.firstElementChild;
      if (content) resizeObserver?.observe(content);
    });
    const themeObserver = new MutationObserver(scheduleRows);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    wideViewport.addEventListener("change", scheduleRows);
    scheduleRows();

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      wideViewport.removeEventListener("change", scheduleRows);
      resetRows();
    };
  }, []);

  const newsCount = news.length;
  const visibleIndicators = useMemo(() => indicators?.filter((i) => i.code !== "AAS" && i.code !== "AAP") ?? [], [indicators]);
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
          <span className="page-kicker">Daily Diagnostic</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Dashboard</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300 md:text-[15px]">Real-time market regime assessment across volatility, rates, liquidity, and sentiment.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-stealth-300">
            <span className="page-badge">{visibleIndicators.length} active indicators</span>
            <span className="page-badge">Trend window {overallTrendLabel}</span>
            <span className="page-badge border-stealth-600 bg-stealth-900/80 text-stealth-200">Read-only public dashboard</span>
          </div>
        </div>

        <div className="dashboard-command-dock flex flex-col gap-3 sm:items-end">
          <div className="flex items-center gap-2 sm:gap-4">
            {newsCount > 0 && (
              <div className="page-badge border-sky-500/40 bg-sky-500/12 text-sky-200">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                </span>
                <span className="text-xs sm:text-sm font-semibold text-sky-300">
                  {newsCount} News Item{newsCount !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="control-strip">
              <button
                type="button"
                onClick={() => setTrendPeriod(90)}
                aria-pressed={trendPeriod === 90}
                className={`min-h-11 flex-1 whitespace-nowrap rounded-full px-3 text-xs font-medium transition sm:text-sm ${
                  trendPeriod === 90
                    ? 'bg-stealth-700 text-white'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                90d
              </button>
              <button
                type="button"
                onClick={() => setTrendPeriod(180)}
                aria-pressed={trendPeriod === 180}
                className={`min-h-11 flex-1 whitespace-nowrap rounded-full px-3 text-xs font-medium transition sm:text-sm ${
                  trendPeriod === 180
                    ? 'bg-stealth-700 text-white'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                6mo
              </button>
              <button
                type="button"
                onClick={() => setTrendPeriod(365)}
                aria-pressed={trendPeriod === 365}
                className={`min-h-11 flex-1 whitespace-nowrap rounded-full px-3 text-xs font-medium transition sm:text-sm ${
                  trendPeriod === 365
                    ? 'bg-stealth-700 text-white'
                    : 'text-stealth-400 hover:text-stealth-200'
                }`}
              >
                1yr
              </button>
            </div>
          </div>
        </div>
      </div>

      <SectionNav
        id="observatory-dashboard-sections"
        className="observatory-context-rail hidden"
        label="Dashboard sections"
        items={[
          { id: "current-read", label: "Current read" },
          { id: "drivers", label: "Drivers" },
          { id: "indicator-breadth", label: "Indicators" },
        ]}
      />

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
            <div className="dashboard-current-read-heading flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-stealth-400 uppercase tracking-wide">Overall Summary</div>
                <h2 className="dashboard-current-read-read text-lg font-semibold text-stealth-100">Reading signals</h2>
              </div>
              <div className="dashboard-current-read-confidence text-xs text-stealth-500 text-right">
                Live synthesis
              </div>
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
            <p className="text-sm text-stealth-300">Calculating the current read from available indicators…</p>
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-stealth-100">
                      {insight.label}
                    </span>
                    <span className={`text-xs uppercase ${directionStyles[insight.primaryDirection]}`}>
                      {directionLabel[insight.primaryDirection]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-stealth-200">
                    {formatInsightSummary(insight)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-stealth-300 mt-3 leading-relaxed">
              {overallInsight.summary}
            </p>
          </div>
        )}
      </section>

      <section id="drivers" aria-labelledby="drivers-title" className="dashboard-drivers scroll-mt-32">
        <div className="mb-3">
          <div className="page-kicker">Drivers</div>
          <h2 id="drivers-title" className="mt-1 text-xl font-semibold text-stealth-100 sm:text-2xl">What is moving the read</h2>
        </div>
        <div ref={driverGridRef} className="dashboard-driver-grid grid grid-cols-1 gap-3 md:gap-6 lg:grid-cols-2">
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
          <IndicatorCard key={i.code} indicator={i} />
        ))}
      </div>
      </section>
    </div>
  );
}
