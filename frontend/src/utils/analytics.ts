/**
 * Google Analytics Integration
 * 
 * Tracks user interactions and page views
 */

/**
 * Initialize Google Analytics
 */
export function initializeAnalytics(): void {
  // Only load in production
  if (import.meta.env.MODE !== 'production') {
    console.log('Analytics disabled in development');
    return;
  }

  const GA_ID = import.meta.env.VITE_GA_ID ?? 'G-50NDCBKGYM';

  // Load Google Analytics script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  // Initialize gtag
  (window as any).dataLayer = (window as any).dataLayer || [];
  function gtag(...args: unknown[]) {
    (window as any).dataLayer.push(args);
  }
  (window as any).gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID, {
    page_path: window.location.pathname,
    page_title: document.title,
  });

}

/**
 * Track a page view
 */
export function trackPageView(path: string, title: string): void {
  if ((window as any).gtag) {
    (window as any).gtag('event', 'page_view', {
      page_path: path,
      page_title: title,
    });
  }
}

/**
 * Track a custom event
 */
export function trackEvent(eventName: string, eventData?: Record<string, any>): void {
  if ((window as any).gtag) {
    (window as any).gtag('event', eventName, eventData || {});
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
