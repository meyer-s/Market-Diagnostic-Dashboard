import { describe, expect, it } from "vitest";

import {
  buildGroundedStateProfile,
  buildMarketGlyphEncoding,
  describeMarketGlyph,
  marketFieldReading,
  marketStateColor,
  robustFieldDeviations,
} from "../marketWeatherLexicon";

describe("market weather glyph grammar", () => {
  it("maps every field stratum onto a stable non-colour glyph carrier", () => {
    const quiet = buildMarketGlyphEncoding({
      pressure: -0.8,
      structure: 0.1,
      kinematics: 0.1,
      geometry: 0.1,
      information: 0.1,
      propagation: 0.1,
      cascade_bias: -0.7,
    });
    const active = buildMarketGlyphEncoding({
      pressure: 0.8,
      structure: 0.9,
      kinematics: 0.9,
      geometry: 0.9,
      information: 0.9,
      propagation: 0.9,
      cascade_bias: 0.7,
    });

    expect(active.coreRotation).not.toBe(quiet.coreRotation);
    expect(active.ringCount).toBeGreaterThan(quiet.ringCount);
    expect(active.facetCount).toBeGreaterThan(quiet.facetCount);
    expect(active.pulseWidth).toBeGreaterThan(quiet.pulseWidth);
    expect(active.textureDashes).toBeGreaterThan(quiet.textureDashes);
    expect(active.trailCount).toBeGreaterThan(quiet.trailCount);
    expect(active.cascadeTilt).toBeGreaterThan(quiet.cascadeTilt);
  });

  it("keeps machine colours and translation deterministic", () => {
    expect(marketStateColor("F.003")).toBe(marketStateColor("F.003"));
    expect(describeMarketGlyph({ pressure: 0.9, structure: 0.9, kinematics: 0.1, propagation: 0 })).toContain("rising");
  });

  it("grounds learned profiles in calibration-relative robust deviations", () => {
    const features = [
      { id: "pressure", calibration_median: 0.05, calibration_robust_scale: 0.1 },
      { id: "velocity", calibration_median: 0, calibration_robust_scale: 0.1 },
      { id: "structure", calibration_median: 0.5, calibration_robust_scale: 0.1 },
      { id: "information", calibration_median: 0.5, calibration_robust_scale: 0.1 },
      { id: "propagation", calibration_median: 0.5, calibration_robust_scale: 0.1 },
      { id: "volatility_carrier", calibration_median: 0.5, calibration_robust_scale: 0.1 },
      { id: "participation_carrier", calibration_median: 0.5, calibration_robust_scale: 0.1 },
    ];
    const values = {
      pressure: 0.25,
      velocity: 0.15,
      acceleration: 0,
      structure: 0.55,
      information: 0.45,
      propagation: 0.65,
      volatility_carrier: 0.1,
      participation_carrier: 0.5,
    };

    const deviations = robustFieldDeviations(values, features);
    const volatility = deviations.find((item) => item.id === "volatility_carrier");
    expect(volatility?.robustDeviation).toBeCloseTo(-4);

    const profile = buildGroundedStateProfile(values, features);
    expect(profile.headline).toBe("Positive pressure · strengthening");
    expect(profile.characteristic).toContain("volatility is 4.0 fit-spread units lower");
    expect(profile.summary).toContain("Organization 55/100");
  });

  it("uses explicit, interpretable readings instead of presenting indices as probabilities", () => {
    expect(marketFieldReading("pressure", 0.02)).toBe("positive");
    expect(marketFieldReading("participation_carrier", 0.3)).toBe("below baseline");
    expect(marketFieldReading("cascade_bias", 0.4)).toBe("toward slower horizons");
  });
});
