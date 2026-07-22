import { describe, expect, it } from "vitest";

import { presentOptionMarketField, presentScannerPositionMatch } from "../scannerPositionMatch";

describe("presentScannerPositionMatch", () => {
  it("keeps an exact repeat neutral unless independent evidence strengthened", () => {
    const result = presentScannerPositionMatch({
      match_type: "exact_contract",
      held_contracts: 10,
      repeat_count: 3,
      deltas: { base_score: 2.4, iv_hv_spread: -1.2 },
    });

    expect(result).toMatchObject({
      badgeLabel: "HELD · 10 · #3",
      classificationLabel: "Still qualifies",
      evidenceLine: "Still qualifies · Base +2.4 · IV/HV -1.2 pts",
      tone: "neutral",
    });
    expect(result?.accessibleLabel).toContain("not an add recommendation");
  });

  it("defaults a same-symbol mismatch to contract drift", () => {
    const result = presentScannerPositionMatch({
      match_type: "same_symbol",
      held_contracts: 5,
      delta_summary: "Scanner now prefers Aug 21 $260 calls",
    });

    expect(result).toMatchObject({
      badgeLabel: "HELD · 5 · NAME",
      evidenceLine: "Contract drift · Scanner now prefers Aug 21 $260 calls",
      tone: "warning",
    });
  });

  it("uses green only for explicit strengthened evidence", () => {
    expect(
      presentScannerPositionMatch({
        match_type: "exact_contract",
        classification: "strengthened",
      })?.tone
    ).toBe("positive");
    expect(
      presentScannerPositionMatch({
        match_type: "exact_contract",
        classification: "portfolio_conflict",
      })?.tone
    ).toBe("warning");
    expect(
      presentScannerPositionMatch({
        match_type: "exact_contract",
        classification: "contradiction",
      })?.tone
    ).toBe("negative");
  });

  it("gracefully omits absent backend match data", () => {
    expect(presentScannerPositionMatch(undefined)).toBeNull();
  });

  it("surfaces an automatically rejected rescue roll", () => {
    const result = presentScannerPositionMatch({
      match_type: "same_symbol",
      held_contracts: 5,
      replacement_decision: {
        model_version: "replacement_rules_v1",
        status: "rejected",
        recommendation: "rescue_roll_rejected",
        action: "none",
        label: "Rescue roll rejected",
        summary: "A losing position would receive a higher hurdle.",
        confidence: "medium",
        implementation_ready: false,
        structure: {
          expiry_direction: "out",
          strike_direction: "up",
          directional_hurdle: "higher",
          label: "Up and out",
        },
        comparison: {
          held: {},
          candidate: {},
          change: { score: 6, dte: 28, strike: 5 },
        },
        gates: [],
        missing_inputs: [],
        journal_rule: "Close first.",
        automated_execution_enabled: false,
      },
    });

    expect(result).toMatchObject({
      badgeLabel: "HELD · 5 · NO ROLL",
      classificationLabel: "Rescue roll rejected",
      evidenceLine: "Rescue roll rejected · Up and out · score +6.0 · +28d",
      tone: "negative",
    });
    expect(result?.accessibleLabel).toContain("close and new entry remain separate");
  });

  it("differentiates a convexity harvest from an ordinary roll", () => {
    const base = {
      model_version: "replacement_rules_v1",
      status: "candidate",
      recommendation: "convexity_harvest_candidate",
      action: "partial_replace",
      label: "Convexity-harvest candidate",
      summary: "Harvest gains and retain convexity.",
      confidence: "medium",
      implementation_ready: false,
      structure: {
        expiry_direction: "out",
        strike_direction: "up",
        directional_hurdle: "higher",
        label: "Up and out",
      },
      comparison: { held: {}, candidate: {}, change: { dte: 28 } },
      gates: [],
      missing_inputs: [],
      journal_rule: "Close first.",
      automated_execution_enabled: false,
    };

    expect(
      presentScannerPositionMatch({
        match_type: "same_symbol",
        held_contracts: 3,
        replacement_decision: base,
      })
    ).toMatchObject({ badgeLabel: "HELD · 3 · HARVEST", tone: "positive" });
  });
});

describe("presentOptionMarketField", () => {
  it.each([
    ["supportive", false, "FIELD UP", "positive"],
    ["fading", false, "FIELD FADING", "warning"],
    ["contradictory", false, "CONFLICT", "negative"],
    ["mixed", false, "CONFLICT", "warning"],
    ["supportive", true, "SHOCK", "negative"],
  ] as const)("maps %s / shock %s to the grounded badge", (pathState, shock, badgeLabel, tone) => {
    expect(
      presentOptionMarketField({
        available: true,
        signals: { path_state: pathState, geometry_disorder_shock: shock },
      })
    ).toMatchObject({ badgeLabel, tone });
  });

  it("surfaces measured direction, strata, boundary, and explicit novelty limits", () => {
    const result = presentOptionMarketField(
      {
        available: true,
        timeframe: "1D",
        direction: { regime: "positive_strengthening", aligned_pressure: 18.25 },
        strata: { structure: 61.4 },
        price_action: { state: "upper_range" },
        signals: { path_state: "supportive" },
      },
      {
        available: true,
        familiarity: "not_scored",
        familiarity_reason: "Stable cross-review familiarity is not available.",
      }
    );

    expect(result).toMatchObject({
      badgeLabel: "FIELD UP",
      directionLabel: "Direction · Positive Strengthening",
      structureLabel: "Structure · 61.4",
      boundaryLabel: "Boundary · Upper Range",
      familiarityLabel: "Novelty · not scored",
      familiarityReason: "Stable cross-review familiarity is not available.",
      timeframe: "1D",
    });
    expect(result?.accessibleLabel).toContain("rank influence is zero");
  });

  it("accepts cached classification, hypotheses, quality, and aligned-direction aliases", () => {
    const result = presentOptionMarketField({
      quality: { available: true },
      classification: { path_state: "supportive", eventfulness: "shock" },
      hypotheses: { geometry_disorder_shock: true },
      direction: { option_aligned_pressure: -12.5, option_aligned_velocity: 4.25 },
      strata: { structure: 44 },
      price_action: { state: "lower_range" },
    });

    expect(result).toMatchObject({
      badgeLabel: "SHOCK",
      directionLabel: "Pressure · -12.5 / Δ +4.3",
      structureLabel: "Structure · 44.0",
      boundaryLabel: "Boundary · Lower Range",
    });
  });

  it("does not invent a field state for unavailable, missing, or legacy payloads", () => {
    expect(presentOptionMarketField(undefined)).toBeNull();
    expect(presentOptionMarketField({ available: false })).toBeNull();
    expect(presentOptionMarketField({ available: true, signals: { path_state: "unavailable" } })).toBeNull();
  });
});
