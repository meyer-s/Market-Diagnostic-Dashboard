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

  it("surfaces measured direction, trend agreement, boundary, and explicit novelty limits", () => {
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
      trendAgreementLabel: "Trend + agreement · 61/100",
      boundaryLabel: "Boundary · Upper Range",
      familiarityLabel: "Novelty · not scored",
      familiarityReason: "Stable cross-review familiarity is not available.",
      timeframe: "1D",
    });
    expect(result?.accessibleLabel).toContain("No rank, veto, verdict, size, or execution authority");
    expect(result?.accessibleLabel).toContain("May advise confidence and review priority");
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
      trendAgreementLabel: "Trend + agreement · 44/100",
      boundaryLabel: "Boundary · Lower Range",
    });
  });

  it("does not invent a field state for unavailable, missing, or legacy payloads", () => {
    expect(presentOptionMarketField(undefined)).toBeNull();
    expect(presentOptionMarketField({ available: false })).toBeNull();
    expect(presentOptionMarketField({ available: true, signals: { path_state: "unavailable" } })).toBeNull();
  });

  it("presents canonical authority, signed exposure alignment, initialization, and applied advisory effects", () => {
    const result = presentOptionMarketField(
      {
        available: true,
        completed_bars: 80,
        signals: { path_state: "supportive" },
        authority: {
          scanner_rank: "none",
          hard_veto: "none",
          manager_verdict: "none",
          target_size: "none",
          assessment_confidence: "advisory",
          review_priority: "advisory",
          automated_execution: "none",
        },
        alignment: {
          supported: true,
          basis: "signed_delta",
          scope: "explicit_exposure",
          directional_exposure_sign: -1,
          assumptions: [],
        },
        initialization: {
          completed_bars: 80,
          maximum_horizon_bars: 48,
          minimum_observed_window_bars: 49,
          minimum_input_bars: 60,
          minimum_input_satisfied: true,
          initialization_target_bars: 96,
          initialization_target_covered: false,
          initialization_status: "minimum_satisfied",
          bars_needed_to_initialization_target: 16,
          target_warmup_bars: 96,
          warmup_complete: false,
          status: "provisional",
          bars_needed: 16,
        },
        semantic_revision: "1.2",
      },
      null,
      {
        confidence: { before: "high", after: "medium", changed: true },
        urgency: { before: "normal", after: "due", changed: true },
        rank_changed: false,
        veto_changed: false,
        verdict_changed: false,
        target_size_changed: false,
        execution_authority: "none",
      }
    );

    expect(result).toMatchObject({
      badgeLabel: "FIELD UP",
      tone: "warning",
      authorityLabel: "No rank, veto, verdict, size, or execution authority",
      advisoryEffectsLabel: "Advisory applied · confidence and review priority",
      alignmentLabel: "Alignment · Signed Delta",
      alignmentCaveat: null,
      maturityStatus: "provisional",
      maturityLabel: "Initialization · target not covered (80/96 bars; 16 needed)",
      semanticRevision: "1.2",
    });
  });

  it("honors the v1.2 canonical structure, scaling, and input-quality payload contract", () => {
    const result = presentOptionMarketField({
      available: true,
      semantic_revision: "1.2",
      signals: { path_state: "supportive" },
      // The canonical component must win over the legacy v1 strata alias.
      structure_components: {
        activity: 0.41,
        horizon_agreement: 0.82,
        trend_agreement_composite: 0.734,
        display_organization: 0.68,
      },
      strata: { structure: 0.11 },
      scaling_reference: {
        stationary_finite_variance_reference: 0.5,
        latest_exponent: 0.63,
        latest_excess: 0.13,
        valid: true,
        reason: null,
        exact_arithmetic_contract: {
          nonnegative: true,
          floating_point_tolerance: 1e-10,
          defensive_storage_bounds: [-2, 2],
          violation_status: "invalid",
        },
      },
      input_quality: {
        status: "limited",
        rows_received: 120,
        rows_used: 119,
        completed_rows_used: 119,
        dropped: {
          bad_timestamp: 0,
          nonfinite_ohlc: 0,
          nonpositive_ohlc: 0,
          inconsistent_ohlc: 0,
          duplicate_timestamp: 1,
        },
        volume: {
          available: true,
          carrier_usable: true,
          available_observations: 95,
          positive_observations: 95,
          coverage: 0.798319,
          invalid_observations: 24,
        },
        warnings: ["invalid_price_rows_dropped"],
      },
    });

    expect(result).toMatchObject({
      trendAgreementLabel: "Trend + agreement · 73/100",
      scalingLabel: "Scaling · 0.63 (+0.13 vs 0.50)",
      scalingCaveat: null,
      inputQualityLabel: "Input · limited · 119/120 rows",
      diagnosticsLabel: "Scaling · 0.63 (+0.13 vs 0.50) · Input · limited · 119/120 rows",
      semanticRevision: "1.2",
    });
    expect(result?.inputQualityCaveat).toContain("1 price row rejected");
    expect(result?.inputQualityCaveat).toContain("invalid price rows dropped");
    expect(result?.inputQualityCaveat).toContain("volume coverage 80%");
    expect(result?.accessibleLabel).toContain("Scaling · 0.63 (+0.13 vs 0.50)");
  });

  it("discloses a degenerate scaling path without manufacturing an exponent", () => {
    const result = presentOptionMarketField({
      available: true,
      signals: { path_state: "mixed" },
      scaling_reference: {
        stationary_finite_variance_reference: 0.5,
        latest_exponent: null,
        latest_excess: null,
        valid: false,
        reason: "zero_realized_variance",
      },
      input_quality: {
        status: "valid",
        rows_received: 96,
        rows_used: 96,
        warnings: [],
      },
    });

    expect(result).toMatchObject({
      scalingLabel: "Scaling · unavailable",
      scalingCaveat: "Volatility scaling is unavailable: zero realized variance",
      inputQualityLabel: "Input · valid · 96/96 rows",
      inputQualityCaveat: null,
    });
  });

  it("withholds a negative scaling estimate as a quality flag", () => {
    const result = presentOptionMarketField({
      available: true,
      signals: { path_state: "supportive" },
      scaling_reference: {
        stationary_finite_variance_reference: 0.5,
        latest_exponent: -0.12,
        latest_excess: -0.62,
        valid: true,
        reason: null,
        exact_arithmetic_contract: {
          nonnegative: true,
          floating_point_tolerance: 1e-10,
          defensive_storage_bounds: [-2, 2],
          violation_status: "invalid",
        },
      },
    });

    expect(result).toMatchObject({
      scalingLabel: "Scaling · quality flag",
    });
    expect(result?.scalingCaveat).toContain("estimate withheld");
    expect(result?.scalingCaveat).toContain("not interpreted as a market signal");
  });

  it("renders an unavailable field as warming when completed history is insufficient", () => {
    const result = presentOptionMarketField({
      available: false,
      initialization: {
        completed_bars: 40,
        maximum_horizon_bars: 48,
        minimum_observed_window_bars: 49,
        minimum_input_bars: 60,
        minimum_input_satisfied: false,
        initialization_target_bars: 96,
        initialization_target_covered: false,
        initialization_status: "minimum_not_satisfied",
        bars_needed_to_minimum_input: 20,
        bars_needed_to_initialization_target: 56,
        target_warmup_bars: 96,
        warmup_complete: false,
        status: "insufficient",
        bars_needed: 56,
      },
    });

    expect(result).toMatchObject({
      badgeLabel: "FIELD WARMING",
      tone: "neutral",
      pathStateLabel: "Field history insufficient",
      maturityStatus: "insufficient",
      maturityLabel: "Initialization · minimum input not met (40/60 bars)",
    });
  });

  it("flags unsupported complex-position alignment without showing an aligned pressure", () => {
    const result = presentOptionMarketField({
      available: true,
      signals: { path_state: "contradictory" },
      direction: { option_aligned_pressure: -22 },
      alignment: {
        supported: false,
        basis: "unsupported",
        scope: "vertical_spread",
        assumptions: ["An explicit signed delta is required for multi-leg exposure."],
      },
    });

    expect(result).toMatchObject({
      badgeLabel: "CONFLICT",
      alignmentLabel: "Alignment · unsupported",
      alignmentCaveat: "An explicit signed delta is required for multi-leg exposure.",
      directionLabel: null,
    });
    expect(result?.accessibleLabel).toContain("explicit signed delta");
  });

  it("keeps legacy call/put snapshots visible while disclosing their long-single-leg assumption", () => {
    const result = presentOptionMarketField({
      available: true,
      option_type: "call",
      completed_bars: 80,
      signals: { path_state: "supportive" },
      direction: { option_aligned_pressure: 12 },
    });

    expect(result).toMatchObject({
      badgeLabel: "FIELD UP",
      tone: "warning",
      alignmentLabel: "Alignment · legacy side proxy",
      maturityStatus: "provisional",
    });
    expect(result?.alignmentCaveat).toContain("long, directional single-leg");
    expect(result?.alignmentCaveat).toContain("short, spread, hedge, or multi-leg");

    const canonicalLegacy = presentOptionMarketField({
      available: true,
      signals: { path_state: "supportive" },
      alignment: {
        supported: true,
        basis: "legacy_long_single_leg_option_type",
        scope: "long_single_leg",
        directional_exposure_sign: 1,
        assumptions: ["Legacy callers provide option type but not position action."],
      },
    });
    expect(canonicalLegacy?.alignmentCaveat).toContain("Legacy callers provide option type");
    expect(canonicalLegacy?.alignmentCaveat).toContain("short, spread, hedge, or multi-leg");
  });

  it("raises a visible contract warning if protected authority metadata is ever enabled", () => {
    const result = presentOptionMarketField({
      available: true,
      signals: { path_state: "supportive" },
      authority: { scanner_rank: "weighted", automated_execution: "none" },
    });

    expect(result?.authorityCaveat).toContain("metadata conflicts with the review-only contract");
    expect(result?.accessibleLabel).toContain("do not use this field to rank, veto, grade, size, or execute");
  });
});
