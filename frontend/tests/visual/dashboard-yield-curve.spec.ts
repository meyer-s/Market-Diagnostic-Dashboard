import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";


const baseCurve: Array<[string, number]> = [
  ["1M", 3.97], ["2M", 4.09], ["3M", 4.12], ["4M", 4.23],
  ["6M", 4.20], ["1Y", 4.40], ["2Y", 4.67], ["3Y", 4.75],
  ["5Y", 4.78], ["7Y", 4.86], ["10Y", 4.94], ["20Y", 5.32],
  ["30Y", 5.29],
];

const curvePayload = {
  as_of: "2026-09-17",
  fetched_at: "2026-09-18T13:00:00Z",
  source: {
    name: "U.S. Department of the Treasury",
    url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve",
    frequency: "Business days, official close",
  },
  data_quality: {
    status: "complete",
    stale: false,
    maturities_received: 13,
    maturities_expected: 13,
  },
  curves: [
    ["2026-09-17", 0],
    ["2026-09-16", 0.07],
    ["2026-09-15", 0.1],
    ["2026-09-14", 0.13],
    ["2026-09-11", 0.16],
    ["2026-08-31", 0.2],
    ["2026-07-31", 0.25],
    ["2026-06-30", 0.3],
    ["2026-05-29", 0.35],
    ["2026-04-30", 0.4],
  ].map(([date, shift]) => ({
    date: String(date),
    curve: baseCurve.map(([maturity, yieldValue]) => ({
      maturity,
      yield: yieldValue + Number(shift),
    })),
  })),
};

const driverIndicators = [
  {
    code: "REAL_ESTATE_STABILITY",
    name: "Real Estate Stability",
    raw_value: 37.53,
    score: 37.53,
    state: "RED",
    timestamp: "2026-09-18T12:03:01",
  },
  {
    code: "AGRICULTURE_STABILITY",
    name: "Agriculture Stability",
    raw_value: 42.96,
    score: 42.96,
    state: "YELLOW",
    timestamp: "2026-09-18T12:03:01",
  },
  {
    code: "ENERGY_STABILITY",
    name: "Energy Stability",
    raw_value: 75.75,
    score: 75.75,
    state: "GREEN",
    timestamp: "2026-09-18T12:02:23",
  },
];

const realEstatePayload = {
  as_of: "2026-09-18T14:29:03Z",
  regime_label: "Late-Cycle Squeeze",
  stability_score: 36.22,
  metrics: { mortgage_rate_30y: 6.95, credit_spread_bps: 270 },
  availability: { available_count: 11, total_configured: 11 },
  data_quality: { status: "complete", stale: false },
};

const agriculturePayload = {
  as_of: "2026-09-18T14:29:08Z",
  regime_label: "Rotation / Mixed",
  stability_score: 48.21,
  strongest_markets: [{ name: "Oats", score: 93.73 }],
  weakest_markets: [{ name: "Feeder Cattle", score: 24.49 }],
  availability: { available_symbol_count: 22, total_configured_symbols: 25 },
};

const energyPayload = {
  as_of: "2026-09-18T14:29:08Z",
  regime_label: "Prices Elevated",
  composite_score: 64.38,
  stability_score: 42.84,
  groups: [
    { label: "Crude Oil", group_composite: 76.08 },
    { label: "Natural Gas", group_composite: 52.15 },
  ],
  availability: { available_count: 6, total_configured: 7 },
};

async function fulfillDashboardApi(route: Route) {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith("/indicators/BOND_MARKET_STABILITY/yield-curve")) {
    await route.fulfill({ status: 200, json: curvePayload });
    return;
  }
  if (url.pathname.endsWith("/indicators")) {
    await route.fulfill({ status: 200, json: driverIndicators });
    return;
  }
  if (url.pathname.endsWith("/real-estate/overview")) {
    await route.fulfill({ status: 200, json: realEstatePayload });
    return;
  }
  if (url.pathname.endsWith("/agriculture/overview")) {
    await route.fulfill({ status: 200, json: agriculturePayload });
    return;
  }
  if (url.pathname.endsWith("/energy/overview")) {
    await route.fulfill({ status: 200, json: energyPayload });
    return;
  }
  if (url.pathname.endsWith("/news")) {
    await route.fulfill({ status: 200, json: [] });
    return;
  }
  await route.fulfill({ status: 503, json: { detail: "Not included in the curve fixture." } });
}

