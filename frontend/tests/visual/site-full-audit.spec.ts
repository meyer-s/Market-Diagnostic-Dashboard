import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const AUDIT_DATE = process.env.AUDIT_RUN_ID ?? "2026-07-29-full";
const AUDIT_ROOT = path.resolve(process.cwd(), "..", "artifacts", "site-audit", AUDIT_DATE);
const SCREENSHOT_ROOT = path.join(AUDIT_ROOT, "screenshots");
const LIVE_ORIGIN = process.env.AUDIT_ORIGIN ?? "https://marketdiagnostictool.com";
const RUNTIME_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const AUDIT_THEME = "evidence" as const;
const AUDIT_SOURCE =
  new URL(RUNTIME_ORIGIN).origin === new URL(LIVE_ORIGIN).origin
    ? "deployed production runtime with read-only request enforcement"
    : "fresh local Vite production build with read-only production API proxy";

type ViewportName = "desktop" | "mobile";
type AuditGroup =
  | "route"
  | "navigation"
  | "indicator"
  | "recap"
  | "protected"
  | "legacy"
  | "error";

type AuditTarget = {
  id: string;
  name: string;
  path: string;
  group: AuditGroup;
  template: string;
  supportStatus?: "supported" | "retired-legacy";
  replacements?: string[];
  only?: ViewportName;
  action?: (page: Page) => Promise<void>;
};

type AxeFinding = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodeCount: number;
  targets: string[];
};

type OverflowElement = {
  tag: string;
  className: string;
  left: number;
  right: number;
  width: number;
  overflowBy: number;
  text: string;
};

type AuditRecord = {
  id: string;
  name: string;
  group: AuditGroup;
  template: string;
  requestedPath: string;
  supportStatus: "supported" | "retired-legacy";
  replacements?: string[];
  viewport: ViewportName;
  viewportWidth: number;
  viewportHeight: number;
  requestedTheme: string;
  appliedTheme: string;
  screenshot: string;
  screenshotWidth: number;
  screenshotHeight: number;
  finalUrl: string;
  title: string;
  headings: Array<{ level: number; text: string }>;
  mainCount: number;
  navCount: number;
  rootChildCount: number;
  bodyTextLength: number;
  documentWidth: number;
  documentHeight: number;
  horizontalOverflow: number;
  overflowElements?: OverflowElement[];
  fullHeightVerified: boolean;
  accepted: boolean;
  domNodeCount: number;
  resourceCount: number;
  transferBytes: number;
  scriptTransferBytes: number;
  imageCount: number;
  imagesWithoutAlt: number;
  formControls: number;
  unlabeledFormControls: number;
  scrollableRegions: number;
  unfocusableScrollableRegions: number;
  smallTargetsUnder24: number;
  smallTargetsUnder44: number;
  priorityTargetsUnder44: number;
  visibleLoadingStatuses: string[];
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  axeViolations: AxeFinding[];
  blocker?: string;
  note?: string;
};

const indicatorCodes = [
  "VIX",
  "SPY",
  "BREADTH_HEALTH",
  "T10Y2Y",
  "UNRATE",
  "CONSUMER_HEALTH",
  "BOND_MARKET_STABILITY",
  "LIQUIDITY_PROXY",
  "ANALYST_CONFIDENCE",
  "SENTIMENT_COMPOSITE",
  "SECTOR_REGIME_ALIGNMENT",
  "AGRICULTURE_STABILITY",
  "ENERGY_STABILITY",
  "REAL_ESTATE_STABILITY",
] as const;

