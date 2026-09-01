export type BlsObservation = {
  period: string;
  raw_value: number | null;
  primary_value: number | null;
  relative_percentile: number | null;
  change_1m: number | null;
  change_12m_pct: number | null;
  available: boolean;
  unavailable_reason: string | null;
  preliminary: boolean;
  footnotes: Array<string | { code: string; text: string }> | string | null;
  first_seen_value: number | null;
  current_value: number | null;
  revision_delta: number | null;
  revision_count: number;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  revision_tracking_status?: string;
};

export type BlsSeries = {
  key?: string;
  series_id: string;
  report_id: string;
  label: string;
  short_label: string;
  description?: string;
  family: string;
  unit?: string;
  raw_unit?: string;
  frequency?: string;
  seasonal_adjustment: string;
  primary_measure: string;
  primary_unit: string;
  change_1m_unit: string;
  transformation?: string;
  higher_means: string;
  source_url: string;
  coverage_start?: string | null;
  coverage_end?: string | null;
  coverage?: {
    start?: string | null;
    end?: string | null;
    observation_count?: number;
  };
  latest?: BlsObservation | null;
  observations: BlsObservation[];
};

export type BlsReport = {
  report_id?: string;
  id?: string;
  label?: string;
  name?: string;
  description?: string;
  series_ids?: string[];
  source_url?: string;
};

export type PayrollRevision = {
  period: string;
  first_estimate: number | null;
  second_estimate: number | null;
  third_estimate: number | null;
  second_minus_first?: number | null;
  third_minus_second?: number | null;
  total_revision?: number | null;
  status?: string;
  revision_2_minus_1?: number | null;
  revision_3_minus_2?: number | null;
  revision_3_minus_1?: number | null;
  latest_estimate?: number | null;
  revision_stage?: string;
  unit?: string;
  source_url?: string;
};

export type BlsCalendarEntry = {
  report_id: string;
  report?: string;
  title?: string;
  scheduled_at: string;
  date?: string;
  time_label?: string;
  status: "scheduled" | "past_scheduled";
  source_url: string;
  time_zone?: string;
};

export type BlsDataQuality =
  | string
  | {
      status: string;
      message?: string;
      [key: string]: unknown;
    };

export type BlsLensResponse = {
  as_of: string;
  requested_years: number;
  coverage: Record<string, unknown> | string;
  data_quality: BlsDataQuality;
  reports: BlsReport[];
  series: BlsSeries[];
  payroll_revisions: PayrollRevision[];
  release_calendar: BlsCalendarEntry[];
  methodology: Record<string, unknown> | string[];
  warnings: string[];
};

export type SeriesLineStyle = {
  color: string;
  dash?: string;
  opacity: number;
};
