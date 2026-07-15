import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  usePlotArea,
} from "recharts";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Pencil,
  Play,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import { apiFetch } from "../utils/apiUtils";
import { CHART_NEUTRAL } from "../utils/chartUtils";
import { formatDate, formatNumber } from "../utils/styleUtils";
import { getFamilyColor } from "../theme/metricColors";
import { buildHolisticSummary } from "../utils/holisticSummary";
import { buildSummaryInputFromSnapshot, type TechnicalDataLike, type FundamentalsLike, type OptionalityLike } from "../utils/summaryInput";
import {
  presentScannerPositionMatch,
  type ScannerPositionMatch,
  type ScannerPositionMatchTone,
} from "../utils/scannerPositionMatch";

interface OptionPosition {
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

type VolatilityState = "expanding" | "contracting" | "stable" | "unknown";

interface VolatilitySnapshot {
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

interface VolatilityTrend {
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

interface VolatilitySignal {
  entry: VolatilitySnapshot | null;
  current: VolatilitySnapshot;
  trend: VolatilityTrend;
  error?: string | null;
}

type OpportunityComponents = Record<string, number | null | undefined>;

interface PositionOpportunity {
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

interface PositionMetrics {
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

interface PositionPayload {
  position: OptionPosition;
  metrics: PositionMetrics;
}

interface PositionDecisionReview {
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

interface PositionDecisionStatus {
  window_status: string;
  review_due: boolean;
  decision_deadline_missed: boolean;
  additions_blocked: boolean;
  addition_blockers: string[];
  warnings: string[];
  missing_mandate_fields: string[];
}

interface PositionDecisionReviewResponse {
  position_id: number;
  review_count: number;
  latest_review: PositionDecisionReview | null;
  status: PositionDecisionStatus;
  history: PositionDecisionReview[];
}

interface PositionDecisionWindowRevision {
  id: number;
  position_id: number;
  review_sequence: number;
  review_date: string;
  next_review_date: string | null;
  decision_deadline: string | null;
}

interface PositionDecisionWindowResponse {
  position_count: number;
  window_count: number;
  windows_by_position: Record<string, PositionDecisionWindowRevision[]>;
}

interface OptionPositionMandate {
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

interface PositionThesisAssessment {
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
  continuation_condition: string | null;
  next_review_date: string | null;
  decision_deadline: string | null;
  vetoes: Array<{ code: string; hard?: boolean; detail: string }>;
  reasons: string[];
  missing_inputs: string[];
}

interface SuggestedDecisionWindow {
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

interface PositionThesisAssessmentResponse {
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

interface OptionTradeLearningOutcome {
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

interface OptionLearningSummary {
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
  promotion_readiness: {
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

interface ClosedPositionRow {
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

interface TrainingOutcomeRow {
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

interface TrainingOutcomeSummary {
  sample_size: number;
  matured: number;
  pending: number;
  win_rate_pct: number | null;
  avg_option_return_pct: number | null;
  total_option_pnl_per_contract: number | null;
}

interface TrainingOutcomeResponse {
  outcomes: TrainingOutcomeRow[];
  summary: TrainingOutcomeSummary;
}

interface OpportunityBacktestStats {
  count: number;
  total_pnl: number;
  avg_pnl: number | null;
  avg_percent_pnl: number | null;
  win_rate_pct: number | null;
}

interface OpportunityBacktestResponse {
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

interface OptionalityClusterEvent {
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

interface OptionalityCluster {
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

interface OptionalityClusterResponse {
  lookback_days: number;
  bucket_days: number;
  generated_at: string;
  clusters: OptionalityCluster[];
}

interface ScannerTopSymbol {
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

interface ScannerRankedOpportunity {
  event_id: number;
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

interface ScannerRun {
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

interface ScannerSummary {
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

interface ScannerUniverse {
  key: string;
  label: string;
}

interface ScannerSummaryResponse {
  lookback_days: number;
  generated_at: string;
  summary: ScannerSummary;
  top_symbols: ScannerTopSymbol[];
  ranked_opportunities: ScannerRankedOpportunity[];
  runs: ScannerRun[];
  supported_universes: ScannerUniverse[];
}

interface ScannerRunResponse {
  status: string;
  run: ScannerRun;
}

interface ScannerRunDetailResponse {
  run: ScannerRun;
  hit_count: number;
  matched_event_count: number;
  hits: ScannerRankedOpportunity[];
}

interface EvaluationInsight {
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

type EvalUrgency = EvaluationInsight["urgency"];
type PositionFilter = "all" | "matched" | "watch" | "due" | "overdue" | "lowConfidence" | "losing";
interface TimelineLane {
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

interface RawPositionPayload {
  position: OptionPosition;
  metrics?: Partial<PositionMetrics> | null;
}

interface PositionListResponse {
  positions: RawPositionPayload[];
  metrics_cache?: {
    status: "fresh" | "stale";
    age_seconds: number;
    refresh_in_progress: boolean;
  };
}

interface GreeksPayload {
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

type SortDirection = "asc" | "desc";
type PositionSortKey =
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
type ClosedSortKey =
  | "symbol"
  | "strike"
  | "option_type"
  | "fill_price"
  | "exit_price"
  | "close_date"
  | "dollar_pnl"
  | "percent_pnl";

interface ZoneInputs {
  profitTake: string;
  lossCut: string;
}

interface SpotWeighting {
  technical: number | null;
  fundamental: number | null;
  composite: number;
  confidence: number;
  signalCount: number;
  direction: "left" | "right" | "neutral";
}

const EMPTY_SPOT_WEIGHTING: SpotWeighting = {
  technical: null,
  fundamental: null,
  composite: 0,
  confidence: 0,
  signalCount: 0,
  direction: "neutral",
};

const formatCurrency = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `$${value.toFixed(digits)}`;
};

const formatPercent = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
};

const formatSigned = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
};

const formatVolPct = (value: number | null | undefined, digits = 1) => formatPercent(value, digits);

const formatPointChange = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${formatSigned(value, digits)} pts`;
};

const emptyVolatilitySnapshot = (): VolatilitySnapshot => ({
  iv30: null,
  hv30: null,
  iv_hv_spread: null,
  iv_percentile: null,
  avg_edr: null,
  contract_iv: null,
});

const emptyVolatilitySignal = (): VolatilitySignal => ({
  entry: null,
  current: emptyVolatilitySnapshot(),
  trend: {
    iv30_change: null,
    hv30_change: null,
    iv_hv_spread_change: null,
    iv_percentile_change: null,
    avg_edr_change: null,
    contract_iv_change: null,
    algorithm_state: "unknown",
    contract_iv_state: "unknown",
    value_state: "unknown",
    headline: "Volatility baseline unavailable",
  },
});

const normalizeVolatilitySnapshot = (
  snapshot: Partial<VolatilitySnapshot> | null | undefined
): VolatilitySnapshot | null => {
  if (!snapshot) return null;
  return {
    ...emptyVolatilitySnapshot(),
    ...snapshot,
    iv30: snapshot.iv30 ?? null,
    hv30: snapshot.hv30 ?? null,
    iv_hv_spread: snapshot.iv_hv_spread ?? null,
    iv_percentile: snapshot.iv_percentile ?? null,
    avg_edr: snapshot.avg_edr ?? null,
    contract_iv: snapshot.contract_iv ?? null,
  };
};

const normalizeVolatilitySignal = (
  signal: Partial<VolatilitySignal> | null | undefined
): VolatilitySignal => {
  const empty = emptyVolatilitySignal();
  const trend = (signal?.trend ?? {}) as Partial<VolatilityTrend>;
  return {
    entry: normalizeVolatilitySnapshot(signal?.entry),
    current: normalizeVolatilitySnapshot(signal?.current) ?? empty.current,
    trend: {
      ...empty.trend,
      ...trend,
      algorithm_state: trend.algorithm_state ?? "unknown",
      contract_iv_state: trend.contract_iv_state ?? "unknown",
      value_state: trend.value_state ?? "unknown",
      headline: trend.headline ?? empty.trend.headline,
    },
    error: signal?.error ?? null,
  };
};

const getVolatilityStateClasses = (state: VolatilityState) => {
  if (state === "expanding") {
    return {
      label: "Expanding",
      text: "text-emerald-300",
      border: "border-emerald-500/35",
      bg: "bg-emerald-500/10",
    };
  }
  if (state === "contracting") {
    return {
      label: "Contracting",
      text: "text-rose-300",
      border: "border-rose-500/35",
      bg: "bg-rose-500/10",
    };
  }
  if (state === "stable") {
    return {
      label: "Stable",
      text: "text-sky-200",
      border: "border-sky-500/30",
      bg: "bg-sky-500/10",
    };
  }
  return {
    label: "Unknown",
    text: "text-gray-400",
    border: "border-gray-700/70",
    bg: "bg-gray-900/45",
  };
};

const getContractHvSpread = (snapshot: VolatilitySnapshot | null, hvFallback?: number | null) => {
  const contractIv = snapshot?.contract_iv ?? null;
  const hv30 = snapshot?.hv30 ?? hvFallback ?? null;
  if (contractIv === null || contractIv === undefined || hv30 === null || hv30 === undefined) {
    return null;
  }
  return Number((contractIv - hv30).toFixed(2));
};

const buildVolatilityRead = (signal: VolatilitySignal) => {
  const state = signal.trend.value_state;
  const classes = getVolatilityStateClasses(state);
  const contractChange = signal.trend.contract_iv_change;
  const spreadChange = signal.trend.iv_hv_spread_change;
  const currentSpread = signal.current.iv_hv_spread;
  const currentContractHvSpread = getContractHvSpread(signal.current);
  const currentIv30 = signal.current.iv30;
  const currentHv30 = signal.current.hv30;
  const entryContractIv = signal.entry?.contract_iv;
  const currentContractIv = signal.current.contract_iv;
  const label =
    contractChange !== null && contractChange !== undefined
      ? `IV ${formatPointChange(contractChange)}`
      : spreadChange !== null && spreadChange !== undefined
        ? `IV/HV ${formatPointChange(spreadChange)}`
        : signal.trend.headline || classes.label;
  const detail =
    entryContractIv !== null && entryContractIv !== undefined && currentContractIv !== null && currentContractIv !== undefined
      ? `contract ${formatVolPct(entryContractIv)} -> ${formatVolPct(currentContractIv)}`
      : currentContractHvSpread !== null
        ? `contract IV/HV ${formatPointChange(currentContractHvSpread)}`
        : currentSpread !== null && currentSpread !== undefined
      ? `spread ${formatPointChange(currentSpread)}`
      : currentIv30 !== null && currentHv30 !== null
        ? `IV30 ${formatVolPct(currentIv30)} / HV30 ${formatVolPct(currentHv30)}`
        : currentContractIv !== null && currentContractIv !== undefined
          ? `contract IV ${formatVolPct(currentContractIv)}`
          : currentHv30 !== null && currentHv30 !== undefined
            ? `HV30 ${formatVolPct(currentHv30)}`
            : "vol pending";

  return { ...classes, label, detail };
};

const clusterMomentumClass = (momentum: number) => {
  if (momentum > 0) return "text-emerald-300";
  if (momentum < 0) return "text-rose-300";
  return "text-gray-400";
};

const scannerStatusClass = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "running" || normalized === "queued") {
    return "border-sky-500/35 bg-sky-500/10 text-sky-200";
  }
  if (normalized === "completed") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  }
  if (normalized === "stopped") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  }
  if (normalized === "stale") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  }
  return "border-rose-500/35 bg-rose-500/10 text-rose-200";
};

const SCANNER_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;

const isActiveScannerRun = (run: ScannerRun) => {
  if (run.status !== "queued" && run.status !== "running") return false;
  const timestamp = run.updated_at || run.started_at;
  if (!timestamp) return true;
  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) return true;
  return Date.now() - parsed < SCANNER_ACTIVE_STALE_MS;
};

const opportunityScoreClass = (score: number | null | undefined) => {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return "border-stealth-700 bg-stealth-800 text-stealth-300";
  }
  if (score >= 85) return "border-emerald-400/50 bg-emerald-500/15 text-emerald-100";
  if (score >= 75) return "border-lime-400/45 bg-lime-500/15 text-lime-100";
  if (score >= 65) return "border-sky-400/45 bg-sky-500/15 text-sky-100";
  if (score >= 50) return "border-amber-400/45 bg-amber-500/15 text-amber-100";
  return "border-stealth-700 bg-stealth-900 text-stealth-300";
};

const compactOpportunityGrade = (score: number | null | undefined, fallback?: string | null) => {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return fallback && fallback !== "Watch" ? fallback : "—";
  }
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 60) return "C+";
  if (score >= 55) return "C";
  if (score >= 50) return "C-";
  if (score >= 45) return "D+";
  if (score >= 40) return "D";
  return "D-";
};

const OpportunityRankBadge = ({
  score,
  grade,
  rankScore,
  modelVersion,
  className = "",
}: {
  score: number | null | undefined;
  grade?: string | null;
  rankScore?: number | null;
  modelVersion?: string | null;
  className?: string;
}) => {
  const label = compactOpportunityGrade(score, grade);
  if (label === "—") return null;
  const titleParts = [
    `Grade ${label}`,
    score !== null && score !== undefined && !Number.isNaN(score) ? `score ${score.toFixed(1)}` : null,
    rankScore !== null && rankScore !== undefined && !Number.isNaN(rankScore) ? `rank ${rankScore.toFixed(1)}` : null,
    modelVersion || null,
  ].filter(Boolean);
  return (
    <span
      title={titleParts.join(" · ")}
      className={`inline-flex min-w-8 items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${opportunityScoreClass(score)} ${className}`}
    >
      {label}
    </span>
  );
};

const buildOpportunityRead = (opportunity: PositionOpportunity | null | undefined) => {
  const score = opportunity?.current?.score ?? opportunity?.entry?.score ?? null;
  const grade = opportunity?.current?.grade ?? opportunity?.entry?.grade ?? null;
  const change = opportunity?.score_change ?? null;
  const label = compactOpportunityGrade(score, grade);
  const detail =
    change !== null && change !== undefined
      ? `${opportunity?.headline || "Rank"} ${formatSigned(change, 1)}`
      : opportunity?.error
        ? "—"
        : "—";
  return {
    score,
    grade,
    label,
    detail,
    className: opportunityScoreClass(score),
  };
};

const capitalizeWord = (value: string) => {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

const formatDataSource = (source?: string | null, quoteSource?: string | null) => {
  const normalized = source?.trim().toLowerCase();
  const provider =
    normalized === "ibkr"
      ? "IBKR"
      : normalized === "yahoo" || normalized === "yfinance"
        ? "yfinance"
        : source?.trim() || "Unknown";
  const detail = quoteSource?.trim();
  return detail ? `${provider} (${detail.replace(/_/g, " ")})` : provider;
};

interface ParsedScannerAlertSection {
  title: string;
  rows: Array<{ label: string; value: string }>;
  lines: string[];
}

const scannerAlertHeaders = [
  "MISPRICING",
  "OPPORTUNITY RANK",
  "DIRECTION",
  "MACD 1W",
  "HORIZONS",
  "EXAMPLE TRADE",
];

const cleanScannerAlertMessage = (message?: string | null) =>
  (message || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/```ansi|```/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !/^[-=─]{6,}$/.test(trimmed);
    });

const scannerHeaderForLine = (line: string) => {
  const normalized = line.trim().toUpperCase();
  return scannerAlertHeaders.find((header) => normalized.startsWith(header)) || null;
};

const parseScannerAlertSections = (message?: string | null): ParsedScannerAlertSection[] => {
  const lines = cleanScannerAlertMessage(message);
  const sections: ParsedScannerAlertSection[] = [];
  let current: ParsedScannerAlertSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const header = scannerHeaderForLine(trimmed);
    if (header) {
      current = { title: trimmed, rows: [], lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const rowMatch = trimmed.match(/^([^:]{2,28})\s*:\s*(.+)$/);
    if (rowMatch) {
      current.rows.push({
        label: rowMatch[1].trim(),
        value: rowMatch[2].trim(),
      });
    } else {
      current.lines.push(trimmed);
    }
  }

  return sections;
};

const scannerAlertSection = (sections: ParsedScannerAlertSection[], title: string) =>
  sections.find((section) => section.title.toUpperCase().startsWith(title.toUpperCase()));

const scannerAlertValue = (
  sections: ParsedScannerAlertSection[],
  sectionTitle: string,
  label: string
) =>
  scannerAlertSection(sections, sectionTitle)?.rows.find(
    (row) => row.label.toLowerCase() === label.toLowerCase()
  )?.value || null;

const formatComponentLabel = (value: string) =>
  value
    .replace(/^selected_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const scannerPositionMatchBadgeClass: Record<ScannerPositionMatchTone, string> = {
  neutral: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  negative: "border-rose-500/35 bg-rose-500/10 text-rose-200",
};

const scannerPositionMatchTextClass: Record<ScannerPositionMatchTone, string> = {
  neutral: "text-sky-300",
  positive: "text-emerald-300",
  warning: "text-amber-300",
  negative: "text-rose-300",
};

const ScannerHitDetail = ({ opportunity }: { opportunity: ScannerRankedOpportunity }) => {
  const contract = opportunity.selected_contract;
  const positionMatch = presentScannerPositionMatch(opportunity.position_match);
  const sections = parseScannerAlertSections(opportunity.message);
  const directionSection = scannerAlertSection(sections, "DIRECTION");
  const macdSection = scannerAlertSection(sections, "MACD 1W");
  const horizonsSection = scannerAlertSection(sections, "HORIZONS");
  const exampleSection = scannerAlertSection(sections, "EXAMPLE TRADE");
  const components = Object.entries(opportunity.components || {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .sort((a, b) => b[1] - a[1]);
  const dataSource = scannerAlertValue(sections, "MISPRICING", "Data Src") || contract.price_source || "—";
  const reviewWindowLabel =
    scannerAlertValue(sections, "EXAMPLE TRADE", "Review Window") ||
    (opportunity.review_window?.min_hold_days && opportunity.review_window?.max_hold_days
      ? `${opportunity.review_window.min_hold_days}-${opportunity.review_window.max_hold_days} trading days`
      : null);
  const ivHvEdr =
    scannerAlertValue(sections, "MISPRICING", "IV/HV/EDR") ||
    `${formatPercent(opportunity.iv30, 1)} / ${formatPercent(opportunity.hv30, 1)} / ${formatPercent(opportunity.avg_edr, 1)}`;

  const detailRow = (label: string, value: string | number | null | undefined, className = "text-stealth-100") => (
    <div className="flex items-start justify-between gap-3 text-[10px]">
      <span className="shrink-0 uppercase tracking-wide text-stealth-500">{label}</span>
      <span className={`min-w-0 max-w-[72%] break-words text-right tabular-nums ${className}`}>{value ?? "—"}</span>
    </div>
  );

  const sectionBlock = (title: string, rows: Array<{ label: string; value: string }>, lines: string[] = []) => {
    if (rows.length === 0 && lines.length === 0) return null;
    return (
      <div className="min-w-0 border-t border-stealth-800/70 pt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stealth-500">{title}</div>
        <div className="space-y-1">
          {rows.map((row) => detailRow(row.label, row.value))}
          {lines.map((line, index) => (
            <div key={`${title}-${index}`} className="break-words text-[10px] leading-snug text-stealth-300">
              {line}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-x-hidden bg-stealth-950/40 px-3 py-3 sm:px-4">
      {positionMatch ? (
        <div
          role="note"
          aria-label={positionMatch.accessibleLabel}
          className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-stealth-800/70 pb-2 text-[10px]"
        >
          <span
            aria-hidden="true"
            className={`rounded border px-1.5 py-0.5 font-semibold tracking-wide ${scannerPositionMatchBadgeClass[positionMatch.tone]}`}
          >
            {positionMatch.badgeLabel}
          </span>
          <span aria-hidden="true" className={scannerPositionMatchTextClass[positionMatch.tone]}>
            {positionMatch.evidenceLine}
          </span>
          <span aria-hidden="true" className="ml-auto text-stealth-500">
            Evidence only · no add signal
          </span>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr]">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Mispricing</div>
          {detailRow("Consensus", scannerAlertValue(sections, "MISPRICING", "Consensus") || "Cheap", "text-emerald-200")}
          {detailRow("IV pct", formatPercent(opportunity.iv_percentile, 1))}
          {detailRow("IV/HV/EDR", ivHvEdr)}
          {detailRow("Data", dataSource)}
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Rank Drivers</div>
          {detailRow("Grade", compactOpportunityGrade(opportunity.score, opportunity.grade), opportunityScoreClass(opportunity.score).split(" ").filter((part) => part.startsWith("text-")).join(" ") || "text-stealth-100")}
          {detailRow("Score", opportunity.score.toFixed(1))}
          {opportunity.reasons.length > 0 ? (
            <div className="text-[10px] leading-snug text-stealth-300">{opportunity.reasons.slice(0, 3).join(" / ")}</div>
          ) : null}
          {components.length > 0 ? (
            <div className="space-y-1.5">
              {components.slice(0, 5).map(([key, value]) => (
                <div key={key}>
                  <div className="mb-0.5 flex items-center justify-between gap-2 text-[9px] uppercase tracking-wide text-stealth-500">
                    <span className="truncate">{formatComponentLabel(key)}</span>
                    <span className="tabular-nums">{value.toFixed(0)}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-stealth-900">
                    <div className="h-full rounded-full bg-sky-300/70" style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Contract</div>
          {detailRow(
            "Selected",
            contract.option_type && contract.strike !== null && contract.strike !== undefined
              ? `${contract.option_type.toUpperCase()} ${formatNumber(contract.strike, 2)}${contract.expiry ? ` / ${formatDate(contract.expiry)}` : ""}`
              : "contract pending"
          )}
          {detailRow("Bid / Ask", `${formatCurrency(contract.bid)} / ${formatCurrency(contract.ask)}`)}
          {detailRow("Premium", formatCurrency(contract.premium))}
          {detailRow("Spread", formatPercent(contract.spread_pct, 1))}
          {detailRow(
            "OI / Vol / IV",
            `${contract.open_interest ?? "—"} / ${contract.volume ?? "—"} / ${
              contract.implied_volatility !== null && contract.implied_volatility !== undefined
                ? formatPercent(contract.implied_volatility * 100, 1)
                : "—"
            }`
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {sectionBlock("Direction", directionSection?.rows || [], directionSection?.lines || [])}
        {sectionBlock("Momentum", macdSection?.rows || [], macdSection?.lines || [])}
        {sectionBlock("Horizons", horizonsSection?.rows || [], horizonsSection?.lines || [])}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <div className="border-t border-stealth-800/70 pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Training Trade</div>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {detailRow("Hump exit", scannerAlertValue(sections, "EXAMPLE TRADE", "Hump Exit") || formatPercent(contract.convexity_profit_pct, 0))}
            {detailRow("Hump prob", scannerAlertValue(sections, "EXAMPLE TRADE", "Hump Prob") || (contract.convexity_probability_itm !== null && contract.convexity_probability_itm !== undefined ? formatPercent(contract.convexity_probability_itm * 100, 0) : "—"))}
            {detailRow("Base target", scannerAlertValue(sections, "EXAMPLE TRADE", "Base Tgt") || formatPercent(contract.target_profit_pct, 0))}
            {detailRow("Risk cut", scannerAlertValue(sections, "EXAMPLE TRADE", "Risk Cut") || (contract.planned_loss_pct !== null && contract.planned_loss_pct !== undefined ? `-${formatPercent(contract.planned_loss_pct, 0)}` : "—"))}
            {detailRow("Reward/risk", scannerAlertValue(sections, "EXAMPLE TRADE", "Reward/Risk") || (contract.reward_risk !== null && contract.reward_risk !== undefined ? `${contract.reward_risk.toFixed(2)}R` : "—"))}
            {detailRow("Window", reviewWindowLabel)}
            {detailRow("Gate", scannerAlertValue(sections, "EXAMPLE TRADE", "Hold") || (contract.dte !== null && contract.dte !== undefined ? `${contract.dte} DTE` : "—"))}
          </div>
        </div>

        {exampleSection && exampleSection.rows.length > 0 ? (
          <div className="border-t border-stealth-800/70 pt-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Quote Context</div>
            <div className="space-y-1">
              {["Setup", "Quote", "OI/Vol/IV", "Est Prem", "Est G/L", "Stop/Tgt"].map((label) => {
                const value = scannerAlertValue(sections, "EXAMPLE TRADE", label);
                return value ? detailRow(label, value) : null;
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const formatRelativeTime = (value: string | Date | null | undefined) => {
  if (!value) return "n/a";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  const diffMs = Math.max(0, Date.now() - parsed.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const formatHoldDateWindow = (
  position: OptionPosition,
  evaluation: EvaluationInsight | null | undefined,
  lane: TimelineLane | null | undefined
) => {
  const minHoldDays = evaluation?.minHoldDays ?? lane?.minHoldDays ?? position.evaluation_min_hold_days ?? null;
  const maxHoldDays = evaluation?.holdDays ?? lane?.maxHoldDays ?? position.evaluation_hold_days ?? null;
  if (!minHoldDays || !maxHoldDays) return null;

  const anchorDate =
    toDate(position.evaluation_start_date) ||
    toDate(position.source_triggered_at) ||
    toDate(position.trade_date);
  const maxDate = toDate(position.evaluation_due_date) || (anchorDate ? addDays(anchorDate, maxHoldDays) : null);
  const minDate = anchorDate ? addDays(anchorDate, minHoldDays) : null;

  if (minDate && maxDate) {
    return {
      range: `${formatDate(minDate)} - ${formatDate(maxDate)}`,
      detail: `${minHoldDays}-${maxHoldDays}d hold window`,
    };
  }

  return {
    range: `${minHoldDays}-${maxHoldDays} trading days`,
    detail: "Hold window",
  };
};

const buildEvaluationInsight = (
  holdDaysRaw: number,
  anchorDate: Date,
  now: Date,
  minHoldDaysRaw?: number | null
): EvaluationInsight | null => {
  const holdDays = Number.isFinite(holdDaysRaw) ? Math.max(1, Math.round(holdDaysRaw)) : 0;
  if (holdDays <= 0) return null;
  const minHoldDays = Number.isFinite(minHoldDaysRaw ?? NaN)
    ? Math.max(1, Math.min(holdDays, Math.round(minHoldDaysRaw as number)))
    : Math.max(1, Math.min(holdDays, Math.round(holdDays * 0.4)));

  const elapsedDays = Math.max(0, Math.floor((now.getTime() - anchorDate.getTime()) / DAY_MS));
  const daysRemaining = holdDays - elapsedDays;
  const windowStartRemainingDays = minHoldDays - elapsedDays;
  const progressPct = Math.max(0, Math.min(100, (elapsedDays / holdDays) * 100));

  if (daysRemaining < 0) {
    return {
      minHoldDays,
      holdDays,
      elapsedDays,
      daysRemaining,
      windowStartRemainingDays,
      progressPct,
      urgency: "overdue",
      label: `${Math.abs(daysRemaining)}d past eval`,
      detail: `Review window ${minHoldDays}-${holdDays}d from trigger`,
      pillClass: "border-rose-500/50 bg-rose-500/10 text-rose-200",
      barClass: "bg-rose-400",
    };
  }

  if (daysRemaining === 0) {
    return {
      minHoldDays,
      holdDays,
      elapsedDays,
      daysRemaining,
      windowStartRemainingDays,
      progressPct,
      urgency: "due",
      label: "Evaluate today",
      detail: `Reached ${minHoldDays}-${holdDays}d review window`,
      pillClass: "border-amber-500/50 bg-amber-500/10 text-amber-200",
      barClass: "bg-amber-300",
    };
  }

  if (windowStartRemainingDays > 0) {
    return {
      minHoldDays,
      holdDays,
      elapsedDays,
      daysRemaining,
      windowStartRemainingDays,
      progressPct,
      urgency: "calm",
      label: `${windowStartRemainingDays}d to window`,
      detail: `Opportunity window opens at ${minHoldDays}d; gate ${holdDays}d`,
      pillClass: "border-sky-500/40 bg-sky-500/10 text-sky-200",
      barClass: "bg-sky-300",
    };
  }

  if (daysRemaining <= 5) {
    return {
      minHoldDays,
      holdDays,
      elapsedDays,
      daysRemaining,
      windowStartRemainingDays,
      progressPct,
      urgency: "watch",
      label: `${daysRemaining}d to eval`,
      detail: `Inside ${minHoldDays}-${holdDays}d opportunity window`,
      pillClass: "border-yellow-500/45 bg-yellow-500/10 text-yellow-200",
      barClass: "bg-yellow-300",
    };
  }

  return {
    minHoldDays,
    holdDays,
    elapsedDays,
    daysRemaining,
    windowStartRemainingDays,
    progressPct,
    urgency: "calm",
    label: `Evaluate in ${daysRemaining}d`,
    detail: `Inside ${minHoldDays}-${holdDays}d opportunity window`,
    pillClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    barClass: "bg-emerald-300",
  };
};

const deriveUrgencyFromDays = (daysRemaining: number): EvalUrgency => {
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining === 0) return "due";
  if (daysRemaining <= 5) return "watch";
  return "calm";
};

const clampRange = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buildGreeksAttention = (
  greeks: PositionMetrics["greeks"],
  remainingDays: number
): { strength: number; spreadDays: number; hint: string } => {
  const absTheta = Math.abs(greeks?.theta ?? 0);
  const absGamma = Math.abs(greeks?.gamma ?? 0);
  const thetaNorm = clampRange(absTheta / 8, 0, 1);
  const gammaNorm = clampRange(absGamma / 0.06, 0, 1);
  const timePressure = remainingDays <= 0 ? 1 : remainingDays <= 5 ? 0.9 : remainingDays <= 15 ? 0.65 : 0.4;

  let strength = 0.45 * thetaNorm + 0.35 * gammaNorm + 0.2 * timePressure;
  if (remainingDays > 21) {
    strength *= 0.8;
  }
  strength = clampRange(strength, 0.2, 1);

  const spreadDays = clampRange(4 + Math.max(0, remainingDays) / 3, 4, 18);

  const hint =
    strength >= 0.8
      ? "High attention"
      : strength >= 0.55
        ? "Watch closely"
        : "Monitor";

  return { strength, spreadDays, hint };
};

const getStatusTextClass = (
  urgency: EvalUrgency,
  remainingDays: number | null,
  isMonitor: boolean
) => {
  if (urgency === "overdue") return "text-rose-200";
  if (urgency === "due") return "text-amber-200";
  if (urgency === "watch") return "text-lime-200";
  if (isMonitor) return "text-gray-400";
  if (remainingDays !== null && remainingDays <= 10) return "text-lime-200";
  if (remainingDays !== null && remainingDays <= 21) return "text-emerald-200";
  return "text-emerald-300";
};

const buildPositionDiagnosis = (
  position: OptionPosition,
  metrics: PositionMetrics,
  lane: TimelineLane | null | undefined
) => {
  const symbol = position.symbol.toUpperCase();
  const pnlPct = metrics.pnl?.percent ?? null;
  const dte = metrics.dte ?? lane?.remainingDays ?? null;
  const spreadPct = metrics.quote?.spread_pct ?? null;
  const theta = metrics.greeks?.theta ?? null;
  const volatilityRead = buildVolatilityRead(metrics.volatility_signal);
  const volatilityState = metrics.volatility_signal.trend.value_state;
  const pnlText = pnlPct !== null && pnlPct !== undefined ? `${formatSigned(pnlPct, 1)}% P/L` : "P/L unavailable";
  const dteText = dte !== null && dte !== undefined ? `${dte} DTE` : "DTE unavailable";

  if (lane?.urgency === "overdue") {
    return `${symbol} is ${Math.abs(lane.remainingDays)} days past its modeled evaluation window. Reassess exit, roll, or thesis continuation against ${volatilityRead.label}.`;
  }
  if (lane?.urgency === "due") {
    return `${symbol} is in its evaluation window today. Review the thesis against ${pnlText}, ${dteText}, and ${volatilityRead.label}.`;
  }
  if (lane?.urgency === "watch") {
    return `${symbol} is approaching its model review gate. Prepare an exit, roll, or hold decision before the window closes.`;
  }
  if (volatilityState === "contracting") {
    return `${symbol} remains monitor status, but volatility is contracting. Confirm the thesis can still outrun time decay.`;
  }
  if (volatilityState === "expanding") {
    return `${symbol} remains monitor status with volatility expansion supporting option value. Track whether the move is still thesis-driven.`;
  }
  if (theta !== null && theta <= -8) {
    return `${symbol} is still in monitor status, but theta decay is elevated. Track time risk before the next gate.`;
  }
  if (spreadPct !== null && spreadPct >= 20) {
    return `${symbol} is monitor status with a wide bid/ask spread. Use caution before sizing or exiting.`;
  }
  return `${symbol} remains monitor status. No immediate model action; keep an eye on ${pnlText}, ${dteText}, and IV/HV.`;
};

const PositionTimelineCell = memo(function PositionTimelineCell({
  position,
  metrics,
  lane,
  decisionHistory,
  suggestedWindow,
  isInteractive = false,
}: {
  position: OptionPosition;
  metrics: PositionMetrics;
  lane: TimelineLane | undefined;
  decisionHistory?: PositionDecisionWindowRevision[];
  suggestedWindow?: SuggestedDecisionWindow | null;
  isInteractive?: boolean;
}) {
  const remainingDays = lane?.remainingDays ?? metrics.dte ?? null;
  const sourceConfidence = clampRange(position.source_match_confidence ?? (lane?.matched ? 0.65 : 0.15), 0, 1);
  const urgency = lane?.urgency ?? deriveUrgencyFromDays(remainingDays ?? 999);
  const isLowConfidence = sourceConfidence < 0.6 || !lane?.matched;
  const dteLabel = metrics.dte !== null && metrics.dte !== undefined ? `${metrics.dte} DTE` : "DTE n/a";
  const metaLabel = `${formatDate(position.expiration)} / ${dteLabel}`;
  const timelineStart = toDate(position.trade_date) ?? toDate(position.source_triggered_at) ?? new Date();
  const timelineEnd = toDate(position.expiration) ?? addDays(timelineStart, Math.max(1, lane?.totalDays ?? 1));
  const today = toDate(todayInputValue()) ?? new Date();
  const timelineDuration = Math.max(DAY_MS, timelineEnd.getTime() - timelineStart.getTime());
  const pointPct = (point: Date | null) =>
    point ? clampRange(((point.getTime() - timelineStart.getTime()) / timelineDuration) * 100, 0, 100) : null;
  const todayPct = pointPct(today) ?? 0;
  const latestReview = decisionHistory?.[0] ?? null;
  const latestReviewDate = toDate(latestReview?.review_date);
  const latestCheckpoint = toDate(latestReview?.next_review_date);
  const latestDeadline = toDate(latestReview?.decision_deadline);
  const latestWindowCurrent = Boolean(
    latestReview &&
      latestDeadline &&
      latestDeadline.getTime() >= today.getTime() &&
      (!latestCheckpoint || latestCheckpoint.getTime() > today.getTime())
  );
  const useSuggestedWindow = Boolean(suggestedWindow && (!latestReview || suggestedWindow.rebased || !latestWindowCurrent));

  const legacyMinDays = Math.max(1, lane?.minHoldDays ?? position.evaluation_min_hold_days ?? 1);
  const legacyMaxDays = Math.max(legacyMinDays, lane?.maxHoldDays ?? position.evaluation_hold_days ?? legacyMinDays);
  let activeStart: Date =
    (position.evaluation_source === "decision_review" ? toDate(position.evaluation_start_date) : null) ?? timelineStart;
  let activeCheckpoint: Date | null =
    (position.evaluation_source === "decision_review" ? toDate(position.evaluation_due_date) : null) ??
    addDays(timelineStart, legacyMinDays);
  let activeDeadline: Date =
    toDate(position.evaluation_decision_deadline) ??
    (position.evaluation_source === "decision_review" ? toDate(position.evaluation_due_date) : null) ??
    addDays(timelineStart, legacyMaxDays);
  let activeKind: "modeled" | "confirmed" | "suggested" = "modeled";
  let activeTitle = `Entry model: review after ${legacyMinDays}d; maximum hold ${legacyMaxDays}d`;

  if (position.evaluation_source === "decision_review") {
    activeKind = "confirmed";
    activeTitle = `Confirmed decision window: ${formatDate(activeCheckpoint)} review; ${formatDate(activeDeadline)} maximum hold`;
  }

  if (latestReview && latestWindowCurrent && !useSuggestedWindow) {
    activeStart = latestReviewDate ?? timelineStart;
    activeCheckpoint = latestCheckpoint;
    activeDeadline = latestDeadline ?? activeDeadline;
    activeKind = "confirmed";
    activeTitle = `Confirmed review #${latestReview.review_sequence}: ${formatDate(latestReview.next_review_date)} review; ${formatDate(latestReview.decision_deadline)} maximum hold`;
  } else if (suggestedWindow) {
    activeStart = toDate(suggestedWindow.as_of_date) ?? today;
    activeCheckpoint = toDate(suggestedWindow.next_review_date);
    activeDeadline = toDate(suggestedWindow.decision_deadline) ?? today;
    activeKind = "suggested";
    activeTitle = `Suggested from the ${suggestedWindow.original_min_hold_days}-${suggestedWindow.original_max_hold_days} session entry model: ${suggestedWindow.max_hold_sessions} session maximum hold`;
  }

  const activeStartPct = pointPct(activeStart) ?? 0;
  const activeDeadlinePct = pointPct(activeDeadline) ?? activeStartPct;
  const activeWidthPct = Math.max(1.5, activeDeadlinePct - activeStartPct);
  const checkpointPct = pointPct(activeCheckpoint);
  const activeOverdue = activeDeadline.getTime() < today.getTime();
  const activeWindowClass = activeOverdue
    ? "bg-rose-400/30 ring-1 ring-inset ring-rose-200/35"
    : activeKind === "suggested"
      ? "bg-sky-400/30 ring-1 ring-inset ring-sky-200/35"
      : "bg-emerald-300/30 ring-1 ring-inset ring-emerald-100/30";
  const bracketClass = activeOverdue
    ? "border-rose-300/85"
    : activeKind === "suggested"
      ? "border-sky-200/85"
      : "border-emerald-200/80";
  const priorWindows = (decisionHistory ?? [])
    .filter((review) => activeKind !== "confirmed" || review.id !== latestReview?.id)
    .map((review) => ({
      id: review.id,
      sequence: review.review_sequence,
      start: toDate(review.review_date),
      checkpoint: toDate(review.next_review_date),
      deadline: toDate(review.decision_deadline),
    }))
    .filter((window) => window.start && window.deadline);
  const daysToCheckpoint = activeCheckpoint
    ? Math.ceil((activeCheckpoint.getTime() - today.getTime()) / DAY_MS)
    : null;
  const daysToDeadline = Math.ceil((activeDeadline.getTime() - today.getTime()) / DAY_MS);
  const statusLabel = activeOverdue
    ? `${Math.abs(daysToDeadline)}d past decision`
    : daysToCheckpoint === 0
      ? "Review today"
      : daysToCheckpoint !== null && daysToCheckpoint > 0
        ? `Review in ${daysToCheckpoint}d`
        : activeKind === "suggested"
          ? "Decision due today"
          : isLowConfidence && urgency === "calm"
            ? "monitor"
            : lane?.label ?? "monitor";
  const urgencyTextClass = getStatusTextClass(activeOverdue ? "overdue" : urgency, remainingDays, statusLabel === "monitor");
  const accessibleSummary = `${position.symbol}. ${activeKind} decision window from ${formatDate(activeStart)} to ${formatDate(activeDeadline)}. ${activeCheckpoint ? `Next review ${formatDate(activeCheckpoint)}.` : "No additional review before the decision deadline."} Today is marked by a capped vertical marker. ${priorWindows.length} prior window${priorWindows.length === 1 ? "" : "s"} shown.`;

  return (
    <div className="min-w-0" aria-label={accessibleSummary}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
        <span className="truncate text-gray-500">{metaLabel}</span>
        <span className={`shrink-0 font-semibold ${urgencyTextClass}`}>{statusLabel}</span>
      </div>
      <div className={`relative h-6 overflow-visible rounded-md border border-gray-700 bg-gray-900/75 ${isLowConfidence ? "opacity-80" : ""}`}>
        <div className="absolute inset-y-1 left-0 rounded-sm bg-gray-700/35" style={{ width: `${todayPct}%` }} title="Elapsed contract life" />
        {priorWindows.map((window, index) => {
          const startPct = pointPct(window.start) ?? 0;
          const deadlinePct = pointPct(window.deadline) ?? startPct;
          const leftPct = Math.min(startPct, deadlinePct);
          const widthPct = Math.abs(deadlinePct - startPct);
          const isInverted = deadlinePct < startPct;
          const historyClass = isInverted
            ? "bg-rose-300/[0.07] ring-1 ring-inset ring-rose-300/25"
            : index === 0
              ? "bg-sky-200/[0.09] ring-1 ring-inset ring-sky-200/25"
              : index === 1
                ? "bg-sky-200/[0.06] ring-1 ring-inset ring-sky-200/18"
                : "bg-slate-200/[0.04] ring-1 ring-inset ring-slate-200/12";
          const historyInset = Math.min(2 + index, 7);
          return (
            <div
              key={window.id}
              className={`absolute z-10 rounded-[3px] ${historyClass}`}
              style={{
                left: `${leftPct}%`,
                width: `max(4px, ${widthPct}%)`,
                top: `${historyInset}px`,
                bottom: `${historyInset}px`,
              }}
              title={`Prior window #${window.sequence}: ${formatDate(window.start)} to ${formatDate(window.deadline)}${window.checkpoint ? `; review ${formatDate(window.checkpoint)}` : ""}`}
            />
          );
        })}
        <div
          className={`absolute inset-y-1 z-20 rounded-[3px] ${activeWindowClass}`}
          style={{ left: `${activeStartPct}%`, width: `${activeWidthPct}%` }}
          title={activeTitle}
        />
        <div
          className={`pointer-events-none absolute inset-y-0 z-30 transition-opacity duration-150 ${isInteractive ? "opacity-75" : "opacity-20"}`}
          style={{ left: `${activeStartPct}%`, width: `${activeWidthPct}%` }}
        >
          <span className={`absolute inset-y-0 left-0 w-2 rounded-l-[2px] border-y border-l-2 ${bracketClass}`} />
          <span className={`absolute inset-y-0 right-0 w-2 rounded-r-[2px] border-y border-r-2 ${bracketClass}`} />
        </div>
        {checkpointPct !== null ? (
          <span
            className={`absolute inset-y-1 z-40 w-px -translate-x-1/2 transition-colors duration-150 ${isInteractive ? "bg-amber-300/75" : "bg-amber-300/35"}`}
            style={{ left: `${checkpointPct}%` }}
            title={`Next review: ${formatDate(activeCheckpoint)}`}
          />
        ) : null}
        <span
          className={`absolute top-1/2 z-50 h-[26px] w-px -translate-x-1/2 -translate-y-1/2 transition-colors duration-150 before:absolute before:left-1/2 before:top-0 before:h-px before:w-1.5 before:-translate-x-1/2 after:absolute after:bottom-0 after:left-1/2 after:h-px after:w-1.5 after:-translate-x-1/2 ${isInteractive ? "bg-slate-100/70 before:bg-slate-100/70 after:bg-slate-100/70" : "bg-slate-200/35 before:bg-slate-200/35 after:bg-slate-200/35"}`}
          style={{ left: `${todayPct}%` }}
          title={`Today: ${formatDate(today)}`}
          aria-hidden="true"
        />
      </div>
    </div>
  );
});

function VolatilitySignalCard({
  metrics,
  className = "",
}: {
  metrics: PositionMetrics;
  className?: string;
}) {
  const signal = metrics.volatility_signal;
  const read = buildVolatilityRead(signal);
  const source = signal.current.data_source
    ? formatDataSource(signal.current.data_source, signal.current.quote_source)
    : metrics.volatility_source || "n/a";
  const entryContractHvSpread = getContractHvSpread(signal.entry);
  const currentContractHvSpread = getContractHvSpread(signal.current, metrics.hv30);
  const contractHvSpreadChange =
    entryContractHvSpread !== null && currentContractHvSpread !== null
      ? Number((currentContractHvSpread - entryContractHvSpread).toFixed(2))
      : null;

  const rows: {
    label: string;
    entry: number | null | undefined;
    current: number | null | undefined;
    change: number | null | undefined;
    kind: "percent" | "points";
  }[] = [
    {
      label: "Contract IV",
      entry: signal.entry?.contract_iv,
      current: signal.current.contract_iv,
      change: signal.trend.contract_iv_change,
      kind: "percent",
    },
    {
      label: "Held IV/HV",
      entry: entryContractHvSpread,
      current: currentContractHvSpread,
      change: contractHvSpreadChange,
      kind: "points",
    },
    {
      label: "Scan IV/HV",
      entry: signal.entry?.iv_hv_spread,
      current: signal.current.iv_hv_spread,
      change: signal.trend.iv_hv_spread_change,
      kind: "points",
    },
    {
      label: "HV30",
      entry: signal.entry?.hv30,
      current: signal.current.hv30 ?? metrics.hv30,
      change: signal.trend.hv30_change,
      kind: "percent",
    },
    {
      label: "IV pct",
      entry: signal.entry?.iv_percentile,
      current: signal.current.iv_percentile,
      change: signal.trend.iv_percentile_change,
      kind: "percent",
    },
    {
      label: "EDR",
      entry: signal.entry?.avg_edr,
      current: signal.current.avg_edr,
      change: signal.trend.avg_edr_change,
      kind: "percent",
    },
  ];

  const formatValue = (value: number | null | undefined, kind: "percent" | "points") =>
    kind === "points" ? formatPointChange(value, 1) : formatVolPct(value, 1);

  return (
    <div className={`rounded-md border border-gray-700/70 bg-gray-900/45 p-2 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[9px] uppercase tracking-wide text-gray-500">Volatility Signal</div>
        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${read.border} ${read.bg} ${read.text}`}>
          {read.label}
        </span>
      </div>
      <div className="space-y-1 text-[10px]">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[62px_minmax(0,1fr)_54px] items-center gap-1">
            <span className="truncate text-gray-500">{row.label}</span>
            <span className="truncate text-gray-200">
              {row.entry !== null && row.entry !== undefined
                ? row.current !== null && row.current !== undefined
                  ? `${formatValue(row.entry, row.kind)} -> ${formatValue(row.current, row.kind)}`
                  : `entry ${formatValue(row.entry, row.kind)}`
                : row.current !== null && row.current !== undefined
                  ? `now ${formatValue(row.current, row.kind)}`
                  : "n/a"}
            </span>
            <span
              className={`text-right tabular-nums ${
                (row.change ?? 0) > 0
                  ? "text-emerald-300"
                  : (row.change ?? 0) < 0
                    ? "text-rose-300"
                    : "text-gray-500"
              }`}
            >
              {formatPointChange(row.change, 1)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-gray-800 pt-1 text-[9px] text-gray-500">
        <span className="truncate">{signal.entry ? "entry scanner -> current chain" : "current only"}</span>
        <span className="truncate">{source}</span>
      </div>
    </div>
  );
}

function TimelinePressureStack({
  position,
  metrics,
  lane,
}: {
  position: OptionPosition;
  metrics: PositionMetrics;
  lane: TimelineLane | undefined;
}) {
  const dteAtEntry = position.dte_at_entry ?? null;
  const dteNow = metrics.dte ?? null;
  const elapsedToTodayDays =
    dteAtEntry !== null && dteNow !== null
      ? Math.max(0, dteAtEntry - dteNow)
      : Math.max(0, lane?.elapsedDays ?? 0);
  const expirationTotalDays = Math.max(1, dteAtEntry ?? elapsedToTodayDays + Math.max(0, dteNow ?? 0), lane?.totalDays ?? 1);
  const timePct = clampRange((elapsedToTodayDays / expirationTotalDays) * 100, 0, 100);
  const volState = metrics.volatility_signal.trend.value_state;
  const volPressure =
    volState === "contracting" ? 0.85 : volState === "expanding" ? 0.65 : volState === "stable" ? 0.35 : 0.2;
  const pressurePct = clampRange(Math.max(lane?.attentionStrength ?? 0.2, volPressure) * 100, 0, 100);
  const sourceConfidence = clampRange(position.source_match_confidence ?? (lane?.matched ? 0.65 : 0.15), 0, 1);

  return (
    <div className="mt-2 grid grid-cols-[14px_minmax(0,1fr)] items-center gap-x-1 gap-y-1 text-[9px] text-gray-500">
      <span>T</span>
      <div className="h-1.5 rounded-full bg-gray-800" title="Time elapsed toward expiration">
        <div className="h-full rounded-full bg-emerald-300" style={{ width: `${timePct}%` }} />
      </div>
      <span>V</span>
      <div className="h-1.5 rounded-full bg-gray-800" title="Volatility/time pressure">
        <div className="h-full rounded-full bg-cyan-300" style={{ width: `${pressurePct}%` }} />
      </div>
      <span>C</span>
      <div className="h-1.5 rounded-full bg-gray-800" title="Source confidence">
        <div className="h-full rounded-full bg-indigo-300" style={{ width: `${sourceConfidence * 100}%` }} />
      </div>
    </div>
  );
}

function PositionActionButtons({
  position,
  mode,
  onEdit,
  onClose,
}: {
  position: OptionPosition;
  mode: "row" | "expanded";
  onEdit: (position: OptionPosition) => void;
  onClose: (positionId: number) => void;
}) {
  const buttonSize = mode === "row" ? "h-7 w-7" : "h-8 w-8";
  const iconSize = mode === "row" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(position);
        }}
        aria-label={`Edit ${position.symbol} position`}
        title={`Edit ${position.symbol}`}
        className={`inline-flex ${buttonSize} items-center justify-center rounded-md border border-sky-500/35 bg-sky-500/12 text-sky-200 transition hover:border-sky-300/70 hover:bg-sky-500/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-400/50`}
      >
        <Pencil className={iconSize} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose(position.id);
        }}
        aria-label={`Close ${position.symbol} position`}
        title={`Close ${position.symbol}`}
        className={`inline-flex ${buttonSize} items-center justify-center rounded-md border border-rose-500/35 bg-rose-500/12 text-rose-200 transition hover:border-rose-300/70 hover:bg-rose-500/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-400/50`}
      >
        <Trash2 className={iconSize} aria-hidden="true" />
      </button>
    </div>
  );
}

const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));
const countAxisRules = (axis: { debug?: { rules?: unknown[] } } | null | undefined): number => {
  const rules = axis?.debug?.rules;
  return Array.isArray(rules) ? rules.length : 0;
};

const computeSpotWeighting = (payload: Record<string, unknown> | null, symbol: string): SpotWeighting => {
  const summaryInput = buildSummaryInputFromSnapshot({
    symbol,
    technicalData: payload?.technical as TechnicalDataLike,
    fundamentals: payload?.fundamentals as FundamentalsLike | null,
    optionalityMetrics: payload?.optionality as OptionalityLike | null,
    asOf: (payload?.as_of_date || payload?.created_at || null) as string | null,
  });
  if (!summaryInput) {
    return EMPTY_SPOT_WEIGHTING;
  }

  const summary = buildHolisticSummary(summaryInput);
  const technicalAxis = summary.debug?.technical;
  const fundamentalAxis = summary.debug?.fundamental;
  if (!technicalAxis && !fundamentalAxis) {
    return EMPTY_SPOT_WEIGHTING;
  }

  const technical = technicalAxis ? clampUnit(technicalAxis.score / 100) : null;
  const fundamental = fundamentalAxis ? clampUnit(fundamentalAxis.score / 100) : null;
  const technicalUsed = technical ?? 0;
  const fundamentalUsed = fundamental ?? 0;
  const rawComposite = technicalUsed * 0.6 + fundamentalUsed * 0.4;
  const confidence =
    ((technicalAxis?.confidence ?? 0) * 0.6 + (fundamentalAxis?.confidence ?? 0) * 0.4) / 100;
  const normalizedConfidence = Math.max(0, Math.min(1, confidence));
  const composite = clampUnit(rawComposite * normalizedConfidence);
  const signalCount = countAxisRules(technicalAxis) + countAxisRules(fundamentalAxis);
  const direction = composite > 0.08 ? "right" : composite < -0.08 ? "left" : "neutral";

  return {
    technical,
    fundamental,
    composite,
    confidence: normalizedConfidence,
    signalCount,
    direction,
  };
};

const getProjectionColor = (strength: number) => {
  if (strength > 0.08) return "#22c55e";
  if (strength < -0.08) return "#f43f5e";
  return "#64748b";
};

const ProjectionBezierOverlay = ({
  selectedSpotPrice,
  chartPriceDomain,
  technicalStrength,
  fundamentalStrength,
}: {
  selectedSpotPrice: number | null;
  chartPriceDomain: { min: number; max: number } | null;
  technicalStrength: number | null | undefined;
  fundamentalStrength: number | null | undefined;
}) => {
  const plotArea = usePlotArea();
  if (!plotArea || selectedSpotPrice === null || !chartPriceDomain) return null;

  const left = Number(plotArea.x);
  const top = Number(plotArea.y);
  const width = Number(plotArea.width);
  const height = Number(plotArea.height);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const domainMin = Number(chartPriceDomain.min);
  const domainMax = Number(chartPriceDomain.max);
  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax <= domainMin) return null;

  const ratio = (selectedSpotPrice - domainMin) / (domainMax - domainMin);
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const right = left + width;
  const spotX = left + clampedRatio * width;
  const clampedSpotX = Math.max(left + 4, Math.min(right - 4, spotX));

  const makeHalfPath = (strength: number, half: "top" | "bottom") => {
    const s = clampUnit(strength);
    const dir = s >= 0 ? 1 : -1;
    const mag = Math.abs(s);
    const span = width * (0.14 + mag * 0.34);
    const endX = Math.max(left + 4, Math.min(right - 4, clampedSpotX + dir * span));
    const yJoin = top + height * 0.52;
    const yEdge = half === "top" ? top : top + height;
    const c1x = clampedSpotX + dir * (span * 0.14);
    const c2x = clampedSpotX + dir * (span * 0.72);
    const c1y = half === "top" ? yJoin - height * 0.18 : yJoin + height * 0.18;
    const c2y = half === "top" ? yEdge + height * 0.08 : yEdge - height * 0.08;
    const axisNudge = Math.max(4, Math.min(10, span * 0.1));
    const edgeInset = Math.max(8, Math.min(12, height * 0.06));
    return {
      path: `M ${clampedSpotX} ${yJoin}
        C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${yEdge}
        L ${clampedSpotX} ${yEdge}
        Z`,
      labelX: clampedSpotX + dir * axisNudge,
      labelY: half === "top" ? top + edgeInset : top + height - edgeInset,
    };
  };

  const tech = makeHalfPath(technicalStrength ?? 0, "top");
  const fund = makeHalfPath(fundamentalStrength ?? 0, "bottom");
  const techColor = getProjectionColor(technicalStrength ?? 0);
  const fundColor = getProjectionColor(fundamentalStrength ?? 0);

  return (
    <g pointerEvents="none">
      <path d={tech.path} fill={techColor} fillOpacity={0.14} />
      <path d={fund.path} fill={fundColor} fillOpacity={0.12} />
      <text x={tech.labelX} y={tech.labelY} fill={techColor} fontSize={9} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
        T
      </text>
      <text x={fund.labelX} y={fund.labelY} fill={fundColor} fontSize={9} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
        F
      </text>
    </g>
  );
};

const buildGreeksSummary = (
  greeks: PositionMetrics["greeks"] | GreeksPayload["current_greeks"] | null
) => {
  if (!greeks) return null;
  const delta = greeks.delta ?? 0;
  const gamma = greeks.gamma ?? 0;
  const theta = greeks.theta ?? 0;
  const vega = greeks.vega ?? 0;

  const deltaDirection =
    Math.abs(delta) < 0.1 ? "neutral" : delta > 0 ? "bullish" : "bearish";
  const thetaDirection = theta < 0 ? "decay" : "carry";
  const absDelta = Math.abs(delta);
  const absGamma = Math.abs(gamma);
  const absTheta = Math.abs(theta);
  const absVega = Math.abs(vega);

  const directionalLabel =
    absDelta >= 0.4 ? "moves a lot with the stock" : absDelta >= 0.15 ? "moves some with the stock" : "moves only a little with the stock";
  const convexityLabel =
    absGamma >= 0.05 ? "reacts quickly when the stock moves" : absGamma >= 0.02 ? "reacts more as the stock moves" : "reacts slowly to stock moves";
  const vegaLabel =
    absVega >= 10 ? "very sensitive to volatility" : absVega >= 5 ? "somewhat sensitive to volatility" : "not very sensitive to volatility";
  const thetaLabel =
    absTheta >= 10 ? "time matters a lot" : absTheta >= 4 ? "time matters" : "time matters less";

  return {
    tone: deltaDirection,
    thetaDirection,
    overall: `${capitalizeWord(deltaDirection)} setup with ${
      thetaDirection === "decay" ? "negative time carry" : "positive time carry"
    }.`,
    details: [
      {
        label: "Delta",
        value: formatSigned(delta, 3),
        note: `~${formatSigned(delta * 100, 1)} per $1 move per contract (${capitalizeWord(
          deltaDirection
        )})`,
      },
      {
        label: "Gamma",
        value: formatSigned(gamma, 4),
        note: `Delta changes by ~${formatSigned(gamma, 4)} for each $1 move`,
      },
      {
        label: "Theta",
        value: formatSigned(theta, 4),
        note: `~$${Math.abs(theta).toFixed(2)} per day per contract (${capitalizeWord(
          thetaDirection
        )})`,
      },
      {
        label: "Vega",
        value: formatSigned(vega, 4),
        note: `~$${Math.abs(vega).toFixed(2)} per +1 vol point (1%) per contract`,
      },
      {
        label: "Directional response",
        value: directionalLabel,
        note: convexityLabel,
      },
      {
        label: "Volatility + time",
        value: vegaLabel,
        note: thetaLabel,
      },
    ],
  };
};

const initialFormState = {
  trade_date: "",
  account: "",
  action: "Buy to Open",
  contracts: "",
  symbol: "",
  expiration: "",
  strike: "",
  option_type: "call",
  fill_price: "",
  total_cost: "",
  underlying_at_entry: "",
  estimated_delta: "",
  shares_equivalent: "",
  dte_at_entry: "",
  underlying_reference: "",
};

const initialClosedFormState = {
  trade_date: "",
  close_date: "",
  account: "",
  contracts: "",
  symbol: "",
  expiration: "",
  strike: "",
  option_type: "call",
  fill_price: "",
  exit_price: "",
  total_cost: "",
  underlying_at_entry: "",
  underlying_at_exit: "",
  notes: "",
};

const initialDecisionReviewFormState = {
  selected_assessment_id: "",
  review_date: "",
  trade_role: "unclassified",
  original_thesis: "",
  contract_thesis: "",
  expected_path: "",
  catalyst: "",
  confirmation_condition: "",
  invalidation_condition: "",
  risk_budget: "",
  evidence_since_last: "",
  thesis_status: "unassessed",
  fresh_entry_answer: "unassessed",
  portfolio_fit: "",
  data_quality_notes: "",
  verdict: "manual_review",
  target_contracts: "",
  quality: "unrated",
  urgency: "medium",
  confidence: "low",
  continuation_condition: "",
  next_review_date: "",
  decision_deadline: "",
  decision_notes: "",
  override_reason: "",
  threshold_approval_status: "draft",
};

type DecisionReviewMode = "override" | "window";

const decisionLabel = (value: string | null | undefined) =>
  (value || "unassessed")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());

const todayInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const tomorrowInputValue = () => {
  const tomorrow = addDays(new Date(), 1);
  return new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

type PositionFormPayload = {
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
};

type ClosedPositionFormPayload = {
  trade_date: string;
  close_date: string;
  account: string | null;
  contracts: number;
  symbol: string;
  expiration: string;
  strike: number;
  option_type: string;
  fill_price: number;
  exit_price: number;
  total_cost: number;
  underlying_at_entry: number | null;
  underlying_at_exit: number | null;
  notes: string | null;
};

const asNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizedNullableText = (value: string | null | undefined) => (value || "").trim().toUpperCase();
const duplicateNumber = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "" : Number(value).toFixed(4);

const openPositionSignature = (
  item: PositionFormPayload | OptionPosition
) =>
  [
    item.trade_date,
    normalizedNullableText(item.account),
    normalizedNullableText(item.action),
    item.contracts,
    item.symbol.trim().toUpperCase(),
    item.expiration,
    duplicateNumber(item.strike),
    item.option_type.trim().toLowerCase(),
    duplicateNumber(item.fill_price),
    duplicateNumber(item.total_cost),
  ].join("|");

const closedPositionSignature = (
  item: ClosedPositionFormPayload | ClosedPositionRow
) =>
  [
    item.trade_date,
    item.close_date,
    normalizedNullableText(item.account),
    item.contracts,
    item.symbol.trim().toUpperCase(),
    item.expiration,
    duplicateNumber(item.strike),
    item.option_type.trim().toLowerCase(),
    duplicateNumber(item.fill_price),
    duplicateNumber(item.exit_price),
    duplicateNumber(item.total_cost),
  ].join("|");

const normalizeOpportunity = (value: PositionMetrics["opportunity"] | undefined): PositionOpportunity | null => {
  if (!value) return null;
  return {
    event_id: value.event_id ?? null,
    model_version: value.model_version ?? null,
    computed_for_date: value.computed_for_date ?? null,
    cadence: value.cadence ?? null,
    basis: value.basis ?? null,
    entry: value.entry
      ? {
          score: value.entry.score ?? null,
          rank_score: value.entry.rank_score ?? null,
          grade: value.entry.grade ?? null,
          components: value.entry.components ?? null,
          triggered_at: value.entry.triggered_at ?? null,
        }
      : null,
    current: value.current
      ? {
          score: value.current.score ?? null,
          rank_score: value.current.rank_score ?? null,
          grade: value.current.grade ?? null,
          components: value.current.components ?? null,
          reasons: value.current.reasons ?? [],
        }
      : null,
    score_change: value.score_change ?? null,
    headline: value.headline ?? null,
    error: value.error ?? null,
  };
};

const normalizePositionMetrics = (
  metrics: RawPositionPayload["metrics"]
): PositionMetrics => {
  const safeGreeks =
    metrics?.greeks &&
    metrics.greeks.delta !== undefined &&
    metrics.greeks.gamma !== undefined &&
    metrics.greeks.theta !== undefined &&
    metrics.greeks.vega !== undefined
      ? {
          delta: metrics.greeks.delta,
          gamma: metrics.greeks.gamma,
          theta: metrics.greeks.theta,
          vega: metrics.greeks.vega,
        }
      : null;

  return {
    market: {
      current_price: metrics?.market?.current_price ?? null,
      previous_close: metrics?.market?.previous_close ?? null,
      change: metrics?.market?.change ?? null,
      change_percent: metrics?.market?.change_percent ?? null,
      implied_volatility: metrics?.market?.implied_volatility ?? null,
      last_updated: metrics?.market?.last_updated ?? "",
      data_source: metrics?.market?.data_source ?? null,
      quote_source: metrics?.market?.quote_source ?? null,
    },
    option_price: metrics?.option_price ?? null,
    option_price_source: metrics?.option_price_source ?? null,
    quote: {
      ...{
        bid: null,
        ask: null,
        last: null,
        mid: null,
        spread: null,
        spread_pct: null,
        volume: null,
        open_interest: null,
        implied_volatility: null,
        last_trade_at: null,
        data_source: null,
        quote_source: null,
        quality: null,
      },
      ...(metrics?.quote ?? {}),
    },
    volatility: metrics?.volatility ?? null,
    volatility_source: metrics?.volatility_source ?? null,
    hv30: metrics?.hv30 ?? null,
    volatility_signal: normalizeVolatilitySignal(metrics?.volatility_signal),
    opportunity: normalizeOpportunity(metrics?.opportunity),
    dte: metrics?.dte ?? null,
    greeks: safeGreeks,
    pnl: {
      dollar: metrics?.pnl?.dollar ?? null,
      percent: metrics?.pnl?.percent ?? null,
      source: metrics?.pnl?.source ?? null,
    },
  };
};

export default function SecretOptions() {
  const [positions, setPositions] = useState<PositionPayload[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedPositionId, setExpandedPositionId] = useState<number | null>(null);
  const [greeksData, setGreeksData] = useState<GreeksPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGreeks, setLoadingGreeks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [closingSubmitting, setClosingSubmitting] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPositionId, setEditingPositionId] = useState<number | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingPositionId, setClosingPositionId] = useState<number | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closedPositions, setClosedPositions] = useState<ClosedPositionRow[]>([]);
  const [showClosedLog, setShowClosedLog] = useState(false);
  const [showClosedEditModal, setShowClosedEditModal] = useState(false);
  const [editingClosedPositionId, setEditingClosedPositionId] = useState<number | null>(null);
  const [closedFormData, setClosedFormData] = useState(initialClosedFormState);
  const [closedFormError, setClosedFormError] = useState<string | null>(null);
  const [closedSubmitting, setClosedSubmitting] = useState(false);
  const [showTrainingOutcomes, setShowTrainingOutcomes] = useState(false);
  const [trainingOutcomes, setTrainingOutcomes] = useState<TrainingOutcomeRow[]>([]);
  const [trainingSummary, setTrainingSummary] = useState<TrainingOutcomeSummary | null>(null);
  const [opportunityBacktest, setOpportunityBacktest] = useState<OpportunityBacktestResponse | null>(null);
  const [loadingTrainingOutcomes, setLoadingTrainingOutcomes] = useState(false);
  const [optionalityClusters, setOptionalityClusters] = useState<OptionalityCluster[]>([]);
  const [scannerData, setScannerData] = useState<ScannerSummaryResponse | null>(null);
  const [scannerUniverse, setScannerUniverse] = useState("SP500");
  const [scannerThreshold, setScannerThreshold] = useState("30");
  const [scannerRunning, setScannerRunning] = useState(false);
  const [scannerStopping, setScannerStopping] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerNotice, setScannerNotice] = useState<string | null>(null);
  const [selectedScannerRunId, setSelectedScannerRunId] = useState<number | null>(null);
  const [scannerRunDetail, setScannerRunDetail] = useState<ScannerRunDetailResponse | null>(null);
  const selectedScannerRunIdRef = useRef<number | null>(null);
  const scannerRunDetailRef = useRef<ScannerRunDetailResponse | null>(null);
  const [expandedScannerHitId, setExpandedScannerHitId] = useState<number | null>(null);
  const [loadingScannerRunDetail, setLoadingScannerRunDetail] = useState(false);
  const [showRowActions, setShowRowActions] = useState(false);
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");
  const [positionsLoadedAt, setPositionsLoadedAt] = useState<Date | null>(null);
  const [positionsRefreshing, setPositionsRefreshing] = useState(false);
  const positionsRefreshTimerRef = useRef<number | null>(null);
  const [listRefreshInFlight, setListRefreshInFlight] = useState(false);
  const [listRefreshSettled, setListRefreshSettled] = useState(false);
  const listRefreshStatusTimerRef = useRef<number | null>(null);
  const wasListRefreshPendingRef = useRef(false);
  const [greeksLoadedAt, setGreeksLoadedAt] = useState<Date | null>(null);
  const [greeksPositionId, setGreeksPositionId] = useState<number | null>(null);
  const greeksRequestRef = useRef(0);
  const [positionSort, setPositionSort] = useState<{ key: PositionSortKey; direction: SortDirection }>({
    key: "symbol",
    direction: "asc",
  });
  const [closedSort, setClosedSort] = useState<{ key: ClosedSortKey; direction: SortDirection }>({
    key: "close_date",
    direction: "desc",
  });
  const [zoneInputsByPosition, setZoneInputsByPosition] = useState<Record<number, ZoneInputs>>({});
  const [spotWeightBySymbol, setSpotWeightBySymbol] = useState<Record<string, SpotWeighting>>({});
  const [decisionReviewsByPosition, setDecisionReviewsByPosition] = useState<Record<number, PositionDecisionReviewResponse>>({});
  const [decisionWindowsByPosition, setDecisionWindowsByPosition] = useState<Record<string, PositionDecisionWindowRevision[]>>({});
  const [hoveredPositionId, setHoveredPositionId] = useState<number | null>(null);
  const decisionReviewRequestsRef = useRef(new Set<number>());
  const [loadingDecisionReview, setLoadingDecisionReview] = useState(false);
  const [thesisAssessmentsByPosition, setThesisAssessmentsByPosition] = useState<Record<number, PositionThesisAssessmentResponse>>({});
  const [loadingThesisAssessment, setLoadingThesisAssessment] = useState(false);
  const [thesisAssessmentError, setThesisAssessmentError] = useState<string | null>(null);
  const [learningSummary, setLearningSummary] = useState<OptionLearningSummary | null>(null);
  const [portfolioCapitalInput, setPortfolioCapitalInput] = useState("");
  const [riskPolicySaving, setRiskPolicySaving] = useState(false);
  const [showDecisionReviewModal, setShowDecisionReviewModal] = useState(false);
  const [decisionReviewMode, setDecisionReviewMode] = useState<DecisionReviewMode>("override");
  const [decisionReviewForm, setDecisionReviewForm] = useState(initialDecisionReviewFormState);
  const [decisionReviewError, setDecisionReviewError] = useState<string | null>(null);
  const [decisionReviewSubmitting, setDecisionReviewSubmitting] = useState(false);
  const [confirmingDecisionReview, setConfirmingDecisionReview] = useState(false);
  const [showRiskEvidence, setShowRiskEvidence] = useState(false);
  // The API refreshes the position snapshot as one batch, but the UI renders
  // that shared lifecycle on each affected row so status stays attached to the
  // data it describes instead of looking like a page-wide warning.
  const listRefreshPending = listRefreshInFlight || positionsRefreshing;

