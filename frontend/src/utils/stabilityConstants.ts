/**
 * Stability Score Constants & Helpers
 * 
 * INVARIANT: All indicators output STABILITY SCORES (0-100)
 * - 100 = Maximum stability (best)
 * - 0 = Minimum stability (worst)
 * - Higher score ALWAYS means better market conditions
 * 
 * State Thresholds:
 * - GREEN: score >= 70 (Stable market conditions)
 * - YELLOW: 40 <= score < 70 (Caution signals)
 * - RED: score < 40 (Market stress)
 */

import { statePalette } from "../theme/metricColors";

export const STABILITY_THRESHOLDS = {
  RED_MAX: 40,
  YELLOW_MAX: 70,
} as const;

export type StabilityState = "GREEN" | "YELLOW" | "RED";

/**
 * Convert a stability score to a state classification.
 * 
 * @param score - Stability score (0-100, higher = better)
 * @returns State classification
 * 
 * @example
 * getStateFromScore(85) // => "GREEN"
 * getStateFromScore(55) // => "YELLOW"
 * getStateFromScore(25) // => "RED"
 */
export function getStateFromScore(score: number): StabilityState {
  if (score >= STABILITY_THRESHOLDS.YELLOW_MAX) return "GREEN";
  if (score >= STABILITY_THRESHOLDS.RED_MAX) return "YELLOW";
  return "RED";
}

/**
 * Get the color hex code for a state.
 */
export function getStateColor(state: StabilityState): string {
  switch (state) {
    case "GREEN":
      return statePalette.green;
    case "YELLOW":
      return statePalette.yellow;
    case "RED":
      return statePalette.red;
    default:
      return statePalette.neutral;
  }
}

/**
 * Get Tailwind CSS classes for a state badge.
 */
export function getStateBadgeClasses(state: StabilityState): string {
  switch (state) {
    case "GREEN":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "YELLOW":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "RED":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-stealth-500/20 text-stealth-400 border-stealth-500/30";
  }
}

/**
 * State descriptions for UI display.
 */
export const STATE_DESCRIPTIONS = {
  GREEN: {
    label: "GREEN",
    range: `Stability Score: >= ${STABILITY_THRESHOLDS.YELLOW_MAX}`,
    description:
      "Market conditions are stable. Low volatility, healthy growth, minimal systemic risks.",
  },
  YELLOW: {
    label: "YELLOW",
    range: `Stability Score: ${STABILITY_THRESHOLDS.RED_MAX}-${STABILITY_THRESHOLDS.YELLOW_MAX - 1}`,
    description:
      "Market shows caution signals. Increased volatility, mixed indicators, elevated monitoring required.",
  },
  RED: {
    label: "RED",
    range: `Stability Score: < ${STABILITY_THRESHOLDS.RED_MAX}`,
    description:
      "Market under stress. High volatility, tighter financial conditions, and elevated systemic concerns.",
  },
} as const;
