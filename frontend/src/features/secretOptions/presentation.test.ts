import { describe, expect, it } from "vitest";

import type { ScannerRun } from "./types";
import { formatScannerRunTime, groupScannerRunsByDay } from "./presentation";

const scannerRun = (id: number, startedAt: string): ScannerRun => ({
  id,
  universe_key: "SP500",
  universe_label: "S&P 500",
  threshold: 30,
  trigger_source: "scheduled",
  status: "completed",
  total_symbols: 500,
  scanned_symbols: 500,
  hits: id,
  errors: 0,
  rate_limit_errors: 0,
  hit_symbols: [],
  notes: null,
  last_event: "completed",
  last_symbol: null,
  last_error: null,
  started_at: startedAt,
  completed_at: startedAt,
  updated_at: startedAt,
});

describe("scanner history presentation", () => {
  it("groups persisted runs by the America/New_York calendar day", () => {
    const groups = groupScannerRunsByDay(
      [
        scannerRun(1, "2026-08-06T18:00:00Z"),
        scannerRun(2, "2026-08-06T16:00:00Z"),
        scannerRun(3, "2026-08-06T03:30:00Z"),
      ],
      new Date("2026-08-06T20:00:00Z"),
    );

    expect(groups.map((group) => group.dateKey)).toEqual(["2026-08-06", "2026-08-05"]);
    expect(groups[0].label).toBe("Today");
    expect(groups[0].runs.map((run) => run.id)).toEqual([1, 2]);
    expect(groups[1].label).toBe("Wednesday, August 5, 2026");
  });

  it("formats the scheduled run time in Eastern time", () => {
    expect(formatScannerRunTime("2026-08-06T14:00:00Z")).toMatch(/^10:00 AM ED?T$/);
  });
});
