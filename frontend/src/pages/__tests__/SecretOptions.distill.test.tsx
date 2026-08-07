import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OptionPosition,
  PositionDecisionReview,
  PositionDecisionReviewResponse,
  PositionThesisAssessmentResponse,
} from "../../features/secretOptions/types";
import {
  clearSecretOptionsToken,
  setSecretOptionsScope,
  setSecretOptionsToken,
} from "../../utils/secretOptionsAuth";
import SecretOptions from "../SecretOptions";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock("../../utils/apiUtils", async () => {
  const actual = await vi.importActual<typeof import("../../utils/apiUtils")>("../../utils/apiUtils");
  return {
    ...actual,
    apiFetch: apiFetchMock,
  };
});

const positions: OptionPosition[] = [
  {
    id: 11,
    trade_date: "2026-07-01",
    account: "Primary",
    action: "BUY",
    contracts: 2,
    symbol: "ALPHA",
    expiration: "2026-09-18",
    strike: 100,
    option_type: "call",
    fill_price: 2.5,
    total_cost: 500,
    underlying_at_entry: 98,
    estimated_delta: 0.5,
    shares_equivalent: 100,
    dte_at_entry: 79,
    underlying_reference: 98,
    source_event_id: 101,
    source_triggered_at: "2026-07-01T14:30:00Z",
    source_match_method: "event_id",
    source_match_confidence: 0.92,
    source_match_notes: "Direct scanner attribution",
    evaluation_min_hold_days: 5,
    evaluation_hold_days: 20,
    evaluation_start_date: "2026-07-01",
    evaluation_due_date: "2026-08-05",
    evaluation_decision_deadline: "2026-08-15",
    evaluation_source: "decision_review",
    evaluation_window_basis: "test fixture",
  },
  {
    id: 22,
    trade_date: "2026-07-08",
    account: "Primary",
    action: "BUY",
    contracts: 1,
    symbol: "BETA",
    expiration: "2026-10-16",
    strike: 80,
    option_type: "put",
    fill_price: 4,
    total_cost: 400,
    underlying_at_entry: 84,
    estimated_delta: -0.42,
    shares_equivalent: -42,
    dte_at_entry: 100,
    underlying_reference: 84,
    source_event_id: null,
    source_triggered_at: null,
    source_match_method: null,
    source_match_confidence: null,
    source_match_notes: null,
    evaluation_min_hold_days: 5,
    evaluation_hold_days: 30,
    evaluation_start_date: "2026-07-08",
    evaluation_due_date: "2026-09-01",
    evaluation_decision_deadline: "2026-09-15",
    evaluation_source: "decision_review",
    evaluation_window_basis: "test fixture",
  },
];

const metricsByPosition = {
  11: {
    market: {
      current_price: 105,
      previous_close: 104,
      change: 1,
      change_percent: 0.96,
      implied_volatility: 0.3,
      last_updated: "2026-08-03T13:00:00Z",
      data_source: "test",
      quote_source: "test",
    },
    option_price: 3,
    option_price_source: "mid",
    quote: {
      bid: 2.9,
      ask: 3.1,
      last: 3,
      mid: 3,
      spread: 0.2,
      spread_pct: 6.67,
      volume: 50,
      open_interest: 1_000,
      implied_volatility: 0.3,
      last_trade_at: "2026-08-03T12:59:00Z",
      data_source: "test",
      quote_source: "test",
      quality: "good",
    },
    volatility: 0.3,
    volatility_source: "test",
    hv30: 0.25,
    dte: 46,
    greeks: { delta: 0.55, gamma: 0.04, theta: -0.03, vega: 0.11 },
    pnl: { dollar: 100, percent: 20, source: "mid" },
  },
  22: {
    market: {
      current_price: 77,
      previous_close: 79,
      change: -2,
      change_percent: -2.53,
      implied_volatility: 0.38,
      last_updated: "2026-08-03T13:00:00Z",
      data_source: "test",
      quote_source: "test",
    },
    option_price: 3,
    option_price_source: "mid",
    quote: {
      bid: 2.8,
      ask: 3.2,
      last: 3,
      mid: 3,
      spread: 0.4,
      spread_pct: 13.33,
      volume: 20,
      open_interest: 500,
      implied_volatility: 0.38,
      last_trade_at: "2026-08-03T12:58:00Z",
      data_source: "test",
      quote_source: "test",
      quality: "good",
    },
    volatility: 0.38,
    volatility_source: "test",
    hv30: 0.31,
    dte: 74,
    greeks: { delta: -0.48, gamma: 0.03, theta: -0.04, vega: 0.14 },
    pnl: { dollar: -100, percent: -25, source: "mid" },
  },
} as const;

