import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorProjections from "../SectorProjections";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));
vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return { Area: Empty, AreaChart: Shell, Line: Empty, LineChart: Shell,
    ResponsiveContainer: Shell, Tooltip: Empty, XAxis: Empty, YAxis: Empty,
    CartesianGrid: Empty, ReferenceArea: Empty, ReferenceLine: Empty };
});
const symbols = ["XLE", "XLF", "XLK", "XLY", "XLP", "XLV", "XLI", "XLU", "XLB", "XLRE", "XLC"];
const horizons = ["T", "3m", "6m", "12m"];
const latest = () => ({ run_id: 42, as_of_date: "2026-11-19", price_as_of_date: "2026-11-18", system_state: "RED", data_warnings: [],
  projections: Object.fromEntries(horizons.map(h => [h, symbols.map((symbol, i) => ({
    sector_symbol: symbol, sector_name: symbol, score_total: 90 - i * 5, score_trend: 80, score_rel: 70,
    score_risk: 60, score_regime: 50, rank: i + 1, classification: i < 3 ? "Winner" : "Neutral",
    metrics: { return: 0.01 * (i + 1), sma_dist: 0.02, rel_ret: 0.03, vol: 0.2, drawdown: -0.05 },
  }))])), historical: {} });
const analytics = () => ({ run_id: 42, as_of_date: "2026-11-19", leadership_comparisons: [],
  sectors: Object.fromEntries(symbols.map((symbol, i) => [symbol, {
    sector_symbol: symbol, sector_name: symbol, history_3m: [],
    horizons: Object.fromEntries(horizons.map(h => [h, { stable_score: 89 - i * 5, stable_rank: i + 1, scanner_overlay: 0.2 }])),
    forward_scenarios: Object.fromEntries(horizons.map(h => [h, { projected_score: 88 - i * 5, projected_low: 80 - i * 5, projected_high: 95 - i * 5 }])),
  }])) });
function responses(a: ReturnType<typeof analytics> | null, error: string | null = null) {
  const l = latest();
  useApiMock.mockImplementation((endpoint: string) => ({ data: endpoint.includes("analytics") ? a : l, loading: false,
    error: endpoint.includes("analytics") ? error : null, refetch: vi.fn() }));
}
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
describe("sector data integrity", () => {
  it("separates run and price sessions and shows matched forward scenarios", () => {
    responses(analytics()); render(<SectorProjections />);
    expect(screen.getByText("Run 2026-11-19")).toBeTruthy();
    expect(screen.getByText("Prices through 2026-11-18")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Stabilized Sector Forward Scenarios" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Methodology & Algorithm Details" }));
    expect(screen.getByText(/10 sessions; the 3M, 6M and 12M inputs use 63, 126 and 200/)).toBeTruthy();
  });
  it("keeps raw rankings but never relabels them as forecasts on analytics failure", () => {
    responses(null, "Unavailable"); render(<SectorProjections />);
    expect(screen.queryByRole("heading", { name: "Stabilized Sector Forward Scenarios" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Trailing Input Rankings" })).toBeTruthy();
    expect(screen.getByText(/Raw composite scores are shown/)).toBeTruthy();
  });
  it("rejects analytics from a different run", () => {
    const a = analytics(); a.run_id = 41; responses(a); render(<SectorProjections />);
    expect(screen.getByText(/different runs/)).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Projected sector scores/ })).toBeNull();
    expect(screen.getByText(/Raw composite scores are shown/)).toBeTruthy();
  });
  it("omits an incomplete scenario path rather than plotting missing values as zero", () => {
    const a = analytics(); delete a.sectors.XLK.forward_scenarios["6m"]; responses(a); render(<SectorProjections />);
    const selector = screen.getByRole("region", { name: /Sector selector/ });
    expect(within(selector).queryByRole("button", { name: "XLK" })).toBeNull();
    expect(within(selector).getByRole("button", { name: "XLE" })).toBeTruthy();
    expect(screen.getByText(/Only sectors with all four scenario observations/)).toBeTruthy();
  });
});