async function verifyRatesPulse(page: Page) {
  const section = page.locator("#rates-pulse");
  await section.scrollIntoViewIfNeeded();
  await expect(page.locator("#drivers + #rates-pulse")).toBeVisible();
  await expect(page.locator("#rates-pulse + #indicator-breadth")).toBeVisible();
  await expect(page.locator("#drivers #rates-pulse")).toHaveCount(0);
  await expect(section.getByRole("heading", { name: "The Treasury curve at a glance" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Official Treasury curve" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Curve shape" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Benchmark yields" })).toBeVisible();
  await expect(section.getByText("Current official curve")).toBeVisible();
  await expect(section.getByText("Sep 17, 2026", { exact: false })).toBeVisible();
  await expect(section.getByText(/onion skin: 5 sessions, 5 monthly checkpoints, 10-session mean/i)).toBeVisible();
  await expect(section.getByText("Recent sessions fade with age")).toBeVisible();
  await expect(section.getByText("Monthly checkpoints", { exact: true })).toBeVisible();
  await expect(section.getByRole("link", { name: "Open bond evidence" })).toHaveAttribute(
    "href",
    "/bond_health_stability",
  );

  const overflow = await section.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibility = await new AxeBuilder({ page })
    .include("#rates-pulse")
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious"
    ),
  ).toEqual([]);
}

async function verifyEconomicSnapshots(page: Page) {
  const section = page.locator("#economic-driver-snapshots");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("heading", { name: "Cross-market snapshots" })).toBeVisible();
  await expect(section.getByRole("link", { name: "Open Real estate diagnostic" })).toHaveAttribute("href", "/real-estate");
  await expect(section.getByRole("link", { name: "Open Agriculture diagnostic" })).toHaveAttribute("href", "/agriculture");
  await expect(section.getByRole("link", { name: "Open Energy diagnostic" })).toHaveAttribute("href", "/energy");
  await expect(section.getByText("Stressed")).toBeVisible();
  await expect(section.getByText("Caution")).toHaveCount(2);
  await expect(section.getByText("Late-Cycle Squeeze")).toBeVisible();
  await expect(section.getByText("Rotation / Mixed")).toBeVisible();
  await expect(section.getByText("Prices Elevated")).toBeVisible();
  await expect(section.getByText("6.95%")).toBeVisible();
  await expect(section.getByText("270 bp")).toBeVisible();
  await expect(section.getByText("Oats")).toBeVisible();
  await expect(section.getByText("Feeder Cattle")).toBeVisible();
  await expect(section.getByText("64.4")).toBeVisible();
  await expect(section.getByText("Crude Oil")).toBeVisible();
  await expect(section.getByText("Complete · 11/11 inputs")).toBeVisible();
  await expect(section.getByText("Partial · 22/25 markets")).toBeVisible();
  await expect(section.getByText("Partial · 6/7 contracts")).toBeVisible();
  await expect(section.getByRole("meter", { name: "Real estate stability" })).toHaveAttribute("aria-valuenow", "36.2");
  await expect(section.getByRole("meter", { name: "Agriculture stability" })).toHaveAttribute("aria-valuenow", "48.2");
  await expect(section.getByRole("meter", { name: "Energy stability" })).toHaveAttribute("aria-valuenow", "42.8");
  await expect(section.getByText(/Financing, affordability/)).toHaveCount(0);

  const overflow = await section.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibility = await new AxeBuilder({ page })
    .include("#economic-driver-snapshots")
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious"
    ),
  ).toEqual([]);
}

test("dashboard yield-curve evidence is prominent and responsive", async ({ page }) => {
  await page.route("**/api/**", fulfillDashboardApi);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await verifyRatesPulse(page);
  await verifyEconomicSnapshots(page);

  const curveChart = page.locator("#rates-pulse .recharts-wrapper").first();
  await curveChart.hover({ position: { x: 320, y: 180 } });
  const curveTooltip = page.locator("#rates-pulse .recharts-tooltip-wrapper");
  await expect(curveTooltip).toContainText("Recent sessions");
  await expect(curveTooltip).toContainText("Monthly checkpoints");
  await expect(curveTooltip).toContainText("Long-run reference");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await verifyRatesPulse(page);
  await verifyEconomicSnapshots(page);

  const disclosure = page.getByText("Read latest yields as values", { exact: true });
  await disclosure.click();
  await expect(page.getByText("5.29%", { exact: true })).toBeVisible();
});
