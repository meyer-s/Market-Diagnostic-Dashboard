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

export type OptionMarketFieldPathState =
  | "supportive"
  | "fading"
  | "contradictory"
  | "mixed"
  | "unavailable"
  | string;

export interface OptionMarketFieldDirection {
  regime?: string | null;
  pressure?: number | null;
  velocity?: number | null;
  acceleration?: number | null;
  jerk?: number | null;
  snap?: number | null;
  aligned_pressure?: number | null;
  aligned_velocity?: number | null;
  option_aligned_pressure?: number | null;
  option_aligned_velocity?: number | null;
  horizon_alignment?: number | null;
  coherence?: number | null;
  entropy?: number | null;
  permutation_entropy?: number | null;
  expansion?: number | null;
  expansion_front?: number | null;
}

export interface OptionMarketFieldStrata {
  structure?: number | null;
  kinematics?: number | null;
  geometry?: number | null;
  information?: number | null;
  propagation?: number | null;
  cascade_bias?: number | null;
  scaling_exponent?: number | null;
}

export interface OptionMarketFieldPriceAction {
  state?: string | null;
  range_position20?: number | null;
  support_distance_atr?: number | null;
  resistance_distance_atr?: number | null;
  trend_gap20_pct?: number | null;
  return_5bar_pct?: number | null;
}

export interface OptionMarketFieldSignals {
  path_state?: OptionMarketFieldPathState | null;
  shock?: boolean | null;
  organized_expansion?: boolean | null;
  longward_cascade?: boolean | null;
  geometry_disorder_shock?: boolean | null;
  kinematic_exhaustion?: boolean | null;
}

export interface OptionMarketFieldClassification {
  path_state?: OptionMarketFieldPathState | null;
  eventfulness?: string | null;
}

export interface OptionMarketFieldHypotheses {
  organized_expansion?: boolean | null;
  longward_cascade?: boolean | null;
  geometry_disorder_shock?: boolean | null;
  kinematic_exhaustion?: boolean | null;
  shock?: boolean | null;
}

/** Point-in-time, causal field snapshot. It must remain advisory while rank_influence is zero. */
export interface OptionMarketFieldContext {
  schema_version?: string | null;
  mode?: string | null;
  rank_influence?: number | null;
  available?: boolean | null;
  computed_at?: string | null;
  as_of_bar?: string | null;
  timeframe?: string | null;
  option_type?: string | null;
  data_source?: string | null;
  completed_bars?: number | null;
  excluded_incomplete_bars?: number | null;
  quality?: ({ available?: boolean | null } & Record<string, unknown>) | string | null;
  aligned_pressure?: number | null;
  aligned_velocity?: number | null;
  option_aligned_pressure?: number | null;
  option_aligned_velocity?: number | null;
  direction?: OptionMarketFieldDirection | null;
  strata?: OptionMarketFieldStrata | null;
  carriers?: Record<string, unknown> | null;
  price_action?: OptionMarketFieldPriceAction | null;
  signals?: OptionMarketFieldSignals | null;
  classification?: OptionMarketFieldClassification | null;
  hypotheses?: OptionMarketFieldHypotheses | null;
}

export interface OptionMarketFieldAxisResult {
  status?: OptionMarketFieldPathState | null;
  advisory?: boolean | null;
  timeframe?: string | null;
  as_of_bar?: string | null;
  available?: boolean | null;
  quality?: unknown;
  aligned_pressure?: number | null;
  aligned_velocity?: number | null;
  structure?: number | null;
  information?: number | null;
  propagation?: number | null;
  cascade_bias?: number | null;
  transition_risk?: "elevated" | "normal" | "unavailable" | string | null;
  boundary_state?: string | null;
  support_distance_atr?: number | null;
  resistance_distance_atr?: number | null;
  familiarity?: "familiar" | "transition" | "novel" | "not_scored" | string | null;
  familiarity_reason?: string | null;
}

export interface OptionMarketFieldPresentation {
  badgeLabel: "FIELD UP" | "FIELD FADING" | "CONFLICT" | "SHOCK";
  tone: ScannerPositionMatchTone;
  pathStateLabel: string;
  directionLabel: string | null;
  structureLabel: string | null;
  boundaryLabel: string | null;
  familiarityLabel: string | null;
  familiarityReason: string | null;
  timeframe: string;
  summary: string;
  accessibleLabel: string;
}

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

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const compactMetric = (value: number) => {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return value > 0 ? `+${rounded}` : rounded;
};

const compactLevel = (value: number) =>
  Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);

const compactFieldText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? humanizeClassification(normalized).replace(/\bAtr\b/g, "ATR") : null;
};

