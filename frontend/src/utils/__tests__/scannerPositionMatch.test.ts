import { describe, expect, it } from "vitest";

import { presentScannerPositionMatch } from "../scannerPositionMatch";

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