const baseTargets: AuditTarget[] = [
  { id: "01-dashboard", name: "Dashboard", path: "/", group: "route", template: "Dashboard" },
  { id: "02-vision", name: "Vision", path: "/vision", group: "route", template: "Vision" },
  {
    id: "03-system-breakdown",
    name: "System Breakdown",
    path: "/system-breakdown",
    group: "route",
    template: "SystemBreakdown",
  },
  {
    id: "04-indicator-library",
    name: "Indicator Library",
    path: "/indicators",
    group: "route",
    template: "Indicators",
  },
  { id: "05-market-news", name: "Market News", path: "/news", group: "route", template: "MarketNews" },
  { id: "06-market-map", name: "Market Map", path: "/market-map", group: "route", template: "MarketMap" },
  {
    id: "07-sector-projections",
    name: "Sector Projections",
    path: "/sector-projections",
    group: "route",
    template: "SectorProjections",
  },
  {
    id: "08-stock-analysis-empty",
    name: "Stock Analysis — empty",
    path: "/stock-analysis",
    group: "route",
    template: "StockAnalysis",
  },
  {
    id: "09-stock-analysis-spy",
    name: "Stock Analysis — SPY",
    path: "/stock-analysis/SPY",
    group: "route",
    template: "StockAnalysis",
  },
  {
    id: "10-institutional-flow",
    name: "Institutional Flow",
    path: "/institutional-flow",
    group: "route",
    template: "InstitutionalFlow",
  },
  {
    id: "11-market-weather-single-now",
    name: "Market Weather — single — Now",
    path: "/market-weather?symbol=SPY&timeframe=1D&bars=365",
    group: "route",
    template: "MarketWeatherSingle",
  },
  {
    id: "12-market-weather-single-dictionary",
    name: "Market Weather — single — Dictionary",
    path: "/market-weather?symbol=SPY&timeframe=1D&bars=365",
    group: "route",
    template: "MarketWeatherSingle",
    action: async (page) => {
      await page.getByRole("tab", { name: "Dictionary", exact: true }).click();
    },
  },
  {
    id: "13-market-weather-single-methods",
    name: "Market Weather — single — Methods",
    path: "/market-weather?symbol=SPY&timeframe=1D&bars=365",
    group: "route",
    template: "MarketWeatherSingle",
    action: async (page) => {
      await page.getByRole("tab", { name: "Methods", exact: true }).click();
    },
  },
  {
    id: "14-market-weather-pair-overview",
    name: "Market Weather — pair — Overview",
    path: "/market-weather?symbol=SPY&comparison=pair&compare=QQQ&timeframe=1D&bars=120&pair_tab=overview",
    group: "route",
    template: "MarketWeatherPair",
  },
  {
    id: "15-market-weather-pair-field",
    name: "Market Weather — pair — Field detail",
    path: "/market-weather?symbol=SPY&comparison=pair&compare=QQQ&timeframe=1D&bars=120&pair_tab=field",
    group: "route",
    template: "MarketWeatherPair",
  },
  {
    id: "16-market-weather-pair-audit",
    name: "Market Weather — pair — Audit receipt",
    path: "/market-weather?symbol=SPY&comparison=pair&compare=QQQ&timeframe=1D&bars=120&pair_tab=audit",
    group: "route",
    template: "MarketWeatherPair",
  },
  {
    id: "17-recap-index",
    name: "Recap Index",
    path: "/tools/recap",
    group: "route",
    template: "RecapIndex",
  },
  {
    id: "18-volume-breadth",
    name: "Volume & Breadth",
    path: "/tools/volume-breadth",
    group: "route",
    template: "VolumeBreadthTools",
    action: async (page) => {
      await page
        .getByText("Loading breadth data...", { exact: true })
        .waitFor({ state: "hidden", timeout: 120_000 });
    },
  },
  {
    id: "19-precious-metals",
    name: "Precious Metals",
    path: "/metals-indicators",
    group: "route",
    template: "PreciousMetalsDiagnostic",
  },
  {
    id: "20-crypto",
    name: "Crypto",
    path: "/crypto-indicators",
    group: "route",
    template: "CryptoDiagnostic",
  },
  {
    id: "21-agriculture-overview",
    name: "Agriculture — Overview",
    path: "/agriculture",
    group: "route",
    template: "AgricultureIndex",
  },
  {
    id: "22-agriculture-deep-dive",
    name: "Agriculture — Deep Dive",
    path: "/agriculture",
    group: "route",
    template: "AgricultureIndex",
    action: async (page) => {
      await page.getByRole("tab", { name: "Deep Dive", exact: true }).click();
    },
  },
  {
    id: "22b-agriculture-report-desk",
    name: "Agriculture — Report Desk",
    path: "/agriculture/reports",
    group: "route",
    template: "AgricultureReportDesk",
  },
  {
    id: "22c-bls-release-lens",
    name: "BLS Release Lens",
    path: "/bls",
    group: "route",
    template: "BlsReleaseLens",
  },
  { id: "23-energy", name: "Energy", path: "/energy", group: "route", template: "EnergyIndex" },
  {
    id: "24-real-estate-overview",
    name: "Real Estate — Housing & Overview",
    path: "/real-estate",
    group: "route",
    template: "RealEstateDiagnostic",
  },
  {
    id: "25-real-estate-commercial",
    name: "Real Estate — Commercial",
    path: "/real-estate",
    group: "route",
    template: "RealEstateDiagnostic",
    action: async (page) => {
      await page.getByRole("tab", { name: "Commercial Real Estate", exact: true }).click();
    },
  },
  {
    id: "27-secret-options-locked",
    name: "Secret Options — locked",
    path: "/secret/options",
    group: "protected",
    template: "SecretOptions",
  },
  {
    id: "28-not-found",
    name: "Not Found",
    path: "/does-not-exist",
    group: "error",
    template: "NotFoundPage",
  },
  {
    id: "29-desktop-tools-menu",
    name: "Desktop Tools navigation",
    path: "/",
    group: "navigation",
    template: "Topbar",
    only: "desktop",
    action: async (page) => {
      await page.getByRole("button", { name: "Tools", exact: true }).hover();
    },
  },
  {
    id: "30-mobile-navigation",
    name: "Mobile navigation",
    path: "/",
    group: "navigation",
    template: "Topbar",
    only: "mobile",
    action: async (page) => {
      await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
    },
  },
];

