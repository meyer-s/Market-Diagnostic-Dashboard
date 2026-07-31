import type { SecretOptionsScope } from "../../utils/secretOptionsAuth";
import type {
  OptionMarketFieldAxisResult,
  OptionMarketFieldContext,
  OptionMarketFieldEffectsApplied,
  ScannerPositionMatch,
} from "../../utils/scannerPositionMatch";

/** API contracts and view-model types for the protected Secret Options workspace. */
export interface OptionPosition {
  id: number;
  trade_date: string;
  account: string | null;
  action: string | null;
  contracts: number;
  symbol: string;
  expiration: string;
  strike: number;
  option_type: string;
  fill_price: number;
  total_cost: number;
  underlying_at_entry: number | null;
  estimated_delta: number | null;
  shares_equivalent: number | null;
  dte_at_entry: number | null;
  underlying_reference: number | null;
  source_event_id: number | null;
  source_triggered_at: string | null;
  source_match_method: string | null;
  source_match_confidence: number | null;
  source_match_notes: string | null;
  evaluation_min_hold_days: number | null;
  evaluation_hold_days: number | null;
  evaluation_start_date: string | null;
  evaluation_due_date: string | null;
  evaluation_decision_deadline: string | null;
  evaluation_source: string | null;
  evaluation_window_basis: string | null;
}

export type VolatilityState = "expanding" | "contracting" | "stable" | "unknown";

export interface VolatilitySnapshot {
  event_id?: number | null;
  triggered_at?: string | null;
  iv30: number | null;
  hv30: number | null;
  iv_hv_spread: number | null;
  iv_percentile: number | null;
  avg_edr: number | null;
  contract_iv: number | null;
  data_source?: string | null;
  quote_source?: string | null;
  pricing_basis?: string | null;
  expiries_scanned?: number | null;
  as_of?: string | null;
}

export interface VolatilityTrend {
  iv30_change: number | null;
  hv30_change: number | null;
  iv_hv_spread_change: number | null;
  iv_percentile_change: number | null;
  avg_edr_change: number | null;
  contract_iv_change: number | null;
  algorithm_state: VolatilityState;
  contract_iv_state: VolatilityState;
  value_state: VolatilityState;
  headline: string;
}

export interface VolatilitySignal {
  entry: VolatilitySnapshot | null;
  current: VolatilitySnapshot;
  trend: VolatilityTrend;
  error?: string | null;
}

export type OpportunityComponents = Record<string, number | null | undefined>;

export interface PositionOpportunity {
  event_id: number | null;
  model_version: string | null;
  computed_for_date: string | null;
  cadence: string | null;
  basis: string | null;
  entry: {
    score: number | null;
    rank_score: number | null;
    grade: string | null;
    components: OpportunityComponents | null;
    triggered_at: string | null;
  } | null;
  current: {
    score: number | null;
    rank_score: number | null;
    grade: string | null;
    components: OpportunityComponents | null;
    reasons: string[];
  } | null;
  score_change: number | null;
  headline: string | null;
  error?: string | null;
}

export interface PositionMetrics {
  market: {
    current_price: number | null;
    previous_close: number | null;
    change: number | null;
    change_percent: number | null;
    implied_volatility: number | null;
    last_updated: string;
    data_source?: string | null;
    quote_source?: string | null;
  };
  option_price: number | null;
  option_price_source: string | null;
  quote: {
    bid: number | null;
    ask: number | null;
    last: number | null;
    mid: number | null;
    spread: number | null;
    spread_pct: number | null;
    volume: number | null;
    open_interest: number | null;
    implied_volatility: number | null;
    last_trade_at: string | null;
    data_source?: string | null;
    quote_source?: string | null;
    quality: string | null;
  };
  volatility: number | null;
  volatility_source: string | null;
  hv30: number | null;
  volatility_signal: VolatilitySignal;
  opportunity: PositionOpportunity | null;
  dte: number | null;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  } | null;
  pnl: {
    dollar: number | null;
    percent: number | null;
    source: string | null;
  };
}

export interface PositionPayload {
  position: OptionPosition;
  metrics: PositionMetrics;
}

export interface SecretOptionsAccess {
  actor: string;
  scope: Exclude<SecretOptionsScope, null>;
  request_id: string;
  auth_mode: "bearer" | "development_bypass";
}

