import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
// Frozen public inputs exercise client binding; backend math is independently
// checked in the sector validation scripts and service regressions.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/sector-integrity.json", import.meta.url), "utf8"));
for (const width of [1440, 390, 320]) {
  test(`sector dates, controls and disclosure at ${width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({viewport: {width, height: 1000}, timezoneId: "America/New_York"});
    const page = await context.newPage(); const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/sectors/projections/latest", route => route.fulfill({json: fixture.latest}));
    await page.route("**/api/sectors/projections/analytics?**", route => route.fulfill({json: fixture.analytics}));
    await page.goto("/sector-projections");
    await expect(page.getByText("Prices through 2026-11-18")).toBeVisible();
    await expect(page.locator("#sector-scenarios")).toBeVisible();
    const lenses = ["Cyclical vs defensive", "Broad offense vs shelter", "Growth vs reflation", "Discretionary vs staples"];
    for (const name of lenses) {
      const b = page.getByRole("button", { name, exact: true }); await b.click(); await expect(b).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByRole("region", {name: /Sector selector/}).getByRole("button", {name: "XLK", exact: true}).click();
    await expect(page.getByText("XLK · observed 3M-score history", {exact: true})).toBeVisible();
    for (const name of ["Current", "3M input", "6M input", "12M input"]) {
      const b = page.getByRole("button", {name, exact: true}); await b.click(); await expect(b).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByRole("button", {name: "Methodology & Algorithm Details"}).click();
    await expect(page.getByText(/10 sessions; the 3M, 6M and 12M inputs use 63, 126 and 200/)).toBeVisible();
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
    const axe = await new AxeBuilder({page}).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({path: testInfo.outputPath(`sector-${width}.png`), fullPage: true});
    await context.close();
  });
}
test("analytics failure cannot turn trailing inputs into future forecasts", async ({page}) => {
  await page.route("**/api/sectors/projections/latest", route => route.fulfill({json: fixture.latest}));
  await page.route("**/api/sectors/projections/analytics?**", route => route.fulfill({status:503,json:{detail:"Unavailable"}}));
  await page.goto("/sector-projections");
  await expect(page.getByRole("heading", {name:"Trailing Input Rankings"})).toBeVisible();
  await expect(page.getByText(/Raw composite scores are shown/)).toBeVisible();
  await expect(page.getByRole("img", {name:/Projected sector scores/})).toHaveCount(0);
});