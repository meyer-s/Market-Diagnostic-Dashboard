import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const position = (id: number, symbol: string, cost: number) => ({
  position: { id, symbol, account: "Fixture", action: "BUY_TO_OPEN", contracts: 1,
    expiration: "2027-01-15", strike: 100, option_type: "call", trade_date: "2026-10-30",
    fill_price: cost / 100, total_cost: cost, source_event_id: null, source_match_confidence: null,
    dte_at_entry: 77, strategy_type: "single_leg" },
  metrics: { market: { current_price: 105 }, pnl: { dollar: 50, percent: 5, source: "fixture" }, dte: 60, greeks: null },
});
const closed = (id: number, symbol: string) => ({
  ...position(id, symbol, 100).position, close_date: "2026-11-02", exit_price: 2,
  total_proceeds: 200, dollar_pnl: 100, percent_pnl: 100, notes: null,
});

for (const width of [1440, 390]) {
  test(`@release personal ETF visibility at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.endsWith("/thesis-assessment")) {
        await route.fulfill({ status: 404, json: { detail: "No thesis assessment has been recorded" } });
        return;
      }
      if (path.endsWith("/access")) body = { actor: "fixture", scope: "read", auth_mode: "bearer" };
      else if (path.endsWith("/positions")) body = { positions: [position(1, "META", 1000), position(2, "GLD", 2000)], metrics_cache: null };
      else if (path.endsWith("/closed-positions")) body = { closed_positions: [closed(3, "KO"), closed(4, "SPY")] };
      else if (path.endsWith("/decision-reviews")) body = { review_count: 0, latest_review: null, history: [], status: { additions_blocked: false, addition_blockers: [], warnings: [] } };
      else if (path.endsWith("/learning-summary")) body = { sample: { actual_closed_trades: 0, classified_trade_cycles: 0, matured_decision_horizons: 0 }, trade_outcomes: { primary_lessons: {} }, promotion_readiness: { status: "collecting", remaining_cycles: 10 } };
      else if (path.endsWith("/position-row-context")) body = { contexts_by_position: {} };
      else if (path.endsWith("/decision-review-windows")) body = { windows_by_position: {} };
      else if (path.endsWith("/optionality-clusters")) body = { clusters: [] };
      else if (path.endsWith("/risk-policy")) body = { risk_policy: { portfolio_capital: null, default_trade_risk_budget: null } };
      else if (path.endsWith("/scanner-summary")) body = { ranked_opportunities: [], top_symbols: [], runs: [], supported_universes: [], summary: { event_count: 0, symbol_count: 0 } };
      await route.fulfill({ json: body });
    });
    const unlock = async () => {
      await page.getByLabel("Bearer credential").fill("fixture-only-not-a-real-key");
      await page.getByRole("button", { name: "Unlock session" }).click();
    };
    const history = async () => {
      if (width < 1000) await page.getByRole("button", { name: "Open position actions" }).click();
      else if (!await page.getByRole("button", { name: "P/L history", exact: true }).isVisible()) {
        await page.getByText("More actions", { exact: true }).first().click();
      }
      await page.getByRole("button", { name: "P/L history", exact: true }).click();
      return page.getByRole("dialog", { name: "Closed positions history" });
    };
    await page.goto("/secret/options");
    await unlock();
    const toggle = page.getByRole("switch", { name: "Show personal ETF bets" });
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText("META", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("GLD", { exact: true })).toHaveCount(0);
    await expect(page.getByText("1 ETF open lot hidden")).toBeVisible();
    if (width > 1000) await expect(page.getByRole("button", { name: "All 1", exact: true })).toBeVisible();
    let dialog = await history();
    await expect(dialog.getByText("KO", { exact: true })).toBeVisible();
    await expect(dialog.getByText("SPY", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close closed positions history" }).click();
    await toggle.check();
    await expect(page.getByText("GLD", { exact: true }).first()).toBeVisible();
    if (width > 1000) await expect(page.getByRole("button", { name: "All 2", exact: true })).toBeVisible();
    dialog = await history();
    await expect(dialog.getByText("SPY", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close closed positions history" }).click();
    await page.reload();
    await unlock();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.getByText("GLD", { exact: true })).toHaveCount(0);
    const violations = (await new AxeBuilder({ page }).include('[aria-label="ETF visibility"]').analyze()).violations;
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`personal-etfs-${width}.png`), fullPage: true });
  });
}