const indicatorTargets: AuditTarget[] = indicatorCodes.flatMap((code, index) => {
  const prefix = String(index + 31).padStart(2, "0");
  const base: AuditTarget = {
    id: `${prefix}-indicator-${code.toLowerCase().replaceAll("_", "-")}`,
    name: `Indicator Detail — ${code}`,
    path: `/indicators/${code}`,
    group: "indicator",
    template: "IndicatorDetail",
  };

  if (code !== "BOND_MARKET_STABILITY") {
    return [base];
  }

  return [
    base,
    {
      id: `${prefix}b-bond-forced-core`,
      name: "Bond Health route — Core Bond Stability",
      path: "/bond_health_stability",
      group: "indicator",
      template: "IndicatorDetail",
    },
    {
      id: `${prefix}c-bond-forced-public`,
      name: "Bond Health route — Public-sector credit",
      path: "/bond_health_stability",
      group: "indicator",
      template: "IndicatorDetail",
      action: async (page) => {
        await page.getByRole("button", { name: "Public-sector credit & funding stress", exact: true }).click();
      },
    },
    {
      id: `${prefix}d-bond-forced-yield`,
      name: "Bond Health route — Live Yield Curve",
      path: "/bond_health_stability",
      group: "indicator",
      template: "IndicatorDetail",
      action: async (page) => {
        await page.getByRole("button", { name: "Live Yield Curve", exact: true }).click();
      },
    },
  ];
});

const retiredLegacyTargets: AuditTarget[] = [
  {
    id: "legacy-aas-breakdown",
    name: "Retired AAS breakdown route",
    path: "/aas-breakdown",
    group: "legacy",
    template: "NotFound",
    supportStatus: "retired-legacy",
    replacements: ["/metals-indicators", "/crypto-indicators"],
  },
  {
    id: "legacy-aas-indicator",
    name: "Retired AAS indicator deep link",
    path: "/indicators/AAS",
    group: "legacy",
    template: "RetiredAssetDiagnostics",
    supportStatus: "retired-legacy",
    replacements: ["/metals-indicators", "/crypto-indicators"],
  },
];

const redirectPaths = [
  "/why-this-exists",
  "/tools/experiments",
  "/tools/weather-research",
  "/tools/updates",
  "/tools/updates/market-diagnostic-2026-07-27",
  "/precious-metals",
] as const;

const viewports: Array<{ name: ViewportName; width: number; height: number }> = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const requestedViewport = process.env.AUDIT_VIEWPORT as ViewportName | undefined;
const selectedViewports = requestedViewport
  ? viewports.filter((viewport) => viewport.name === requestedViewport)
  : viewports;
const targetFilter = process.env.AUDIT_TARGET_FILTER?.trim();
const targetLimit = Number.parseInt(process.env.AUDIT_LIMIT ?? "", 10);

const responseCache = new Map<
  string,
  { status: number; headers: Record<string, string>; body: Buffer }
>();

async function fetchRecapTargets(): Promise<AuditTarget[]> {
  const response = await fetch(`${LIVE_ORIGIN}/api/updates?limit=100&offset=0&skip_refresh=1`);
  if (!response.ok) {
    throw new Error(`Unable to enumerate recap permalinks: ${response.status}`);
  }
  const posts = (await response.json()) as Array<{ slug: string; title: string }>;
  return posts.map((post, index) => ({
    id: `recap-${String(index + 1).padStart(2, "0")}-${post.slug}`,
    name: `Recap — ${post.title}`,
    path: `/tools/recap/${post.slug}`,
    group: "recap",
    template: "RecapPost",
  }));
}

