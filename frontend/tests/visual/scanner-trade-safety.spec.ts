import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const legacyHit = {
  event_id: 91, symbol: "T", triggered_at: "2026-10-22T14:00:00Z",
  group: "Communication Services", sector: "Telecom", score: 80, base_score: 80,
  grade: "A", model_version: "legacy", components: {}, reasons: [], message: "",
  iv_percentile: 30, iv30: 20, hv30: 30, iv_hv_spread: -10, avg_edr: 2,
  selected_contract: { expiry: "2027-01-15", dte: 85, strike: 21, option_type: "put", premium: 0.3, spread_pct: 10 },
  position_match: {
    match_type: "same_symbol", classification: "contract_drift", position_id: 7,
    position_ids: [7], contracts: 3, held_contracts: 3, repeat_count: 4,
    replacement_decision: {
      model_version: "replacement_rules_v2_field_shadow", status: "candidate",
      recommendation: "roll_out_candidate", action: "replace_after_close",
      label: "Roll-out candidate", summary: "Legacy roll recommendation", confidence: "medium",
      implementation_ready: false, automated_execution_enabled: false,
      structure: { label: "Straight out", expiry_direction: "out", strike_direction: "same", directional_hurdle: "same" },
      comparison: { held: { contract: "Dec 18 $21 put" }, candidate: { contract: "Jan 15 $21 put" }, change: { score: 38, dte: 28 } },
      gates: [], missing_inputs: [], journal_rule: "Close and journal the held contract first.",
    },
  },
};
const run = {
  id: 1, universe_key: "SP500", universe_label: "S&P 500", threshold: 100,
  trigger_source: "dashboard", status: "completed", total_symbols: 100, scanned_symbols: 100,
  hits: 1, errors: 0, rate_limit_errors: 0, hit_symbols: ["T"], notes: null,
  started_at: "2026-10-22T14:00:00Z", completed_at: "2026-10-22T14:01:00Z",
  updated_at: "2026-10-22T14:01:00Z", hit_rate: 1,
};

for (const width of [1440, 390]) {
  test(`@release scanner funding guard at ${width}px overrides legacy roll advice`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path.endsWith("/access")) body = { actor: "fixture", scope: "write", auth_mode: "bearer" };
      else if (path.endsWith("/positions")) body = { positions: [], metrics_cache: null };
      else if (path.endsWith("/position-row-context")) body = { contexts_by_position: {} };
      else if (path.endsWith("/decision-review-windows")) body = { windows_by_position: {} };
      else if (path.endsWith("/optionality-clusters")) body = { clusters: [] };
      else if (path.endsWith("/risk-policy")) body = { risk_policy: { default_trade_risk_budget: 99999 } };
      else if (path.endsWith("/strategy-plan")) body = { strategy_plan: null };
      else if (path.endsWith("/scanner-run/1")) body = { run, hits: [legacyHit], ranking_snapshot: null };
      else if (path.endsWith("/scanner-summary")) body = {
        generated_at: "2026-10-22T14:00:00Z", lookback_days: 45,
        summary: { event_count: 1, symbol_count: 1, delivered: 0, failed: 0, runs_returned: 0, active_runs: 0 },
        ranked_opportunities: [legacyHit], top_symbols: [], runs: [run],
        supported_universes: [{ key: "SP500", label: "S&P 500" }],
      };
      await route.fulfill({ json: body });
    });
    await page.goto("/secret/options");
    await page.getByLabel("Bearer credential").fill("fixture-only-not-a-real-key");
    await page.getByRole("button", { name: "Unlock session" }).click();
    if (width > 1000) await page.getByRole("tab", { name: /^scanner$/i }).click();
    else {
      await page.getByRole("navigation", { name: "Options workspaces" }).getByRole("button", { name: /^scanner$/i }).click();
      await page.getByRole("tab", { name: /^hits$/i }).click();
    }
    await expect(page.getByLabel("Scanner funding guard")).toBeVisible();
    await expect(page.getByText(/HELD · 3 · FUNDING CHECK/).first()).toBeVisible();
    await expect(page.getByText("HELD · 3 · ROLL", { exact: true })).toHaveCount(0);
    if (width > 1000) await page.getByRole("button", { name: "Open scanner hit details for T" }).click();
    else await page.getByRole("button", { name: /HELD · 3 · FUNDING CHECK/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Roll withheld · funding unverified", { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Funding verification required" })).toBeDisabled();
    await expect(dialog.getByText("Legacy roll recommendation", { exact: true })).toHaveCount(0);
    await dialog.getByText("Settled-cash requirements", { exact: true }).click();
    await expect(dialog.getByText(/Closing-sale credits and unsettled proceeds/)).toBeVisible();
    const severe = (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
    expect(severe.map((v) => v.id)).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`scanner-funding-${width}.png`), fullPage: true });
  });
}
