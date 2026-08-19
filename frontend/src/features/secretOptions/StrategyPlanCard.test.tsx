import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StrategyPlanCard } from "./StrategyPlanCard";
import type { OptionStrategyPlan } from "./types";

const plan: OptionStrategyPlan = {
  model_version: "risk_defined_structures_v1",
  generated_at: "2026-08-18T14:00:00Z",
  symbol: "SYY",
  underlying_price: 80,
  market_read: {
    direction: "calls",
    expected_move_pct: 5,
    iv30: 24,
    hv30: 30,
    iv_hv_ratio: 80,
    volatility_value: "cheap",
  },
  primary: {
    strategy_type: "call_debit_spread",
    label: "Bull call debit spread",
    direction: "bullish",
    volatility_exposure: "moderately_long_vol",
    expiration: "2026-10-16",
    dte: 59,
    legs: [
      { action: "buy", option_type: "call", strike: 80, expiration: "2026-10-16", quantity: 1 },
      { action: "sell", option_type: "call", strike: 85, expiration: "2026-10-16", quantity: 1 },
    ],
    net_debit: 1.5,
    midpoint_debit: 1.4,
    entry_price_basis: "natural (buy at ask, sell at bid)",
    max_loss: 150,
    max_profit: 350,
    max_profit_label: "Defined",
    breakevens: [81.5],
    risk_defined: true,
    status: "actionable",
    quote_issues: [],
    expected_move_pct: 5,
    iv_hv_ratio: 80,
    greeks: { delta: 0.25, delta_shares: 25, gamma: 0.02, theta: -2.1, vega: 4.5 },
    rationale: "Defines the loss while retaining the directional move.",
    success_condition: "The underlying moves toward 85 before decay dominates.",
  },
  alternatives: [],
  selection_note: "Directional evidence favors a debit spread.",
  excluded_structures: [],
  data_source: "test",
  quote_source: "test",
  observed_at: "2026-08-18T14:00:00Z",
};

afterEach(cleanup);

describe("StrategyPlanCard", () => {
  it("presents one actionable system plan and applies the risk-budget quantity", () => {
    const onUse = vi.fn();
    render(<StrategyPlanCard plan={plan} riskBudget={400} onUse={onUse} />);

    expect(screen.getByText("Bull call debit spread")).toBeTruthy();
    expect(screen.getByText("Risk budget $400.00 supports 2 units; the trade form will use that quantity.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this plan" }));
    expect(onUse).toHaveBeenCalledWith(plan.primary);
  });

  it("blocks a structure whose defined loss exceeds the approved budget", () => {
    render(<StrategyPlanCard plan={plan} riskBudget={100} onUse={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Above risk budget" })).toHaveProperty("disabled", true);
  });

  it("turns a manual-price-discovery warning into a review path", () => {
    const onUse = vi.fn();
    const reviewPlan: OptionStrategyPlan = {
      ...plan,
      primary: {
        ...plan.primary,
        status: "manual_price_discovery",
        quote_issues: ["call 85 spread is 34.4%"],
      },
    };

    render(<StrategyPlanCard plan={reviewPlan} onUse={onUse} />);

    const reviewButton = screen.getByRole("button", { name: "Review quotes & continue" });
    expect(reviewButton).toHaveProperty("disabled", false);
    fireEvent.click(reviewButton);
    expect(onUse).toHaveBeenCalledWith(reviewPlan.primary);
  });
});