async function proxyLiveApi(route: Route) {
  const request = route.request();
  const localUrl = new URL(request.url());
  const upstreamUrl = new URL(`${localUrl.pathname}${localUrl.search}`, LIVE_ORIGIN).toString();

  if (request.method() !== "GET") {
    await route.abort("blockedbyclient");
    return;
  }

  const cached = responseCache.get(upstreamUrl);
  if (cached) {
    await route.fulfill(cached);
    return;
  }

  try {
    const response = await route.fetch({ url: upstreamUrl, timeout: 120_000 });
    const headers = { ...response.headers() };
    delete headers["content-encoding"];
    delete headers["content-length"];
    const body = await response.body();
    const payload = { status: response.status(), headers, body };
    responseCache.set(upstreamUrl, payload);
    await route.fulfill(payload);
  } catch {
    await route.abort("failed");
  }
}

async function waitForStableState(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const loadingStatuses = await page
      .locator('[role="status"]:visible')
      .allInnerTexts()
      .catch(() => []);
    if (!loadingStatuses.some((text) => /loading|forming|fetching|analyzing|building/i.test(text))) {
      break;
    }
    await page.waitForTimeout(1_000);
  }

  await page.waitForTimeout(600);
}

async function revealFullPage(page: Page, viewportHeight: number) {
  await page.evaluate(async (step) => {
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    let previousHeight = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      const height = document.documentElement.scrollHeight;
      for (let top = 0; top < height; top += step) {
        window.scrollTo({ top, behavior: "instant" });
        await sleep(80);
      }
      window.scrollTo({ top: height, behavior: "instant" });
      await sleep(150);
      if (height === previousHeight) break;
      previousHeight = height;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, Math.max(320, Math.floor(viewportHeight * 0.72)));

  await page.locator("img").evaluateAll(async (images) => {
    await Promise.all(
      images.map((image) => {
        const img = image as HTMLImageElement;
        return img.complete ? Promise.resolve() : img.decode().catch(() => undefined);
      }),
    );
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function inspectTargetSizes(page: Page) {
  return page
    .locator(
      'a:visible, button:visible, input:visible, select:visible, textarea:visible, summary:visible, [role="button"]:visible, [tabindex]:not([tabindex="-1"]):visible',
    )
    .evaluateAll((elements) => {
      const targets = elements
        .map((element) => {
          const control = element as HTMLInputElement;
          const usesLabelTarget =
            control.matches('input[type="checkbox"], input[type="radio"]') &&
            control.closest("label");
          const rect = (usesLabelTarget || element).getBoundingClientRect();
          const explicitPriority = element.matches(
            'input, select, textarea, .field-button, .field-icon-button, .topbar a, .topbar button, .section-nav-link, [data-touch-target="priority"]',
          );
          const coarsePointerControl =
            window.matchMedia("(any-pointer: coarse)").matches &&
            element.matches('button, summary, [role="button"]');
          const priority = explicitPriority || coarsePointerControl;
          return { rect, priority };
        })
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      return {
        under24: targets.filter(({ rect }) => rect.width < 24 || rect.height < 24).length,
        under44: targets.filter(({ rect }) => rect.width < 44 || rect.height < 44).length,
        priorityUnder44: targets.filter(
          ({ rect, priority }) => priority && (rect.width < 44 || rect.height < 44),
        ).length,
      };
    });
}

async function inspectOverflowElements(page: Page): Promise<OverflowElement[]> {
  return page.locator("body *").evaluateAll((elements) => {
    const viewportWidth = window.innerWidth;
    return elements
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const style = getComputedStyle(htmlElement);
        return {
          tag: htmlElement.tagName.toLowerCase(),
          className:
            typeof htmlElement.className === "string"
              ? htmlElement.className.replace(/\s+/g, " ").trim().slice(0, 240)
              : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          overflowBy: Math.round(Math.max(rect.right - viewportWidth, -rect.left, 0)),
          text: (htmlElement.innerText || htmlElement.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden",
        };
      })
      .filter((item) => item.visible && item.overflowBy > 1)
      .sort((a, b) => b.overflowBy - a.overflowBy)
      .slice(0, 40)
      .map(({ visible: _visible, ...item }) => item);
  });
}

async function inspectAxe(page: Page): Promise<AxeFinding[]> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  return result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodeCount: violation.nodes.length,
    targets: violation.nodes.flatMap((node) => node.target.map(String)).slice(0, 20),
  }));
}

