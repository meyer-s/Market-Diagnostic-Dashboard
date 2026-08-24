import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const regime = {
  regime: {
    gold_bias: "MONETARY_HEDGE",
    silver_bias: "INDUSTRIAL_MONETARY",
    pgm_bias: "NEUTRAL",
    paper_physical_risk: "LOW",
    overall_regime: "INFLATION_HEDGE",
  },
  cb_context: { global_cb_gold_pct_reserves: 14, net_purchases_yoy: 2, structural_monetary_bid: 0.6, em_accumulation_momentum: 0.4 },
  price_anchors: { au_dxy_ratio_zscore: 0.3, ag_dxy_ratio_zscore: 0.2, real_rate_signal: 0.5, monetary_hedge_strength: 0.6 },
  relative_value: { au_ag_ratio: 82, au_ag_ratio_zscore: 0.4, pt_au_ratio: 0.5, pt_au_ratio_zscore: -0.2, pd_au_ratio: 0.4, pd_au_ratio_zscore: -0.3 },
  physical_paper: { paper_credibility_index: 0.7, etf_holdings_zscore: 0.1, etf_holdings_change_yoy: 2, oi_registered_ratio: 8, comex_registered_inventory_change_yoy: -3, backwardation_severity: 0.1, etf_flow_divergence: 0.2 },
};

const venue = {
  registry_id: "comex_silver",
  venue: "COMEX",
  country: "United States",
  market_type: "continuous futures proxy",
  product_name: "COMEX Silver futures",
  symbol: "SI=F",
  contract_month: null,
  local_price: 35,
  currency: "USD",
  native_currency: "USD",
  native_unit: "troy oz",
  contract_size: null,
  fx_rate_local_per_usd: 1,
  fx_timestamp: "2026-08-21T00:00:00Z",
  normalized_price: 35,
  premium_pct: 0,
  premium_type: "headline_gap",
  price_type: "stored daily close",
  quote_timestamp: "2026-08-21T00:00:00Z",
  session_status: "closed",
  freshness_status: "fresh",
  quote_age_hours: 12,
  data_delay: "Stored daily provider series",
  volume: null,
  open_interest: null,
  liquidity_tier: "Core",
  purity: "Exchange specification",
  delivery_location: "COMEX approved depositories",
  tax_basis: "Exchange futures basis",
  source_name: "Stored Yahoo daily history",
  redistribution_status: "Third-party provider terms",
  availability_status: "observed",
  comparability_status: "reference_only",
  comparability_reasons: ["continuous-series identity is not a listed contract"],
  decomposition: null,
};

const latest = {
  as_of: "2026-08-24T12:00:00Z",
  metal: "AG",
  metal_name: "Silver",
  canonical_currency: "USD",
  canonical_unit: "troy oz",
  comparison_ready: false,
  reference: { registry_id: "comex_silver", label: "COMEX", normalized_price: 35 },
  summary: {
    global_median: null,
    highest: null,
    lowest: null,
    dispersion_pct: null,
    registered_venues: 2,
    observed_venues: 1,
    comparable_venues: 0,
    status_counts: { fresh: 1, delayed: 0, stale: 0, unavailable: 1, session_unverified: 0 },
  },
  venues: [
    venue,
    {
      ...venue,
      registry_id: "shfe_silver",
      venue: "SHFE",
      country: "China",
      product_name: "Silver futures",
      local_price: null,
      currency: "CNY",
      native_currency: "CNY",
      native_unit: "kg",
      fx_rate_local_per_usd: null,
      fx_timestamp: null,
      normalized_price: null,
      premium_pct: null,
      premium_type: null,
      price_type: null,
      quote_timestamp: null,
      freshness_status: "unavailable",
      availability_status: "unavailable",
      comparability_status: "unavailable",
      comparability_reasons: ["Official source unavailable"],
    },
  ],
  sources: [{ provider_id: "us_reference", provider_name: "U.S. reference series", status: "live", fetched_at: "2026-08-24T12:00:00Z", source_url: null }],
  limitations: [],
  method: {
    normalization: "Local quote converted to USD and the declared unit.",
    premium: "(venue / reference - 1) * 100",
    comparability_rule: "Products and quote times must match.",
    license_rule: "Coverage does not imply redistribution rights.",
  },
};

const historySeries = (registryId: string, venueName: string, productName: string, offset: number) => ({
  registry_id: registryId,
  provider_id: registryId.startsWith("lbma") ? "lbma" : "us_reference",
  venue: venueName,
  country: venueName === "LBMA" ? "United Kingdom" : "United States",
  market_type: venueName === "LBMA" ? "benchmark" : "continuous futures proxy",
  product_name: productName,
  symbol: null,
  source_name: venueName === "LBMA" ? "London Bullion Market Association" : "Stored Yahoo daily history",
  source_status: "live",
  source_tier: venueName === "LBMA" ? "official_primary" : "reference_only",
  source_url: null,
  history_scope: "Source-backed daily history",
  canonical_currency: "USD",
  canonical_unit: "troy oz",
  coverage_start: "2026-06-01",
  coverage_end: "2026-08-21",
  observation_count: 3,
  baseline_price: 32 + offset,
  latest_price: 35 + offset,
  change_pct: 9.38,
  alignment_date: "2026-06-01",
  alignment_index_value: 100,
  points: [
    { date: "2026-06-01", quote_timestamp: "2026-06-01T00:00:00Z", normalized_price: 32 + offset, index_value: 100, aligned_index_value: 100, change_pct: 0, daily_return_pct: null, local_price: 32 + offset, currency: "USD", native_unit: "troy oz", fx_rate_local_per_usd: 1, fx_timestamp: "2026-06-01T00:00:00Z" },
    { date: "2026-07-15", quote_timestamp: "2026-07-15T00:00:00Z", normalized_price: 33 + offset, index_value: 103.13, aligned_index_value: 103.13, change_pct: 3.13, daily_return_pct: 3.13, local_price: 33 + offset, currency: "USD", native_unit: "troy oz", fx_rate_local_per_usd: 1, fx_timestamp: "2026-07-15T00:00:00Z" },
    { date: "2026-08-21", quote_timestamp: "2026-08-21T00:00:00Z", normalized_price: 35 + offset, index_value: 109.38, aligned_index_value: 109.38, change_pct: 9.38, daily_return_pct: 6.06, local_price: 35 + offset, currency: "USD", native_unit: "troy oz", fx_rate_local_per_usd: 1, fx_timestamp: "2026-08-21T00:00:00Z" },
  ],
});