const reviewFor = (position: OptionPosition): PositionDecisionReview => ({
  id: position.id * 10,
  position_id: position.id,
  supersedes_review_id: null,
  review_sequence: 1,
  review_date: "2026-08-01",
  review_type: "reassessment",
  selected_assessment_id: null,
  decision_source: "human_override",
  human_override: position.id === 11 ? "reduce" : "hold",
  override_reason: null,
  threshold_approval_status: "approved",
  symbol: position.symbol,
  expiration: position.expiration,
  strike: position.strike,
  option_type: position.option_type,
  contracts_snapshot: position.contracts,
  trade_role: "asymmetric upside",
  original_thesis: `${position.symbol} company thesis`,
  contract_thesis: `${position.symbol} contract thesis`,
  expected_path: "Catalyst resolves before expiry.",
  catalyst: "Upcoming operating update",
  confirmation_condition: "Fundamentals continue improving.",
  invalidation_condition: "Company thesis breaks.",
  risk_budget: position.total_cost,
  evidence_since_last: `${position.symbol} review evidence remains append-only.`,
  thesis_status: "intact",
  fresh_entry_answer: "yes",
  portfolio_fit: "fits",
  data_quality_notes: "Quote and source are current.",
  verdict: position.id === 11 ? "reduce" : "hold",
  target_contracts: position.id === 11 ? 1 : position.contracts,
  quality: "high",
  urgency: "normal",
  confidence: "high",
  continuation_condition: "Continue only while the company thesis remains intact.",
  next_review_date: "2026-08-02",
  decision_deadline: "2026-08-15",
  decision_notes: "Test review",
  snapshot: {
    underlying_price: metricsByPosition[position.id as 11 | 22].market.current_price,
    option_price: metricsByPosition[position.id as 11 | 22].option_price,
    remaining_capital: position.total_cost,
    pnl_dollar: metricsByPosition[position.id as 11 | 22].pnl.dollar,
    pnl_percent: metricsByPosition[position.id as 11 | 22].pnl.percent,
    dte: metricsByPosition[position.id as 11 | 22].dte,
    delta: metricsByPosition[position.id as 11 | 22].greeks.delta,
    theta: metricsByPosition[position.id as 11 | 22].greeks.theta,
    implied_volatility: metricsByPosition[position.id as 11 | 22].market.implied_volatility,
    quote_quality: "good",
    market_data_as_of: "2026-08-03T13:00:00Z",
  },
  created_at: "2026-08-01T13:00:00Z",
});

const decisionReviewsFor = (position: OptionPosition): PositionDecisionReviewResponse => {
  const review = reviewFor(position);
  return {
    position_id: position.id,
    review_count: 1,
    latest_review: review,
    status: {
      window_status: "active",
      review_due: false,
      decision_deadline_missed: false,
      additions_blocked: false,
      addition_blockers: [],
      warnings: [],
      missing_mandate_fields: [],
    },
    history: [review],
  };
};

