import { expect, test, type Page } from "@playwright/test";

const COORDINATES = [
  ["pressure", "Pressure", "pressure_state"],
  ["velocity", "Velocity", "pressure_state"],
  ["acceleration", "Acceleration", "pressure_state"],
  ["jerk", "Jerk", "pressure_state"],
  ["snap", "Snap", "pressure_state"],
  ["structure", "Structure", "field_transform"],
  ["kinematics", "Kinematics", "field_transform"],
  ["geometry", "Geometry", "field_transform"],
  ["information", "Information", "field_transform"],
  ["propagation", "Propagation", "field_transform"],
  ["cascade_bias", "Cascade bias", "field_transform"],
  ["scaling_exponent", "Scaling exponent", "field_transform"],
  ["volatility_carrier", "Volatility carrier", "ohlcv_carrier"],
  ["participation_carrier", "Participation carrier", "ohlcv_carrier"],
  ["liquidity_stress_carrier", "Liquidity stress carrier", "ohlcv_carrier"],
] as const;

const DATES = Array.from({ length: 36 }, (_value, index) => {
  const date = new Date(Date.UTC(2026, 5, 1 + index));
  return date.toISOString().slice(0, 10);
});

function pairFixture() {
  const coordinates = COORDINATES.map(([id, label, family], coordinateIndex) => {
    const series = DATES.map((date, dateIndex) => {
      const target = Math.sin((dateIndex + coordinateIndex) / 5) * 0.55;
      const benchmark = Math.cos((dateIndex + coordinateIndex) / 6) * 0.42;
      const targetContext = target * 1.3;
      const benchmarkContext = benchmark * 1.15;
      return {
        date,
        target,
        benchmark,
        target_context: targetContext,
        benchmark_context: benchmarkContext,
        native_difference: target - benchmark,
        context_difference: targetContext - benchmarkContext,
        target_supported: true,
        benchmark_supported: true,
        pair_supported: true,
      };
    });
    return {
      id,
      label,
      family,
      unit: "model scale",
      latest: series.at(-1),
      series,
    };
  });
  const priceSeries = DATES.map((date, index) => ({
    date,
    target_close: 96 + index * 0.72 + Math.sin(index / 3),
    benchmark_close: 184 + index * 0.49 + Math.cos(index / 4),
    relative_index: 100 - index * 0.31 + Math.sin(index / 5),
    active_return: -index * 0.31 + Math.sin(index / 5),
    prior_return_beta: index >= 20 ? 0.83 : null,
    beta_prior_observations: Math.min(60, Math.max(0, index - 1)),
    beta_adjusted_chain_id: index >= 20 ? 1 : null,
    beta_adjusted_chain_start: index === 20,
    beta_adjusted_chain_reset: false,
    beta_adjusted_cumulative_return: index >= 20 ? -(index - 19) * 0.18 : null,
  }));
  const latestDate = DATES.at(-1) ?? "";
  const fieldSeparation = {
    direction: "mixed",
    label: "No clear net change",
    latest_stretch: 1.42,
    prior_stretch: 1.39,
    change: 0.03,
    tolerance: 0.0695,
    lookback_shared_observations: 5,
    compared_families: 3,
    compared_coordinates: 15,
  };
  const overlap = {
    common_observations: DATES.length,
    requested_observations: 750,
    available_common_observations: DATES.length,
    returned_common_observations: DATES.length,
    start: DATES[0],
    end: latestDate,
    target_dropped: 0,
    benchmark_dropped: 0,
    target_unmatched_after_latest_aligned: 0,
    benchmark_unmatched_after_latest_aligned: 0,
    target_latest_returned_at: latestDate,
    benchmark_latest_returned_at: latestDate,
    latest_aligned_at: latestDate,
    supported_coordinate_cells: 15 * DATES.length,
    total_coordinate_cells: 15 * DATES.length,
    support_fraction: 1,
    session_compatible: null,
    session_compatibility: "unknown",
    session_compatibility_independently_certified: false,
    alignment_supported: true,
    alignment_status: "aligned",
    alignment_rule: "serialized_session_date",
    note: "Exact shared session-date keys; no values carried.",
  };
  const support = {
    supported_coordinate_cells: 15 * DATES.length,
    total_coordinate_cells: 15 * DATES.length,
    support_fraction: 1,
    all_returned_coordinate_cells_supported: true,
    support_rule: "bilateral_full_dependency_support",
    missing_values_carried: false,
  };
  const compatibility = {
    session: { status: "unknown", independently_certified: false, basis: "not_independently_available" },
    currency: { status: "unknown", independently_certified: false },
    price_adjustment: { status: "provider_as_returned", independently_certified: false },
    timestamp_alignment: {
      status: "supported",
      rule: "serialized_session_date",
      timezone_metadata_available: null,
      timezone_status: "not_applicable_session_date",
    },
  };
  const relativeProgress = {
    latest_target_close: priceSeries.at(-1)?.target_close,
    latest_benchmark_close: priceSeries.at(-1)?.benchmark_close,
    relative_index: priceSeries.at(-1)?.relative_index,
    active_return_pct: priceSeries.at(-1)?.active_return,
    beta_adjusted_return_pct: priceSeries.at(-1)?.beta_adjusted_cumulative_return,
    beta: 0.83,
    beta_status: "available",
    lookback_bars: 34,
    beta_configured_lookback_returns: 60,
    beta_minimum_prior_returns: 20,
    beta_prior_observations: 34,
    beta_adjusted_chain_start_at: DATES[20],
    beta_adjusted_chain_end_at: latestDate,
    beta_adjusted_chain_observations: 16,
    beta_adjusted_chain_count: 1,
    beta_adjusted_chain_reset_count: 0,
    beta_adjusted_last_reset_at: null,
    gap_direction: "mixed",
    field_separation: fieldSeparation,
  };
  return {
    schema_version: "market_field_pair_v1",
    semantic_revision: "1.3",
    generated_at: "2026-07-27T16:00:00Z",
    target: {
      symbol: "ABT",
      requested_symbol: "ABT",
      canonical_symbol: "ABT",
      provider_symbol: "ABT",
      analysis_hash: "a".repeat(64),
      data_source: "visual-fixture",
      latest_aligned_close: priceSeries.at(-1)?.target_close,
      latest_returned_close: priceSeries.at(-1)?.target_close,
    },
    benchmark: {
      symbol: "RSP",
      requested_symbol: "RSP",
      canonical_symbol: "RSP",
      provider_symbol: "RSP",
      analysis_hash: "b".repeat(64),
      data_source: "visual-fixture",
      latest_aligned_close: priceSeries.at(-1)?.benchmark_close,
      latest_returned_close: priceSeries.at(-1)?.benchmark_close,
    },
    comparison_hash: "c".repeat(64),
    timeframe: "1D",
    window: {
      requested_shared_observations: 750,
      available_exact_shared_observations: DATES.length,
      returned_exact_shared_observations: DATES.length,
      target_available_observations: DATES.length,
      benchmark_available_observations: DATES.length,
      truncated_to_requested_window: false,
      start: DATES[0],
      end: latestDate,
    },
    support,
    compatibility,
    overlap,
    summary: {
      schema_version: "pair_summary_v1",
      title: "ABT compared with RSP",
      observed_through: latestDate,
      text: "ABT relative progress versus RSP is -10.85% over 36 exact shared 1D bars. The current prior-only beta-adjusted chain is -2.88%, with beta 0.83 estimated from 34 prior shared returns. No clear net change in own-history-relative field separation. Data support is complete; sessions are not independently certified.",
      sentences: [
        { id: "relative_progress", text: "ABT relative progress versus RSP is -10.85% over 36 exact shared 1D bars.", section: "price_progress" },
        { id: "beta_adjusted_chain", text: "The current prior-only beta-adjusted chain is -2.88%, with beta 0.83 estimated from 34 prior shared returns.", section: "price_progress" },
        { id: "field_separation", text: "No clear net change: 1.42 now versus 1.39 five shared bars earlier.", section: "field_detail" },
        { id: "coordinate_gaps", text: "Largest current own-history-relative coordinate gaps are shown below.", section: "field_detail" },
        { id: "data_support", text: "Data support is complete; sessions are not independently certified.", section: "audit_receipt" },
      ],
      notable_context_gaps: coordinates.slice(0, 3).map((coordinate) => ({
        id: coordinate.id,
        label: coordinate.label,
        family: coordinate.family,
        target_context: coordinate.latest?.target_context,
        benchmark_context: coordinate.latest?.benchmark_context,
        context_difference: coordinate.latest?.context_difference,
        direction: (coordinate.latest?.context_difference ?? 0) >= 0 ? "target_higher" : "benchmark_higher",
        pair_supported: true,
      })),
      authority: "deterministic_descriptive_only",
    },
    relative_progress: relativeProgress,
    coordinates,
    price_series: priceSeries,
    frozen_receipt: {
      schema_version: "market_field_pair_receipt_v1",
      receipt_hash: "d".repeat(64),
      overlap,
      support,
      compatibility,
      relative_progress: relativeProgress,
    },
    provenance: {
      target_analysis_hash: "a".repeat(64),
      benchmark_analysis_hash: "b".repeat(64),
      comparison_hash: "c".repeat(64),
      component_recipe_hash: "e".repeat(64),
      alignment_contract: "pair_alignment_v1",
      normalization_contract: "native_and_fixed_proper_fit_relative_v1",
      ordered_pair: true,
      identity_control: false,
      note: "Ordered calculation identity; no decision authority.",
    },
    cache: { analysis: { status: "miss" } },
    authority: {
      mode: "research_display_only",
      scanner_weight: 0,
      option_learning_weight: 0,
      veto: false,
      sizing: false,
      execution: false,
    },
    caveats: ["Descriptive comparison only."],
  };
}

