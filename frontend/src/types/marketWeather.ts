export type MarketWeatherMode = "regime" | "convection" | "topographic" | "swami" | "inspector";
export type MarketWeatherTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1D" | "1W";
export type MarketWeatherLanguageView = "now" | "dictionary" | "methods";
export type MarketWeatherTimelineLens = "direction" | "structure" | "carriers" | "range" | "context";

export interface MarketWeatherPricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketWeatherSummary {
  regime: string;
  field_direction: number;
  horizon_alignment: number;
  coherence: number;
  entropy: number;
  permutation_entropy: number;
  reflectivity: number;
  convection: number;
  expansion: number;
  expansion_front: number | null;
}

export interface MarketWeatherProfileRow {
  horizon: number;
  pressure: number;
  confidence: number;
  coherence: number;
  entropy: number;
  permutation_entropy: number;
  expansion: number;
  convection: number;
}

export interface MarketWeatherDerivativePoint {
  date: string;
  pressure: number;
  velocity: number;
  acceleration: number;
  jerk: number;
  snap: number;
}

export interface MarketWeatherStrataPoint {
  date: string;
  structure: number;
  kinematics: number;
  geometry: number;
  information: number;
  propagation: number;
  cascade_bias: number;
  scaling_exponent: number;
}

export interface MarketWeatherStrataLatest {
  structure: number;
  kinematics: number;
  geometry: number;
  information: number;
  propagation: number;
  cascade_bias: number;
  scaling_exponent: number;
}

export interface MarketWeatherStructureComponentPoint {
  date: string;
  activity: number;
  horizon_agreement: number;
  trend_agreement_composite: number;
  display_organization: number;
}

export interface MarketWeatherStructureComponents {
  latest: Omit<MarketWeatherStructureComponentPoint, "date">;
  series: MarketWeatherStructureComponentPoint[];
  weights: {
    activity: number;
    horizon_agreement: number;
  };
  flat_field_reference: {
    trend_agreement_composite: number;
    display_organization: number;
  };
  changes_v1_state_vector: false;
}

export interface MarketWeatherScalingReference {
  stationary_finite_variance_reference: number;
  latest_exponent: number | null;
  latest_excess: number | null;
  valid: boolean;
  reason: string | null;
  series?: Array<{
    date: string;
    exponent: number | null;
    reference: number;
    excess: number | null;
    valid: boolean;
    reason: string | null;
  }>;
  reference_scope?: string;
  exact_arithmetic_contract?: {
    nonnegative: true;
    floating_point_tolerance: number;
    defensive_storage_bounds: [number, number] | number[];
    violation_status: "invalid" | string;
    note?: string;
  };
}

export interface MarketWeatherCarrierPoint {
  date: string;
  price_structure: number;
  realized_volatility: number;
  participation: number;
  liquidity_stress: number;
}

export type MarketWeatherCarrierLatest = Omit<MarketWeatherCarrierPoint, "date">;

export interface MarketWeatherTechnicalContextPoint {
  date: string;
  close: number | null;
  support20: number | null;
  resistance20: number | null;
  atr14: number | null;
  range_position20: number | null;
  support_distance_atr: number | null;
  resistance_distance_atr: number | null;
  trend_gap20_pct: number | null;
  return_5bar_pct: number | null;
  state: "warming_up" | "breakout" | "breakdown" | "upper_range" | "lower_range" | "mid_range";
}

export interface MarketWeatherContextRelationship {
  id: string;
  label: string;
  family: string;
  source: string;
  level_label: string;
  unit: string;
  current_value: number | null;
  current_pressure_change: number | null;
  as_of: string | null;
  freshness: "fresh" | "stale" | "unavailable";
  freshness_days: number;
  age_days: number | null;
  source_observations: number;
  coverage_start: string | null;
  coverage_end: string | null;
  selected_lag_days: number | null;
  calibration_rho: number | null;
  calibration_observations: number;
  holdout_rho: number | null;
  holdout_p_value: number | null;
  holdout_q_value: number | null;
  holdout_observations: number;
  status: "persistent" | "directionally_consistent" | "unstable" | "insufficient";
  interpretation: string;
  rolling_association: Array<{ date: string; rho: number }>;
  input_definition: string;
}

