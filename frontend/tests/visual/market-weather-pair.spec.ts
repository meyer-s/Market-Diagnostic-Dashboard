import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { assertPairV1Contract, attachProbeEvidence } from "./support/pairContract";

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
      pair_schema_version: "market_field_pair_v1",
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
      headers: { "X-Market-Weather-Receipt-Hash": "d".repeat(64) },
      body: JSON.stringify(pairFixture()),
    });
  });
  await page.goto(
    "/market-weather?symbol=ABT&comparison=pair&compare=RSP&timeframe=1D&bars=750&pair_tab=overview&scope_trail=24&scope_scale=shared&coordinate_order=recipe",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator("#pair-field-title")).toHaveText("ABT vs RSP");
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectPairControlsInsideViewport(page: Page) {
  const escapedControls = await page
    .locator('section[aria-labelledby="pair-field-title"]')
    .locator("button:visible, input:visible, select:visible, summary:visible")
    .evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const escaped = rect.left < -1 || rect.right > window.innerWidth + 1 || rect.width < 1 || rect.height < 1;
      return escaped
        ? [{
            label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || element.tagName,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            viewport: window.innerWidth,
          }]
        : [];
    }));
  expect(escapedControls, "every visible Pair control must remain inside the CSS viewport").toEqual([]);
}

async function attachPairScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = await page
    .locator('section[aria-labelledby="pair-field-title"]')
    .screenshot({ animations: "disabled", caret: "hide" });
  await testInfo.attach(`${name}.png`, { body: screenshot, contentType: "image/png" });
}

function cssTimesInMilliseconds(value: string): number[] {
  return value.split(",").map((part) => {
    const time = part.trim();
    const amount = Number.parseFloat(time);
    if (!Number.isFinite(amount)) return Number.POSITIVE_INFINITY;
    return time.endsWith("ms") ? amount : amount * 1_000;
  });
}

