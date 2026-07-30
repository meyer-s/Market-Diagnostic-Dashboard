import { expect, test } from "@playwright/test";

const STORAGE_KEY = "market-diagnostic.theme-preview";

async function themeSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate((storageKey) => {
    const rootStyle = window.getComputedStyle(document.documentElement);
    return {
      dataset: document.documentElement.dataset.theme,
      stored: window.localStorage.getItem(storageKey),
      themeColor: document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
      canvas: rootStyle.getPropertyValue("--field-canvas").trim(),
      surface: rootStyle.getPropertyValue("--field-surface").trim(),
      accent: rootStyle.getPropertyValue("--field-accent").trim(),
      positive: rootStyle.getPropertyValue("--field-positive").trim(),
      caution: rootStyle.getPropertyValue("--field-caution").trim(),
      negative: rootStyle.getPropertyValue("--field-negative").trim(),
    };
  }, STORAGE_KEY);
}

test("@release switches dark preview views, persists them across routes, and restores them before app paint", async ({
  page,
}) => {
  await page.goto("/vision", { waitUntil: "domcontentloaded" });

  const evidence = await themeSnapshot(page);
  expect(evidence).toMatchObject({
    dataset: "evidence",
    stored: "evidence",
    themeColor: "#0e1520",
  });

  await page.getByRole("button", { name: /View.*Field/i }).click();
  await page
    .getByRole("menuitemradio", { name: /Midnight Ledger/i })
    .click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "ledger");
  await expect(
    page.getByRole("button", { name: /View.*Ledger/i }),
  ).toBeVisible();

  const ledger = await themeSnapshot(page);
  expect(ledger).toMatchObject({
    dataset: "ledger",
    stored: "ledger",
    themeColor: "#0a1420",
  });
  expect(ledger.canvas).not.toBe(evidence.canvas);
  expect(ledger.surface).not.toBe(evidence.surface);
  expect(ledger.accent).not.toBe(evidence.accent);
  expect(ledger.positive).toBe(evidence.positive);
  expect(ledger.caution).toBe(evidence.caution);
  expect(ledger.negative).toBe(evidence.negative);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ledger");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ledger");
  expect((await themeSnapshot(page)).stored).toBe("ledger");

  await page.getByRole("button", { name: /View.*Ledger/i }).click();
  await page
    .getByRole("menuitemradio", { name: /Signal Observatory/i })
    .click();

  const observatory = await themeSnapshot(page);
  expect(observatory).toMatchObject({
    dataset: "observatory",
    stored: "observatory",
    themeColor: "#071619",
  });
  expect(observatory.canvas).not.toBe(ledger.canvas);
  expect(observatory.surface).not.toBe(ledger.surface);
  expect(observatory.accent).not.toBe(ledger.accent);
  expect(observatory.positive).toBe(evidence.positive);
  expect(observatory.caution).toBe(evidence.caution);
  expect(observatory.negative).toBe(evidence.negative);
});

test("@release exposes the same preview choices as accessible mobile controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/vision", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Open navigation menu" })
    .click();

  const mobileNav = page.getByRole("navigation", { name: "Mobile" });
  const previewGroup = mobileNav.getByRole("radiogroup", {
    name: "Preview view",
  });
  await expect(previewGroup.getByRole("radio")).toHaveCount(3);

  const signal = previewGroup.getByRole("radio", {
    name: /Signal Observatory/i,
  });
  await signal.click();

  await expect(signal).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "observatory",
  );
  await expect(mobileNav).toBeVisible();

  const target = await signal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
});

test("@release keeps the desktop view control inside the topbar at the 1024px breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const topbar = page.locator("header").first();
  const viewButton = page.getByRole("button", { name: /View.*Field/i });

  await expect(topbar).toBeVisible();
  await expect(viewButton).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toBeHidden();

  const fit = await topbar.evaluate((element) => {
    const visibleControls = Array.from(
      element.querySelectorAll<HTMLElement>("a, button"),
    ).filter((control) => {
      const style = window.getComputedStyle(control);
      const rect = control.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

    return {
      documentOverflow:
        document.documentElement.scrollWidth - window.innerWidth,
      controlsOutsideViewport: visibleControls
        .map((control) => {
          const rect = control.getBoundingClientRect();
          return {
            text: control.textContent?.trim() ?? "",
            left: rect.left,
            right: rect.right,
          };
        })
        .filter(({ left, right }) => left < 0 || right > window.innerWidth),
    };
  });

  expect(fit.documentOverflow).toBeLessThanOrEqual(0);
  expect(fit.controlsOutsideViewport).toEqual([]);

  await viewButton.click();
  const themeMenu = page.getByRole("menu", { name: "Preview view" });
  await expect(themeMenu).toBeVisible();

  const menuRect = await themeMenu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  expect(menuRect.left).toBeGreaterThanOrEqual(0);
  expect(menuRect.right).toBeLessThanOrEqual(1024);
});