export interface MarketWeatherContext {
  version: string;
  generated_at?: string;
  mode: "shadow_only";
  field_influence: "none";
  description: string;
  error?: string;
  technical?: {
    available: boolean;
    method: string;
    series: MarketWeatherTechnicalContextPoint[];
    latest: MarketWeatherTechnicalContextPoint | null;
  };
  optionality?: {
    available: boolean;
    as_of?: string | null;
    age_hours?: number | null;
    freshness?: "fresh" | "stale" | "unavailable";
    history_mode: string;
    history_note?: string;
    iv30_pct?: number | null;
    hv30_pct?: number | null;
    iv_hv_spread_points?: number | null;
    iv_cross_section_percentile_pct?: number | null;
    avg_extrinsic_share_pct?: number | null;
    relative_richness_state?: "implied_below_realized" | "implied_above_realized" | "near_realized" | "unavailable";
    data_source?: string | null;
    quote_source?: string | null;
    scanner_evidence?: {
      latest_event_at: string | null;
      events: number;
      coverage_start: string | null;
      opportunity_score: number | null;
      opportunity_grade: string | null;
      iv30_pct: number | null;
      hv30_pct: number | null;
      iv_cross_section_percentile_pct: number | null;
      selected_spread_pct: number | null;
      selected_open_interest: number | null;
      selected_volume: number | null;
    } | null;
  };
  cross_market?: {
    available: boolean;
    relationship_timeframe: "1D";
    target: string;
    window: {
      start: string | null;
      end: string | null;
      timezone: "UTC";
      source_carry_policy: "none";
    };
    input_polarity: string;
    candidate_lags_days: number[];
    selection: string;
    validation: string;
    rolling_window_observations: number;
    relationships: MarketWeatherContextRelationship[];
    warnings: string[];
  };
  promotion_rule?: string;
}

export interface MarketWeatherCarrierRatioPoint {
  date: string;
  realized_volatility: number | null;
  participation: number | null;
  liquidity_stress: number | null;
}

export type MarketWeatherCarrierRatioLatest = Omit<MarketWeatherCarrierRatioPoint, "date">;

export interface MarketWeatherRelationshipResult {
  id: string;
  label: string;
  hypothesis: string;
  outcome: string;
  forward_bars: number;
  sample_size: number;
  event_mean: number | null;
  baseline_mean: number | null;
  uplift: number | null;
  event_hit_rate: number | null;
  baseline_hit_rate: number | null;
  status: string;
  method: string;
}

export interface MarketWeatherLexiconOutcome {
  forward_bars: number;
  sample_size: number;
  mean_return: number | null;
  median_return: number | null;
  positive_rate: number | null;
  mean_absolute_return: number | null;
}

export type MarketWeatherAnalogStatus =
  | "descriptive_reference_available"
  | "withheld_extreme_calibration_tail"
  | "insufficient_calibration_support";

export interface MarketWeatherLexiconArchetype {
  id: string;
  token: string;
  signature: string;
  centroid: Record<string, number>;
  window_frequency: number;
  frequency: number;
  typical_duration_bars: number;
  fit_count: number;
  calibration_count: number;
  evaluation_count: number;
  evaluation_outcome: MarketWeatherLexiconOutcome;
  evaluation_outcome_sampling: string;
}

export interface MarketWeatherLexiconSequencePoint {
  date: string;
  index: number;
  state_id: string;
  match: number;
  novelty: number;
  distance_tail_score: number | null;
  distance_tail_support: number;
  distance_tail_scope: "state_conditional" | "unavailable";
  outside_learned_range: boolean | null;
  nearest_form_distance?: number;
  resonance_index?: number;
  calibration_distance_tail_rank?: number | null;
  calibration_distance_percentile?: number | null;
  calibration_distance_support?: number;
  calibration_distance_scope?: "state_conditional" | "unavailable";
  in_extreme_calibration_distance_tail?: boolean | null;
  analog_status?: MarketWeatherAnalogStatus;
  transition_surprise: number;
}

