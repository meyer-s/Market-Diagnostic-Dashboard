import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const AUDIT_DATE = process.env.AUDIT_RUN_ID ?? "2026-07-29-full";
const AUDIT_ROOT = path.resolve(process.cwd(), "..", "artifacts", "site-audit", AUDIT_DATE);
const SCREENSHOT_ROOT = path.join(AUDIT_ROOT, "state-screenshots");
const LIVE_ORIGIN = process.env.AUDIT_ORIGIN ?? "https://marketdiagnostictool.com";
const RUNTIME_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const AUDIT_THEME = "evidence" as const;
const AUDIT_SOURCE =
  new URL(RUNTIME_ORIGIN).origin === new URL(LIVE_ORIGIN).origin
    ? "deployed production interaction-state captures with read-only request enforcement"
    : "fresh local Vite interaction-state captures with read-only production API proxy";

type ViewportName = "desktop" | "mobile";
type SecretFixture = "reject" | "read" | "write";

type StateTarget = {
  id: string;
  name: string;
  path: string;
  only?: ViewportName;
  fixture?: SecretFixture;
  action?: (page: Page, viewport: ViewportName) => Promise<void>;
};

type StateRecord = {
  id: string;
  name: string;
  requestedPath: string;
  viewport: ViewportName;
  requestedTheme: string;
  appliedTheme: string;
  finalUrl: string;
  screenshot: string;
  screenshotWidth: number;
  screenshotHeight: number;
  documentWidth: number;
  documentHeight: number;
  horizontalOverflow: number;
  bodyTextLength: number;
  fullHeightVerified: boolean;
  accepted: boolean;
  headings: Array<{ level: number; text: string }>;
  visibleDialogs: string[];
  expandedControls: number;
  pressedControls: number;
  selectedTabs: number;
  priorityTargetsUnder44: number;
  axeViolations: Array<{
    id: string;
    impact: string | null;
    help: string;
    nodeCount: number;
    targets: string[];
  }>;
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  expectedConsoleErrors: string[];
  expectedRequestFailures: string[];
  blocker?: string;
};

const weatherPath = (extra: string) =>
  `/market-weather?symbol=SPY&timeframe=1D&bars=365&${extra}`;

const pairPath = (extra: string) =>
  `/market-weather?symbol=SPY&comparison=pair&compare=QQQ&timeframe=1D&bars=120&${extra}`;

async function selectInstitutionalGroup(page: Page, heading: string) {
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .first();
  await section.getByRole("button").first().click();
}

async function unlockSecretWorkspace(page: Page, scope: "read" | "write") {
  await page.getByLabel("Bearer credential").fill(`audit-${scope}-credential`);
  await page.getByRole("button", { name: "Unlock session", exact: true }).click();
  if (scope === "read") {
    await page.getByText(/Read-only session:/).waitFor({ state: "visible" });
  } else {
    await page
      .getByRole("button", { name: /Add(?: Trade)?$/ })
      .first()
      .waitFor({ state: "visible" });
  }
}