export interface PositionIndexMembership {
  key: "SP500" | "RUSSELL2000";
  label: "SPY" | "R2K";
  name: string;
}

export interface PositionRowScanContext {
  event_id: number;
  triggered_at: string | null;
  sweep_run_id: number | null;
  universe_key: string | null;
  universe_label: string | null;
  opportunity_score: number | null;
  opportunity_grade: string | null;
  model_version: string | null;
  selected_expiry: string | null;
  selected_dte: number | null;
  selected_strike: number | null;
  selected_option_type: string | null;
  selected_premium: number | null;
  selected_convexity_profit_pct: number | null;
  selected_convexity_probability_itm: number | null;
}

export interface PositionRowContext {
  position_id: number;
  symbol: string;
  index_memberships: PositionIndexMembership[];
  membership_status: "complete" | "partial" | "unavailable";
  linked_trade: boolean;
  source_match_method: string | null;
  source_match_confidence: number | null;
  source_match_notes: string | null;
  scan: PositionRowScanContext | null;
}

export interface PositionDecisionReview {
  id: number;
  position_id: number;
  supersedes_review_id: number | null;
  review_sequence: number;
  review_date: string;
  review_type: "mandate" | "reassessment";
  selected_assessment_id?: number | null;
  decision_source?: string;
  human_override?: string;
  override_reason?: string | null;
  threshold_approval_status?: string;
  symbol: string;
  expiration: string;
  strike: number;
  option_type: string;
  contracts_snapshot: number;
  trade_role: string;
  original_thesis: string | null;
  contract_thesis: string | null;
  expected_path: string | null;
  catalyst: string | null;
  confirmation_condition: string | null;
  invalidation_condition: string | null;
  risk_budget: number | null;
  evidence_since_last: string | null;
  thesis_status: string;
  fresh_entry_answer: string;
  portfolio_fit: string | null;
  data_quality_notes: string | null;
  verdict: string;
  target_contracts: number;
  quality: string;
  urgency: string;
  confidence: string;
  continuation_condition: string | null;
  next_review_date: string | null;
  decision_deadline: string | null;
  decision_notes: string | null;
  snapshot: {
    underlying_price: number | null;
    option_price: number | null;
    remaining_capital: number | null;
    pnl_dollar: number | null;
    pnl_percent: number | null;
    dte: number | null;
    delta: number | null;
    theta: number | null;
    implied_volatility: number | null;
    quote_quality: string | null;
    market_data_as_of: string | null;
  };
  created_at: string | null;
}

export interface PositionDecisionStatus {
  window_status: string;
  review_due: boolean;
  decision_deadline_missed: boolean;
  additions_blocked: boolean;
  addition_blockers: string[];
  warnings: string[];
  missing_mandate_fields: string[];
}

export interface PositionDecisionReviewResponse {
  position_id: number;
  review_count: number;
  latest_review: PositionDecisionReview | null;
  status: PositionDecisionStatus;
  history: PositionDecisionReview[];
}

export interface PositionDecisionWindowRevision {
  id: number;
  position_id: number;
  review_sequence: number;
  review_date: string;
  next_review_date: string | null;
  decision_deadline: string | null;
}

export interface PositionDecisionWindowResponse {
  position_count: number;
  window_count: number;
  windows_by_position: Record<string, PositionDecisionWindowRevision[]>;
}

export interface OptionPositionMandate {
  id: number;
  mandate_version: number;
  confirmation_status: string;
  threshold_origin: string;
  threshold_approval_status: string;
  trade_role: string;
  original_thesis: string | null;
  contract_thesis: string | null;
  expected_path: string | null;
  catalyst: string | null;
  confirmation_condition: string | null;
  invalidation_condition: string | null;
  decision_deadline: string | null;
  risk_budget: number | null;
}

