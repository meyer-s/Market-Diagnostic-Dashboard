import { expect, test } from "@playwright/test";

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