const stateTargets: StateTarget[] = [
  {
    id: "state-02-dashboard-1yr",
    name: "Dashboard — 1 year trend window",
    path: "/",
    action: async (page) => {
      await page.getByRole("button", { name: "1yr", exact: true }).click();
    },
  },
  {
    id: "state-03-vision-current-state",
    name: "Vision — Current State highlight",
    path: "/vision",
    action: async (page) => {
      await page.getByRole("button", { name: /An operational research system, continuously improved/i }).click();
    },
  },
  {
    id: "state-04-vision-longer-view",
    name: "Vision — Longer View highlight",
    path: "/vision",
    action: async (page) => {
      await page.getByRole("button", { name: /Keep strengthening the analytical contract/i }).click();
    },
  },
  {
    id: "state-04b-vision-architecture-modal",
    name: "Vision — Architecture Constellation modal",
    path: "/vision",
    action: async (page) => {
      await page.getByRole("button", { name: "Open interactive constellation" }).click();
      await page.getByRole("dialog", { name: "Architecture Constellation" }).waitFor();
      const graph = page.frameLocator('iframe[title="Interactive architecture constellation"]');
      await expect(graph.getByRole("button", { name: "Sphere" })).toBeVisible();
      await expect(graph.getByRole("button", { name: "Neighborhood" })).toBeVisible();
      await expect(graph.getByRole("button", { name: "Hygiene" })).toBeHidden();
    },
  },
  {
    id: "state-05-system-breakdown-disclosures",
    name: "System Breakdown — methodology, weights, and composite details expanded",
    path: "/system-breakdown",
    action: async (page) => {
      await page.getByRole("button", { name: /Composite Score Calculation/i }).click();
      await page.getByRole("button", { name: /Indicator Weights & Configuration/i }).click();
      const composite = page
        .locator('[aria-expanded="false"]')
        .filter({ hasText: "Bond Market Stability" })
        .first();
      if (await composite.count()) await composite.click();
    },
  },
  {
    id: "state-06-indicator-framework-expanded",
    name: "Indicator Detail — framework description expanded",
    path: "/indicators/VIX",
    action: async (page) => {
      await page.getByRole("button", { name: /Indicator Framework/i }).click();
    },
  },
  {
    id: "state-07-news-filter-cache-collapsed",
    name: "News — 24 hour ticker filter with cache editor collapsed",
    path: "/news",
    action: async (page) => {
      await page.getByRole("button", { name: "24h", exact: true }).click();
      const tickerSelect = page.getByRole("combobox").first();
      if ((await tickerSelect.locator("option").count()) > 1) {
        await tickerSelect.selectOption({ index: 1 });
      }
      const closeTickerEditor = page.getByRole("button", {
        name: "Close ticker editor",
        exact: true,
      });
      if (await closeTickerEditor.count()) {
        await closeTickerEditor.click();
      }
    },
  },
  {
    id: "state-08-sector-controls-methodology",
    name: "Sector Projections — alternate lens, 3M input, selected sector, and methodology",
    path: "/sector-projections",
    action: async (page, viewport) => {
      const oscillator = page
        .getByRole("heading", { name: "Sector Leadership Oscillator", exact: true })
        .locator("xpath=ancestor::div[contains(@class,'surface-card-strong')][1]");
      const lenses = oscillator.locator('button[aria-pressed]');
      if ((await lenses.count()) > 1) await lenses.last().click();
      await page.getByRole("button", { name: "3M input", exact: true }).click();
      const xlk = page.getByRole("button", { name: "XLK", exact: true });
      if (await xlk.count()) await xlk.first().click();
      if (viewport === "mobile") {
        const firstCard = page
          .locator('button[aria-expanded="false"]')
          .filter({ hasText: /^#\d+/ })
          .first();
        if (await firstCard.count()) await firstCard.click();
      }
      await page.getByRole("button", { name: /Methodology & Algorithm Details/i }).click();
    },
  },
  {
    id: "state-09-stock-now-max-5y-methodology",
    name: "Stock Analysis — Now horizon, Max price history, 5Y fundamentals, methodology",
    path: "/stock-analysis/SPY",
    action: async (page) => {
      await page.getByRole("button", { name: "Now", exact: true }).click();
      const priceCard = page
        .getByRole("heading", { name: "Price History", exact: true })
        .locator("xpath=ancestor::div[contains(@class,'surface-card-strong')][1]");
      await priceCard.getByRole("button", { name: "Max", exact: true }).click();
      const fundamentalCard = page
        .getByRole("heading", { name: "Fundamental Analysis", exact: true })
        .locator("xpath=ancestor::div[contains(@class,'surface-card-strong')][1]");
      if (await fundamentalCard.count()) {
        await fundamentalCard.getByRole("button", { name: "5Y", exact: true }).click();
      }
      await page.getByRole("button", { name: /Methodology & Scoring Details/i }).click();
    },
  },
  {
    id: "state-10-flow-sectors",
    name: "Institutional Flow — sector focus",
    path: "/institutional-flow",
    action: async (page) => selectInstitutionalGroup(page, "Sectors"),
  },
  {
    id: "state-12-flow-crypto",
    name: "Institutional Flow — crypto focus",
    path: "/institutional-flow",
    action: async (page) => selectInstitutionalGroup(page, "Crypto"),
  },
  {
    id: "state-14-weather-topographic",
    name: "Market Weather — topographic field mode",
    path: weatherPath("mode=topographic&view=now"),
  },
  {
    id: "state-16-weather-inspector",
    name: "Market Weather — inspector field mode",
    path: weatherPath("mode=inspector&channel=information&view=now"),
  },
  {
    id: "state-17-weather-timeline-context-all",
    name: "Market Weather — context timeline over all history",
    path: weatherPath("view=now&timeline_lens=context&timeline_window=all"),
  },
  {
    id: "state-18-weather-settings-dialog",
    name: "Market Weather — field settings dialog",
    path: weatherPath("mode=regime&view=now"),
    action: async (page, viewport) => {
      if (viewport === "mobile") {
        await page
          .getByRole("button", { name: "Change analysis inputs", exact: true })
          .click();
      }
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("dialog", { name: "Field settings" }).waitFor({ state: "visible" });
    },
  },
  {
    id: "state-19-weather-raw-data-expanded",
    name: "Market Weather — raw data and provenance expanded",
    path: weatherPath("mode=regime&view=now"),
    action: async (page) => {
      await page
        .locator("summary")
        .filter({ hasText: "Horizon field, outcomes, and provenance" })
        .click();
    },
  },
  {
    id: "state-20-weather-mobile-inputs",
    name: "Market Weather — mobile analysis inputs expanded",
    path: weatherPath("mode=regime&view=now"),
    only: "mobile",
    action: async (page) => {
      await page.getByRole("button", { name: "Change analysis inputs", exact: true }).click();
    },
  },
  {
    id: "state-21-weather-pair-alternate-lens",
    name: "Market Weather Pair — native target lens, alternate coordinate and full shared trail",
    path: pairPath(
      "pair_tab=field&basis=native&comparison_view=target&comparison_dimension=liquidity_stress_carrier&scope_trail=full&scope_scale=shared&coordinate_order=largest",
    ),
  },
  {
    id: "state-22-weather-pair-all-coordinates",
    name: "Market Weather Pair — all coordinates disclosed",
    path: pairPath("pair_tab=field"),
    action: async (page) => {
      await page.getByRole("button", { name: /Show all \d+ coordinates/i }).click();
    },
  },
  {
    id: "state-23-weather-pair-mobile-coordinate-sheet",
    name: "Market Weather Pair — mobile coordinate detail sheet",
    path: pairPath("pair_tab=field"),
    only: "mobile",
    action: async (page) => {
      await page.getByRole("button", { name: /Show all \d+ coordinates/i }).click();
      const coordinateButtons = page.locator("#pair-coordinate-explorer-list button");
      await coordinateButtons.nth(Math.min(3, Math.max(0, (await coordinateButtons.count()) - 1))).click();
      await page.getByRole("button", { name: "Close coordinate detail" }).waitFor({ state: "visible" });
    },
  },
  {
    id: "state-24-recap-no-results",
    name: "Recap Index — no search results",
    path: "/tools/recap",
    action: async (page) => {
      await page.getByRole("searchbox", { name: "Search recap posts" }).fill("__AUDIT_NO_MATCH_20260729__");
      await page.getByText("No recap posts match the current filters.").waitFor({ state: "visible" });
    },
  },
  {
    id: "state-26-volume-breadth-1yr",
    name: "Volume & Breadth — 1 year trend",
    path: "/tools/volume-breadth",
    action: async (page) => {
      await page
        .getByText("Loading breadth data...", { exact: true })
        .waitFor({ state: "hidden", timeout: 120_000 });
      await page.getByRole("button", { name: "1yr", exact: true }).click();
    },
  },
  {
    id: "state-28-metals-futures-methodology",
    name: "Precious Metals — alternate futures curve and methodology disclosure",
    path: "/metals-indicators",
    action: async (page) => {
      await page.getByRole("tab", { name: "Deep Dive", exact: true }).click();
      const silver = page.getByRole("button", { name: "Silver", exact: true });
      if (await silver.count()) await silver.click();
      const logPrice = page.getByRole("button", { name: "Log Price", exact: true });
      if (await logPrice.count()) await logPrice.click();
      await page.getByRole("button", { name: "Technical Scoring Algorithm", exact: true }).click();
    },
  },
  {
    id: "state-29-crypto-deep-dive",
    name: "Crypto — deep dive",
    path: "/crypto-indicators",
    action: async (page) => {
      await page.getByRole("tab", { name: "Deep Dive", exact: true }).click();
    },
  },
  {
    id: "state-30-crypto-365d",
    name: "Crypto — 365 day price structure",
    path: "/crypto-indicators",
    action: async (page) => {
      await page.getByRole("button", { name: "365D", exact: true }).click();
    },
  },
  {
    id: "state-31-agriculture-30y",
    name: "Agriculture — 30 year monthly stability view",
    path: "/agriculture",
    action: async (page) => {
      await page.getByRole("button", { name: "30y", exact: true }).click();
    },
  },
  {
    id: "state-32-energy-90d-methodology",
    name: "Energy — 90 day view with methodology expanded",
    path: "/energy",
    action: async (page) => {
      await page.getByRole("button", { name: "90D", exact: true }).click();
      await page.getByRole("button", { name: /Methodology & Scoring/i }).click();
      await page.getByRole("button", { name: "What the Composite Measures", exact: true }).click();
    },
  },
  {
    id: "state-33-real-estate-90d-30y-methodology",
    name: "Real Estate — 90 day tape, 30 year context, and methodology",
    path: "/real-estate",
    action: async (page) => {
      await page.getByRole("button", { name: "90D", exact: true }).click();
      const residentialWindow = page.getByRole("group", { name: "Residential longer-horizon window" });
      await residentialWindow.getByRole("button", { name: "30Y", exact: true }).click();
      await page.getByRole("button", { name: /Methodology & Scoring/i }).click();
      await page.getByRole("button", { name: "What the Composite Measures", exact: true }).click();
    },
  },
  {
    id: "state-34-real-estate-commercial-alternate",
    name: "Real Estate — alternate commercial property type and 30 year context",
    path: "/real-estate",
    action: async (page) => {
      await page.getByRole("tab", { name: "Commercial Real Estate", exact: true }).click();
      const propertyTabs = page.getByRole("tablist", { name: "Commercial property type context" });
      await propertyTabs.waitFor({ state: "visible", timeout: 120_000 });
      const tabs = propertyTabs.getByRole("tab");
      if ((await tabs.count()) > 1) await tabs.last().click();
      const commercialWindow = page.getByRole("group", {
        name: "Commercial longer-horizon window",
      });
      await commercialWindow.waitFor({ state: "visible", timeout: 120_000 });
      await commercialWindow.getByRole("button", { name: "30Y", exact: true }).click();
    },
  },
  {
    id: "state-35-secret-auth-rejected",
    name: "Secret Options — rejected credential validation",
    path: "/secret/options",
    fixture: "reject",
    action: async (page) => {
      await page.getByLabel("Bearer credential").fill("audit-invalid-credential");
      await page.getByRole("button", { name: "Unlock session", exact: true }).click();
      await page.getByText(/credential was rejected/i).waitFor({ state: "visible" });
    },
  },
  {
    id: "state-36-secret-read-desktop",
    name: "Secret Options — read-only empty workspace",
    path: "/secret/options",
    only: "desktop",
    fixture: "read",
    action: async (page) => unlockSecretWorkspace(page, "read"),
  },
  {
    id: "state-37-secret-read-mobile-positions",
    name: "Secret Options — mobile read-only positions workspace",
    path: "/secret/options",
    only: "mobile",
    fixture: "read",
    action: async (page) => unlockSecretWorkspace(page, "read"),
  },
  {
    id: "state-38-secret-read-mobile-scanner",
    name: "Secret Options — mobile read-only scanner workspace",
    path: "/secret/options",
    only: "mobile",
    fixture: "read",
    action: async (page) => {
      await unlockSecretWorkspace(page, "read");
      await page
        .getByRole("navigation", { name: "Options workspaces" })
        .getByRole("button", { name: "scanner", exact: true })
        .click();
    },
  },
  {
    id: "state-39-secret-read-mobile-insights",
    name: "Secret Options — mobile read-only insights workspace",
    path: "/secret/options",
    only: "mobile",
    fixture: "read",
    action: async (page) => {
      await unlockSecretWorkspace(page, "read");
      await page
        .getByRole("navigation", { name: "Options workspaces" })
        .getByRole("button", { name: "insights", exact: true })
        .click();
    },
  },
  {
    id: "state-41-secret-write-add-modal",
    name: "Secret Options — add trade modal with write-scoped fixture",
    path: "/secret/options",
    fixture: "write",
    action: async (page, viewport) => {
      await unlockSecretWorkspace(page, "write");
      if (viewport === "mobile") {
        await page.getByRole("button", { name: "Add", exact: true }).click();
      } else {
        await page.getByRole("button", { name: /Add Trade$/ }).click();
      }
      await page.getByRole("heading", { name: "Add New Trade", exact: true }).waitFor({ state: "visible" });
    },
  },
];

const viewports: Array<{ name: ViewportName; width: number; height: number }> = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const requestedViewport = (
  process.env.AUDIT_STATE_VIEWPORT ?? process.env.AUDIT_VIEWPORT
) as ViewportName | undefined;
const targetFilter = (
  process.env.AUDIT_STATE_FILTER ?? process.env.AUDIT_TARGET_FILTER
)?.trim().toLowerCase();
const targetLimit = Number.parseInt(
  process.env.AUDIT_STATE_LIMIT ?? process.env.AUDIT_LIMIT ?? "",
  10,
);
if (
  requestedViewport &&
  !viewports.some((viewport) => viewport.name === requestedViewport)
) {
  throw new Error(`Unsupported material-state audit viewport: ${requestedViewport}`);
}

const responseCache = new Map<
  string,
  { status: number; headers: Record<string, string>; body: Buffer }
>();

function jsonResponse(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: `${JSON.stringify(value)}\n`,
  });
}