const history = {
  as_of: "2026-08-24T12:00:00Z",
  metal: "AG",
  metal_name: "Silver",
  days_requested: 90,
  mode: "composite_direction",
  baseline: 100,
  canonical_currency: "USD",
  canonical_unit: "troy oz",
  composite: {
    registry_id: "global_direction",
    label: "Silver global trend",
    coverage_start: "2026-06-01",
    coverage_end: "2026-08-21",
    observation_count: 3,
    latest_index_value: 109.38,
    change_pct: 9.38,
    min_contributors: 1,
    max_contributors: 2,
    official_primary_days: 2,
    fallback_days: 0,
    points: [
      { date: "2026-06-01", index_value: 100, change_pct: 0, daily_return_pct: null, contributor_count: 0, contributors: [], source_quality: "baseline" },
      { date: "2026-07-15", index_value: 103.13, change_pct: 3.13, daily_return_pct: 3.13, contributor_count: 1, contributors: [{ venue: "LBMA", registry_ids: ["lbma_silver"], return_pct: 3.13, source_tier: "official_primary" }], source_quality: "official_primary" },
      { date: "2026-08-21", index_value: 109.38, change_pct: 9.38, daily_return_pct: 6.06, contributor_count: 2, contributors: [{ venue: "COMEX", registry_ids: ["comex_silver"], return_pct: 6.06, source_tier: "fallback" }, { venue: "LBMA", registry_ids: ["lbma_silver"], return_pct: 6.06, source_tier: "official_primary" }], source_quality: "official_primary" },
    ],
  },
  series: [
    historySeries("comex_silver", "COMEX", "COMEX Silver futures", 0),
    historySeries("lbma_silver", "LBMA", "LBMA Silver Price", 0.5),
  ],
  summary: { historical_venues: 2, registered_venues: 2, latest_history_date: "2026-08-21", official_primary_venues: 1, composite_min_contributors: 1, composite_max_contributors: 2 },
  sources: [{ provider_id: "lbma", provider_name: "London Bullion Market Association", status: "live", fetched_at: "2026-08-24T12:00:00Z", source_url: null, history_scope: "Full published delayed benchmark history" }],
  venues_without_history: [],
  limitations: [
    "Each line is rebased to 100 at its own first available observation.",
    "Venue products, closes, and calendars differ.",
  ],
};

test("overview opens first and the second-page exchange trend stays responsive and accessible", async ({ page }, testInfo) => {
  await page.route("**/api/precious-metals/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = null;
    if (path.endsWith("/regime")) body = regime;
    else if (path.endsWith("/global-price-dispersion/history")) body = history;
    else if (path.endsWith("/global-price-dispersion")) body = latest;
    else if (path.endsWith("/projections/latest")) body = { projections: [] };
    else if (path.endsWith("/futures-curve")) body = { as_of: "2026-08-24T12:00:00Z", source: "test", contracts_requested: 4, metals: [] };
    else if (path.endsWith("/cb-holdings") || path.endsWith("/supply") || path.endsWith("/demand")) body = [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/precious-metals", { waitUntil: "networkidle" });

    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab").allTextContents()).resolves.toEqual(["Overview", "Deep Dive"]);
    await page.getByRole("tab", { name: "Deep Dive" }).click();
    await expect(page.getByRole("tab", { name: "Deep Dive" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Global exchange trends" })).toBeVisible();
    await expect(page.getByRole("button", { name: "3M" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#global-price-dispersion select")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show 2 venue paths" })).toBeVisible();
    await page.getByRole("button", { name: "Show 2 venue paths" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const viewportGeometry = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>("#global-price-dispersion");
      const heading = document.querySelector<HTMLElement>("#global-dispersion-heading");
      return {
        scrollX: window.scrollX,
        cardLeft: card?.getBoundingClientRect().left ?? -1,
        headingLeft: heading?.getBoundingClientRect().left ?? -1,
      };
    });
    expect(viewportGeometry.scrollX).toBe(0);
    expect(viewportGeometry.cardLeft).toBeGreaterThanOrEqual(12);
    expect(viewportGeometry.headingLeft).toBeGreaterThan(viewportGeometry.cardLeft);

    const chartTop = await page.locator("#global-price-dispersion").evaluate((element) => element.getBoundingClientRect().top);
    const driversTop = await page.locator("#metals-drivers").evaluate((element) => element.getBoundingClientRect().top);
    expect(chartTop).toBeLessThan(driversTop);
    if (viewport.width === 390) {
      await page.screenshot({ path: testInfo.outputPath("metals-exchange-trends-mobile.png"), fullPage: false, animations: "disabled" });
    }
  }

  const accessibility = await new AxeBuilder({ page }).include("#global-price-dispersion").analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath("metals-exchange-trends-desktop.png"), fullPage: false, animations: "disabled" });
});
