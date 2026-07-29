/**
 * Styling Constants and Utilities
 * 
 * Centralized definitions for colors, styles, and formatting utilities.
 */

const EASTERN_TIMEZONE = "America/New_York";
const TIMEZONE_SUFFIX_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const WEEKDAY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const parseTimestamp = (dateInput: string | Date): Date => {
  if (dateInput instanceof Date) {
    return dateInput;
  }

  const trimmed = dateInput.trim();
  if (!trimmed) {
    return new Date(NaN);
  }

  const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;

  if (DATE_ONLY_RE.test(normalized)) {
    const [year, month, day] = normalized.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  const hasTimezone = TIMEZONE_SUFFIX_RE.test(normalized);
  if (hasTimezone) {
    return new Date(normalized);
  }

  return new Date(`${normalized}Z`);
};

/**
 * State color configurations for indicators
 */
export const STATE_COLORS = {
  GREEN: {
    bg: "bg-green-900/20",
    border: "border-green-700",
    text: "text-green-400",
    full: "bg-green-900/20 border-green-700 text-green-400",
  },
  YELLOW: {
    bg: "bg-yellow-900/20",
    border: "border-yellow-700",
    text: "text-yellow-400",
    full: "bg-yellow-900/20 border-yellow-700 text-yellow-400",
  },
  RED: {
    bg: "bg-red-900/20",
    border: "border-red-700",
    text: "text-red-400",
    full: "bg-red-900/20 border-red-700 text-red-400",
  },
  UNKNOWN: {
    bg: "bg-stealth-900/20",
    border: "border-stealth-700",
    text: "text-stealth-400",
    full: "bg-stealth-900/20 border-stealth-700 text-stealth-400",
  },
} as const;

export type StateType = keyof typeof STATE_COLORS;

/**
 * Get state color classes for a given state
 */
export function getStateColors(state: StateType | string) {
  const normalizedState = (state || "UNKNOWN").toUpperCase() as StateType;
  return STATE_COLORS[normalizedState] || STATE_COLORS.UNKNOWN;
}

/**
 * Get the full className string for a state badge
 */
export function getStateBadgeClass(state: StateType | string): string {
  return `px-2 py-1 rounded text-xs font-semibold border ${getStateColors(state).full}`;
}

/**
 * Common button style configurations
 */
export const BUTTON_STYLES = {
  primary: "bg-stealth-700 text-stealth-200 hover:bg-stealth-600 hover:text-stealth-100",
  disabled: "bg-stealth-700 text-stealth-400 cursor-not-allowed",
  toggle: {
    active: "bg-stealth-600 text-stealth-100",
    inactive: "text-stealth-400 hover:text-stealth-200",
  },
} as const;

/**
 * Common card/container styles
 */
export const CARD_STYLES = {
  base: "primary-card",
  hover: "primary-card-hover",
  info: "secondary-card",
} as const;

/**
 * Format a number with appropriate decimal places
 */
export function formatNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "—";
  }
  return value.toFixed(decimals);
}

/**
 * Format a date string for display
 */
export function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return "-";
  
  try {
    const date = typeof dateString === 'string' ? parseTimestamp(dateString) : dateString;
    return DATE_FORMATTER.format(date);
  } catch {
    return "-";
  }
}

/**
 * Format a time string for display (Eastern Time, HH:MM)
 */
export function formatTime(dateString: string | Date | null | undefined): string {
  if (!dateString) return "-";

  try {
    const date = typeof dateString === 'string' ? parseTimestamp(dateString) : dateString;
    return TIME_FORMATTER.format(date);
  } catch {
    return "-";
  }
}

/**
 * Format a date string for display with time
 */
export function formatDateTime(dateString: string | Date | null | undefined): string {
  if (!dateString) return "-";
  
  try {
    const date = typeof dateString === 'string' ? parseTimestamp(dateString) : dateString;
    return DATE_TIME_FORMATTER.format(date);
  } catch {
    return "-";
  }
}

/**
 * Format a date string with weekday and time (Eastern Time)
 */
export function formatDateTimeWithWeekday(dateString: string | Date | null | undefined): string {
  if (!dateString) return "-";

  try {
    const date = typeof dateString === 'string' ? parseTimestamp(dateString) : dateString;
    return WEEKDAY_TIME_FORMATTER.format(date);
  } catch {
    return "-";
  }
}
