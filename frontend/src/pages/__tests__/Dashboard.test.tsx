import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    localStorage.setItem("live-news:dashboard", "off");
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem("live-news:dashboard");
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts enabled, loads in view, and remembers when the compact feed is turned off", async () => {
    apiFetchMock.mockResolvedValue([]);
    localStorage.removeItem("live-news:dashboard");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let setIntersection = (_visible: boolean) => {};
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        setIntersection = (isIntersecting) =>
          callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      observe() {}
      disconnect() {}
    });
    const liveFetch = vi.fn(async () => Response.json({
      updated_at: "2026-11-18T12:00:00Z",
      checked_label: "Nov 18, 7:00:00 AM EST",
      read_interval: 5,
      topics: { markets: "Markets" },
      page: 1, pages: 1, total: 8, first: 1, last: 8,
      sources: [], featured: [],
      articles: Array.from({ length: 8 }, (_, index) => ({
        id: String(index), title: `Focused headline ${index + 1}`, url: `https://example.com/news/${index}`,
        source: "Example", published_at: "2026-11-18T12:00:00Z",
        topic: "markets", priority: "High", score: 32, reasons: [], summary: "", cached: false,
      })),
    }));
    vi.stubGlobal("fetch", liveFetch);
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const drivers = screen.getByRole("region", { name: "What is moving the read" });
    const liveSection = screen.getByRole("region", { name: "Live news" });
    expect(drivers.nextElementSibling).toBe(liveSection);
    const live = within(liveSection);
    expect(liveFetch).not.toHaveBeenCalled();
    expect(live.getByRole("link", { name: "Open News tab" }).getAttribute("href")).toBe("/news");
    expect(live.getByRole("button", { name: "Turn off live news" })).toBeTruthy();
    act(() => setIntersection(true));
    const headlines = await live.findByRole("list", { name: "Live headlines" });
    expect(within(headlines).getAllByRole("link")).toHaveLength(6);
    const views = within(live.getByRole("group", { name: "Live news view" }));
    expect(views.getByRole("button", { name: "Focused", pressed: true })).toBeTruthy();
    expect(live.getByText("Nov 18, 7:00:00 AM EST").getAttribute("datetime")).toBe("2026-11-18T12:00:00Z");
    expect(live.queryByRole("button", { name: "Weights" })).toBeNull();
    expect(liveFetch).toHaveBeenCalledWith(expect.stringContaining("/snapshot?view=focused"), expect.anything());

    fireEvent.change(live.getByRole("combobox", { name: "Topic" }), { target: { value: "markets" } });
    await waitFor(() => expect(liveFetch).toHaveBeenCalledWith(expect.stringContaining("view=focused&topic=markets"), expect.anything()));
    fireEvent.click(views.getByRole("button", { name: "Wires" }));
    await waitFor(() => expect(liveFetch).toHaveBeenCalledWith(expect.stringContaining("view=wire&topic=markets"), expect.anything()));
    fireEvent.click(views.getByRole("button", { name: "All News" }));
    await waitFor(() => expect(liveFetch).toHaveBeenCalledWith(expect.stringContaining("view=all&topic=markets"), expect.anything()));
    expect(within(await live.findByRole("list", { name: "Live headlines" })).getAllByRole("link")).toHaveLength(6);
    vi.useFakeTimers();
    await act(async () => setIntersection(false));
    expect(live.getByRole("list", { name: "Live headlines" })).toBeTruthy();
    const requests = liveFetch.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(59_000));
    expect(liveFetch.mock.calls).toHaveLength(requests);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(liveFetch.mock.calls.length).toBeGreaterThan(requests);
    expect(liveFetch).toHaveBeenCalledWith("/live-news/activity", expect.objectContaining({
      headers: { "X-Live-News": "1", "X-Live-News-Mode": "background" },
    }));
    fireEvent.click(live.getByRole("button", { name: "Turn off live news" }));
    expect(live.queryByRole("list", { name: "Live headlines" })).toBeNull();
    expect(localStorage.getItem("live-news:dashboard")).toBe("off");
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