export interface MarketWeatherLexiconMotif {
  id: string;
  states: string[];
  tokens: string[];
  glyph: string;
  length: number;
  count: number;
  typical_span_bars: number;
  current: boolean;
  outcome: MarketWeatherLexiconOutcome;
  outcome_anchor: "entry_into_final_form";
}

export interface MarketWeatherLexicon {
  model: string;
  version: string;
  description: string;
  training_split: {
    method: string;
    archetype_count: number;
    maximum_archetypes: number;
    minimum_form_support: number;
    fit_mean_silhouette?: number;
    minimum_mean_silhouette?: number;
    requested_warmup_bars: number;
    fit_start_index: number;
    fit_start: string;
    fit_end_index: number;
    fit_end: string;
    fit_bars: number;
    warmup_complete: boolean;
    calibration_start_index: number;
    calibration_start: string;
    calibration_bars: number;
    evaluation_bars: number;
    evaluation_bars_total?: number;
    calibration_end: string;
    evaluation_start_index: number;
    evaluation_start: string;
    calibration_independent_from_fit: boolean;
    evaluation_outcomes_used_for_training: boolean;
    visible_evaluation_start?: string | null;
    sequence_scope?: "visible_response_window";
  };
  features: Array<{
    id: string;
    family: string;
    distance_weight: number;
    calibration_median: number;
    calibration_robust_scale: number;
  }>;
  distance_metric: {
    method: string;
    family_weights: Record<string, number>;
    signature_version: string;
    signature_quantization: string;
    outside_range_rule?: string;
    outside_range_cutoff?: number;
    minimum_distance_tail_support?: number;
    distance_tail_interpretation?: string;
    canonical_tail_name?: string;
    legacy_tail_aliases?: string[];
    terminology_revision?: string;
    calibration_tail_rule?: string;
    calibration_tail_cutoff?: number;
    resonance_interpretation?: string;
    deprecated_aliases?: Record<string, string>;
    coverage_guarantee?: boolean;
    dependence_caveat?: string;
  };
  archetypes: MarketWeatherLexiconArchetype[];
  evaluation_sequence: MarketWeatherLexiconSequencePoint[];
  current: {
    state_id: string;
    token: string;
    signature: string;
    match: number;
    novelty: number;
    distance_tail_score: number | null;
    distance_tail_support: number;
    distance_tail_scope: "state_conditional" | "unavailable";
    outside_learned_range: boolean | null;
    nearest_form_distance?: number;
    resonance_index?: number;
    calibration_distance_tail_rank?: number | null;
    calibration_distance_percentile?: number | null;
    calibration_distance_support?: number;
    calibration_distance_scope?: "state_conditional" | "unavailable";
    in_extreme_calibration_distance_tail?: boolean | null;
    analog_status?: MarketWeatherAnalogStatus;
    age_bars: number;
    age_truncated?: boolean;
    transition_surprise: number;
    transition_in_visible_window?: boolean;
  };
  grammar: {
    training: string;
    smoothing: number;
    minimum_transition_support: number;
    state_ids: string[];
    counts: number[][];
    probabilities: number[][];
    likely_next: Array<{
      from_state: string;
      to_state: string | null;
      to_token: string | null;
      probability: number | null;
      support: number;
      ambiguous: boolean;
      reliable: boolean;
    }>;
  };
  motifs: MarketWeatherLexiconMotif[];
  motif_note: string;
}

