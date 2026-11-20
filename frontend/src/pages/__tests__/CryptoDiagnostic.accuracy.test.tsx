import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import CryptoDiagnostic from "../CryptoDiagnostic";
const {api} = vi.hoisted(() => ({api: vi.fn()}));
vi.mock("../../hooks/useApi", () => ({useApi: api}));
const refresh = vi.fn();
const assets = ["BTC", "ETH", "SOL", "XRP"].map((symbol, index) => ({symbol, name: symbol, coin_id: symbol.toLowerCase(), color: "#38bdf8", current_price: 120, change_24h: -2, change_30d: -20, market_cap: null, total_volume_24h: null, observed_at: "2026-11-20T15:00:00Z", history: Array.from({length: 220}, (_, i) => ({date: new Date(Date.UTC(2026, 3, 15 + i)).toISOString().slice(0, 10), price: 400-i-index}))}));
let market: Record<string, unknown>;
let focused = true;
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-20T15:10:00Z")); focused = true;refresh.mockClear();
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  market = {as_of: "2026-11-20T15:00:00", source: "CoinGecko", data_quality: {status: "fresh"}, summary: {btc_dominance: 60, total_market_cap: 2e12, market_cap_change_24h: -3, advancing_assets_24h: 0, change_24h_available_assets: 4, monitored_assets: 4}, assets: structuredClone(assets), market_structure_history: []};
  api.mockImplementation((endpoint: string) => ({data: endpoint.startsWith("/crypto/market-overview") ? market : null, loading: false, error: null, refetch: refresh}));
});
afterEach(() => {cleanup();vi.useRealTimers();vi.restoreAllMocks();});
describe("Crypto evidence and refresh", () => {
  it("does not infer flight to safety from high dominance while every asset is falling", () => {
    render(<CryptoDiagnostic />);
    expect(screen.getByText("Basket weakness")).toBeTruthy();
    expect(screen.queryByText("Flight To Quality")).toBeNull();
    expect(screen.getAllByText(/Technical daily bar/)).toHaveLength(4);
    expect(screen.getAllByText(/Latest quote/)).toHaveLength(4);
  });
  it("does not replace missing monthly changes with zero", () => {
    (market.assets as typeof assets)[0].change_30d = null as unknown as number;
    render(<CryptoDiagnostic />);
    expect(screen.getByText("Partial coverage")).toBeTruthy();
    expect(screen.getByText(/3\/4 assets have 30-day changes/)).toBeTruthy();
  });
  it("withholds the basket classification when the source is stale", () => {
    market.data_quality = {status: "stale", reason: "Old provider snapshot"};
    render(<CryptoDiagnostic />);
    expect(screen.getByText("Stale / unavailable")).toBeTruthy();
    expect(screen.queryByText("Basket weakness")).toBeNull();
  });
  it("retains observations while checking and continues slower checks in the background", () => {
    api.mockImplementation((endpoint: string) => ({data: endpoint.startsWith("/crypto/market-overview") ? market : null, loading: true, error: null, refetch: refresh}));
    render(<CryptoDiagnostic />);
    expect(screen.getByRole("heading", {name: "Crypto Regime Snapshot"})).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));expect(refresh).toHaveBeenCalledTimes(2);
    focused=false;act(() => {window.dispatchEvent(new Event("blur"));vi.advanceTimersByTime(300_000);});
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});