  const anyModalOpen =
    showAddModal ||
    showCloseModal ||
    showDecisionReviewModal ||
    showClosedLog ||
    showClosedEditModal ||
    showTrainingOutcomes ||
    expandedScannerHitId !== null;
  const renderModal = (node: JSX.Element) => {
    if (typeof document === "undefined") {
      return null;
    }
    return createPortal(node, document.body);
  };

  useEffect(() => {
    if (!anyModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [anyModalOpen]);

  useEffect(() => {
    if (listRefreshStatusTimerRef.current !== null) {
      window.clearTimeout(listRefreshStatusTimerRef.current);
      listRefreshStatusTimerRef.current = null;
    }
    if (listRefreshPending) {
      wasListRefreshPendingRef.current = true;
      setListRefreshSettled(false);
      return;
    }
    if (!wasListRefreshPendingRef.current) return;
    wasListRefreshPendingRef.current = false;
    setListRefreshSettled(true);
    listRefreshStatusTimerRef.current = window.setTimeout(() => {
      setListRefreshSettled(false);
      listRefreshStatusTimerRef.current = null;
    }, 2400);
    return () => {
      if (listRefreshStatusTimerRef.current !== null) {
        window.clearTimeout(listRefreshStatusTimerRef.current);
        listRefreshStatusTimerRef.current = null;
      }
    };
  }, [listRefreshPending]);

  const loadPositions = async (options: { quiet?: boolean; refreshAttempt?: number; force?: boolean } = {}) => {
    const quiet = options.quiet ?? false;
    const refreshAttempt = options.refreshAttempt ?? 0;
    const force = options.force ?? false;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await apiFetch<PositionListResponse>(
        `/secret/options/positions${force ? "?refresh=true" : ""}`
      );
      const normalizedPositions: PositionPayload[] = (data.positions || []).map((item) => ({
        position: item.position,
        metrics: normalizePositionMetrics(item.metrics),
      }));
      setPositions(normalizedPositions);
      setPositionsLoadedAt(new Date());
      if (normalizedPositions.length > 0 && selectedId === null) {
        setSelectedId(normalizedPositions[0].position.id);
        setExpandedPositionId(normalizedPositions[0].position.id);
      }
      const cacheRefreshing = data.metrics_cache?.refresh_in_progress === true;
      setPositionsRefreshing(cacheRefreshing);
      if (positionsRefreshTimerRef.current !== null) {
        window.clearTimeout(positionsRefreshTimerRef.current);
        positionsRefreshTimerRef.current = null;
      }
      if (data.metrics_cache?.status === "stale" && cacheRefreshing && refreshAttempt < 10) {
        positionsRefreshTimerRef.current = window.setTimeout(() => {
          void loadPositions({ quiet: true, refreshAttempt: refreshAttempt + 1 });
        }, 2000);
      }
    } catch (err: unknown) {
      if (!quiet) {
        setError(err instanceof Error ? err.message : "Failed to load positions");
      }
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  };

  const loadGreeks = async (positionId: number) => {
    const requestId = ++greeksRequestRef.current;
    setLoadingGreeks(true);
    try {
      const data = await apiFetch<GreeksPayload>(`/secret/options/greeks/${positionId}`);
      if (greeksRequestRef.current !== requestId) return;
      setGreeksData(data);
      setGreeksPositionId(positionId);
      setGreeksLoadedAt(new Date());
    } catch {
      if (greeksRequestRef.current !== requestId) return;
      setGreeksData(null);
      setGreeksPositionId(null);
      setGreeksLoadedAt(null);
    } finally {
      if (greeksRequestRef.current === requestId) {
        setLoadingGreeks(false);
      }
    }
  };

  const loadDecisionReviews = async (positionId: number) => {
    if (decisionReviewRequestsRef.current.has(positionId)) return;
    decisionReviewRequestsRef.current.add(positionId);
    setLoadingDecisionReview(true);
    try {
      const data = await apiFetch<PositionDecisionReviewResponse>(
        `/secret/options/positions/${positionId}/decision-reviews`
      );
      setDecisionReviewsByPosition((prev) => ({ ...prev, [positionId]: data }));
    } catch (err: unknown) {
      console.error("Failed to load decision reviews:", err);
    } finally {
      decisionReviewRequestsRef.current.delete(positionId);
      setLoadingDecisionReview(false);
    }
  };

  const loadDecisionReviewWindows = async () => {
    try {
      const data = await apiFetch<PositionDecisionWindowResponse>("/secret/options/decision-review-windows");
      setDecisionWindowsByPosition(data.windows_by_position ?? {});
    } catch (err: unknown) {
      console.error("Failed to load decision review windows:", err);
    }
  };

  const refreshPositionList = async () => {
    if (listRefreshPending) return;
    setListRefreshInFlight(true);
    try {
      await Promise.all([
        loadPositions({ quiet: true, force: true }),
        loadDecisionReviewWindows(),
      ]);
    } finally {
      setListRefreshInFlight(false);
    }
  };

  const loadThesisAssessment = async (positionId: number, force = false) => {
    setLoadingThesisAssessment(true);
    setThesisAssessmentError(null);
    try {
      const data = await apiFetch<PositionThesisAssessmentResponse>(
        `/secret/options/positions/${positionId}/thesis-assessment${force ? "?force=true" : ""}`,
        force ? { method: "POST" } : undefined
      );
      setThesisAssessmentsByPosition((prev) => ({ ...prev, [positionId]: data }));
      setPortfolioCapitalInput((current) => current || String(data.risk_policy.portfolio_capital ?? ""));
      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to grade the position.";
      setThesisAssessmentError(message);
      console.error("Failed to load thesis assessment:", err);
      return null;
    } finally {
      setLoadingThesisAssessment(false);
    }
  };

  const loadLearningSummary = async () => {
    try {
      const data = await apiFetch<OptionLearningSummary>("/secret/options/learning-summary");
      setLearningSummary(data);
    } catch (err: unknown) {
      console.error("Failed to load option learning summary:", err);
    }
  };

  const approveRiskPolicy = async () => {
    if (!selectedThesisAssessment) return;
    const capital = Number(portfolioCapitalInput);
    if (!Number.isFinite(capital) || capital <= 0) {
      setThesisAssessmentError("Enter portfolio capital greater than zero before approving sizing guardrails.");
      return;
    }
    const policy = selectedThesisAssessment.risk_policy;
    setRiskPolicySaving(true);
    setThesisAssessmentError(null);
    try {
      await apiFetch("/secret/options/risk-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "User-approved tracked options guardrails",
          active: true,
          approval_status: "approved",
          portfolio_capital: capital,
          default_trade_risk_budget: policy.default_trade_risk_budget,
          max_single_position_premium_pct: policy.max_single_position_premium_pct ?? 30,
          max_directional_premium_pct: policy.max_directional_premium_pct ?? 75,
          max_expiry_bucket_premium_pct: policy.max_expiry_bucket_premium_pct ?? 45,
          max_option_spread_pct: policy.max_option_spread_pct ?? 25,
          min_dte_for_add: policy.min_dte_for_add ?? 21,
        }),
      });
      await loadThesisAssessment(selectedThesisAssessment.position_id, true);
    } catch (err: unknown) {
      setThesisAssessmentError(err instanceof Error ? err.message : "Failed to save the risk policy.");
    } finally {
      setRiskPolicySaving(false);
    }
  };

