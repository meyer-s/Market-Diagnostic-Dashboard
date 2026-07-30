import { expect, test, type Page } from "@playwright/test";

const STORAGE_KEY = "market-diagnostic.theme-preview";

type EvidenceStructure = {
  body: { fontSize: number; lineHeight: number };
  topbar: { height: number; gap: number; descriptorFontSize: number };
  shell: { maxWidth: number; paddingBlock: number; paddingInline: number };
  stackGap: number;
  title: { fontFamily: string; fontSize: number; lineHeight: number };
  cardCorners: [number, number, number, number];
  chartCorners: [number, number, number, number];
  pageHeaderCorners: [number, number, number, number];
  footerBorderColor: string;
};

async function structureSnapshot(page: Page): Promise<EvidenceStructure> {
  return page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.setAttribute("aria-hidden", "true");
    fixture.style.cssText = [
      "position:fixed",
      "inset:0 auto auto 0",
      "z-index:-2147483648",
      "width:640px",
      "opacity:0",
      "pointer-events:none",
      "contain:layout style paint",
    ].join(";");
    fixture.innerHTML = `
      <div class="page-shell">
        <div class="page-stack">
          <div>First section</div>
          <div>Second section</div>
        </div>
        <h2 class="page-title">Evidence hierarchy probe</h2>
        <article class="primary-card">Card treatment probe</article>
        <figure class="chart-frame">Chart treatment probe</figure>
        <div class="page-header">Header treatment probe</div>
      </div>
    `;
    document.body.append(fixture);

    const required = <ElementType extends Element>(
      selector: string,
      scope: ParentNode = document,
    ) => {
      const element = scope.querySelector<ElementType>(selector);
      if (!element) throw new Error(`Evidence probe could not find ${selector}`);
      return element;
    };
    const px = (value: string) => Number.parseFloat(value);
    const corners = (
      style: CSSStyleDeclaration,
    ): [number, number, number, number] => [
      px(style.borderTopLeftRadius),
      px(style.borderTopRightRadius),
      px(style.borderBottomRightRadius),
      px(style.borderBottomLeftRadius),
    ];

    try {
      const contentStyle = getComputedStyle(
        required<HTMLElement>("#main-content"),
      );
      const topbar = required<HTMLElement>(".topbar-inner");
      const topbarStyle = getComputedStyle(topbar);
      const descriptorStyle = getComputedStyle(
        required<HTMLElement>(".topbar-brand-descriptor"),
      );
      const shellStyle = getComputedStyle(
        required<HTMLElement>(".page-shell", fixture),
      );
      const stackChildren = Array.from(
        required<HTMLElement>(".page-stack", fixture).children,
      ) as HTMLElement[];
      const titleStyle = getComputedStyle(
        required<HTMLElement>(".page-title", fixture),
      );
      const cardStyle = getComputedStyle(
        required<HTMLElement>(".primary-card", fixture),
      );
      const chartStyle = getComputedStyle(
        required<HTMLElement>(".chart-frame", fixture),
      );
      const pageHeaderStyle = getComputedStyle(
        required<HTMLElement>(".page-header", fixture),
      );
      const footerStyle = getComputedStyle(required<HTMLElement>("footer"));

      return {
        body: {
          fontSize: px(contentStyle.fontSize),
          lineHeight: px(contentStyle.lineHeight),
        },
        topbar: {
          height: topbar.getBoundingClientRect().height,
          gap: px(topbarStyle.gap),
          descriptorFontSize: px(descriptorStyle.fontSize),
        },
        shell: {
          maxWidth: px(shellStyle.maxWidth),
          paddingBlock: px(shellStyle.paddingBlockStart),
          paddingInline: px(shellStyle.paddingInlineStart),
        },
        stackGap:
          stackChildren[1].getBoundingClientRect().top -
          stackChildren[0].getBoundingClientRect().bottom,
        title: {
          fontFamily: titleStyle.fontFamily,
          fontSize: px(titleStyle.fontSize),
          lineHeight: px(titleStyle.lineHeight),
        },
        cardCorners: corners(cardStyle),
        chartCorners: corners(chartStyle),
        pageHeaderCorners: corners(pageHeaderStyle),
        footerBorderColor: footerStyle.borderTopColor,
      };
    } finally {
      fixture.remove();
    }
  });
}

test("@release locks the app to Evidence and retires legacy preview preferences before paint", async ({
  browser,
}) => {
  for (const legacyTheme of ["ledger", "observatory"]) {
    const context = await browser.newContext();
    await context.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      { key: STORAGE_KEY, value: legacyTheme },
    );
    const page = await context.newPage();

    await page.goto("/vision", { waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveAttribute("data-theme", "evidence");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#0e1520",
    );
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY),
    ).toBe("evidence");
    await expect(page.locator(".topbar-theme-button")).toHaveCount(0);
    await expect(page.getByText("Preview view", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-theme-value]")).toHaveCount(0);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "evidence");
    await context.close();
  }
});

test("@release preserves the Evidence Field checkpoint at every responsive tier", async ({
  page,
}) => {
  const baselines = [
    { width: 390, block: 16, inline: 12, gap: 24, title: 24, line: 32 },
    { width: 768, block: 24, inline: 24, gap: 32, title: 30, line: 36 },
    { width: 1024, block: 24, inline: 24, gap: 32, title: 30, line: 36 },
    { width: 1440, block: 24, inline: 24, gap: 32, title: 30, line: 36 },
  ] as const;

  for (const baseline of baselines) {
    await page.setViewportSize({ width: baseline.width, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "evidence");

    const evidence = await structureSnapshot(page);
    expect(evidence.body).toEqual({ fontSize: 16, lineHeight: 24 });
    expect(evidence.topbar).toEqual({
      height: 64,
      gap: 20,
      descriptorFontSize: 10,
    });
    expect(evidence.shell).toEqual({
      maxWidth: 1280,
      paddingBlock: baseline.block,
      paddingInline: baseline.inline,
    });
    expect(evidence.stackGap).toBe(baseline.gap);
    expect(evidence.title.fontFamily).toContain("Segoe UI Variable Text");
    expect(evidence.title.fontFamily).not.toContain("Display");
    expect(evidence.title.fontSize).toBe(baseline.title);
    expect(evidence.title.lineHeight).toBe(baseline.line);
    expect(evidence.cardCorners).toEqual([16, 16, 16, 16]);
    expect(evidence.chartCorners).toEqual([14, 14, 14, 14]);
    expect(evidence.pageHeaderCorners).toEqual([14, 14, 14, 14]);
    expect(evidence.footerBorderColor).toBe("rgba(63, 80, 104, 0.8)");
  }
});

test("@release keeps the retired selector out of mobile and desktop navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/vision", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open navigation menu" }).click();

  const mobileNav = page.getByRole("navigation", { name: "Mobile" });
  const dashboardLink = mobileNav.getByRole("link", { name: "Dashboard" });
  await expect(dashboardLink).toBeFocused();
  await expect(mobileNav.getByRole("radiogroup")).toHaveCount(0);
  await expect(mobileNav.getByText("Preview view", { exact: true })).toHaveCount(0);
  const dashboardTarget = await dashboardLink.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(dashboardTarget.width).toBeGreaterThanOrEqual(44);
  expect(dashboardTarget.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toBeHidden();
  await expect(page.locator(".topbar-theme-button")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
