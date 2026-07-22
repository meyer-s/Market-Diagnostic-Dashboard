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

export type MarketFieldMetricId =
  | "pressure"
  | "velocity"
  | "acceleration"
  | "jerk"
  | "snap"
  | "structure"
  | "kinematics"
  | "geometry"
  | "information"
  | "propagation"
  | "cascade_bias"
  | "scaling_exponent"
  | "volatility_carrier"
  | "participation_carrier"
  | "liquidity_stress_carrier";

export interface MarketFieldMetricDefinition {
  id: MarketFieldMetricId;
  label: string;
  shortLabel: string;
  scale: string;
  definition: string;
  family: "field" | "carrier";
}

export interface MarketWeatherCalibrationFeature {
  id: string;
  calibration_median: number;
  calibration_robust_scale: number;
}

export interface MarketFieldDeviation {
  id: MarketFieldMetricId;
  label: string;
  value: number;
  median: number;
  robustScale: number;
  robustDeviation: number;
}

export interface GroundedMarketStateProfile {
  headline: string;
  characteristic: string;
  summary: string;
  direction: "positive" | "negative" | "neutral";
  deviations: MarketFieldDeviation[];
}

export const MARKET_FIELD_METRICS: MarketFieldMetricDefinition[] = [
  {
    id: "pressure",
    label: "Directional pressure",
    shortLabel: "Direction",
    scale: "−100 negative to +100 positive",
    definition: "Horizon-weighted trend state. Zero means the multi-horizon field is directionally balanced.",
    family: "field",
  },
  {
    id: "velocity",
    label: "Pressure change",
    shortLabel: "Change",
    scale: "−100 falling to +100 rising",
    definition: "The causal first change in directional pressure, scaled against its recent magnitude.",
    family: "field",
  },
  {
    id: "acceleration",
    label: "Pressure acceleration",
    shortLabel: "Acceleration",
    scale: "−100 negative to +100 positive",
    definition: "The causal change in pressure change, normalized against the recent magnitude of those changes.",
    family: "field",
  },
  {
    id: "jerk",
    label: "Acceleration change",
    shortLabel: "Jerk",
    scale: "−100 negative to +100 positive",
    definition: "The causal change in pressure acceleration, normalized against its recent magnitude.",
    family: "field",
  },
  {
    id: "snap",
    label: "Jerk change",
    shortLabel: "Snap",
    scale: "−100 negative to +100 positive",
    definition: "The causal change in jerk, normalized against its recent magnitude; this is the most noise-sensitive derivative used by the state model.",
    family: "field",
  },
  {
    id: "structure",
    label: "Trend-agreement composite",
    shortLabel: "Trend + agreement",
    scale: "0 to 100 engineered composite; a flat coherent field anchors at 42",
    definition: "A 58% directional-activity and 42% neighboring-horizon-agreement blend. Agreement at zero activity creates a 42-point formula floor; this is not standalone evidence of an organized trend.",
    family: "field",
  },
  {
    id: "kinematics",
    label: "Rate of reorganization",
    shortLabel: "Reorganization",
    scale: "0 quiet to 100 fast-changing",
    definition: "Combined absolute velocity, acceleration, jerk, and snap of the pressure field.",
    family: "field",
  },
  {
    id: "geometry",
    label: "Boundary activity",
    shortLabel: "Boundaries",
    scale: "0 smooth to 100 highly curved",
    definition: "Scale gradients, curvature, mixed derivatives, and boundary energy across horizons.",
    family: "field",
  },
  {
    id: "information",
    label: "Information / ordinal disorder",
    shortLabel: "Information",
    scale: "0 ordered to 100 disordered",
    definition: "Causal permutation entropy blended with disagreement and motion energy in the field.",
    family: "field",
  },
  {
    id: "propagation",
    label: "Cross-horizon spread",
    shortLabel: "Propagation",
    scale: "0 local to 100 broad",
    definition: "Strength of a state change moving through neighboring time horizons.",
    family: "field",
  },
  {
    id: "cascade_bias",
    label: "Propagation direction",
    shortLabel: "Cascade",
    scale: "−100 toward faster to +100 toward slower horizons",
    definition: "Weighted direction of a moving pressure front across the log-horizon axis.",
    family: "field",
  },
  {
    id: "scaling_exponent",
    label: "Volatility scaling slope",
    shortLabel: "Scaling slope",
    scale: "−2 to +2 log-log slope; 0.5 is the square-root-of-time reference",
    definition: "Local slope of log realized volatility versus log horizon. A stationary finite-variance reference is near 0.5; degenerate zero-variation paths are not interpretable. This is not a Hurst exponent.",
    family: "field",
  },
  {
    id: "volatility_carrier",
    label: "Realized volatility",
    shortLabel: "Volatility",
    scale: "50 equals its trailing causal baseline",
    definition: "Multi-horizon realized volatility relative to its own trailing baseline.",
    family: "carrier",
  },
  {
    id: "participation_carrier",
    label: "Volume participation",
    shortLabel: "Participation",
    scale: "50 equals its trailing causal baseline",
    definition: "Average trading volume across horizons relative to its own trailing baseline.",
    family: "carrier",
  },
  {
    id: "liquidity_stress_carrier",
    label: "Liquidity stress",
    shortLabel: "Liquidity stress",
    scale: "50 equals its trailing causal baseline",
    definition: "An Amihud-like price-impact measure from OHLCV data relative to its trailing baseline.",
    family: "carrier",
  },
];

