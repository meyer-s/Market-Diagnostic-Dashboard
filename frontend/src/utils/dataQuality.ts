import type { EvidenceState } from "./evidenceState";

export interface DataQualityMetadata {
  status?: string;
  stale?: boolean;
  reason?: string | null;
  snapshot_cached_at?: string;
  snapshot_age_seconds?: number;
  coverage_live?: number;
  coverage_total?: number;
  representative?: boolean;
  representative_exchange_coverage?: number;
  representative_exchange_total?: number;
  [key: string]: string | number | boolean | null | undefined;
}

const REASON_COPY: Record<string, string> = {
  analyst_component_refresh_failed: "the analyst component refresh failed",
  live_vix_provider_unavailable: "the live VIX source was unavailable",
  public_credit_refresh_failed: "the public-credit refresh failed",
  breadth_refresh_incomplete: "the live breadth refresh was incomplete",
  real_estate_overview_refresh_failed: "the real-estate overview refresh failed",
  real_estate_overview_refresh_incomplete: "the real-estate overview refresh was incomplete",
  real_estate_context_refresh_failed: "the real-estate context refresh failed",
  real_estate_context_refresh_incomplete: "the real-estate context refresh was incomplete",
  commercial_real_estate_refresh_failed: "the commercial real-estate refresh failed",
  commercial_real_estate_refresh_incomplete:
    "the commercial real-estate refresh was incomplete",
};

export function dataQualityEvidenceState(
  quality: DataQualityMetadata | null | undefined,
): EvidenceState | null {
  if (!quality) return null;
  if (quality.stale || quality.status === "stale") return "stale";
  if (quality.status === "complete") return "complete";
  if (quality.status === "partial" || quality.status === "unavailable") return "partial";
  return null;
}

export function mergeDataQualityEvidenceState(
  baseState: EvidenceState,
  quality: DataQualityMetadata | null | undefined,
): EvidenceState {
  const qualityState = dataQualityEvidenceState(quality);
  if (!qualityState || qualityState === "complete") return baseState;
  if (baseState === "loading" || baseState === "error" || baseState === "empty") {
    return baseState;
  }
  return qualityState;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 24 * 60 * 60) {
    const hours = seconds / (60 * 60);
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} hours`;
  }
  const days = seconds / (24 * 60 * 60);
  return `${days >= 10 ? Math.round(days) : days.toFixed(1)} days`;
}

function formatCachedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function reasonCopy(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (
    REASON_COPY[reason] ??
    reason
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .replace(/^./, (letter) => letter.toLowerCase())
  );
}

export function describeDataQuality(
  subject: string,
  quality: DataQualityMetadata | null | undefined,
): string | null {
  const state = dataQualityEvidenceState(quality);
  if (!quality || !state || state === "complete") return null;

  const reason = reasonCopy(quality.reason);
  const age =
    typeof quality.snapshot_age_seconds === "number"
      ? formatAge(quality.snapshot_age_seconds)
      : null;
  const cachedAt = quality.snapshot_cached_at
    ? formatCachedAt(quality.snapshot_cached_at)
    : null;
  const snapshotDetail =
    cachedAt && age
      ? ` Snapshot cached ${cachedAt} (${age} old).`
      : cachedAt
        ? ` Snapshot cached ${cachedAt}.`
        : age
          ? ` Snapshot age: ${age}.`
          : "";

  if (state === "stale") {
    return `Showing last-known-good ${subject}${reason ? ` because ${reason}` : ""}.${snapshotDetail}`;
  }

  return `The ${subject} evidence is partial${reason ? ` because ${reason}` : ""}.`;
}