export interface PositionThesisAssessment {
  id: number;
  position_id: number;
  trigger: string;
  as_of: string | null;
  grader_version: string;
  data_quality_status: string;
  company_thesis_status: string;
  security_thesis_readiness: string;
  path_status: string;
  contract_status: string;
  portfolio_fit_status: string;
  proposed_verdict: string;
  proposed_target_contracts: number;
  target_contracts_min: number;
  target_contracts_max: number;
  quality: string;
  urgency: string;
  confidence: string;
  market_field_effects?: OptionMarketFieldEffectsApplied | null;
  continuation_condition: string | null;
  next_review_date: string | null;
  decision_deadline: string | null;
  vetoes: Array<{ code: string; hard?: boolean; detail: string }>;
  reasons: string[];
  missing_inputs: string[];
  input_snapshot?: ({
    field_context?: OptionMarketFieldContext | null;
  } & Record<string, unknown>) | null;
  axis_results?: ({
    market_structure?: OptionMarketFieldAxisResult | null;
    trim_sizing?: {
      status: string;
      model_version: string;
      severity_score: number;
      raw_ladder: string;
      applied_ladder: string;
      target_contracts: number;
      target_retention_pct: number;
      trim_contracts: number;
      trim_pct: number;
      harvest_candidate: boolean;
      loss_drawdown_used_for_sizing: boolean;
      signals: Array<{
        code: string;
        points: number;
        category: string;
        detail: string;
      }>;
      execution?: {
        ready: boolean;
        two_sided: boolean;
        spread_pct: number | null;
        spread_limit_pct: number;
        note: string;
      };
      persistence?: {
        hard_resize_bypass: boolean;
        previous_ladder: string;
        previous_assessment_date: string | null;
        repeated_signal_codes: string[];
        escalation_limited: boolean;
        rule: string;
      };
    } | null;
  } & Record<string, unknown>) | null;
}

export interface SuggestedDecisionWindow {
  as_of_date: string;
  next_review_date: string | null;
  decision_deadline: string;
  next_review_sessions: number;
  max_hold_sessions: number;
  original_min_hold_days: number;
  original_max_hold_days: number;
  basis: string;
  source_assessment_id: number;
  decision_source: "latest_review" | "automatic_assessment";
  verdict: string;
  urgency: string;
  rebased: boolean;
  continuation_condition: string;
}

export interface PositionThesisAssessmentResponse {
  position_id: number;
  mandate: OptionPositionMandate;
  assessment: PositionThesisAssessment;
  suggested_window: SuggestedDecisionWindow;
  review_defaults: Record<string, string | number | null | undefined>;
  risk_policy: {
    id: number;
    policy_version: number;
    name: string;
    active: boolean;
    approval_status: string;
    portfolio_capital: number | null;
    default_trade_risk_budget: number | null;
    max_single_position_premium_pct: number | null;
    max_directional_premium_pct: number | null;
    max_expiry_bucket_premium_pct: number | null;
    max_option_spread_pct: number | null;
    min_dte_for_add: number | null;
  };
  history: PositionThesisAssessment[];
  automated_execution_enabled: false;
  execution_note: string;
}

export interface OptionTradeLearningOutcome {
  id: number;
  outcome_version: number;
  outcome_status: string;
  process_quality: string;
  financial_outcome: string;
  primary_lesson: string;
  decision_alignment: string;
  thesis_result: string;
  contract_result: string;
  timing_result?: string;
  sizing_result: string;
  portfolio_result?: string;
  entry_execution_result?: string;
  exit_discipline_result?: string;
  event_result?: string;
  review_discipline: string;
}

export interface OptionLearningSummary {
  sample: {
    open_review_records: number;
    automatic_assessments: number;
    actual_closed_trades: number;
    classified_trade_cycles: number;
    matured_decision_horizons: number;
  };
  trade_outcomes: {
    process_quality: Record<string, number>;
    primary_lessons: Record<string, number>;
    contract_results: Record<string, number>;
    timing_results?: Record<string, number>;
    portfolio_results?: Record<string, number>;
    exit_discipline_results?: Record<string, number>;
  };
  scanner_recurrence_outcomes?: {
    cohorts: Record<
      "no_repeat" | "repeat_seen" | "strengthened_seen" | "contract_drift_seen",
      {
        sample_count: number;
        profitable: number;
        unprofitable: number;
        flat: number;
        average_percent_pnl: number | null;
      }
    >;
    actual_closed_trades_only: boolean;
    minimum_sample_before_comparison: number;
    automatic_weight_changes: false;
  };
  market_field_outcomes?: {
    cohorts: Record<
      "supportive" | "fading" | "contradictory" | "mixed" | "unavailable",
      {
        sample_count: number;
        profitable: number;
        unprofitable: number;
        flat: number;
        average_percent_pnl: number | null;
      }
    >;
    actual_closed_trades_only: boolean;
    point_in_time_snapshot_required: boolean;
    minimum_sample_before_comparison: number;
    direct_rank_influence?: 0;
    eligible_for_outcome_learning_canary?: boolean;
    maximum_total_canary_weight?: number;
    rank_influence_note?: string;
    rank_influence: 0;
    automatic_weight_changes: false;
  };
  promotion_readiness: {
    minimum_classified_actual_close_cycles?: number;
    current_classified_actual_close_cycles?: number;
    minimum_independent_trade_cycles: number;
    current_independent_trade_cycles: number;
    remaining_cycles: number;
    learned_review_model_allowed: boolean;
    automatic_promotion: false;
    status: string;
  };
  guardrails: {
    automated_execution_enabled: false;
  };
}