function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return { width: 0, height: 0 };
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function runtimeContractFailures(record: AuditRecord): string[] {
  const failures: string[] = [];
  const h1Count = record.headings.filter((heading) => heading.level === 1).length;
  const unresolvedLoadingStates = record.visibleLoadingStatuses.filter((message) =>
    /loading|forming|fetching|analyzing|building|aligning/i.test(message),
  );

  if (!record.accepted) failures.push("capture was not accepted");
  if (!record.fullHeightVerified) failures.push("PNG did not cover the measured document height");
  if (record.horizontalOverflow !== 0) {
    failures.push(`page overflowed horizontally by ${record.horizontalOverflow}px`);
  }
  if (record.rootChildCount === 0) failures.push("application root was blank");
  if (record.mainCount !== 1) failures.push(`expected one main landmark, found ${record.mainCount}`);
  if (h1Count !== 1) failures.push(`expected one H1, found ${h1Count}`);
  if (!record.title.trim()) failures.push("document title was empty");
  if (record.imagesWithoutAlt !== 0) {
    failures.push(`${record.imagesWithoutAlt} image(s) lacked an alt attribute`);
  }
  if (record.unlabeledFormControls !== 0) {
    failures.push(`${record.unlabeledFormControls} form control(s) lacked a name`);
  }
  if (record.unfocusableScrollableRegions !== 0) {
    failures.push(`${record.unfocusableScrollableRegions} scroll region(s) were unfocusable`);
  }
  if (record.priorityTargetsUnder44 !== 0) {
    failures.push(`${record.priorityTargetsUnder44} priority touch target(s) were smaller than 44px`);
  }
  if (record.axeViolations.length !== 0) {
    failures.push(`${record.axeViolations.length} Axe violation(s) remained`);
  }
  if (record.consoleErrors.length !== 0) {
    failures.push(`${record.consoleErrors.length} console error(s) occurred`);
  }
  if (record.pageErrors.length !== 0) {
    failures.push(`${record.pageErrors.length} page error(s) occurred`);
  }
  if (record.requestFailures.length !== 0) {
    failures.push(`${record.requestFailures.length} request failure(s) occurred`);
  }
  if (unresolvedLoadingStates.length !== 0) {
    failures.push(`${unresolvedLoadingStates.length} loading state(s) did not resolve`);
  }

  return failures.map((failure) => `${record.id}: ${failure}`);
}

function legacyRouteContractFailures(records: AuditRecord[]): string[] {
  const failures: string[] = [];
  const expectedLegacyRoutes = [
    {
      id: "legacy-aas-breakdown",
      path: "/aas-breakdown",
      template: "NotFound",
      heading: "Page not found",
    },
    {
      id: "legacy-aas-indicator",
      path: "/indicators/AAS",
      template: "RetiredAssetDiagnostics",
      heading: "Asset diagnostics moved",
    },
  ] as const;

  for (const expected of expectedLegacyRoutes) {
    const record = records.find((candidate) => candidate.id === expected.id);
    if (!record) {
      failures.push(`${expected.id}: legacy route was not captured`);
      continue;
    }
    if (record.supportStatus !== "retired-legacy") {
      failures.push(`${expected.id}: route was not explicitly classified as retired legacy`);
    }
    if (record.requestedPath !== expected.path || record.template !== expected.template) {
      failures.push(`${expected.id}: route path or template drifted`);
    }
    if (new URL(record.finalUrl).pathname !== expected.path) {
      failures.push(`${expected.id}: legacy route unexpectedly redirected`);
    }
    if (!record.headings.some((heading) => heading.level === 1 && heading.text === expected.heading)) {
      failures.push(`${expected.id}: expected H1 "${expected.heading}" was not present`);
    }
    if (
      record.replacements?.join("|") !==
      ["/metals-indicators", "/crypto-indicators"].join("|")
    ) {
      failures.push(`${expected.id}: replacement routes were missing or changed`);
    }
  }

  return failures;
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120 * 60_000);