const STATE_PROFILE_IDS: MarketFieldMetricId[] = [
  "pressure",
  "velocity",
  "acceleration",
  "jerk",
  "snap",
  "structure",
  "kinematics",
  "geometry",
  "information",
  "propagation",
  "cascade_bias",
  "scaling_exponent",
  "volatility_carrier",
  "participation_carrier",
  "liquidity_stress_carrier",
];

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function clampUnit(value: number | undefined): number {
  return Math.min(1, Math.max(0, finite(value)));
}

export function clampSigned(value: number | undefined): number {
  return Math.min(1, Math.max(-1, finite(value)));
}

export function robustFieldDeviations(
  values: Record<string, number>,
  features: MarketWeatherCalibrationFeature[],
): MarketFieldDeviation[] {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const definitionById = new Map(MARKET_FIELD_METRICS.map((metric) => [metric.id, metric]));

  return STATE_PROFILE_IDS.map((id) => {
    const feature = featureById.get(id);
    const metric = definitionById.get(id)!;
    const value = finite(values[id]);
    const median = finite(feature?.calibration_median);
    const robustScale = Math.max(Math.abs(finite(feature?.calibration_robust_scale)), 1e-9);
    return {
      id,
      label: metric.shortLabel,
      value,
      median,
      robustScale,
      robustDeviation: (value - median) / robustScale,
    };
  });
}

function relativeCharacteristic(deviations: MarketFieldDeviation[]): string {
  const candidates = deviations
    .filter((item) => !["pressure", "velocity"].includes(item.id))
    .sort((left, right) => Math.abs(right.robustDeviation) - Math.abs(left.robustDeviation));
  const distinctive = candidates[0];
  if (!distinctive) return "no calibrated comparison is available";
  const direction = distinctive.robustDeviation > 0 ? "higher" : "lower";
  if (distinctive.robustDeviation === 0) return `${distinctive.label.toLowerCase()} is at its calibration median`;
  return `${distinctive.label.toLowerCase()} is ${Math.abs(distinctive.robustDeviation).toFixed(1)} fit-spread units ${direction}`;
}

export function buildGroundedStateProfile(
  values: Record<string, number>,
  features: MarketWeatherCalibrationFeature[],
): GroundedMarketStateProfile {
  const pressure = clampSigned(values.pressure);
  const velocity = clampSigned(values.velocity);
  const acceleration = clampSigned(values.acceleration);
  const alignedVelocity = pressure * velocity;
  const alignedAcceleration = pressure * acceleration;
  const direction: GroundedMarketStateProfile["direction"] = pressure > 0
    ? "positive"
    : pressure < 0
      ? "negative"
      : "neutral";
  const directionLabel = direction === "positive"
    ? "Positive pressure"
    : direction === "negative"
      ? "Negative pressure"
      : "Balanced pressure";

  let motionLabel = "unchanged";
  if (direction === "neutral") motionLabel = velocity > 0 ? "shifting positive" : velocity < 0 ? "shifting negative" : "unchanged";
  else if (alignedVelocity > 0) motionLabel = "strengthening";
  else if (alignedVelocity < 0) motionLabel = "fading";
  else if (alignedAcceleration < 0) motionLabel = "decelerating";
  else if (alignedAcceleration > 0) motionLabel = "re-accelerating";

  const deviations = robustFieldDeviations(values, features);
  const characteristic = relativeCharacteristic(deviations);
  const trendAgreement = Math.round(clampUnit(values.structure) * 100);
  const propagation = Math.round(clampUnit(values.propagation) * 100);
  const information = Math.round(clampUnit(values.information) * 100);

  return {
    headline: `${directionLabel} · ${motionLabel}`,
    characteristic,
    summary: `Trend + horizon agreement ${trendAgreement}/100 (flat coherent reference 42), cross-horizon propagation ${propagation}/100, and information/ordinal disorder ${information}/100; ${characteristic}.`,
    direction,
    deviations,
  };
}

export function marketFieldReading(id: MarketFieldMetricId, value: number): string {
  const bounded = id === "pressure" || id === "velocity" || id === "cascade_bias"
    ? clampSigned(value)
    : clampUnit(value);
  if (id === "pressure") return bounded > 0 ? "positive" : bounded < 0 ? "negative" : "balanced";
  if (id === "velocity") return bounded > 0 ? "rising" : bounded < 0 ? "falling" : "steady";
  if (id === "cascade_bias") return bounded > 0 ? "toward slower horizons" : bounded < 0 ? "toward faster horizons" : "no clear direction";
  if (["volatility_carrier", "participation_carrier", "liquidity_stress_carrier"].includes(id)) {
    return bounded > 0.5 ? "above baseline" : bounded < 0.5 ? "below baseline" : "at baseline";
  }
  return bounded > 0.5 ? "above scale midpoint" : bounded < 0.5 ? "below scale midpoint" : "at scale midpoint";
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
  const organization = clampUnit(centroid.structure) > 0.66 ? "high trend/agreement composite" : clampUnit(centroid.structure) < 0.34 ? "low trend/agreement composite" : "mid trend/agreement composite";
  const motion = clampUnit(centroid.kinematics) > 0.66 ? "high-motion" : clampUnit(centroid.kinematics) < 0.34 ? "quiet" : "active";
  const propagation = glyph.trailCount >= 3 ? "strongly propagating" : glyph.trailCount === 0 ? "stationary" : "propagating";
  return `${glyph.direction}, ${organization}, ${motion}, ${propagation}`;
}
