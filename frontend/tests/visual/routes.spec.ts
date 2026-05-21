import { expect, test, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Minimal mock data shapes returned for every /api/** request.
// Keeping these as small as possible — pages should handle empty arrays/null
// gracefully and just render their loading-complete / empty state.
// ---------------------------------------------------------------------------

const SYSTEM_STATUS = {
  state: "NEUTRAL",
  composite_score: 50,
  red_count: 0,
  yellow_count: 0,
  green_count: 0,
  total_count: 0,
  confidence: "LOW",
  coverage_ratio: 0,
};

const DOW_THEORY_STATUS = {
  state: "NEUTRAL",
  primary_trend: "NEUTRAL",
  confirmation: false,
  divergence: false,
  djia_score: null,
  djt_score: null,
  timestamp: new Date().toISOString(),
};

const SECTOR_SUMMARY = {
  defensive_vs_cyclical: 0,
  sector_breadth: { improving: 0, deteriorating: 0, neutral: 0 },
  sectors: {},
};

/**
 * Route all /api/** requests to stub JSON.
 * Precedence: specific path patterns matched first; catch-all last.
 */
async function mockApiRoute(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname; // e.g. "/api/system"

  const seg = path.replace(/^\/api\//, ""); // strip leading /api/

  let body: unknown = {};

  if (seg === "system" || seg === "system/") {
    body = SYSTEM_STATUS;
  } else if (seg.startsWith("system/history")) {
    body = [];
  } else if (seg === "indicators" || seg === "indicators/") {
    body = [];
  } else if (seg.startsWith("indicators/")) {
    // /api/indicators/:code/history
    body = [];
  } else if (seg === "news" || seg.startsWith("news?") || seg === "news/tickers" || seg.startsWith("news/")) {
    body = [];
  } else if (seg === "dow-theory" || seg === "dow-theory/") {
    body = DOW_THEORY_STATUS;
  } else if (seg.startsWith("dow-theory/")) {
    body = [];
  } else if (seg === "sectors/summary") {
    body = SECTOR_SUMMARY;
  } else if (seg.startsWith("sectors/alerts")) {
    body = { alerts: [] };
  } else if (seg.startsWith("sectors/projections")) {
    body = { projections: {}, history: [] };
  } else if (seg.startsWith("sectors/")) {
    body = [];
  } else if (seg.startsWith("market-map/spy-intraday")) {
    body = { data: [] };
  } else if (seg.startsWith("market-map/")) {
    body = { sectors: {}, spy_intraday: [], breadth: null };
  } else if (seg.startsWith("precious-metals/projections")) {
    body = { projections: [] };
  } else if (seg.startsWith("precious-metals/regime")) {
    body = { regime: null };
  } else if (seg.startsWith("precious-metals/history/")) {
    body = [];
  } else if (seg.startsWith("precious-metals/")) {
    body = {};
  } else if (seg.startsWith("aas/")) {
    body = { components: [], breakdown: [] };
  } else if (seg.startsWith("energy/")) {
    body = {};
  } else if (seg.startsWith("real-estate/")) {
    body = {};
  } else if (seg.startsWith("agriculture/")) {
    body = {};
  } else if (seg.startsWith("updates")) {
    body = [];
  } else if (seg.startsWith("stocks/")) {
    body = { projections: [] };
  } else if (seg.startsWith("health")) {
    body = { status: "ok" };
  } else if (seg.startsWith("sectors/")) {
    body = {};
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const routes = [
  "/",
  "/indicators",
  "/system-breakdown",
  "/market-map",
  "/sector-projections",
  "/stock-analysis",
  "/alternative-assets",
  "/aas-breakdown",
  "/tools/recap",
  "/news",
  "/agriculture",
  "/energy",
  "/real-estate",
] as const;

const widths = [375, 768, 1440, 1600] as const;

for (const route of routes) {
  test.describe(route, () => {
    for (const width of widths) {
      test(`renders without console errors at ${width}px`, async ({ page }) => {
        // Intercept ALL /api/** requests before they hit the network.
        await page.route("**/api/**", mockApiRoute);

        const consoleErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") {
            consoleErrors.push(message.text());
          }
        });

        await page.setViewportSize({ width, height: 1200 });
        await page.goto(route, { waitUntil: "networkidle" });

        expect(consoleErrors).toEqual([]);
        await expect(page).toHaveScreenshot(`${route.replace(/\//g, "_") || "home"}-${width}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  });
}
