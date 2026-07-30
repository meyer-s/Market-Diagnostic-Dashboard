import { expect, test } from "@playwright/test";

const STORAGE_KEY = "market-diagnostic.theme-preview";

type ThemeStructureSnapshot = {
  dataset?: string;
  body: {
    fontSize: number;
    lineHeight: number;
  };
  topbar: {
    height: number;
    gap: number;
    descriptorFontSize: number;
    navCorners: [number, number, number, number];
  };
  shell: {
    maxWidth: number;
    paddingBlock: number;
    paddingInline: number;
  };
  stackGap: number;
  title: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
  };
  card: {
    corners: [number, number, number, number];
    shadow: "none" | "inset" | "ambient";
  };
  chart: {
    corners: [number, number, number, number];
    shadow: "none" | "inset" | "ambient";
  };
  pageHeader: {
    corners: [number, number, number, number];
  };
  footer: {
    borderColor: string;
  };
  semantic: {
    positive: string;
    caution: string;
    negative: string;
  };
};

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

async function chooseDesktopTheme(
  page: import("@playwright/test").Page,
  theme: "evidence" | "ledger" | "observatory",
  label: string,
) {
  if ((await page.locator("html").getAttribute("data-theme")) === theme) return;

  await page.locator(".topbar-theme-button").click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(label, "i") })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      }),
  );
}

