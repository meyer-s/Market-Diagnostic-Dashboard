import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NarrativeImpulseWidget, { type NarrativeAnalysis } from "./NarrativeImpulseWidget";


const narrative: NarrativeAnalysis = {
  schema_version: "narrative_impulse_v1",
  symbol: "NOW",
  as_of: "2026-08-26T16:00:00Z",
  window_days: 180,
  active_impulse_days: 30,
  narrative_impulse: 0.41,
  direction: 0.53,
  attention: {
    z_score: 2.1,
    status: "elevated",
    recent_cluster_count: 4,
    baseline_clusters_per_week: 1.9,
    baseline_weeks: 12,
    observed_span_days: 102,
  },
  evidence_confidence: 0.65,
  market_confirmation: {
    status: "limited",
    benchmark: "IGV",
    market_impulse_z: -0.4,
    confirmation_z: -0.4,
    available_metric_count: 3,
    total_metric_count: 5,
    metrics: [
      { key: "beta_adjusted_residual", label: "5-session residual vs IGV", status: "available", z_score: -0.5, value: -1.2, unit: "% log return", detail: "Prior-only 60-session beta 1.12." },
      { key: "abnormal_volume", label: "5-session abnormal volume", status: "available", z_score: 1.4, value: null, unit: "sigma", detail: "Five-session mean log volume versus history." },
      { key: "anchored_vwap_displacement", label: "20-session VWAP displacement", status: "available", z_score: -0.3, value: -0.8, unit: "%", detail: "Daily typical-price volume weighting; a session-level proxy." },
      { key: "atm_iv_change", label: "ATM-IV change", status: "unavailable", z_score: null, value: null, unit: "vol points", detail: "The current options snapshot has no timestamped ATM-IV history." },
      { key: "term_structure_skew", label: "Term structure and skew change", status: "unavailable", z_score: null, value: null, unit: null, detail: "Timestamped option surfaces are not stored." },
    ],
  },
  classification: {
    key: "chatter_unconfirmed",
    label: "Chatter / unconfirmed",
    detail: "Narrative evidence is strong without a matching market response.",
  },
  silence: {
    key: "mentions_observed",
    label: "Narrative events observed",
    detail: "Recent independent claim events are present.",
    recent_cluster_count: 4,
    baseline_clusters_per_week: 1.9,
    successful_checks_7d: 8,
    failed_checks_7d: 1,
    latest_check_at: "2026-08-26T14:00:00Z",
    sources_checked: ["SeekingAlpha"],
    continuity_status: "observed",
  },
  counts: {
    raw_items: 30,
    claim_clusters: 5,
    active_claim_clusters: 4,
    propagation_items: 25,
    independent_sources: 3,
  },
  driver_groups: [
    { key: "company_attributed", label: "Company-attributed claims", available: true, cluster_count: 2, impulse: 0.31, direction: 1, basis: "Headline attribution inference." },
    { key: "publisher_editorial", label: "Publisher framing", available: true, cluster_count: 2, impulse: 0.1, direction: 0.4, basis: "Headline attribution inference." },
    { key: "community_public", label: "Community / public opinion", available: false, cluster_count: 0, impulse: 0, direction: null, basis: "Headline attribution inference." },
  ],
  clusters: [{
    cluster_id: "NOW-001",
    title: "ServiceNow raises guidance after earnings beat",
    link: "https://example.com/now",
    source: "Example Wire",
    first_seen: "2026-08-26T08:00:00Z",
    last_seen: "2026-08-26T12:00:00Z",
    direction: 0.8,
    relevance: 1,
    novelty: 0.9,
    confidence: 0.75,
    time_decay: 0.9,
    impulse: 0.4,
    propagation_count: 26,
    independent_source_count: 3,
    source_names: ["Example Wire", "Publisher A", "Publisher B"],
    origin_role: "company_attributed",
    topics: ["earnings_guidance"],
  }],
  coverage: {
    status: "limited",
    channels: [
      { key: "publisher", label: "Publisher headlines", available: true, item_count: 30 },
      { key: "company_distribution", label: "Company-distributed releases", available: false, item_count: 0 },
      { key: "filing", label: "Regulatory filings", available: false, item_count: 0 },
      { key: "community_public", label: "Community / public opinion", available: false, item_count: 0 },
    ],
    published_start: "2026-04-01T00:00:00Z",
    published_end: "2026-08-26T12:00:00Z",
    successful_checks_7d: 8,
    failed_checks_7d: 1,
    latest_check_at: "2026-08-26T14:00:00Z",
    limitations: [
      "Headline language is scored; full-article tone is not observed.",
      "Observed publishers are not a representative sample of public opinion.",
      "Attribution does not infer motive or coordination.",
    ],
  },
  methodology: {
    cluster_keys: ["symbol", "topic tokens", "canonical URL"],
    impulse_formula: "direction × relevance × novelty × confidence × time decay",
    confidence_formula: "1 - product(1 - independent source confidence)",
    evidence_confidence_aggregation: "relevance-, novelty-, and time-decay-weighted mean of cluster confidence",
    attention_window_days: 7,
    headline_model: "deterministic_headline_lexicon_v1",
    market_benchmark: "IGV",
  },
};


describe("NarrativeImpulseWidget", () => {
  it("keeps the four outputs, propagation, source gaps, and market guardrails visible", () => {
    render(<NarrativeImpulseWidget narrative={narrative} ticker="NOW" />);

    expect(screen.getByRole("heading", { name: "Narrative Impulse" })).not.toBeNull();
    expect(screen.getByText("Chatter / unconfirmed")).not.toBeNull();
    expect(screen.getByText("+0.53")).not.toBeNull();
    expect(screen.getByText("+2.1σ")).not.toBeNull();
    expect(screen.getAllByText("65%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-0.4σ").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Narrative evidence pipeline counts").textContent).toContain("30 raw items");
    expect(screen.getByLabelText("Narrative evidence pipeline counts").textContent).toContain("25 copy/repost items excluded from corroboration");
    expect(screen.getByText("ServiceNow raises guidance after earnings beat")).not.toBeNull();
    expect(screen.getAllByText("Community / public opinion").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not collected").length).toBeGreaterThan(0);
    expect(screen.getByText("ATM-IV change")).not.toBeNull();
    expect(screen.getByText(/no timestamped ATM-IV history/i)).not.toBeNull();
    expect(screen.getByText("Method, collection coverage, and limitations")).not.toBeNull();
  });

  it("shows an explicit unavailable state instead of manufacturing neutrality", () => {
    render(<NarrativeImpulseWidget narrative={null} ticker="NOW" />);

    expect(screen.getByText(/Narrative evidence is unavailable/)).not.toBeNull();
    expect(screen.queryByText("Mixed / neutral")).toBeNull();
  });
});
