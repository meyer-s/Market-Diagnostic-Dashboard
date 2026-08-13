import { lazy, Suspense, type ReactElement } from "react";
import { Link, Navigate, Route, Routes, matchPath, useParams } from "react-router-dom";

import PageState from "../components/ui/PageState";

const Dashboard = lazy(() => import("../pages/Dashboard"));
const Vision = lazy(() => import("../pages/Vision"));
const SystemBreakdown = lazy(() => import("../pages/SystemBreakdown"));
const Indicators = lazy(() => import("../pages/Indicators"));
const IndicatorDetail = lazy(() => import("../pages/IndicatorDetail"));
const MarketNews = lazy(() => import("../pages/MarketNews"));
const MarketMap = lazy(() => import("../pages/MarketMap"));
const SectorProjections = lazy(() => import("../pages/SectorProjections"));
const StockAnalysis = lazy(() => import("../pages/StockAnalysis"));
const InstitutionalFlow = lazy(() => import("../pages/InstitutionalFlow"));
const MarketWeatherRadar = lazy(() => import("../pages/MarketWeatherRadar"));
const SecretOptions = lazy(() => import("../pages/SecretOptions"));
const RecapIndex = lazy(() => import("../pages/tools/RecapIndex"));
const RecapPost = lazy(() => import("../pages/tools/RecapPost"));
const VolumeBreadthTools = lazy(() => import("../pages/tools/VolumeBreadthTools"));
const PreciousMetalsDiagnostic = lazy(() => import("../pages/PreciousMetalsDiagnostic"));
const CryptoDiagnostic = lazy(() => import("../pages/CryptoDiagnostic"));
const AgricultureIndex = lazy(() => import("../pages/AgricultureIndex"));
const AgricultureReportDesk = lazy(() => import("../pages/AgricultureReportDesk"));
const EnergyIndex = lazy(() => import("../pages/EnergyIndex"));
const RealEstateDiagnostic = lazy(() => import("../pages/RealEstateDiagnostic"));

type NavGroup = "primary" | "tools";
type ToolGroup = "market-views" | "asset-classes" | "research";

export type AppRouteDefinition = {
  path: string;
  analyticsName: string;
  element: ReactElement;
  label?: string;
  navGroup?: NavGroup;
  toolGroup?: ToolGroup;
  visible?: boolean;
  activeMatch?: string;
};

function LegacyRecapSlugRedirect() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) {
    return <Navigate to="/tools/recap" replace />;
  }
  return <Navigate to={`/tools/recap/${slug}`} replace />;
}

function BondHealthStabilityPage() {
  return <IndicatorDetail forcedCode="BOND_MARKET_STABILITY" />;
}

function RetiredAssetDiagnosticsPage() {
  return (
    <div className="page-shell page-stack">
      <PageState
        variant="empty"
        headingLevel={1}
        title="Asset diagnostics moved"
        message="The former combined AAS view has been retired. Metals and crypto now have independent diagnostics, evidence, and methodology."
        actions={(
          <>
            <Link className="field-button field-button-primary" to="/metals-indicators">Open Metals</Link>
            <Link className="field-button field-button-secondary" to="/crypto-indicators">Open Crypto</Link>
          </>
        )}
      />
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="page-shell page-stack">
      <PageState
        variant="empty"
        headingLevel={1}
        title="Page not found"
        message="This address is not part of the current dashboard. Continue with the main diagnostic or choose a supported research surface."
        actions={(
          <>
            <Link className="field-button field-button-primary" to="/">Open dashboard</Link>
            <Link className="field-button field-button-secondary" to="/metals-indicators">Open Metals</Link>
            <Link className="field-button field-button-secondary" to="/crypto-indicators">Open Crypto</Link>
          </>
        )}
      />
    </div>
  );
}

function RouteLoadingState() {
  return (
    <div className="page-shell page-stack">
      <PageState
        variant="loading"
        headingLevel={1}
        title="Opening research workspace"
        message="Loading this view. Current market data will load separately once the interface is ready."
      />
    </div>
  );
}

