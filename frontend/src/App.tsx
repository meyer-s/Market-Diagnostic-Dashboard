import { BrowserRouter, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Topbar from "./components/layout/Topbar";
import Footer from "./components/layout/Footer";
import { trackPageView } from "./utils/analytics";
import { trackSubsequentOptionsOpen } from "./utils/marketWeatherPairTelemetry";
import { AppRoutes, getAnalyticsNameForPath } from "./routes/registry";

function AppWithAnalytics() {
  const location = useLocation();
  const hideOptionsWorkflowFooter = location.pathname === "/secret/options";

  useEffect(() => {
    trackPageView(
      `${location.pathname}${location.search}${location.hash}`,
      getAnalyticsNameForPath(location.pathname)
    );
    if (location.pathname === "/secret/options") {
      trackSubsequentOptionsOpen();
    }
  }, [location.pathname, location.search, location.hash]);

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <Topbar />

      <main className="flex-1">
        <AppRoutes />
      </main>

      <div className={hideOptionsWorkflowFooter ? "hidden xl:block" : undefined}>
        <Footer />
      </div>
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