const assessmentFor = (position: OptionPosition): PositionThesisAssessmentResponse => ({
  position_id: position.id,
  mandate: {
    id: position.id * 1_000,
    mandate_version: 1,
    confirmation_status: "confirmed",
    threshold_origin: "user",
    threshold_approval_status: "approved",
    trade_role: "asymmetric upside",
    original_thesis: `${position.symbol} company thesis`,
    contract_thesis: `${position.symbol} contract thesis`,
    expected_path: "Catalyst resolves before expiry.",
    catalyst: "Upcoming operating update",
    confirmation_condition: "Fundamentals continue improving.",
    invalidation_condition: "Company thesis breaks.",
    decision_deadline: "2026-08-15",
    risk_budget: position.total_cost,
  },
  assessment: {
    id: position.id * 100,
    position_id: position.id,
    trigger: "test",
    as_of: "2026-08-03T13:00:00Z",
    grader_version: "test-v1",
    data_quality_status: "good",
    company_thesis_status: "intact",
    security_thesis_readiness: "ready",
    path_status: "on_track",
    contract_status: "fit",
    portfolio_fit_status: "fits",
    proposed_verdict: "hold",
    proposed_target_contracts: position.contracts,
    target_contracts_min: position.contracts,
    target_contracts_max: position.contracts,
    quality: "high",
    urgency: "normal",
    confidence: "high",
    continuation_condition: "Company thesis remains intact.",
    next_review_date: "2026-08-08",
    decision_deadline: "2026-08-15",
    vetoes: [],
    reasons: [`${position.symbol} decision evidence confirms the company thesis.`],
    missing_inputs: [],
    input_snapshot: null,
    axis_results: {
      trim_sizing: null,
    },
  },
  suggested_window: {
    as_of_date: "2026-08-03",
    next_review_date: "2026-08-08",
    decision_deadline: "2026-08-15",
    next_review_sessions: 5,
    max_hold_sessions: 10,
    original_min_hold_days: 5,
    original_max_hold_days: 20,
    basis: "test fixture",
    source_assessment_id: position.id * 100,
    decision_source: "automatic_assessment",
    verdict: "hold",
    urgency: "normal",
    rebased: false,
    continuation_condition: "Company thesis remains intact.",
  },
  review_defaults: {},
  risk_policy: {
    id: 1,
    policy_version: 1,
    name: "Test policy",
    active: true,
    approval_status: "approved",
    portfolio_capital: 100_000,
    default_trade_risk_budget: 1_000,
    max_single_position_premium_pct: 30,
    max_directional_premium_pct: 75,
    max_expiry_bucket_premium_pct: 45,
    max_option_spread_pct: 25,
    min_dte_for_add: 21,
  },
  history: [],
  automated_execution_enabled: false,
  execution_note: "No order is submitted.",
});

const scannerSummary = {
  lookback_days: 45,
  generated_at: "2026-08-03T13:00:00Z",
  summary: {
    event_count: 0,
    symbol_count: 0,
    delivered: 0,
    failed: 0,
    latest_event_at: null,
    runs_returned: 0,
    active_runs: 0,
    avg_hit_rate: null,
  },
  top_symbols: [],
  ranked_opportunities: [],
  runs: [],
  supported_universes: [{ key: "SP500", label: "S&P 500" }],
};

const findPosition = (id: number) => {
  const position = positions.find((item) => item.id === id);
  if (!position) throw new Error(`Missing position fixture ${id}`);
  return position;
};

