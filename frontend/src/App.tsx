import { BrowserRouter, Routes, Route, useLocation, Navigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import Topbar from "./components/layout/Topbar";
import Footer from "./components/layout/Footer";
import Dashboard from "./pages/Dashboard";
import Indicators from "./pages/Indicators";
import MarketNews from "./pages/MarketNews";
import IndicatorDetail from "./pages/IndicatorDetail";
import SystemBreakdown from "./pages/SystemBreakdown";
import MarketMap from "./pages/MarketMap";
import SectorProjections from "./pages/SectorProjections";
import StockAnalysis from "./pages/StockAnalysis";
import SecretOptions from "./pages/SecretOptions";
import AlternativeAssetStability from "./pages/AlternativeAssetStability";
import AASComponentBreakdown from "./pages/AASComponentBreakdown";
import InstitutionalFlow from "./pages/InstitutionalFlow";
import Vision from "./pages/Vision";
import RecapIndex from "./pages/tools/RecapIndex";
import RecapPost from "./pages/tools/RecapPost";
import { trackPageView } from "./utils/analytics";

function LegacyRecapSlugRedirect() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) {
    return <Navigate to="/tools/recap" replace />;
  }
  return <Navigate to={`/tools/recap/${slug}`} replace />;
}

function AppWithAnalytics() {
  const location = useLocation();

  useEffect(() => {
    const pageName = location.pathname === "/" ? "Dashboard" :
      location.pathname.includes("/indicators/") ? "Indicator Detail" :
      location.pathname.includes("/indicators") ? "Indicators" :
      location.pathname.includes("/news") ? "Market News" :
      location.pathname.includes("/system-breakdown") ? "System Breakdown" :
      location.pathname.includes("/vision") || location.pathname.includes("/why-this-exists") ? "Vision" :
      location.pathname.includes("/market-map") ? "Market Map" :
      location.pathname.includes("/sector-projections") ? "Sector Projections" :
      location.pathname.includes("/stock-analysis") ? "Stock Analysis" :
      location.pathname.includes("/institutional-flow") ? "Institutional Flow" :
      location.pathname.includes("/secret/options") ? "Secret Options" :
      location.pathname.includes("/precious-metals") ? "Precious Metals" :
      location.pathname.includes("/alternative-assets") ? "Alternative Assets" :
      location.pathname.includes("/tools/recap") || location.pathname.includes("/tools/updates") ? "Recap" :
      location.pathname.includes("/aas-breakdown") ? "AAS Breakdown" :
      "Unknown";

    trackPageView(`${location.pathname}${location.search}${location.hash}`, pageName);
  }, [location.pathname, location.search, location.hash]);

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <Topbar />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/indicators" element={<Indicators />} />
          <Route path="/indicators/:code" element={<IndicatorDetail />} />
          <Route path="/news" element={<MarketNews />} />
          <Route path="/system-breakdown" element={<SystemBreakdown />} />
          <Route path="/vision" element={<Vision />} />
          <Route path="/why-this-exists" element={<Navigate to="/vision" replace />} />
          <Route path="/market-map" element={<MarketMap />} />
          <Route path="/sector-projections" element={<SectorProjections />} />
          <Route path="/stock-analysis/:symbol" element={<StockAnalysis />} />
          <Route path="/stock-analysis" element={<StockAnalysis />} />
          <Route path="/institutional-flow" element={<InstitutionalFlow />} />
          <Route path="/secret/options" element={<SecretOptions />} />
          <Route path="/tools/recap" element={<RecapIndex />} />
          <Route path="/tools/recap/:slug" element={<RecapPost />} />
          <Route path="/tools/experiments" element={<Navigate to="/tools/recap" replace />} />
          <Route path="/tools/weather-research" element={<Navigate to="/tools/recap" replace />} />
          <Route path="/tools/updates" element={<Navigate to="/tools/recap" replace />} />
          <Route path="/tools/updates/:slug" element={<LegacyRecapSlugRedirect />} />
          <Route path="/precious-metals" element={<Navigate to="/alternative-assets?tab=metals" replace />} />
          <Route path="/alternative-assets" element={<AlternativeAssetStability />} />
          <Route path="/aas-breakdown" element={<AASComponentBreakdown />} />
        </Routes>
      </main>

      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppWithAnalytics />
    </BrowserRouter>
  );
}
