import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("@release Vision architecture constellation", () => {
  test("opens an interactive, keyboard-closeable desktop workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/vision");

    const section = page.locator("#vision-architecture");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("heading", { name: "Inspect how the research system fits together." })).toBeVisible();
    await expect(section.locator('iframe[title^="Preview of"]')).toBeVisible();
    const previewGraph = page.frameLocator('iframe[title^="Preview of"]');
    await expect(previewGraph.locator("html")).toHaveClass(/embed-preview/);
    await expect(previewGraph.locator("canvas")).toBeVisible();
    await expect(previewGraph.locator("canvas")).toHaveAttribute("data-recent-pulse", "settled");
    await expect(previewGraph.locator(".command-deck")).toBeHidden();
    await expect(previewGraph.locator(".inspector")).toBeHidden();
    await expect(previewGraph.locator(".statusbar")).toBeHidden();

    await section.getByRole("button", { name: "Open interactive constellation" }).click();
    const dialog = page.getByRole("dialog", { name: "Architecture Constellation" });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(15);
    expect(bounds!.y).toBeGreaterThanOrEqual(15);
    expect(1440 - (bounds!.x + bounds!.width)).toBeGreaterThanOrEqual(15);

    const graph = page.frameLocator('iframe[title="Interactive architecture constellation"]');
    await expect(graph.getByRole("button", { name: "Sphere" })).toBeVisible();
    await expect(dialog.locator('[role="status"]')).toHaveCount(0);
    await expect(graph.getByRole("button", { name: "Neighborhood" })).toBeVisible();
    await expect(graph.getByRole("button", { name: "Hygiene" })).toBeHidden();
    await expect(graph.locator(".layer-deck")).toHaveCount(0);
    await expect(graph.locator("#densitySelect")).toBeHidden();
    await expect(graph.locator("#rotationToggle")).toBeHidden();
    await expect(graph.locator("#resetButton")).toBeHidden();

    const canvas = graph.locator("canvas");
    const recentFileCount = Number(await canvas.getAttribute("data-recent-files"));
    const recentButton = graph.locator("#recentButton");
    if (recentFileCount > 0) {
      await expect(recentButton).toBeVisible();
      await recentButton.click();
      await expect(canvas).toHaveAttribute("data-recent-pulse", "active");
      await expect(graph.getByRole("button", { name: "Sphere" })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => canvas.getAttribute("data-recent-pulse"), { timeout: 6_000 }).toBe("settled");
    } else {
      await expect(recentButton).toBeHidden();
    }

    await graph.locator("#viewMenu > summary").click();
    await expect(graph.getByLabel("Sphere detail")).toBeVisible();
    await expect(graph.locator("#rotationToggle")).toBeVisible();
    await expect(graph.getByRole("button", { name: "Reset camera" })).toBeVisible();
    await expect(graph.locator("#domainFilters").getByLabel("Frontend")).toBeVisible();

    const openViewAxe = await new AxeBuilder({ page }).analyze();
    expect(openViewAxe.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(graph.locator("#viewMenu")).not.toHaveAttribute("open", "");
    await expect(dialog).toBeVisible();

    await graph.getByRole("combobox", { name: /Find any file, function/i }).fill("Vision");
    await expect(graph.getByRole("option").first()).toBeVisible();
    await graph.getByRole("button", { name: "Neighborhood" }).click();
    if (recentFileCount > 0) {
      await recentButton.click();
      await expect(graph.getByRole("button", { name: "Sphere" })).toHaveAttribute("aria-pressed", "true");
    }

    const parentAxe = await new AxeBuilder({ page }).analyze();
    expect(parentAxe.violations).toEqual([]);

    await graph.getByRole("button", { name: "Sphere" }).focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("uses the full mobile viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/vision");
    await page.getByRole("button", { name: "Open interactive constellation" }).click();

    const dialog = page.getByRole("dialog", { name: "Architecture Constellation" });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.width - 390)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.height - 844)).toBeLessThanOrEqual(1);

    const graph = page.frameLocator('iframe[title="Interactive architecture constellation"]');
    await expect(graph.getByRole("button", { name: "Sphere" })).toBeVisible();
    await graph.locator("#viewMenu > summary").click();
    const viewPanel = graph.locator(".view-panel");
    await expect(viewPanel).toBeVisible();
    const viewBounds = await viewPanel.boundingBox();
    expect(viewBounds).not.toBeNull();
    expect(viewBounds!.x).toBeGreaterThanOrEqual(0);
    expect(viewBounds!.x + viewBounds!.width).toBeLessThanOrEqual(390);
    const resetBounds = await graph.getByRole("button", { name: "Reset camera" }).boundingBox();
    expect(resetBounds!.height).toBeGreaterThanOrEqual(44);
    const closeBounds = await page.getByRole("button", { name: "Close Architecture Constellation" }).boundingBox();
    expect(closeBounds!.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds!.height).toBeGreaterThanOrEqual(44);

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(390);
    const graphDocumentWidth = await graph.locator("html").evaluate((element) => element.scrollWidth);
    expect(graphDocumentWidth).toBeLessThanOrEqual(390);
    const parentAxe = await new AxeBuilder({ page }).analyze();
    expect(parentAxe.violations).toEqual([]);
  });

  test("keeps the compact command deck inside a tablet-width embed", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/vision");
    await page.getByRole("button", { name: "Open interactive constellation" }).click();

    const graph = page.frameLocator('iframe[title="Interactive architecture constellation"]');
    await expect(graph.getByRole("button", { name: "Sphere" })).toBeVisible();
    const graphViewportWidth = await graph.locator("html").evaluate(() => window.innerWidth);
    const graphDocumentWidth = await graph.locator("html").evaluate((element) => element.scrollWidth);
    expect(graphDocumentWidth).toBeLessThanOrEqual(graphViewportWidth);

    const searchBounds = await graph.locator("#nodeSearch").boundingBox();
    const modeBounds = await graph.locator(".mode-switch").boundingBox();
    expect(searchBounds).not.toBeNull();
    expect(modeBounds).not.toBeNull();
    expect(modeBounds!.y).toBeGreaterThan(searchBounds!.y);
  });

  test("keeps the standalone public constellation accessible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/_graphify/constellation.html");
    await expect(page.getByRole("heading", { name: "Architecture Constellation" })).toBeVisible();
    await page.locator("#viewMenu > summary").click();
    await expect(page.getByLabel("Sphere detail")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("uses a static recent signal when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/_graphify/constellation.html");
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveAttribute("data-recent-pulse", "settled");
    const recentButton = page.locator("#recentButton");
    const recentFileCount = Number(await canvas.getAttribute("data-recent-files"));
    if (recentFileCount > 0) {
      await expect(recentButton).toBeVisible();
      await recentButton.click();
      await expect(canvas).toHaveAttribute("data-recent-pulse", "settled");
    } else {
      await expect(recentButton).toBeHidden();
    }
  });
});
