import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { activityOverview, activitySignal } from "../../src/features/price-volume/__tests__/fixtures";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 800 }]) {
  test(`price-volume accuracy and reflow at ${viewport.width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, timezoneId: "America/New_York", colorScheme: "dark" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/flow-signals/overview?**", route => route.fulfill({ json: {
      ...activityOverview,
      groups: { ...activityOverview.groups, stocks: [activitySignal, { ...activitySignal, symbol: "AVGO", total_turnover_usd: 1000, event_count: 13, pressure: "negative", latest_event_date: "2026-11-10" }], sectors: [{ ...activitySignal, symbol: "XLRE", category: "sectors", latest_event_date: "2026-11-10", latest_price: 43.62, positive_reference_price: 42.52, negative_reference_price: 43.7177, change_to_positive_reference_pct: -2.52, change_to_negative_reference_pct: 0.22, recent_events: [{ ...activitySignal.recent_events[0], date: "2026-11-10", price: 42.52 }] }] },
    } }));
    await page.goto("/institutional-flow");
    await expect(page.getByRole("heading", { level: 1, name: "Unusual Volume & Price Pressure" })).toBeVisible();
    await expect(page.getByText(/Refreshed Nov 19, 8:08 AM EST/)).toBeVisible();
    await expect(page.getByText("Nov 12, 2026", { exact: true }).first()).toBeVisible();
    await page.getByText("Flagged closing-price references", { exact: true }).click();
    await expect(page.getByText("Price change to reference: +51.0%")).toBeVisible();
    await expect(page.getByText("Below reference range")).toBeVisible();
    await expect(page.getByText("0 flagged / 3 observed")).toBeVisible();
    await page.getByRole("button", { name: /^XLRE, positive-bar balance/ }).click();
    await expect(page.getByRole("heading", { level: 3, name: "XLRE", exact: true })).toBeVisible();
    // React retains the open disclosure when switching symbols.
    await expect(page.getByText("Within reference range")).toBeVisible();
    await page.getByText("Method, units & source coverage", { exact: true }).click();
    await expect(page.getByText("Selected from a fixed basket, not a market-wide ranking.", { exact: false })).toHaveCount(1);
    const crowded = await page.getByRole("button", { name: /flagged days, .* turnover/ }).evaluateAll(buttons => buttons.flatMap(button => {
      const outer = button.getBoundingClientRect();
      return [...button.children].filter(child => { const box = child.getBoundingClientRect(); return box.top < outer.top || box.bottom > outer.bottom || box.left < outer.left || box.right > outer.right; }).map(() => button.getAttribute("aria-label"));
    }));
    expect(crowded).toEqual([]);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    expect(errors).toEqual([]);
    await page.locator("main").click({ position: { x: 2, y: 2 } });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`price-volume-${viewport.width}.png`), fullPage: true });
    await context.close();
  });
}
