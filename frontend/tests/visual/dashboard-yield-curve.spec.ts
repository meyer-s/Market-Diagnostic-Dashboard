import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";


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
    {
      date: "2026-09-17",
      curve: [
        ["1M", 3.97], ["2M", 4.09], ["3M", 4.12], ["4M", 4.23],
        ["6M", 4.20], ["1Y", 4.40], ["2Y", 4.67], ["3Y", 4.75],
        ["5Y", 4.78], ["7Y", 4.86], ["10Y", 4.94], ["20Y", 5.32],
        ["30Y", 5.29],
      ].map(([maturity, yieldValue]) => ({ maturity, yield: yieldValue })),
    },
    {
      date: "2026-09-16",
      curve: [
        ["1M", 3.96], ["2M", 4.07], ["3M", 4.14], ["4M", 4.24],
        ["6M", 4.22], ["1Y", 4.45], ["2Y", 4.74], ["3Y", 4.82],
        ["5Y", 4.86], ["7Y", 4.94], ["10Y", 5.01], ["20Y", 5.39],
        ["30Y", 5.35],
      ].map(([maturity, yieldValue]) => ({ maturity, yield: yieldValue })),
    },
  ],
};

async function fulfillDashboardApi(route: Route) {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith("/indicators/BOND_MARKET_STABILITY/yield-curve")) {
    await route.fulfill({ status: 200, json: curvePayload });
    return;
  }
  if (url.pathname.endsWith("/indicators") || url.pathname.endsWith("/news")) {
    await route.fulfill({ status: 200, json: [] });
    return;
  }
  await route.fulfill({ status: 503, json: { detail: "Not included in the curve fixture." } });
}

async function verifyRatesPulse(page: Page) {
  const section = page.locator("#rates-pulse");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("heading", { name: "The Treasury curve at a glance" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Official Treasury curve" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Curve shape" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Benchmark yields" })).toBeVisible();
  await expect(section.getByText("Current official curve")).toBeVisible();
  await expect(section.getByText("Sep 17, 2026", { exact: false })).toBeVisible();
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

test("dashboard yield-curve evidence is prominent and responsive", async ({ page }) => {
  await page.route("**/api/**", fulfillDashboardApi);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await verifyRatesPulse(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await verifyRatesPulse(page);

  const disclosure = page.getByText("Read latest yields as values", { exact: true });
  await disclosure.click();
  await expect(page.getByText("5.29%", { exact: true })).toBeVisible();
});
