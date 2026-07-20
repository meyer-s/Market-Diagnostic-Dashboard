import { describe, expect, it } from "vitest";
import {
  buildCycleTicks,
  filterByYears,
  formatCycleAxisLabel,
  rebaseSeries,
} from "../realEstateHorizon";

const points = [
  { date: "2020-01-01", value: 50 },
  { date: "2024-01-01", value: 80 },
  { date: "2025-01-01", value: 100 },
  { date: "2026-01-01", value: 120 },
];

describe("real-estate horizon helpers", () => {
  it("filters every series to the selected year window", () => {
    expect(filterByYears(points, 1)).toEqual(points.slice(2));
    expect(filterByYears(points, 5)).toEqual(points.slice(1));
  });

  it("rebases the filtered series to 100", () => {
    expect(rebaseSeries(points, 1)).toEqual([
      { date: "2025-01-01", value: 100 },
      { date: "2026-01-01", value: 120 },
    ]);
  });

  it("uses cycle-aware labels and keeps chart edges", () => {
    expect(buildCycleTicks(points, 30)).toEqual(["2020-01-01", "2025-01-01"]);
    expect(formatCycleAxisLabel("2025-01-01", 1)).toBe("Jan 25");
    expect(formatCycleAxisLabel("2025-01-01", 15)).toBe("2025");
  });
});
