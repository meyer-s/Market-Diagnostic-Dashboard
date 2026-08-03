import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Vision architecture constellation", () => {
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

    await graph.getByRole("combobox", { name: /Find any file, function/i }).fill("Vision");
    await expect(graph.getByRole("option").first()).toBeVisible();
    await graph.getByRole("button", { name: "Neighborhood" }).click();

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
    const closeBounds = await page.getByRole("button", { name: "Close Architecture Constellation" }).boundingBox();
    expect(closeBounds!.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds!.height).toBeGreaterThanOrEqual(44);

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(390);
    const parentAxe = await new AxeBuilder({ page }).analyze();
    expect(parentAxe.violations).toEqual([]);
  });

  test("keeps the standalone public constellation accessible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/_graphify/constellation.html");
    await expect(page.getByRole("heading", { name: "Architecture Constellation" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