export interface ClosedPositionRow {
  id: number;
  source_position_id?: number | null;
  symbol: string;
  option_type: string;
  strike: number;
  expiration: string;
  contracts: number;
  trade_date: string;
  close_date: string;
  fill_price: number;
  exit_price: number;
  total_cost: number;
  total_proceeds: number;
  dollar_pnl: number;
  percent_pnl: number;
  underlying_at_entry: number | null;
  underlying_at_exit: number | null;
  account: string | null;
  notes: string | null;
  source_event_id: number | null;
  source_triggered_at: string | null;
  source_match_method: string | null;
  source_match_confidence: number | null;
  source_match_notes: string | null;
  source_opportunity_score: number | null;
  source_opportunity_grade: string | null;
  source_opportunity_rank_score: number | null;
  source_opportunity_model_version: string | null;
  learning_outcome?: OptionTradeLearningOutcome | null;
}

export type ClosedRestoreTarget = Pick<ClosedPositionRow, "id" | "symbol" | "close_date">;

export interface ClosePositionResponse {
  closed_position_id: number;
  symbol: string;
}

export interface RestoreClosedPositionResponse {
  message: string;
  position: OptionPosition;
  closed_position_id: number;
  learning_outcomes_reversed: number;
}

export interface TrainingOutcomeRow {
  event_id: number;
  symbol: string;
  triggered_at: string | null;
  option_type: string;
  review_min_hold_days: number | null;
  review_max_hold_days: number | null;
  hold_days: number;
  entry_date: string;
  exit_date: string | null;
  entry_underlying: number;
  exit_underlying: number | null;
  underlying_directional_return_pct: number | null;
  entry_option_price_est: number | null;
  exit_option_price_est: number | null;
  option_return_pct_est: number | null;
  option_pnl_per_contract_est: number | null;
  status: "matured" | "pending";
  opportunity_score: number | null;
  opportunity_grade: string | null;
  opportunity_rank_score: number | null;
  opportunity_model_version: string | null;
}

export interface TrainingOutcomeSummary {
  sample_size: number;
  matured: number;
  pending: number;
  win_rate_pct: number | null;
  avg_option_return_pct: number | null;
  total_option_pnl_per_contract: number | null;
}

export interface TrainingOutcomeResponse {
  outcomes: TrainingOutcomeRow[];
  summary: TrainingOutcomeSummary;
}

export interface OpportunityBacktestStats {
  count: number;
  total_pnl: number;
  avg_pnl: number | null;
  avg_percent_pnl: number | null;
  win_rate_pct: number | null;
}

export interface OpportunityBacktestResponse {
  threshold: number;
  lookback_days: number;
  model_version: string;
  summary: {
    closed_positions_checked: number;
    scored_trades: number;
    unscored_trades: number;
    all_trades: OpportunityBacktestStats;
    model_selected: OpportunityBacktestStats;
    model_excluded: OpportunityBacktestStats;
    avg_percent_delta_vs_all: number | null;
    avoided_loss_from_excluded: number;
    excluded_winners_left_on_table: number;
    grade_buckets: Record<string, OpportunityBacktestStats>;
  };
}

export interface OptionalityClusterEvent {
  event_id: number;
  symbol: string;
  triggered_at: string | null;
  sector: string;
  group: string;
  iv_percentile: number | null;
  iv_hv_spread: number | null;
  avg_edr: number | null;
  selected_option_type: string | null;
}

export interface OptionalityCluster {
  group: string;
  sector: string;
  hits: number;
  recent_hits: number;
  prior_hits: number;
  momentum: number;
  symbols: string[];
  avg_iv_percentile: number | null;
  avg_iv_hv_spread: number | null;
  latest_triggered_at: string | null;
  strength_score: number;
  events: OptionalityClusterEvent[];
}