async function expectNoSeriousAxeViolations(
  page: Page,
  include: string,
  name: string,
  testInfo: TestInfo,
) {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: Buffer.from(`${JSON.stringify(results, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  return blocking.map((violation) => ({
    surface: name,
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.flatMap((node) => node.target.map(String)),
  }));
}

test("@release Relative Field Pair keeps the desktop hierarchy inspectable", async ({ page }) => {
  await openPair(page, 1440, 1100);

  await expect(page.getByText("Auditable field recipe", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/RSP · Equal-weight market reference · User selected · suitability not evaluated/i),
  ).toBeVisible();
  await expect(page.getByText("Relative market-path comparison")).toBeVisible();
  await expect(
    page.locator("span.page-kicker").filter({ hasText: /^Relative performance$/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete field coverage" })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /ABT relative price versus RSP, based at 100 on .*; latest/i,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Field detail" }).click();
  await expect(page.getByRole("button", { name: "Show all 15 coordinates" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('svg[aria-label*="trajectory"]:visible')).toHaveCount(1);
  await expect(
    page.getByRole("img", {
      name: /Directional phase trajectory for ABT − RSP, relative to each instrument's own history.*displayed observations supported.*third coordinate/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /Pressure comparison history on the relative-to-own-history basis.*current selected-basis value available.*Solid circle is target, dashed diamond is benchmark, dotted square is difference/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Pressure; relative-to-own-history target-minus-benchmark gap .*current direction .*selected-basis value available/i,
    }),
  ).toBeVisible();
  await expect(page.getByText("Largest own-history differences")).toBeVisible();
  await page.getByRole("button", { name: "Show all 15 coordinates" }).click();
  await expect(page.getByText("Motion", { exact: true })).toBeVisible();
  await expect(page.getByText("Field structure", { exact: true })).toBeVisible();
  await expect(page.getByText("Activity and liquidity", { exact: true })).toBeVisible();
  await page.locator('svg[aria-label*="Directional phase trajectory"]:visible').hover({ position: { x: 20, y: 80 } });
  await expect(page.getByText(/inspect the same shared date \(/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Audit receipt" }).click();
  const exportReceipt = page.getByRole("button", { name: "Export compact receipt · JSON" });
  await expect(exportReceipt).toBeEnabled();
  await expect(page.getByText(/not a digital signature, proof of origin/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data alignment" }).locator("xpath=ancestor::details")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "Methodology" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await exportReceipt.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("ABT-RSP-1D-relative-field-receipt.json");
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const receipt = JSON.parse(await readFile(downloadPath!, "utf8")) as Record<string, unknown>;
  expect(receipt.schema_version).toBe("market_field_pair_receipt_v1");
  expect(receipt.receipt_hash).toBe("d".repeat(64));
  await expect(page.getByText("Receipt download started.")).toBeVisible();
});

test("@release Relative Field Pair uses compact mobile chart, scope, and detail controls", async ({ page }) => {
  await openPair(page, 390, 844);

  await expect(page.getByText(/ABT vs RSP · 1D · 750 bars/i)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Research next" })).toBeVisible();
  await expect(page.locator('svg[aria-label*="relative price versus"]:visible')).toHaveCount(1);
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

const RESPONSIVE_VIEWPORTS = [
  { label: "desktop-1440", width: 1440, height: 1000, visibleScopes: 1 },
  { label: "desktop-1024", width: 1024, height: 900, visibleScopes: 1 },
  { label: "tablet-768", width: 768, height: 900, visibleScopes: 1 },
  { label: "mobile-390", width: 390, height: 844, visibleScopes: 1 },
] as const;

for (const viewport of RESPONSIVE_VIEWPORTS) {
  test(`@release responsive evidence ${viewport.label}`, async ({ page }, testInfo) => {
    await openPair(page, viewport.width, viewport.height);

    await expect(page.getByRole("tablist", { name: "Relative Field sections" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.locator('svg[aria-label*="relative price versus"]:visible')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await expectPairControlsInsideViewport(page);
    await attachPairScreenshot(page, testInfo, `pair-overview-${viewport.label}`);

    await page.getByRole("tab", { name: "Field detail" }).click();
    await expect(page.locator('svg[aria-label*="trajectory"]:visible')).toHaveCount(
      viewport.visibleScopes,
    );
    await expectNoHorizontalOverflow(page);
    await expectPairControlsInsideViewport(page);

    await page.getByRole("tab", { name: "Audit receipt" }).click();
    await expect(page.getByRole("button", { name: /Export .*receipt/i })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await expectPairControlsInsideViewport(page);
  });
}

test("@release keyboard tabs and mobile dialog preserve focus ownership", async ({ page }) => {
  await openPair(page, 390, 844);

  const overviewTab = page.getByRole("tab", { name: "Overview" });
  const fieldTab = page.getByRole("tab", { name: "Field detail" });
  const auditTab = page.getByRole("tab", { name: "Audit receipt" });

  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(fieldTab).toBeFocused();
  await expect(fieldTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Field detail" })).toBeVisible();

  await page.keyboard.press("End");
  await expect(auditTab).toBeFocused();
  await expect(auditTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(overviewTab).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(auditTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overviewTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(fieldTab).toBeFocused();

  const trigger = page.getByRole("button", { name: /Inspect Pressure/i });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Pressure" });
  const close = page.getByRole("button", { name: "Close coordinate detail" });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(
    page.locator('section[aria-labelledby="pair-field-title"]').locator("xpath=.."),
  ).toHaveAttribute("inert", "");

  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("@release Pair surfaces pass serious and critical automated accessibility checks", async ({
  page,
}, testInfo) => {
  await openPair(page, 1440, 1000);

  const blocking = await expectNoSeriousAxeViolations(
    page,
    'section[aria-labelledby="pair-field-title"]',
    "overview",
    testInfo,
  );
  await page.getByRole("tab", { name: "Field detail" }).click();
  blocking.push(...await expectNoSeriousAxeViolations(
    page,
    'section[aria-labelledby="pair-field-title"]',
    "field-detail",
    testInfo,
  ));
  await page.getByRole("tab", { name: "Audit receipt" }).click();
  blocking.push(...await expectNoSeriousAxeViolations(
    page,
    'section[aria-labelledby="pair-field-title"]',
    "audit-receipt",
    testInfo,
  ));

  await openPair(page, 390, 844);
  await page.getByRole("tab", { name: "Field detail" }).click();
  await page.getByRole("button", { name: /Inspect Pressure/i }).click();
  blocking.push(...await expectNoSeriousAxeViolations(
    page,
    '[role="dialog"]',
    "mobile-coordinate-dialog",
    testInfo,
  ));

  expect(
    blocking,
    "Pair surfaces contain serious or critical automated accessibility violations",
  ).toEqual([]);
});

test("@release 200 percent zoom-equivalent reflow retains every Pair control", async ({
  page,
}, testInfo) => {
  // Browser zoom halves the available CSS-pixel viewport. A 720px CSS viewport
  // is the deterministic reflow equivalent of a 1440px browser at 200% zoom.
  await openPair(page, 720, 500);

  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectPairControlsInsideViewport(page);

  await page.getByRole("tab", { name: "Field detail" }).click();
  await expect(page.locator('svg[aria-label*="trajectory"]:visible')).toHaveCount(1);
  await page.locator("summary").filter({ hasText: /^Display/ }).click();
  await expect(page.getByRole("group", { name: "Comparison basis" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Displayed series" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectPairControlsInsideViewport(page);

  await page.getByRole("tab", { name: "Audit receipt" }).click();
  await expect(page.getByRole("button", { name: /Export .*receipt/i })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await expectPairControlsInsideViewport(page);
  await attachPairScreenshot(page, testInfo, "pair-audit-200-percent-zoom-equivalent");
});

test("@release prefers-reduced-motion suppresses Pair transitions and animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openPair(page, 1024, 900);

  expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const motion = await page
    .locator('section[aria-labelledby="pair-field-title"]')
    .evaluate((section) => {
      const values = Array.from(section.querySelectorAll<HTMLElement>("*")).flatMap((element) => {
        const style = window.getComputedStyle(element);
        return [style.animationDuration, style.transitionDuration];
      });
      return {
        values,
        runningAnimations: document.getAnimations().filter((animation) => animation.playState === "running").length,
        scrollBehavior: window.getComputedStyle(document.documentElement).scrollBehavior,
      };
    });
  const longestDuration = Math.max(...motion.values.flatMap(cssTimesInMilliseconds));
  expect(longestDuration).toBeLessThanOrEqual(0.011);
  expect(motion.runningAnimations).toBe(0);
  expect(motion.scrollBehavior).toBe("auto");

  await page.getByRole("tab", { name: "Field detail" }).click();
  await expect(page.getByRole("tabpanel", { name: "Field detail" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("@release Pair fixture satisfies the public evidence contract", () => {
  assertPairV1Contract(pairFixture(), "d".repeat(64));
});

test("@production-probe deployed Pair route satisfies schema and receipt-header invariants", async ({
  request,
}, testInfo) => {
  const probeBaseUrl = process.env.PAIR_PROBE_BASE_URL;
  test.skip(
    !probeBaseUrl,
    "Set PAIR_PROBE_BASE_URL (for example https://marketdiagnostictool.com) to run the live probe.",
  );
  expect(probeBaseUrl).toBeTruthy();

  const url = new URL("/api/market-weather/compare", probeBaseUrl);
  url.search = new URLSearchParams({
    target_symbol: process.env.PAIR_PROBE_TARGET || "SPY",
    benchmark_symbol: process.env.PAIR_PROBE_BENCHMARK || "RSP",
    timeframe: "1D",
    bars: "120",
    horizon_min: "8",
    horizon_max: "16",
    horizon_step: "2",
  }).toString();

  const startedAt = Date.now();
  const response = await request.get(url.toString(), {
    failOnStatusCode: false,
    timeout: 120_000,
  });
  const durationMs = Date.now() - startedAt;
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const payload = assertPairV1Contract(
    await response.json(),
    response.headers()["x-market-weather-receipt-hash"] ?? null,
  );
  await attachProbeEvidence(response, payload, durationMs, testInfo);
});
