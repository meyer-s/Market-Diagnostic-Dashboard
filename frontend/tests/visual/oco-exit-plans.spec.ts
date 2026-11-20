import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const plan = (overrides: Record<string, unknown> = {}) => ({
  position_id: 1, fingerprint: "a".repeat(24), account: "Fixture account", symbol: "XYZ",
  contract_symbol: "-XYZ270115C100", expiration: "2027-01-15", strike: 100, option_type: "call",
  contracts: 3, actual_fill: 2.1, source_event_id: 11, source_triggered_at: "2026-11-18T15:00:00Z",
  source_is_candidate: true, levels: { entry_premium: 2, stop_premium: 1.2, target_premium: 3.5, target_basis: "Hump Exit" },
  status: "stop_crossed", reasons: [], warnings: ["Confirm the inferred scanner association and existing broker orders."],
  indicative_mark: .8, mark_source: "last", last_trade_at: "2026-11-19T20:00:00Z", ...overrides,
});

for (const width of [1440, 390]) {
  test(`@release OCO references remain read-only and fit at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors: string[] = [];
    const writes: string[] = [];
    let rows = [plan(), plan({ position_id: 2, fingerprint: "c".repeat(24), symbol: "ABC", levels: null, status: "needs_plan", reasons: ["Saved scanner contract differs."] })];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      if (route.request().method() !== "GET") {
        writes.push(route.request().method() + " " + route.request().url());
        await route.fulfill({ status: 403, json: { detail: "Fixture blocks writes" } });
        return;
      }
      const path = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (path.endsWith("/access")) json = { actor: "fixture", scope: "read", auth_mode: "bearer" };
      else if (path.endsWith("/exit-plans")) json = { rows, summary: { lots: 2, with_levels: 1, stop_crossed: 1, needs_plan: 1 }, broker_review: "Verify available quantity and existing orders in Fidelity.", fidelity_help_url: "https://www.fidelity.com/trading/faqs-order-types" };
      else if (path.endsWith("/positions")) json = { positions: [], metrics_cache: null };
      else if (path.endsWith("/closed-positions")) json = { closed_positions: [] };
      else if (path.endsWith("/position-row-context")) json = { contexts_by_position: {} };
      else if (path.endsWith("/decision-review-windows")) json = { windows_by_position: {} };
      else if (path.endsWith("/optionality-clusters")) json = { clusters: [] };
      else if (path.endsWith("/risk-policy")) json = { risk_policy: { portfolio_capital: null, default_trade_risk_budget: null } };
      else if (path.endsWith("/scanner-summary")) json = { ranked_opportunities: [], top_symbols: [], runs: [], supported_universes: [], summary: { event_count: 0, symbol_count: 0 } };
      else if (path.endsWith("/learning-summary")) json = { sample: { actual_closed_trades: 0, classified_trade_cycles: 0, matured_decision_horizons: 0 }, trade_outcomes: { primary_lessons: {} }, promotion_readiness: { status: "collecting", remaining_cycles: 10 } };
      await route.fulfill({ json });
    });
    await page.goto("/secret/options");
    await page.getByLabel("Bearer credential").fill("fixture-only-not-a-real-key");
    await page.getByRole("button", { name: "Unlock session" }).click();
    await page.getByRole("button", { name: "OCO exit plans", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "OCO exit plans" });
    const valid = dialog.getByRole("article", { name: "XYZ exit plan lot 1" });
    await expect(valid.getByText("Mark below original stop", { exact: true })).toBeVisible();
    await valid.getByRole("button", { name: "Copy stop premium" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1.20");
    await valid.getByRole("button", { name: "Copy plan reference" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("both legs SELL TO CLOSE the same quantity");
    await expect(valid.getByRole("checkbox")).not.toBeChecked();
    await valid.getByRole("checkbox").check();
    await expect(valid.getByRole("checkbox")).toBeChecked();
    await dialog.getByRole("combobox", { name: "Show exit plans" }).selectOption("needs_plan");
    await expect(dialog.getByRole("article")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Copy plan reference" })).toBeDisabled();
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    rows = [plan({ contracts: 2, fingerprint: "b".repeat(24) }), rows[1]];
    await dialog.getByRole("button", { name: "Refresh plans" }).click();
    await dialog.getByRole("combobox", { name: "Show exit plans" }).selectOption("all");
    await expect(valid.getByRole("checkbox")).not.toBeChecked();
    await valid.getByText(/Source and review notes/).click();
    const violations = (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations;
    expect(violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`oco-plans-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "OCO exit plans", exact: true })).toBeFocused();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