test("capture every route, state, indicator, and recap at full page height", async ({ browser }) => {
  await mkdir(SCREENSHOT_ROOT, { recursive: true });

  const recapTargets = await fetchRecapTargets();
  const allTargets = [
    ...baseTargets,
    ...indicatorTargets,
    ...retiredLegacyTargets,
    ...recapTargets,
  ];
  const filteredTargets = targetFilter
    ? allTargets.filter((target) =>
        `${target.id} ${target.name} ${target.path} ${target.template}`
          .toLowerCase()
          .includes(targetFilter.toLowerCase()),
      )
    : allTargets;
  const targets = Number.isFinite(targetLimit) && targetLimit > 0
    ? filteredTargets.slice(0, targetLimit)
    : filteredTargets;
  const redirects: Array<{ requestedPath: string; finalPath: string; title: string }> = [];

  await writeFile(
    path.join(AUDIT_ROOT, "coverage-manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "current route registry plus live recap index",
        theme: AUDIT_THEME,
        liveOrigin: LIVE_ORIGIN,
        targetCount: targets.length,
        supportedTargetCount: targets.filter(
          (target) => target.supportStatus !== "retired-legacy",
        ).length,
        retiredLegacyTargetCount: targets.filter(
          (target) => target.supportStatus === "retired-legacy",
        ).length,
        targets: targets.map(({ action: _action, ...target }) => target),
        redirectPaths,
        viewports,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  for (const viewport of selectedViewports) {
    const records: AuditRecord[] = [];
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "America/New_York",
      deviceScaleFactor: 1,
      hasTouch: viewport.name === "mobile",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.route("**/api/**", proxyLiveApi);
    let consoleErrors: string[] = [];
    let pageErrors: string[] = [];
    let requestFailures: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
    page.on("requestfailed", (request) => {
      if (!/google-analytics|googletagmanager/i.test(request.url())) {
        requestFailures.push(
          `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`,
        );
      }
    });

    for (const target of targets) {
      if (target.only && target.only !== viewport.name) continue;

      consoleErrors = [];
      pageErrors = [];
      requestFailures = [];
      const screenshotName = `${target.id}-${viewport.name}-full.png`;
      const screenshotPath = path.join(SCREENSHOT_ROOT, screenshotName);

      try {
        await page.goto(target.path, { waitUntil: "domcontentloaded", timeout: 120_000 });
        await page.addStyleTag({
          content:
            "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}",
        }).catch(() => undefined);
        await waitForStableState(page);
        await page.keyboard.press("Escape");
        if (target.action) {
          await target.action(page);
          await waitForStableState(page);
        }
        await revealFullPage(page, viewport.height);

        const [
          appliedTheme,
          title,
          headings,
          shell,
          geometry,
          overflowElements,
          targetSizes,
          visibleLoadingStatuses,
          axeViolations,
          images,
          controls,
          scrollable,
          performance,
        ] = await Promise.all([
          page.evaluate(() => document.documentElement.dataset.theme ?? ""),
          page.title(),
          page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((elements) =>
            elements.map((element) => ({
              level: Number(element.tagName.slice(1)),
              text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
            })),
          ),
          page.evaluate(() => ({
            mainCount: document.querySelectorAll("main").length,
            navCount: document.querySelectorAll("nav").length,
            rootChildCount: document.querySelector("#root")?.childElementCount ?? 0,
            bodyTextLength: document.body.innerText.length,
            domNodeCount: document.querySelectorAll("*").length,
          })),
          page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            documentHeight: document.documentElement.scrollHeight,
            horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          })),
          inspectOverflowElements(page),
          inspectTargetSizes(page),
          page.locator('[role="status"]:visible').allInnerTexts(),
          inspectAxe(page),
          page.locator("img").evaluateAll((elements) => ({
            count: elements.length,
            withoutAlt: elements.filter((element) => !element.hasAttribute("alt")).length,
          })),
          page.locator("input, select, textarea").evaluateAll((elements) => ({
            count: elements.length,
            unlabeled: elements.filter((element) => {
              const control = element as HTMLInputElement;
              if (control.type === "hidden") return false;
              if (control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) return false;
              if (control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`)) return false;
              return !control.closest("label");
            }).length,
          })),
          page.evaluate(() => {
            const regions = Array.from(document.querySelectorAll<HTMLElement>("*"))
              .filter((element) => {
                const style = getComputedStyle(element);
                const scrollsX =
                  /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
                const scrollsY =
                  /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
                return scrollsX || scrollsY;
              });
            return {
              count: regions.length,
              unfocusable: regions.filter((element) => {
                if (element.tabIndex >= 0) return false;
                const role = element.getAttribute("role");
                return !["region", "listbox", "tree", "grid", "table"].includes(role ?? "");
              }).length,
            };
          }),
          page.evaluate(() => {
            const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
            return {
              resourceCount: resources.length,
              transferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
              scriptTransferBytes: resources
                .filter((entry) => entry.initiatorType === "script")
                .reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
            };
          }),
        ]);

        const screenshotBuffer = await page.screenshot({
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          timeout: 120_000,
        });
        await writeFile(screenshotPath, screenshotBuffer);
        const screenshotSize = readPngDimensions(screenshotBuffer);
        const fullHeightVerified =
          screenshotSize.width >= viewport.width &&
          screenshotSize.height >= geometry.documentHeight - 2;
        const accepted =
          fullHeightVerified &&
          shell.rootChildCount > 0 &&
          shell.bodyTextLength >= 40 &&
          appliedTheme === AUDIT_THEME;

        records.push({
          id: target.id,
          name: target.name,
          group: target.group,
          template: target.template,
          requestedPath: target.path,
          supportStatus: target.supportStatus ?? "supported",
          replacements: target.replacements,
          viewport: viewport.name,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          requestedTheme: AUDIT_THEME,
          appliedTheme,
          screenshot: path.relative(AUDIT_ROOT, screenshotPath).replaceAll("\\", "/"),
          screenshotWidth: screenshotSize.width,
          screenshotHeight: screenshotSize.height,
          finalUrl: page.url(),
          title,
          headings,
          mainCount: shell.mainCount,
          navCount: shell.navCount,
          rootChildCount: shell.rootChildCount,
          bodyTextLength: shell.bodyTextLength,
          documentWidth: geometry.documentWidth,
          documentHeight: geometry.documentHeight,
          horizontalOverflow: geometry.horizontalOverflow,
          overflowElements,
          fullHeightVerified,
          accepted,
          domNodeCount: shell.domNodeCount,
          resourceCount: performance.resourceCount,
          transferBytes: performance.transferBytes,
          scriptTransferBytes: performance.scriptTransferBytes,
          imageCount: images.count,
          imagesWithoutAlt: images.withoutAlt,
          formControls: controls.count,
          unlabeledFormControls: controls.unlabeled,
          scrollableRegions: scrollable.count,
          unfocusableScrollableRegions: scrollable.unfocusable,
          smallTargetsUnder24: targetSizes.under24,
          smallTargetsUnder44: targetSizes.under44,
          priorityTargetsUnder44: targetSizes.priorityUnder44,
          visibleLoadingStatuses,
          consoleErrors: unique(consoleErrors),
          pageErrors: unique(pageErrors),
          requestFailures: unique(requestFailures),
          axeViolations,
          blocker:
            target.supportStatus === "retired-legacy" || accepted
              ? undefined
              : "Capture failed acceptance: blank/crashed root, too little content, or PNG did not cover measured document height.",
          note:
            target.supportStatus === "retired-legacy"
              ? `Retired legacy route retained as cleanup evidence; replacement surfaces: ${target.replacements?.join(", ")}.`
              : undefined,
        });
      } catch (error) {
        const screenshotBuffer = await page
          .screenshot({ fullPage: true, animations: "disabled", caret: "hide", timeout: 120_000 })
          .catch(() => null);
        if (screenshotBuffer) await writeFile(screenshotPath, screenshotBuffer);
        const screenshotSize = screenshotBuffer
          ? readPngDimensions(screenshotBuffer)
          : { width: 0, height: 0 };

        records.push({
          id: target.id,
          name: target.name,
          group: target.group,
          template: target.template,
          requestedPath: target.path,
          supportStatus: target.supportStatus ?? "supported",
          replacements: target.replacements,
          viewport: viewport.name,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          requestedTheme: AUDIT_THEME,
          appliedTheme: await page
            .evaluate(() => document.documentElement.dataset.theme ?? "")
            .catch(() => ""),
          screenshot: path.relative(AUDIT_ROOT, screenshotPath).replaceAll("\\", "/"),
          screenshotWidth: screenshotSize.width,
          screenshotHeight: screenshotSize.height,
          finalUrl: page.url(),
          title: await page.title().catch(() => ""),
          headings: [],
          mainCount: 0,
          navCount: 0,
          rootChildCount: 0,
          bodyTextLength: 0,
          documentWidth: 0,
          documentHeight: 0,
          horizontalOverflow: 0,
          fullHeightVerified: false,
          accepted: false,
          domNodeCount: 0,
          resourceCount: 0,
          transferBytes: 0,
          scriptTransferBytes: 0,
          imageCount: 0,
          imagesWithoutAlt: 0,
          formControls: 0,
          unlabeledFormControls: 0,
          scrollableRegions: 0,
          unfocusableScrollableRegions: 0,
          smallTargetsUnder24: 0,
          smallTargetsUnder44: 0,
          priorityTargetsUnder44: 0,
          visibleLoadingStatuses: [],
          consoleErrors: unique(consoleErrors),
          pageErrors: unique(pageErrors),
          requestFailures: unique(requestFailures),
          axeViolations: [],
          blocker:
            target.supportStatus === "retired-legacy"
              ? undefined
              : error instanceof Error
                ? error.stack ?? error.message
                : String(error),
          note:
            target.supportStatus === "retired-legacy"
              ? `Retired legacy route retained as cleanup evidence; replacement surfaces: ${target.replacements?.join(", ")}.`
              : undefined,
        });
      }
    }

    if (viewport.name === "desktop") {
      for (const requestedPath of redirectPaths) {
        await page.goto(requestedPath, { waitUntil: "domcontentloaded", timeout: 120_000 });
        await page.waitForTimeout(300);
        redirects.push({
          requestedPath,
          finalPath: new URL(page.url()).pathname,
          title: await page.title(),
        });
      }
    }

    await context.close();

    await writeFile(
      path.join(AUDIT_ROOT, `runtime-audit-${viewport.name}.json`),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: AUDIT_SOURCE,
          liveOrigin: LIVE_ORIGIN,
          viewport,
          targetCount: targets.filter((target) => !target.only || target.only === viewport.name).length,
          supportedTargetCount: targets.filter(
            (target) =>
              (!target.only || target.only === viewport.name) &&
              target.supportStatus !== "retired-legacy",
          ).length,
          retiredLegacyTargetCount: targets.filter(
            (target) =>
              (!target.only || target.only === viewport.name) &&
              target.supportStatus === "retired-legacy",
          ).length,
          records,
          redirects,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const expectedRecords = targets.filter(
      (target) => !target.only || target.only === viewport.name,
    );
    const coverageFailures: string[] = [];
    if (records.length !== expectedRecords.length) {
      coverageFailures.push(
        `expected ${expectedRecords.length} route records, received ${records.length}`,
      );
    }
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      coverageFailures.push("route record IDs were not unique");
    }
    const isCompleteAudit =
      !targetFilter && !(Number.isFinite(targetLimit) && targetLimit > 0);
    if (isCompleteAudit) {
      for (const replacementPath of ["/metals-indicators", "/crypto-indicators"]) {
        if (
          !records.some(
            (record) =>
              record.supportStatus === "supported" &&
              record.requestedPath === replacementPath &&
              record.accepted,
          )
        ) {
          coverageFailures.push(`${replacementPath}: supported replacement route was not accepted`);
        }
      }
    }

    const redirectFailures =
      isCompleteAudit && viewport.name === "desktop"
        ? [
            ["/why-this-exists", "/vision"],
            ["/tools/experiments", "/tools/recap"],
            ["/tools/weather-research", "/tools/recap"],
            ["/tools/updates", "/tools/recap"],
            [
              "/tools/updates/market-diagnostic-2026-07-27",
              "/tools/recap/market-diagnostic-2026-07-27",
            ],
            ["/precious-metals", "/metals-indicators"],
          ].flatMap(([requestedPath, expectedPath]) => {
            const redirect = redirects.find((candidate) => candidate.requestedPath === requestedPath);
            return redirect?.finalPath === expectedPath
              ? []
              : [`${requestedPath}: expected redirect to ${expectedPath}`];
          })
        : [];

    const contractFailures = records.flatMap(runtimeContractFailures);
    const legacyFailures = isCompleteAudit ? legacyRouteContractFailures(records) : [];
    const failures = [
      ...coverageFailures,
      ...redirectFailures,
      ...contractFailures,
      ...legacyFailures,
    ];
    expect(
      failures,
      `Full-site ${viewport.name} audit contract failed:\n${failures.join("\n")}`,
    ).toEqual([]);
  }
});
