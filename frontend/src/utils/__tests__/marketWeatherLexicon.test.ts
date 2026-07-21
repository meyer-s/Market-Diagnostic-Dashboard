import { describe, expect, it } from "vitest";

import { buildMarketGlyphEncoding, describeMarketGlyph, marketStateColor } from "../marketWeatherLexicon";

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
});
