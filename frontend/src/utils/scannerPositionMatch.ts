export type ScannerPositionMatchType = "exact_contract" | "same_symbol" | string;

export type ScannerPositionMatchClassification =
  | "strengthened"
  | "still_qualifies"
  | "contract_drift"
  | "portfolio_conflict"
  | "contradiction"
  | string;

export interface ScannerPositionMatchDeltas {
  base_score?: number | null;
  score?: number | null;
  iv_hv_spread?: number | null;
  contract_score?: number | null;
  reward_risk?: number | null;
  premium?: number | null;
  dte?: number | null;
}

export interface ScannerPositionMatch {
  match_type: ScannerPositionMatchType;
  classification?: ScannerPositionMatchClassification | null;
  position_id?: number | null;
  held_contracts?: number | null;
  repeat_count?: number | null;
  previous_event_id?: number | null;
  delta_summary?: string | null;
  deltas?: ScannerPositionMatchDeltas | null;
}

export type ScannerPositionMatchTone = "neutral" | "positive" | "warning" | "negative";

export interface ScannerPositionMatchPresentation {
  badgeLabel: string;
  classificationLabel: string;
  evidenceLine: string;
  accessibleLabel: string;
  tone: ScannerPositionMatchTone;
}

const classificationLabels: Record<string, string> = {
  strengthened: "Evidence strengthened",
  still_qualifies: "Still qualifies",
  contract_drift: "Contract drift",
  portfolio_conflict: "Portfolio conflict",
  contradiction: "Contradicting evidence",
};

const classificationTones: Record<string, ScannerPositionMatchTone> = {
  strengthened: "positive",
  still_qualifies: "neutral",
  contract_drift: "warning",
  portfolio_conflict: "warning",
  contradiction: "negative",
};

const formatSigned = (value: number, suffix = "") =>
  `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;

const buildDeltaSummary = (deltas?: ScannerPositionMatchDeltas | null) => {
  if (!deltas) return null;
  const primaryScore: [string, number | null | undefined, string] =
    typeof deltas.base_score === "number"
      ? ["Base", deltas.base_score, ""]
      : ["Score", deltas.score, ""];
  const candidates: Array<[string, number | null | undefined, string]> = [
    primaryScore,
    ["Contract", deltas.contract_score, ""],
    ["IV/HV", deltas.iv_hv_spread, " pts"],
    ["Reward/risk", deltas.reward_risk, "R"],
    ["Premium", deltas.premium, ""],
    ["DTE", deltas.dte, "d"],
  ];
  const parts = candidates
    .filter((entry): entry is [string, number, string] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .slice(0, 2)
    .map(([label, value, suffix]) => `${label} ${formatSigned(value, suffix)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
};

const humanizeClassification = (classification: string) =>
  classification
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const presentScannerPositionMatch = (
  match?: ScannerPositionMatch | null
): ScannerPositionMatchPresentation | null => {
  if (!match) return null;

  const isExactContract = match.match_type === "exact_contract";
  const classification =
    match.classification || (isExactContract ? "still_qualifies" : "contract_drift");
  const heldContracts =
    typeof match.held_contracts === "number" && match.held_contracts > 0
      ? Math.round(match.held_contracts)
      : null;
  const repeatCount =
    typeof match.repeat_count === "number" && match.repeat_count > 0
      ? Math.round(match.repeat_count)
      : null;
  const badgeParts = ["HELD"];
  if (heldContracts !== null) badgeParts.push(String(heldContracts));
  if (isExactContract && repeatCount !== null) badgeParts.push(`#${repeatCount}`);
  if (!isExactContract) badgeParts.push("NAME");

  const classificationLabel =
    classificationLabels[classification] || humanizeClassification(classification);
  const suppliedSummary = match.delta_summary?.trim() || null;
  const deltaSummary = suppliedSummary || buildDeltaSummary(match.deltas);
  const evidenceLine = deltaSummary
    ? `${classificationLabel} · ${deltaSummary}`
    : classificationLabel;
  const matchDescription = isExactContract ? "exact contract" : "same symbol, different contract";
  const heldDescription = heldContracts !== null ? `, ${heldContracts} contracts held` : "";
  const repeatDescription = repeatCount !== null ? `, repeat hit ${repeatCount}` : "";

  return {
    badgeLabel: badgeParts.join(" · "),
    classificationLabel,
    evidenceLine,
    accessibleLabel: `Open position match: ${matchDescription}${heldDescription}${repeatDescription}. ${evidenceLine}. Evidence only; not an add recommendation.`,
    tone: classificationTones[classification] || "neutral",
  };
};
