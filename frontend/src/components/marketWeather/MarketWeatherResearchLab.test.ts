import { describe, expect, it } from "vitest";

import { resolveAnalogPresentation } from "./MarketWeatherResearchLab";

describe("resolveAnalogPresentation", () => {
  it("withholds outcomes when same-Form calibration support is insufficient", () => {
    const presentation = resolveAnalogPresentation({
      status: "insufficient_calibration_support",
      legacyTailFlag: false,
      support: 12,
      minimumSupport: 20,
    });

    expect(presentation.withhold).toBe(true);
    expect(presentation.holdoutTitle).toBe("Similar-holdout outcomes unavailable");
    expect(presentation.summary).toContain("Only 12");
    expect(presentation.holdoutMessage).toContain("not shown");
  });

  it("withholds outcomes for an extreme calibration-distance tail", () => {
    const presentation = resolveAnalogPresentation({
      status: "withheld_extreme_calibration_tail",
      legacyTailFlag: false,
      support: 47,
      minimumSupport: 20,
    });

    expect(presentation.withhold).toBe(true);
    expect(presentation.holdoutTitle).toBe("Similar-holdout outcomes withheld");
    expect(presentation.holdoutMessage).toContain("extreme calibration-distance tail");
  });

  it("treats the canonical analog status as authoritative over legacy aliases", () => {
    const presentation = resolveAnalogPresentation({
      status: "descriptive_reference_available",
      legacyTailFlag: true,
      support: 47,
      minimumSupport: 20,
    });

    expect(presentation.withhold).toBe(false);
    expect(presentation.holdoutTitle).toBe("What followed similar holdout bars");
  });
});
