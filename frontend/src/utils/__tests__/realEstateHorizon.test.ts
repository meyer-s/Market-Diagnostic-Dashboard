import { describe, expect, it } from "vitest";
import {
  buildCycleTimeTicks,
  buildCycleTicks,
  buildSeriesWindow,
  filterByYears,
  filterToSeriesWindow,
  formatCycleAxisLabel,
  formatCycleTimeAxisLabel,
  rebaseSeries,
  rebaseSeriesToWindow,
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

  it("uses one calendar window across mixed-frequency series", () => {
    const quarterly = [
      { date: "2011-01-01", value: 190 },
      { date: "2026-01-01", value: 350 },
    ];
    const dailyRecent = [
      { date: "2025-02-04", value: 100 },
      { date: "2026-07-20", value: 130 },
    ];
    const window = buildSeriesWindow([quarterly, dailyRecent], 15);

    expect(window).toEqual({
      start: Date.UTC(2011, 6, 20),
      end: Date.UTC(2026, 6, 20),
    });
    expect(filterToSeriesWindow(quarterly, window)).toEqual([quarterly[1]]);
    expect(rebaseSeriesToWindow(dailyRecent, window)).toEqual([
      { date: "2025-02-04", value: 100 },
      { date: "2026-07-20", value: 130 },
    ]);
  });

  it("builds numeric ticks at their true calendar positions", () => {
    const window = {
      start: Date.UTC(2011, 6, 20),
      end: Date.UTC(2026, 6, 20),
    };
    const ticks = buildCycleTimeTicks(window, 15);

    expect(ticks.map((tick) => formatCycleTimeAxisLabel(tick, 15))).toEqual([
      "2013",
      "2016",
      "2019",
      "2022",
      "2025",
    ]);
    expect((ticks[4] - window.start) / (window.end - window.start)).toBeGreaterThan(0.89);
  });
});
