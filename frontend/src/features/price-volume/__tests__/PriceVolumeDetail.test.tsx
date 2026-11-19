import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PriceVolumeDetail from "../PriceVolumeDetail";
import { longestStreak, referenceRange, refreshTime, sessionDate } from "../format";
import { activitySignal } from "./fixtures";

afterEach(cleanup);

describe("price-volume accuracy", () => {
  it("keeps session dates and treats legacy naive refresh times as UTC", () => {
    expect(sessionDate("2026-11-12")).toBe("Nov 12, 2026");
    expect(refreshTime("2026-11-19T13:08:15.708159")).toBe(refreshTime("2026-11-19T13:08:15.708159Z"));
  });

  it("does not join separated weeks into a streak", () => {
    const weeks = ["2026-08-17", "2026-09-14", "2026-09-21", "2026-11-02"].map(bucket => ({ ...activitySignal.flow_timeline[0], bucket }));
    expect(longestStreak(weeks, "positive")).toBe(2);
    expect(longestStreak([...weeks, { ...weeks[0], bucket: "2026-11-09", signed_turnover_usd: 0 }], "positive")).toBe(2);
  });

  it("orders reversed references, handles equal prices and missing references", () => {
    expect(referenceRange(42.52, 43.7177, 43.62)?.location).toBe("Within reference range");
    expect(referenceRange(42.52, 43.7177, 43.62)?.lowLabel).toBe("Positive-bar reference");
    expect(referenceRange(43, 43, 43)?.position).toBe(50);
    expect(referenceRange(null, 43, 42)).toBeNull();
  });

  it("shows signed turnover, corrected distance, zero-trigger weeks and no confidence score", () => {
    render(<PriceVolumeDetail signal={activitySignal} />);
    expect(screen.getByText("Signed flagged turnover · full window")).not.toBeNull();
    expect(screen.getByText(/0 flagged \/ 3 observed/)).not.toBeNull();
    expect(screen.queryByText(/confidence|To Buy|accumulation/i)).toBeNull();
    fireEvent.click(screen.getByText("Flagged closing-price references"));
    expect(screen.getByText("Price change to reference: +51.0%")).not.toBeNull();
    expect(screen.getByText("Below reference range")).not.toBeNull();
  });
});
