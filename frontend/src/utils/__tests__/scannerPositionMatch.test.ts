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
});
