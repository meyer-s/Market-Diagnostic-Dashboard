import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blsLensFixture } from "./__fixtures__/blsLensFixture";
import BlsOverview from "./BlsOverview";
import {
  BLS_OVERVIEW_RULE_RECEIPT,
  buildBlsOverviewModel,
  buildOverviewRevisionSummary,
  effectiveRevisionDelta,
  releaseCalendarHref,
} from "./blsOverviewModel";
import { formatSigned } from "./format";
import type { BlsLensResponse, BlsObservation, PayrollRevision } from "./types";

vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Line: ({ name }: { name?: string }) => name ? <span>{name}</span> : null,
    LineChart: Shell,
    ResponsiveContainer: Shell,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const SIX_MONTHS = [
  "2026-02-01",
  "2026-03-01",
  "2026-04-01",
  "2026-05-01",
  "2026-06-01",
  "2026-07-01",
];

function observations(template: BlsObservation, values: number[], periods = SIX_MONTHS): BlsObservation[] {
  return periods.map((period, index) => ({
    ...template,
    period,
    raw_value: values[index],
    primary_value: values[index],
    relative_percentile: 50,
    available: true,
    unavailable_reason: null,
    preliminary: false,
    first_seen_value: values[index],
    current_value: values[index],
  }));
}

function setSeriesValues(data: BlsLensResponse, seriesId: string, values: number[], periods = SIX_MONTHS) {
  const series = data.series.find((candidate) => candidate.series_id === seriesId);
  if (!series) throw new Error(`Missing fixture series ${seriesId}`);
  series.observations = observations(series.observations[0], values, periods);
  series.coverage_start = periods[0];
  series.coverage_end = periods.at(-1) ?? null;
}

function completeLaborFixture(): BlsLensResponse {
  const data = structuredClone(blsLensFixture);
  setSeriesValues(data, "CES0000000001", [200, 190, 180, 150, 140, 130]);
  setSeriesValues(data, "LNS14000000", [4, 4, 4, 4.1, 4.1, 4.2]);
  setSeriesValues(data, "CES0500000003", [3.5, 3.5, 3.4, 3.3, 3.2, 3.2]);
  setSeriesValues(data, "JTS000000000000000JOR", [4.5, 4.5, 4.4, 4.2, 4.2, 4.1]);
  return data;
}

