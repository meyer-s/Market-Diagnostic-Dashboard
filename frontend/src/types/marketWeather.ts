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
  coordinate?: Record<string, string>;
  definitions: Record<string, string>;
  derivative_series: MarketWeatherDerivativePoint[];
  strata: {
    latest: MarketWeatherStrataLatest;
    series: MarketWeatherStrataPoint[];
  };
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

export interface MarketWeatherResponse {
  symbol: string;
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
  research?: MarketWeatherResearch;
  methodology: {
    causal: boolean;
    description: string;
    research_status: string;
  };
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