export const routeRegistry: AppRouteDefinition[] = [
  { path: "/", label: "Dashboard", analyticsName: "Dashboard", navGroup: "primary", visible: true, activeMatch: "/", element: <Dashboard /> },
  { path: "/vision", label: "Vision", analyticsName: "Vision", navGroup: "primary", visible: true, activeMatch: "/vision", element: <Vision /> },
  { path: "/system-breakdown", label: "System Breakdown", analyticsName: "System Breakdown", navGroup: "primary", visible: true, activeMatch: "/system-breakdown", element: <SystemBreakdown /> },
  { path: "/indicators", analyticsName: "Indicators", element: <Indicators /> },
  { path: "/indicators/AAS", analyticsName: "Asset Diagnostics Moved", element: <RetiredAssetDiagnosticsPage /> },
  { path: "/indicators/:code", analyticsName: "Indicator Detail", element: <IndicatorDetail /> },
  { path: "/bond_health_stability", analyticsName: "Bond Health Stability", element: <BondHealthStabilityPage /> },
  { path: "/news", label: "News", analyticsName: "Market News", navGroup: "tools", toolGroup: "research", visible: true, activeMatch: "/news", element: <MarketNews /> },
  { path: "/why-this-exists", analyticsName: "Vision", element: <Navigate to="/vision" replace /> },
  { path: "/market-map", label: "Market Map", analyticsName: "Market Map", navGroup: "tools", toolGroup: "market-views", visible: true, activeMatch: "/market-map", element: <MarketMap /> },
  { path: "/sector-projections", label: "Sector Projections", analyticsName: "Sector Projections", navGroup: "tools", toolGroup: "market-views", visible: true, activeMatch: "/sector-projections", element: <SectorProjections /> },
  { path: "/stock-analysis/:symbol", analyticsName: "Stock Analysis", element: <StockAnalysis /> },
  { path: "/stock-analysis", label: "Stock Analysis", analyticsName: "Stock Analysis", navGroup: "tools", toolGroup: "research", visible: true, activeMatch: "/stock-analysis", element: <StockAnalysis /> },
  { path: "/institutional-flow", label: "Institutional Flow", analyticsName: "Institutional Flow", navGroup: "tools", toolGroup: "market-views", visible: true, activeMatch: "/institutional-flow", element: <InstitutionalFlow /> },
  { path: "/market-weather", label: "Market Field Language", analyticsName: "Market Field Language", navGroup: "tools", toolGroup: "market-views", visible: true, activeMatch: "/market-weather", element: <MarketWeatherRadar /> },
  { path: "/secret/options", analyticsName: "Secret Options", element: <SecretOptions /> },
  { path: "/tools/recap", label: "Recap", analyticsName: "Recap", navGroup: "tools", toolGroup: "research", visible: true, activeMatch: "/tools/recap", element: <RecapIndex /> },
  { path: "/tools/recap/:slug", analyticsName: "Recap", element: <RecapPost /> },
  { path: "/tools/volume-breadth", analyticsName: "Volume & Breadth", element: <VolumeBreadthTools /> },
  { path: "/tools/experiments", analyticsName: "Recap", element: <Navigate to="/tools/recap" replace /> },
  { path: "/tools/weather-research", analyticsName: "Recap", element: <Navigate to="/tools/recap" replace /> },
  { path: "/tools/updates", analyticsName: "Recap", element: <Navigate to="/tools/recap" replace /> },
  { path: "/tools/updates/:slug", analyticsName: "Recap", element: <LegacyRecapSlugRedirect /> },
  { path: "/precious-metals", analyticsName: "Metals", element: <Navigate to="/metals-indicators" replace /> },
  { path: "/metals-indicators", label: "Metals", analyticsName: "Metals", navGroup: "tools", toolGroup: "asset-classes", visible: true, activeMatch: "/metals-indicators", element: <PreciousMetalsDiagnostic /> },
  { path: "/crypto-indicators", label: "Crypto", analyticsName: "Crypto", navGroup: "tools", toolGroup: "asset-classes", visible: true, activeMatch: "/crypto-indicators", element: <CryptoDiagnostic /> },
  { path: "/agriculture", label: "Agriculture Index", analyticsName: "Agriculture Index", navGroup: "tools", toolGroup: "asset-classes", visible: true, activeMatch: "/agriculture", element: <AgricultureIndex /> },
  { path: "/agriculture/reports", analyticsName: "Agriculture Report Desk", element: <AgricultureReportDesk /> },
  { path: "/energy", label: "Energy Markets", analyticsName: "Energy Markets", navGroup: "tools", toolGroup: "asset-classes", visible: true, activeMatch: "/energy", element: <EnergyIndex /> },
  { path: "/real-estate", label: "Real Estate", analyticsName: "Real Estate", navGroup: "tools", toolGroup: "asset-classes", visible: true, activeMatch: "/real-estate", element: <RealEstateDiagnostic /> },
  { path: "*", analyticsName: "Not Found", element: <NotFoundPage /> },
];

