import { act, cleanup, render, screen } from "@testing-library/react";
import fixture from "../../../tests/visual/fixtures/metals-review.json";
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
});