export interface MarketWeatherResearch {
  model?: string;
  semantic_revision?: string;
  coordinate?: Record<string, string>;
  definitions: Record<string, string>;
  derivative_series: MarketWeatherDerivativePoint[];
  strata: {
    latest: MarketWeatherStrataLatest;
    series: MarketWeatherStrataPoint[];
  };
  structure_components?: MarketWeatherStructureComponents;
  scaling_reference?: MarketWeatherScalingReference;
  carriers?: {
    latest: MarketWeatherCarrierLatest;
    series: MarketWeatherCarrierPoint[];
    availability?: {
      realized_volatility: boolean;
      participation: boolean;
      liquidity_stress: boolean;
      positive_volume_observations: number;
    };
    ratios?: {
      latest: MarketWeatherCarrierRatioLatest;
      series: MarketWeatherCarrierRatioPoint[];
      baseline: string;
    };
  };
  relationship_atlas: MarketWeatherRelationshipResult[];
  lexicon?: MarketWeatherLexicon;
  validation?: {
    design: string;
    calibration_bars: number;
    evaluation_bars: number;
    calibration_end: string | null;
    evaluation_start: string | null;
    forward_bars: number;
    purged: boolean;
    multiple_testing_adjusted: boolean;
  };
  context?: MarketWeatherContext;
  notes: string[];
}

export interface MarketWeatherCoordinateCoverage {
  id: string;
  family: "pressure_state" | "field_transform" | "ohlcv_carrier" | string;
  latest_computable: boolean;
  latest_source_observed: boolean;
  latest_measured: boolean;
  latest_internal_finite: boolean;
  latest_rolling_depth_support: boolean;
  latest_full_dependency_support: boolean;
  latest_uses_neutral_placeholder: boolean;
  computable_observations: number;
  computable_fraction: number;
  first_computable_index: number | null;
  first_computable_at: string | null;
  source_observed_observations: number;
  source_observed_fraction: number;
  first_source_observed_index: number | null;
  first_source_observed_at: string | null;
  rolling_depth_support_observations: number;
  rolling_depth_support_fraction: number;
  first_rolling_depth_support_index: number | null;
  first_rolling_depth_support_at: string | null;
  full_dependency_support_observations: number;
  full_dependency_support_fraction: number;
  first_full_dependency_support_index: number | null;
  first_full_dependency_support_at: string | null;
  measured_observations: number;
  measured_fraction: number;
  first_measured_index: number | null;
  first_measured_at: string | null;
  retained_prefix_bars: number;
  required_inputs: string[];
  minimum_rolling_support_bars: number;
  minimum_rolling_support_satisfied: boolean;
  bars_needed_to_minimum_rolling_support: number;
  initialization_target_bars: number;
  initialization_target_covered: boolean;
  status: "invalid" | "unavailable" | "provisional" | "target_covered" | string;
}