/**
 * Converts the causal market-field payload into terse UI language without
 * manufacturing a learned-state/familiarity label that the payload does not contain.
 */
export const presentOptionMarketField = (
  context?: OptionMarketFieldContext | null,
  axis?: OptionMarketFieldAxisResult | null
): OptionMarketFieldPresentation | null => {
  const qualityAvailable = context?.quality && typeof context.quality === "object"
    ? context.quality.available
    : undefined;
  const contextAvailable = context?.available ?? qualityAvailable;
  if ((!context || contextAvailable === false) && (!axis || axis.available === false)) return null;

  const signals = context?.signals || null;
  const hypotheses = context?.hypotheses || null;
  const pathState = (
    signals?.path_state
    || context?.classification?.path_state
    || axis?.status
    || "unavailable"
  ).trim().toLowerCase();
  const eventfulness = context?.classification?.eventfulness?.trim().toLowerCase() || "";
  const shock = signals?.shock === true
    || signals?.geometry_disorder_shock === true
    || hypotheses?.shock === true
    || hypotheses?.geometry_disorder_shock === true
    || eventfulness === "shock";
  const badge = shock
    ? { badgeLabel: "SHOCK" as const, tone: "negative" as const, pathStateLabel: "Geometry disorder shock" }
    : pathState === "supportive"
      ? { badgeLabel: "FIELD UP" as const, tone: "positive" as const, pathStateLabel: "Path supportive" }
      : pathState === "fading"
        ? { badgeLabel: "FIELD FADING" as const, tone: "warning" as const, pathStateLabel: "Path fading" }
        : pathState === "contradictory" || pathState === "mixed"
          ? {
              badgeLabel: "CONFLICT" as const,
              tone: pathState === "contradictory" ? "negative" as const : "warning" as const,
              pathStateLabel: pathState === "contradictory" ? "Path contradictory" : "Path mixed",
            }
          : signals?.kinematic_exhaustion === true || hypotheses?.kinematic_exhaustion === true
            ? { badgeLabel: "FIELD FADING" as const, tone: "warning" as const, pathStateLabel: "Kinematic exhaustion" }
            : signals?.organized_expansion === true
                || signals?.longward_cascade === true
                || hypotheses?.organized_expansion === true
                || hypotheses?.longward_cascade === true
              ? { badgeLabel: "FIELD UP" as const, tone: "positive" as const, pathStateLabel: "Organized path support" }
              : null;
  if (!badge) return null;

  const regime = compactFieldText(context?.direction?.regime);
  const alignedPressure = asFiniteNumber(
    context?.direction?.option_aligned_pressure
    ?? context?.direction?.aligned_pressure
    ?? context?.option_aligned_pressure
    ?? context?.aligned_pressure
    ?? axis?.aligned_pressure
  );
  const alignedVelocity = asFiniteNumber(
    context?.direction?.option_aligned_velocity
    ?? context?.direction?.aligned_velocity
    ?? context?.option_aligned_velocity
    ?? context?.aligned_velocity
    ?? axis?.aligned_velocity
  );
  const directionLabel = regime
    ? `Direction · ${regime}`
    : alignedPressure !== null
      ? `Pressure · ${compactMetric(alignedPressure)}${alignedVelocity !== null ? ` / Δ ${compactMetric(alignedVelocity)}` : ""}`
      : null;
  const structure = asFiniteNumber(context?.strata?.structure ?? axis?.structure);
  const structureLabel = structure !== null ? `Structure · ${compactLevel(structure)}` : null;
  const boundary = compactFieldText(context?.price_action?.state || axis?.boundary_state);
  const boundaryLabel = boundary ? `Boundary · ${boundary}` : null;
  const familiarity = axis?.familiarity?.trim().toLowerCase() || null;
  const familiarityLabel = familiarity === "not_scored"
    ? "Novelty · not scored"
    : familiarity === "familiar" || familiarity === "transition" || familiarity === "novel"
      ? `Profile · ${compactFieldText(familiarity)}`
      : null;
  const timeframe = context?.timeframe || axis?.timeframe || "1D";
  const detailParts = [badge.pathStateLabel, directionLabel, structureLabel, boundaryLabel].filter(Boolean);
  const summary = detailParts.join(" · ");

  return {
    ...badge,
    directionLabel,
    structureLabel,
    boundaryLabel,
    familiarityLabel,
    familiarityReason: axis?.familiarity_reason?.trim() || null,
    timeframe,
    summary,
    accessibleLabel: `${badge.badgeLabel}: ${summary}. Advisory point-in-time market field; scanner rank influence is zero.`,
  };
};

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
