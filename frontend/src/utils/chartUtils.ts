import { formatDateTime } from "./styleUtils";
import { getFamilyColor } from "../theme/metricColors";

/**
 * Chart Configuration Utilities
 * 
 * Common chart configurations and formatters for recharts.
 */

/**
 * Common chart colors
 */
export const CHART_NEUTRAL = {
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis-line)",
  tick: "var(--chart-axis-tick)",
  label: "var(--chart-axis-tick)",
  text: "var(--field-text)",
  tooltipBg: "var(--chart-tooltip-bg)",
  tooltipBorder: "var(--chart-tooltip-border)",
  benchmark: getFamilyColor("benchmark"),
} as const;

export const CHART_MARGIN = {
  top: 10,
  right: 0,
  bottom: 20,
  left: 0,
} as const;

export const CHART_ANIMATION = {
  duration: 320,
  easing: "ease-in-out",
} as const;

/**
 * Get color based on state
 */
/**
 * Common X-axis configuration
 */
export const commonXAxisProps = {
  stroke: CHART_NEUTRAL.axis,
  tick: { fill: CHART_NEUTRAL.tick, fontSize: 12 },
  tickFormatter: (value: string) => {
    try {
      const date = new Date(value);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return value;
    }
  },
};

/**
 * Common Y-axis configuration
 */
export const commonYAxisProps = {
  stroke: CHART_NEUTRAL.axis,
  tick: { fill: CHART_NEUTRAL.tick, fontSize: 12 },
};

/**
 * Common CartesianGrid configuration
 */
export const commonGridProps = {
  strokeDasharray: "3 3",
  stroke: CHART_NEUTRAL.grid,
  opacity: 0.3,
};

/**
 * Common tooltip style
 */
export const commonTooltipStyle = {
  backgroundColor: CHART_NEUTRAL.tooltipBg,
  border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`,
  borderRadius: "0.375rem",
  color: CHART_NEUTRAL.text,
};

/**
 * Format value for tooltip display
 */
export function formatTooltipValue(value: number | string | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === 'number') {
    return value.toFixed(decimals);
  }
  return String(value);
}

/**
 * Format percentage for charts
 */
export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Format timestamp for tooltip
 */
export function formatTooltipTimestamp(timestamp: string): string {
  try {
    return formatDateTime(timestamp);
  } catch {
    return timestamp;
  }
}