export interface MarketWeatherResponse {
  symbol: string;
  semantic_revision?: string;
  generated_at: string;
  data_source: string;
  quote: {
    price: number | null;
    source: string;
    quote_source: string | null;
    observed_at: string | null;
  };
  bar_size: string;
  timeframe: MarketWeatherTimeframe;
  requested_bars: number;
  available_bars: number;
  history_context?: {
    requested_visible_bars: number;
    visible_bars: number;
    analysis_bars: number;
    warmup_buffer_requested: number;
    warmup_buffer_received: number;
    maximum_horizon_bars: number;
    minimum_observed_window_bars: number;
    minimum_input_bars?: number;
    minimum_input_satisfied?: boolean;
    initialization_target_bars?: number;
    initialization_target_covered?: boolean;
    initialization_status?: "minimum_not_satisfied" | "minimum_satisfied" | "target_covered" | string;
    bars_needed_to_minimum_input?: number;
    bars_needed_to_initialization_target?: number;
    initialization_note?: string;
    state_vector_coverage?: {
      schema_version: string;
      coordinate_count: number;
      analysis_bars: number;
      maximum_horizon_bars: number;
      initialization_target_bars: number;
      initialization_target_covered: boolean;
      all_latest_measured: boolean;
      all_latest_full_dependency_support: boolean;
      features: MarketWeatherCoordinateCoverage[];
      coverage_is_convergence: false;
      note: string;
    };
    /** Compatibility aliases for pre-v1.2 responses. */
    target_warmup_bars: number;
    warmup_complete: boolean;
    status: "complete" | "provisional" | "insufficient";
    bars_needed_to_minimum?: number;
    bars_needed_to_target?: number;
    warmup_note?: string;
  };
  input_quality?: {
    status: "valid" | "limited" | "invalid";
    rows_received: number;
    rows_used: number;
    dropped: Record<string, number>;
    volume: {
      available: boolean;
      positive_observations: number;
      coverage: number;
      invalid_observations?: number;
    };
    warnings: string[];
  };
  coverage_start: string;
  coverage_end: string;
  orientation: "horizon_by_time";
  dates: string[];
  horizons: number[];
  price: MarketWeatherPricePoint[];
  channels: Record<string, number[][]>;
  summary: MarketWeatherSummary;
  latest_profile: MarketWeatherProfileRow[];
  settings: Record<string, number>;
  provenance?: {
    schema_version: string;
    scope: "recipe_and_normalized_input_identity" | string;
    provider_truth_verified: false;
    recipe_version: string;
    recipe_hash: string;
    input_schema: string;
    input_hash: string;
    analysis_hash: string;
    normalized_input_rows: number;
    normalized_input_start: string;
    normalized_input_end: string;
    recipe: Record<string, unknown>;
    note: string;
    symbol?: string;
    timeframe?: string;
    history_data_source?: string;
    history_cache_status?: string;
    history_storage_interval?: string;
    visible_start?: string;
    visible_end?: string;
    bar_completion_rule?: string;
  };
  research?: MarketWeatherResearch;
  methodology: {
    causal: boolean;
    description: string;
    research_status: string;
  };
  cache?: {
    analysis?: {
      status: "hit" | "miss" | "wait";
      retained: boolean;
      scope: "per_worker" | string;
      ttl_seconds: number;
      configured_ttl_seconds: number;
      max_entries: number;
      field_cells: number;
      max_cacheable_cells: number;
    };
    request?: {
      history_access: "hit" | "refreshed" | "stale_fallback" | "cache_bypass" | "not_checked" | "coalesced" | string;
      provider_called: boolean;
    };
    history?: MarketWeatherHistoryCacheMetadata;
    daily_context?: MarketWeatherHistoryCacheMetadata | null;
  };
}

export interface MarketWeatherHistoryCacheMetadata {
  status: "hit" | "refreshed" | "stale_fallback" | "cache_bypass";
  symbol: string;
  timeframe: string;
  storage_interval: string;
  requested_rows: number;
  minimum_rows: number;
  returned_rows: number;
  cached_rows_before: number;
  fetched_rows: number;
  inserted_rows: number;
  provider_called: boolean;
  stale: boolean;
  depth_complete: boolean;
  write_race_recovered: boolean;
  refresh_reason: string | null;
  ttl_seconds: number;
  age_seconds: number | null;
  last_updated_at: string | null;
  data_source: string;
  provider_error: string | null;
  cache_error?: string | null;
  source_counts?: Record<string, number>;
  max_stale_seconds?: number | null;
}

export type MarketWeatherComparisonMode = "single" | "pair";
export type MarketWeatherComparisonBasis = "native" | "context";
export type MarketWeatherComparisonView = "target" | "benchmark" | "difference";

export interface MarketWeatherComparisonSeriesPoint {
  date: string;
  target: number | null;
  benchmark: number | null;
  target_context?: number | null;
  benchmark_context?: number | null;
  native_difference: number | null;
  context_difference: number | null;
  target_supported?: boolean;
  benchmark_supported?: boolean;
  pair_supported?: boolean;
}

export interface MarketWeatherComparisonCoordinate {
  id: string;
  label: string;
  family: string;
  unit?: string;
  polarity?: "signed" | "unsigned" | "lower_is_less_stressed" | "descriptive" | string;
  latest: {
    target: number | null;
    benchmark: number | null;
    target_context?: number | null;
    benchmark_context?: number | null;
    native_difference: number | null;
    context_difference: number | null;
    target_supported: boolean;
    benchmark_supported: boolean;
    pair_supported?: boolean;
  };
  series: MarketWeatherComparisonSeriesPoint[];
}

