export interface MarketGlyphEncoding {
  pressure: number;
  direction: "rising" | "falling" | "level";
  coreRotation: number;
  coreScale: number;
  structureRadius: number;
  ringCount: number;
  facetCount: number;
  pulseWidth: number;
  textureDashes: number;
  trailCount: number;
  trailLength: number;
  cascadeTilt: number;
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function clampUnit(value: number | undefined): number {
  return Math.min(1, Math.max(0, finite(value)));
}

export function clampSigned(value: number | undefined): number {
  return Math.min(1, Math.max(-1, finite(value)));
}

/**
 * Convert a learned centroid into a repeatable, redundant visual grammar.
 * Every feature has a non-colour carrier so the glyph survives greyscale and
 * common colour-vision deficiencies.
 */
export function buildMarketGlyphEncoding(centroid: Record<string, number>): MarketGlyphEncoding {
  const pressure = clampSigned(centroid.pressure);
  const structure = clampUnit(centroid.structure);
  const kinematics = clampUnit(centroid.kinematics);
  const geometry = clampUnit(centroid.geometry);
  const information = clampUnit(centroid.information);
  const propagation = clampUnit(centroid.propagation);
  const cascadeBias = clampSigned(centroid.cascade_bias);

  return {
    pressure,
    direction: pressure > 0.08 ? "rising" : pressure < -0.08 ? "falling" : "level",
    coreRotation: pressure > 0.08 ? -90 : pressure < -0.08 ? 90 : 0,
    coreScale: 0.68 + Math.abs(pressure) * 0.5,
    structureRadius: 43 + structure * 23,
    ringCount: structure > 0.72 ? 3 : structure > 0.38 ? 2 : 1,
    facetCount: Math.round(3 + geometry * 7),
    pulseWidth: 1.2 + kinematics * 4.8,
    textureDashes: Math.round(2 + information * 14),
    trailCount: Math.round(propagation * 4),
    trailLength: 12 + propagation * 32,
    cascadeTilt: cascadeBias * 28,
  };
}

export function marketStateColor(stateId: string): string {
  const palette = ["#5eead4", "#60a5fa", "#a78bfa", "#fbbf24", "#fb7185", "#34d399", "#f472b6"];
  let hash = 0;
  for (const character of stateId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export function describeMarketGlyph(centroid: Record<string, number>): string {
  const glyph = buildMarketGlyphEncoding(centroid);
  const organization = clampUnit(centroid.structure) > 0.66 ? "organized" : clampUnit(centroid.structure) < 0.34 ? "diffuse" : "forming";
  const motion = clampUnit(centroid.kinematics) > 0.66 ? "high-motion" : clampUnit(centroid.kinematics) < 0.34 ? "quiet" : "active";
  const propagation = glyph.trailCount >= 3 ? "strongly propagating" : glyph.trailCount === 0 ? "stationary" : "propagating";
  return `${glyph.direction}, ${organization}, ${motion}, ${propagation}`;
}
