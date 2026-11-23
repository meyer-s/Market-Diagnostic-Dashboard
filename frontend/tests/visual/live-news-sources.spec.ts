import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Uses a fresh browser profile and changes only that profile's news preferences.
test("@production-probe secondary gray feed, source preferences and relevance threshold", async ({ browser }) => {
  test.skip(!process.env.LIVE_NEWS_SOURCE_PROBE, "Explicit opt-in for the live source collector probe");
  test.setTimeout(150_000);
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1024, height: 1365 } });
  await context.addInitScript(() => {
    localStorage.setItem("live-news:news", "on");
    localStorage.setItem("live-news:site-alerts", "off");
  });
  const page = await context.newPage();
  try {
    await page.goto("/news");
    await page.getByRole("region", { name: "Live news", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Gray sources · 6 on", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Gray source settings" });
    const boxes = dialog.getByRole("checkbox");
    await expect(boxes).toHaveCount(6);
    for (const box of await boxes.all()) await expect(box).toBeChecked();
    await expect(dialog).toContainText("Dark Web Informer");
    await expect(dialog).toContainText("DataBreaches.net");
    await expect(dialog).toContainText("site-wide alerts above 45");
    await page.setViewportSize({ width: 390, height: 844 });
    const findings = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(findings.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1024, height: 1365 });
    for (const box of await boxes.all()) await box.check();
    await dialog.getByRole("button", { name: "Save sources", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Gray sources · 6 on", exact: true })).toBeVisible();
    const selected = await (await context.request.get("/live-news/snapshot?view=all")).json();
    expect(selected.raw_sources).toEqual(["zerohedge", "ransomware", "hn", "ransomlook", "darkwebinformer", "databreaches"]);
    expect(selected.articles.every((item: { report_label: string }) => !item.report_label)).toBe(true);
    expect(selected.alerts.threshold).toBe(45);
    expect(selected.alerts.headlines.every((item: { score: number }) => item.score > 45)).toBe(true);

    await expect.poll(async () => {
      const status = await (await context.request.get("/live-news/status.json")).json();
      return status.sources.filter((source: { raw_key: string; state: string; items_retained: number }) => source.raw_key && source.state === "Online" && source.items_retained > 0).length;
    }, { timeout: 90_000, intervals: [1000, 3000, 5000] }).toBe(6);

    const claims = await (await context.request.get("/live-news/snapshot?view=all&q=Ransomware.live")).json();
    expect(claims.articles).toEqual([]);
    expect(claims.gray.articles.length).toBeGreaterThan(0);
    expect(claims.gray.articles.every((item: { report_label: string }) => item.report_label === "Unverified victim claim")).toBe(true);

    const mainFeed = page.getByRole("region", { name: "Main news feed", exact: true });
    const grayFeed = page.getByRole("region", { name: "Gray sources", exact: true });
    await expect(grayFeed.getByRole("list", { name: "Gray headlines" })).toBeVisible();
    const mainBox = await mainFeed.boundingBox();
    const grayBox = await grayFeed.boundingBox();
    expect(mainBox!.width).toBeGreaterThan(grayBox!.width);
    expect(grayBox!.x).toBeGreaterThan(mainBox!.x + mainBox!.width);
    await page.screenshot({ path: "test-results/gray-feed-portrait.png", fullPage: false });
    await grayFeed.getByRole("button", { name: "Next gray headlines" }).click();
    await expect.poll(async () => grayFeed.getAttribute("aria-busy")).toBe("false");
    await expect(grayFeed.getByRole("navigation", { name: "Gray headline pages" })).toContainText("2 /");
    await page.setViewportSize({ width: 390, height: 844 });
    await grayFeed.scrollIntoViewIfNeeded();
    expect((await grayFeed.boundingBox())!.y).toBeGreaterThanOrEqual((await mainFeed.boundingBox())!.y + (await mainFeed.boundingBox())!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#gray-news').analyze()).violations).toEqual([]);
    await page.screenshot({ path: "test-results/gray-feed-mobile.png", fullPage: false });
    await page.setViewportSize({ width: 1024, height: 1365 });

    const alertsResponse = await context.request.post("/live-news/alerts", { headers: { Origin: origin, "X-Live-News": "1" } });
    expect(alertsResponse.ok()).toBe(true);
    expect((await alertsResponse.json()).alerts.threshold).toBe(45);
    await page.goto("/");
    await page.getByRole("region", { name: "Live news", exact: true }).scrollIntoViewIfNeeded();

    await page.getByRole("button", { name: "Gray sources · 6 on", exact: true }).click();
    await dialog.getByRole("button", { name: "Turn off gray sources", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const disabled = await (await context.request.get("/live-news/snapshot?view=all")).json();
    expect(disabled.raw_sources).toEqual([]);
    expect(disabled.gray.articles).toEqual([]);
    expect(disabled.articles.every((item: { report_label: string }) => !item.report_label)).toBe(true);
  } finally {
    await context.close();
  }
});
