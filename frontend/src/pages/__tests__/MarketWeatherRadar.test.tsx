import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketWeatherResponse } from "../../types/marketWeather";
import MarketWeatherRadar from "../MarketWeatherRadar";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("../../components/marketWeather/MarketWeatherCanvas", () => ({
  default: () => <div>Field canvas</div>,
}));
vi.mock("../../components/marketWeather/MarketWeatherMethodologyReport", () => ({
  default: () => <div>Methodology report</div>,
}));
vi.mock("../../components/marketWeather/MarketWeatherResearchLab", () => ({
  default: ({ onViewChange }: { onViewChange?: (view: "dictionary") => void }) => (
    <button type="button" onClick={() => onViewChange?.("dictionary")}>Open dictionary</button>
  ),
}));

const DATA = {
  symbol: "SPY",
  generated_at: "2026-07-22T14:30:00Z",
  data_source: "yahoo",
  quote: { price: 640, source: "yahoo", quote_source: null, observed_at: "2026-07-22T14:29:00Z" },
  bar_size: "1 day",
  timeframe: "1D",
  requested_bars: 750,
  available_bars: 2,
  coverage_start: "2026-07-21",
  coverage_end: "2026-07-22",
  orientation: "horizon_by_time",
  dates: ["2026-07-21", "2026-07-22"],
  horizons: [8],
  price: [
    { date: "2026-07-21", open: 638, high: 640, low: 637, close: 639, volume: 1 },
    { date: "2026-07-22", open: 639, high: 641, low: 638, close: 640, volume: 1 },
  ],
  channels: { pressure: [[0.1, 0.2]] },
  summary: {},
  latest_profile: [],
  settings: {},
  research: {},
  methodology: { causal: true, description: "Causal", research_status: "Research" },
} as unknown as MarketWeatherResponse;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function HistoryBack() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Back one report</button>;
}

function renderPage(entry = "/market-weather") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MarketWeatherRadar />
      <LocationProbe />
      <HistoryBack />
    </MemoryRouter>,
  );
}

describe("MarketWeatherRadar report state", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    useApiMock.mockReturnValue({ data: DATA, loading: false, error: null, refetch: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses a deep-link recipe for the first API request", () => {
    renderPage("/market-weather?symbol=iwm&timeframe=15m&bars=913&view=dictionary");

    const firstEndpoint = String(useApiMock.mock.calls[0]?.[0]);
    expect(firstEndpoint).toContain("symbol=IWM");
    expect(firstEndpoint).toContain("timeframe=15m");
    expect(firstEndpoint).toContain("bars=913");
    expect(firstEndpoint).not.toContain("symbol=SPY");
  });

  it("writes a canonical recipe on Analyze and keeps presentation state linkable", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Ticker symbol"), { target: { value: "IWM" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(screen.getByTestId("location-search").textContent).toContain("symbol=IWM"));
    expect(screen.getByTestId("location-search").textContent).toContain("v=1");
    expect(screen.getByTestId("location-search").textContent).toContain("timeline_window=120");

    fireEvent.click(screen.getByRole("button", { name: "Open dictionary" }));
    await waitFor(() => expect(screen.getByTestId("location-search").textContent).toContain("view=dictionary"));

    fireEvent.click(screen.getByRole("button", { name: "Back one report" }));
    await waitFor(() => expect((screen.getByLabelText("Ticker symbol") as HTMLInputElement).value).toBe("SPY"));
  });

  it("resynchronizes a draft when normalization produces the already-applied recipe", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Ticker symbol"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect((screen.getByLabelText("Ticker symbol") as HTMLInputElement).value).toBe("SPY"));
    expect(screen.getByTestId("location-search").textContent).toContain("symbol=SPY");
  });

  it("does not mount the Raw Data chart and table until the disclosure opens", async () => {
    renderPage();
    expect(screen.queryByText("Price versus aggregate pressure")).toBeNull();

    const details = screen.getByText("Horizon field, outcomes, and provenance").closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));
    await waitFor(() => expect(screen.getByText("Price versus aggregate pressure")).not.toBeNull());
  });

  it("reports requested-history shortfall separately from mature initialization", () => {
    useApiMock.mockReturnValue({
      data: {
        ...DATA,
        available_bars: 480,
        history_context: {
          requested_visible_bars: 750,
          visible_bars: 480,
          analysis_bars: 608,
          warmup_buffer_requested: 128,
          warmup_buffer_received: 128,
          maximum_horizon_bars: 64,
          minimum_observed_window_bars: 96,
          target_warmup_bars: 128,
          warmup_complete: true,
          status: "complete",
        },
      } as MarketWeatherResponse,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("History 480 / 750")).not.toBeNull();
    expect(screen.getByText("Initialization mature")).not.toBeNull();
    expect(screen.getByText(/Requested-history shortfall: the provider returned 480 of 750 visible bars \(270 missing\)/i)).not.toBeNull();
    expect(screen.getByText(/does not make this a full requested-history response/i)).not.toBeNull();
    expect(screen.queryByText("Warm-up covered")).toBeNull();
  });
});
