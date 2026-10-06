import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DollarParticipation from "./DollarParticipation";


const payload = {
  as_of: "2026-10-05",
  generated_at: "2026-10-06T12:00:00Z",
  period: { requested_sessions: 504, returned_sessions: 2, start_date: "2026-10-02", end_date: "2026-10-05" },
  current: {
    regime: "bear_against_price",
    regime_label: "Bear-heavy while DXY rose",
    summary: "DXY rose while unusual activity was heavier in the bearish product. This is a divergence in observed activity, not a reversal signal.",
    dxy_level: 99.4,
    dxy_return_20d_pct: 1.8,
    bull_activity_z: 0.4,
    bear_activity_z: 2.1,
    bull_activity_ratio: 1.1,
    bear_activity_ratio: 3.2,
    bull_dollar_activity: 42_000_000,
    bear_dollar_activity: 8_000_000,
    participation_tilt: -2.1,
    participation_intensity: 2.1,
    same_day_association_63d: -0.18,
  },
  history: [
    { date: "2026-10-02", dxy_close: 98.8, dxy_indexed: 100, dxy_return_20d_pct: 1.2, bull_activity_z: 0.2, bear_activity_z: 1.8, bull_excess: 0.2, bear_excess: 1.8, bear_plot: -1.8, participation_tilt: -1.6, participation_intensity: 2, bull_activity_ratio: 1.05, bear_activity_ratio: 2.8, same_day_association_63d: -0.12, regime: "bear_against_price", regime_label: "Bear-heavy while DXY rose" },
    { date: "2026-10-05", dxy_close: 99.4, dxy_indexed: 100.6, dxy_return_20d_pct: 1.8, bull_activity_z: 0.4, bear_activity_z: 2.1, bull_excess: 0.4, bear_excess: 2.1, bear_plot: -2.1, participation_tilt: -1.7, participation_intensity: 2.5, bull_activity_ratio: 1.1, bear_activity_ratio: 3.2, same_day_association_63d: -0.18, regime: "bear_against_price", regime_label: "Bear-heavy while DXY rose" },
  ],
  episodes: [{ start_date: "2026-10-02", end_date: "2026-10-05", sessions: 2, regime: "bear_against_price", label: "Bear-heavy while DXY rose", dxy_change_pct: 0.61, average_tilt: -1.65, average_bull_excess: 0.3, average_bear_excess: 1.95 }],
  instruments: [
    { code: "DXY", provider_symbol: "DX-Y.NYB", name: "ICE U.S. Dollar Index", role: "Price benchmark", direction: "U.S. dollar vs. six-currency basket", leverage: "Index; not a fund", observations_returned: 90, shared_observations: 88, normalization: "Indexed to 100 in the selected window" },
    { code: "UUP", provider_symbol: "UUP", name: "Invesco DB US Dollar Index Bullish Fund", role: "Bullish activity proxy", direction: "Long USDX futures exposure", leverage: "1x directional; not leveraged", observations_returned: 90, shared_observations: 88, normalization: "Own trailing baseline" },
    { code: "UDN", provider_symbol: "UDN", name: "Invesco DB US Dollar Index Bearish Fund", role: "Bearish activity proxy", direction: "Short USDX futures exposure", leverage: "1x inverse directional; not leveraged", observations_returned: 90, shared_observations: 88, normalization: "Own trailing baseline" },
  ],
  data_quality: { status: "ok", provider: "yahoo", price_field: "Adjusted daily close", volume_field: "Reported daily share volume", alignment: "Exact shared market date; no forward fill", shared_observations_before_scoring: 88, warnings: [] },
  methodology: { activity: "Activity is not positioning.", normalization: "Each product uses its own baseline.", fund_size: "Not AUM turnover." },
  sources: [{ label: "ICE methodology", url: "https://www.ice.com/", role: "DXY definition" }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function successfulResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
    text: async () => "",
  } as unknown as Response;
}

describe("DollarParticipation", () => {
  it("keeps activity and positioning explicitly separate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse()));
    render(<DollarParticipation />);

    expect(await screen.findByRole("heading", { level: 1, name: "Dollar Participation" })).not.toBeNull();
    expect(screen.getAllByText("Activity is not positioning").length).toBeGreaterThan(0);
    expect(screen.getByText(/does not identify buyers, sellers, creations, holdings, or net positioning/i)).not.toBeNull();
    expect(screen.getAllByText("Bear-heavy while DXY rose").length).toBeGreaterThan(0);
    expect(screen.getByText("Two sides, kept separate")).not.toBeNull();
  });

  it("requests a longer shared history when the period changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<DollarParticipation />);
    await screen.findByRole("heading", { level: 1, name: "Dollar Participation" });

    fireEvent.click(screen.getByRole("button", { name: "3Y" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("days=756"))).toBe(true));
  });

  it("keeps the completed period selected when a longer-history refresh fails", async () => {
    const failedResponse = {
      ok: false,
      status: 503,
      headers: { get: () => "application/json" },
      json: async () => ({ detail: "History provider unavailable" }),
      text: async () => "History provider unavailable",
    } as unknown as Response;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successfulResponse())
      .mockResolvedValueOnce(failedResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<DollarParticipation />);
    await screen.findByRole("heading", { level: 1, name: "Dollar Participation" });

    fireEvent.click(screen.getByRole("button", { name: "3Y" }));

    expect(await screen.findByText("Showing the prior result")).not.toBeNull();
    expect(screen.getByRole("button", { name: "2Y" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "3Y" }).getAttribute("aria-pressed")).toBe("false");
  });
});
