import type { ReactElement } from "react";
import { Navigate, Route, Routes, matchPath, useParams } from "react-router-dom";

import Dashboard from "../pages/Dashboard";
import Indicators from "../pages/Indicators";
import MarketNews from "../pages/MarketNews";
import IndicatorDetail from "../pages/IndicatorDetail";
import SystemBreakdown from "../pages/SystemBreakdown";
import MarketMap from "../pages/MarketMap";
import SectorProjections from "../pages/SectorProjections";
import StockAnalysis from "../pages/StockAnalysis";
import SecretOptions from "../pages/SecretOptions";
import AlternativeAssetStability from "../pages/AlternativeAssetStability";
import AASComponentBreakdown from "../pages/AASComponentBreakdown";
import InstitutionalFlow from "../pages/InstitutionalFlow";
import Vision from "../pages/Vision";
import AgricultureIndex from "../pages/AgricultureIndex";
import EnergyIndex from "../pages/EnergyIndex";
import RealEstateDiagnostic from "../pages/RealEstateDiagnostic";
import RecapIndex from "../pages/tools/RecapIndex";
import RecapPost from "../pages/tools/RecapPost";
import VolumeBreadthTools from "../pages/tools/VolumeBreadthTools";

type NavGroup = "primary" | "tools";

export type AppRouteDefinition = {
  path: string;
  analyticsName: string;
  element: ReactElement;
  label?: string;
  navGroup?: NavGroup;
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

function NotFoundPage() {
  return (
    <div className="page-shell page-stack">
      <div className="surface-card-strong p-6 sm:p-8">
        <span className="page-kicker">404</span>
        <h1 className="page-title">Page not found</h1>
        <p className="page-subtitle">The route you requested is not part of the current dashboard surface.</p>
      </div>
    </div>
  );
}

export const routeRegistry: AppRouteDefinition[] = [
  { path: "/", label: "Dashboard", analyticsName: "Dashboard", navGroup: "primary", visible: true, activeMatch: "/", element: <Dashboard /> },
  { path: "/vision", label: "Vision", analyticsName: "Vision", navGroup: "primary", visible: true, activeMatch: "/vision", element: <Vision /> },
  { path: "/system-breakdown", label: "System Breakdown", analyticsName: "System Breakdown", navGroup: "primary", visible: true, activeMatch: "/system-breakdown", element: <SystemBreakdown /> },
  { path: "/indicators", analyticsName: "Indicators", element: <Indicators /> },
  { path: "/indicators/:code", analyticsName: "Indicator Detail", element: <IndicatorDetail /> },
  { path: "/bond_health_stability", analyticsName: "Bond Health Stability", element: <BondHealthStabilityPage /> },
  { path: "/news", label: "News", analyticsName: "Market News", navGroup: "tools", visible: true, activeMatch: "/news", element: <MarketNews /> },
  { path: "/why-this-exists", analyticsName: "Vision", element: <Navigate to="/vision" replace /> },
  { path: "/market-map", label: "Market Map", analyticsName: "Market Map", navGroup: "tools", visible: true, activeMatch: "/market-map", element: <MarketMap /> },
  { path: "/sector-projections", label: "Sector Projections", analyticsName: "Sector Projections", navGroup: "tools", visible: true, activeMatch: "/sector-projections", element: <SectorProjections /> },
  { path: "/stock-analysis/:symbol", analyticsName: "Stock Analysis", element: <StockAnalysis /> },
  { path: "/stock-analysis", label: "Stock Analysis", analyticsName: "Stock Analysis", navGroup: "tools", visible: true, activeMatch: "/stock-analysis", element: <StockAnalysis /> },
  { path: "/institutional-flow", label: "Institutional Flow", analyticsName: "Institutional Flow", navGroup: "tools", visible: true, activeMatch: "/institutional-flow", element: <InstitutionalFlow /> },
  { path: "/secret/options", analyticsName: "Secret Options", element: <SecretOptions /> },
  { path: "/tools/recap", label: "Recap", analyticsName: "Recap", navGroup: "tools", visible: true, activeMatch: "/tools/recap", element: <RecapIndex /> },
  { path: "/tools/recap/:slug", analyticsName: "Recap", element: <RecapPost /> },
  { path: "/tools/volume-breadth", analyticsName: "Volume & Breadth", element: <VolumeBreadthTools /> },
  { path: "/tools/experiments", analyticsName: "Recap", element: <Navigate to="/tools/recap" replace /> },
  { path: "/tools/weather-research", analyticsName: "Recap", element: <Navigate to="/tools/recap" replace /> },
  { path: "/tools/updates", analyticsName: "Recap", element: <Navigate to="/tools/recap" replace /> },
  { path: "/tools/updates/:slug", analyticsName: "Recap", element: <LegacyRecapSlugRedirect /> },
  { path: "/precious-metals", analyticsName: "Alternative Assets", element: <Navigate to="/alternative-assets?tab=metals" replace /> },
  { path: "/alternative-assets", label: "Alternative Assets", analyticsName: "Alternative Assets", navGroup: "tools", visible: true, activeMatch: "/alternative-assets", element: <AlternativeAssetStability /> },
  { path: "/agriculture", label: "Agriculture Index", analyticsName: "Agriculture Index", navGroup: "tools", visible: true, activeMatch: "/agriculture", element: <AgricultureIndex /> },
  { path: "/energy", label: "Energy Markets", analyticsName: "Energy Markets", navGroup: "tools", visible: true, activeMatch: "/energy", element: <EnergyIndex /> },
  { path: "/real-estate", label: "Real Estate", analyticsName: "Real Estate", navGroup: "tools", visible: true, activeMatch: "/real-estate", element: <RealEstateDiagnostic /> },
  { path: "/aas-breakdown", analyticsName: "AAS Breakdown", element: <AASComponentBreakdown /> },
  { path: "*", analyticsName: "Not Found", element: <NotFoundPage /> },
];

export const navRoutes = routeRegistry.filter((route) => route.visible && route.navGroup === "primary");
export const toolRoutes = routeRegistry.filter((route) => route.visible && route.navGroup === "tools");

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

export function AppRoutes() {
  return (
    <Routes>
      {routeRegistry.map((route) => (
        <Route key={route.path} path={route.path} element={route.element} />
      ))}
    </Routes>
  );
}
