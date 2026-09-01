import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

import { blsLensFixture } from "../../src/features/bls/__fixtures__/blsLensFixture";

const overviewSeriesIds = new Set([
  "CES0000000001",
  "CES0500000003",
  "LNS14000000",
  "JTS000000000000000JOR",
]);
const visualHistoryPeriods = [
  "2025-09-01",
  "2025-10-01",
  "2025-11-01",
  "2025-12-01",
  "2026-01-01",
  "2026-02-01",
];

// The shared fixture stays intentionally compact for unit tests. Visual QA adds
// enough finite history to render all four Overview small multiples while
// retaining the opening-rate null in May 2026 to exercise visible chart gaps.
const visualBlsFixture = {
  ...blsLensFixture,
  series: blsLensFixture.series.map((series) => {
    if (!overviewSeriesIds.has(series.series_id)) return series;
    const anchor = series.observations.find((observation) => observation.primary_value !== null);
    if (!anchor || anchor.primary_value === null) return series;
    const anchorValue = anchor.primary_value;
    const step = Math.max(Math.abs(anchorValue) * 0.015, 0.02);
    const history = visualHistoryPeriods.map((period, index) => {
      const offset = visualHistoryPeriods.length - index;
      const primaryValue = Number((anchorValue + offset * step).toFixed(3));
      return {
        ...anchor,
        period,
        primary_value: primaryValue,
        relative_percentile: Math.min(100, (anchor.relative_percentile ?? 50) + offset * 3),
        preliminary: false,
        revision_delta: 0,
        revision_count: 0,
      };
    });
    return {
      ...series,
      coverage_start: visualHistoryPeriods[0],
      observations: [...history, ...series.observations],
    };
  }),
};

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
  // A 320 CSS-pixel viewport exercises the same WCAG reflow boundary as a
  // 1280px-wide page viewed at 400% (and is stricter than the requested 200%).
  { name: "narrow-zoom-proxy", width: 320, height: 800 },
] as const;

const views = [
  { id: "overview", tab: "Overview", heading: "Labor-market overview" },
  { id: "releases", tab: "Releases", heading: "Latest observations by report" },
  { id: "trends", tab: "Trends", heading: "Native trend explorer" },
  { id: "revisions", tab: "Revisions", heading: "Payroll revisions" },
  { id: "calendar", tab: "Calendar", heading: "BLS release schedule" },
  { id: "methods", tab: "Methods & sources", heading: "How the evidence is built" },
] as const;

type BlsView = (typeof views)[number];

async function mockBlsLens(page: Page, delayMs = 0) {
  await page.route("**/api/bls/lens?**", async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(visualBlsFixture),
    });
  });
}

async function assertNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className.toString().slice(0, 120),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
      .slice(0, 12),
    unfocusableScrollers: [...document.querySelectorAll<HTMLElement>(".data-scroller")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && element.tabIndex < 0)
      .length,
    smallestPersistentLabel: [...document.querySelectorAll<HTMLElement>(
      ".bls-page small, .bls-page .bls-section-kicker, .bls-page .bls-status-label",
    )].reduce(
      (minimum, element) => Math.min(minimum, Number.parseFloat(getComputedStyle(element).fontSize)),
      Number.POSITIVE_INFINITY,
    ),
  }));

  expect(overflow.page, JSON.stringify(overflow.offenders, null, 2)).toBeLessThanOrEqual(1);
  expect(overflow.unfocusableScrollers).toBe(0);
  expect(overflow.smallestPersistentLabel).toBeGreaterThanOrEqual(12);
}

async function assertSeriousAndCriticalAxe(page: Page, view: BlsView) {
  const result = await new AxeBuilder({ page })
    .include(".bls-page")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const severeViolations = result.violations.filter((violation) => (
    violation.impact === "serious" || violation.impact === "critical"
  )).map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.flatMap((node) => node.target),
  }));

  expect(severeViolations, `${view.tab} serious/critical Axe violations`).toEqual([]);
}