export interface OptionalityClusterResponse {
  lookback_days: number;
  bucket_days: number;
  generated_at: string;
  clusters: OptionalityCluster[];
}

export interface ScannerTopSymbol {
  symbol: string;
  hits: number;
  recent_hits: number;
  latest_triggered_at: string | null;
  group: string;
  sector: string;
  avg_iv_percentile: number | null;
  avg_iv_hv_spread: number | null;
  avg_opportunity_score: number | null;
}

export interface OptionLearningSignal {
  family: string;
  cohort: string;
  available: boolean;
  minimum_sample: number;
  eligible_comparison_cohorts: string[];
  reason?: string;
  sample_count?: number;
  score?: number;
  reliability?: number;
}

export interface OptionLearningFamilyAttribution {
  available: boolean;
  cohort?: string | null;
  signal_score?: number | null;
  reliability: number;
  normalized_learning_weight: number;
  learning_score_component: number;
  counterfactual_score_delta: number;
  applied_score_delta: number;
  direct_scanner_weight?: number | null;
  influence_path: "indirect_outcome_learning_canary" | "outcome_learning_canary" | "not_applied";
  rank_without_family?: number;
  applied_rank?: number;
  applied_rank_delta?: number;
  applied_rank_changed?: boolean;
}

export interface OptionLearningEvaluation {
  version: string;
  mode: "counterfactual_shadow" | "bounded_live_canary";
  status: "collecting_comparable_cohorts" | "counterfactual_only" | "counterfactual_operator_disabled" | "manual_promotion_eligible" | "live_canary_active" | "legacy_shadow_only";
  champion_score: number;
  learning_score: number | null;
  counterfactual_score: number;
  counterfactual_delta: number;
  counterfactual_weight: number;
  evidence_scaled_event_weight?: number;
  nominal_weight_cap?: number;
  maximum_counterfactual_weight?: number;
  applied_score: number;
  applied_weight: number;
  applied_event_weight?: number;
  maximum_applied_weight?: number;
  champion_rank?: number;
  counterfactual_rank?: number;
  applied_rank?: number;
  rank_delta?: number;
  applied_rank_delta?: number;
  rank_changed: boolean;
  /** Legacy event-capture field; the separate terminal-run receipt is created later. */
  rank_snapshot_persisted?: boolean;
  rank_snapshot_state_at_event_capture?: string;
  candidate_cohorts: Record<string, string>;
  signals: OptionLearningSignal[];
  family_attribution?: Record<string, OptionLearningFamilyAttribution>;
  authority?: {
    candidate_eligibility?: string;
    hard_veto?: string;
    position_sizing?: string;
    review_verdict?: string;
    automated_execution?: string;
    direct_market_field_scanner_weight?: number;
    outcome_learning_canary_maximum_weight?: number;
    market_field_indirect_applied_score_delta?: number;
    note?: string;
  };
  gates: Record<string, boolean>;
  operator_authorization?: {
    configured: boolean;
    setting: string;
    default: boolean;
    frozen_in_receipt: boolean;
  };
  weight_control?: {
    configured_policy_cap: number;
    evidence_scaled_event_weight: number;
    applied_event_weight: number;
    operator_authorized: boolean;
    evidence_scaling_is_policy_or_cap_change: boolean;
    automatic_policy_or_cap_changes: boolean;
  };
  evidence_gates_passed?: boolean;
  application_gates_passed?: boolean;
  promotion_ready_for_review: boolean;
  live_canary_active?: boolean;
  point_in_time_receipt?: boolean;
  manual_promotion_required: boolean;
  automatic_weight_changes: boolean;
  automatic_policy_or_cap_changes?: boolean;
  reasons: string[];
}

