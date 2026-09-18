import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Dashboard from "../Dashboard";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock("../../utils/apiUtils", async () => {
  const actual = await vi.importActual<typeof import("../../utils/apiUtils")>("../../utils/apiUtils");
  return {
    ...actual,
    apiFetch: apiFetchMock,
  };
});

vi.mock("../../components/widgets/SystemOverviewWidget", () => ({
  default: () => <div>System Overview Widget</div>,
}));
vi.mock("../../components/widgets/DowTheoryWidget", () => ({
  default: () => <div>Dow Theory Widget</div>,
}));
vi.mock("../../components/widgets/SectorDivergenceWidget", () => ({
  default: () => <div>Sector Divergence Widget</div>,
}));
vi.mock("../../components/widgets/AASWidget", () => ({
  default: () => <div>AAS Widget</div>,
}));
vi.mock("../../components/widgets/YieldCurveCard", () => ({
  default: () => <div>Live Treasury Curve Widgets</div>,
}));
vi.mock("../../components/widgets/EconomicDriverSnapshots", () => ({
  default: () => <div>Real Economy Snapshot Widgets</div>,
}));
vi.mock("../../components/widgets/IndicatorCard", () => ({
  default: ({ indicator }: { indicator: { code: string; score: number | null } }) => (
    <div>{`${indicator.code}:${indicator.score ?? "N/A"}`}</div>
  ),
}));

describe("Dashboard", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders without a public refresh trigger and only calls public endpoints", async () => {
    apiFetchMock
      .mockResolvedValueOnce([
        { code: "VIX", name: "VIX", raw_value: null, score: null, state: "UNKNOWN", timestamp: null },
        { code: "REAL_ESTATE_STABILITY", name: "Real Estate Stability", raw_value: 38, score: 38, state: "RED", timestamp: "2026-09-18T12:03:01" },
        { code: "AGRICULTURE_STABILITY", name: "Agriculture Stability", raw_value: 43, score: 43, state: "YELLOW", timestamp: "2026-09-18T12:03:01" },
        { code: "ENERGY_STABILITY", name: "Energy Stability", raw_value: 76, score: 76, state: "GREEN", timestamp: "2026-09-18T12:02:23" },
      ])
      .mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("VIX:N/A")).not.toBeNull());

    expect(screen.getByText("The Treasury curve at a glance")).not.toBeNull();
    expect(screen.getByText("Live Treasury Curve Widgets")).not.toBeNull();
    expect(screen.getByText("Real Economy Snapshot Widgets")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "What is moving the read" })).not.toBeNull();
    expect(screen.getByText("4 active indicators")).not.toBeNull();
    expect(screen.queryByText("REAL_ESTATE_STABILITY:38")).toBeNull();
    expect(screen.queryByText("AGRICULTURE_STABILITY:43")).toBeNull();
    expect(screen.queryByText("ENERGY_STABILITY:76")).toBeNull();
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/indicators");
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/news?hours=24&limit=200");
    expect(
      apiFetchMock.mock.calls.some(([endpoint]) => String(endpoint).includes("/admin/ingest/run"))
    ).toBe(false);
  });

  it("shows a failed-load state when indicators cannot be fetched", async () => {
    apiFetchMock
      .mockRejectedValueOnce(new Error("Indicators failed"))
      .mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText(/Some dashboard evidence is unavailable/i)).not.toBeNull()
    );
    expect(screen.getByText(/Indicators failed/)).not.toBeNull();
  });
});