async function fulfillSecretFixture(route: Route, fixture: SecretFixture) {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;

  if (request.method() !== "GET") {
    await route.abort("blockedbyclient");
    return;
  }
  const hasCredential = /^Bearer\s+\S+/i.test(request.headers()["authorization"] ?? "");
  if (!hasCredential) {
    await jsonResponse(route, { detail: "Unauthorized" }, 401);
    return;
  }
  if (pathname === "/api/secret/options/access") {
    if (fixture === "reject") {
      await jsonResponse(route, { detail: "Unauthorized" }, 401);
      return;
    }
    await jsonResponse(route, {
      actor: "audit-fixture",
      scope: fixture,
      auth_mode: "bearer",
      request_id: `audit-${fixture}`,
    });
    return;
  }
  if (fixture === "reject") {
    await jsonResponse(route, { detail: "Unauthorized" }, 401);
    return;
  }
  if (pathname === "/api/secret/options/positions") {
    await jsonResponse(route, { positions: [], metrics_cache: null });
    return;
  }
  if (pathname === "/api/secret/options/position-row-context") {
    await jsonResponse(route, { contexts_by_position: {} });
    return;
  }
  if (pathname === "/api/secret/options/decision-review-windows") {
    await jsonResponse(route, { windows_by_position: {} });
    return;
  }
  if (pathname === "/api/secret/options/optionality-clusters") {
    await jsonResponse(route, { clusters: [] });
    return;
  }
  if (pathname === "/api/secret/options/scanner-summary") {
    await jsonResponse(route, {
      lookback_days: 45,
      generated_at: "2026-07-29T12:00:00Z",
      summary: {
        event_count: 0,
        symbol_count: 0,
        delivered: 0,
        failed: 0,
        latest_event_at: null,
        runs_returned: 0,
        active_runs: 0,
        avg_hit_rate: 0,
      },
      top_symbols: [],
      ranked_opportunities: [],
      runs: [],
      supported_universes: [{ key: "SP500", label: "S&P 500" }],
    });
    return;
  }
  if (pathname === "/api/secret/options/closed-positions") {
    await jsonResponse(route, { closed_positions: [] });
    return;
  }
  if (pathname === "/api/secret/options/learning-summary") {
    await jsonResponse(route, {
      sample: { actual_closed_trades: 0 },
      promotion_readiness: { remaining_cycles: null },
    });
    return;
  }
  await jsonResponse(route, {});
}

