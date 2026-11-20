import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/stock-analysis-tgt.json", import.meta.url), "utf8"));

for (const width of [1440, 390, 320]) {
  test(`stock evidence bases and source disclosure at ${width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: "America/New_York", colorScheme: "dark" });
    const page = await context.newPage();
    const errors: string[] = [];
    const symbols: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/stocks/*/projections?**", route => {
      symbols.push(new URL(route.request().url()).pathname.split("/")[3]);
      return route.fulfill({ json: fixture });
    });
    await page.route("**/api/news?**", route => route.fulfill({ json: [] }));
    await page.goto("/stock-analysis/TGT?symbol=NVDA");
    await expect(page.getByRole("heading", { name: "21D evidence", exact: true })).toBeVisible();
    expect(symbols).toEqual(["TGT"]);
    await expect(page.getByRole("button", { name: "Daily", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Model Strength", { exact: true })).toBeVisible();
    await expect(page.getByText(/Statement coverage differs by metric/)).toBeVisible();
    await page.getByText("Quote quality & coverage", { exact: true }).click();
    await expect(page.getByText(/Quote observation: Unavailable/)).toBeVisible();
    await expect(page.getByText(/A trade timestamp does not establish/)).toBeVisible();
    await page.getByRole("button", { name: "2H", exact: true }).click();
    await expect(page.getByRole("button", { name: "2H", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/2H candles · EMA periods are 2H bars/)).toBeVisible();
    await page.getByRole("button", { name: "Daily", exact: true }).click();
    await page.getByRole("button", { name: "6M", exact: true }).click();
    await expect(page.getByRole("heading", { name: "6M evidence", exact: true })).toBeVisible();
    expect(symbols).toHaveLength(1);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
    const result = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    expect(errors).toEqual([]);
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: testInfo.outputPath(`stock-analysis-${width}.png`), fullPage: true });
    await context.close();
  });
}
