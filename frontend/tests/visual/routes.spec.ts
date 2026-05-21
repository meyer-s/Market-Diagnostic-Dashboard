import { expect, test } from "@playwright/test";

/**
 * Network/fetch errors are expected when running against a static preview
 * with no backend. Only fail on actual JavaScript runtime errors.
 */
const EXPECTED_NETWORK_ERROR_PATTERNS = [
  /Failed to fetch/,
  /NetworkError/,
  /net::ERR_/,
  /ERR_CONNECTION_REFUSED/,
  /ERR_EMPTY_RESPONSE/,
  /Fetch error for/,   // useApi.ts console.error format
  /Failed to fetch sector data/,   // SectorDivergenceWidget
  /Failed to fetch Dow Theory/,    // DowTheoryWidget
];

function isExpectedNetworkError(message: string): boolean {
  return EXPECTED_NETWORK_ERROR_PATTERNS.some((re) => re.test(message));
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
      test(`renders without JS errors at ${width}px`, async ({ page }) => {
        const jsErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error" && !isExpectedNetworkError(message.text())) {
            jsErrors.push(message.text());
          }
        });
        page.on("pageerror", (err) => {
          jsErrors.push(err.message);
        });

        await page.setViewportSize({ width, height: 1200 });
        await page.goto(route, { waitUntil: "networkidle" });

        expect(jsErrors, `Unexpected JS errors on ${route} @ ${width}px`).toEqual([]);
        await expect(page).toHaveScreenshot(`${route.replace(/\//g, "_") || "home"}-${width}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  });
}