  const loadOptionalityClusters = async () => {
    try {
      const data = await apiFetch<OptionalityClusterResponse>(
        "/secret/options/optionality-clusters?lookback_days=45&bucket_days=7&min_hits=1"
      );
      setOptionalityClusters(data.clusters || []);
    } catch {
      setOptionalityClusters([]);
    }
  };

  const setSelectedScannerRunIdStable = (runId: number | null) => {
    selectedScannerRunIdRef.current = runId;
    setSelectedScannerRunId(runId);
  };

  const setScannerRunDetailStable = (detail: ScannerRunDetailResponse | null) => {
    scannerRunDetailRef.current = detail;
    setScannerRunDetail(detail);
  };

  const loadScannerRunDetail = async (runId: number | null, options?: { quiet?: boolean }) => {
    if (!runId) {
      setScannerRunDetailStable(null);
      return;
    }
    if (!options?.quiet) {
      setLoadingScannerRunDetail(true);
    }
    try {
      const data = await apiFetch<ScannerRunDetailResponse>(`/secret/options/scanner-run/${runId}`);
      setScannerRunDetailStable(data);
    } catch (err: unknown) {
      console.error("Failed to load scanner run detail:", err);
      if (!options?.quiet) {
        setScannerRunDetailStable(null);
      }
    } finally {
      if (!options?.quiet) {
        setLoadingScannerRunDetail(false);
      }
    }
  };

  const loadScannerSummary = async () => {
    try {
      const data = await apiFetch<ScannerSummaryResponse>(
        "/secret/options/scanner-summary?lookback_days=45&run_limit=8"
      );
      setScannerData(data);
      if (data.supported_universes.length > 0 && !data.supported_universes.some((item) => item.key === scannerUniverse)) {
        setScannerUniverse(data.supported_universes[0].key);
      }
      const currentSelectedRunId = selectedScannerRunIdRef.current;
      const selectedStillExists = data.runs.find((run) => run.id === currentSelectedRunId) || null;
      const preferredRun =
        selectedStillExists
        || data.runs[0]
        || null;
      const preferredRunId = preferredRun?.id ?? null;
      setSelectedScannerRunIdStable(preferredRunId);
      await loadScannerRunDetail(preferredRunId, {
        quiet: scannerRunDetailRef.current?.run.id === preferredRunId,
      });
    } catch (err: unknown) {
      console.error("Failed to load scanner summary:", err);
    }
  };

  const resetForm = () => {
    setFormData(initialFormState);
  };

  const closeTradeModal = () => {
    setShowAddModal(false);
    setEditingPositionId(null);
    resetForm();
    setFormError(null);
  };