describe("BLS Overview model", () => {
  afterEach(cleanup);

  it("selects the four preferred labor indicators and applies the inspectable dashboard rule", () => {
    const model = buildBlsOverviewModel(completeLaborFixture());

    expect(model.indicators.map((indicator) => indicator.role)).toEqual([
      "Payroll growth",
      "Unemployment",
      "Hourly earnings",
      "Job openings",
    ]);
    expect(model.overall).toMatchObject({
      state: "cooling",
      eligibleVotes: 3,
      coolingVotes: 3,
      strengtheningVotes: 0,
    });

    const payroll = model.indicators[0];
    expect(payroll.current?.primary_value).toBe(130);
    expect(payroll.prior?.primary_value).toBe(140);
    expect(payroll.delta).toBe(-10);
    expect(payroll.stateLabel).toBe("Lower than prior");
    expect(payroll.trendDelta).toBe(-50);
    expect(payroll.trendStateLabel).toBe("Payroll gains cooling");

    const earnings = model.indicators[2];
    expect(earnings.trendStateLabel).toBe("Wage growth decelerating");
    expect(BLS_OVERVIEW_RULE_RECEIPT.overall.excludedSeriesIds).toContain("CES0500000003");
    expect(model.briefLines).toHaveLength(3);
    expect(model.briefLines[0]).toContain("Dashboard rule state: Cooling");
  });

  it.each([
    ["CES0000000001", 100, 25],
    ["LNS14000000", 4, 0.1],
    ["CES0500000003", 3, 0.1],
    ["JTS000000000000000JOR", 4, 0.1],
    ["JTS000000000000000JOL", 7, 0.15],
  ])("rounds %s to three decimals and treats its inclusive materiality boundary as stable", (seriesId, base, band) => {
    const data = completeLaborFixture();
    if (seriesId === "JTS000000000000000JOL") {
      data.series = data.series.filter((series) => series.series_id !== "JTS000000000000000JOR");
    }
    setSeriesValues(data, seriesId, [base, base, base, base + band, base + band, base + band]);

    const indicator = buildBlsOverviewModel(data).indicators.find(
      (candidate) => candidate.series.series_id === seriesId,
    );

    expect(indicator?.trendDelta).toBe(band);
    expect(indicator?.trendState).toBe("stable");
  });

  it("keeps hundredths and three-decimal rule evidence visible without negative zero", () => {
    expect(formatSigned(-0.04, "", 3)).toBe("-0.04");
    expect(formatSigned(0.04, "", 3)).toBe("+0.04");
    expect(formatSigned(-0.0004, "", 3)).toBe("0");

    const data = completeLaborFixture();
    setSeriesValues(data, "CES0500000003", [3, 3, 3, 3.104, 3.104, 3.104]);
    const earnings = buildBlsOverviewModel(data).indicators.find(
      (indicator) => indicator.series.series_id === "CES0500000003",
    );
    expect(earnings?.trendDelta).toBe(0.104);
    expect(earnings?.trendInterpretation).toContain("+0.104 percentage points");
    expect(earnings?.trendInterpretation).toContain("beyond the 0.1 percentage points");
  });

  it("classifies opposing eligible voter directions as mixed", () => {
    const data = completeLaborFixture();
    setSeriesValues(data, "CES0000000001", [100, 100, 100, 130, 130, 130]);
    setSeriesValues(data, "LNS14000000", [4, 4, 4, 4.2, 4.2, 4.2]);
    setSeriesValues(data, "JTS000000000000000JOR", [4, 4, 4, 4.1, 4.1, 4.1]);

    const model = buildBlsOverviewModel(data);

    expect(model.overall).toMatchObject({
      state: "mixed",
      strengtheningVotes: 1,
      coolingVotes: 1,
      stableVotes: 1,
    });
  });

  it("requires a contiguous six-month window before assigning a trend state", () => {
    const data = completeLaborFixture();
    setSeriesValues(
      data,
      "CES0000000001",
      [100, 100, 100, 130, 130, 130],
      ["2026-02-01", "2026-03-01", "2026-04-01", "2026-06-01", "2026-07-01", "2026-08-01"],
    );

    const payroll = buildBlsOverviewModel(data).indicators.find(
      (indicator) => indicator.series.series_id === "CES0000000001",
    );

    expect(payroll?.trendState).toBe("observations_only");
    expect(payroll?.trendInterpretation).toContain("Six contiguous finite monthly observations");
  });

  it("inserts an explicit null point when a month is omitted from an Overview trend", () => {
    const data = completeLaborFixture();
    const payroll = data.series.find((series) => series.series_id === "CES0000000001");
    if (!payroll) throw new Error("Missing payroll fixture series");
    payroll.observations = payroll.observations.filter((observation) => observation.period !== "2026-05-01");

    const indicator = buildBlsOverviewModel(data).indicators.find(
      (candidate) => candidate.series.series_id === "CES0000000001",
    );

    expect(indicator?.trendPoints.find((point) => point.period === "2026-05-01")).toEqual({
      period: "2026-05-01",
      value: null,
    });
  });

  it("preserves missing chronological latest and prior observations instead of bridging gaps", () => {
    const missingLatest = completeLaborFixture();
    const missingLatestSeries = missingLatest.series.find((series) => series.series_id === "CES0000000001");
    if (!missingLatestSeries) throw new Error("Missing payroll fixture series");
    missingLatestSeries.observations.at(-1)!.primary_value = null;
    missingLatestSeries.observations.at(-1)!.available = false;

    const latestCard = buildBlsOverviewModel(missingLatest).indicators[0];
    expect(latestCard.current?.period).toBe(SIX_MONTHS.at(-1));
    expect(latestCard.current?.primary_value).toBeNull();
    expect(latestCard.delta).toBeNull();
    expect(latestCard.state).toBe("unavailable");

    const missingPrior = completeLaborFixture();
    const missingPriorSeries = missingPrior.series.find((series) => series.series_id === "CES0000000001");
    if (!missingPriorSeries) throw new Error("Missing payroll fixture series");
    missingPriorSeries.observations.at(-2)!.primary_value = null;
    missingPriorSeries.observations.at(-2)!.available = false;

    const priorCard = buildBlsOverviewModel(missingPrior).indicators[0];
    expect(priorCard.prior?.period).toBe(SIX_MONTHS.at(-2));
    expect(priorCard.prior?.primary_value).toBeNull();
    expect(priorCard.delta).toBeNull();
    expect(priorCard.state).toBe("prior_unavailable");
  });

  it("excludes an otherwise valid voter whose anchor is more than two months stale", () => {
    const data = completeLaborFixture();
    const stalePeriods = [
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ];
    setSeriesValues(data, "JTS000000000000000JOR", [4.5, 4.5, 4.4, 4.2, 4.2, 4.1], stalePeriods);

    const model = buildBlsOverviewModel(data);

    expect(model.overall.eligibleVotes).toBe(2);
    expect(model.overall.coolingVotes).toBe(2);
    expect(model.overall.explanation).toContain("two-month anchor window");
  });

  it("does not substitute inflation series when a preferred labor series is absent", () => {
    const data = structuredClone(blsLensFixture);
    data.series = data.series.filter((series) => series.series_id !== "CES0500000003");
    const model = buildBlsOverviewModel(data);

    expect(model.indicators.map((indicator) => indicator.series.series_id)).toEqual([
      "CES0000000001",
      "LNS14000000",
      "JTS000000000000000JOR",
    ]);
    expect(model.indicators.every((indicator) => indicator.series.family === "labor")).toBe(true);
    expect(model.overall.state).toBe("observations_only");
  });

  it("keeps preferred series visible with explicit unavailable states", () => {
    const data = structuredClone(blsLensFixture);
    data.series.forEach((series) => {
      if (!["CES0000000001", "LNS14000000", "CES0500000003", "JTS000000000000000JOR", "JTS000000000000000JOL"].includes(series.series_id)) return;
      series.observations = series.observations.map((observation) => ({
        ...observation,
        primary_value: null,
        available: false,
        unavailable_reason: "Upstream value unavailable.",
      }));
    });

    const model = buildBlsOverviewModel(data);

    expect(model.indicators).toHaveLength(4);
    expect(model.indicators.every((indicator) => indicator.stateLabel === "Current value unavailable")).toBe(true);
    expect(model.trends).toHaveLength(4);
    expect(model.trends.every((indicator) => indicator.plottablePointCount === 0)).toBe(true);
  });
});

