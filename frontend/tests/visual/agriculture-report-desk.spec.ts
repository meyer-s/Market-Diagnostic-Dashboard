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
  ["crop_production", "Crop Production", "USDA NASS", "Monthly in season", "12:00 ET", "chart_ready", "Chart + history"],
  ["crop_progress", "Crop Progress", "USDA NASS", "Weekly in season", "16:00 ET", "chart_ready", "Chart + history"],
  ["export_sales", "Export Sales", "USDA FAS", "Weekly", "08:30 ET", "chart_ready", "Chart + history"],
  ["export_inspections", "Export Inspections", "USDA AMS", "Weekly", "11:00 ET", "chart_ready", "Chart + history"],
  ["grain_stocks", "Grain Stocks", "USDA NASS", "Quarterly", "12:00 ET", "chart_ready", "Chart + history"],
  ["acreage", "Acreage", "USDA NASS", "Annual", "12:00 ET", "chart_ready", "Chart + history"],
  ["cot", "Commitments of Traders", "CFTC", "Weekly", "15:30 ET", "chart_ready", "Chart + history"],
].map(([id, name, agency, cadence, releaseTime, coverage, coverageLabel]) => ({
  id, name, agency, cadence, release_time: releaseTime, coverage, coverage_label: coverageLabel,
  description: `${name} official release history and source archive.`,
  source_url: "https://www.usda.gov/", archive_url: "https://esmis.nal.usda.gov/",
  release_count: id === "wasde" ? 36 : 156,
  observed_start_date: "2023-08-17", observed_end_date: "2026-08-12",
}));

const archiveSpecs = {
  crop_production: {
    chartKind: "production_trend", title: "Production estimate history", primary: "production", unit: "Million bushels",
    latest: [{ id: "production", label: "Production", value: 16000, unit: "Million bushels" }, { id: "production_year_ago", label: "Year-ago production", value: 17021, unit: "Million bushels" }],
    older: [{ id: "production", label: "Production", value: 15500, unit: "Million bushels" }, { id: "production_year_ago", label: "Year-ago production", value: 15100, unit: "Million bushels" }],
  },
  crop_progress: {
    chartKind: "progress_benchmark", title: "Field progress and condition", primary: "condition_good_excellent", unit: "Percent",
    latest: [{ id: "condition_good_excellent", label: "Good + excellent", value: 61, unit: "Percent", previous_week: 61, previous_year: 72, chart_group: "condition" }, { id: "progress_dough", label: "Dough", value: 61, unit: "Percent", previous_week: 43, previous_year: 56, five_year_average: 55, chart_group: "progress" }],
    older: [{ id: "condition_good_excellent", label: "Good + excellent", value: 61, unit: "Percent", previous_week: 62, previous_year: 70, chart_group: "condition" }],
  },
  export_sales: {
    chartKind: "sales_flow", title: "Export demand flow", primary: "net_sales", unit: "Metric Tons",
    latest: [{ id: "net_sales", label: "Net sales", value: 1020000, unit: "Metric Tons" }, { id: "weekly_exports", label: "Weekly exports", value: 875000, unit: "Metric Tons" }],
    older: [{ id: "net_sales", label: "Net sales", value: 880000, unit: "Metric Tons" }, { id: "weekly_exports", label: "Weekly exports", value: 910000, unit: "Metric Tons" }],
  },
  export_inspections: {
    chartKind: "inspection_pace", title: "Physical export inspection pace", primary: "inspected_volume", unit: "Metric Tons",
    latest: [{ id: "inspected_volume", label: "Inspected volume", value: 1220000, unit: "Metric Tons" }],
    older: [{ id: "inspected_volume", label: "Inspected volume", value: 1040000, unit: "Metric Tons" }],
  },
  grain_stocks: {
    chartKind: "stocks_composition", title: "Inventory checkpoint", primary: "total_stocks", unit: "Million bushels",
    latest: [{ id: "total_stocks", label: "Total stocks", value: 5290, unit: "Million bushels" }, { id: "total_stocks_year_ago", label: "Year-ago stocks", value: 4640, unit: "Million bushels" }, { id: "on_farm_stocks", label: "On-farm", value: 2960, unit: "Million bushels" }, { id: "off_farm_stocks", label: "Off-farm", value: 2340, unit: "Million bushels" }],
    older: [{ id: "total_stocks", label: "Total stocks", value: 4640, unit: "Million bushels" }],
  },
  acreage: {
    chartKind: "acreage_comparison", title: "Acreage footprint", primary: "planted_area", unit: "Million acres",
    latest: [{ id: "planted_area", label: "Planted area", value: 95.3, unit: "Million acres" }, { id: "planted_area_year_ago", label: "Year-ago planted area", value: 98.2, unit: "Million acres" }, { id: "harvested_area", label: "Harvested area", value: 87.4, unit: "Million acres" }],
    older: [{ id: "planted_area", label: "Planted area", value: 98.2, unit: "Million acres" }],
  },
  cot: {
    chartKind: "positioning_balance", title: "Speculative positioning", primary: "noncommercial_net", unit: "Contracts",
    latest: [{ id: "noncommercial_net", label: "Noncommercial net", value: -52000, unit: "Contracts" }, { id: "open_interest", label: "Open interest", value: 1450000, unit: "Contracts" }],
    older: [{ id: "noncommercial_net", label: "Noncommercial net", value: -34000, unit: "Contracts" }, { id: "open_interest", label: "Open interest", value: 1420000, unit: "Contracts" }],
  },
} as const;

