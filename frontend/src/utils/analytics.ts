/**
 * Google Analytics Integration
 * 
 * Tracks user interactions and page views
 */

const DEFAULT_GA_ID = "G-50NDCBKGYM";
const GA_SCRIPT_ID = "google-analytics-gtag";

let initialized = false;
let lastTrackedPath = "";

const getMeasurementId = () => (import.meta.env.VITE_GA_ID || DEFAULT_GA_ID).trim();

const getGtag = () => (window as any).gtag as ((...args: unknown[]) => void) | undefined;

/**
 * Initialize Google Analytics
 */
export function initializeAnalytics(): void {
  // Only load in production
  if (import.meta.env.MODE !== 'production') {
    console.log('Analytics disabled in development');
    return;
  }

  if (initialized) {
    return;
  }

  const GA_ID = getMeasurementId();
  if (!GA_ID) {
    console.warn("Google Analytics disabled: missing measurement id");
    return;
  }

  initialized = true;

  // Load Google Analytics script
  if (!document.getElementById(GA_SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script);
  }

  // Initialize gtag
  (window as any).dataLayer = (window as any).dataLayer || [];
  function gtag(...args: unknown[]) {
    (window as any).dataLayer.push(args);
  }
  (window as any).gtag = getGtag() || gtag;
  gtag('js', new Date());
  gtag('config', GA_ID, {
    send_page_view: false,
  });
}

/**
 * Track a page view
 */
export function trackPageView(path: string, title: string): void {
  const normalizedPath = path || `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (lastTrackedPath === normalizedPath) {
    return;
  }

  lastTrackedPath = normalizedPath;

  const gtag = getGtag();
  if (gtag) {
    gtag('event', 'page_view', {
      page_path: normalizedPath,
      page_location: `${window.location.origin}${normalizedPath}`,
      page_title: title || document.title,
    });
  }
}

/**
 * Track a custom event
 */
export function trackEvent(eventName: string, eventData?: Record<string, any>): void {
  const gtag = getGtag();
  if (gtag) {
    gtag('event', eventName, eventData || {});
  }
}

/**
 * Track indicator view
 */
export function trackIndicatorView(indicatorCode: string, indicatorName: string): void {
  trackEvent('view_indicator', {
    indicator_code: indicatorCode,
    indicator_name: indicatorName,
  });
}

/**
 * Track dashboard refresh
 */
export function trackDashboardRefresh(): void {
  trackEvent('dashboard_refresh');
}

/**
 * Track date range selection
 */
export function trackDateRangeSelection(range: string): void {
  trackEvent('date_range_selected', {
    range: range,
  });
}

/**
 * Track page navigation
 */
export function trackNavigation(pageName: string): void {
  trackEvent('navigate_page', {
    page: pageName,
  });
}
