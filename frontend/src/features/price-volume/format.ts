import type { ActivityWeek } from "./types";

export function money(value: number | null | undefined, compact = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: 2,
  }).format(value);
}

export function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// Session dates are calendar labels, never instants in the browser's timezone.
export function sessionDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function refreshTime(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  // Older cached responses emitted UTC without an offset.
  const parsed = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

export function longestStreak(weeks: ActivityWeek[], direction: "positive" | "negative"): number {
  let longest = 0;
  let current = 0;
  let previous = NaN;
  for (const week of [...weeks].sort((a, b) => a.bucket.localeCompare(b.bucket))) {
    const timestamp = Date.parse(`${week.bucket}T00:00:00Z`);
    const matches = direction === "positive" ? week.signed_turnover_usd > 0 : week.signed_turnover_usd < 0;
    current = matches ? (timestamp - previous === 7 * 86400000 ? current + 1 : 1) : 0;
    longest = Math.max(longest, current);
    previous = timestamp;
  }
  return longest;
}

export function referenceRange(positive: number | null, negative: number | null, price: number | null) {
  if (positive == null || negative == null) return null;
  const low = Math.min(positive, negative);
  const high = Math.max(positive, negative);
  const position = price == null ? null : high === low ? (price < low ? 0 : price > high ? 100 : 50) : Math.max(0, Math.min(100, (price - low) / (high - low) * 100));
  return { low, high, lowLabel: positive <= negative ? "Positive-bar reference" : "Negative-bar reference", highLabel: positive <= negative ? "Negative-bar reference" : "Positive-bar reference", position, location: price == null ? "Price unavailable" : price < low ? "Below reference range" : price > high ? "Above reference range" : "Within reference range" };
}