async function proxyLiveApi(route: Route) {
  const request = route.request();
  if (request.method() !== "GET") {
    await route.abort("blockedbyclient");
    return;
  }

  const localUrl = new URL(request.url());
  const upstreamUrl = new URL(`${localUrl.pathname}${localUrl.search}`, LIVE_ORIGIN).toString();
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
    if (!loadingStatuses.some((text) => /loading|forming|fetching|analyzing|building|aligning/i.test(text))) {
      break;
    }
    await page.waitForTimeout(1_000);
  }
  await page.waitForTimeout(500);
}

async function measureGeometry(page: Page) {
  return page.evaluate(() => ({
    documentWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      document.documentElement.clientWidth,
    ),
    documentHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.clientHeight,
    ),
    horizontalOverflow: Math.max(
      0,
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
        document.documentElement.clientWidth,
    ),
  }));
}

async function waitForDocumentHeightStable(page: Page) {
  let previousHeight = -1;
  let stableSamples = 0;
  for (let sample = 0; sample < 12; sample += 1) {
    const height = await page.evaluate(() =>
      Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.clientHeight,
      ),
    );
    if (height === previousHeight) {
      stableSamples += 1;
      if (stableSamples >= 3) return;
    } else {
      stableSamples = 0;
      previousHeight = height;
    }
    await page.waitForTimeout(250);
  }
}

