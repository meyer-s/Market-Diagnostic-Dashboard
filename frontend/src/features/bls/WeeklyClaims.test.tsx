import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WeeklyClaims, { type WeeklyClaimsData } from "./WeeklyClaims";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));
vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));

const data: WeeklyClaimsData = {
  status: "current", source_url: "https://www.dol.gov/ui/data.pdf",
  released_on: "2026-10-22", checked_at: "2026-10-22T12:40:00Z",
  initial_claims: { week_ending: "2026-10-17", value: 194000, change: -6000, prior_revised: 200000 },
  continuing_claims: { week_ending: "2026-10-10", value: 1728000, change: 25000, prior_revised: 1703000 },
};

describe("WeeklyClaims", () => {
  afterEach(cleanup);
  it("keeps publication date, distinct reference weeks, and revised comparisons explicit", () => {
    useApiMock.mockReturnValue({ data, loading: false, error: null, refetch: vi.fn() });
    render(<WeeklyClaims />);
    expect(screen.getByText(/Released Oct 22, 2026/)).toBeTruthy();
    expect(screen.getByText("194,000")).toBeTruthy();
    expect(screen.getByText("1,728,000")).toBeTruthy();
    expect(screen.getByText("Week ending Oct 17, 2026")).toBeTruthy();
    expect(screen.getByText("Week ending Oct 10, 2026")).toBeTruthy();
    expect(screen.getByText("-6,000 vs revised prior week")).toBeTruthy();
  });
  it("marks retained values stale when a new check fails", () => {
    useApiMock.mockReturnValue({ data, loading: false, error: "failed", refetch: vi.fn() });
    render(<WeeklyClaims />);
    expect(screen.getByRole("status").textContent).toContain("may be stale");
    expect(screen.getByText("194,000")).toBeTruthy();
  });
  it("shows an explicit unavailable state without fabricated readings", () => {
    useApiMock.mockReturnValue({ data: { status: "unavailable", message: "DOL unavailable" }, loading: false, error: null, refetch: vi.fn() });
    render(<WeeklyClaims />);
    expect(screen.getByRole("status").textContent).toContain("DOL unavailable");
    expect(screen.queryByText("194,000")).toBeNull();
  });

  it("leads the compact receipt with interpretation and retains exact weekly evidence on demand", () => {
    useApiMock.mockReturnValue({ data, loading: false, error: null, refetch: vi.fn() });
    render(<WeeklyClaims compact />);
    expect(screen.getByText(/New filings fell while ongoing claims rose/)).toBeTruthy();
    expect(screen.getByText(/different reference weeks/)).toBeTruthy();
    const disclosure = screen.getByText("Weekly levels & revised comparisons").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    expect(disclosure?.textContent).toContain("194,000");
    expect(disclosure?.textContent).toContain("Oct 10, 2026");
  });
});
