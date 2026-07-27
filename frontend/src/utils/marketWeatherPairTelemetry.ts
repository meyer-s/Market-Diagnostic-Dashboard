import { trackEvent } from "./analytics";

const PAIR_TELEMETRY_VERSION = "pair_product_telemetry_v1";
const LAST_VISIBLE_PAIR_KEY = "market_weather_last_visible_pair";
const DOWNSTREAM_WINDOW_MS = 2 * 60 * 60 * 1000;

type PairTelemetryValue = boolean | number | string | null | undefined;

interface VisiblePairMarker {
  comparisonHash: string;
  markedAt: number;
  timeframe: string;
}

function compactHash(value: string): string {
  return value.slice(0, 16);
}

export function trackPairEvent(
  eventName:
    | "pair_audit_opened"
    | "pair_basis_changed"
    | "pair_coordinate_selected"
    | "pair_field_opened"
    | "pair_live_recipe_copied"
    | "pair_overview_visible"
    | "pair_receipt_exported"
    | "pair_result_rendered"
    | "pair_surface_second_frame"
    | "pair_summary_copied",
  comparisonHash: string,
  values: Record<string, PairTelemetryValue> = {},
): void {
  trackEvent(eventName, {
    pair_telemetry_version: PAIR_TELEMETRY_VERSION,
    comparison_hash_prefix: compactHash(comparisonHash),
    ...values,
  });
}

export function markPairOverviewVisible(
  comparisonHash: string,
  timeframe: string,
): void {
  if (typeof window === "undefined") return;
  const marker: VisiblePairMarker = {
    comparisonHash: compactHash(comparisonHash),
    markedAt: Date.now(),
    timeframe,
  };
  try {
    window.sessionStorage.setItem(LAST_VISIBLE_PAIR_KEY, JSON.stringify(marker));
  } catch {
    // Analytics must never block the research surface when storage is unavailable.
  }
}

export function trackSubsequentOptionsOpen(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(LAST_VISIBLE_PAIR_KEY);
    if (!raw) return;
    const marker = JSON.parse(raw) as Partial<VisiblePairMarker>;
    if (
      typeof marker.markedAt !== "number"
      || typeof marker.comparisonHash !== "string"
      || Date.now() - marker.markedAt > DOWNSTREAM_WINDOW_MS
    ) {
      window.sessionStorage.removeItem(LAST_VISIBLE_PAIR_KEY);
      return;
    }
    trackEvent("pair_subsequent_options_opened", {
      pair_telemetry_version: PAIR_TELEMETRY_VERSION,
      comparison_hash_prefix: marker.comparisonHash,
      source_timeframe: marker.timeframe ?? "unknown",
      elapsed_seconds: Math.max(0, Math.round((Date.now() - marker.markedAt) / 1000)),
    });
    window.sessionStorage.removeItem(LAST_VISIBLE_PAIR_KEY);
  } catch {
    // Corrupt or unavailable session storage is non-fatal and carries no authority.
  }
}