export interface OptionLearningPolicy {
  version: string;
  mode: "counterfactual_shadow" | "bounded_live_canary";
  nominal_weight_cap: number;
  actual_rank_influence: number;
  maximum_counterfactual_weight: number;
  maximum_applied_weight?: number;
  live_canary_enabled?: boolean;
  configured_operator_authorization?: boolean;
  operator_authorization?: {
    configured: boolean;
    setting: string;
    default: boolean;
    frozen_in_context: boolean;
  };
  weight_policy?: {
    configured_cap: number;
    event_weight_is_evidence_scaled: boolean;
    automatic_policy_or_cap_changes: boolean;
  };
  automatic_weight_changes: boolean;
  automatic_policy_or_cap_changes?: boolean;
  manual_promotion_required: boolean;
  evidence: {
    classified_actual_close_cycles?: number;
    minimum_classified_actual_close_cycles?: number;
    independent_trade_cycles: number;
    minimum_independent_trade_cycles: number;
    full_promotion_minimum_trade_cycles?: number;
    non_weak_process_cycles: number;
    non_weak_process_share: number;
    minimum_non_weak_process_share: number;
  };
  base_gates: {
    independent_cycles: boolean;
    process_quality: boolean;
  };
  evaluated_opportunities: number;
  counterfactual_rank_changes: number;
  applied_opportunities?: number;
  applied_rank_changes?: number;
  observed_max_applied_weight?: number;
  observed_mean_applied_weight?: number;
  actual_order_unchanged: boolean;
}

export interface ScannerRankedOpportunity {
  event_id: number;
  scan_ordinal?: number | null;
  display_ordinal?: number | null;
  champion_rank?: number | null;
  counterfactual_rank?: number | null;
  applied_rank?: number | null;
  champion_score?: number | null;
  counterfactual_score?: number | null;
  applied_score?: number | null;
  applied_weight?: number | null;
  symbol: string;
  triggered_at: string | null;
  group: string;
  sector: string;
  score: number;
  base_score: number;
  grade: string | null;
  model_version: string;
  components: Record<string, number | null | undefined>;
  reasons: string[];
  message?: string | null;
  iv_percentile: number | null;
  iv30: number | null;
  hv30: number | null;
  iv_hv_spread: number | null;
  avg_edr: number | null;
  review_window?: {
    min_hold_days: number | null;
    max_hold_days: number | null;
    basis: string | null;
  } | null;
  position_match?: ScannerPositionMatch | null;
  field_context?: OptionMarketFieldContext | null;
  learning_evaluation?: OptionLearningEvaluation | null;
  selected_contract: {
    expiry: string | null;
    dte: number | null;
    strike: number | null;
    option_type: string | null;
    premium: number | null;
    price_source?: string | null;
    bid?: number | null;
    ask?: number | null;
    last?: number | null;
    spread_pct: number | null;
    open_interest: number | null;
    volume: number | null;
    implied_volatility: number | null;
    last_trade_at?: string | null;
    contract_score: number | null;
    reward_risk: number | null;
    convexity_profit_pct: number | null;
    convexity_probability_itm: number | null;
    planned_loss_pct?: number | null;
    target_profit_pct?: number | null;
  };
}

