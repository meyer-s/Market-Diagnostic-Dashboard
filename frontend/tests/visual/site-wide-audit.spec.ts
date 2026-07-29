import AxeBuilder from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const AUDIT_DATE = "2026-07-29";
const AUDIT_ROOT = path.resolve(process.cwd(), "..", "artifacts", "site-audit", AUDIT_DATE);
const SCREENSHOT_ROOT = path.join(AUDIT_ROOT, "screenshots");
const LIVE_ORIGIN = "https://marketdiagnostictool.com";

type ViewportName = "desktop" | "mobile";

type AuditTarget = {
  id: string;
  name: string;
  path: string;
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

type AuditRecord = {
  id: string;
  name: string;
  requestedPath: string;
  viewport: ViewportName;
  width: number;
  height: number;
  screenshot: string;
  finalUrl: string;
  title: string;
  headings: Array<{ level: number; text: string }>;
  mainCount: number;
  navCount: number;
  bodyTextLength: number;
  documentHeight: number;
  horizontalOverflow: number;
  smallTargetsUnder24: number;
  smallTargetsUnder44: number;
  visibleLoadingStatuses: string[];
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  axeViolations: AxeFinding[];
  blocker?: string;
};

const targets: AuditTarget[] = [
  { id: "01-dashboard", name: "Dashboard", path: "/" },
  {
    id: "02-desktop-tools-menu",
    name: "Desktop tools navigation",
    path: "/",
    only: "desktop",
    action: async (page) => {
      await page.getByRole("button", { name: "Tools" }).hover();
    },
  },
  {
    id: "03-mobile-navigation",
    name: "Mobile navigation",
    path: "/",
    only: "mobile",
    action: async (page) => {
      await page.getByRole("button", { name: "Open navigation menu" }).click();
    },
  },
  { id: "04-vision", name: "Vision", path: "/vision" },
  { id: "05-system-breakdown", name: "System Breakdown", path: "/system-breakdown" },
  { id: "06-indicators", name: "Indicator Library", path: "/indicators" },
  { id: "07-indicator-vix", name: "Indicator Detail — VIX", path: "/indicators/VIX" },
  {
    id: "08-bond-health",
    name: "Bond Market Stability",
    path: "/bond_health_stability",
  },
  { id: "09-news", name: "Market News", path: "/news" },
  { id: "10-market-map", name: "Market Map", path: "/market-map" },
  { id: "11-sector-projections", name: "Sector Projections", path: "/sector-projections" },
  { id: "12-stock-analysis", name: "Stock Analysis — SPY", path: "/stock-analysis/SPY" },
  { id: "13-institutional-flow", name: "Institutional Flow", path: "/institutional-flow" },
  {
    id: "14-market-weather-single",
    name: "Market Field — Single Instrument",
    path: "/market-weather?symbol=SPY&timeframe=1D&bars=365",
  },
  {
    id: "15-market-weather-pair",
    name: "Market Field — Relative Pair",
    path: "/market-weather?symbol=SPY&comparison=pair&compare=QQQ&timeframe=1D&bars=120&pair_tab=overview",
  },
  { id: "16-recap-index", name: "Recap Index", path: "/tools/recap" },
  {
    id: "17-recap-post",
    name: "Recap Post",
    path: "/tools/recap/market-diagnostic-2026-07-27",
  },
  {
    id: "18-volume-breadth",
    name: "Volume & Breadth",
    path: "/tools/volume-breadth",
  },
  { id: "19-metals", name: "Precious Metals", path: "/metals-indicators" },
  { id: "20-crypto", name: "Crypto", path: "/crypto-indicators" },
  { id: "21-agriculture", name: "Agriculture", path: "/agriculture" },
  { id: "22-energy", name: "Energy", path: "/energy" },
  { id: "23-real-estate", name: "Real Estate", path: "/real-estate" },
  { id: "24-secret-options", name: "Secret Options — Locked", path: "/secret/options" },
  { id: "25-not-found", name: "Not Found", path: "/does-not-exist" },
];

const allViewports: Array<{ name: ViewportName; width: number; height: number }> = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const requestedViewport = process.env.AUDIT_VIEWPORT as ViewportName | undefined;
const viewports = requestedViewport
  ? allViewports.filter((viewport) => viewport.name === requestedViewport)
  : allViewports;

const redirectPaths = [
  "/why-this-exists",
  "/tools/experiments",
  "/tools/weather-research",
  "/tools/updates",
  "/tools/updates/market-diagnostic-2026-07-27",
  "/precious-metals",
] as const;

async function proxyLiveApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const localUrl = new URL(request.url());
    const upstreamUrl = new URL(`${localUrl.pathname}${localUrl.search}`, LIVE_ORIGIN).toString();

    try {
      const response = await route.fetch({
        url: upstreamUrl,
        timeout: 120_000,
      });
      await route.fulfill({ response });
    } catch {
      await route.abort("failed");
    }
  });
}

async function waitForStableState(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const loadingStatuses = await page
      .locator('[role="status"]:visible')
      .allInnerTexts()
      .catch(() => []);
    if (!loadingStatuses.some((text) => /loading|forming|fetching/i.test(text))) {
      break;
    }
    await page.waitForTimeout(750);
  }

  await page.waitForTimeout(800);
}

async function waitForLoadingToClear(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loadingStatuses = await page
      .locator('[role="status"]:visible')
      .allInnerTexts()
      .catch(() => []);
    if (!loadingStatuses.some((text) => /loading|forming|fetching|analyzing/i.test(text))) {
      return;
    }
    await page.waitForTimeout(1_000);
  }
}