async function revealFullPage(page: Page, viewportHeight: number) {
  await page.evaluate(async (step) => {
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    let previousHeight = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      const height = document.documentElement.scrollHeight;
      for (let top = 0; top < height; top += step) {
        window.scrollTo({ top, behavior: "instant" });
        await sleep(65);
      }
      window.scrollTo({ top: height, behavior: "instant" });
      await sleep(150);
      if (height === previousHeight) break;
      previousHeight = height;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, Math.max(320, Math.floor(viewportHeight * 0.72)));

  await page.locator("img").evaluateAll(async (images) => {
    const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    await Promise.race([
      Promise.all(
        images.map((image) => {
          const img = image as HTMLImageElement;
          return img.complete ? Promise.resolve() : img.decode().catch(() => undefined);
        }),
      ),
      delay(5_000),
    ]);
  });
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    await Promise.race([document.fonts.ready, delay(5_000)]);
  });
  await page.waitForTimeout(250);
}

async function withTargetDeadline<T>(
  operation: Promise<T>,
  targetId: string,
  timeoutMs = 180_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${targetId} exceeded the ${timeoutMs / 1_000}s target deadline`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function classifyNetworkEvidence(
  target: StateTarget,
  consoleErrors: string[],
  requestFailures: string[],
) {
  const allConsoleErrors = unique(consoleErrors);
  const allRequestFailures = unique(requestFailures);
  if (target.fixture !== "reject") {
    return {
      consoleErrors: allConsoleErrors,
      requestFailures: allRequestFailures,
      expectedConsoleErrors: [] as string[],
      expectedRequestFailures: [] as string[],
    };
  }

  const expectedConsoleErrors = allConsoleErrors.filter((message) =>
    /401\s*\(Unauthorized\)/i.test(message),
  );
  const expectedRequestFailures = allRequestFailures.filter((message) =>
    /\/api\/secret\/options\/access\b.*ERR_ABORTED/i.test(message),
  );
  return {
    consoleErrors: allConsoleErrors.filter((message) => !expectedConsoleErrors.includes(message)),
    requestFailures: allRequestFailures.filter((message) => !expectedRequestFailures.includes(message)),
    expectedConsoleErrors,
    expectedRequestFailures,
  };
}

function materialStateContractFailures(record: StateRecord): string[] {
  const failures: string[] = [];
  const h1Count = record.headings.filter((heading) => heading.level === 1).length;

  if (!record.accepted) failures.push("capture was not accepted");
  if (!record.fullHeightVerified) failures.push("PNG did not cover the measured document height");
  if (record.horizontalOverflow !== 0) {
    failures.push(`page overflowed horizontally by ${record.horizontalOverflow}px`);
  }
  if (record.bodyTextLength < 40) failures.push("material state was blank or too short");
  if (h1Count !== 1) failures.push(`expected one H1, found ${h1Count}`);
  if (record.priorityTargetsUnder44 !== 0) {
    failures.push(`${record.priorityTargetsUnder44} priority touch target(s) were smaller than 44px`);
  }
  if (record.axeViolations.length !== 0) {
    failures.push(`${record.axeViolations.length} Axe violation(s) remained`);
  }
  if (record.consoleErrors.length !== 0) {
    failures.push(`${record.consoleErrors.length} unexpected console error(s) occurred`);
  }
  if (record.pageErrors.length !== 0) {
    failures.push(`${record.pageErrors.length} page error(s) occurred`);
  }
  if (record.requestFailures.length !== 0) {
    failures.push(`${record.requestFailures.length} unexpected request failure(s) occurred`);
  }
  if (record.blocker) failures.push(`blocker: ${record.blocker.split("\n", 1)[0]}`);

  return failures.map((failure) => `${record.id}: ${failure}`);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120 * 60_000);

test("capture materially distinct interactive states at full page height", async ({ browser }) => {
  await mkdir(SCREENSHOT_ROOT, { recursive: true });

  const filtered = targetFilter
    ? stateTargets.filter((target) =>
        `${target.id} ${target.name} ${target.path}`.toLowerCase().includes(targetFilter),
      )
    : stateTargets;
  const targets = Number.isFinite(targetLimit) && targetLimit > 0
    ? filtered.slice(0, targetLimit)
    : filtered;
  const selectedViewports = requestedViewport
    ? viewports.filter((viewport) => viewport.name === requestedViewport)
    : viewports;

  await writeFile(
    path.join(AUDIT_ROOT, "material-state-manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "current component interaction inventory",
        theme: AUDIT_THEME,
        policy: "bounded material states; read-only live GETs; intercepted Secret Options fixtures; no production writes",
        targetCount: targets.length,
        targets: targets.map(({ action: _action, ...target }) => target),
        viewports,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  for (const viewport of selectedViewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "America/New_York",
      deviceScaleFactor: 1,
      hasTouch: viewport.name === "mobile",
    });
    await context.addInitScript(() => window.sessionStorage.clear());
    let activeFixture: SecretFixture | undefined;

    await context.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (activeFixture && pathname.startsWith("/api/secret/options")) {
        await fulfillSecretFixture(route, activeFixture);
        return;
      }
      await proxyLiveApi(route);
    });

    const records: StateRecord[] = [];
    for (const target of targets) {
      if (target.only && target.only !== viewport.name) continue;

      activeFixture = target.fixture;
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailures: string[] = [];
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      page.setDefaultNavigationTimeout(120_000);
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
      const screenshotName = `${target.id}-${viewport.name}-full.png`;
      const screenshotPath = path.join(SCREENSHOT_ROOT, screenshotName);
      console.log(`[material-state-audit:${viewport.name}] start ${target.id}`);

      try {
        await page.goto(target.path, { waitUntil: "domcontentloaded", timeout: 120_000 });
        await waitForStableState(page);
        await page.addStyleTag({
          content:
            "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}",
        });
        await page.keyboard.press("Escape");
        if (target.action) {
          await target.action(page, viewport.name);
          await waitForStableState(page);
        }
        await revealFullPage(page, viewport.height);
        await waitForDocumentHeightStable(page);

        let [
          appliedTheme,
          geometry,
          bodyTextLength,
          headings,
          visibleDialogs,
          expandedControls,
          pressedControls,
          selectedTabs,
          priorityTargetsUnder44,
          axe,
        ] = await Promise.all([
          page.evaluate(() => document.documentElement.dataset.theme ?? ""),
          measureGeometry(page),
          page.evaluate(() => document.body.innerText.length),
          page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((elements) =>
            elements.map((element) => ({
              level: Number(element.tagName.slice(1)),
              text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
            })),
          ),
          page.locator('[role="dialog"]:visible').allInnerTexts(),
          page.locator('[aria-expanded="true"]:visible').count(),
          page.locator('[aria-pressed="true"]:visible').count(),
          page.locator('[role="tab"][aria-selected="true"]:visible').count(),
          page
            .locator(
              'button:visible, input:visible, select:visible, textarea:visible, summary:visible, [role="button"]:visible, .field-button:visible, .field-icon-button:visible, .topbar a:visible, .topbar button:visible, .section-nav-link:visible, [data-touch-target="priority"]:visible',
            )
            .evaluateAll((elements) =>
              elements.filter((element) => {
                const explicitPriority = element.matches(
                  'input, select, textarea, .field-button, .field-icon-button, .topbar a, .topbar button, .section-nav-link, [data-touch-target="priority"]',
                );
                const coarsePointerControl =
                  window.matchMedia("(any-pointer: coarse)").matches &&
                  element.matches('button, summary, [role="button"]');
                if (!explicitPriority && !coarsePointerControl) return false;
                const control = element as HTMLInputElement;
                const labelTarget =
                  control.matches('input[type="checkbox"], input[type="radio"]') &&
                  control.closest("label");
                const rect = (labelTarget || element).getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
              }).length,
            ),
          withTargetDeadline(
            new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
              .analyze(),
            `${target.id}:axe`,
            90_000,
          ),
        ]);

        let screenshotBuffer = await page.screenshot({
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          timeout: 120_000,
        });
        let screenshotSize = readPngDimensions(screenshotBuffer);
        const postCaptureGeometry = await measureGeometry(page);
        if (
          Math.abs(postCaptureGeometry.documentHeight - geometry.documentHeight) > 2 ||
          screenshotSize.height < postCaptureGeometry.documentHeight - 2
        ) {
          await revealFullPage(page, viewport.height);
          await waitForDocumentHeightStable(page);
          geometry = await measureGeometry(page);
          screenshotBuffer = await page.screenshot({
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            timeout: 120_000,
          });
          screenshotSize = readPngDimensions(screenshotBuffer);
        } else {
          geometry = postCaptureGeometry;
        }
        await writeFile(screenshotPath, screenshotBuffer);
        const fullHeightVerified =
          screenshotSize.width >= viewport.width &&
          screenshotSize.height >= geometry.documentHeight - 2;
        const accepted =
          fullHeightVerified &&
          bodyTextLength >= 40 &&
          appliedTheme === AUDIT_THEME;
        const networkEvidence = classifyNetworkEvidence(
          target,
          consoleErrors,
          requestFailures,
        );

        records.push({
          id: target.id,
          name: target.name,
          requestedPath: target.path,
          viewport: viewport.name,
          requestedTheme: AUDIT_THEME,
          appliedTheme,
          finalUrl: page.url(),
          screenshot: path.relative(AUDIT_ROOT, screenshotPath).replaceAll("\\", "/"),
          screenshotWidth: screenshotSize.width,
          screenshotHeight: screenshotSize.height,
          documentWidth: geometry.documentWidth,
          documentHeight: geometry.documentHeight,
          horizontalOverflow: geometry.horizontalOverflow,
          bodyTextLength,
          fullHeightVerified,
          accepted,
          headings,
          visibleDialogs: visibleDialogs.map((text) => text.replace(/\s+/g, " ").trim().slice(0, 500)),
          expandedControls,
          pressedControls,
          selectedTabs,
          priorityTargetsUnder44,
          axeViolations: axe.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodeCount: violation.nodes.length,
            targets: violation.nodes.flatMap((node) => node.target.map(String)).slice(0, 20),
          })),
          consoleErrors: networkEvidence.consoleErrors,
          pageErrors: unique(pageErrors),
          requestFailures: networkEvidence.requestFailures,
          expectedConsoleErrors: networkEvidence.expectedConsoleErrors,
          expectedRequestFailures: networkEvidence.expectedRequestFailures,
          blocker: accepted
            ? undefined
            : "Capture failed acceptance: content was blank or the PNG did not cover the measured document height.",
        });
      } catch (error) {
        const failureGeometry = await page
          .evaluate(() => ({
            documentWidth: Math.max(
              document.documentElement.scrollWidth,
              document.body.scrollWidth,
              document.documentElement.clientWidth,
            ),
            documentHeight: Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight,
              document.documentElement.clientHeight,
            ),
            horizontalOverflow: Math.max(
              0,
              Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
                document.documentElement.clientWidth,
            ),
            bodyTextLength: document.body.innerText.length,
          }))
          .catch(() => ({
            documentWidth: 0,
            documentHeight: 0,
            horizontalOverflow: 0,
            bodyTextLength: 0,
          }));
        const screenshotBuffer = await page
          .screenshot({ fullPage: true, animations: "disabled", caret: "hide", timeout: 120_000 })
          .catch(() => null);
        if (screenshotBuffer) await writeFile(screenshotPath, screenshotBuffer);
        const screenshotSize = screenshotBuffer
          ? readPngDimensions(screenshotBuffer)
          : { width: 0, height: 0 };
        const fullHeightVerified =
          screenshotSize.width >= viewport.width &&
          screenshotSize.height >= failureGeometry.documentHeight - 2;
        const networkEvidence = classifyNetworkEvidence(
          target,
          consoleErrors,
          requestFailures,
        );
        records.push({
          id: target.id,
          name: target.name,
          requestedPath: target.path,
          viewport: viewport.name,
          requestedTheme: AUDIT_THEME,
          appliedTheme: await page
            .evaluate(() => document.documentElement.dataset.theme ?? "")
            .catch(() => ""),
          finalUrl: page.url(),
          screenshot: path.relative(AUDIT_ROOT, screenshotPath).replaceAll("\\", "/"),
          screenshotWidth: screenshotSize.width,
          screenshotHeight: screenshotSize.height,
          documentWidth: failureGeometry.documentWidth,
          documentHeight: failureGeometry.documentHeight,
          horizontalOverflow: failureGeometry.horizontalOverflow,
          bodyTextLength: failureGeometry.bodyTextLength,
          fullHeightVerified,
          accepted: false,
          headings: [],
          visibleDialogs: [],
          expandedControls: 0,
          pressedControls: 0,
          selectedTabs: 0,
          priorityTargetsUnder44: 0,
          axeViolations: [],
          consoleErrors: networkEvidence.consoleErrors,
          pageErrors: unique(pageErrors),
          requestFailures: networkEvidence.requestFailures,
          expectedConsoleErrors: networkEvidence.expectedConsoleErrors,
          expectedRequestFailures: networkEvidence.expectedRequestFailures,
          blocker: error instanceof Error ? error.stack ?? error.message : String(error),
        });
      }

      await writeFile(
        path.join(AUDIT_ROOT, `material-state-audit-${viewport.name}.json`),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            source: AUDIT_SOURCE,
            status: "in-progress",
            viewport,
            targetCount: records.length,
            records,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const latest = records.at(-1);
      console.log(
        `[material-state-audit:${viewport.name}] ${latest?.accepted ? "accepted" : "blocked"} ${target.id} ` +
          `${latest?.screenshotWidth ?? 0}x${latest?.screenshotHeight ?? 0} ` +
          `document=${latest?.documentWidth ?? 0}x${latest?.documentHeight ?? 0}`,
      );
      await page.close().catch(() => undefined);
    }

    await context.close();
    await writeFile(
      path.join(AUDIT_ROOT, `material-state-audit-${viewport.name}.json`),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: AUDIT_SOURCE,
          status: "complete",
          viewport,
          targetCount: records.length,
          records,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const expectedTargets = targets.filter(
      (target) => !target.only || target.only === viewport.name,
    );
    const coverageFailures: string[] = [];
    if (records.length !== expectedTargets.length) {
      coverageFailures.push(
        `expected ${expectedTargets.length} material-state records, received ${records.length}`,
      );
    }
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      coverageFailures.push("material-state record IDs were not unique");
    }
    const contractFailures = records.flatMap(materialStateContractFailures);
    const failures = [...coverageFailures, ...contractFailures];
    expect(
      failures,
      `Material-state ${viewport.name} audit contract failed:\n${failures.join("\n")}`,
    ).toEqual([]);
  }
});