async function selectView(page: Page, view: BlsView) {
  const tab = page.getByRole("tab", { name: view.tab, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#bls-active-panel")).toHaveCount(1);
  await expect(page.locator("#bls-active-panel")).toHaveAttribute("aria-labelledby", `bls-tab-${view.id}`);
  await expect(page.getByRole("heading", { level: 2, name: view.heading, exact: true })).toBeVisible();

  if (view.id === "overview") {
    await expect(page).not.toHaveURL(/(?:\?|&)view=/);
  } else {
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)view=${view.id}(?:&|$)`));
  }
}

async function captureReviewScreenshot(page: Page, testInfo: TestInfo, viewportName: string, viewId: string) {
  if (["overview", "trends", "revisions"].includes(viewId)) {
    // Recharts animates SVG paths in JavaScript, outside Playwright's CSS/Web
    // Animations controls. Capture the complete line/bar rather than a frame.
    await page.waitForTimeout(1_700);
  }
  await page.screenshot({
    path: testInfo.outputPath(`bls-release-lens-${viewportName}-${viewId}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

test.describe("@release BLS Release Lens", () => {
  test.setTimeout(60_000);

  for (const viewport of viewports) {
    test(`${viewport.name} keeps all six workspaces accessible and inside the viewport`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockBlsLens(page);
      await page.goto("/bls", { waitUntil: "networkidle" });

      await expect(page.getByRole("heading", { level: 1, name: "BLS Release Lens" })).toBeVisible();
      await expect(page.getByRole("tablist", { name: "BLS Release Lens views" })).toBeVisible();
      await expect(page.getByRole("tab")).toHaveCount(6);

      for (const view of views) {
        await selectView(page, view);
        await assertNoPageOverflow(page);
        await captureReviewScreenshot(page, testInfo, viewport.name, view.id);
        await assertSeriousAndCriticalAxe(page, view);
      }
    });
  }

  test("tabs support roving keyboard focus and replace the active workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockBlsLens(page);
    await page.goto("/bls", { waitUntil: "networkidle" });

    const overview = page.getByRole("tab", { name: "Overview", exact: true });
    const releases = page.getByRole("tab", { name: "Releases", exact: true });
    const methods = page.getByRole("tab", { name: "Methods & sources", exact: true });

    await overview.focus();
    await page.keyboard.press("ArrowRight");
    await expect(releases).toBeFocused();
    await expect(releases).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 2, name: "Latest observations by report" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Labor-market overview" })).toHaveCount(0);

    await page.keyboard.press("End");
    await expect(methods).toBeFocused();
    await expect(methods).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 2, name: "How the evidence is built" })).toBeVisible();

    await page.keyboard.press("Home");
    await expect(overview).toBeFocused();
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#bls-active-panel")).toHaveAttribute("aria-labelledby", "bls-tab-overview");
  });

  test("a direct Trends URL restores the requested native series and two-series comparison", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockBlsLens(page);
    await page.goto("/bls?view=trends&series=WPUFD4", { waitUntil: "networkidle" });

    await expect(page.getByRole("tab", { name: "Trends", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 2, name: "Native trend explorer" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Relative comparison" })).toBeVisible();
    await expect(page.getByLabel("Indicator")).toHaveValue("WPUFD4");

    await page.getByText(/Compare indicators · 2 of 2 selected/).click();
    const comparison = page.getByRole("group", { name: "Relative comparison series; choose up to two" });
    await expect(comparison.getByRole("button", { pressed: true })).toHaveCount(2);
    await expect(comparison.getByRole("button", { name: /Final-demand PPI/ })).toHaveAttribute("aria-pressed", "true");
    await assertNoPageOverflow(page);
    await assertSeriousAndCriticalAxe(page, views[2]);
  });

  test("a legacy Relative hash restores its precise in-workspace destination", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockBlsLens(page, 300);
    await page.goto("/bls#bls-relative", { waitUntil: "networkidle" });

    await expect(page.getByRole("tab", { name: "Trends", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 2, name: "Relative comparison" })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await expect.poll(async () => page.locator("#bls-relative").evaluate((element) => (
      element.getBoundingClientRect().top
    ))).toBeLessThan(700);
  });
});