async function inspectTargetSizes(page: Page) {
  return page
    .locator(
      'a:visible, button:visible, input:visible, select:visible, textarea:visible, summary:visible, [role="button"]:visible, [tabindex]:not([tabindex="-1"]):visible',
    )
    .evaluateAll((elements) => {
      const rects = elements
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      return {
        under24: rects.filter((rect) => rect.width < 24 || rect.height < 24).length,
        under44: rects.filter((rect) => rect.width < 44 || rect.height < 44).length,
      };
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
    targets: violation.nodes
      .flatMap((node) => node.target.map(String))
      .slice(0, 12),
  }));
}

test.describe.configure({ mode: "serial" });
test.setTimeout(30 * 60_000);

test("capture and inspect every registered site surface", async ({ browser }) => {
  await mkdir(SCREENSHOT_ROOT, { recursive: true });

  const records: AuditRecord[] = [];
  const redirectResults: Array<{ requestedPath: string; finalPath: string }> = [];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "dark",
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await context.newPage();
    await proxyLiveApi(page);

    let consoleErrors: string[] = [];
    let pageErrors: string[] = [];
    let requestFailures: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    page.on("requestfailed", (request) => {
      if (!/google-analytics|googletagmanager/i.test(request.url())) {
        requestFailures.push(
          `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`,
        );
      }
    });

    for (const target of targets) {
      if (target.only && target.only !== viewport.name) {
        continue;
      }

      consoleErrors = [];
      pageErrors = [];
      requestFailures = [];
      const screenshotName = `${target.id}-${viewport.name}.png`;
      const screenshotPath = path.join(SCREENSHOT_ROOT, screenshotName);

      try {
        await page.goto(target.path, {
          waitUntil: "domcontentloaded",
          timeout: 120_000,
        });
        await waitForStableState(page);
        await page.keyboard.press("Escape");
        await page.mouse.move(18, Math.min(320, viewport.height - 18));
        await page.waitForTimeout(150);
        if (target.id === "12-stock-analysis" || target.id === "22-energy") {
          await waitForLoadingToClear(page, 75_000);
        }
        if (target.action) {
          await target.action(page);
          await page.waitForTimeout(400);
        }

        const [
          title,
          headings,
          mainCount,
          navCount,
          bodyTextLength,
          geometry,
          targetSizes,
          visibleLoadingStatuses,
          axeViolations,
        ] = await Promise.all([
          page.title(),
          page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((elements) =>
            elements.map((element) => ({
              level: Number(element.tagName.slice(1)),
              text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
            })),
          ),
          page.locator("main").count(),
          page.locator("nav").count(),
          page.locator("body").innerText().then((text) => text.length),
          page.evaluate(() => ({
            documentHeight: document.documentElement.scrollHeight,
            horizontalOverflow: Math.max(
              0,
              document.documentElement.scrollWidth - window.innerWidth,
            ),
          })),
          inspectTargetSizes(page),
          page.locator('[role="status"]:visible').allInnerTexts(),
          inspectAxe(page),
        ]);

        await page.screenshot({
          path: screenshotPath,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });

        records.push({
          id: target.id,
          name: target.name,
          requestedPath: target.path,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          screenshot: path.relative(AUDIT_ROOT, screenshotPath).replaceAll("\\", "/"),
          finalUrl: page.url(),
          title,
          headings,
          mainCount,
          navCount,
          bodyTextLength,
          documentHeight: geometry.documentHeight,
          horizontalOverflow: geometry.horizontalOverflow,
          smallTargetsUnder24: targetSizes.under24,
          smallTargetsUnder44: targetSizes.under44,
          visibleLoadingStatuses,
          consoleErrors: [...new Set(consoleErrors)],
          pageErrors: [...new Set(pageErrors)],
          requestFailures: [...new Set(requestFailures)],
          axeViolations,
        });
      } catch (error) {
        await page
          .screenshot({
            path: screenshotPath,
            fullPage: false,
            animations: "disabled",
            caret: "hide",
          })
          .catch(() => undefined);

        records.push({
          id: target.id,
          name: target.name,
          requestedPath: target.path,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          screenshot: path.relative(AUDIT_ROOT, screenshotPath).replaceAll("\\", "/"),
          finalUrl: page.url(),
          title: await page.title().catch(() => ""),
          headings: [],
          mainCount: 0,
          navCount: 0,
          bodyTextLength: 0,
          documentHeight: 0,
          horizontalOverflow: 0,
          smallTargetsUnder24: 0,
          smallTargetsUnder44: 0,
          visibleLoadingStatuses: [],
          consoleErrors: [...new Set(consoleErrors)],
          pageErrors: [...new Set(pageErrors)],
          requestFailures: [...new Set(requestFailures)],
          axeViolations: [],
          blocker: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (viewport.name === "desktop") {
      for (const requestedPath of redirectPaths) {
        await page.goto(requestedPath, {
          waitUntil: "domcontentloaded",
          timeout: 120_000,
        });
        await page.waitForTimeout(300);
        redirectResults.push({
          requestedPath,
          finalPath: new URL(page.url()).pathname,
        });
      }
    }

    await context.close();
  }

  await writeFile(
    path.join(
      AUDIT_ROOT,
      requestedViewport ? `runtime-audit-${requestedViewport}.json` : "runtime-audit.json",
    ),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "current local frontend build with read-only production API proxy",
        liveOrigin: LIVE_ORIGIN,
        viewports,
        records,
        redirects: redirectResults,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
