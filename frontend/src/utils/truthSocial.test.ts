import { describe, expect, it } from "vitest";
import { monthlyPace, postingSeries, type TruthDay } from "./truthSocial";

const days: TruthDay[] = Array.from({ length: 9 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, total: i + 1, originals: i, quotes: 1, retruths: 0, partial: i === 8 }));

describe("posting research calculations", () => {
  it("requires seven complete consecutive dates and excludes the partial current day", () => {
    const result = postingSeries(days, "total");
    expect(result.slice(0, 6).every(row => row.average === null)).toBe(true);
    expect(result[6].average).toBe(4);
    expect(result[7].average).toBe(5);
    expect(result[8].average).toBeNull();
  });
  it("does not bridge a missing date or confuse post-type counts", () => {
    expect(postingSeries(days.filter(row => row.date !== "2026-01-03"), "total")[6].average).toBeNull();
    expect(postingSeries(days, "quotes")[6].average).toBe(1);
  });
  it("retains history before a visible filter", () => {
    const result = postingSeries(days, "total").filter(row => row.date >= "2026-01-07");
    expect(result[0].average).toBe(4);
  });
  it("normalizes partial months by ended dates, including actual zero days", () => {
    const result = monthlyPace(days, "total");
    expect(result).toEqual([{ month: "2026-01", total: 36, days: 8, pace: 4.5 }]);
    expect(monthlyPace(days, "retruths")[0].pace).toBe(0);
  });
});