const workspaceResponse = (endpoint: string) => {
  if (endpoint === "/secret/options/access") {
    return Promise.resolve({ actor: "writer", scope: "write", auth_mode: "bearer", request_id: "req-distill" });
  }
  if (endpoint === "/secret/options/positions" || endpoint === "/secret/options/positions?refresh=true") {
    return Promise.resolve({
      positions: positions.map((position) => ({
        position,
        metrics: metricsByPosition[position.id as 11 | 22],
      })),
      metrics_cache: null,
    });
  }
  if (endpoint === "/secret/options/position-row-context") {
    return Promise.resolve({
      contexts_by_position: {
        11: {
          position_id: 11,
          symbol: "ALPHA",
          index_memberships: [{ key: "SP500", label: "SPY", name: "S&P 500" }],
          membership_status: "complete",
          linked_trade: true,
          source_match_method: "event_id",
          source_match_confidence: 0.92,
          source_match_notes: "Direct scanner attribution",
          scan: null,
        },
        22: {
          position_id: 22,
          symbol: "BETA",
          index_memberships: [],
          membership_status: "complete",
          linked_trade: false,
          source_match_method: null,
          source_match_confidence: null,
          source_match_notes: null,
          scan: null,
        },
      },
    });
  }
  if (endpoint === "/secret/options/decision-review-windows") {
    return Promise.resolve({ position_count: 2, window_count: 0, windows_by_position: {} });
  }
  if (endpoint.startsWith("/secret/options/optionality-clusters")) {
    return Promise.resolve({
      lookback_days: 45,
      bucket_days: 7,
      generated_at: "2026-08-03T12:00:00",
      clusters: [
        { group: "Consumer Staples", sector: "Consumer Staples", hits: 10, recent_hits: 6, prior_hits: 4, momentum: 2, symbols: ["ALPHA", "GAMMA"], avg_iv_percentile: 72, avg_iv_hv_spread: 8.5, latest_triggered_at: "2026-08-03T11:00:00", strength_score: 80, events: [] },
        { group: "Financials", sector: "Financials", hits: 4, recent_hits: 1, prior_hits: 3, momentum: -2, symbols: ["BETA"], avg_iv_percentile: 55, avg_iv_hv_spread: 3.2, latest_triggered_at: "2026-08-02T11:00:00", strength_score: 52, events: [] },
      ],
    });
  }
  if (endpoint.startsWith("/secret/options/scanner-summary")) {
    return Promise.resolve(scannerSummary);
  }

  const reviewsMatch = endpoint.match(/^\/secret\/options\/positions\/(\d+)\/decision-reviews$/);
  if (reviewsMatch) {
    return Promise.resolve(decisionReviewsFor(findPosition(Number(reviewsMatch[1]))));
  }

  const assessmentMatch = endpoint.match(/^\/secret\/options\/positions\/(\d+)\/thesis-assessment(?:\?.*)?$/);
  if (assessmentMatch) {
    return Promise.resolve(assessmentFor(findPosition(Number(assessmentMatch[1]))));
  }

  if (/^\/secret\/options\/greeks\/\d+$/.test(endpoint)) {
    return Promise.resolve({
      price_curve: [],
      theta_curve: [],
      current_greeks: null,
      model_info: {},
    });
  }
  if (/^\/stocks\/[A-Z]+\/projections$/.test(endpoint)) {
    return Promise.resolve({});
  }

  return Promise.reject(new Error(`Unexpected Secret Options distillation endpoint: ${endpoint}`));
};

const renderDesktopWorkspace = () => render(
  <MemoryRouter>
    <SecretOptions />
  </MemoryRouter>,
);

