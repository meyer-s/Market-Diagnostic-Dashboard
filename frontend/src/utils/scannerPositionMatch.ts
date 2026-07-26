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

export interface OptionMarketFieldStructureComponents {
  activity?: number | null;
  horizon_agreement?: number | null;
  trend_agreement_composite?: number | null;
  display_organization?: number | null;
}

export interface OptionMarketFieldScalingReference {
  stationary_finite_variance_reference?: number | null;
  latest_exponent?: number | null;
  latest_excess?: number | null;
  valid?: boolean | null;
  reason?: string | null;
  exact_arithmetic_contract?: {
    nonnegative?: boolean | null;
    floating_point_tolerance?: number | null;
    defensive_storage_bounds?: number[] | null;
    violation_status?: string | null;
  } | null;
}

export interface OptionMarketFieldInputQuality {
  status?: "valid" | "limited" | "invalid" | string | null;
  rows_received?: number | null;
  rows_used?: number | null;
  completed_rows_used?: number | null;
  dropped?: {
    bad_timestamp?: number | null;
    nonfinite_ohlc?: number | null;
    nonpositive_ohlc?: number | null;
    inconsistent_ohlc?: number | null;
    duplicate_timestamp?: number | null;
    [key: string]: unknown;
  } | null;
  volume?: {
    available?: boolean | null;
    carrier_usable?: boolean | null;
    available_observations?: number | null;
    positive_observations?: number | null;
    coverage?: number | null;
    invalid_observations?: number | null;
    [key: string]: unknown;
  } | null;
  warnings?: string[] | null;
  [key: string]: unknown;
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

export type OptionMarketFieldAuthorityValue = boolean | number | string | null;

export interface OptionMarketFieldAuthority {
  scope?: string | null;
  scanner_rank?: OptionMarketFieldAuthorityValue;
  hard_veto?: OptionMarketFieldAuthorityValue;
  manager_verdict?: OptionMarketFieldAuthorityValue;
  target_size?: OptionMarketFieldAuthorityValue;
  assessment_confidence?: OptionMarketFieldAuthorityValue;
  review_priority?: OptionMarketFieldAuthorityValue;
  human_visible?: OptionMarketFieldAuthorityValue;
  automated_execution?: OptionMarketFieldAuthorityValue;
  downstream_outcome_learning?: Record<string, unknown> | null;
}

export interface OptionMarketFieldAlignment {
  supported?: boolean | null;
  basis?: string | null;
  scope?: string | null;
  position_action?: string | null;
  directional_exposure_sign?: number | null;
  assumptions?: string[] | string | null;
}

export type OptionMarketFieldMaturityStatus =
  | "insufficient"
  | "provisional"
  | "complete"
  | "mature"
  | "unknown"
  | string;

export interface OptionMarketFieldMaturity {
  completed_bars?: number | null;
  maximum_horizon_bars?: number | null;
  minimum_observed_window_bars?: number | null;
  minimum_input_bars?: number | null;
  minimum_input_satisfied?: boolean | null;
  initialization_target_bars?: number | null;
  initialization_target_covered?: boolean | null;
  initialization_status?: string | null;
  bars_needed_to_minimum_input?: number | null;
  bars_needed_to_initialization_target?: number | null;
  target_warmup_bars?: number | null;
  warmup_complete?: boolean | null;
  status?: OptionMarketFieldMaturityStatus | null;
  bars_needed?: number | null;
  note?: string | null;
}

export interface OptionMarketFieldAdvisoryEffect<T = string> {
  before?: T | null;
  after?: T | null;
  changed?: boolean | null;
}

export interface OptionMarketFieldEffectsApplied {
  confidence?: OptionMarketFieldAdvisoryEffect;
  urgency?: OptionMarketFieldAdvisoryEffect;
  review_window_recomputed_from_advisory_urgency?: boolean | null;
  rank_changed?: boolean | null;
  veto_changed?: boolean | null;
  verdict_changed?: boolean | null;
  target_size_changed?: boolean | null;
  execution_authority?: OptionMarketFieldAuthorityValue;
  [key: string]: unknown;
}

/** Point-in-time field snapshot with zero direct rank authority. */
export interface OptionMarketFieldContext {
  schema_version?: string | null;
  mode?: string | null;
  rank_influence?: number | null;
  shadow_only?: boolean | null;
  automated_execution_enabled?: boolean | null;
  available?: boolean | null;
  computed_at?: string | null;
  as_of_bar?: string | null;
  timeframe?: string | null;
  option_type?: string | null;
  data_source?: string | null;
  analysis_identity?: {
    schema_version?: string | null;
    recipe_hash?: string | null;
    input_hash?: string | null;
    analysis_hash?: string | null;
    provider_truth_verified?: boolean | null;
    [key: string]: unknown;
  } | null;
  completed_bars?: number | null;
  excluded_incomplete_bars?: number | null;
  quality?: ({ available?: boolean | null } & Record<string, unknown>) | string | null;
  aligned_pressure?: number | null;
  aligned_velocity?: number | null;
  option_aligned_pressure?: number | null;
  option_aligned_velocity?: number | null;
  direction?: OptionMarketFieldDirection | null;
  strata?: OptionMarketFieldStrata | null;
  structure_components?: OptionMarketFieldStructureComponents | null;
  scaling_reference?: OptionMarketFieldScalingReference | null;
  input_quality?: OptionMarketFieldInputQuality | null;
  carriers?: Record<string, unknown> | null;
  price_action?: OptionMarketFieldPriceAction | null;
  signals?: OptionMarketFieldSignals | null;
  classification?: OptionMarketFieldClassification | null;
  hypotheses?: OptionMarketFieldHypotheses | null;
  authority?: OptionMarketFieldAuthority | null;
  alignment?: OptionMarketFieldAlignment | null;
  initialization?: OptionMarketFieldMaturity | null;
  maturity?: OptionMarketFieldMaturity | null;
  semantic_revision?: string | null;
  effects_applied?: OptionMarketFieldEffectsApplied | null;
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
  authority?: OptionMarketFieldAuthority | null;
  alignment?: OptionMarketFieldAlignment | null;
  initialization?: OptionMarketFieldMaturity | null;
  maturity?: OptionMarketFieldMaturity | null;
  semantic_revision?: string | null;
  effects_applied?: OptionMarketFieldEffectsApplied | null;
}

export interface OptionMarketFieldPresentation {
  badgeLabel: "FIELD UP" | "FIELD FADING" | "CONFLICT" | "SHOCK" | "FIELD WARMING";
  tone: ScannerPositionMatchTone;
  pathStateLabel: string;
  directionLabel: string | null;
  trendAgreementLabel: string | null;
  boundaryLabel: string | null;
  familiarityLabel: string | null;
  familiarityReason: string | null;
  authorityLabel: string;
  advisoryEffectsLabel: string;
  authorityCaveat: string | null;
  alignmentLabel: string | null;
  alignmentCaveat: string | null;
  maturityStatus: "insufficient" | "provisional" | "complete" | "unknown";
  maturityLabel: string | null;
  maturityReason: string | null;
  scalingLabel: string | null;
  scalingCaveat: string | null;
  inputQualityLabel: string | null;
  inputQualityCaveat: string | null;
  diagnosticsLabel: string | null;
  diagnosticsCaveat: string | null;
  semanticRevision: string | null;
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

const compactScore = (value: number) => {
  const score = Math.abs(value) <= 1 ? value * 100 : value;
  return `${Math.round(score)}/100`;
};

const compactCount = (value: number) => Math.round(value).toLocaleString("en-US");

const compactFieldText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? humanizeClassification(normalized).replace(/\bAtr\b/g, "ATR") : null;
};

const diagnosticText = (value?: string | null) => {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized
    .replace(/^field_calculation_failed:/i, "field calculation failed: ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const scalingPresentation = (context?: OptionMarketFieldContext | null) => {
  const scaling = context?.scaling_reference || null;
  if (!scaling) {
    return { scalingLabel: null, scalingCaveat: null };
  }
  const reference = asFiniteNumber(scaling.stationary_finite_variance_reference) ?? 0.5;
  const exponent = asFiniteNumber(scaling.latest_exponent);
  const reportedExcess = asFiniteNumber(scaling.latest_excess);
  const tolerance = asFiniteNumber(scaling.exact_arithmetic_contract?.floating_point_tolerance) ?? 1e-10;
  const violatesNonnegativeContract = exponent !== null && exponent < -Math.abs(tolerance);
  const displayedExponent = exponent !== null && exponent < 0 && !violatesNonnegativeContract ? 0 : exponent;
  const excess = reportedExcess ?? (displayedExponent !== null ? displayedExponent - reference : null);
  if (scaling.valid === true && displayedExponent !== null && !violatesNonnegativeContract) {
    return {
      scalingLabel: `Scaling · ${displayedExponent.toFixed(2)}${excess !== null ? ` (${excess >= 0 ? "+" : ""}${excess.toFixed(2)} vs ${reference.toFixed(2)})` : ""}`,
      scalingCaveat: null,
    };
  }
  if (violatesNonnegativeContract || scaling.reason === "negative_exponent_violates_exact_arithmetic_contract") {
    return {
      scalingLabel: "Scaling · quality flag",
      scalingCaveat: "Scaling estimate withheld: a negative exponent violates the implemented measure's nonnegative exact-arithmetic contract; it is not interpreted as a market signal.",
    };
  }
  const reason = diagnosticText(scaling.reason);
  return {
    scalingLabel: "Scaling · unavailable",
    scalingCaveat: `Volatility scaling is unavailable${reason ? `: ${reason}` : "."}`,
  };
};

const inputQualityPresentation = (context?: OptionMarketFieldContext | null) => {
  const input = context?.input_quality || null;
  if (!input) {
    return { inputQualityLabel: null, inputQualityCaveat: null };
  }
  const status = input.status?.trim().toLowerCase() || "unknown";
  const rowsReceived = asFiniteNumber(input.rows_received);
  const rowsUsed = asFiniteNumber(input.rows_used);
  const rowLabel = rowsReceived !== null && rowsUsed !== null
    ? `${compactCount(rowsUsed)}/${compactCount(rowsReceived)} rows`
    : null;
  const inputQualityLabel = `Input · ${status}${rowLabel ? ` · ${rowLabel}` : ""}`;
  const warnings = Array.isArray(input.warnings)
    ? input.warnings.map(diagnosticText).filter((value): value is string => Boolean(value))
    : [];
  const droppedCount: number = input.dropped
    ? Object.values(input.dropped).reduce<number>((sum, value) => sum + (asFiniteNumber(value) ?? 0), 0)
    : 0;
  const volumeCoverage = asFiniteNumber(input.volume?.coverage);
  const caveatParts = [
    droppedCount > 0 ? `${compactCount(droppedCount)} price ${droppedCount === 1 ? "row" : "rows"} rejected` : null,
    ...warnings,
    input.volume?.carrier_usable === false ? "volume-dependent carriers unavailable" : null,
    volumeCoverage !== null && volumeCoverage < 0.999
      ? `volume coverage ${Math.round(volumeCoverage * 100)}%`
      : null,
  ].filter((value): value is string => Boolean(value));
  return {
    inputQualityLabel,
    inputQualityCaveat: status !== "valid" || caveatParts.length > 0
      ? `Input quality ${status}${caveatParts.length > 0 ? `: ${Array.from(new Set(caveatParts)).join("; ")}` : "."}`
      : null,
  };
};

const MARKET_FIELD_AUTHORITY_LABEL = "No rank, veto, verdict, size, or execution authority";
const MARKET_FIELD_ADVISORY_EFFECTS_LABEL = "May advise confidence and review priority";
const LEGACY_ALIGNMENT_CAVEAT =
  "Legacy call/put alignment assumes a long, directional single-leg position; it is not valid for short, spread, hedge, or multi-leg exposure.";

const authorityValueIsActive = (value: OptionMarketFieldAuthorityValue | undefined) => {
  if (value === null || value === undefined || value === false || value === 0) return false;
  if (value === true || (typeof value === "number" && value !== 0)) return true;
  const normalized = String(value).trim().toLowerCase();
  return !["", "0", "false", "none", "no", "disabled", "off", "zero"].includes(normalized);
};

const authorityPresentation = (
  context?: OptionMarketFieldContext | null,
  axis?: OptionMarketFieldAxisResult | null,
  effectsApplied?: OptionMarketFieldEffectsApplied | null
) => {
  const authority = context?.authority || axis?.authority || null;
  const effects = effectsApplied || context?.effects_applied || axis?.effects_applied || null;
  const protectedAuthority = [
    authority?.scanner_rank,
    authority?.hard_veto,
    authority?.manager_verdict,
    authority?.target_size,
    authority?.automated_execution,
  ];
  const metadataConflict = protectedAuthority.some(authorityValueIsActive)
    || (typeof context?.rank_influence === "number" && context.rank_influence !== 0)
    || context?.automated_execution_enabled === true
    || effects?.rank_changed === true
    || effects?.veto_changed === true
    || effects?.verdict_changed === true
    || effects?.target_size_changed === true
    || authorityValueIsActive(effects?.execution_authority);
  const confidenceChanged = effects?.confidence?.changed === true;
  const priorityChanged = effects?.urgency?.changed === true
    || effects?.review_window_recomputed_from_advisory_urgency === true;
  const applied = [confidenceChanged ? "confidence" : null, priorityChanged ? "review priority" : null]
    .filter((value): value is string => Boolean(value));
  return {
    authorityLabel: MARKET_FIELD_AUTHORITY_LABEL,
    advisoryEffectsLabel: applied.length > 0
      ? `Advisory applied · ${applied.join(" and ")}`
      : MARKET_FIELD_ADVISORY_EFFECTS_LABEL,
    authorityCaveat: metadataConflict
      ? "Authority metadata conflicts with the review-only contract; do not use this field to rank, veto, grade, size, or execute."
      : null,
  };
};

const normalizeMaturityStatus = (value?: string | null) => value?.trim().toLowerCase().replace(/\s+/g, "_") || "";

const maturityPresentation = (
  context?: OptionMarketFieldContext | null,
  axis?: OptionMarketFieldAxisResult | null
) => {
  const maturity = context?.initialization
    || axis?.initialization
    || context?.maturity
    || axis?.maturity
    || null;
  const quality = context?.quality && typeof context.quality === "object" ? context.quality : null;
  const warnings = Array.isArray(quality?.warnings)
    ? quality.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const warningMinimum = warnings
    .map((warning) => warning.match(/^requires_(\d+)_completed_bars$/i))
    .find((match): match is RegExpMatchArray => Boolean(match))?.[1];
  const completedBars = asFiniteNumber(maturity?.completed_bars ?? context?.completed_bars);
  const maximumHorizon = asFiniteNumber(maturity?.maximum_horizon_bars) ?? 48;
  const minimumObserved = asFiniteNumber(maturity?.minimum_input_bars)
    ?? asFiniteNumber(maturity?.minimum_observed_window_bars)
    ?? (warningMinimum ? Number(warningMinimum) : 60);
  const targetWarmup = asFiniteNumber(maturity?.initialization_target_bars)
    ?? asFiniteNumber(maturity?.target_warmup_bars)
    ?? Math.max(96, maximumHorizon * 2);
  const reportedBarsNeeded = asFiniteNumber(maturity?.bars_needed_to_initialization_target)
    ?? asFiniteNumber(maturity?.bars_needed);
  const explicitStatus = normalizeMaturityStatus(maturity?.initialization_status ?? maturity?.status);
  const explicitInsufficient = ["insufficient", "unavailable", "not_ready", "blocked"].includes(explicitStatus);
  const explicitProvisional = ["provisional", "warming", "warmup", "partial", "limited", "minimum_satisfied"].includes(explicitStatus);
  const explicitComplete = ["complete", "mature", "ready", "full", "target_covered"].includes(explicitStatus);

  let status: OptionMarketFieldPresentation["maturityStatus"] = "unknown";
  if (
    explicitInsufficient
    || explicitStatus === "minimum_not_satisfied"
    || maturity?.minimum_input_satisfied === false
    || (completedBars !== null && completedBars < minimumObserved)
  ) {
    status = "insufficient";
  } else if (
    explicitProvisional
    || maturity?.initialization_target_covered === false
    || maturity?.warmup_complete === false
    || (completedBars !== null && completedBars < targetWarmup)
  ) {
    status = "provisional";
  } else if (
    explicitComplete
    || maturity?.initialization_target_covered === true
    || maturity?.warmup_complete === true
    || (completedBars !== null && completedBars >= targetWarmup)
  ) {
    status = "complete";
  }

  const barsNeeded = reportedBarsNeeded
    ?? (completedBars !== null && status !== "complete" ? Math.max(0, targetWarmup - completedBars) : null);
  const maturityLabel = status === "insufficient"
    ? `Initialization · minimum input not met${completedBars !== null ? ` (${compactCount(completedBars)}/${compactCount(minimumObserved)} bars)` : ""}`
    : status === "provisional"
      ? `Initialization · target not covered${completedBars !== null ? ` (${compactCount(completedBars)}/${compactCount(targetWarmup)} bars${barsNeeded ? `; ${compactCount(barsNeeded)} needed` : ""})` : ""}`
      : null;
  const maturityReason = maturity?.note?.trim() || (
    status === "insufficient"
      ? "There is not enough completed history to support the configured observed window."
      : status === "provisional"
        ? "The field is computable, but initialization and long-horizon carrier values remain history-sensitive."
        : status === "complete"
          ? `Initialization target covered${completedBars !== null ? ` with ${compactCount(completedBars)} completed bars` : ""}; this is not a convergence guarantee.`
          : null
  );
  return { status, maturityLabel, maturityReason };
};

const alignmentPresentation = (
  context?: OptionMarketFieldContext | null,
  axis?: OptionMarketFieldAxisResult | null
) => {
  const alignment = context?.alignment || axis?.alignment || null;
  const assumptions = Array.isArray(alignment?.assumptions)
    ? alignment.assumptions.filter((assumption): assumption is string => typeof assumption === "string" && Boolean(assumption.trim()))
    : typeof alignment?.assumptions === "string" && alignment.assumptions.trim()
      ? [alignment.assumptions.trim()]
      : [];
  const scope = alignment?.scope?.trim().toLowerCase() || "";
  const basis = compactFieldText(alignment?.basis);
  const hasExplicitAlignment = Boolean(
    alignment
    && (
      typeof alignment.supported === "boolean"
      || alignment.basis
      || alignment.scope
      || alignment.position_action
      || asFiniteNumber(alignment.directional_exposure_sign) !== null
      || assumptions.length > 0
    )
  );
  if (alignment?.supported === false) {
    return {
      alignmentLabel: "Alignment · unsupported",
      alignmentCaveat: assumptions.join(" ") || "Directional alignment is not supported for this position structure or action.",
      supported: false,
    };
  }
  if (alignment && hasExplicitAlignment) {
    const longSingleLegScope = scope.includes("long") && (scope.includes("single") || scope.includes("directional"));
    const legacyLongSingleLeg = alignment.basis?.trim().toLowerCase().includes("legacy_long_single_leg") === true;
    const caveats = [
      ...assumptions,
      legacyLongSingleLeg || (longSingleLegScope && assumptions.length === 0) ? LEGACY_ALIGNMENT_CAVEAT : null,
    ].filter((value): value is string => Boolean(value));
    return {
      alignmentLabel: basis ? `Alignment · ${basis}` : "Alignment · supported exposure",
      alignmentCaveat: caveats.join(" ") || null,
      supported: true,
    };
  }

  const legacySide = context?.option_type?.trim().toLowerCase();
  const hasLegacyAlignedValue = [
    context?.direction?.option_aligned_pressure,
    context?.direction?.aligned_pressure,
    context?.option_aligned_pressure,
    context?.aligned_pressure,
    axis?.aligned_pressure,
  ].some((value) => asFiniteNumber(value) !== null);
  if (legacySide === "call" || legacySide === "put" || hasLegacyAlignedValue) {
    return {
      alignmentLabel: "Alignment · legacy side proxy",
      alignmentCaveat: LEGACY_ALIGNMENT_CAVEAT,
      supported: true,
    };
  }
  return { alignmentLabel: null, alignmentCaveat: null, supported: null };
};

/**
 * Converts the causal market-field payload into terse UI language without
 * manufacturing a learned-state/familiarity label that the payload does not contain.
 */
export const presentOptionMarketField = (
  context?: OptionMarketFieldContext | null,
  axis?: OptionMarketFieldAxisResult | null,
  effectsApplied?: OptionMarketFieldEffectsApplied | null
): OptionMarketFieldPresentation | null => {
  const maturity = maturityPresentation(context, axis);
  const authority = authorityPresentation(context, axis, effectsApplied);
  const alignment = alignmentPresentation(context, axis);
  const scaling = scalingPresentation(context);
  const inputQuality = inputQualityPresentation(context);
  const qualityAvailable = context?.quality && typeof context.quality === "object"
    ? context.quality.available
    : undefined;
  const contextAvailable = context?.available ?? qualityAvailable;
  const explicitlyUnavailable = (!context || contextAvailable === false) && (!axis || axis.available === false);
  if (explicitlyUnavailable && maturity.status !== "insufficient" && maturity.status !== "provisional") return null;

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
  const baseBadge = shock
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
  const badge = maturity.status === "insufficient"
    ? { badgeLabel: "FIELD WARMING" as const, tone: "neutral" as const, pathStateLabel: "Field history insufficient" }
    : baseBadge
      ? maturity.status === "provisional"
        ? { ...baseBadge, tone: "warning" as const }
        : baseBadge
      : maturity.status === "provisional"
        ? { badgeLabel: "FIELD WARMING" as const, tone: "warning" as const, pathStateLabel: "Field history provisional" }
        : null;
  if (!badge) return null;

  const regime = compactFieldText(context?.direction?.regime);
  const alignedPressure = alignment.supported === false
    ? null
    : asFiniteNumber(
        context?.direction?.option_aligned_pressure
        ?? context?.direction?.aligned_pressure
        ?? context?.option_aligned_pressure
        ?? context?.aligned_pressure
        ?? axis?.aligned_pressure
      );
  const alignedVelocity = alignment.supported === false
    ? null
    : asFiniteNumber(
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
  const trendAgreement = asFiniteNumber(
    context?.structure_components?.trend_agreement_composite
    ?? context?.strata?.structure
    ?? axis?.structure
  );
  const trendAgreementLabel = trendAgreement !== null
    ? `Trend + agreement · ${compactScore(trendAgreement)}`
    : null;
  const boundary = compactFieldText(context?.price_action?.state || axis?.boundary_state);
  const boundaryLabel = boundary ? `Boundary · ${boundary}` : null;
  const familiarity = axis?.familiarity?.trim().toLowerCase() || null;
  const familiarityLabel = familiarity === "not_scored"
    ? "Novelty · not scored"
    : familiarity === "familiar" || familiarity === "transition" || familiarity === "novel"
      ? `Profile · ${compactFieldText(familiarity)}`
      : null;
  const timeframe = context?.timeframe || axis?.timeframe || "1D";
  const detailParts = [
    badge.pathStateLabel,
    directionLabel,
    trendAgreementLabel,
    boundaryLabel,
    alignment.alignmentLabel,
    maturity.maturityLabel,
  ].filter(Boolean);
  const summary = detailParts.join(" · ");
  const diagnosticsLabel = [scaling.scalingLabel, inputQuality.inputQualityLabel]
    .filter((value): value is string => Boolean(value))
    .join(" · ") || null;
  const diagnosticsCaveat = [scaling.scalingCaveat, inputQuality.inputQualityCaveat]
    .filter((value): value is string => Boolean(value))
    .join(" ") || null;
  const caveats = [authority.authorityCaveat, alignment.alignmentCaveat, maturity.maturityReason, diagnosticsCaveat]
    .filter((value): value is string => Boolean(value));

  return {
    ...badge,
    directionLabel,
    trendAgreementLabel,
    boundaryLabel,
    familiarityLabel,
    familiarityReason: axis?.familiarity_reason?.trim() || null,
    ...authority,
    alignmentLabel: alignment.alignmentLabel,
    alignmentCaveat: alignment.alignmentCaveat,
    maturityStatus: maturity.status,
    maturityLabel: maturity.maturityLabel,
    maturityReason: maturity.maturityReason,
    ...scaling,
    ...inputQuality,
    diagnosticsLabel,
    diagnosticsCaveat,
    semanticRevision: context?.semantic_revision?.trim() || axis?.semantic_revision?.trim() || null,
    timeframe,
    summary,
    accessibleLabel: `${badge.badgeLabel}: ${summary}.${diagnosticsLabel ? ` ${diagnosticsLabel}.` : ""} ${authority.authorityLabel}. ${authority.advisoryEffectsLabel}.${
      caveats.length > 0 ? ` ${caveats.join(" ")}` : ""
    }`,
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