export interface ScannerRun {
  id: number;
  universe_key: string;
  universe_label: string;
  threshold: number;
  trigger_source: string;
  status: string;
  total_symbols: number;
  scanned_symbols: number;
  hits: number;
  errors: number;
  rate_limit_errors: number;
  hit_symbols: string[];
  notes: string | null;
  last_event: string | null;
  last_symbol: string | null;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

export interface ScannerSummary {
  event_count: number;
  symbol_count: number;
  delivered: number;
  failed: number;
  latest_event_at: string | null;
  runs_returned: number;
  active_runs: number;
  stale_runs_marked?: number;
  avg_hit_rate: number | null;
}

export interface ScannerUniverse {
  key: string;
  label: string;
}

export interface ScannerSummaryResponse {
  lookback_days: number;
  generated_at: string;
  summary: ScannerSummary;
  top_symbols: ScannerTopSymbol[];
  ranked_opportunities: ScannerRankedOpportunity[];
  learning_policy?: OptionLearningPolicy;
  runs: ScannerRun[];
  supported_universes: ScannerUniverse[];
}

export interface ScannerRunResponse {
  status: string;
  run: ScannerRun;
}

export interface ScannerRankSnapshotCandidate {
  event_id: number;
  symbol: string;
  scan_ordinal: number;
  display_ordinal: number;
  champion_rank: number | null;
  counterfactual_rank: number | null;
  applied_rank: number;
  champion_score: number | null;
  counterfactual_score: number | null;
  applied_score: number | null;
  applied_weight: number | null;
  opportunity_model_version: string;
  ranking_model_version: string;
}

export interface ScannerRankSnapshot {
  id: number;
  snapshot_uuid: string;
  schema_version: string;
  surface: "scanner_run_detail";
  scope_key: string;
  sweep_run_id: number;
  learning_policy_version: string | null;
  opportunity_model_versions: string[];
  ranking_model_versions: string[];
  candidate_count: number;
  payload_sha256: string;
  integrity_verified: boolean;
  source_generated_at: string | null;
  created_at: string | null;
  candidates: ScannerRankSnapshotCandidate[];
}

export interface ScannerImpressionDraft {
  dedupeKey: string;
  exposure_type:
    | "ranking_rendered"
    | "candidate_visible"
    | "candidate_detail_opened"
    | "market_field_link_clicked"
    | "trade_prefill_opened";
  event_id?: number;
  visibility_ratio?: number;
  visible_ms?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ScannerImpressionWire {
  client_impression_id: string;
  exposure_type: ScannerImpressionDraft["exposure_type"];
  event_id?: number;
  client_occurred_at: string;
  visibility_ratio?: number;
  visible_ms?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ScannerRunDetailResponse {
  run: ScannerRun;
  hit_count: number;
  matched_event_count: number;
  hits: ScannerRankedOpportunity[];
  learning_policy?: OptionLearningPolicy;
  ranking_snapshot?: ScannerRankSnapshot | null;
}

export interface EvaluationInsight {
  minHoldDays: number;
  holdDays: number;
  elapsedDays: number;
  daysRemaining: number;
  windowStartRemainingDays: number;
  progressPct: number;
  urgency: "calm" | "watch" | "due" | "overdue";
  label: string;
  detail: string;
  pillClass: string;
  barClass: string;
}

export type EvalUrgency = EvaluationInsight["urgency"];
export type PositionFilter = "all" | "attention" | "matched" | "watch" | "due" | "overdue" | "lowConfidence" | "losing";
export type MobileOptionsWorkspace = "positions" | "scanner" | "insights";
export type MobileScannerView = "history" | "hits" | "repeated" | "earnings";
export interface TimelineLane {
  laneId: string;
  linkedPositionId: number | null;
  eventId: number | null;
  symbol: string;
  optionType: string;
  contracts: number;
  matched: boolean;
  urgency: EvalUrgency;
  minHoldDays: number;
  maxHoldDays: number;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  progressPct: number;
  label: string;
  detail: string;
  pillClass: string;
  barClass: string;
  attentionStrength: number;
  attentionSpreadDays: number;
  greeksHint: string;
}

export interface RawPositionPayload {
  position: OptionPosition;
  metrics?: Partial<PositionMetrics> | null;
}

export interface PositionRefreshProgress {
  total: number;
  completed: number;
  current_position_id: number | null;
  current_symbol: string | null;
  target_position_ids: number[];
  completed_position_ids: number[];
}

export type PositionRefreshState = "idle" | "pending" | "active" | "complete";

export interface PositionListResponse {
  positions: RawPositionPayload[];
  metrics_cache?: {
    status: "fresh" | "stale";
    age_seconds: number;
    refresh_in_progress: boolean;
    refresh_progress?: PositionRefreshProgress;
  };
}

export interface GreeksPayload {
  price_curve: { price: number; delta: number; gamma: number }[];
  theta_curve: { days: number; theta: number }[];
  current_greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    price: number;
  } | null;
  model_info: {
    model?: string;
    risk_free_rate?: number;
    volatility?: number;
    volatility_source?: string;
    spot_price?: number;
    dte?: number;
    units?: {
      delta: string;
      gamma: string;
      theta: string;
      vega: string;
    };
    error?: string;
  };
}

export type SortDirection = "asc" | "desc";
export type PositionSortKey =
  | "symbol"
  | "strike"
  | "expiration"
  | "option_type"
  | "contracts"
  | "fill_price"
  | "option_price"
  | "underlying"
  | "dte"
  | "pnl"
  | "delta"
  | "theta";
export type ClosedSortKey =
  | "symbol"
  | "strike"
  | "option_type"
  | "fill_price"
  | "exit_price"
  | "close_date"
  | "dollar_pnl"
  | "percent_pnl";

export interface ZoneInputs {
  profitTake: string;
  lossCut: string;
}

export interface SpotWeighting {
  technical: number | null;
  fundamental: number | null;
  composite: number;
  confidence: number;
  signalCount: number;
  direction: "left" | "right" | "neutral";
}