function archiveHistories() {
  return Object.fromEntries(Object.entries(archiveSpecs).map(([reportId, spec]) => [reportId, {
    report_id: reportId,
    scope_key: "ZC",
    scope_label: "Corn",
    requested_start_date: "2023-08-13",
    observed_start_date: "2023-08-17",
    observed_end_date: "2026-08-12",
    release_count: 156,
    returned_count: 2,
    truncated: true,
    analysis: {
      chart_kind: spec.chartKind,
      title: spec.title,
      subtitle: "Latest official reading compared on the report's own basis",
      primary_metric_id: spec.primary,
      latest_release_date: "2026-08-12",
      latest_value: spec.latest[0].value,
      previous_value: spec.older[0].value,
      four_report_average: spec.older[0].value,
      unit: spec.unit,
      headline: `${spec.latest[0].label}: ${spec.latest[0].value.toLocaleString()} ${spec.unit.toLowerCase()}`,
      body: "The latest official reading is shown against the report's appropriate previous-release or published benchmark.",
      comparison_basis: "Official previous-release or published report benchmark",
    },
    releases: [
      { release_date: "2026-08-12", title: `${spec.title} latest release`, source_url: "https://www.usda.gov/", documents: [{ label: "TXT", format: "txt", url: "https://www.usda.gov/" }], metrics: spec.latest },
      { release_date: "2026-08-05", title: `${spec.title} previous release`, source_url: "https://www.usda.gov/", documents: [{ label: "TXT", format: "txt", url: "https://www.usda.gov/" }], metrics: spec.older },
    ],
  }]));
}

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
  const impactSignals = [0.9, 0.6, 1.2, 0.4, 0.2, -0.8, 1.0, 0.1];
  const impactContributions = [0.72, -0.02, 0.12, 0.1, 0.02, 0.11, null, 0];
  const impactReports = reports.map((report, reportIndex) => {
    const sampleSize = report.id === "acreage" ? 3 : 12 + reportIndex * 3;
    const observations = Array.from({ length: sampleSize }, (_, index) => {
      const signal = ((index % 7) - 3) / 2;
      return {
        release_date: new Date(Date.UTC(2024, index % 12, 5 + (index % 20))).toISOString().slice(0, 10),
        price_event_date: new Date(Date.UTC(2024, index % 12, 6 + (index % 20))).toISOString().slice(0, 10),
        raw_signal: signal,
        signal_z: signal,
        signal_basis: `${report.name} benchmark pressure`,
        reaction_1d_pct: signal * 0.35 + Math.sin(index) * 0.2,
        reaction_5d_pct: signal * 0.7 + Math.sin(index) * 0.45,
      };
    });
    const contribution = impactContributions[reportIndex];
    return {
      report_id: report.id,
      report: report.name,
      channel: report.id === "export_sales" || report.id === "export_inspections" ? "Demand" : report.id === "cot" ? "Positioning" : report.id === "wasde" || report.id === "grain_stocks" ? "Balance sheet" : "Supply",
      latest_release_date: "2026-08-12",
      price_event_date: "2026-08-12",
      signal_z: impactSignals[reportIndex],
      signal_basis: `${report.name} benchmark pressure; positive means price-supportive`,
      latest_reaction_1d_pct: 1.4 - reportIndex * 0.22,
      latest_reaction_5d_pct: reportIndex > 3 ? null : 2.1 - reportIndex * 0.3,
      historical_1d: { sample_size: sampleSize, correlation: report.id === "acreage" ? null : 0.28, slope: report.id === "acreage" ? null : 0.55, alignment_rate: report.id === "acreage" ? null : 0.59, residual_pct: report.id === "acreage" ? null : 1.6 },
      historical_5d: { sample_size: sampleSize, correlation: report.id === "acreage" ? null : 0.36, slope: report.id === "acreage" ? null : 0.9, alignment_rate: report.id === "acreage" ? null : 0.64, residual_pct: report.id === "acreage" ? null : 2.4 },
      model_5d_pct: report.id === "acreage" ? null : impactSignals[reportIndex] * 0.9,
      contribution_5d_pct: contribution,
      confidence: report.id === "acreage" ? "Insufficient" : sampleSize >= 20 ? "Established" : "Moderate",
      reliability: report.id === "acreage" ? 0 : 0.45,
      freshness: 0.9,
      model_weight: contribution === null ? 0 : Math.max(0.03, Math.abs(contribution)),
      observations,
    };
  });
  return {
    as_of: "2026-08-13T11:00:00-04:00",
    commodity: { symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F", price_unit: "cents per bushel", group: "grains_oilseeds", group_label: "Grains / Oilseeds", report_count: 8 },
    commodities: [
      { symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F", price_unit: "cents per bushel", group: "grains_oilseeds", group_label: "Grains / Oilseeds", report_count: 8 },
      { symbol: "ZS", name: "Soybeans", usda: "Soybeans", ticker: "ZS=F", price_unit: "cents per bushel", group: "grains_oilseeds", group_label: "Grains / Oilseeds", report_count: 8 },
      { symbol: "ZW", name: "Chicago Wheat", usda: "Wheat", ticker: "ZW=F", price_unit: "cents per bushel", group: "grains_oilseeds", group_label: "Grains / Oilseeds", report_count: 8 },
    ],
    selected_metric: "ending_stocks", years: 3,
    history_coverage: {
      structured_start_date: "2010-04-09",
      requested_start_date: "2023-08-13",
      observed_start_date: "2023-09-12",
      observed_end_date: "2026-08-12",
      release_count: 36,
      complete: true,
      source: "USDA WASDE as-reported CSV archive",
    },
    next_release: schedule[1],
    latest_release: series[0].points.at(-1), reports, schedule,
    report_histories: archiveHistories(),
    metrics: metricMeta.map(([id, label, orientation]) => ({ id, label, orientation, bullish_when: orientation < 0 ? "lower" : "higher" })),
    series, price_history: priceHistory,
    impact_model: {
      as_of: "2026-08-13",
      price_unit: "cents per bushel",
      horizon_sessions: 5,
      aggregate: { direction: "Price-supportive", current_price: 472.75, projected_5d_pct: 1.05, projected_5d_price: 477.71, lower_5d_price: 469.4, upper_5d_price: 486.1, uncertainty_5d_pct: 1.75, contributors_included: 7 },
      reports: impactReports,
      relationships: [
        { source_report_id: "acreage", target_report_id: "crop_production", source_report: "Acreage", target_report: "Crop Production", kind: "sets the planted base for", status: "Confirming", description: "Acreage sets the planted base for Crop Production; latest signals confirm." },
        { source_report_id: "crop_progress", target_report_id: "crop_production", source_report: "Crop Progress", target_report: "Crop Production", kind: "leads the yield read in", status: "Confirming", description: "Crop Progress leads Crop Production; latest signals confirm." },
        { source_report_id: "crop_production", target_report_id: "wasde", source_report: "Crop Production", target_report: "WASDE", kind: "feeds", status: "Confirming", description: "Crop Production feeds WASDE; latest signals confirm." },
        { source_report_id: "grain_stocks", target_report_id: "wasde", source_report: "Grain Stocks", target_report: "WASDE", kind: "checks", status: "Conflicting", description: "Grain Stocks conflicts with WASDE." },
        { source_report_id: "export_sales", target_report_id: "export_inspections", source_report: "Export Sales", target_report: "Export Inspections", kind: "precedes", status: "Mixed", description: "Export Sales and Export Inspections are mixed." },
        { source_report_id: "export_inspections", target_report_id: "wasde", source_report: "Export Inspections", target_report: "WASDE", kind: "tests", status: "Confirming", description: "Export Inspections confirms WASDE." },
        { source_report_id: "cot", target_report_id: "wasde", source_report: "Commitments of Traders", target_report: "WASDE", kind: "confirms", status: "Mixed", description: "Positioning is mixed with WASDE." },
      ],
      methodology: { signal: "Positive means price-supportive.", reaction: "Returns use the public release session.", scenario: "Historical association, not a causal forecast.", uncertainty: "Historical residual range." },
    },
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
  await expect(page.getByRole("heading", { name: "Combined report-price association" })).toBeVisible();
  await expect(page.getByText("Association-implied marker")).toBeVisible();
  await expect(page.getByText(/Association-based scenario, not a forecast/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Report price contributions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ending-stocks revisions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Five-session response by report read" })).toBeVisible();
  await expect(page.getByText("View report chart values")).toBeVisible();
  await expect(page.getByText("View historical release outcomes")).toBeVisible();
  const impactStories = [
    ["WASDE", "Ending-stocks revisions"],
    ["Crop Production", "Production estimate path"],
    ["Crop Progress", "Field progress against benchmarks"],
    ["Export Sales", "Booked demand versus shipments"],
    ["Export Inspections", "Physical export pace"],
    ["Grain Stocks", "Inventory location and change"],
    ["Acreage", "Planted and harvested footprint"],
    ["Commitments of Traders", "Speculative positioning balance"],
  ] as const;
  for (const [reportName, storyTitle] of impactStories) {
    await page.getByRole("button", { name: new RegExp(`${reportName}:.*five-session contribution|${reportName}:.*model unavailable`) }).click();
    await expect(page.getByRole("heading", { name: storyTitle })).toBeVisible();
    await expect(page.locator(".recharts-wrapper").last()).toBeVisible();
  }
  await page.getByRole("button", { name: /Crop Progress:.*five-session contribution/ }).click();
  await expect(page.getByRole("heading", { name: "Crop Progress", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected reports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Field progress against benchmarks" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agriculture-report-desk-impact-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Market brief" }).click();
  await expect(page.getByRole("heading", { name: "The whole picture" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report feed" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Balance sheet/ })).toBeVisible();
  await page.getByRole("button", { name: /WASDE.*revision/ }).click();
  await expect(page.getByRole("button", { name: "Add futures" })).toBeVisible();
  await expect(page.getByText("Evidence & sources")).toBeVisible();
  await expect(page.getByRole("button", { name: "All" })).toBeVisible();
  await expect(page.getByRole("button", { name: /WASDE.*revision/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agriculture-report-desk-wasde-desktop.png"), fullPage: true });
  for (const reportName of ["Crop Production", "Crop Progress", "Export Sales", "Export Inspections", "Grain Stocks", "Acreage", "Commitments of Traders"]) {
    await page.getByRole("button", { name: new RegExp(reportName) }).click();
    await expect(page.getByText("Read:")).toBeVisible();
    await expect(page.locator(".recharts-wrapper").last()).toBeVisible();
  }
  await page.getByRole("button", { name: /Crop Progress/ }).click();
  const desktopBars = page.locator(".recharts-bar-rectangle path");
  await expect(desktopBars).toHaveCount(6);
  await expect.poll(() => desktopBars.evaluateAll((bars) => bars.map((bar) => bar.getBBox().height).filter((height) => height > 20).length)).toBeGreaterThanOrEqual(6);
  await page.screenshot({ path: testInfo.outputPath("agriculture-report-desk-desktop.png"), fullPage: true });
  await testInfo.attach("desktop-full-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const desktopAxe = await new AxeBuilder({ page }).analyze();
  expect(desktopAxe.violations).toEqual([]);

  await openDesk(page, 390, 844);
  await expect(page.getByRole("heading", { name: "Combined report-price association" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Report price contributions" }).getByRole("button")).toHaveCount(8);
  await page.getByRole("button", { name: /Crop Progress:.*five-session contribution/ }).click();
  await expect(page.getByRole("heading", { name: "Crop Progress", exact: true })).toBeVisible();
  await page.evaluate(() => { window.scrollTo(0, 0); (document.activeElement as HTMLElement | null)?.blur(); });
  await page.screenshot({ path: testInfo.outputPath("agriculture-report-desk-impact-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Market brief" }).click();
  await page.getByLabel("Report family").selectOption("crop_progress");
  await expect(page.getByRole("heading", { name: "Crop Progress" })).toBeVisible();
  const mobileBars = page.locator(".recharts-bar-rectangle path");
  await expect.poll(() => mobileBars.evaluateAll((bars) => bars.map((bar) => bar.getBBox().height).filter((height) => height > 20).length)).toBeGreaterThanOrEqual(6);
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
  await page.screenshot({ path: testInfo.outputPath("agriculture-report-desk-mobile.png"), fullPage: true });
  await testInfo.attach("mobile-full-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
