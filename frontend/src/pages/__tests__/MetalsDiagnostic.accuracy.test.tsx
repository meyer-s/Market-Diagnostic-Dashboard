import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import fixture from "./fixtures/metals-review.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PreciousMetalsDiagnostic from "../PreciousMetalsDiagnostic";
const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));
vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("../../components/widgets/OptionsStructureMap", () => ({ OptionsStructureMap: () => <div>Structure chart</div> }));
const refresh = vi.fn();
let foreground = true;
beforeEach(() => {
  vi.useFakeTimers(); foreground = true; refresh.mockClear();
  vi.spyOn(document, "hasFocus").mockImplementation(() => foreground);
  useApiMock.mockImplementation((endpoint: string) => ({ data: endpoint.endsWith("/regime") ? fixture.regime : endpoint.endsWith("projections/latest") ? fixture.projections : null, loading: false, error: null, refetch: refresh }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Metals diagnostic data and updates", () => {
  it("continues automatic checks at a lower frequency out of focus", () => {
    render(<PreciousMetalsDiagnostic />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(refresh).toHaveBeenCalledTimes(5);
    foreground = false; act(() => { window.dispatchEvent(new Event("blur")); vi.advanceTimersByTime(299_999); });
    expect(refresh).toHaveBeenCalledTimes(5);
    act(() => { vi.advanceTimersByTime(1); });
    expect(refresh).toHaveBeenCalledTimes(10);
  });
  it("describes broad weakness when no metal has positive momentum", () => {
    render(<PreciousMetalsDiagnostic />);
    expect(screen.getAllByText(/None of the 6 tracked metals has positive momentum/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/points to broader participation/)).toBeNull();
    expect(screen.getByText(/60% moving-average trend and 40% RSI/)).toBeTruthy();
  });
  it("keeps existing observations visible during an automatic refresh", () => {
    useApiMock.mockImplementation((endpoint: string) => ({ data: endpoint.endsWith("/regime") ? fixture.regime : endpoint.endsWith("projections/latest") ? fixture.projections : null, loading: true, error: null, refetch: refresh }));
    render(<PreciousMetalsDiagnostic />);
    expect(screen.getByRole("heading", {name:"Winners & Losers Right Now"})).toBeTruthy();
  });
  it("distinguishes a high partial monetary score from broad confirmation", () => {
    const regime = structuredClone(fixture.regime);
    Object.assign(regime.price_anchors, {monetary_hedge_strength: 96, monetary_hedge_available_components: 1, monetary_hedge_total_components: 3});
    Object.assign(regime.cb_context, {coverage: {latest_reporting_countries: 54, prior_year_reporting_countries: 101, matched_yoy_countries: 53, scope: "Reporting sample, not all central banks."}});
    useApiMock.mockImplementation((endpoint: string) => ({data: endpoint.endsWith("/regime") ? regime : endpoint.endsWith("projections/latest") ? fixture.projections : null, loading: false, error: null, refetch: refresh}));
    render(<PreciousMetalsDiagnostic />);
    expect(screen.getByText(/Monetary context is incomplete/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", {name: "Deep Dive"}));
    const card = screen.getByRole("heading", {name: "Monetary Context"}).closest(".primary-card") as HTMLElement;
    expect(within(card).getByText("96").className).toContain("text-amber-300");
    expect(within(card).getByText(/1\/3 inputs available; partial estimate/)).toBeTruthy();
    expect(screen.getByText(/54 countries in the latest snapshot/)).toBeTruthy();
    expect(screen.getByText(/Positive = real rates below/)).toBeTruthy();
    expect(screen.queryByText(/floor under price/)).toBeNull();
  });
});