export const navRoutes = routeRegistry.filter((route) => route.visible && route.navGroup === "primary");
export const toolRoutes = routeRegistry.filter((route) => route.visible && route.navGroup === "tools");

export const toolGroupLabels: Record<string, string> = {
  "market-views": "Market Views",
  "asset-classes": "Asset Classes",
  "research": "Research",
};
export const toolGroupOrder = ["market-views", "asset-classes", "research"] as const;

export function isRouteActive(pathname: string, route: AppRouteDefinition): boolean {
  if (route.activeMatch === "/") {
    return pathname === "/";
  }
  const activeMatch = route.activeMatch || route.path;
  return pathname === activeMatch || pathname.startsWith(`${activeMatch}/`);
}

export function getAnalyticsNameForPath(pathname: string): string {
  const matched = routeRegistry.find((route) => {
    if (route.path === "*") {
      return false;
    }
    return Boolean(matchPath({ path: route.path, end: true }, pathname));
  });
  return matched?.analyticsName ?? "Not Found";
}

const indicatorRouteNames: Record<string, string> = {
  VIX: "VIX",
  SPY: "S&P 500 Price",
  BREADTH_HEALTH: "Market Breadth Health",
  T10Y2Y: "10Y–2Y Treasury Spread",
  UNRATE: "Unemployment Rate",
  CONSUMER_HEALTH: "Consumer Health",
  BOND_MARKET_STABILITY: "Bond Market Stability",
  LIQUIDITY_PROXY: "Liquidity Proxy",
  ANALYST_CONFIDENCE: "Analyst Confidence",
  SENTIMENT_COMPOSITE: "Sentiment Composite",
  SECTOR_REGIME_ALIGNMENT: "Sector Regime Alignment",
  AGRICULTURE_STABILITY: "Agriculture Stability",
  ENERGY_STABILITY: "Energy Stability",
  REAL_ESTATE_STABILITY: "Real Estate Stability",
};

function decodeRouteToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function humanizeRouteToken(token: string): string {
  return decodeRouteToken(token)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

export function getPageNameForPath(pathname: string): string {
  const indicatorMatch = matchPath({ path: "/indicators/:code", end: true }, pathname);
  const indicatorCode = indicatorMatch?.params.code?.toUpperCase();
  if (indicatorCode) {
    if (indicatorCode === "AAS") {
      return "Asset Diagnostics Moved";
    }
    const indicatorName = indicatorRouteNames[indicatorCode] ?? humanizeRouteToken(indicatorCode);
    return `${indicatorName} Indicator`;
  }

  const stockMatch = matchPath({ path: "/stock-analysis/:symbol", end: true }, pathname);
  const stockSymbol = stockMatch?.params.symbol;
  if (stockSymbol) {
    return `${decodeRouteToken(stockSymbol).toUpperCase()} Stock Analysis`;
  }

  return getAnalyticsNameForPath(pathname);
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoadingState />}>
      <Routes>
        {routeRegistry.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Routes>
    </Suspense>
  );
}