  const optionalNumber = (value: string) => {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const buildPositionPayloadFromForm = (): PositionFormPayload | null => {
    if (!formData.trade_date || !formData.symbol || !formData.expiration) {
      setFormError("Trade date, symbol, and expiration are required.");
      return null;
    }

    const contracts = Number(formData.contracts);
    const strike = Number(formData.strike);
    const fillPrice = Number(formData.fill_price);
    const totalCost = Number(formData.total_cost);

    if (!contracts || !strike || !fillPrice || !totalCost) {
      setFormError("Contracts, strike, fill price, and total cost are required.");
      return null;
    }

    return {
      trade_date: formData.trade_date,
      account: formData.account || null,
      action: formData.action || null,
      contracts,
      symbol: formData.symbol.toUpperCase(),
      expiration: formData.expiration,
      strike,
      option_type: formData.option_type,
      fill_price: fillPrice,
      total_cost: totalCost,
      underlying_at_entry: optionalNumber(formData.underlying_at_entry),
      estimated_delta: optionalNumber(formData.estimated_delta),
      shares_equivalent: optionalNumber(formData.shares_equivalent),
      dte_at_entry: optionalNumber(formData.dte_at_entry),
      underlying_reference: optionalNumber(formData.underlying_reference),
    };
  };

  const buildClosedPositionPayloadFromForm = (): ClosedPositionFormPayload | null => {
    if (!closedFormData.trade_date || !closedFormData.close_date || !closedFormData.symbol || !closedFormData.expiration) {
      setClosedFormError("Trade date, close date, symbol, and expiration are required.");
      return null;
    }

    const contracts = Number(closedFormData.contracts);
    const strike = Number(closedFormData.strike);
    const fillPrice = Number(closedFormData.fill_price);
    const exitPriceValue = Number(closedFormData.exit_price);
    const totalCost = Number(closedFormData.total_cost);

    if (!contracts || !strike || !fillPrice || !totalCost || !Number.isFinite(exitPriceValue)) {
      setClosedFormError("Contracts, strike, entry, exit, and total cost are required.");
      return null;
    }

    return {
      trade_date: closedFormData.trade_date,
      close_date: closedFormData.close_date,
      account: closedFormData.account || null,
      contracts,
      symbol: closedFormData.symbol.toUpperCase(),
      expiration: closedFormData.expiration,
      strike,
      option_type: closedFormData.option_type,
      fill_price: fillPrice,
      exit_price: exitPriceValue,
      total_cost: totalCost,
      underlying_at_entry: optionalNumber(closedFormData.underlying_at_entry),
      underlying_at_exit: optionalNumber(closedFormData.underlying_at_exit),
      notes: closedFormData.notes || null,
    };
  };

  const openEditModal = (position: OptionPosition) => {
    setEditingPositionId(position.id);
    setFormError(null);
    setFormData({
      trade_date: position.trade_date || "",
      account: position.account || "",
      action: position.action || "Buy to Open",
      contracts: String(position.contracts ?? ""),
      symbol: position.symbol || "",
      expiration: position.expiration || "",
      strike: position.strike !== null && position.strike !== undefined ? String(position.strike) : "",
      option_type: position.option_type || "call",
      fill_price: position.fill_price !== null && position.fill_price !== undefined ? String(position.fill_price) : "",
      total_cost: position.total_cost !== null && position.total_cost !== undefined ? String(position.total_cost) : "",
      underlying_at_entry:
        position.underlying_at_entry !== null && position.underlying_at_entry !== undefined
          ? String(position.underlying_at_entry)
          : "",
      estimated_delta:
        position.estimated_delta !== null && position.estimated_delta !== undefined
          ? String(position.estimated_delta)
          : "",
      shares_equivalent:
        position.shares_equivalent !== null && position.shares_equivalent !== undefined
          ? String(position.shares_equivalent)
          : "",
      dte_at_entry:
        position.dte_at_entry !== null && position.dte_at_entry !== undefined
          ? String(position.dte_at_entry)
          : "",
      underlying_reference:
        position.underlying_reference !== null && position.underlying_reference !== undefined
          ? String(position.underlying_reference)
          : "",
    });
    setShowAddModal(true);
  };

  const handleFieldChange =
    (field: keyof typeof initialFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFormData((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleClosedFieldChange =
    (field: keyof typeof initialClosedFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setClosedFormData((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleDecisionReviewFieldChange =
    (field: keyof typeof initialDecisionReviewFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setDecisionReviewForm((prev) => {
        if (field === "verdict" && ["close", "replacement_candidate"].includes(value)) {
          return {
            ...prev,
            verdict: value,
            next_review_date: "",
            decision_deadline: prev.review_date || todayInputValue(),
          };
        }
        return { ...prev, [field]: value };
      });
    };

  const openDecisionReviewModal = async (
    position: OptionPosition,
    mode: DecisionReviewMode = "override"
  ) => {
    const latest = decisionReviewsByPosition[position.id]?.latest_review ?? null;
    const assessmentResponse =
      thesisAssessmentsByPosition[position.id] ?? (await loadThesisAssessment(position.id));
    const suggestedWindow = assessmentResponse?.suggested_window ?? null;
    const defaults = assessmentResponse?.review_defaults ?? {};
    const defaultText = (key: string, fallback: string | number | null | undefined = "") => {
      const value = defaults[key];
      return String(value === null || value === undefined ? fallback ?? "" : value);
    };
    const nextForm = {
      ...initialDecisionReviewFormState,
      selected_assessment_id: defaultText("selected_assessment_id", assessmentResponse?.assessment.id),
      review_date: defaultText("review_date", todayInputValue()),
      trade_role: defaultText("trade_role", latest?.trade_role ?? "unclassified"),
      original_thesis: defaultText("original_thesis", latest?.original_thesis),
      contract_thesis: defaultText("contract_thesis", latest?.contract_thesis),
      expected_path: defaultText("expected_path", latest?.expected_path),
      catalyst: defaultText("catalyst", latest?.catalyst),
      confirmation_condition: defaultText("confirmation_condition", latest?.confirmation_condition),
      invalidation_condition: defaultText("invalidation_condition", latest?.invalidation_condition),
      risk_budget: defaultText("risk_budget", latest?.risk_budget ?? position.total_cost),
      evidence_since_last: defaultText("evidence_since_last", latest?.evidence_since_last),
      thesis_status: defaultText("thesis_status", latest?.thesis_status ?? "unassessed"),
      fresh_entry_answer: defaultText("fresh_entry_answer", latest?.fresh_entry_answer ?? "unassessed"),
      portfolio_fit: defaultText("portfolio_fit", latest?.portfolio_fit),
      data_quality_notes: defaultText("data_quality_notes", latest?.data_quality_notes),
      verdict: defaultText("verdict", latest?.verdict ?? "manual_review"),
      target_contracts: defaultText("target_contracts", latest?.target_contracts ?? position.contracts),
      quality: defaultText("quality", latest?.quality ?? "unrated"),
      urgency: defaultText("urgency", latest?.urgency ?? "medium"),
      confidence: defaultText("confidence", latest?.confidence ?? "low"),
      continuation_condition: defaultText("continuation_condition", latest?.continuation_condition),
      next_review_date: defaultText("next_review_date", latest?.next_review_date),
      decision_deadline: defaultText("decision_deadline", latest?.decision_deadline),
      decision_notes: defaultText("decision_notes", latest?.decision_notes),
      threshold_approval_status: defaultText(
        "threshold_approval_status",
        latest?.threshold_approval_status ?? assessmentResponse?.mandate.threshold_approval_status ?? "draft"
      ),
    };

    if (mode === "window" && latest) {
      Object.assign(nextForm, {
        trade_role: latest.trade_role,
        original_thesis: latest.original_thesis ?? "",
        contract_thesis: latest.contract_thesis ?? "",
        expected_path: latest.expected_path ?? "",
        catalyst: latest.catalyst ?? "",
        confirmation_condition: latest.confirmation_condition ?? "",
        invalidation_condition: latest.invalidation_condition ?? "",
        risk_budget: latest.risk_budget === null ? "" : String(latest.risk_budget),
        evidence_since_last: "",
        thesis_status: latest.thesis_status,
        fresh_entry_answer: latest.fresh_entry_answer,
        portfolio_fit: latest.portfolio_fit ?? "",
        data_quality_notes: latest.data_quality_notes ?? "",
        verdict: latest.verdict,
        target_contracts: String(latest.target_contracts),
        quality: latest.quality,
        urgency: latest.urgency,
        confidence: latest.confidence,
        continuation_condition: suggestedWindow?.continuation_condition ?? latest.continuation_condition ?? "",
        next_review_date: suggestedWindow?.next_review_date ?? defaultText("next_review_date", latest.next_review_date),
        decision_deadline: suggestedWindow?.decision_deadline ?? defaultText("decision_deadline", latest.decision_deadline),
        decision_notes: "",
        threshold_approval_status: latest.threshold_approval_status ?? "draft",
      });
    }

    setDecisionReviewError(null);
    setDecisionReviewMode(mode);
    setDecisionReviewForm(nextForm);
    setShowDecisionReviewModal(true);
  };

  const applySuggestedDecisionWindow = () => {
    const suggestion = selectedThesisAssessment?.suggested_window;
    if (!suggestion) return;
    setDecisionReviewForm((current) => ({
      ...current,
      next_review_date: suggestion.next_review_date ?? "",
      decision_deadline: suggestion.decision_deadline ?? "",
      continuation_condition: suggestion.continuation_condition,
      decision_notes: "Applied the latest system-suggested review window; no order was created.",
    }));
  };

  const confirmAutomaticAssessment = async () => {
    if (!selected) return;
    setConfirmingDecisionReview(true);
    setThesisAssessmentError(null);
    try {
      const assessmentResponse =
        thesisAssessmentsByPosition[selected.position.id]
        ?? (await loadThesisAssessment(selected.position.id));
      if (!assessmentResponse?.assessment) {
        throw new Error("The automatic assessment is not ready yet.");
      }
      await apiFetch(`/secret/options/positions/${selected.position.id}/decision-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review_date: todayInputValue(),
          selected_assessment_id: assessmentResponse.assessment.id,
          threshold_approval_status: assessmentResponse.mandate.threshold_approval_status ?? "draft",
        }),
      });
      const positionId = selected.position.id;
      await loadDecisionReviews(positionId);
      void loadPositions();
    } catch (err: unknown) {
      setThesisAssessmentError(err instanceof Error ? err.message : "Failed to confirm the automatic grade.");
    } finally {
      setConfirmingDecisionReview(false);
    }
  };

  const closeDecisionReviewModal = () => {
    setShowDecisionReviewModal(false);
    setDecisionReviewError(null);
    setDecisionReviewMode("override");
    setDecisionReviewForm(initialDecisionReviewFormState);
  };

  const handleCreateDecisionReview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) {
      setDecisionReviewError("No position is selected.");
      return;
    }
    const targetContracts = Number(decisionReviewForm.target_contracts);
    const riskBudget = decisionReviewForm.risk_budget ? Number(decisionReviewForm.risk_budget) : null;
    if (!Number.isInteger(targetContracts) || targetContracts < 0) {
      setDecisionReviewError("Target contracts must be a whole number at or above zero.");
      return;
    }
    if (riskBudget !== null && (!Number.isFinite(riskBudget) || riskBudget <= 0)) {
      setDecisionReviewError("Risk budget must be greater than zero.");
      return;
    }
    const terminalDecision = ["close", "replacement_candidate"].includes(decisionReviewForm.verdict);
    const schedulingAnchor = decisionReviewForm.review_date > todayInputValue()
      ? decisionReviewForm.review_date
      : todayInputValue();
    if (!terminalDecision && !decisionReviewForm.next_review_date) {
      setDecisionReviewError("Choose a future next review date for an open-position decision.");
      return;
    }
    if (!terminalDecision && !decisionReviewForm.decision_deadline) {
      setDecisionReviewError("Choose a decision deadline for the maximum recommended hold.");
      return;
    }
    if (decisionReviewForm.next_review_date && decisionReviewForm.next_review_date <= schedulingAnchor) {
      setDecisionReviewError("The next review must be after today and the review date.");
      return;
    }
    if (!terminalDecision && decisionReviewForm.decision_deadline <= schedulingAnchor) {
      setDecisionReviewError("The decision deadline must be after today and the review date.");
      return;
    }
    if (
      terminalDecision &&
      decisionReviewForm.decision_deadline &&
      decisionReviewForm.decision_deadline !== decisionReviewForm.review_date
    ) {
      setDecisionReviewError("A close or replacement decision has zero recommended hold, so its deadline must match the review date.");
      return;
    }
    if (
      decisionReviewForm.next_review_date &&
      decisionReviewForm.decision_deadline &&
      decisionReviewForm.next_review_date > decisionReviewForm.decision_deadline
    ) {
      setDecisionReviewError("The next review cannot be after the decision deadline.");
      return;
    }
    if (!terminalDecision && decisionReviewForm.decision_deadline && decisionReviewForm.decision_deadline > selected.position.expiration) {
      setDecisionReviewError("The decision deadline cannot be after the contract expires.");
      return;
    }
    setDecisionReviewSubmitting(true);
    setDecisionReviewError(null);
    try {
      await apiFetch(`/secret/options/positions/${selected.position.id}/decision-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...decisionReviewForm,
          selected_assessment_id: decisionReviewForm.selected_assessment_id
            ? Number(decisionReviewForm.selected_assessment_id)
            : null,
          risk_budget: riskBudget,
          target_contracts: targetContracts,
          original_thesis: decisionReviewForm.original_thesis || null,
          contract_thesis: decisionReviewForm.contract_thesis || null,
          expected_path: decisionReviewForm.expected_path || null,
          catalyst: decisionReviewForm.catalyst || null,
          confirmation_condition: decisionReviewForm.confirmation_condition || null,
          invalidation_condition: decisionReviewForm.invalidation_condition || null,
          evidence_since_last: decisionReviewForm.evidence_since_last || null,
          portfolio_fit: decisionReviewForm.portfolio_fit || null,
          data_quality_notes: decisionReviewForm.data_quality_notes || null,
          continuation_condition: decisionReviewForm.continuation_condition || null,
          next_review_date: decisionReviewForm.next_review_date || null,
          decision_deadline: decisionReviewForm.decision_deadline || null,
          decision_notes: decisionReviewForm.decision_notes || null,
          override_reason: decisionReviewForm.override_reason || null,
        }),
      });
      const positionId = selected.position.id;
      closeDecisionReviewModal();
      await Promise.all([loadDecisionReviews(positionId), loadThesisAssessment(positionId)]);
      void loadPositions();
    } catch (err: unknown) {
      setDecisionReviewError(err instanceof Error ? err.message : "Failed to record decision review.");
    } finally {
      setDecisionReviewSubmitting(false);
    }
  };

  const handleCreatePosition = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const payload = buildPositionPayloadFromForm();
    if (!payload) return;
    const duplicate = positions.find((item) => openPositionSignature(item.position) === openPositionSignature(payload));
    if (duplicate) {
      setFormError(`This open trade already exists as trade #${duplicate.position.id}.`);
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/secret/options/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeTradeModal();
      await loadPositions();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to add position.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePosition = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingPositionId) {
      setFormError("No position selected for edit.");
      return;
    }

    setFormError(null);
    const payload = buildPositionPayloadFromForm();
    if (!payload) return;
    const duplicate = positions.find(
      (item) =>
        item.position.id !== editingPositionId &&
        openPositionSignature(item.position) === openPositionSignature(payload)
    );
    if (duplicate) {
      setFormError(`This open trade would duplicate trade #${duplicate.position.id}.`);
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/secret/options/positions/${editingPositionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeTradeModal();
      await loadPositions();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to update position.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadClosedPositions = async () => {
    try {
      const data = await apiFetch<{ closed_positions: ClosedPositionRow[] }>(
        "/secret/options/closed-positions?limit=500"
      );
      setClosedPositions(data.closed_positions || []);
    } catch (err: unknown) {
      console.error("Failed to load closed positions:", err);
    }
  };

  const loadTrainingOutcomes = async () => {
    setLoadingTrainingOutcomes(true);
    try {
      const data = await apiFetch<TrainingOutcomeResponse>(
        "/secret/options/training-outcomes?lookback_days=1825&limit=1000&include_green_marker=true"
      );
      const backtest = await apiFetch<OpportunityBacktestResponse>(
        "/secret/options/opportunity-backtest?lookback_days=1825&threshold=50&limit=1000"
      );
      setTrainingOutcomes(data.outcomes || []);
      setTrainingSummary(data.summary || null);
      setOpportunityBacktest(backtest || null);
    } catch (err: unknown) {
      console.error("Failed to load training outcomes:", err);
      setTrainingOutcomes([]);
      setTrainingSummary(null);
      setOpportunityBacktest(null);
    } finally {
      setLoadingTrainingOutcomes(false);
    }
  };

  const handleRunScanner = async () => {
    if (scannerRunning) return;
    const threshold = Number(scannerThreshold);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 100) {
      setScannerError("Threshold must be between 1 and 99.");
      return;
    }
    setScannerRunning(true);
    setScannerError(null);
    setScannerNotice(null);
    try {
      const data = await apiFetch<ScannerRunResponse>("/secret/options/scanner-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe_key: scannerUniverse,
          threshold,
        }),
      });
      setScannerNotice(`${data.run.universe_label} sweep queued as #${data.run.id}. Discord will receive progress and hits.`);
      setSelectedScannerRunIdStable(data.run.id);
      setScannerRunDetailStable({ run: data.run, hit_count: 0, matched_event_count: 0, hits: [] });
      await loadScannerSummary();
      window.setTimeout(loadScannerSummary, 2500);
    } catch (err: unknown) {
      setScannerError(err instanceof Error ? err.message : "Failed to start scanner.");
    } finally {
      setScannerRunning(false);
    }
  };

  const handleStopScanner = async () => {
    if (!activeScannerRun || scannerStopping) return;
    setScannerStopping(true);
    setScannerError(null);
    setScannerNotice(null);
    try {
      const data = await apiFetch<{ stopped: boolean; message: string; run: ScannerRun }>(
        `/secret/options/scanner-run/${activeScannerRun.id}/stop`,
        { method: "POST" }
      );
      setScannerNotice(data.message || `Stop requested for ${activeScannerRun.universe_label} sweep #${activeScannerRun.id}.`);
      setSelectedScannerRunIdStable(data.run.id);
      if (scannerRunDetailRef.current?.run.id === data.run.id) {
        setScannerRunDetailStable({ ...scannerRunDetailRef.current, run: data.run });
      }
      await loadScannerSummary();
      window.setTimeout(loadScannerSummary, 2500);
    } catch (err: unknown) {
      setScannerError(err instanceof Error ? err.message : "Failed to stop scanner.");
    } finally {
      setScannerStopping(false);
    }
  };

  const handleSelectScannerRun = async (runId: number) => {
    setSelectedScannerRunIdStable(runId);
    await loadScannerRunDetail(runId);
  };

  const handleClosePosition = async () => {
    if (!closingPositionId || !exitPrice) {
      alert("Please enter an exit price");
      return;
    }
    if (closingSubmitting) {
      return;
    }

    setClosingSubmitting(true);
    try {
      await apiFetch(`/secret/options/positions/${closingPositionId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exit_price: Number(exitPrice),
          close_date: new Date().toISOString().split("T")[0],
          notes: closeNotes || null,
        }),
      });
      
      setShowCloseModal(false);
      setExitPrice("");
      setCloseNotes("");
      setClosingPositionId(null);
      await loadPositions();
      await loadClosedPositions();
    } catch (err: unknown) {
      alert(`Failed to close position: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClosingSubmitting(false);
    }
  };

  const openCloseModal = (positionId: number) => {
    setClosingPositionId(positionId);
    setShowCloseModal(true);
  };

  const closeClosedEditModal = () => {
    setShowClosedEditModal(false);
    setEditingClosedPositionId(null);
    setClosedFormData(initialClosedFormState);
    setClosedFormError(null);
  };

  const openClosedEditModal = (position: ClosedPositionRow) => {
    setEditingClosedPositionId(position.id);
    setClosedFormError(null);
    setClosedFormData({
      trade_date: position.trade_date || "",
      close_date: position.close_date || "",
      account: position.account || "",
      contracts: String(position.contracts ?? ""),
      symbol: position.symbol || "",
      expiration: position.expiration || "",
      strike: position.strike !== null && position.strike !== undefined ? String(position.strike) : "",
      option_type: position.option_type || "call",
      fill_price: position.fill_price !== null && position.fill_price !== undefined ? String(position.fill_price) : "",
      exit_price: position.exit_price !== null && position.exit_price !== undefined ? String(position.exit_price) : "",
      total_cost: position.total_cost !== null && position.total_cost !== undefined ? String(position.total_cost) : "",
      underlying_at_entry:
        position.underlying_at_entry !== null && position.underlying_at_entry !== undefined
          ? String(position.underlying_at_entry)
          : "",
      underlying_at_exit:
        position.underlying_at_exit !== null && position.underlying_at_exit !== undefined
          ? String(position.underlying_at_exit)
          : "",
      notes: position.notes || "",
    });
    setShowClosedEditModal(true);
  };

  const handleUpdateClosedPosition = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingClosedPositionId) {
      setClosedFormError("No closed position selected for edit.");
      return;
    }

    setClosedFormError(null);
    const payload = buildClosedPositionPayloadFromForm();
    if (!payload) return;
    const duplicate = closedPositions.find(
      (item) => item.id !== editingClosedPositionId && closedPositionSignature(item) === closedPositionSignature(payload)
    );
    if (duplicate) {
      setClosedFormError(`This closed trade would duplicate trade #${duplicate.id}.`);
      return;
    }

    setClosedSubmitting(true);
    try {
      await apiFetch(`/secret/options/closed-positions/${editingClosedPositionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeClosedEditModal();
      await loadClosedPositions();
    } catch (err: unknown) {
      setClosedFormError(err instanceof Error ? err.message : "Failed to update closed position.");
    } finally {
      setClosedSubmitting(false);
    }
  };

  const handleDeleteClosedPosition = async (position: ClosedPositionRow) => {
    const confirmed = window.confirm(
      `Delete closed trade #${position.id} for ${position.symbol} ${formatDate(position.close_date)}?`
    );
    if (!confirmed) return;

    try {
      await apiFetch(`/secret/options/closed-positions/${position.id}`, {
        method: "DELETE",
      });
      await loadClosedPositions();
    } catch (err: unknown) {
      alert(`Failed to delete closed position: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadPositions().finally(() => {
      if (cancelled) return;
      void loadDecisionReviewWindows();
      // Scanner history and clustering live below the fold. Let the critical
      // portfolio request finish before starting their queries, and load modal
      // data only when its corresponding control is opened.
      void loadOptionalityClusters();
      void loadScannerSummary();
    });
    return () => {
      cancelled = true;
      if (positionsRefreshTimerRef.current !== null) {
        window.clearTimeout(positionsRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!scannerData?.runs.some(isActiveScannerRun)) {
      return;
    }
    const timer = window.setInterval(loadScannerSummary, 15000);
    return () => window.clearInterval(timer);
  }, [scannerData?.summary.active_runs]);

  useEffect(() => {
    setExpandedScannerHitId(null);
  }, [selectedScannerRunId]);

  useEffect(() => {
    if (selectedId !== null) {
      loadDecisionReviews(selectedId);
      loadThesisAssessment(selectedId);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!showRiskEvidence || selectedId === null || greeksPositionId === selectedId) {
      return;
    }
    void loadGreeks(selectedId);
  }, [showRiskEvidence, selectedId, greeksPositionId]);

  const selected = useMemo(
    () => positions.find((item) => item.position.id === selectedId) || null,
    [positions, selectedId]
  );
  const selectedSymbol = selected?.position.symbol?.trim().toUpperCase() ?? null;
  const selectedStockAnalysisPath = selectedSymbol
    ? `/stock-analysis/${encodeURIComponent(selectedSymbol)}?symbol=${encodeURIComponent(selectedSymbol)}`
    : null;
  const positionGridColumns = showRowActions
    ? "md:grid-cols-[170px_minmax(280px,1fr)_150px_64px]"
    : "md:grid-cols-[170px_minmax(280px,1fr)_150px]";
  const positionTableWidth = showRowActions ? "md:min-w-[770px]" : "md:min-w-[700px]";
  // Mobile keeps the compact two-column scan pattern, but gives the timeline
  // most of the row. The wider identity track returns at sm and desktop.
  const positionMobileGrid = "grid-cols-[120px_minmax(0,1fr)] sm:grid-cols-[155px_minmax(0,1fr)]";

  const greekSummary = useMemo(() => {
    const greeks = greeksData?.current_greeks ?? selected?.metrics.greeks ?? null;
    return buildGreeksSummary(greeks);
  }, [greeksData, selected]);

  useEffect(() => {
    if (!showRiskEvidence || !selectedSymbol || spotWeightBySymbol[selectedSymbol]) {
      return;
    }
    let cancelled = false;
    apiFetch<Record<string, unknown>>(`/stocks/${selectedSymbol}/projections`)
      .then((payload) => {
        if (cancelled) return;
        setSpotWeightBySymbol((prev) => ({
          ...prev,
          [selectedSymbol]: computeSpotWeighting(payload, selectedSymbol),
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setSpotWeightBySymbol((prev) => ({
          ...prev,
          [selectedSymbol]: EMPTY_SPOT_WEIGHTING,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [showRiskEvidence, selectedSymbol, spotWeightBySymbol]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const id = selected.position.id;
    setZoneInputsByPosition((prev) => {
      if (prev[id]) {
        return prev;
      }
      const strike = selected.position.strike;
      const fill = selected.position.fill_price || 0;
      const spot = selected.metrics.market.current_price ?? strike;
      const defaultProfitTake = strike + fill;
      const defaultLossCut = Math.max(0, Math.min(strike, spot - fill));
      return {
        ...prev,
        [id]: {
          profitTake: defaultProfitTake.toFixed(2),
          lossCut: defaultLossCut.toFixed(2),
        },
      };
    });
  }, [selected]);

  useEffect(() => {
    setShowRiskEvidence(false);
  }, [selectedId]);

  const sortedPositions = useMemo(() => {
    const sorted = [...positions];
    sorted.sort((left, right) => {
      const direction = positionSort.direction === "asc" ? 1 : -1;
      const lv = (() => {
        switch (positionSort.key) {
          case "symbol":
            return left.position.symbol;
          case "strike":
            return left.position.strike;
          case "expiration":
            return left.position.expiration;
          case "option_type":
            return left.position.option_type;
          case "contracts":
            return left.position.contracts;
          case "fill_price":
            return left.position.fill_price;
          case "option_price":
            return left.metrics.option_price;
          case "underlying":
            return left.metrics.market.current_price;
          case "dte":
            return left.metrics.dte;
          case "pnl":
            return left.metrics?.pnl?.dollar ?? null;
          case "delta":
            return left.metrics.greeks?.delta ?? null;
          case "theta":
            return left.metrics.greeks?.theta ?? null;
          default:
            return null;
        }
      })();
      const rv = (() => {
        switch (positionSort.key) {
          case "symbol":
            return right.position.symbol;
          case "strike":
            return right.position.strike;
          case "expiration":
            return right.position.expiration;
          case "option_type":
            return right.position.option_type;
          case "contracts":
            return right.position.contracts;
          case "fill_price":
            return right.position.fill_price;
          case "option_price":
            return right.metrics.option_price;
          case "underlying":
            return right.metrics.market.current_price;
          case "dte":
            return right.metrics.dte;
          case "pnl":
            return right.metrics?.pnl?.dollar ?? null;
          case "delta":
            return right.metrics.greeks?.delta ?? null;
          case "theta":
            return right.metrics.greeks?.theta ?? null;
          default:
            return null;
        }
      })();

      if (lv === null || lv === undefined) return 1;
      if (rv === null || rv === undefined) return -1;
      if (typeof lv === "string" && typeof rv === "string") {
        return lv.localeCompare(rv) * direction;
      }
      return ((Number(lv) || 0) - (Number(rv) || 0)) * direction;
    });
    return sorted;
  }, [positions, positionSort]);

  const trainingOutcomeByEventId = useMemo(() => {
    const eventMap = new Map<number, TrainingOutcomeRow>();
    trainingOutcomes.forEach((row) => {
      if (!eventMap.has(row.event_id)) {
        eventMap.set(row.event_id, row);
      }
    });
    return eventMap;
  }, [trainingOutcomes]);

  const trainingOutcomeBySymbolType = useMemo(() => {
    const outcomeMap = new Map<string, TrainingOutcomeRow>();
    trainingOutcomes.forEach((row) => {
      const key = `${row.symbol.trim().toUpperCase()}|${row.option_type.trim().toLowerCase()}`;
      if (!outcomeMap.has(key)) {
        outcomeMap.set(key, row);
      }
    });
    return outcomeMap;
  }, [trainingOutcomes]);

  const evaluationByPositionId = useMemo(() => {
    const result: Record<number, EvaluationInsight> = {};
    const now = new Date();

    positions.forEach(({ position }) => {
      const eventId = position.source_event_id;
      const directMatch = eventId ? trainingOutcomeByEventId.get(eventId) : null;
      const usesDecisionReviewWindow = position.evaluation_source === "decision_review";
      const linkedHoldDays =
        typeof position.evaluation_hold_days === "number" &&
        Number.isFinite(position.evaluation_hold_days) &&
        position.evaluation_hold_days > 0
          ? position.evaluation_hold_days
          : null;
      const linkedMinHoldDays =
        typeof position.evaluation_min_hold_days === "number" &&
        Number.isFinite(position.evaluation_min_hold_days) &&
        position.evaluation_min_hold_days > 0
          ? position.evaluation_min_hold_days
          : null;
      const fallbackKey = `${position.symbol.trim().toUpperCase()}|${position.option_type.trim().toLowerCase()}`;
      const historicalMatch = trainingOutcomeBySymbolType.get(fallbackKey);
      const holdDays = usesDecisionReviewWindow
        ? linkedHoldDays
        : directMatch?.hold_days ?? linkedHoldDays ?? historicalMatch?.hold_days ?? null;
      const minHoldDays =
        (usesDecisionReviewWindow
          ? linkedMinHoldDays
          : directMatch?.review_min_hold_days ??
            linkedMinHoldDays ??
            historicalMatch?.review_min_hold_days) ??
        (holdDays ? Math.max(1, Math.min(holdDays, Math.round(holdDays * 0.4))) : null);
      if (!holdDays) return;

      const anchorDate =
        (usesDecisionReviewWindow ? toDate(position.evaluation_start_date) : null) ||
        toDate(position.source_triggered_at) ||
        toDate(position.trade_date);
      if (!anchorDate) return;

      const insight = buildEvaluationInsight(holdDays, anchorDate, now, minHoldDays);
      if (!insight) return;
      result[position.id] = {
        ...insight,
        detail: usesDecisionReviewWindow
          ? `Decision review window · ${insight.holdDays}d`
          : directMatch
          ? `Linked window ${directMatch.review_min_hold_days ?? insight.minHoldDays}-${directMatch.hold_days}d`
          : linkedHoldDays
            ? `Linked window ${insight.minHoldDays}-${linkedHoldDays}d`
            : `Historical ${position.symbol.toUpperCase()} ${position.option_type.toUpperCase()} template • ${insight.minHoldDays}-${holdDays}d`,
      };
    });

    return result;
  }, [positions, trainingOutcomeByEventId, trainingOutcomeBySymbolType]);

  const evaluationSummary = useMemo(() => {
    const values = Object.values(evaluationByPositionId);
    return {
      matched: values.length,
      due: values.filter((item) => item.urgency === "due").length,
      watch: values.filter((item) => item.urgency === "watch").length,
      overdue: values.filter((item) => item.urgency === "overdue").length,
    };
  }, [evaluationByPositionId]);

  const visibleOptionalityClusters = useMemo(
    () => optionalityClusters.filter((cluster) => cluster.group !== "Unclassified"),
    [optionalityClusters]
  );

  const activeScannerRun = useMemo(
    () => scannerData?.runs.find(isActiveScannerRun) ?? null,
    [scannerData]
  );
  const scannerUniverses = scannerData?.supported_universes ?? [
    { key: "SP500", label: "S&P 500" },
    { key: "RUSSELL2000", label: "Russell 2000" },
    { key: "ALL", label: "All Optionable Equities" },
  ];
  const topScannerSymbols = scannerData?.top_symbols ?? [];
  const recentScannerRuns = scannerData?.runs ?? [];
  const selectedScannerRun = scannerRunDetail?.run ?? recentScannerRuns.find((run) => run.id === selectedScannerRunId) ?? null;
  const selectedScannerHits = scannerRunDetail?.hits ?? [];
  const selectedScannerHit = useMemo(
    () => selectedScannerHits.find((hit) => hit.event_id === expandedScannerHitId) ?? null,
    [expandedScannerHitId, selectedScannerHits]
  );
  const selectedScannerHitContract = selectedScannerHit?.selected_contract ?? null;
  const selectedScannerHitPositionMatch = presentScannerPositionMatch(selectedScannerHit?.position_match);
  const selectedScannerHitContractLabel =
    selectedScannerHitContract?.option_type &&
    selectedScannerHitContract.strike !== null &&
    selectedScannerHitContract.strike !== undefined
      ? `${selectedScannerHitContract.option_type.toUpperCase()} ${formatNumber(selectedScannerHitContract.strike, 2)}${
          selectedScannerHitContract.expiry ? ` / ${formatDate(selectedScannerHitContract.expiry)}` : ""
        }${
          selectedScannerHitContract.dte !== null && selectedScannerHitContract.dte !== undefined
            ? ` / ${selectedScannerHitContract.dte} DTE`
            : ""
        }`
      : "contract pending";
  const selectedScannerRunActive = selectedScannerRun ? isActiveScannerRun(selectedScannerRun) : false;
  const selectedScannerRunProgress =
    selectedScannerRun && selectedScannerRun.total_symbols > 0
      ? Math.max(0, Math.min(100, (selectedScannerRun.scanned_symbols / selectedScannerRun.total_symbols) * 100))
      : 0;

  useEffect(() => {
    if (expandedScannerHitId === null) return;
    if (!selectedScannerHits.some((hit) => hit.event_id === expandedScannerHitId)) {
      setExpandedScannerHitId(null);
    }
  }, [expandedScannerHitId, selectedScannerHits]);

  useEffect(() => {
    if (expandedScannerHitId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpandedScannerHitId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedScannerHitId]);

  const filterCounts = useMemo(() => {
    return {
      lowConfidence: positions.filter(
        ({ position }) => !position.source_event_id || (position.source_match_confidence ?? 0) < 0.6
      ).length,
      losing: positions.filter(({ metrics }) => (metrics.pnl?.dollar ?? 0) < 0).length,
    };
  }, [positions]);

  const timelineLanes = useMemo(() => {
    return sortedPositions.map(({ position, metrics }) => {
      const evaluation = evaluationByPositionId[position.id] || null;
      const dteNow = metrics.dte ?? null;
      const dteEntry = position.dte_at_entry ?? null;
      const fallbackElapsed =
        dteEntry !== null && dteNow !== null ? Math.max(0, dteEntry - dteNow) : evaluation?.elapsedDays ?? 0;
      const totalDays = Math.max(
        1,
        dteEntry ?? fallbackElapsed + Math.max(0, dteNow ?? 0),
        evaluation?.holdDays ?? 1
      );
      const remainingDays = evaluation?.daysRemaining ?? dteNow ?? totalDays;
      const elapsedDays = evaluation
        ? evaluation.elapsedDays
        : dteEntry !== null && dteNow !== null
          ? Math.max(0, dteEntry - dteNow)
          : Math.max(0, totalDays - remainingDays);
      const progressPct = evaluation
        ? evaluation.progressPct
        : Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100));
      const urgency = evaluation?.urgency ?? deriveUrgencyFromDays(remainingDays);
      const attention = buildGreeksAttention(metrics.greeks, remainingDays);

      const urgencyStyle =
        urgency === "overdue"
          ? { pillClass: "border-rose-500/50 bg-rose-500/10 text-rose-200", barClass: "bg-rose-400" }
          : urgency === "due"
            ? { pillClass: "border-amber-500/50 bg-amber-500/10 text-amber-200", barClass: "bg-amber-300" }
            : urgency === "watch"
              ? { pillClass: "border-yellow-500/45 bg-yellow-500/10 text-yellow-200", barClass: "bg-yellow-300" }
              : { pillClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200", barClass: "bg-emerald-300" };

      const dteLabel = remainingDays < 0 ? `${Math.abs(remainingDays)}d post-exp` : `${remainingDays}d to exp`;
      return {
        laneId: `position-${position.id}`,
        linkedPositionId: position.id,
        eventId: position.source_event_id ?? null,
        symbol: position.symbol,
        optionType: position.option_type,
        contracts: position.contracts,
        matched: Boolean(evaluation),
        urgency,
        minHoldDays: evaluation?.minHoldDays ?? Math.max(1, Math.min(totalDays, Math.round(totalDays * 0.4))),
        maxHoldDays: evaluation?.holdDays ?? totalDays,
        totalDays,
        elapsedDays,
        remainingDays,
        progressPct,
        label: evaluation?.label ?? dteLabel,
        detail: evaluation?.detail ?? (dteEntry !== null ? `Entry DTE ${dteEntry}` : "Portfolio DTE progression"),
        pillClass: evaluation?.pillClass ?? urgencyStyle.pillClass,
        barClass: evaluation?.barClass ?? urgencyStyle.barClass,
        attentionStrength: attention.strength,
        attentionSpreadDays: attention.spreadDays,
        greeksHint: attention.hint,
      } as TimelineLane;
    });
  }, [sortedPositions, evaluationByPositionId]);

  const timelineLaneByPositionId = useMemo(() => {
    const lanes = new Map<number, TimelineLane>();
    timelineLanes.forEach((lane) => {
      if (lane.linkedPositionId !== null) {
        lanes.set(lane.linkedPositionId, lane);
      }
    });
    return lanes;
  }, [timelineLanes]);

  const filteredPositions = useMemo(() => {
    if (positionFilter === "all") {
      return sortedPositions;
    }
    return sortedPositions.filter(({ position, metrics }) => {
      const lane = timelineLaneByPositionId.get(position.id);
      switch (positionFilter) {
        case "matched":
          return Boolean(evaluationByPositionId[position.id]);
        case "watch":
        case "due":
        case "overdue":
          return lane?.urgency === positionFilter;
        case "lowConfidence":
          return !position.source_event_id || (position.source_match_confidence ?? 0) < 0.6;
        case "losing":
          return (metrics.pnl?.dollar ?? 0) < 0;
        default:
          return true;
      }
    });
  }, [sortedPositions, positionFilter, timelineLaneByPositionId, evaluationByPositionId]);

  useEffect(() => {
    if (loading || filteredPositions.length === 0) {
      return;
    }
    const selectedIsVisible = filteredPositions.some(({ position }) => position.id === selectedId);
    if (!selectedIsVisible) {
      const nextPositionId = filteredPositions[0].position.id;
      setSelectedId(nextPositionId);
      setExpandedPositionId(nextPositionId);
    }
  }, [filteredPositions, loading, selectedId]);

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalPnl = 0;
    let count = 0;
    positions.forEach((item) => {
      totalCost += item.position.total_cost;
      const pnlDollar = item.metrics?.pnl?.dollar;
      if (pnlDollar !== null && pnlDollar !== undefined) {
        totalPnl += pnlDollar;
      }
      count += 1;
    });
    const percent = totalCost ? (totalPnl / totalCost) * 100 : null;
    return { totalCost, totalPnl, percent, count };
  }, [positions]);

  const selectedZoneInputs = selected ? zoneInputsByPosition[selected.position.id] : null;
  const selectedSpotPrice =
    selected?.metrics.market.current_price ?? greeksData?.model_info?.spot_price ?? null;
  const selectedStrike = selected?.position.strike ?? null;
  const selectedProfitTake = asNumber(selectedZoneInputs?.profitTake);
  const selectedLossCut = asNumber(selectedZoneInputs?.lossCut);
  const selectedSpotWeight = selectedSymbol ? spotWeightBySymbol[selectedSymbol] ?? null : null;
  const currentSpotLean = useMemo(() => {
    if (!selected) return 0;
    const dayMove = Number(selected.metrics.market.change_percent ?? 0);
    if (!Number.isFinite(dayMove)) return 0;
    return clampUnit(dayMove / 2.5);
  }, [selected]);
  const projectedSpotGap = clampUnit((selectedSpotWeight?.composite ?? 0) - currentSpotLean);
  const technicalGap =
    selectedSpotWeight?.technical !== null && selectedSpotWeight?.technical !== undefined
      ? clampUnit(selectedSpotWeight.technical - currentSpotLean)
      : projectedSpotGap;
  const fundamentalGap =
    selectedSpotWeight?.fundamental !== null && selectedSpotWeight?.fundamental !== undefined
      ? clampUnit(selectedSpotWeight.fundamental - currentSpotLean)
      : projectedSpotGap;
  const selectedTimelineLane = selected ? timelineLaneByPositionId.get(selected.position.id) ?? null : null;
  const selectedDiagnosis = selected
    ? buildPositionDiagnosis(selected.position, selected.metrics, selectedTimelineLane)
    : null;
  const selectedOpportunityRead = selected ? buildOpportunityRead(selected.metrics.opportunity) : null;
  const selectedDecisionReviews = selected ? decisionReviewsByPosition[selected.position.id] ?? null : null;
  const selectedThesisAssessment = selected ? thesisAssessmentsByPosition[selected.position.id] ?? null : null;
  const selectedAssessmentConfirmed = Boolean(
    selectedDecisionReviews?.latest_review
    && selectedThesisAssessment?.assessment
    && selectedDecisionReviews.latest_review.selected_assessment_id === selectedThesisAssessment.assessment.id
    && selectedDecisionReviews.latest_review.human_override === "none"
  );

  const chartPriceDomain = useMemo(() => {
    if (!greeksData?.price_curve?.length) {
      return null;
    }
    const prices = greeksData.price_curve.map((point) => point.price);
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
    };
  }, [greeksData]);

  const sortedClosedRows = useMemo(() => {
    const sorted = [...closedPositions];
    sorted.sort((left, right) => {
      const direction = closedSort.direction === "asc" ? 1 : -1;
      const lv = (() => {
        switch (closedSort.key) {
          case "symbol":
            return left.symbol;
          case "strike":
            return left.strike;
          case "option_type":
            return left.option_type;
          case "fill_price":
            return left.fill_price;
          case "exit_price":
            return left.exit_price;
          case "close_date":
            return left.close_date;
          case "dollar_pnl":
            return left.dollar_pnl;
          case "percent_pnl":
            return left.percent_pnl;
          default:
            return null;
        }
      })();
      const rv = (() => {
        switch (closedSort.key) {
          case "symbol":
            return right.symbol;
          case "strike":
            return right.strike;
          case "option_type":
            return right.option_type;
          case "fill_price":
            return right.fill_price;
          case "exit_price":
            return right.exit_price;
          case "close_date":
            return right.close_date;
          case "dollar_pnl":
            return right.dollar_pnl;
          case "percent_pnl":
            return right.percent_pnl;
          default:
            return null;
        }
      })();
      if (lv === null || lv === undefined) return 1;
      if (rv === null || rv === undefined) return -1;
      if (typeof lv === "string" && typeof rv === "string") {
        return lv.localeCompare(rv) * direction;
      }
      return ((Number(lv) || 0) - (Number(rv) || 0)) * direction;
    });
    return sorted;
  }, [closedPositions, closedSort]);

  const closedTotals = useMemo(() => {
    const totalPnl = sortedClosedRows.reduce((sum, row) => sum + row.dollar_pnl, 0);
    const totalCost = sortedClosedRows.reduce((sum, row) => sum + row.total_cost, 0);
    const winners = sortedClosedRows.filter((row) => row.dollar_pnl > 0).length;
    const totalTrades = sortedClosedRows.length;
    return {
      totalPnl,
      totalCost,
      totalTrades,
      winners,
      winRate: totalTrades ? (winners / totalTrades) * 100 : 0,
    };
  }, [sortedClosedRows]);

  const scannerRecurrenceLearning = useMemo(() => {
    const cohorts = learningSummary?.scanner_recurrence_outcomes?.cohorts;
    if (!cohorts) return null;
    const repeated =
      cohorts.repeat_seen.sample_count +
      cohorts.strengthened_seen.sample_count +
      cohorts.contract_drift_seen.sample_count;
    if (repeated === 0) {
      return "Repeat evidence: collecting closed outcomes; no model weights change automatically.";
    }
    const parts = [`${repeated} closed repeat ${repeated === 1 ? "cycle" : "cycles"}`];
    if (cohorts.strengthened_seen.sample_count > 0) {
      parts.push(`${cohorts.strengthened_seen.sample_count} strengthened`);
    }
    if (cohorts.contract_drift_seen.sample_count > 0) {
      parts.push(`${cohorts.contract_drift_seen.sample_count} contract drift`);
    }
    return `Repeat evidence: ${parts.join(" · ")}; actual trades only.`;
  }, [learningSummary]);

  const openAttribution = useMemo(() => {
    const linked = positions.filter(
      (item) => item.position.source_event_id !== null && item.position.source_event_id !== undefined
    );
    const avgLinkConfidence = linked.length
      ? linked.reduce((sum, item) => sum + (item.position.source_match_confidence ?? 0), 0) / linked.length
      : null;
    return {
      linked: linked.length,
      total: positions.length,
      coverage: positions.length ? (linked.length / positions.length) * 100 : 0,
      avgLinkConfidence,
    };
  }, [positions]);

  const closedAttribution = useMemo(() => {
    const linked = sortedClosedRows.filter(
      (row) => row.source_event_id !== null && row.source_event_id !== undefined
    );
    const linkedWins = linked.filter((row) => row.dollar_pnl > 0).length;
    const linkedNetPnl = linked.reduce((sum, row) => sum + row.dollar_pnl, 0);
    const linkedAvgPercent = linked.length
      ? linked.reduce((sum, row) => sum + row.percent_pnl, 0) / linked.length
      : null;
    const linkedExpectancyDollar = linked.length ? linkedNetPnl / linked.length : null;
    return {
      linked: linked.length,
      linkedWinRate: linked.length ? (linkedWins / linked.length) * 100 : 0,
      linkedAvgPercent,
      linkedExpectancyDollar,
    };
  }, [sortedClosedRows]);

  const sortArrow = (active: boolean, direction: SortDirection) => {
    if (!active) return "↕";
    return direction === "asc" ? "↑" : "↓";
  };

  const buildAttributionTooltip = (
    sourceEventId: number | null | undefined,
    sourceTriggeredAt: string | null | undefined,
    sourceMatchMethod: string | null | undefined,
    sourceMatchConfidence: number | null | undefined,
    sourceMatchNotes: string | null | undefined
  ): string => {
    if (!sourceEventId) {
      return "No linked sweep signal for this trade.";
    }
    const lines = [
      `Linked sweep event #${sourceEventId}`,
      sourceTriggeredAt ? `Triggered: ${sourceTriggeredAt}` : "Triggered: n/a",
      sourceMatchMethod ? `Method: ${sourceMatchMethod}` : "Method: n/a",
      sourceMatchConfidence !== null && sourceMatchConfidence !== undefined
        ? `Link confidence: ${Math.round(sourceMatchConfidence * 100)}%`
        : "Link confidence: n/a",
    ];
    if (sourceMatchNotes) {
      lines.push(`Notes: ${sourceMatchNotes}`);
    }
    return lines.join("\n");
  };

  const attributionHeat = (
    sourceEventId: number | null | undefined,
    confidence: number | null | undefined
  ): { marker: string; rowTint: string; quality: string } => {
    if (!sourceEventId) {
      return {
        marker: "bg-gray-600",
        rowTint: "",
        quality: "unlinked",
      };
    }
    const c = confidence ?? 0;
    if (c >= 0.9) {
      return { marker: "bg-emerald-400", rowTint: "bg-emerald-950/20", quality: "high" };
    }
    if (c >= 0.75) {
      return { marker: "bg-lime-400", rowTint: "bg-lime-950/15", quality: "good" };
    }
    if (c >= 0.6) {
      return { marker: "bg-amber-400", rowTint: "bg-amber-950/10", quality: "medium" };
    }
    return { marker: "bg-rose-400", rowTint: "bg-rose-950/10", quality: "low" };
  };

  const toggleFilter = (filter: PositionFilter) => {
    setPositionFilter((current) => (current === filter ? "all" : filter));
  };

  const filterChipClass = (filter: PositionFilter, classes: string) =>
    `inline-flex h-6 items-center rounded-md border px-2 text-[10px] font-medium transition ${classes} ${
      positionFilter === filter ? "ring-1 ring-white/45 shadow-[0_0_14px_rgba(125,211,252,0.16)]" : "hover:border-white/35"
    }`;

  const activeFilterLabel =
    positionFilter === "all"
      ? null
      : positionFilter === "lowConfidence"
        ? "Low confidence"
        : positionFilter === "losing"
          ? "Losing positions"
          : capitalizeWord(positionFilter);

  const optionalityClustersCard = (
    <div className="surface-card-strong p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            <h2 className="text-base font-semibold text-stealth-100">Optionality Clusters</h2>
          </div>
          <div className="mt-0.5 text-[11px] text-stealth-400">
            45d scanner hits grouped by actionable sector/theme.
          </div>
        </div>
        <button
          type="button"
          onClick={loadOptionalityClusters}
          className="inline-flex items-center gap-1.5 rounded-md border border-stealth-600 bg-stealth-900/70 px-2.5 py-1.5 text-[11px] font-semibold text-stealth-200 hover:border-sky-400/50 hover:text-sky-100"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {visibleOptionalityClusters.length === 0 ? (
        <div className="rounded-lg border border-stealth-700/70 bg-stealth-950/35 px-3 py-4 text-sm text-stealth-400">
          No classified clusters in the current lookback.
        </div>
      ) : (
        <div className="grid gap-2">
          {visibleOptionalityClusters.slice(0, 6).map((cluster) => (
            <div
              key={cluster.group}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-stealth-800/70 py-2 last:border-b-0"
              title={`${cluster.group}: ${cluster.symbols.join(", ")}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-300/80" />
                  <div className="truncate text-sm font-semibold text-stealth-100">{cluster.group}</div>
                  <div className={`shrink-0 text-[11px] font-semibold ${clusterMomentumClass(cluster.momentum)}`}>
                    {cluster.momentum === 0 ? "flat" : `${formatSigned(cluster.momentum, 0)} wk`}
                  </div>
                </div>
                <div className="mt-1 truncate text-[11px] text-stealth-400">
                  {cluster.symbols.slice(0, 6).join(" ")}
                  {cluster.symbols.length > 6 ? ` +${cluster.symbols.length - 6}` : ""}
                </div>
              </div>
              <div className="text-right text-[11px] tabular-nums">
                <div className="font-semibold text-stealth-100">{cluster.hits} hits</div>
                <div className="text-stealth-400">IV/HV {formatPointChange(cluster.avg_iv_hv_spread, 1)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="page-shell-wide space-y-2.5 text-gray-100 md:space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stealth-500">Private</span>
          <h1 className="text-lg font-semibold leading-none tracking-tight text-white md:text-xl">Options Performance</h1>
        </div>
        <span className="rounded-full border border-stealth-700 bg-stealth-900/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stealth-400">
          /secret/options
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/20 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="min-w-0 space-y-3">
      <div className="surface-card-strong p-3">
        <span className="sr-only" role="status" aria-live="polite">
          {listRefreshPending ? "Position list updates pending." : listRefreshSettled ? "Position list updated." : ""}
        </span>
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-stealth-100">Position Summary</h2>
              <span className="rounded-full border border-stealth-700 bg-stealth-900/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-stealth-400">
                Open {totals.count}
              </span>
            </div>
            {positions.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(evaluationSummary.matched > 0 || positionFilter === "matched") ? (
                    <button
                      type="button"
                      onClick={() => toggleFilter("matched")}
                      aria-pressed={positionFilter === "matched"}
                      title="Matched = open positions with a model or historical evaluation window."
                      className={filterChipClass("matched", "border-indigo-500/35 bg-indigo-500/10 text-indigo-200")}
                    >
                      Matched {evaluationSummary.matched}
                    </button>
                  ) : null}
                  {(evaluationSummary.watch > 0 || positionFilter === "watch") ? (
                    <button
                      type="button"
                      onClick={() => toggleFilter("watch")}
                      aria-pressed={positionFilter === "watch"}
                      title="Watch = model evaluation gate is within five days."
                      className={filterChipClass("watch", "border-yellow-500/35 bg-yellow-500/10 text-yellow-200")}
                    >
                      Watch {evaluationSummary.watch}
                    </button>
                  ) : null}
                  {(evaluationSummary.due > 0 || positionFilter === "due") ? (
                    <button
                      type="button"
                      onClick={() => toggleFilter("due")}
                      aria-pressed={positionFilter === "due"}
                      title="Due = the modeled evaluation gate is today."
                      className={filterChipClass("due", "border-amber-500/35 bg-amber-500/10 text-amber-200")}
                    >
                      Due {evaluationSummary.due}
                    </button>
                  ) : null}
                  {(evaluationSummary.overdue > 0 || positionFilter === "overdue") ? (
                    <button
                      type="button"
                      onClick={() => toggleFilter("overdue")}
                      aria-pressed={positionFilter === "overdue"}
                      title="Overdue = current time is past the modeled evaluation gate."
                      className={filterChipClass("overdue", "border-rose-500/35 bg-rose-500/10 text-rose-200")}
                    >
                      Overdue {evaluationSummary.overdue}
                    </button>
                  ) : null}
                  {(filterCounts.losing > 0 || positionFilter === "losing") ? (
                    <button
                      type="button"
                      onClick={() => toggleFilter("losing")}
                      aria-pressed={positionFilter === "losing"}
                      title="Filter to open positions with negative live P/L."
                      className={filterChipClass("losing", "border-rose-500/35 bg-rose-500/10 text-rose-200")}
                    >
                      Losing {filterCounts.losing}
                    </button>
                  ) : null}
                  {(filterCounts.lowConfidence > 0 || positionFilter === "lowConfidence") ? (
                    <button
                      type="button"
                      onClick={() => toggleFilter("lowConfidence")}
                      aria-pressed={positionFilter === "lowConfidence"}
                      title="Low confidence = unlinked positions or source matches below 60% confidence."
                      className={filterChipClass("lowConfidence", "border-stealth-700 bg-stealth-900/70 text-stealth-300")}
                    >
                      Low conf {filterCounts.lowConfidence}
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-none text-stealth-400 tabular-nums">
                  <span title="Total premium paid for open positions.">
                    Cost <span className="text-stealth-200">{formatCurrency(totals.totalCost, 0)}</span>
                  </span>
                  <span title="Live total open-position P/L.">
                    P/L{" "}
                    <span className={totals.totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {formatCurrency(totals.totalPnl, 0)}
                      {totals.percent !== null ? ` ${formatSigned(totals.percent, 1)}%` : ""}
                    </span>
                  </span>
                  <span title="Linked = positions matched to scanner/model templates. Confidence is the reliability of the match.">
                    Linked{" "}
                    <span className="text-stealth-200">
                      {openAttribution.linked}/{openAttribution.total} · {formatPercent(openAttribution.coverage, 0)}
                    </span>
                  </span>
                  {closedAttribution.linked > 0 ? (
                    <span title="Quality = historical win rate and average result for linked closed trades.">
                      Q{" "}
                      <span
                        className={
                          closedAttribution.linkedAvgPercent !== null && closedAttribution.linkedAvgPercent < 0
                            ? "text-rose-300"
                            : "text-emerald-300"
                        }
                      >
                        {formatPercent(closedAttribution.linkedWinRate, 0)}
                        {closedAttribution.linkedAvgPercent !== null
                          ? ` / ${formatSigned(closedAttribution.linkedAvgPercent, 1)}%`
                          : ""}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void refreshPositionList()}
              disabled={loading || listRefreshPending}
              title={listRefreshPending ? "Fresh quotes and list updates are pending" : "Refresh all positions and review windows"}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-wait ${
                listRefreshPending
                  ? "border-amber-400/35 bg-amber-500/10 text-amber-100"
                  : listRefreshSettled
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                    : "border-stealth-600 bg-stealth-900/70 text-stealth-300 hover:border-stealth-500 hover:text-stealth-100"
              }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${listRefreshPending ? "animate-spin" : ""}`} aria-hidden="true" />
              {listRefreshPending ? "Refreshing" : listRefreshSettled ? "Updated" : "Refresh list"}
            </button>
            <button
              onClick={() => {
                setEditingPositionId(null);
                resetForm();
                setFormError(null);
                setShowAddModal(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
            >
              <span className="text-base leading-none">+</span> Add Trade
            </button>
            <button
              onClick={() => {
                loadClosedPositions();
                loadLearningSummary();
                setShowClosedLog(true);
              }}
              className="rounded-lg bg-stealth-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stealth-600"
            >
              P/L History
            </button>
            <button
              type="button"
              aria-pressed={showRowActions}
              title={showRowActions ? "Hide row action buttons" : "Show row action buttons"}
              onClick={() => setShowRowActions((current) => !current)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                showRowActions
                  ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-100"
                  : "border-stealth-600 bg-stealth-900/70 text-stealth-300 hover:border-stealth-500 hover:text-stealth-100"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              Manage
            </button>
          </div>
        </div>

        {activeFilterLabel ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-100">
            <span>
              Showing {filteredPositions.length}/{positions.length} positions: {activeFilterLabel}
            </span>
            <button
              type="button"
              onClick={() => setPositionFilter("all")}
              className="rounded border border-sky-300/35 px-2 py-0.5 text-[10px] font-semibold text-sky-100 hover:bg-sky-400/10"
            >
              Clear
            </button>
          </div>
        ) : null}

        {loading && positions.length === 0 ? (
          <div className="text-sm text-gray-400">Loading positions...</div>
        ) : (
          <div className="max-h-[68vh] overflow-auto rounded-xl border border-stealth-700 bg-stealth-950/30">
            <div
              className={`sticky top-0 z-10 grid min-w-0 items-center gap-1.5 border-b border-gray-700 bg-stealth-900/95 px-1.5 py-2 text-[10px] uppercase text-gray-500 backdrop-blur sm:gap-2 sm:px-2 ${positionMobileGrid} ${positionTableWidth} ${positionGridColumns}`}
            >
              <button
                type="button"
                className="text-left"
                onClick={() =>
                  setPositionSort((prev) => ({
                    key: "symbol",
                    direction: prev.key === "symbol" && prev.direction === "asc" ? "desc" : "asc",
                  }))
                }
              >
                Position {sortArrow(positionSort.key === "symbol", positionSort.direction)}
              </button>
              <span className="inline-flex items-center gap-1">
                Timeline / Evaluation Window
                <span
                  className="inline-flex"
                  role="img"
                  aria-label="Timeline legend"
                  title="Rail = contract life. Filled range = active maximum-hold window. Brackets strengthen on interaction. Thin amber marker = next review. Capped white marker = today. Translucent onion skins = all prior window versions."
                >
                  <HelpCircle className="h-3.5 w-3.5 text-sky-300/80" aria-hidden="true" />
                </span>
              </span>
              <span className="hidden md:block">Stats</span>
              {showRowActions ? <span className="hidden text-center md:block">Actions</span> : null}
            </div>

            <div className={`min-w-0 divide-y divide-gray-800 ${positionTableWidth}`}>
              {filteredPositions.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-gray-400">
                  No positions match the active filter.
                </div>
              ) : null}
              {filteredPositions.map((item) => {
                const { position, metrics } = item;
                const evaluation = evaluationByPositionId[position.id] || null;
                const lane = timelineLaneByPositionId.get(position.id);
                const heat = attributionHeat(position.source_event_id, position.source_match_confidence);
                const tooltip = buildAttributionTooltip(
                  position.source_event_id,
                  position.source_triggered_at,
                  position.source_match_method,
                  position.source_match_confidence,
                  position.source_match_notes
                );
                const volatilityRead = buildVolatilityRead(metrics.volatility_signal);
                const opportunityRead = buildOpportunityRead(metrics.opportunity);
                const rowActive = position.id === selectedId;
                const rowHovered = position.id === hoveredPositionId;
                const isExpanded = expandedPositionId === position.id;
                const rowDiagnosis = buildPositionDiagnosis(position, metrics, lane);
                const holdDateWindow = formatHoldDateWindow(position, evaluation, lane);

                return (
                  <Fragment key={position.id}>
                    <div
                      className={`relative grid cursor-pointer items-center gap-1.5 px-1.5 py-1.5 transition-colors sm:gap-2 sm:px-2 ${positionMobileGrid} ${positionGridColumns} ${
                        rowActive
                          ? "bg-sky-500/12 shadow-[inset_3px_0_0_rgba(125,211,252,0.9)] ring-1 ring-inset ring-sky-400/25"
                          : `${heat.rowTint} hover:bg-gray-900/40`
                      }`}
                      onClick={() => {
                        setSelectedId(position.id);
                        setExpandedPositionId((current) => (current === position.id ? null : position.id));
                      }}
                      onMouseEnter={() => setHoveredPositionId(position.id)}
                      onMouseLeave={() => setHoveredPositionId((current) => (current === position.id ? null : current))}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            title={`${tooltip}\nLink quality: ${heat.quality}`}
                            className={`inline-block h-7 w-1.5 shrink-0 rounded-full ${heat.marker}`}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-100">{position.symbol}</div>
                            <div className="truncate text-[10px] uppercase tracking-wide text-gray-500">
                              {position.option_type} ${formatNumber(position.strike, 2)} / {position.contracts} ctr
                            </div>
                          </div>
                        </div>
                      </div>

                      <PositionTimelineCell
                        position={position}
                        metrics={metrics}
                        lane={lane}
                        decisionHistory={
                          decisionReviewsByPosition[position.id]?.history ?? decisionWindowsByPosition[String(position.id)]
                        }
                        suggestedWindow={rowActive ? thesisAssessmentsByPosition[position.id]?.suggested_window : null}
                        isInteractive={rowActive || rowHovered}
                      />

                      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)] gap-x-2 text-[11px] tabular-nums md:grid">
                        <div
                          className={`font-semibold ${
                            (metrics.pnl?.dollar ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          <div className="text-[9px] font-medium uppercase tracking-wide text-gray-500">P/L</div>
                          <div>
                            {metrics.pnl?.dollar !== null && metrics.pnl?.dollar !== undefined
                              ? formatCurrency(metrics.pnl.dollar, 0)
                              : "—"}
                          </div>
                          <div className="text-[10px] font-normal text-gray-500">
                            {metrics.pnl?.percent !== null && metrics.pnl?.percent !== undefined ? `${formatSigned(metrics.pnl.percent, 1)}%` : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wide text-gray-500">Rank</div>
                          <div className="font-semibold text-gray-100">{opportunityRead.label}</div>
                        </div>
                        <div className={`${volatilityRead.text}`}>
                          <div className="text-[9px] uppercase tracking-wide text-gray-500">Vol</div>
                          <div className="truncate">{volatilityRead.label}</div>
                          <div className="truncate text-[10px] font-normal text-gray-500">{volatilityRead.detail}</div>
                        </div>
                      </div>

                      {showRowActions ? (
                        <div className="hidden items-center justify-end md:flex">
                          <PositionActionButtons
                            position={position}
                            mode="row"
                            onEdit={openEditModal}
                            onClose={openCloseModal}
                          />
                        </div>
                      ) : null}

                      {(listRefreshPending || listRefreshSettled) ? (
                        <span
                          className={`pointer-events-none absolute inset-y-1 right-0 w-1 rounded-l-full transition-colors duration-200 ${
                            listRefreshPending
                              ? "animate-pulse bg-amber-300/85 motion-reduce:animate-none"
                              : "bg-emerald-400/75"
                          }`}
                          title={listRefreshPending ? `${position.symbol} refresh pending` : `${position.symbol} updated`}
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>

                    {isExpanded ? (
                      <div className="border-t border-gray-800 bg-gray-950/35 px-3 py-2">
                        {showRowActions ? (
                          <div className="mb-2 flex justify-end md:hidden">
                            <PositionActionButtons
                              position={position}
                              mode="expanded"
                              onEdit={openEditModal}
                              onClose={openCloseModal}
                            />
                          </div>
                        ) : null}
                        <div
                          className={`mb-2 rounded-md border px-2.5 py-1.5 text-[11px] ${
                            lane?.urgency === "overdue"
                              ? "border-rose-500/35 bg-rose-500/10 text-rose-100"
                              : lane?.urgency === "due"
                                ? "border-amber-500/35 bg-amber-500/10 text-amber-100"
                                : lane?.urgency === "watch"
                                  ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-100"
                                  : "border-gray-700/70 bg-gray-900/45 text-gray-300"
                          }`}
                        >
                          {rowDiagnosis}
                        </div>
                        <div className="grid gap-2 text-[11px] text-gray-400 md:grid-cols-4">
                          <div className="rounded-md border border-gray-700/70 bg-gray-900/45 p-2">
                            <div className="text-[9px] uppercase tracking-wide text-gray-500">Pricing</div>
                            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                              <span>Fill</span><span className="text-gray-200">{formatCurrency(position.fill_price, 2)}</span>
                              <span>Option</span><span className="text-gray-200">{metrics.option_price !== null ? formatCurrency(metrics.option_price, 2) : "—"}</span>
                              <span>Underlying</span><span className="text-gray-200">{metrics.market.current_price !== null ? formatCurrency(metrics.market.current_price, 2) : "—"}</span>
                              <span>Bid / Ask</span><span className="text-gray-200">
                                {metrics.quote.bid !== null && metrics.quote.bid !== undefined ? formatCurrency(metrics.quote.bid, 2) : "n/a"} / {metrics.quote.ask !== null && metrics.quote.ask !== undefined ? formatCurrency(metrics.quote.ask, 2) : "n/a"}
                              </span>
                              <span>Spread</span><span className="text-gray-200">{metrics.quote.spread_pct !== null && metrics.quote.spread_pct !== undefined ? formatPercent(metrics.quote.spread_pct, 1) : "n/a"}</span>
                              <span>OI / Vol</span><span className="text-gray-200">{metrics.quote.open_interest ?? "n/a"} / {metrics.quote.volume ?? "n/a"}</span>
                            </div>
                          </div>

                          <div className="rounded-md border border-gray-700/70 bg-gray-900/45 p-2">
                            <div className="text-[9px] uppercase tracking-wide text-gray-500">Model Rank</div>
                            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                              <span>Entry</span>
                              <span className="text-gray-200">
                                {metrics.opportunity?.entry?.score !== null && metrics.opportunity?.entry?.score !== undefined
                                  ? `${compactOpportunityGrade(metrics.opportunity.entry.score, metrics.opportunity.entry.grade)} (${metrics.opportunity.entry.score.toFixed(0)})`
                                  : "n/a"}
                              </span>
                              <span>Now</span>
                              <span className="text-gray-200">
                                {metrics.opportunity?.current?.score !== null && metrics.opportunity?.current?.score !== undefined
                                  ? `${opportunityRead.label} (${metrics.opportunity.current.score.toFixed(0)})`
                                  : opportunityRead.label}
                              </span>
                              <span>Change</span>
                              <span className={metrics.opportunity?.score_change !== null && metrics.opportunity?.score_change !== undefined && metrics.opportunity.score_change >= 0 ? "text-emerald-300" : "text-rose-300"}>
                                {metrics.opportunity?.score_change !== null && metrics.opportunity?.score_change !== undefined ? formatSigned(metrics.opportunity.score_change, 1) : "n/a"}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-[10px] text-gray-500">
                              {metrics.opportunity?.current?.reasons?.slice(0, 2).join(" / ") || metrics.opportunity?.basis || "score unavailable"}
                            </div>
                            {holdDateWindow ? (
                              <div className="mt-2 border-t border-gray-800/80 pt-1.5 text-[10px]">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="uppercase tracking-wide text-gray-500">Hold</span>
                                  <span className="truncate text-right font-medium text-cyan-100">{holdDateWindow.range}</span>
                                </div>
                                <div className="mt-0.5 truncate text-gray-500">{holdDateWindow.detail}</div>
                              </div>
                            ) : null}
                          </div>

                          <div className="rounded-md border border-gray-700/70 bg-gray-900/45 p-2">
                            <div className="text-[9px] uppercase tracking-wide text-gray-500">Window</div>
                            <div className="mt-1 space-y-0.5">
                              <div className="text-gray-200">{lane?.detail ?? evaluation?.detail ?? "No linked or historical template"}</div>
                              <div>{volatilityRead.label}</div>
                              <div>{position.source_match_method || "unlinked"} / {position.source_match_confidence !== null && position.source_match_confidence !== undefined ? formatPercent(position.source_match_confidence * 100, 0) : "n/a"}</div>
                            </div>
                            <TimelinePressureStack position={position} metrics={metrics} lane={lane} />
                          </div>

                          <VolatilitySignalCard metrics={metrics} />
                        </div>
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-gray-700 px-3 py-2 text-xs">
              <span className="font-semibold text-gray-400">Total P&amp;L</span>
              <span className={`font-semibold ${totals.totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {formatCurrency(totals.totalPnl, 0)}
              </span>
              <span className="text-gray-500">{totals.percent !== null ? `${formatSigned(totals.percent, 1)}%` : "—"}</span>
            </div>
          </div>
        )}
      </div>

      <div className="surface-card-strong p-3">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-stealth-100">Scanner Control &amp; Outcomes</h2>
            <div className="mt-0.5 text-[11px] text-stealth-400">
              Runs the same options sweep used by Discord and preserves Discord hit output.
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(150px,1fr)_96px_auto] lg:w-[620px]">
            <select
              value={scannerUniverse}
              onChange={(event) => setScannerUniverse(event.target.value)}
              disabled={scannerRunning || Boolean(activeScannerRun)}
              className="rounded-md border border-stealth-700 bg-stealth-950 px-2 py-1.5 text-xs text-stealth-100 disabled:opacity-60"
            >
              {scannerUniverses.map((universe) => (
                <option key={universe.key} value={universe.key}>
                  {universe.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              max="99"
              step="1"
              value={scannerThreshold}
              onChange={(event) => setScannerThreshold(event.target.value)}
              disabled={scannerRunning || Boolean(activeScannerRun)}
              className="rounded-md border border-stealth-700 bg-stealth-950 px-2 py-1.5 text-xs text-stealth-100 disabled:opacity-60"
              aria-label="IV percentile threshold"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRunScanner}
                disabled={scannerRunning || Boolean(activeScannerRun)}
                className="inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:bg-stealth-700 disabled:text-stealth-400"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                {activeScannerRun ? "Running" : scannerRunning ? "Starting" : "Run Scan"}
              </button>
              {activeScannerRun ? (
                <button
                  type="button"
                  onClick={handleStopScanner}
                  disabled={scannerStopping}
                  className="inline-flex min-w-[82px] items-center justify-center gap-1.5 rounded-md border border-rose-500/45 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:border-rose-400/70 hover:bg-rose-500/25 disabled:opacity-60"
                >
                  <Square className="h-3 w-3" aria-hidden="true" />
                  {scannerStopping ? "Stopping" : "Stop"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {scannerError ? (
          <div className="mb-2 rounded-md border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-100">
            {scannerError}
          </div>
        ) : null}
        {scannerNotice ? (
          <div className="mb-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-100">
            {scannerNotice}
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)_minmax(280px,0.82fr)]">
          <div className="min-w-0 rounded-lg border border-stealth-800/80 bg-stealth-950/25 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Run History</div>
                <div className="text-[10px] text-stealth-500">Select scan</div>
              </div>
              <button
                type="button"
                onClick={loadScannerSummary}
                className="text-[10px] font-medium text-sky-300 hover:text-sky-200"
              >
                Refresh
              </button>
            </div>
            {recentScannerRuns.length === 0 ? (
              <div className="min-h-[220px] rounded-lg border border-stealth-700/70 bg-stealth-950/35 px-3 py-4 text-sm text-stealth-400">
                No persisted scanner runs yet.
              </div>
            ) : (
              <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {recentScannerRuns.slice(0, 8).map((run) => {
                  const scanned = run.total_symbols > 0 ? `${run.scanned_symbols}/${run.total_symbols}` : `${run.scanned_symbols}`;
                  const progress =
                    run.total_symbols > 0
                      ? Math.max(0, Math.min(100, (run.scanned_symbols / run.total_symbols) * 100))
                      : 0;
                  const runActive = isActiveScannerRun(run);
                  const progressWidth = Math.max(runActive ? 4 : 0, progress);
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => handleSelectScannerRun(run.id)}
                      className={`block min-h-[88px] w-full rounded-md border px-2 py-2 text-left transition-colors duration-200 ${
                        selectedScannerRunId === run.id
                          ? "border-sky-500/35 bg-sky-500/10"
                          : "border-stealth-800/70 bg-stealth-950/20 hover:border-stealth-700 hover:bg-stealth-900/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-xs font-semibold text-stealth-100">
                          {run.universe_label}
                          <span className="ml-1 text-[10px] font-normal uppercase text-stealth-500">{run.trigger_source}</span>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scannerStatusClass(run.status)}`}>
                          {run.status}
                        </span>
                      </div>
                      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-stealth-900">
                        <div
                          className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                            runActive ? "bg-sky-300/80" : "bg-emerald-300/70"
                          }`}
                          style={{ width: `${progressWidth}%` }}
                        />
                        {runActive ? (
                          <div className="absolute inset-y-0 left-0 w-1/2 animate-[updatesIndeterminate_1200ms_ease-in-out_infinite] motion-reduce:animate-none rounded-full bg-sky-200/20" />
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-stealth-400 tabular-nums">
                        <span>{formatRelativeTime(run.started_at)} · {scanned} scanned</span>
                        <span>{run.hits} hits / {run.errors} errors</span>
                      </div>
                      <div className="mt-1 min-h-[14px] truncate text-[10px] text-stealth-500">
                        {run.hit_symbols.length > 0
                          ? `${run.hit_symbols.slice(0, 8).join(" ")}${run.hit_symbols.length > 8 ? ` +${run.hit_symbols.length - 8}` : ""}`
                          : run.hits > 0
                            ? `${run.hits} hits recorded`
                            : runActive
                              ? "Waiting for first persisted hit"
                              : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Selected Scan Hits</div>
                <div className="text-[10px] text-stealth-500">
                  {selectedScannerRun
                    ? `${selectedScannerRun.universe_label} · ${formatRelativeTime(selectedScannerRun.started_at)}`
                    : "No scan selected"}
                </div>
              </div>
              {selectedScannerRun ? (
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scannerStatusClass(selectedScannerRun.status)}`}>
                  {selectedScannerRun.status}
                </span>
              ) : null}
            </div>
            {selectedScannerRunActive ? (
              <div className="mb-2 rounded-md border border-sky-500/20 bg-sky-500/10 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-[10px] text-sky-100 tabular-nums">
                  <span>Scanning {selectedScannerRun?.scanned_symbols ?? 0}/{selectedScannerRun?.total_symbols ?? 0}</span>
                  <span>{selectedScannerRunProgress.toFixed(0)}%</span>
                </div>
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-stealth-950/80">
                  <div
                    className="h-full rounded-full bg-sky-300/80 transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.max(4, selectedScannerRunProgress)}%` }}
                  />
                  <div className="absolute inset-y-0 left-0 w-1/2 animate-[updatesIndeterminate_1200ms_ease-in-out_infinite] motion-reduce:animate-none rounded-full bg-white/15" />
                </div>
              </div>
            ) : null}
            {loadingScannerRunDetail ? (
              <div className="min-h-[220px] rounded-lg border border-stealth-700/70 bg-stealth-950/35 px-3 py-4 text-sm text-stealth-400">
                Loading selected scan...
              </div>
            ) : selectedScannerHits.length === 0 ? (
              <div className="flex min-h-[220px] items-center rounded-lg border border-stealth-700/70 bg-stealth-950/35 px-3 py-4 text-sm text-stealth-400">
                {selectedScannerRun
                  ? selectedScannerRunActive
                    ? "Running. Hit cards will appear here as Discord alerts persist."
                    : selectedScannerRun.hits > 0
                      ? `${selectedScannerRun.hits} hits recorded, but no linked hit cards were found for this scan.`
                      : "No persisted hit cards found for this scan."
                  : "Select a scanner run to inspect its hits."}
              </div>
            ) : (
              <div className="max-h-[460px] overflow-x-hidden overflow-y-auto rounded-lg border border-stealth-800/80 bg-stealth-950/25">
                <div className="sticky top-0 z-10 grid grid-cols-[64px_minmax(0,1fr)_64px] gap-2 border-b border-stealth-800 bg-stealth-950/95 px-2 py-1.5 text-[9px] uppercase tracking-wide text-stealth-500">
                  <span>Symbol</span>
                  <span>Setup</span>
                  <span className="text-right">Rank</span>
                </div>
                <div className="divide-y divide-stealth-800/80">
                {selectedScannerHits.map((opportunity) => {
                  const contract = opportunity.selected_contract;
                  const positionMatch = presentScannerPositionMatch(opportunity.position_match);
                  const isSelected = expandedScannerHitId === opportunity.event_id;
                  const contractLabel =
                    contract.option_type && contract.strike !== null && contract.strike !== undefined
                      ? `${contract.option_type.toUpperCase()} ${formatNumber(contract.strike, 2)}`
                      : "contract pending";
                  return (
                    <Fragment key={opportunity.event_id}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-haspopup="dialog"
                          aria-label={`Open scanner hit details for ${opportunity.symbol}`}
                          onClick={() => setExpandedScannerHitId(opportunity.event_id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setExpandedScannerHitId(opportunity.event_id);
                            }
                          }}
                          className={`grid cursor-pointer grid-cols-[64px_minmax(0,1fr)_64px] gap-2 px-2 py-2 text-xs transition-colors ${
                            isSelected ? "bg-sky-500/10" : "hover:bg-stealth-900/35"
                          }`}
                        >
                        <Link
                          to={`/stock-analysis/${encodeURIComponent(opportunity.symbol)}?symbol=${encodeURIComponent(opportunity.symbol)}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-semibold text-sky-200 hover:text-sky-100"
                        >
                          {opportunity.symbol}
                        </Link>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <div className="truncate text-stealth-200">
                              {contractLabel}
                              {contract.expiry ? ` · ${formatDate(contract.expiry)}` : ""}
                              {contract.dte !== null && contract.dte !== undefined ? ` · ${contract.dte} DTE` : ""}
                            </div>
                            {positionMatch ? (
                              <span
                                aria-label={positionMatch.accessibleLabel}
                                title={positionMatch.accessibleLabel}
                                className={`shrink-0 rounded border px-1 py-0.5 text-[8px] font-semibold tracking-wide ${scannerPositionMatchBadgeClass[positionMatch.tone]}`}
                              >
                                {positionMatch.badgeLabel}
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-[10px] text-stealth-500">
                            {opportunity.group} · IV pct {formatPercent(opportunity.iv_percentile, 0)} · IV/HV {formatPointChange(opportunity.iv_hv_spread, 1)}
                            {contract.reward_risk !== null && contract.reward_risk !== undefined ? ` · ${contract.reward_risk.toFixed(2)}R` : ""}
                            {contract.open_interest !== null && contract.open_interest !== undefined ? ` · OI ${contract.open_interest}` : ""}
                          </div>
                          {positionMatch ? (
                            <div
                              role="note"
                              aria-label={positionMatch.accessibleLabel}
                              className={`truncate text-[9px] ${scannerPositionMatchTextClass[positionMatch.tone]}`}
                            >
                              {positionMatch.evidenceLine}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-start justify-end gap-1">
                          <div className={`rounded-md border px-1.5 py-1 text-center text-xs font-semibold ${opportunityScoreClass(opportunity.score)}`}>
                            {compactOpportunityGrade(opportunity.score, opportunity.grade)}
                          </div>
                          <ChevronDown
                            className={`mt-1 h-3 w-3 -rotate-90 text-stealth-500 transition-colors ${isSelected ? "text-sky-300" : ""}`}
                          />
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-lg border border-stealth-800/80 bg-stealth-950/25 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Repeated Names</div>
                <div className="text-[10px] text-stealth-500">All runs / 45d</div>
              </div>
              <div className="text-right text-[10px] text-stealth-500">
                <div>{scannerData?.summary.event_count ?? 0} hits</div>
                <div>{scannerData?.summary.symbol_count ?? 0} names</div>
              </div>
            </div>
            {topScannerSymbols.length === 0 ? (
              <div className="min-h-[220px] rounded-lg border border-stealth-700/70 bg-stealth-950/35 px-3 py-4 text-sm text-stealth-400">
                No recent scanner hits in the current lookback.
              </div>
            ) : (
              <div className="max-h-[460px] divide-y divide-stealth-800/80 overflow-y-auto pr-1">
                {topScannerSymbols.slice(0, 8).map((symbol) => (
                  <div key={symbol.symbol} className="grid min-h-[54px] grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-xs">
                    <Link
                      to={`/stock-analysis/${encodeURIComponent(symbol.symbol)}?symbol=${encodeURIComponent(symbol.symbol)}`}
                      className="font-semibold text-sky-200 hover:text-sky-100"
                    >
                      {symbol.symbol}
                    </Link>
                    <div className="min-w-0">
                      <div className="truncate text-stealth-300">{symbol.group}</div>
                      <div className="text-[10px] text-stealth-500">{formatRelativeTime(symbol.latest_triggered_at)}</div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="font-semibold text-stealth-100">
                        {symbol.hits}x{symbol.recent_hits > 0 ? ` / ${symbol.recent_hits} wk` : ""}
                      </div>
                      <div className="text-[10px] text-stealth-500">
                        {symbol.avg_opportunity_score !== null && symbol.avg_opportunity_score !== undefined
                          ? `score ${symbol.avg_opportunity_score.toFixed(0)}`
                          : `IV/HV ${formatPointChange(symbol.avg_iv_hv_spread, 1)}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

        </section>

        <aside className="min-w-0 space-y-3 xl:sticky xl:top-4">
      <div className="surface-card-strong max-h-none overflow-y-visible p-2.5 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-stealth-100">Position inspector</h2>
            {selected ? (
              <p className="mt-0.5 text-[11px] font-medium text-stealth-300">
                Selected: {selected.position.symbol} {selected.position.option_type.toUpperCase()} ${formatNumber(selected.position.strike, 2)}
                {" · "}
                {formatDate(selected.position.expiration)}
                {" · "}
                {selected.metrics.dte ?? "n/a"} DTE
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {selectedStockAnalysisPath && selectedSymbol && (
              <Link
                to={selectedStockAnalysisPath}
                className="rounded-md bg-sky-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-600"
              >
                {selectedSymbol} Analysis
              </Link>
            )}
          </div>
        </div>

        {selectedDiagnosis && (
          <div
            className={`mb-2 rounded-md border px-2.5 py-1.5 text-[11px] ${
              selectedTimelineLane?.urgency === "overdue"
                ? "border-rose-500/35 bg-rose-500/10 text-rose-100"
                : selectedTimelineLane?.urgency === "due"
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-100"
                  : selectedTimelineLane?.urgency === "watch"
                    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-100"
                    : "border-gray-700/70 bg-gray-900/45 text-gray-300"
            }`}
          >
            {selectedDiagnosis}
          </div>
        )}

        {selected && (
          <div className="mb-2 rounded-xl border border-sky-700/45 bg-sky-950/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-300">Decision cockpit</div>
                <div className="mt-1 text-base font-semibold leading-tight text-stealth-100">
                  {selectedThesisAssessment?.assessment
                    ? `${decisionLabel(selectedThesisAssessment.assessment.proposed_verdict)} to ${selectedThesisAssessment.assessment.proposed_target_contracts}`
                    : "Building the first point-in-time assessment"}
                </div>
                {selectedThesisAssessment?.assessment && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                    <span className="rounded-full border border-stealth-700 bg-stealth-950/45 px-1.5 py-0.5 text-stealth-300">
                      {decisionLabel(selectedThesisAssessment.assessment.quality)} quality
                    </span>
                    <span className="rounded-full border border-stealth-700 bg-stealth-950/45 px-1.5 py-0.5 text-stealth-300">
                      {decisionLabel(selectedThesisAssessment.assessment.urgency)} urgency
                    </span>
                    <span className="rounded-full border border-stealth-700 bg-stealth-950/45 px-1.5 py-0.5 text-stealth-300">
                      {decisionLabel(selectedThesisAssessment.assessment.confidence)} confidence
                    </span>
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right text-[9px] text-stealth-500">
                <div>{selected.position.contracts} held</div>
                <div>{selected.metrics.dte ?? "—"} DTE</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={confirmingDecisionReview || loadingThesisAssessment || !selectedThesisAssessment?.assessment || selectedAssessmentConfirmed}
                onClick={confirmAutomaticAssessment}
                title="Append the current automatic grade to the decision journal. No order is submitted."
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-600/55 bg-emerald-900/35 px-2 py-1.5 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-800/45 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {confirmingDecisionReview ? "Confirming..." : selectedAssessmentConfirmed ? "Grade confirmed" : "Confirm grade"}
              </button>
              <button
                type="button"
                onClick={() => openDecisionReviewModal(selected.position, "override")}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-sky-600/55 bg-sky-900/35 px-2 py-1.5 text-[10px] font-semibold text-sky-100 hover:bg-sky-800/55"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Override decision
              </button>
              <button
                type="button"
                onClick={() => openDecisionReviewModal(selected.position, "window")}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-amber-700/50 bg-amber-950/25 px-2 py-1.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-900/40"
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                Revise window
              </button>
              <button
                type="button"
                disabled={loadingThesisAssessment}
                onClick={() => loadThesisAssessment(selected.position.id, true)}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-stealth-600 bg-stealth-900/70 px-2 py-1.5 text-[10px] font-semibold text-stealth-200 hover:bg-stealth-800 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingThesisAssessment ? "animate-spin" : ""}`} aria-hidden="true" />
                {loadingThesisAssessment ? "Grading..." : "Refresh grade"}
              </button>
            </div>

            {selectedThesisAssessment?.assessment && (
              <div className="mt-2 text-[10px]">
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-md border border-stealth-700/70 bg-stealth-950/35 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-stealth-500">Suggested next review</div>
                    <div className="mt-0.5 font-semibold text-stealth-100">
                      {selectedThesisAssessment.suggested_window.next_review_date
                        ? formatDate(selectedThesisAssessment.suggested_window.next_review_date)
                        : "No further review"}
                    </div>
                  </div>
                  <div className="rounded-md border border-stealth-700/70 bg-stealth-950/35 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-stealth-500">Maximum hold deadline</div>
                    <div className="mt-0.5 font-semibold text-stealth-100">
                      {formatDate(selectedThesisAssessment.suggested_window.decision_deadline)}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 text-[9px] text-stealth-500">
                  {selectedThesisAssessment.suggested_window.max_hold_sessions} session max · entry model {selectedThesisAssessment.suggested_window.original_min_hold_days}-{selectedThesisAssessment.suggested_window.original_max_hold_days} sessions
                  {selectedThesisAssessment.suggested_window.rebased ? " · rebased today; prior window preserved" : ""}
                </div>
              </div>
            )}

            {thesisAssessmentError && (
              <div className="mt-2 rounded border border-rose-600/40 bg-rose-950/25 px-2 py-1.5 text-[10px] text-rose-100">
                {thesisAssessmentError}
              </div>
            )}

            {selectedThesisAssessment?.assessment && (
              <details className="mt-2 rounded-md border border-sky-700/35 bg-stealth-950/30 text-[10px]">
                <summary className="cursor-pointer px-2 py-1.5 font-semibold text-stealth-300">
                  Why this grade · 6 decision inputs
                </summary>
                <div className="space-y-2 border-t border-sky-800/30 p-2">
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  {[
                    ["Company", selectedThesisAssessment.assessment.company_thesis_status],
                    ["Security", selectedThesisAssessment.assessment.security_thesis_readiness],
                    ["Path", selectedThesisAssessment.assessment.path_status],
                    ["Contract", selectedThesisAssessment.assessment.contract_status],
                    ["Portfolio", selectedThesisAssessment.assessment.portfolio_fit_status],
                    ["Data", selectedThesisAssessment.assessment.data_quality_status],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded border border-stealth-700/70 bg-stealth-950/55 px-1.5 py-1">
                      <div className="text-stealth-500">{label}</div>
                      <div className="font-semibold text-stealth-100">{decisionLabel(value)}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] leading-relaxed text-stealth-300">
                  {selectedThesisAssessment.assessment.reasons.join(" ")}
                </div>
                {selectedThesisAssessment.assessment.vetoes.length > 0 && (
                  <div className="rounded border border-rose-600/40 bg-rose-950/25 px-2 py-1.5 text-[10px] text-rose-100">
                    <span className="font-semibold">Vetoes: </span>
                    {selectedThesisAssessment.assessment.vetoes.map((item) => item.detail).join(" ")}
                  </div>
                )}
                {selectedThesisAssessment.assessment.missing_inputs.length > 0 && (
                  <details className="text-[10px] text-amber-100">
                    <summary className="cursor-pointer">Confidence limits · {selectedThesisAssessment.assessment.missing_inputs.length}</summary>
                    <div className="mt-1 text-stealth-400">{selectedThesisAssessment.assessment.missing_inputs.join(" · ")}</div>
                  </details>
                )}
                {(
                  selectedThesisAssessment.risk_policy.approval_status !== "approved"
                  || !selectedThesisAssessment.risk_policy.active
                  || selectedThesisAssessment.risk_policy.portfolio_capital === null
                ) && (
                  <details className="rounded border border-amber-700/35 bg-amber-950/15 px-2 py-1.5 text-[10px] text-amber-100">
                    <summary className="cursor-pointer font-semibold">Activate portfolio sizing guardrails</summary>
                    <div className="mt-2 grid gap-2 border-t border-amber-900/50 pt-2 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="text-stealth-400">
                        Portfolio capital / NAV
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={portfolioCapitalInput}
                          onChange={(event) => setPortfolioCapitalInput(event.target.value)}
                          placeholder="Required for sizing"
                          className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2 py-1.5 text-xs text-stealth-100"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={riskPolicySaving}
                        onClick={approveRiskPolicy}
                        className="rounded border border-amber-600/50 bg-amber-900/35 px-2.5 py-1.5 font-semibold text-amber-100 hover:bg-amber-800/45 disabled:opacity-50"
                      >
                        {riskPolicySaving ? "Saving..." : "Approve draft guardrails"}
                      </button>
                    </div>
                    <div className="mt-1.5 text-stealth-500">
                      Defaults: 30% single-position, 75% one direction, 45% one expiry bucket, 25% max spread, 21 minimum DTE. Approval creates a new policy version.
                    </div>
                  </details>
                )}
                <div className="flex flex-wrap justify-between gap-2 text-[9px] text-stealth-500">
                  <span>{selectedThesisAssessment.assessment.grader_version} · {formatRelativeTime(selectedThesisAssessment.assessment.as_of)}</span>
                  <span>Shadow decision only · no order submitted</span>
                </div>
                </div>
              </details>
            )}

            {loadingDecisionReview && !selectedDecisionReviews ? (
              <div className="mt-2 text-[11px] text-stealth-400">Loading decision history...</div>
            ) : selectedDecisionReviews?.latest_review ? (
              <details className="mt-2 rounded-md border border-stealth-700/70 bg-stealth-950/25 text-[10px]">
                <summary className="cursor-pointer px-2 py-1.5 font-semibold text-stealth-300">
                  Decision journal · {selectedDecisionReviews.review_count} review{selectedDecisionReviews.review_count === 1 ? "" : "s"}
                </summary>
                <div className="space-y-2 border-t border-stealth-800 p-2">
                <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                  <div className="rounded border border-stealth-700/70 bg-stealth-950/40 px-1.5 py-1">
                    <div className="text-stealth-500">Target</div>
                    <div className="font-semibold text-stealth-100">
                      {selectedDecisionReviews.latest_review.target_contracts} / {selected.position.contracts}
                    </div>
                  </div>
                  <div className="rounded border border-stealth-700/70 bg-stealth-950/40 px-1.5 py-1">
                    <div className="text-stealth-500">Quality</div>
                    <div className="font-semibold text-stealth-100">{decisionLabel(selectedDecisionReviews.latest_review.quality)}</div>
                  </div>
                  <div className="rounded border border-stealth-700/70 bg-stealth-950/40 px-1.5 py-1">
                    <div className="text-stealth-500">Urgency</div>
                    <div className="font-semibold text-stealth-100">{decisionLabel(selectedDecisionReviews.latest_review.urgency)}</div>
                  </div>
                  <div className="rounded border border-stealth-700/70 bg-stealth-950/40 px-1.5 py-1">
                    <div className="text-stealth-500">Confidence</div>
                    <div className="font-semibold text-stealth-100">{decisionLabel(selectedDecisionReviews.latest_review.confidence)}</div>
                  </div>
                </div>

                <div className="rounded border border-stealth-700/70 bg-stealth-950/35 px-2 py-1.5 text-[10px] text-stealth-300">
                  <span className="text-stealth-500">Would open this exact contract today? </span>
                  <span className="font-semibold text-stealth-100">
                    {decisionLabel(selectedDecisionReviews.latest_review.fresh_entry_answer)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <div className="rounded border border-stealth-700/70 bg-stealth-950/35 px-2 py-1.5">
                    <div className="text-stealth-500">Review date · process clock</div>
                    <div className="font-semibold text-stealth-100">
                      {selectedDecisionReviews.latest_review.next_review_date
                        ? formatDate(selectedDecisionReviews.latest_review.next_review_date)
                        : "Not scheduled"}
                    </div>
                  </div>
                  <div className="rounded border border-stealth-700/70 bg-stealth-950/35 px-2 py-1.5">
                    <div className="text-stealth-500">Decision deadline · evidence clock</div>
                    <div className="font-semibold text-stealth-100">
                      {selectedDecisionReviews.latest_review.decision_deadline
                        ? formatDate(selectedDecisionReviews.latest_review.decision_deadline)
                        : "Not set"}
                    </div>
                  </div>
                </div>

                {selectedDecisionReviews.latest_review.evidence_since_last && (
                  <div className="text-[10px] leading-relaxed text-stealth-300">
                    <span className="text-stealth-500">What changed: </span>
                    {selectedDecisionReviews.latest_review.evidence_since_last}
                  </div>
                )}
                {selectedDecisionReviews.latest_review.continuation_condition && (
                  <div className="text-[10px] leading-relaxed text-stealth-300">
                    <span className="text-stealth-500">Continue only if: </span>
                    {selectedDecisionReviews.latest_review.continuation_condition}
                  </div>
                )}

                {selectedDecisionReviews.status.additions_blocked && (
                  <div className="rounded border border-amber-600/45 bg-amber-950/30 px-2 py-1.5 text-[10px] text-amber-100">
                    <div className="font-semibold">No additions until reconciled</div>
                    <div className="mt-0.5">{selectedDecisionReviews.status.addition_blockers.join(" ")}</div>
                  </div>
                )}
                {selectedDecisionReviews.status.warnings.length > 0 && (
                  <div className="rounded border border-rose-600/40 bg-rose-950/25 px-2 py-1.5 text-[10px] text-rose-100">
                    {selectedDecisionReviews.status.warnings.join(" ")}
                  </div>
                )}

                <details className="rounded border border-stealth-700/70 bg-stealth-950/30 px-2 py-1 text-[10px]">
                  <summary className="cursor-pointer text-stealth-400">
                    Immutable history · {selectedDecisionReviews.review_count} review{selectedDecisionReviews.review_count === 1 ? "" : "s"}
                  </summary>
                  <div className="mt-1.5 space-y-1.5 border-t border-stealth-800 pt-1.5">
                    {selectedDecisionReviews.history.map((review) => (
                      <div key={review.id} className="rounded border border-stealth-800 bg-stealth-950/45 px-2 py-1.5 text-stealth-300">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-stealth-100">
                            #{review.review_sequence} {formatDate(review.review_date)} · {decisionLabel(review.verdict)} to {review.target_contracts}
                          </span>
                          <span className="text-stealth-500">{review.snapshot.dte ?? "—"} DTE</span>
                        </div>
                        <div className="mt-0.5 text-stealth-500">
                          Thesis {decisionLabel(review.thesis_status)} · remaining {formatCurrency(review.snapshot.remaining_capital)} · P/L {formatCurrency(review.snapshot.pnl_dollar)}
                        </div>
                        {review.evidence_since_last && <div className="mt-0.5">{review.evidence_since_last}</div>}
                      </div>
                    ))}
                  </div>
                </details>
                </div>
              </details>
            ) : (
              <div className="mt-2 rounded-md border border-dashed border-stealth-700 px-2 py-1.5 text-[10px] leading-relaxed text-stealth-400">
                No confirmed review yet. Confirm the grade or record an override; neither action submits an order.
              </div>
            )}
          </div>
        )}

        {selected && (
          <button
            type="button"
            onClick={() => setShowRiskEvidence((current) => !current)}
            aria-expanded={showRiskEvidence}
            className="mb-2 flex w-full items-center justify-between gap-3 rounded-lg border border-stealth-700/70 bg-stealth-900/35 px-2.5 py-2 text-left transition hover:border-stealth-500"
          >
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-stealth-200">
                {showRiskEvidence ? "Hide market & risk evidence" : "Show market & risk evidence"}
              </div>
              <div className="mt-0.5 truncate text-[9px] text-stealth-500">
                Rank {selectedOpportunityRead?.label ?? "—"} · IV {formatPointChange(selected.metrics.volatility_signal?.trend.contract_iv_change, 1)} · quote {formatRelativeTime(selected.metrics.market.last_updated)}
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-stealth-400 transition-transform ${showRiskEvidence ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        )}

        {showRiskEvidence && (
          <>
        {selected && (
          <>
            {selected.metrics.opportunity ? (
              <div className="mb-2 rounded-md border border-gray-700/70 bg-gray-900/45 px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-gray-500">Opportunity Rank</div>
                    <div className="text-xs font-semibold text-gray-100">{selectedOpportunityRead?.label ?? "—"}</div>
                  </div>
                  <div className={`rounded-md border px-2 py-1 text-right text-xs font-semibold ${opportunityScoreClass(selected.metrics.opportunity.current?.score ?? selected.metrics.opportunity.entry?.score)}`}>
                    {selected.metrics.opportunity.score_change !== null && selected.metrics.opportunity.score_change !== undefined
                      ? formatSigned(selected.metrics.opportunity.score_change, 1)
                      : "—"}
                  </div>
                </div>
              </div>
            ) : null}
            <VolatilitySignalCard metrics={selected.metrics} className="mb-2" />
            <details className="mb-2 rounded-md border border-gray-700/70 bg-gray-900/45 px-2 py-1 text-[10px] text-gray-400">
              <summary className="cursor-pointer list-none truncate">
                Data: quote {formatRelativeTime(selected.metrics.market.last_updated)} / positions {formatRelativeTime(positionsLoadedAt)}
              </summary>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-gray-700/60 pt-1">
                <span>Model vol: {selected.metrics.volatility ? formatPercent(selected.metrics.volatility * 100, 1) : "n/a"}</span>
                <span>Model src: {selected.metrics.volatility_source || "n/a"}</span>
                <span>Bid / Ask: {selected.metrics.quote?.bid !== null && selected.metrics.quote?.bid !== undefined ? formatCurrency(selected.metrics.quote.bid, 2) : "n/a"} / {selected.metrics.quote?.ask !== null && selected.metrics.quote?.ask !== undefined ? formatCurrency(selected.metrics.quote.ask, 2) : "n/a"}</span>
                <span>Spread: {selected.metrics.quote?.spread_pct !== null && selected.metrics.quote?.spread_pct !== undefined ? formatPercent(selected.metrics.quote.spread_pct, 1) : "n/a"}</span>
                <span>Quote: {formatDataSource(selected.metrics.quote?.data_source, selected.metrics.quote?.quote_source)}</span>
                <span>Greeks: {formatRelativeTime(greeksLoadedAt)}</span>
              </div>
            </details>
          </>
        )}

        <div className="mb-2">
          {loadingGreeks ? (
            <div className="text-sm text-gray-400">Loading Greeks...</div>
          ) : greeksData && greeksData.price_curve.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              <div className="rounded-lg border border-gray-700 bg-gray-900 p-2">
                <h3 className="mb-1 text-[11px] font-semibold">Delta - directional exposure</h3>
                <div className="h-28" style={{ minWidth: 0, minHeight: 0 }}>
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={1}
                    minHeight={1}
                    initialDimension={{ width: 360, height: 112 }}
                  >
                    <LineChart data={greeksData.price_curve}>
                      <XAxis
                        dataKey="price"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        formatter={(value) => formatNumber(Number(value), 3)}
                        labelFormatter={(label) => `Price: $${label}`}
                        contentStyle={{
                          background: "#111827",
                          border: "1px solid #374151",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      {chartPriceDomain && selectedLossCut !== null && (
                        <ReferenceArea
                          x1={chartPriceDomain.min}
                          x2={selectedLossCut}
                          fill="#ef4444"
                          fillOpacity={0.1}
                        />
                      )}
                      {chartPriceDomain && selectedStrike !== null && (
                        <ReferenceArea
                          x1={selectedStrike}
                          x2={chartPriceDomain.max}
                          fill="#f59e0b"
                          fillOpacity={0.08}
                        />
                      )}
                      {chartPriceDomain && selectedProfitTake !== null && (
                        <ReferenceArea
                          x1={selectedProfitTake}
                          x2={chartPriceDomain.max}
                          fill="#22c55e"
                          fillOpacity={0.12}
                        />
                      )}
                      <ProjectionBezierOverlay
                        selectedSpotPrice={selectedSpotPrice}
                        chartPriceDomain={chartPriceDomain}
                        technicalStrength={technicalGap}
                        fundamentalStrength={fundamentalGap}
                      />
                      {selectedSpotPrice !== null && (
                        <ReferenceLine x={selectedSpotPrice} stroke="#7dd3fc" strokeDasharray="4 4" />
                      )}
                      {selectedStrike !== null && (
                        <ReferenceLine x={selectedStrike} stroke="#f59e0b" strokeDasharray="3 3" />
                      )}
                      <Line
                        type="monotone"
                        dataKey="delta"
                        stroke={getFamilyColor("equity")}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-gray-700 bg-gray-900 p-2">
                <h3 className="mb-1 text-[11px] font-semibold">Gamma - convexity</h3>
                <div className="h-28" style={{ minWidth: 0, minHeight: 0 }}>
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={1}
                    minHeight={1}
                    initialDimension={{ width: 360, height: 112 }}
                  >
                    <LineChart data={greeksData.price_curve}>
                      <XAxis
                        dataKey="price"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        formatter={(value) => formatNumber(Number(value), 4)}
                        labelFormatter={(label) => `Price: $${label}`}
                        contentStyle={{
                          background: "#111827",
                          border: "1px solid #374151",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      {chartPriceDomain && selectedLossCut !== null && (
                        <ReferenceArea
                          x1={chartPriceDomain.min}
                          x2={selectedLossCut}
                          fill="#ef4444"
                          fillOpacity={0.1}
                        />
                      )}
                      {chartPriceDomain && selectedStrike !== null && (
                        <ReferenceArea
                          x1={selectedStrike}
                          x2={chartPriceDomain.max}
                          fill="#f59e0b"
                          fillOpacity={0.08}
                        />
                      )}
                      {chartPriceDomain && selectedProfitTake !== null && (
                        <ReferenceArea
                          x1={selectedProfitTake}
                          x2={chartPriceDomain.max}
                          fill="#22c55e"
                          fillOpacity={0.12}
                        />
                      )}
                      <ProjectionBezierOverlay
                        selectedSpotPrice={selectedSpotPrice}
                        chartPriceDomain={chartPriceDomain}
                        technicalStrength={technicalGap}
                        fundamentalStrength={fundamentalGap}
                      />
                      {selectedSpotPrice !== null && (
                        <ReferenceLine x={selectedSpotPrice} stroke="#7dd3fc" strokeDasharray="4 4" />
                      )}
                      {selectedStrike !== null && (
                        <ReferenceLine x={selectedStrike} stroke="#f59e0b" strokeDasharray="3 3" />
                      )}
                      <Line
                        type="monotone"
                        dataKey="gamma"
                        stroke={getFamilyColor("growth")}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-gray-700 bg-gray-900 p-2">
                <h3 className="mb-1 text-[11px] font-semibold">Theta - daily decay</h3>
                <div className="h-24" style={{ minWidth: 0, minHeight: 0 }}>
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={1}
                    minHeight={1}
                    initialDimension={{ width: 360, height: 96 }}
                  >
                    <LineChart data={greeksData.theta_curve}>
                      <XAxis
                        dataKey="days"
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        formatter={(value) => formatNumber(Number(value), 4)}
                        labelFormatter={(label) => `${label} days to expiry`}
                        contentStyle={{
                          background: "#111827",
                          border: "1px solid #374151",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="theta"
                        stroke={getFamilyColor("sentiment")}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No Greeks data available for the selected position.</div>
          )}
        </div>

        {greeksData?.model_info && (
          <div className="mb-2 flex flex-wrap gap-1.5 text-[10px] text-gray-300">
            {greeksData.model_info.model && (
              <span className="rounded border border-gray-700/70 bg-gray-900/55 px-1.5 py-1">{greeksData.model_info.model}</span>
            )}
            {greeksData.model_info.volatility !== undefined && (
              <span className="rounded border border-gray-700/70 bg-gray-900/55 px-1.5 py-1">
                Vol {formatPercent(greeksData.model_info.volatility * 100, 1)}
              </span>
            )}
            {greeksData.model_info.dte !== undefined && (
              <span className="rounded border border-gray-700/70 bg-gray-900/55 px-1.5 py-1">DTE {greeksData.model_info.dte}</span>
            )}
            {selectedSpotPrice !== null && (
              <span className="rounded border border-gray-700/70 bg-gray-900/55 px-1.5 py-1">
                Spot {formatCurrency(selectedSpotPrice)}
              </span>
            )}
            {greeksData.model_info.risk_free_rate !== undefined && (
              <span className="rounded border border-gray-700/70 bg-gray-900/55 px-1.5 py-1">
                Rf {formatPercent(greeksData.model_info.risk_free_rate * 100, 2)}
              </span>
            )}
          </div>
        )}

        {greekSummary && (
          <div className="mb-2 rounded-lg border border-gray-700 bg-gray-900/60 p-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
              <div
                className={`text-xs font-semibold ${
                  greekSummary.tone === "bullish"
                    ? "text-emerald-300"
                    : greekSummary.tone === "bearish"
                      ? "text-rose-300"
                      : "text-gray-200"
                }`}
              >
                {capitalizeWord(greekSummary.tone)} / {greekSummary.thetaDirection}
              </div>
              <div className="flex flex-wrap gap-1 text-[10px]">
              <span
                className={`rounded-full border px-1.5 py-0.5 ${
                  greekSummary.tone === "bullish"
                    ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-200"
                    : greekSummary.tone === "bearish"
                      ? "border-rose-700/60 bg-rose-900/30 text-rose-200"
                      : "border-gray-700 bg-gray-800 text-gray-300"
                }`}
              >
                {greekSummary.tone}
              </span>
              <span
                className={`rounded-full border px-1.5 py-0.5 ${
                  greekSummary.thetaDirection === "decay"
                    ? "border-amber-700/60 bg-amber-900/30 text-amber-200"
                    : "border-emerald-700/60 bg-emerald-900/30 text-emerald-200"
                }`}
              >
                {greekSummary.thetaDirection}
              </span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {greekSummary.details.slice(0, 4).map((item) => (
                <div
                  key={item.label}
                  className="min-w-0 rounded-md border border-gray-700/70 bg-gray-900/40 px-2 py-1.5"
                >
                  <div className="truncate text-[9px] uppercase tracking-wide text-gray-500">{item.label}</div>
                  <div className="truncate text-xs font-semibold text-gray-100">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="mb-1 rounded-lg border border-gray-700/60 bg-gray-900/40 p-2.5">
            <div className="mb-1.5 text-[9px] uppercase tracking-wide text-gray-500">Visualization targets</div>
            <div className="grid grid-cols-3 gap-1.5">
              <label className="min-w-0 text-[10px] text-amber-300">
                Strike
                <input
                  type="number"
                  value={selected.position.strike}
                  readOnly
                  className="mt-1 w-full bg-gray-900 border border-amber-700/70 rounded px-2 py-1.5 text-xs text-amber-100"
                />
              </label>
              <label className="min-w-0 text-[10px] text-emerald-300">
                Profit Target
                <input
                  type="number"
                  step="0.01"
                  value={selectedZoneInputs?.profitTake ?? ""}
                  onChange={(event) =>
                    setZoneInputsByPosition((prev) => ({
                      ...prev,
                      [selected.position.id]: {
                        profitTake: event.target.value,
                        lossCut: prev[selected.position.id]?.lossCut ?? "",
                      },
                    }))
                  }
                  className="mt-1 w-full bg-gray-900 border border-emerald-700/70 rounded px-2 py-1.5 text-xs text-emerald-100"
                />
              </label>
              <label className="min-w-0 text-[10px] text-rose-300">
                Loss Threshold
                <input
                  type="number"
                  step="0.01"
                  value={selectedZoneInputs?.lossCut ?? ""}
                  onChange={(event) =>
                    setZoneInputsByPosition((prev) => ({
                      ...prev,
                      [selected.position.id]: {
                        profitTake: prev[selected.position.id]?.profitTake ?? "",
                        lossCut: event.target.value,
                      },
                    }))
                  }
                  className="mt-1 w-full bg-gray-900 border border-rose-700/70 rounded px-2 py-1.5 text-xs text-rose-100"
                />
              </label>
            </div>
          </div>
        )}

          </>
        )}

      </div>
      {optionalityClustersCard}
        </aside>
      </div>

      {selectedScannerHit && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-stretch justify-center overflow-x-hidden overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setExpandedScannerHitId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scanner-hit-detail-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-stealth-700 bg-stealth-950 shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-stealth-800 bg-stealth-950/95 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Scanner hit detail</div>
                <h2 id="scanner-hit-detail-title" className="mt-0.5 truncate text-lg font-semibold text-stealth-100">
                  {selectedScannerHit.symbol}
                </h2>
                <div className="mt-0.5 break-words text-xs text-stealth-400">
                  {selectedScannerHit.group} · {selectedScannerHitContractLabel}
                </div>
                {selectedScannerHitPositionMatch ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      aria-label={selectedScannerHitPositionMatch.accessibleLabel}
                      title={selectedScannerHitPositionMatch.accessibleLabel}
                      className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${scannerPositionMatchBadgeClass[selectedScannerHitPositionMatch.tone]}`}
                    >
                      {selectedScannerHitPositionMatch.badgeLabel}
                    </span>
                    <span className={`text-[10px] ${scannerPositionMatchTextClass[selectedScannerHitPositionMatch.tone]}`}>
                      {selectedScannerHitPositionMatch.classificationLabel}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <div className={`rounded-md border px-2 py-1 text-sm font-semibold ${opportunityScoreClass(selectedScannerHit.score)}`}>
                  {compactOpportunityGrade(selectedScannerHit.score, selectedScannerHit.grade)}
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedScannerHitId(null)}
                  aria-label="Close scanner hit details"
                  className="rounded-md border border-stealth-700 bg-stealth-900 px-2 py-1 text-sm text-stealth-300 transition hover:border-stealth-500 hover:text-stealth-100"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="min-h-0 overflow-x-hidden overflow-y-auto">
              <ScannerHitDetail opportunity={selectedScannerHit} />
            </div>
          </div>
        </div>
      )}

      {showDecisionReviewModal && selected && renderModal(
        <div
          className="fixed inset-0 z-[60] flex min-h-[100dvh] items-stretch justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={closeDecisionReviewModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-review-title"
            className={`flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-xl border border-stealth-700 bg-stealth-950 shadow-2xl sm:max-h-[calc(100dvh-2rem)] ${decisionReviewMode === "window" ? "max-w-3xl" : "max-w-5xl"}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-stealth-800 px-4 py-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-300">Append-only decision journal</div>
                <h2 id="decision-review-title" className="mt-0.5 text-lg font-semibold text-stealth-100">
                  {decisionReviewMode === "window"
                    ? "Revise decision window"
                    : selectedDecisionReviews?.latest_review
                      ? "Override current grade"
                      : "Capture mandate and decision"} · {selected.position.symbol} {selected.position.option_type.toUpperCase()} ${formatNumber(selected.position.strike, 2)}
                </h2>
                <p className="mt-1 max-w-3xl text-xs text-stealth-400">
                  {decisionReviewMode === "window"
                    ? "Change the process clock or evidence deadline without rewriting the previous review. You can explicitly apply the latest suggested dates below."
                    : "Change only what the automatic grade missed. The recommendation, your override, and every prior version remain visible."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDecisionReviewModal}
                className="rounded-md border border-stealth-700 bg-stealth-900 px-2 py-1 text-sm text-stealth-300 hover:text-stealth-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDecisionReview} className="min-h-0 overflow-y-auto px-4 py-3">
              {decisionReviewError && (
                <div className="mb-3 rounded-md border border-rose-600/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
                  {decisionReviewError}
                </div>
              )}

              {decisionReviewMode === "window" ? (
                <div className="space-y-3">
                  <section className="rounded-lg border border-stealth-700/70 bg-stealth-900/30 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-stealth-500">Decision stays intact</div>
                        <div className="mt-1 text-base font-semibold text-stealth-100">
                          {decisionLabel(decisionReviewForm.verdict)} to {decisionReviewForm.target_contracts || selected.position.contracts}
                        </div>
                        <div className="mt-1 text-[11px] text-stealth-400">
                          This creates a new journal entry for the clocks and conditions below. It does not edit the prior record or submit an order.
                        </div>
                      </div>
                      <div className="rounded-md border border-stealth-700 bg-stealth-950/45 px-2.5 py-1.5 text-right text-[10px] text-stealth-400">
                        {decisionLabel(decisionReviewForm.quality)} quality<br />
                        {decisionLabel(decisionReviewForm.confidence)} confidence
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-amber-700/35 bg-amber-950/15 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-amber-100">Latest suggested window</h3>
                        <p className="mt-1 text-[11px] text-stealth-400">
                          Review {selectedThesisAssessment?.suggested_window.next_review_date ? formatDate(selectedThesisAssessment.suggested_window.next_review_date) : "not required"}
                          {" · "}
                          maximum hold {selectedThesisAssessment?.suggested_window.decision_deadline ? formatDate(selectedThesisAssessment.suggested_window.decision_deadline) : "not set"}
                        </p>
                        {selectedThesisAssessment?.suggested_window && (
                          <p className="mt-1 max-w-xl text-[10px] text-stealth-500">
                            {selectedThesisAssessment.suggested_window.max_hold_sessions} session max, bounded by the original {selectedThesisAssessment.suggested_window.original_min_hold_days}-{selectedThesisAssessment.suggested_window.original_max_hold_days} session model.
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={!selectedThesisAssessment?.assessment}
                        onClick={applySuggestedDecisionWindow}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-600/50 bg-amber-900/35 px-2.5 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-800/45 disabled:opacity-50"
                      >
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                        Apply suggested dates
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-amber-900/40 pt-3 md:grid-cols-2">
                      <label className="text-xs text-stealth-400">
                        Next review · process clock
                        <input type="date" min={tomorrowInputValue()} value={decisionReviewForm.next_review_date} onChange={handleDecisionReviewFieldChange("next_review_date")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                      </label>
                      <label className="text-xs text-stealth-400">
                        Decision deadline · maximum hold
                        <input
                          type="date"
                          min={
                            ["close", "replacement_candidate"].includes(decisionReviewForm.verdict)
                              ? decisionReviewForm.review_date
                              : decisionReviewForm.next_review_date || tomorrowInputValue()
                          }
                          max={
                            ["close", "replacement_candidate"].includes(decisionReviewForm.verdict)
                              ? undefined
                              : selected.position.expiration
                          }
                          value={decisionReviewForm.decision_deadline}
                          onChange={handleDecisionReviewFieldChange("decision_deadline")}
                          className="mt-1 w-full rounded border border-amber-800/70 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100"
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs text-stealth-400">
                      Continue only if
                      <textarea rows={3} value={decisionReviewForm.continuation_condition} onChange={handleDecisionReviewFieldChange("continuation_condition")} placeholder="What evidence must remain true through this window?" className="mt-1 w-full rounded border border-sky-800/70 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                  </section>

                  <section className="rounded-lg border border-stealth-800 bg-stealth-900/30 p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="text-xs text-stealth-400">
                        What changed?
                        <textarea rows={3} value={decisionReviewForm.evidence_since_last} onChange={handleDecisionReviewFieldChange("evidence_since_last")} placeholder="Why should the window move now?" className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                      </label>
                      <label className="text-xs text-stealth-400">
                        Window notes
                        <textarea rows={3} value={decisionReviewForm.decision_notes} onChange={handleDecisionReviewFieldChange("decision_notes")} placeholder="Timing assumptions, event dates, or conscious delay." className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                      </label>
                    </div>
                  </section>
                </div>
              ) : (
              <div className="space-y-4">
                {selectedThesisAssessment?.assessment && (
                  <section className="rounded-lg border border-sky-700/45 bg-sky-950/20 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-300">System recommendation</div>
                        <div className="mt-1 text-lg font-semibold text-stealth-100">
                          {decisionLabel(selectedThesisAssessment.assessment.proposed_verdict)} to {selectedThesisAssessment.assessment.proposed_target_contracts} contract{selectedThesisAssessment.assessment.proposed_target_contracts === 1 ? "" : "s"}
                        </div>
                        <div className="mt-1 text-xs text-stealth-400">
                          {selectedThesisAssessment.assessment.reasons.join(" ")}
                        </div>
                      </div>
                      <div className="rounded border border-stealth-700 bg-stealth-950/45 px-2 py-1 text-right text-[10px] text-stealth-400">
                        {decisionLabel(selectedThesisAssessment.assessment.quality)} · {decisionLabel(selectedThesisAssessment.assessment.urgency)} urgency<br />
                        {decisionLabel(selectedThesisAssessment.assessment.confidence)} confidence
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-stealth-500">Saving records a decision; it does not create, stage, or send an order.</div>
                  </section>
                )}

                <details className="rounded-lg border border-stealth-800 bg-stealth-900/30 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-stealth-100">
                    Advanced mandate and generated thresholds
                    <span className="ml-2 text-[10px] font-normal text-stealth-500">Review only if the reconstructed context is wrong</span>
                  </summary>
                  <div className="mt-3 border-t border-stealth-800 pt-3">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-stealth-100">Mandate</h3>
                    <p className="text-[11px] text-stealth-500">What was this trade supposed to accomplish? Carry these fields forward unless the mandate itself changed.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="text-xs text-stealth-400">
                      Review date
                      <input type="date" required value={decisionReviewForm.review_date} onChange={handleDecisionReviewFieldChange("review_date")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Trade role
                      <select value={decisionReviewForm.trade_role} onChange={handleDecisionReviewFieldChange("trade_role")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100">
                        <option value="unclassified">Unclassified / imported</option>
                        <option value="catalyst">Catalyst</option>
                        <option value="trend">Trend</option>
                        <option value="mean_reversion">Mean reversion</option>
                        <option value="long_term_thesis">Long-term thesis</option>
                        <option value="hedge">Hedge</option>
                        <option value="income">Income</option>
                      </select>
                    </label>
                    <label className="text-xs text-stealth-400">
                      Risk budget ($ premium at risk)
                      <input type="number" min="0.01" step="0.01" value={decisionReviewForm.risk_budget} onChange={handleDecisionReviewFieldChange("risk_budget")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="text-xs text-stealth-400">
                      Original underlying thesis
                      <textarea rows={3} value={decisionReviewForm.original_thesis} onChange={handleDecisionReviewFieldChange("original_thesis")} placeholder="Why should the underlying move?" className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Exact contract thesis
                      <textarea rows={3} value={decisionReviewForm.contract_thesis} onChange={handleDecisionReviewFieldChange("contract_thesis")} placeholder="Why this strike, expiration, and size?" className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Expected path
                      <textarea rows={2} value={decisionReviewForm.expected_path} onChange={handleDecisionReviewFieldChange("expected_path")} placeholder="What should happen along the way, and how quickly?" className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Catalyst or milestone
                      <textarea rows={2} value={decisionReviewForm.catalyst} onChange={handleDecisionReviewFieldChange("catalyst")} placeholder="Earnings, breakout, ruling, launch..." className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Confirmation condition
                      <textarea rows={2} value={decisionReviewForm.confirmation_condition} onChange={handleDecisionReviewFieldChange("confirmation_condition")} placeholder="Observable evidence that the trade is progressing." className="mt-1 w-full rounded border border-emerald-800/70 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Invalidation condition
                      <textarea rows={2} value={decisionReviewForm.invalidation_condition} onChange={handleDecisionReviewFieldChange("invalidation_condition")} placeholder="Observable evidence that the idea is wrong." className="mt-1 w-full rounded border border-rose-800/70 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                  </div>
                  <label className="mt-3 block text-xs text-stealth-400">
                    Generated-threshold status
                    <select value={decisionReviewForm.threshold_approval_status} onChange={handleDecisionReviewFieldChange("threshold_approval_status")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100 md:max-w-sm">
                      <option value="draft">Keep as system draft</option>
                      <option value="approved">Approve as a monitoring rule</option>
                    </select>
                  </label>
                  </div>
                </details>

                <section className="rounded-lg border border-stealth-800 bg-stealth-900/30 p-3">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-stealth-100">2. Knowing what we know today</h3>
                    <p className="text-[11px] text-stealth-500">Separate the underlying thesis from whether this exact contract is still a good use of the remaining capital.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="text-xs text-stealth-400">
                      Thesis status
                      <select value={decisionReviewForm.thesis_status} onChange={handleDecisionReviewFieldChange("thesis_status")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100">
                        <option value="unassessed">Unassessed</option>
                        <option value="strengthened">Strengthened</option>
                        <option value="intact">Intact</option>
                        <option value="weakened">Weakened</option>
                        <option value="broken">Broken</option>
                        <option value="no_longer_relevant">No longer relevant</option>
                      </select>
                    </label>
                    <label className="text-xs text-stealth-400 md:col-span-2">
                      Would you open this exact contract today?
                      <select value={decisionReviewForm.fresh_entry_answer} onChange={handleDecisionReviewFieldChange("fresh_entry_answer")} className="mt-1 w-full rounded border border-sky-800/70 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100">
                        <option value="unassessed">Unassessed</option>
                        <option value="yes">Yes, without qualification</option>
                        <option value="yes_smaller">Yes, but smaller</option>
                        <option value="conditional">Yes, only if a condition occurs soon</option>
                        <option value="no_underlying_valid">No, but the underlying thesis remains valid</option>
                        <option value="no_thesis_invalid">No, because the thesis is invalid</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="text-xs text-stealth-400 md:col-span-2">
                      What changed since the last review?
                      <textarea rows={3} value={decisionReviewForm.evidence_since_last} onChange={handleDecisionReviewFieldChange("evidence_since_last")} placeholder="Evidence, not just price movement." className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Portfolio fit
                      <textarea rows={3} value={decisionReviewForm.portfolio_fit} onChange={handleDecisionReviewFieldChange("portfolio_fit")} placeholder="Direction, strategy, expiry, sector, shared catalysts." className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400 md:col-span-3">
                      Data quality or missing context
                      <textarea rows={2} value={decisionReviewForm.data_quality_notes} onChange={handleDecisionReviewFieldChange("data_quality_notes")} placeholder="Stale quote, wide spread, unmatched lot, uncertain event details..." className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                  </div>
                </section>

                <section className="rounded-lg border border-stealth-800 bg-stealth-900/30 p-3">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-stealth-100">3. Decision and the next two clocks</h3>
                    <p className="text-[11px] text-stealth-500">Review date is a process reminder. Decision deadline is when specified evidence must exist.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                    <label className="text-xs text-stealth-400 md:col-span-2">
                      Verdict
                      <select value={decisionReviewForm.verdict} onChange={handleDecisionReviewFieldChange("verdict")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100">
                        <option value="manual_review">Manual review / no verdict</option>
                        <option value="hold">Hold</option>
                        <option value="conditional_hold">Conditional hold</option>
                        <option value="reduce">Reduce</option>
                        <option value="close">Close</option>
                        <option value="replacement_candidate">Close; evaluate replacement separately</option>
                        <option value="add_eligible">Add-eligible</option>
                      </select>
                    </label>
                    <label className="text-xs text-stealth-400">
                      Target contracts
                      <input type="number" min="0" step="1" required value={decisionReviewForm.target_contracts} onChange={handleDecisionReviewFieldChange("target_contracts")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Quality
                      <select value={decisionReviewForm.quality} onChange={handleDecisionReviewFieldChange("quality")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100">
                        <option value="unrated">Unrated</option><option value="green">Green</option><option value="yellow">Yellow</option><option value="red">Red</option>
                      </select>
                    </label>
                    <label className="text-xs text-stealth-400">
                      Urgency
                      <select value={decisionReviewForm.urgency} onChange={handleDecisionReviewFieldChange("urgency")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100">
                        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                      </select>
                    </label>
                    <label className="text-xs text-stealth-400">
                      Confidence
                      <select value={decisionReviewForm.confidence} onChange={handleDecisionReviewFieldChange("confidence")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100">
                        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="text-xs text-stealth-400">
                      Next review date · process clock
                      <input type="date" min={tomorrowInputValue()} value={decisionReviewForm.next_review_date} onChange={handleDecisionReviewFieldChange("next_review_date")} className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400">
                      Decision deadline · maximum hold
                      <input
                        type="date"
                        min={
                          ["close", "replacement_candidate"].includes(decisionReviewForm.verdict)
                            ? decisionReviewForm.review_date
                            : decisionReviewForm.next_review_date || tomorrowInputValue()
                        }
                        max={
                          ["close", "replacement_candidate"].includes(decisionReviewForm.verdict)
                            ? undefined
                            : selected.position.expiration
                        }
                        value={decisionReviewForm.decision_deadline}
                        onChange={handleDecisionReviewFieldChange("decision_deadline")}
                        className="mt-1 w-full rounded border border-amber-800/70 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100"
                      />
                    </label>
                    <label className="text-xs text-stealth-400 md:col-span-2">
                      Continue only if
                      <textarea rows={2} value={decisionReviewForm.continuation_condition} onChange={handleDecisionReviewFieldChange("continuation_condition")} placeholder="Hold while A remains true; require B by the deadline; re-evaluate if D occurs." className="mt-1 w-full rounded border border-sky-800/70 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400 md:col-span-2">
                      Decision notes
                      <textarea rows={2} value={decisionReviewForm.decision_notes} onChange={handleDecisionReviewFieldChange("decision_notes")} placeholder="Execution plan, limit-order notes, uncertainties, or conscious override." className="mt-1 w-full rounded border border-stealth-700 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                    <label className="text-xs text-stealth-400 md:col-span-2">
                      Why override the system? <span className="text-stealth-600">Recommended when you change its verdict or size</span>
                      <textarea rows={2} value={decisionReviewForm.override_reason} onChange={handleDecisionReviewFieldChange("override_reason")} placeholder="What evidence or context does the automatic grade miss?" className="mt-1 w-full rounded border border-amber-800/60 bg-stealth-950 px-2.5 py-2 text-sm text-stealth-100" />
                    </label>
                  </div>
                </section>
              </div>
              )}

              <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t border-stealth-800 bg-stealth-950/95 py-3">
                <div className="text-[11px] text-stealth-500">
                  {decisionReviewMode === "window"
                    ? "Saving appends a new window version and captures a fresh market snapshot."
                    : "A fresh quote, Greeks, P/L, DTE, and remaining-capital snapshot will be captured on save."}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={closeDecisionReviewModal} className="rounded-md px-3 py-2 text-sm text-stealth-400 hover:text-stealth-100">Cancel</button>
                  <button type="submit" disabled={decisionReviewSubmitting} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:bg-stealth-700">
                    {decisionReviewSubmitting
                      ? "Recording..."
                      : decisionReviewMode === "window"
                        ? "Append revised window"
                        : "Record override"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Trade Modal */}
      {showAddModal && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
          onClick={closeTradeModal}
        >
          <div
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">
                {editingPositionId ? "Edit Trade" : "Add New Trade"}
              </h2>
              <button
                onClick={closeTradeModal}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            
            {formError && (
              <div className="bg-red-900/20 border border-red-700 text-red-300 text-xs rounded-lg p-2 mb-4">
                {formError}
              </div>
            )}

            <form
              onSubmit={editingPositionId ? handleUpdatePosition : handleCreatePosition}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-xs text-gray-400">
                  Trade Date *
                  <input
                    type="date"
                    value={formData.trade_date}
                    onChange={handleFieldChange("trade_date")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>
                
                <label className="text-xs text-gray-400">
                  Symbol *
                  <input
                    type="text"
                    value={formData.symbol}
                    onChange={handleFieldChange("symbol")}
                    placeholder="AAPL"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 uppercase"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Expiration *
                  <input
                    type="date"
                    value={formData.expiration}
                    onChange={handleFieldChange("expiration")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Strike *
                  <input
                    type="number"
                    step="0.01"
                    value={formData.strike}
                    onChange={handleFieldChange("strike")}
                    placeholder="100.00"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Type *
                  <select
                    value={formData.option_type}
                    onChange={handleFieldChange("option_type")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                </label>

                <label className="text-xs text-gray-400">
                  Contracts *
                  <input
                    type="number"
                    value={formData.contracts}
                    onChange={handleFieldChange("contracts")}
                    placeholder="1"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Fill Price *
                  <input
                    type="number"
                    step="0.01"
                    value={formData.fill_price}
                    onChange={handleFieldChange("fill_price")}
                    placeholder="5.00"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Total Cost *
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total_cost}
                    onChange={handleFieldChange("total_cost")}
                    placeholder="503.37"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Underlying at Entry
                  <input
                    type="number"
                    step="0.01"
                    value={formData.underlying_at_entry}
                    onChange={handleFieldChange("underlying_at_entry")}
                    placeholder="95.50"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Account
                  <input
                    type="text"
                    value={formData.account}
                    onChange={handleFieldChange("account")}
                    placeholder="Active Trading"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={closeTradeModal}
                  className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  {submitting
                    ? editingPositionId
                      ? "Saving..."
                      : "Adding..."
                    : editingPositionId
                      ? "Save Changes"
                      : "Add Trade"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Position Modal */}
      {showCloseModal && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
          onClick={() => {
            setShowCloseModal(false);
            setExitPrice("");
            setCloseNotes("");
            setClosingPositionId(null);
          }}
        >
          <div
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Close Position</h2>
              <button
                onClick={() => {
                  setShowCloseModal(false);
                  setExitPrice("");
                  setCloseNotes("");
                  setClosingPositionId(null);
                }}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <label className="block text-sm text-gray-400">
                Exit Price (per contract) *
                <input
                  type="number"
                  step="0.01"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  placeholder="5.50"
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  required
                />
              </label>

              <label className="block text-sm text-gray-400">
                Notes (optional)
                <textarea
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Reason for closing..."
                  rows={3}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowCloseModal(false);
                    setExitPrice("");
                    setCloseNotes("");
                    setClosingPositionId(null);
                  }}
                  className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClosePosition}
                  disabled={closingSubmitting}
                  className="bg-rose-700 hover:bg-rose-600 disabled:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  {closingSubmitting ? "Closing..." : "Close Position"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Closed Position Modal */}
      {showClosedEditModal && renderModal(
        <div
          className="fixed inset-0 z-[60] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/75 backdrop-blur-sm p-4"
          onClick={closeClosedEditModal}
        >
          <div
            className="w-full max-w-3xl rounded-lg border border-gray-700 bg-gray-800 p-6 max-h-[90dvh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Edit Closed Trade</h2>
              <button
                onClick={closeClosedEditModal}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            {closedFormError && (
              <div className="mb-4 rounded-md border border-rose-600/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
                {closedFormError}
              </div>
            )}

            <form onSubmit={handleUpdateClosedPosition} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="text-xs text-gray-400">
                  Trade Date *
                  <input
                    type="date"
                    value={closedFormData.trade_date}
                    onChange={handleClosedFieldChange("trade_date")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Close Date *
                  <input
                    type="date"
                    value={closedFormData.close_date}
                    onChange={handleClosedFieldChange("close_date")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Account
                  <input
                    type="text"
                    value={closedFormData.account}
                    onChange={handleClosedFieldChange("account")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Symbol *
                  <input
                    type="text"
                    value={closedFormData.symbol}
                    onChange={handleClosedFieldChange("symbol")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm uppercase text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Expiration *
                  <input
                    type="date"
                    value={closedFormData.expiration}
                    onChange={handleClosedFieldChange("expiration")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Type *
                  <select
                    value={closedFormData.option_type}
                    onChange={handleClosedFieldChange("option_type")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                </label>

                <label className="text-xs text-gray-400">
                  Contracts *
                  <input
                    type="number"
                    min="1"
                    value={closedFormData.contracts}
                    onChange={handleClosedFieldChange("contracts")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Strike *
                  <input
                    type="number"
                    step="0.01"
                    value={closedFormData.strike}
                    onChange={handleClosedFieldChange("strike")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Total Cost *
                  <input
                    type="number"
                    step="0.01"
                    value={closedFormData.total_cost}
                    onChange={handleClosedFieldChange("total_cost")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Entry Price *
                  <input
                    type="number"
                    step="0.01"
                    value={closedFormData.fill_price}
                    onChange={handleClosedFieldChange("fill_price")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Exit Price *
                  <input
                    type="number"
                    step="0.01"
                    value={closedFormData.exit_price}
                    onChange={handleClosedFieldChange("exit_price")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Underlying at Entry
                  <input
                    type="number"
                    step="0.01"
                    value={closedFormData.underlying_at_entry}
                    onChange={handleClosedFieldChange("underlying_at_entry")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Underlying at Exit
                  <input
                    type="number"
                    step="0.01"
                    value={closedFormData.underlying_at_exit}
                    onChange={handleClosedFieldChange("underlying_at_exit")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  />
                </label>
              </div>

              <label className="block text-xs text-gray-400">
                Notes
                <textarea
                  value={closedFormData.notes}
                  onChange={handleClosedFieldChange("notes")}
                  rows={3}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeClosedEditModal}
                  className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closedSubmitting}
                  className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  {closedSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* P/L History Modal */}
      {showClosedLog && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 p-4"
        >
          <div className="w-full max-w-5xl rounded-lg border border-gray-700 bg-gray-800 p-6 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Closed Positions History</h2>
              <button
                onClick={() => setShowClosedLog(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Tracked Closed Trades</div>
                <div className="text-base font-semibold text-gray-100">{closedTotals.totalTrades}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Win Rate</div>
                <div className="text-base font-semibold text-gray-100">{formatPercent(closedTotals.winRate, 1)}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Total Cost</div>
                <div className="text-base font-semibold text-gray-100">{formatCurrency(closedTotals.totalCost, 0)}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Total P&amp;L</div>
                <div
                  className={`text-base font-semibold ${
                    closedTotals.totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {formatCurrency(closedTotals.totalPnl, 0)}
                </div>
              </div>
            </div>

            {learningSummary && (
              <div className="mb-4 rounded-lg border border-violet-500/30 bg-violet-950/15 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">Closed-trade learning lab</div>
                    <div className="mt-1 text-sm font-semibold text-gray-100">
                      {learningSummary.sample.classified_trade_cycles} classified cycles · {learningSummary.sample.matured_decision_horizons} matured decision horizons
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      Leading lessons: {Object.entries(learningSummary.trade_outcomes.primary_lessons)
                        .sort((left, right) => right[1] - left[1])
                        .slice(0, 3)
                        .map(([label, count]) => `${decisionLabel(label)} (${count})`)
                        .join(" · ") || "collecting outcomes"}
                    </div>
                    {scannerRecurrenceLearning ? (
                      <div className="mt-1 text-[10px] text-violet-200/75">
                        {scannerRecurrenceLearning}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-md border border-violet-500/25 bg-gray-950/35 px-3 py-2 text-right text-[10px] text-gray-400">
                    Learned challenger: {decisionLabel(learningSummary.promotion_readiness.status)}<br />
                    {learningSummary.promotion_readiness.remaining_cycles} independent cycles until eligible
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-gray-500">
                  Time-ordered validation and manual promotion stay mandatory. Actual trades and modeled counterfactuals remain separate; automated execution is off.
                </div>
              </div>
            )}

            {sortedClosedRows.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No closed positions yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-gray-300">
                  <thead className="text-xs uppercase text-gray-500 border-b border-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "symbol",
                              direction: prev.key === "symbol" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Symbol / Rank {sortArrow(closedSort.key === "symbol", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "strike",
                              direction: prev.key === "strike" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Strike {sortArrow(closedSort.key === "strike", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "option_type",
                              direction: prev.key === "option_type" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Type {sortArrow(closedSort.key === "option_type", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "fill_price",
                              direction: prev.key === "fill_price" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Entry {sortArrow(closedSort.key === "fill_price", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "exit_price",
                              direction: prev.key === "exit_price" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Exit {sortArrow(closedSort.key === "exit_price", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "close_date",
                              direction: prev.key === "close_date" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Close Date {sortArrow(closedSort.key === "close_date", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "dollar_pnl",
                              direction: prev.key === "dollar_pnl" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          P&amp;L $ {sortArrow(closedSort.key === "dollar_pnl", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "percent_pnl",
                              direction: prev.key === "percent_pnl" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          P&amp;L % {sortArrow(closedSort.key === "percent_pnl", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">Notes</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {sortedClosedRows.map((pos) => {
                      const heat = attributionHeat(pos.source_event_id, pos.source_match_confidence);
                      const tooltip = buildAttributionTooltip(
                        pos.source_event_id,
                        pos.source_triggered_at,
                        pos.source_match_method,
                        pos.source_match_confidence,
                        pos.source_match_notes
                      );
                      return (
                      <tr key={pos.id} className={`${heat.rowTint} hover:bg-gray-900/40`}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              title={`${tooltip}\nLink quality: ${heat.quality}`}
                              className={`inline-block h-5 w-1.5 rounded-full ${heat.marker}`}
                            />
                            <span className="font-semibold">{pos.symbol}</span>
                            <OpportunityRankBadge
                              score={pos.source_opportunity_score}
                              grade={pos.source_opportunity_grade}
                              rankScore={pos.source_opportunity_rank_score}
                              modelVersion={pos.source_opportunity_model_version}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">${formatNumber(pos.strike, 2)}</td>
                        <td className="px-3 py-2 uppercase">{pos.option_type}</td>
                        <td className="px-3 py-2">${formatNumber(pos.fill_price, 2)}</td>
                        <td className="px-3 py-2">${formatNumber(pos.exit_price, 2)}</td>
                        <td className="px-3 py-2">{formatDate(pos.close_date)}</td>
                        <td
                          className={`px-3 py-2 font-semibold ${
                            pos.dollar_pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {formatCurrency(pos.dollar_pnl, 0)}
                        </td>
                        <td
                          className={`px-3 py-2 ${
                            pos.percent_pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {formatSigned(pos.percent_pnl, 1)}%
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-400">
                          <div>{pos.notes || "—"}</div>
                          {pos.learning_outcome && (
                            <div
                              className="mt-1 text-[10px] text-violet-300"
                              title={`Process: ${decisionLabel(pos.learning_outcome.process_quality)} · Contract: ${decisionLabel(pos.learning_outcome.contract_result)}`}
                            >
                              Learn: {decisionLabel(pos.learning_outcome.primary_lesson)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openClosedEditModal(pos)}
                              aria-label={`Edit closed ${pos.symbol} trade`}
                              title={`Edit ${pos.symbol}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-500/35 bg-sky-500/12 text-sky-200 transition hover:border-sky-300/70 hover:bg-sky-500/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-400/50"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClosedPosition(pos)}
                              aria-label={`Delete closed ${pos.symbol} trade`}
                              title={`Delete ${pos.symbol}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-500/35 bg-rose-500/12 text-rose-200 transition hover:border-rose-300/70 hover:bg-rose-500/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-400/50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-lg border border-indigo-500/20 bg-indigo-950/10 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-indigo-300">Scanner Outcomes</div>
                  <div className="text-xs text-gray-400">
                    Review historical training outcomes and prefill a trade template without crowding the portfolio summary.
                  </div>
                </div>
                <button
                  onClick={() => {
                    loadTrainingOutcomes();
                    setShowTrainingOutcomes(true);
                  }}
                  className="rounded-full border border-indigo-400/45 bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/30"
                >
                  Open Scanner Outcomes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scanner Training Outcomes Modal */}
      {showTrainingOutcomes && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowTrainingOutcomes(false)}
        >
          <div
            className="w-full max-w-6xl rounded-lg border border-gray-700 bg-gray-800 p-6 max-h-[90dvh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">Exceptional Scanner Training Outcomes</h2>
                <p className="text-xs text-gray-400 mt-1">
                  Backtest view of exceptional optionality setups held for their suggested window.
                </p>
              </div>
              <button
                onClick={() => setShowTrainingOutcomes(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Examples</div>
                <div className="text-base font-semibold text-gray-100">{trainingSummary?.sample_size ?? 0}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Matured</div>
                <div className="text-base font-semibold text-gray-100">{trainingSummary?.matured ?? 0}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Pending</div>
                <div className="text-base font-semibold text-gray-100">{trainingSummary?.pending ?? 0}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Win Rate</div>
                <div className="text-base font-semibold text-gray-100">
                  {trainingSummary?.win_rate_pct !== null && trainingSummary?.win_rate_pct !== undefined
                    ? formatPercent(trainingSummary.win_rate_pct, 1)
                    : "—"}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Avg Return</div>
                <div className={`text-base font-semibold ${(trainingSummary?.avg_option_return_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {trainingSummary?.avg_option_return_pct !== null && trainingSummary?.avg_option_return_pct !== undefined
                    ? formatSigned(trainingSummary.avg_option_return_pct, 1) + "%"
                    : "—"}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Total P/L (1 lot)</div>
                <div className={`text-base font-semibold ${(trainingSummary?.total_option_pnl_per_contract ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {trainingSummary?.total_option_pnl_per_contract !== null && trainingSummary?.total_option_pnl_per_contract !== undefined
                    ? formatCurrency(trainingSummary.total_option_pnl_per_contract, 0)
                    : "—"}
                </div>
              </div>
            </div>

            {opportunityBacktest ? (
              <div className="mb-4 rounded-lg border border-sky-500/20 bg-sky-950/10 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Your Trades vs Model Rank</div>
                    <div className="text-xs text-gray-400">
                      Closed linked trades filtered by current model threshold {opportunityBacktest.threshold.toFixed(0)} (C or better).
                    </div>
                  </div>
                  <div className="text-[10px] uppercase text-gray-500">{opportunityBacktest.model_version}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="rounded-md border border-gray-700/70 bg-gray-900/45 p-2">
                    <div className="text-[10px] text-gray-500">All linked</div>
                    <div className={`text-sm font-semibold ${(opportunityBacktest.summary.all_trades.total_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {formatCurrency(opportunityBacktest.summary.all_trades.total_pnl, 0)}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {opportunityBacktest.summary.all_trades.count} trades / {formatPercent(opportunityBacktest.summary.all_trades.win_rate_pct, 0)}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-700/70 bg-gray-900/45 p-2">
                    <div className="text-[10px] text-gray-500">Model selected</div>
                    <div className={`text-sm font-semibold ${(opportunityBacktest.summary.model_selected.total_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {formatCurrency(opportunityBacktest.summary.model_selected.total_pnl, 0)}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {opportunityBacktest.summary.model_selected.count} trades / {formatPercent(opportunityBacktest.summary.model_selected.win_rate_pct, 0)}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-700/70 bg-gray-900/45 p-2">
                    <div className="text-[10px] text-gray-500">Avg return delta</div>
                    <div className={`text-sm font-semibold ${(opportunityBacktest.summary.avg_percent_delta_vs_all ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {opportunityBacktest.summary.avg_percent_delta_vs_all !== null && opportunityBacktest.summary.avg_percent_delta_vs_all !== undefined
                        ? `${formatSigned(opportunityBacktest.summary.avg_percent_delta_vs_all, 1)}%`
                        : "—"}
                    </div>
                    <div className="text-[10px] text-gray-500">selected vs all linked</div>
                  </div>
                  <div className="rounded-md border border-gray-700/70 bg-gray-900/45 p-2">
                    <div className="text-[10px] text-gray-500">Excluded tradeoff</div>
                    <div className="text-sm font-semibold text-gray-100">
                      {formatCurrency(opportunityBacktest.summary.avoided_loss_from_excluded, 0)}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      avoided / {formatCurrency(opportunityBacktest.summary.excluded_winners_left_on_table, 0)} left
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {loadingTrainingOutcomes ? (
              <div className="text-sm text-gray-400 text-center py-8">Loading scanner outcomes...</div>
            ) : trainingOutcomes.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No exceptional scanner examples found in lookback window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-gray-300">
                  <thead className="text-xs uppercase text-gray-500 border-b border-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Symbol / Rank</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Window</th>
                      <th className="px-3 py-2 text-left">Entry</th>
                      <th className="px-3 py-2 text-left">Exit</th>
                      <th className="px-3 py-2 text-left">Underlying Dir %</th>
                      <th className="px-3 py-2 text-left">Entry Prem</th>
                      <th className="px-3 py-2 text-left">Exit Prem</th>
                      <th className="px-3 py-2 text-left">Option Return %</th>
                      <th className="px-3 py-2 text-left">P/L (1 contract)</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {trainingOutcomes.map((row) => (
                      <tr key={row.event_id} className="hover:bg-gray-900/40">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-100">{row.symbol}</span>
                            <OpportunityRankBadge
                              score={row.opportunity_score}
                              grade={row.opportunity_grade}
                              rankScore={row.opportunity_rank_score}
                              modelVersion={row.opportunity_model_version}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 uppercase">{row.option_type}</td>
                        <td className="px-3 py-2">
                          {row.review_min_hold_days && row.review_max_hold_days
                            ? `${row.review_min_hold_days}-${row.review_max_hold_days}d`
                            : `${row.hold_days}d`}
                        </td>
                        <td className="px-3 py-2">{formatDate(row.entry_date)}</td>
                        <td className="px-3 py-2">{row.exit_date ? formatDate(row.exit_date) : "—"}</td>
                        <td className={`px-3 py-2 ${(row.underlying_directional_return_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {row.underlying_directional_return_pct !== null && row.underlying_directional_return_pct !== undefined
                            ? `${formatSigned(row.underlying_directional_return_pct, 1)}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">{row.entry_option_price_est !== null && row.entry_option_price_est !== undefined ? formatCurrency(row.entry_option_price_est, 2) : "—"}</td>
                        <td className="px-3 py-2">{row.exit_option_price_est !== null && row.exit_option_price_est !== undefined ? formatCurrency(row.exit_option_price_est, 2) : "—"}</td>
                        <td className={`px-3 py-2 ${(row.option_return_pct_est ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {row.option_return_pct_est !== null && row.option_return_pct_est !== undefined
                            ? `${formatSigned(row.option_return_pct_est, 1)}%`
                            : "—"}
                        </td>
                        <td className={`px-3 py-2 ${(row.option_pnl_per_contract_est ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {row.option_pnl_per_contract_est !== null && row.option_pnl_per_contract_est !== undefined
                            ? formatCurrency(row.option_pnl_per_contract_est, 0)
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded px-2 py-1 text-xs font-semibold ${
                              row.status === "matured"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600/50"
                                : "bg-amber-500/20 text-amber-300 border border-amber-600/50"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
