import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blsLensFixture } from "./__fixtures__/blsLensFixture";
import { briefReading, buildBlsBrief } from "./blsBriefModel";
import BlsOverview from "./BlsOverview";
import { buildOverviewRevisionSummary, effectiveRevisionDelta, releaseCalendarHref } from "./blsOverviewModel";
import type { BlsLensResponse } from "./types";

function fixture() { return structuredClone(blsLensFixture); }
function setValues(data: BlsLensResponse, id: string, values: Array<number | null>, periods?: string[]) {
  const series = data.series.find((item) => item.series_id === id)!;
  series.latest = undefined;
  series.observations = values.map((value, i) => ({ ...series.observations[0], period: periods?.[i] ?? `2026-0${i + 4}-01`, primary_value: value, available: value !== null }));
}

describe("BLS knowledge brief", () => {
  afterEach(cleanup);

  it("does not substitute an older finite value for a missing latest annual CPI reading", () => {
    const data = fixture();
    setValues(data, "CUUR0000SA0", [3.4, 3.7, null]);
    data.series.find((item) => item.series_id === "CUUR0000SA0")!.observations.at(-1)!.raw_value = 337.511;
    const reading = briefReading(data, "CUUR0000SA0", "CPI");
    expect(reading.period).toBe("2026-06-01");
    expect(reading.value).toBeNull();
    expect(reading.display).toBe("Unavailable");
    expect(buildBlsBrief(data).findings[1].title).toContain("comparison has a gap");
  });

  it("requires adjacent months and never bridges a missing reference month", () => {
    const data = fixture();
    setValues(data, "CES0000000001", [100, 200], ["2026-04-01", "2026-06-01"]);
    setValues(data, "LNS14000000", [4.2, 4.1], ["2026-04-01", "2026-06-01"]);
    expect(briefReading(data, "CES0000000001", "Payrolls").delta).toBeNull();
    expect(buildBlsBrief(data).findings[0].qualification).toContain("three consecutive");
  });

  it("does not combine payrolls with unemployment from a different month", () => {
    const data = fixture();
    setValues(data, "CES0000000001", [100, 165], ["2026-06-01", "2026-07-01"]);
    setValues(data, "LNS14000000", [4.2, 4.1], ["2026-05-01", "2026-06-01"]);
    const finding = buildBlsBrief(data).findings[0];
    expect(finding.title).toBe("Employers are still adding jobs.");
    expect(finding.qualification).toContain("different months");
  });

  it("distinguishes opposing labor evidence from a common direction", () => {
    const data = fixture();
    setValues(data, "CES0000000001", [100, 165]);
    setValues(data, "LNS14000000", [4.1, 4.2]);
    expect(buildBlsBrief(data).findings[0].title).toBe("Jobs grew while unemployment rose.");
    setValues(data, "CES0000000001", [100, -10]);
    expect(buildBlsBrief(data).findings[0].title).toBe("Payrolls contracted in the latest month.");
  });

  it("uses annual rate changes rather than raw CPI index-point changes", () => {
    const data = fixture();
    setValues(data, "CUUR0000SA0", [3.397, 3.738]);
    setValues(data, "CUUR0000SA0L1E", [2.446, 2.564]);
    data.series.find((item) => item.series_id === "CUUR0000SA0")!.observations.at(-1)!.change_1m = 1.96;
    const reading = briefReading(data, "CUUR0000SA0", "CPI");
    expect(reading.delta).toBeCloseTo(0.341);
    expect(reading.comparison).toContain("percentage points");
    expect(buildBlsBrief(data).findings[1].title).toContain("picked up in both");
  });

  it("distinguishes slower inflation from falling prices and keeps PPI separate", () => {
    const data = fixture();
    setValues(data, "CUUR0000SA0", [3.8, 3.4]);
    setValues(data, "CUUR0000SA0L1E", [3.0, 2.7]);
    const prices = buildBlsBrief(data).findings[1];
    expect(prices.title).toContain("eased in both");
    expect(prices.interpretation).toContain("not necessarily lower prices");
    expect(prices.qualification).toContain("cannot substitute for CPI");
  });

  it("does not infer demand confirmation from openings alone and identifies lagged JOLTS", () => {
    const data = fixture();
    setValues(data, "CES0000000001", [60, 165], ["2026-09-01", "2026-10-01"]);
    setValues(data, "JTS000000000000000JOR", [4.3, 4.5], ["2026-08-01", "2026-09-01"]);
    setValues(data, "JTS000000000000000QUR", [2.1, 1.9], ["2026-08-01", "2026-09-01"]);
    const demand = buildBlsBrief(data).findings[2];
    expect(demand.title).toContain("mixed read");
    expect(demand.qualification).toContain("different reference months");
    setValues(data, "JTS000000000000000QUR", [null, null], ["2026-08-01", "2026-09-01"]);
    expect(buildBlsBrief(data).findings[2].title).toContain("more confirmation");
    setValues(data, "JTS000000000000000JOR", [4.3, 4.3]);
    setValues(data, "JTS000000000000000QUR", [1.9, 1.9]);
    expect(buildBlsBrief(data).findings[2].title).toContain("held steady");
  });

  it("renders conclusions with inspectable receipts and links into focused proof", () => {
    const onNavigate = vi.fn();
    render(<BlsOverview data={fixture()} onNavigate={onNavigate} />);
    expect(screen.getByRole("heading", { name: "Labor & inflation brief" })).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getAllByText("Evidence & next check")).toHaveLength(3);
    fireEvent.click(screen.getAllByText("Evidence & next check")[0]);
    expect(screen.getByRole("link", { name: "BLS source for payroll change ↗" }).getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: "Explore hiring history" }));
    expect(onNavigate).toHaveBeenCalledWith("trends", "CES0000000001");
    fireEvent.click(screen.getByRole("button", { name: "Methods & sources" }));
    expect(onNavigate).toHaveBeenCalledWith("methods");
    fireEvent.click(screen.getByRole("button", { name: "Full calendar" }));
    expect(onNavigate).toHaveBeenCalledWith("calendar");
    expect(screen.getByRole("link", { name: "Add to calendar" }).getAttribute("href")).toMatch(/^data:text\/calendar/);
  });
});

describe("Payroll revisions and release clocks", () => {
  it("does not treat an unrevised first estimate as a zero revision", () => {
    expect(effectiveRevisionDelta({ period: "2026-07-01", first_estimate: 165, second_estimate: null, third_estimate: null, revision_stage: "first_estimate" })).toBeNull();
  });
  it("uses the available official estimate stage and requires contiguous revised months", () => {
    const rows = [
      { period: "2026-05-01", first_estimate: 100, second_estimate: 90, third_estimate: 80 },
      { period: "2026-06-01", first_estimate: 100, second_estimate: 70, third_estimate: 60 },
      { period: "2026-07-01", first_estimate: 100, second_estimate: 80, third_estimate: null },
    ];
    expect(buildOverviewRevisionSummary(rows).netThreeMonth).toBe(-80);
    expect(buildOverviewRevisionSummary([rows[0], rows[2]]).netThreeMonth).toBeNull();
  });
  it("exports a start-only scheduled event without inventing a duration or publication", () => {
    const calendar = decodeURIComponent(releaseCalendarHref(blsLensFixture.release_calendar[0])!.split(",")[1]);
    expect(calendar).toContain("DTSTART:");
    expect(calendar).not.toContain("DTEND:");
    expect(calendar).toContain("does not confirm an observation release");
  });
});