describe("BLS Overview revisions and schedule", () => {
  it("skips a first-only latest month and uses stage-aware newest-estimate deltas", () => {
    const firstOnly: PayrollRevision = {
      period: "2026-07-01",
      first_estimate: 50,
      second_estimate: null,
      third_estimate: null,
      latest_estimate: 50,
      revision_stage: "first_estimate",
    };
    const revisions = [...blsLensFixture.payroll_revisions, firstOnly];
    const summary = buildOverviewRevisionSummary(revisions);

    expect(effectiveRevisionDelta(firstOnly)).toBeNull();
    expect(summary.latestPeriod).toBe("2026-06-01");
    expect(summary.latestDelta).toBe(10);
    expect(summary.latestStage).toBe("second_estimate");
    expect(summary.latestStageLabel).toBe("Second estimate");
    expect(summary.netThreeMonth).toBe(-45);
    expect(summary.streakDirection).toBe("upward");
    expect(summary.streakCount).toBe(1);
  });

  it("breaks revision nets and streaks across missing reference months", () => {
    const rows: PayrollRevision[] = [
      { period: "2026-04-01", first_estimate: 100, second_estimate: 90, third_estimate: null, revision_stage: "second_estimate" },
      { period: "2026-06-01", first_estimate: 100, second_estimate: 95, third_estimate: null, revision_stage: "second_estimate" },
      { period: "2026-07-01", first_estimate: 100, second_estimate: 98, third_estimate: null, revision_stage: "second_estimate" },
    ];

    const summary = buildOverviewRevisionSummary(rows);

    expect(summary.netThreeMonth).toBeNull();
    expect(summary.streakDirection).toBe("downward");
    expect(summary.streakCount).toBe(2);
  });

  it("exports a start-only schedule event without inventing a duration", () => {
    const upcoming = blsLensFixture.release_calendar[0];
    const href = releaseCalendarHref(upcoming);
    const calendar = decodeURIComponent(href?.split(",")[1] ?? "");

    expect(calendar).toContain("DTSTART:");
    expect(calendar).not.toContain("DTEND:");
    expect(calendar).toContain("does not confirm an observation release");
  });
});

describe("BlsOverview", () => {
  it("renders an answer-first semantic surface and passes view plus series focus to the shell", () => {
    const onNavigate = vi.fn();
    render(<BlsOverview data={completeLaborFixture()} onNavigate={onNavigate} />);

    expect(screen.getByRole("heading", { name: "Labor-market overview" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Current read" })).not.toBeNull();
    expect(screen.getByText("Dashboard rule state: Cooling. Payroll growth is lower than its prior observation; Unemployment is higher than its prior observation.")).not.toBeNull();
    expect(screen.getByText(/dashboard rules, not BLS thresholds or classifications/i)).not.toBeNull();
    expect(screen.getAllByText("Cooling").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/recent primary values by reference period/i)).toHaveLength(4);
    expect(screen.getByText("Revision clock · estimate vintage")).not.toBeNull();
    expect(screen.getByText(/Second estimate · Upward revision/)).not.toBeNull();
    expect(screen.getByRole("heading", { level: 4, name: "Latest revision" })).not.toBeNull();
    expect(screen.getByText("Schedule clock · U.S. Eastern")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Payroll growth in Trends" }));
    expect(onNavigate).toHaveBeenCalledWith("trends", "CES0000000001");

    fireEvent.click(screen.getByRole("button", { name: "View revision history" }));
    expect(onNavigate).toHaveBeenCalledWith("revisions");

    fireEvent.click(screen.getByRole("button", { name: "Open Methods & sources" }));
    expect(onNavigate).toHaveBeenCalledWith("methods");

    const calendarLink = screen.getByRole("link", { name: "Add to calendar" });
    expect(calendarLink.getAttribute("href")?.startsWith("data:text/calendar")).toBe(true);
    expect(document.body.textContent?.toLowerCase()).not.toContain("initial claims");
    expect(document.body.textContent?.toLowerCase()).not.toContain("caused by");
  });
});
