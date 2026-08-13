import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";


const reportPoints = [
  ["2025-09-12", 2100, null, null],
  ["2025-10-09", 2035, 0.7, 0.5],
  ["2025-11-10", 1975, 1.1, 1.2],
  ["2025-12-10", 2010, -0.3, -0.5],
  ["2026-01-12", 1940, 0.9, 0.8],
  ["2026-02-10", 1885, 0.8, 1.4],
  ["2026-03-10", 1920, -0.2, -0.6],
  ["2026-04-09", 1840, 1.2, 1.7],
  ["2026-05-12", 2117, null, -0.2],
  ["2026-06-11", 2075, 0.5, 0.7],
  ["2026-07-10", 2200, -1.2, -1.6],
  ["2026-08-12", 2117, 0.9, 1.4],
] as const;

const metricMeta = [
  ["ending_stocks", "Ending stocks", -1],
  ["production", "Production", -1],
  ["exports", "Exports", 1],
] as const;

const reports = [
  ["wasde", "WASDE", "USDA OCE", "Monthly", "12:00 ET", "chart_ready", "Chart ready"],
  ["crop_production", "Crop Production", "USDA NASS", "Monthly in season", "12:00 ET", "official_archive", "Raw archive"],
  ["crop_progress", "Crop Progress", "USDA NASS", "Weekly in season", "16:00 ET", "official_archive", "Raw archive"],
  ["export_sales", "Export Sales", "USDA FAS", "Weekly", "08:30 ET", "official_archive", "Raw archive"],
  ["export_inspections", "Export Inspections", "USDA AMS", "Weekly", "11:00 ET", "latest_snapshot", "Latest snapshot"],
  ["grain_stocks", "Grain Stocks", "USDA NASS", "Quarterly", "12:00 ET", "official_archive", "Raw archive"],
  ["acreage", "Acreage", "USDA NASS", "Annual", "12:00 ET", "official_archive", "Raw archive"],
  ["cot", "Commitments of Traders", "CFTC", "Weekly", "15:30 ET", "official_archive", "Raw archive"],
].map(([id, name, agency, cadence, releaseTime, coverage, coverageLabel]) => ({
  id, name, agency, cadence, release_time: releaseTime, coverage, coverage_label: coverageLabel,
  description: `${name} official release history and source archive.`,
  source_url: "https://www.usda.gov/", archive_url: "https://esmis.nal.usda.gov/",
}));

function reportDeskFixture() {
  const series = metricMeta.map(([id, label, orientation], metricIndex) => ({
    id: `wasde:${id}`, report_id: "wasde", report: "WASDE", metric_id: id, label,
    bullish_when: orientation < 0 ? "lower than the prior estimate" : "higher than the prior estimate",
    unit: "Million Bushels",
    points: reportPoints.map(([releaseDate, value, signal, reaction], index) => ({
      release_date: releaseDate,
      value: value + metricIndex * 850,
      prior_value: index ? reportPoints[index - 1][1] + metricIndex * 850 : null,
      revision: index ? value - reportPoints[index - 1][1] : null,
      revision_z: signal,
      bullish_signal_z: signal === null ? null : signal * (metricIndex === 1 ? 0.72 : metricIndex === 2 ? -0.62 : 1),
      reaction_1d_pct: reaction,
      reaction_5d_pct: reaction === null ? null : reaction * 1.45,
      unit: "Million Bushels",
      market_year: index < 8 ? "2025/26" : "2026/27",
      projection_status: "Proj.",
      normalization: { basis: "revision", mean_revision: 0, revision_std_dev: 54, positive_means: "bullish" },
    })),
  }));
  const priceHistory = Array.from({ length: 250 }, (_, index) => {
    const timestamp = new Date("2025-08-20T12:00:00Z").getTime() + index * 86_400_000;
    const rebased = 100 + Math.sin(index / 16) * 8 + index * 0.025;
    return { date: new Date(timestamp).toISOString().slice(0, 10), value: rebased * 4.1, rebased, ticker: "ZC=F" };
  });
  const schedule = [
    ["export_sales", "Export Sales", "2026-08-20T08:30:00-04:00", "recurring"],
    ["cot", "Commitments of Traders", "2026-08-14T15:30:00-04:00", "recurring"],
    ["crop_progress", "Crop Progress", "2026-08-17T16:00:00-04:00", "recurring"],
    ["wasde", "WASDE", "2026-09-11T12:00:00-04:00", "official"],
    ["grain_stocks", "Grain Stocks", "2026-09-30T12:00:00-04:00", "expected"],
  ].map(([reportId, report, releaseAt, confidence]) => ({
    report_id: reportId, report, release_at: releaseAt, date: releaseAt.slice(0, 10),
    time_label: new Date(releaseAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + " ET",
    confidence,
  }));
  return {
    as_of: "2026-08-13T11:00:00-04:00",
    commodity: { symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F" },
    commodities: [
      { symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F" },
      { symbol: "ZS", name: "Soybeans", usda: "Soybeans", ticker: "ZS=F" },
      { symbol: "ZW", name: "Chicago Wheat", usda: "Wheat", ticker: "ZW=F" },
    ],
    selected_metric: "ending_stocks", years: 2, next_release: schedule[1],
    latest_release: series[0].points.at(-1), reports, schedule,
    metrics: metricMeta.map(([id, label, orientation]) => ({ id, label, orientation, bullish_when: orientation < 0 ? "lower" : "higher" })),
    series, price_history: priceHistory,
    takeaways: [
      { tone: "positive", title: "Standardized release read", body: "The latest ending-stocks revision was supply-demand supportive at +0.90σ." },
      { tone: "positive", title: "Price confirmation", body: "Futures moved +1.40% through the release-day close, aligned with the report direction." },
      { tone: "neutral", title: "Interpretation boundary", body: "Price moves are associated reactions, not causal attribution." },
    ],
    methodology: {
      actuals: "USDA monthly WASDE CSV files, preserved as reported.",
      expectations: "User-entered only.",
      standardization: "Like-market-year release revision z-scores.",
      futures: "Adjusted closes rebased to 100.",
      reaction: "Previous close to release-day and five-session closes.",
    },
    warnings: [],
  };
}

async function openDesk(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.route("**/api/agriculture/report-desk?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportDeskFixture()) });
  });
  await page.goto("/agriculture/reports", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Agriculture Report Desk" }).waitFor();
}

test("report desk is readable, responsive, and accessible", async ({ page }, testInfo) => {
  await openDesk(page, 1440, 1000);
  await expect(page.getByText("Raw release viewer")).toBeVisible();
  await expect(page.getByText("Insights pane")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agriculture-report-desk-desktop.png"), fullPage: true, animations: "disabled" });
  await testInfo.attach("desktop-full-page", { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
  const desktopAxe = await new AxeBuilder({ page }).analyze();
  expect(desktopAxe.violations).toEqual([]);

  await openDesk(page, 390, 844);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const overflowElements = await page.evaluate(() => Array.from(document.querySelectorAll("body *"))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, className: element.getAttribute("class") ?? "", left: rect.left, right: rect.right, width: rect.width };
    })
    .filter((item) => item.right > document.documentElement.clientWidth + 1 || item.left < -1)
    .sort((a, b) => b.right - a.right)
    .slice(0, 12));
  expect(overflow, JSON.stringify(overflowElements, null, 2)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("agriculture-report-desk-mobile.png"), fullPage: true, animations: "disabled" });
  await testInfo.attach("mobile-full-page", { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
});
