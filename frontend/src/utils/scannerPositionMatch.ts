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

export type ScannerReplacementStatus = "candidate" | "watch" | "rejected" | "not_applicable" | string;

export interface ScannerReplacementGate {
  key: string;
  label: string;
  status: "pass" | "watch" | "fail" | string;
  detail: string;
}

export interface ScannerReplacementContractComparison {
  contract?: string | null;
  expiry?: string | null;
  strike?: number | null;
  option_type?: string | null;
  dte?: number | null;
  score?: number | null;
  score_source?: string | null;
  pnl_pct?: number | null;
  premium?: number | null;
  spread_pct?: number | null;
  delta?: number | null;
  theta_per_day_per_contract?: number | null;
  contract_status?: string | null;
  verdict?: string | null;
  reward_risk?: number | null;
  contract_score?: number | null;
  convexity_profit_pct?: number | null;
  convexity_probability_itm?: number | null;
}

export interface ScannerReplacementDecision {
  model_version: string;
  status: ScannerReplacementStatus;
  recommendation: string;
  action: string;
  label: string;
  summary: string;
  confidence: string;
  implementation_ready: boolean;
  structure: {
    expiry_direction: string;
    strike_direction: string;
    directional_hurdle: string;
    label: string;
  };
  comparison: {
    held: ScannerReplacementContractComparison;
    candidate: ScannerReplacementContractComparison;
    change: {
      dte?: number | null;
      strike?: number | null;
      score?: number | null;
    };
  };
  gates: ScannerReplacementGate[];
  missing_inputs: string[];
  journal_rule: string;
  automated_execution_enabled: boolean;
}

export interface ScannerPositionMatch {
  match_type: ScannerPositionMatchType;
  classification?: ScannerPositionMatchClassification | null;
  position_id?: number | null;
  position_ids?: number[] | null;
  held_contracts?: number | null;
  repeat_count?: number | null;
  previous_event_id?: number | null;
  delta_summary?: string | null;
  deltas?: ScannerPositionMatchDeltas | null;
  replacement_decision?: ScannerReplacementDecision | null;
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

const replacementTone = (status: ScannerReplacementStatus): ScannerPositionMatchTone => {
  if (status === "candidate") return "positive";
  if (status === "rejected") return "negative";
  if (status === "watch") return "warning";
  return "neutral";
};

const compactReplacementEvidence = (replacement: ScannerReplacementDecision) => {
  const change = replacement.comparison?.change;
  const parts = [replacement.structure?.label];
  if (typeof change?.score === "number" && Number.isFinite(change.score)) {
    parts.push(`score ${formatSigned(change.score)}`);
  }
  if (typeof change?.dte === "number" && Number.isFinite(change.dte)) {
    parts.push(`${change.dte > 0 ? "+" : ""}${Math.round(change.dte)}d`);
  }
  return parts.filter(Boolean).join(" · ") || replacement.summary;
};

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
  const replacement = !isExactContract ? match.replacement_decision || null : null;
  const badgeParts = ["HELD"];
  if (heldContracts !== null) badgeParts.push(String(heldContracts));
  if (isExactContract && repeatCount !== null) badgeParts.push(`#${repeatCount}`);
  if (!isExactContract) {
    badgeParts.push(
      replacement?.status === "candidate"
        ? replacement.action === "partial_replace"
          ? "HARVEST"
          : "ROLL"
        : replacement?.status === "rejected"
          ? "NO ROLL"
          : replacement?.status === "watch"
            ? "WATCH"
            : "NAME"
    );
  }

  const classificationLabel = replacement?.label ||
    classificationLabels[classification] || humanizeClassification(classification);
  const suppliedSummary = match.delta_summary?.trim() || null;
  const deltaSummary = suppliedSummary || buildDeltaSummary(match.deltas);
  const evidenceLine = replacement
    ? `${classificationLabel} · ${compactReplacementEvidence(replacement)}`
    : deltaSummary
      ? `${classificationLabel} · ${deltaSummary}`
      : classificationLabel;
  const matchDescription = isExactContract ? "exact contract" : "same symbol, different contract";
  const heldDescription = heldContracts !== null ? `, ${heldContracts} contracts held` : "";
  const repeatDescription = repeatCount !== null ? `, repeat hit ${repeatCount}` : "";

  return {
    badgeLabel: badgeParts.join(" · "),
    classificationLabel,
    evidenceLine,
    accessibleLabel: `Open position match: ${matchDescription}${heldDescription}${repeatDescription}. ${evidenceLine}. ${
      replacement
        ? "Replacement decision support only; close and new entry remain separate decisions."
        : "Evidence only; not an add recommendation."
    }`,
    tone: replacement ? replacementTone(replacement.status) : classificationTones[classification] || "neutral",
  };
};