describe("Secret Options desktop distillation", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(workspaceResponse);
    clearSecretOptionsToken();
    window.sessionStorage.clear();
    setSecretOptionsToken("write-token");
    setSecretOptionsScope("write");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(min-width: 1280px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    clearSecretOptionsToken();
    window.sessionStorage.clear();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    vi.restoreAllMocks();
  });

  it("selects desktop rows without turning them into inline disclosures", async () => {
    const user = userEvent.setup();
    renderDesktopWorkspace();

    const alpha = await screen.findByRole("button", { name: "Select ALPHA position" });
    const beta = screen.getByRole("button", { name: "Select BETA position" });

    expect(alpha.getAttribute("aria-pressed")).toBe("true");
    expect(beta.getAttribute("aria-pressed")).toBe("false");
    expect(alpha.hasAttribute("aria-expanded")).toBe(false);
    expect(beta.hasAttribute("aria-expanded")).toBe(false);
    expect(screen.queryByRole("button", { name: /Expand .* position details/i })).toBeNull();

    await user.click(beta);

    await waitFor(() => {
      expect(beta.getAttribute("aria-pressed")).toBe("true");
      expect(alpha.getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("heading", { name: /^BETA PUT \$80/ })).not.toBeNull();
    });
    expect(beta.hasAttribute("aria-expanded")).toBe(false);
  });

  it("keeps the portfolio summary and decision actions compact and immediately scannable", async () => {
    renderDesktopWorkspace();

    expect(await screen.findByRole("heading", { name: "Position Summary" })).not.toBeNull();
    expect(screen.getByText("Open 2")).not.toBeNull();
    expect(screen.getByRole("button", { name: /^All\b/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Review soon\b/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Losing\b/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Low confidence\b/ })).not.toBeNull();

    expect(await screen.findByRole("button", { name: "Record review" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Override" })).not.toBeNull();
    expect(screen.getAllByText("More actions").length).toBeGreaterThan(0);
    expect(await screen.findByText("Recorded decision · review #1")).not.toBeNull();
    expect(await screen.findByText("Reduce to 1")).not.toBeNull();
    expect((await screen.findAllByLabelText(/ALPHA\. confirmed decision window.*Next review Aug 2, 2026.*Decision deadline Aug 15, 2026/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/\d+d review overdue/)).length).toBeGreaterThan(0);
  });

  it("applies a recorded review response without refetching the position workspace", async () => {
    const user = userEvent.setup();
    const position = positions[0];
    const assessment = assessmentFor(position);
    const createdReview: PositionDecisionReview = {
      ...reviewFor(position),
      id: 999,
      supersedes_review_id: reviewFor(position).id,
      review_sequence: 2,
      selected_assessment_id: assessment.assessment.id,
      decision_source: "human_confirmed_auto",
      human_override: "none",
    };
    apiFetchMock.mockImplementation((endpoint: string, init?: RequestInit) => {
      if (
        endpoint === `/secret/options/positions/${position.id}/decision-reviews`
        && init?.method === "POST"
      ) {
        return Promise.resolve({
          review: createdReview,
          assessment: assessment.assessment,
          mandate: assessment.mandate,
          status: decisionReviewsFor(position).status,
          recorded_with_warnings: false,
          snapshot_source: "position_cache",
          automated_execution_enabled: false,
        });
      }
      return workspaceResponse(endpoint);
    });
    renderDesktopWorkspace();

    const recordReview = await screen.findByRole("button", { name: "Record review" });
    const callsBeforeSave = apiFetchMock.mock.calls.length;
    await user.click(recordReview);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review recorded" })).not.toBeNull();
      expect(screen.getByText("Recorded decision · review #2")).not.toBeNull();
    });
    const saveCalls = apiFetchMock.mock.calls.slice(callsBeforeSave);
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0][0]).toBe(`/secret/options/positions/${position.id}/decision-reviews`);
    expect(saveCalls[0][1]?.method).toBe("POST");
  });

  it("keeps the scanner on a separate desktop workspace tab", async () => {
    const user = userEvent.setup();
    renderDesktopWorkspace();

    const scannerTab = await screen.findByRole("tab", { name: "scanner" });
    expect(scannerTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("heading", { name: /Scanner Control & Outcomes/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run Scan" })).toBeNull();

    await user.click(scannerTab);

    expect(scannerTab.getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("heading", { name: /Scanner Control & Outcomes/i })).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Run Scan" })).not.toBeNull();
    expect(screen.getByText(/Automatic S&P 500 scans · 10:00 AM, 12:00 PM, and 2:00 PM ET/i)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Themes" }));
    expect(await screen.findByLabelText("10 hits relative to 10 in the largest theme")).not.toBeNull();
    expect(screen.getByLabelText("4 hits relative to 10 in the largest theme")).not.toBeNull();
    expect(screen.getByLabelText("Consumer Staples members").textContent).toContain("ALPHA");
  });

  it("keeps decision evidence, market context, and append-only history reachable through affordances", async () => {
    const user = userEvent.setup();
    renderDesktopWorkspace();

    const decisionBasis = await screen.findByRole("button", { name: "Decision basis" });
    const marketAndContract = screen.getByRole("button", { name: "Market & contract" });
    const history = screen.getByRole("button", { name: "History" });
    expect(decisionBasis.getAttribute("aria-expanded")).toBe("false");
    expect(marketAndContract.getAttribute("aria-expanded")).toBe("false");
    expect(history.getAttribute("aria-expanded")).toBe("false");

    await user.click(decisionBasis);
    expect(decisionBasis.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(String(decisionBasis.getAttribute("aria-controls")))).not.toBeNull();
    expect(await screen.findByText("ALPHA decision evidence confirms the company thesis.")).not.toBeNull();

    await user.click(marketAndContract);
    expect(decisionBasis.getAttribute("aria-expanded")).toBe("false");
    expect(marketAndContract.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(String(marketAndContract.getAttribute("aria-controls")))).not.toBeNull();
    expect(await screen.findByText(/Bid \/ Ask/)).not.toBeNull();

    await user.click(history);
    expect(history.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(String(history.getAttribute("aria-controls")))).not.toBeNull();
    expect(await screen.findByText(/Immutable history · 1 review/)).not.toBeNull();
    expect(screen.getAllByText("ALPHA review evidence remains append-only.").length).toBeGreaterThan(0);
  });
});