async function structureSnapshot(
  page: import("@playwright/test").Page,
): Promise<ThemeStructureSnapshot> {
  return page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.setAttribute("aria-hidden", "true");
    fixture.setAttribute("data-theme-structure-fixture", "true");
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
        <h2 class="page-title">Theme hierarchy probe</h2>
        <article class="primary-card">Card treatment probe</article>
        <figure class="chart-frame">Chart treatment probe</figure>
        <span data-semantic="positive" style="color:var(--field-positive)">Positive</span>
        <span data-semantic="caution" style="color:var(--field-caution)">Caution</span>
        <span data-semantic="negative" style="color:var(--field-negative)">Negative</span>
      </div>
    `;
    document.body.append(fixture);

    const px = (value: string) => Number.parseFloat(value);
    const corners = (
      style: CSSStyleDeclaration,
    ): [number, number, number, number] => [
      px(style.borderTopLeftRadius),
      px(style.borderTopRightRadius),
      px(style.borderBottomRightRadius),
      px(style.borderBottomLeftRadius),
    ];
    const shadow = (
      value: string,
    ): "none" | "inset" | "ambient" => {
      if (value === "none") return "none";
      return value.includes("inset") ? "inset" : "ambient";
    };
    const required = <ElementType extends Element>(
      selector: string,
      scope: ParentNode = document,
    ) => {
      const element = scope.querySelector<ElementType>(selector);
      if (!element) throw new Error(`Theme structure probe could not find ${selector}`);
      return element;
    };

    try {
      const contentStyle = getComputedStyle(
        required<HTMLElement>("#main-content"),
      );
      const topbar = required<HTMLElement>(".topbar-inner");
      const topbarStyle = getComputedStyle(topbar);
      const navStyle = getComputedStyle(required<HTMLElement>(".topbar-nav-link", topbar));
      const shellStyle = getComputedStyle(required<HTMLElement>(".page-shell", fixture));
      const stackChildren = Array.from(
        required<HTMLElement>(".page-stack", fixture).children,
      ) as HTMLElement[];
      const titleStyle = getComputedStyle(required<HTMLElement>(".page-title", fixture));
      const cardStyle = getComputedStyle(required<HTMLElement>(".primary-card", fixture));
      const chartStyle = getComputedStyle(required<HTMLElement>(".chart-frame", fixture));
      const pageHeader = document.createElement("div");
      pageHeader.className = "page-header";
      pageHeader.textContent = "Header treatment probe";
      fixture.append(pageHeader);
      const pageHeaderStyle = getComputedStyle(pageHeader);
      const descriptorStyle = getComputedStyle(
        required<HTMLElement>(".topbar-brand-descriptor"),
      );
      const footerStyle = getComputedStyle(required<HTMLElement>("footer"));

      return {
        dataset: document.documentElement.dataset.theme,
        body: {
          fontSize: px(contentStyle.fontSize),
          lineHeight: px(contentStyle.lineHeight),
        },
        topbar: {
          height: topbar.getBoundingClientRect().height,
          gap: px(topbarStyle.gap),
          descriptorFontSize: px(descriptorStyle.fontSize),
          navCorners: corners(navStyle),
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
        card: {
          corners: corners(cardStyle),
          shadow: shadow(cardStyle.boxShadow),
        },
        chart: {
          corners: corners(chartStyle),
          shadow: shadow(chartStyle.boxShadow),
        },
        pageHeader: {
          corners: corners(pageHeaderStyle),
        },
        footer: {
          borderColor: footerStyle.borderTopColor,
        },
        semantic: {
          positive: getComputedStyle(
            required<HTMLElement>('[data-semantic="positive"]', fixture),
          ).color,
          caution: getComputedStyle(
            required<HTMLElement>('[data-semantic="caution"]', fixture),
          ).color,
          negative: getComputedStyle(
            required<HTMLElement>('[data-semantic="negative"]', fixture),
          ).color,
        },
      };
    } finally {
      fixture.remove();
    }
  });
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

test("@release preserves Evidence Field as the existing site baseline at every responsive tier", async ({
  page,
}) => {
  const responsiveBaselines = [
    {
      width: 390,
      shellPaddingBlock: 16,
      shellPaddingInline: 12,
      stackGap: 24,
      titleSize: 24,
      titleLineHeight: 32,
    },
    {
      width: 768,
      shellPaddingBlock: 24,
      shellPaddingInline: 24,
      stackGap: 32,
      titleSize: 30,
      titleLineHeight: 36,
    },
    {
      width: 1024,
      shellPaddingBlock: 24,
      shellPaddingInline: 24,
      stackGap: 32,
      titleSize: 30,
      titleLineHeight: 36,
    },
    {
      width: 1440,
      shellPaddingBlock: 24,
      shellPaddingInline: 24,
      stackGap: 32,
      titleSize: 30,
      titleLineHeight: 36,
    },
  ] as const;

  for (const baseline of responsiveBaselines) {
    await page.setViewportSize({ width: baseline.width, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "evidence");

    const evidence = await structureSnapshot(page);
    expect(evidence.body).toEqual({ fontSize: 16, lineHeight: 24 });
    expect(evidence.topbar.height).toBe(64);
    expect(evidence.topbar.gap).toBe(20);
    expect(evidence.topbar.descriptorFontSize).toBe(10);
    expect(evidence.shell).toEqual({
      maxWidth: 1280,
      paddingBlock: baseline.shellPaddingBlock,
      paddingInline: baseline.shellPaddingInline,
    });
    expect(evidence.stackGap).toBe(baseline.stackGap);
    expect(evidence.title.fontFamily).toContain("Segoe UI Variable Text");
    expect(evidence.title.fontFamily).not.toContain("Display");
    expect(evidence.title.fontSize).toBe(baseline.titleSize);
    expect(evidence.title.lineHeight).toBe(baseline.titleLineHeight);
    expect(evidence.card.corners).toEqual([16, 16, 16, 16]);
    expect(evidence.card.shadow).toBe("ambient");
    expect(evidence.chart.corners).toEqual([14, 14, 14, 14]);
    expect(evidence.pageHeader.corners).toEqual([14, 14, 14, 14]);
    expect(evidence.footer.borderColor).toBe("rgba(63, 80, 104, 0.8)");
  }
});

test("@release renders three structurally distinct dark design systems while preserving evidence semantics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "evidence");

  const evidence = await structureSnapshot(page);

  await chooseDesktopTheme(page, "ledger", "Midnight Ledger");
  const ledger = await structureSnapshot(page);

  await chooseDesktopTheme(page, "observatory", "Signal Observatory");
  const observatory = await structureSnapshot(page);

  expect(evidence.dataset).toBe("evidence");
  expect(ledger.dataset).toBe("ledger");
  expect(observatory.dataset).toBe("observatory");

  // Midnight Ledger is a denser, flatter and sharper analytical workspace.
  expect(ledger.body.fontSize).toBeLessThan(evidence.body.fontSize);
  expect(ledger.body.lineHeight).toBeLessThan(evidence.body.lineHeight);
  expect(ledger.topbar.height).toBeLessThan(evidence.topbar.height);
  expect(ledger.topbar.height).toBeGreaterThanOrEqual(44);
  expect(ledger.topbar.gap).toBeLessThan(evidence.topbar.gap);
  expect(ledger.shell.paddingBlock).toBeLessThan(evidence.shell.paddingBlock);
  expect(ledger.shell.paddingInline).toBeLessThan(evidence.shell.paddingInline);
  expect(ledger.stackGap).toBeLessThan(evidence.stackGap);
  expect(ledger.shell.maxWidth).toBeGreaterThan(evidence.shell.maxWidth);
  expect(Math.max(...ledger.card.corners)).toBeLessThan(
    Math.min(...evidence.card.corners),
  );
  expect(Math.max(...ledger.topbar.navCorners)).toBeLessThan(
    Math.min(...evidence.topbar.navCorners),
  );
  expect(ledger.card.shadow).toBe("none");
  expect(ledger.chart.shadow).toBe("none");
  expect(evidence.card.shadow).toBe("ambient");

  // Signal Observatory enlarges the reading hierarchy, opens the rhythm,
  // and uses an intentionally asymmetric instrument-frame geometry.
  expect(observatory.body.lineHeight).toBeGreaterThan(evidence.body.lineHeight);
  expect(observatory.topbar.height).toBeGreaterThan(evidence.topbar.height);
  expect(observatory.stackGap).toBeGreaterThan(evidence.stackGap);
  expect(observatory.shell.paddingBlock).toBeGreaterThan(evidence.shell.paddingBlock);
  expect(observatory.shell.paddingInline).toBeGreaterThan(evidence.shell.paddingInline);
  expect(observatory.title.fontSize).toBeGreaterThan(evidence.title.fontSize);
  expect(observatory.title.fontSize).toBeGreaterThan(ledger.title.fontSize);
  expect(observatory.card.corners[0]).toBeGreaterThan(observatory.card.corners[1]);
  expect(observatory.card.corners[2]).toBeGreaterThan(observatory.card.corners[3]);
  expect(observatory.chart.corners[0]).toBeGreaterThan(observatory.chart.corners[1]);
  expect(observatory.topbar.navCorners[0]).not.toBe(
    observatory.topbar.navCorners[1],
  );
  expect(observatory.card.corners).not.toEqual(evidence.card.corners);
  expect(observatory.card.corners).not.toEqual(ledger.card.corners);

  // Market-state meaning must not drift when the visual system changes.
  expect(ledger.semantic).toEqual(evidence.semantic);
  expect(observatory.semantic).toEqual(evidence.semantic);
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

test("@release gives Signal Observatory authored desktop and mobile compositions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await chooseDesktopTheme(page, "observatory", "Signal Observatory");

  await expect(page.locator(".observatory-context-rail")).toHaveCount(0);
  await expect(page.locator(".observatory-context-nav")).toHaveCount(0);
  await expect(page.locator(".dashboard-current-read-console")).toBeVisible();
  await expect(page.locator(".dashboard-current-read-heading")).toBeVisible({
    timeout: 15_000,
  });

  const desktop = await page.evaluate(() => {
    const required = <ElementType extends Element>(selector: string) => {
      const element = document.querySelector<ElementType>(selector);
      if (!element) throw new Error(`Observatory probe could not find ${selector}`);
      return element;
    };
    const columnCount = (value: string) =>
      value.split(" ").filter((part) => part.trim().length > 0).length;

    const currentRead = required<HTMLElement>(".dashboard-current-read-console");
    const currentReadStyle = getComputedStyle(currentRead);
    const driverGrid = required<HTMLElement>(".dashboard-driver-grid");
    const driverStyle = getComputedStyle(driverGrid);
    const driverOrder = Array.from(
      driverGrid.querySelectorAll<HTMLElement>(
        ":scope > .dashboard-driver-shell",
      ),
    ).map((shell) =>
      ["system", "dow", "sector", "aas"].find((driver) =>
        shell.classList.contains(`dashboard-driver-${driver}`),
      ),
    );
    const indicatorArray = required<HTMLElement>(".dashboard-indicator-array");
    const indicatorStyle = getComputedStyle(indicatorArray);
    const ordinaryCard =
      driverGrid.querySelector<HTMLElement>(".primary-card")
      ?? (() => {
        const card = document.createElement("div");
        card.className = "primary-card";
        driverGrid.append(card);
        return card;
      })();

    const stateProbe = document.createElement("span");
    stateProbe.className = "indicator-sensor-state-label sr-only";
    stateProbe.textContent = "GREEN";
    document.body.append(stateProbe);
    const stateStyle = getComputedStyle(stateProbe);

    try {
      return {
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        currentRead: {
          display: currentReadStyle.display,
          columns: columnCount(currentReadStyle.gridTemplateColumns),
          backgroundImage: currentReadStyle.backgroundImage,
        },
        driverColumns: columnCount(driverStyle.gridTemplateColumns),
        driverOrder,
        indicatorColumns: columnCount(indicatorStyle.gridTemplateColumns),
        ordinaryCardBackgroundImage: getComputedStyle(ordinaryCard).backgroundImage,
        stateLabel: {
          position: stateStyle.position,
          width: stateStyle.width,
          height: stateStyle.height,
          fontSize: Number.parseFloat(stateStyle.fontSize),
        },
      };
    } finally {
      stateProbe.remove();
    }
  });

  expect(desktop.documentOverflow).toBeLessThanOrEqual(0);
  expect(desktop.currentRead.display).toBe("grid");
  expect(desktop.currentRead.columns).toBe(2);
  expect(desktop.currentRead.backgroundImage).not.toBe("none");
  expect(desktop.driverColumns).toBe(2);
  expect(desktop.driverOrder).toEqual(["system", "dow", "sector", "aas"]);
  expect(desktop.indicatorColumns).toBe(3);
  expect(desktop.ordinaryCardBackgroundImage).toBe("none");
  expect(desktop.stateLabel.position).toBe("static");
  expect(desktop.stateLabel.width).not.toBe("1px");
  expect(desktop.stateLabel.height).not.toBe("1px");
  expect(desktop.stateLabel.fontSize).toBeGreaterThanOrEqual(12);

  await page.setViewportSize({ width: 390, height: 844 });

  const mobile = await page.evaluate(() => {
    const currentRead = document.querySelector<HTMLElement>(
      ".dashboard-current-read-console",
    );
    const indicatorArray = document.querySelector<HTMLElement>(
      ".dashboard-indicator-array",
    );
    if (!currentRead || !indicatorArray) {
      throw new Error("Observatory mobile probe could not find dashboard structure");
    }

    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      currentReadColumns: getComputedStyle(currentRead).gridTemplateColumns,
      indicatorColumns: getComputedStyle(indicatorArray).gridTemplateColumns,
      driverOrder: Array.from(
        document.querySelectorAll<HTMLElement>(
          ".dashboard-driver-grid > .dashboard-driver-shell",
        ),
      ).map((shell) =>
        ["system", "dow", "sector", "aas"].find((driver) =>
          shell.classList.contains(`dashboard-driver-${driver}`),
        ),
      ),
    };
  });

  expect(mobile.documentOverflow).toBeLessThanOrEqual(0);
  expect(mobile.currentReadColumns.split(" ")).toHaveLength(1);
  expect(mobile.indicatorColumns.split(" ")).toHaveLength(1);
  expect(mobile.driverOrder).toEqual(["system", "dow", "sector", "aas"]);

  await page.goto("/system-breakdown", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "observatory");
  await expect(page.locator("#system-section-nav")).toHaveCount(0);
  await expect(page.locator(".system-context-nav")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await chooseDesktopTheme(page, "evidence", "Evidence Field");
  await expect(page.locator(".section-nav")).toHaveCount(0);
  await chooseDesktopTheme(page, "observatory", "Signal Observatory");
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/vision", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "observatory");
  await expect(page.locator(".vision-highlight-detail")).toHaveCount(1);
  await expect(page.locator(".vision-highlight-selector")).toHaveCount(3);

  const visionMobile = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(".vision-highlight-rail");
    if (!rail) throw new Error("Vision highlight rail is missing");
    const selectors = Array.from(
      rail.querySelectorAll<HTMLElement>(".vision-highlight-selector"),
    );
    return {
      display: getComputedStyle(rail).display,
      scrollable: rail.scrollWidth > rail.clientWidth,
      minimumTarget: Math.min(
        ...selectors.map((selector) => selector.getBoundingClientRect().height),
      ),
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(visionMobile.display).toBe("flex");
  expect(visionMobile.scrollable).toBe(true);
  expect(visionMobile.minimumTarget).toBeGreaterThanOrEqual(44);
  expect(visionMobile.documentOverflow).toBeLessThanOrEqual(0);
});
