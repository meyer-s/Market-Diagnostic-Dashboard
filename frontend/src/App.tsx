import { BrowserRouter, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Topbar from "./components/layout/Topbar";
import Footer from "./components/layout/Footer";
import RouteErrorBoundary from "./components/layout/RouteErrorBoundary";
import RouteExperience from "./components/layout/RouteExperience";
import { trackPageView } from "./utils/analytics";
import { trackSubsequentOptionsOpen } from "./utils/marketWeatherPairTelemetry";
import { AppRoutes, getAnalyticsNameForPath, getPageNameForPath } from "./routes/registry";
import { SiteThemeProvider } from "./theme/SiteThemeProvider";

export function AppWithAnalytics() {
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
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Topbar />
      <RouteExperience />

      <main
        id="main-content"
        className="flex-1"
        tabIndex={-1}
        aria-label={`${getPageNameForPath(location.pathname)} content`}
      >
        <RouteErrorBoundary key={location.pathname}>
          <AppRoutes />
        </RouteErrorBoundary>
      </main>

      <div className={hideOptionsWorkflowFooter ? "hidden xl:block" : undefined}>
        <Footer />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SiteThemeProvider>
      <BrowserRouter>
        <AppWithAnalytics />
      </BrowserRouter>
    </SiteThemeProvider>
  );
}