export interface MarketWeatherComparisonResponse {
  schema_version: "market_field_pair_v1";
  semantic_revision?: string;
  generated_at?: string;
  target: {
    symbol: string;
    requested_symbol?: string;
    canonical_symbol?: string;
    provider_symbol?: string;
    analysis_hash: string;
    data_source?: string;
    latest_close?: number | null;
    latest_aligned_close?: number | null;
    latest_returned_close?: number | null;
  };
  benchmark: {
    symbol: string;
    requested_symbol?: string;
    canonical_symbol?: string;
    provider_symbol?: string;
    analysis_hash: string;
    data_source?: string;
    latest_close?: number | null;
    latest_aligned_close?: number | null;
    latest_returned_close?: number | null;
  };
  comparison_hash: string;
  timeframe: MarketWeatherTimeframe;
  overlap: {
    common_observations: number;
    start: string | null;
    end: string | null;
    target_dropped: number;
    benchmark_dropped: number;
    target_unmatched_after_latest_aligned?: number;
    benchmark_unmatched_after_latest_aligned?: number;
    target_latest_returned_at?: string | null;
    benchmark_latest_returned_at?: string | null;
    latest_aligned_at: string | null;
    support_fraction: number;
    session_compatibility?: "compatible" | "incompatible" | "unknown";
    /** Compatibility alias for early Pair v1 payloads. */
    session_compatible?: boolean | null;
    alignment_supported?: boolean;
    alignment_status?: "supported" | "unsupported" | string;
    alignment_rule?: "serialized_session_date" | "exact_utc_timestamp" | "exact_serialized_timestamp_timezone_unavailable" | string;
    note: string;
  };
  relative_progress: {
    latest_target_close: number | null;
    latest_benchmark_close: number | null;
    active_return_pct: number | null;
    beta_adjusted_return_pct: number | null;
    beta: number | null;
    beta_status?: "available" | "unavailable";
    lookback_bars: number;
    gap_direction: "widening" | "converging" | "mixed" | "unavailable" | string;
  };
  coordinates: MarketWeatherComparisonCoordinate[];
  price_series: Array<{
    date: string;
    target_close: number | null;
    benchmark_close: number | null;
    relative_index: number | null;
    active_return: number | null;
    prior_return_beta?: number | null;
    beta_adjusted_cumulative_return?: number | null;
  }>;
  provenance: {
    target_analysis_hash: string;
    benchmark_analysis_hash: string;
    comparison_hash: string;
    target_requested_symbol?: string;
    target_canonical_symbol?: string;
    target_provider_symbol?: string;
    benchmark_requested_symbol?: string;
    benchmark_canonical_symbol?: string;
    benchmark_provider_symbol?: string;
    alignment_contract?: string;
    normalization_contract?: string;
    component_recipe_hash?: string;
    ordered_pair?: boolean;
    identity_control?: boolean;
    note: string;
  };
  authority?: {
    mode: "research_display_only" | string;
    scanner_weight: number;
    option_learning_weight: number;
    veto: boolean;
    sizing: boolean;
    execution: boolean;
  };
  cache?: {
    target_history?: MarketWeatherHistoryCacheMetadata | Record<string, unknown>;
    benchmark_history?: MarketWeatherHistoryCacheMetadata | Record<string, unknown>;
    analysis?: {
      status?: "hit" | "miss" | "wait" | string;
      retained?: boolean;
      scope?: string;
      ttl_seconds?: number;
    };
    request?: {
      history_access?: string;
      provider_called?: boolean;
    };
  };
  caveats: string[];
}

export interface MarketWeatherCell {
  pressure: number;
  direction: number;
  structural_strength: number;
  velocity: number;
  acceleration: number;
  jerk: number;
  snap: number;
  scale_gradient: number;
  scale_curvature: number;
  mixed_derivative: number;
  cascade_velocity: number;
  propagation_strength: number;
  permutation_entropy: number;
  scaling_exponent: number;
  boundary_energy: number;
  vertical_gradient: number;
  temporal_gradient: number;
  laplacian: number;
  coherence: number;
  entropy: number;
  persistence: number;
  confidence: number;
  expansion: number;
  contraction: number;
  reflectivity: number;
  convection: number;
  swami: number;
  [key: string]: number;
}
