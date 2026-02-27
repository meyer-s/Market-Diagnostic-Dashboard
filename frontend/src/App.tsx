import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { useEffect } from "react";
import Topbar from "./components/layout/Topbar";
import Footer from "./components/layout/Footer";
import GlobalLoading from "./components/ui/GlobalLoading";
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
import AAPComponentBreakdown from "./pages/AAPComponentBreakdown";
import Updates from "./pages/tools/Updates";
import { trackPageView } from "./utils/analytics";

function AppWithAnalytics() {
  const location = useLocation();

  useEffect(() => {
    // Track page view on route change
    const pageName = location.pathname === '/' ? 'Dashboard' : 
                     location.pathname.includes('/indicators/') ? 'Indicator Detail' :
                     location.pathname.includes('/indicators') ? 'Indicators' :
                     location.pathname.includes('/news') ? 'Market News' :
                     location.pathname.includes('/system-breakdown') ? 'System Breakdown' :
                     location.pathname.includes('/market-map') ? 'Market Map' :
                     location.pathname.includes('/sector-projections') ? 'Sector Projections' :
                     location.pathname.includes('/stock-analysis') ? 'Stock Analysis' :
                     location.pathname.includes('/secret/options') ? 'Secret Options' :
                     location.pathname.includes('/precious-metals') ? 'Precious Metals' :
                     location.pathname.includes('/alternative-assets') ? 'Alternative Assets' :
                     location.pathname.includes('/tools/recap') || location.pathname.includes('/tools/updates') ? 'Recap' :
                     location.pathname.includes('/aap-breakdown') ? 'AAS Breakdown' :
                     'Unknown';
    
    trackPageView(location.pathname, pageName);
  }, [location]);

  return (
    <div className="bg-stealth-900 min-h-screen flex flex-col">
      <Topbar />
      <GlobalLoading />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/indicators" element={<Indicators />} />
          <Route path="/indicators/:code" element={<IndicatorDetail />} />
          {/* News replaces the old alerts page */}
          <Route path="/news" element={<MarketNews />} />
          <Route path="/system-breakdown" element={<SystemBreakdown />} />
          <Route path="/market-map" element={<MarketMap />} />
          <Route path="/sector-projections" element={<SectorProjections />} />
          <Route path="/stock-analysis" element={<StockAnalysis />} />
          <Route path="/secret/options" element={<SecretOptions />} />
          <Route path="/tools/recap" element={<Updates />} />
          <Route path="/tools/updates" element={<Navigate to="/tools/recap" replace />} />
          {/* Redirect old precious-metals route to alternative-assets */}
          <Route path="/precious-metals" element={<Navigate to="/alternative-assets?tab=metals" replace />} />
          <Route path="/alternative-assets" element={<AlternativeAssetStability />} />
          <Route path="/aap-breakdown" element={<AAPComponentBreakdown />} />
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
