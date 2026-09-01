import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { blsLensFixture } from "../../src/features/bls/__fixtures__/blsLensFixture";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
] as const;

test.describe("@release BLS Release Lens", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} keeps the evidence spine accessible and inside the viewport`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route("**/api/bls/lens?**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(blsLensFixture),
        });
      });

      await page.goto("/bls", { waitUntil: "networkidle" });

      await expect(page.getByRole("heading", { level: 1, name: "BLS Release Lens" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Current release ledger" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Release runway" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Relative Field" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Native trend explorer" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Official payroll revision ledger" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Release schedule rail" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Definitions, coverage, and source IDs" })).toBeVisible();

      const ledgerTop = await page.locator("#bls-now").evaluate((element) => element.getBoundingClientRect().top);
      const relativeTop = await page.locator("#bls-relative").evaluate((element) => element.getBoundingClientRect().top);
      expect(ledgerTop).toBeLessThan(relativeTop);

      const selector = page.getByRole("group", { name: "Relative Field series; choose up to five" });
      await expect(selector.getByRole("button")).toHaveCount(6);
      await expect(selector.getByRole("button", { pressed: true })).toHaveCount(5);
      const ppi = selector.getByRole("button", { name: /Final-demand PPI/ });
      await expect(ppi).toBeDisabled();
      await selector.getByRole("button", { name: /Core CPI/ }).click();
      await expect(ppi).toBeEnabled();
      await ppi.click();
      await expect(selector.getByRole("button", { pressed: true })).toHaveCount(5);

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
        smallestLabel: [...document.querySelectorAll<HTMLElement>(".bls-page small, .bls-page .bls-section-kicker, .bls-page .bls-status-label")]
          .reduce((minimum, element) => Math.min(minimum, Number.parseFloat(getComputedStyle(element).fontSize)), Number.POSITIVE_INFINITY),
      }));
      expect(overflow.page, JSON.stringify(overflow.offenders, null, 2)).toBeLessThanOrEqual(1);
      expect(overflow.unfocusableScrollers).toBe(0);
      expect(overflow.smallestLabel).toBeGreaterThanOrEqual(12);

      const axe = await new AxeBuilder({ page })
        .include(".bls-page")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
      ).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath(`bls-release-lens-${viewport.name}.png`),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
});