async function openPair(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.route("**/api/market-weather/compare?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(pairFixture()),
    });
  });
  await page.goto(
    "/market-weather?symbol=ABT&comparison=pair&compare=RSP&timeframe=1D&bars=750&pair_tab=overview&scope_trail=24&scope_scale=shared&coordinate_order=recipe",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator("#pair-field-title")).toHaveText("ABT compared with RSP");
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("Relative Field Pair keeps the desktop hierarchy inspectable", async ({ page }) => {
  await openPair(page, 1440, 1100);

  await expect(page.getByText("Descriptive read")).toBeVisible();
  await expect(page.getByText("Relative price progress", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Frozen calculation receipt available/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Field detail" }).click();
  await expect(page.locator('svg[aria-label*="trajectory"]:visible')).toHaveCount(4);
  await page.locator('svg[aria-label*="Directional phase trajectory"]:visible').hover({ position: { x: 20, y: 80 } });
  await expect(page.getByText(/same shared date across visible field charts \(/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Audit receipt" }).click();
  await expect(page.getByRole("button", { name: "Export current receipt" })).toBeEnabled();
  await expect(page.getByText("Cache/debug")).toBeVisible();
});

test("Relative Field Pair uses compact mobile chart, scope, and detail controls", async ({ page }) => {
  await openPair(page, 390, 844);

  await expect(page.getByText(/ABT vs RSP · 1D · 36 shared/i)).toBeVisible();
  await expect(page.locator('svg[aria-label="Relative price index"]:visible')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Beta adjusted" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Field detail" }).click();
  await expect(page.locator('svg[aria-label*="trajectory"]:visible')).toHaveCount(1);
  await page.getByRole("button", { name: "Higher motion" }).click();
  await expect(page.locator('svg[aria-label*="Higher motion trajectory"]:visible')).toHaveCount(1);
  await page.getByRole("button", { name: /Inspect Pressure/i }).click();
  await expect(page.getByRole("dialog", { name: "Pressure" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close coordinate detail" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Pressure" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Inspect Pressure/i })).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
