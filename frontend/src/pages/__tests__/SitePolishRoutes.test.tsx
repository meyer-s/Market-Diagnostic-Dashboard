import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarketNews from "../MarketNews";
import SystemBreakdown from "../SystemBreakdown";
import RecapPost from "../tools/RecapPost";
import VolumeBreadthTools from "../tools/VolumeBreadthTools";

const { apiFetchMock, useApiMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("../../utils/apiUtils", () => ({
  apiFetch: apiFetchMock,
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Unexpected error.",
}));
vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    Bar: Empty,
    CartesianGrid: Empty,
    Cell: Empty,
    ComposedChart: Shell,
    Legend: Empty,
    Line: Empty,
    Pie: Empty,
    PieChart: Shell,
    ResponsiveContainer: Shell,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

const newsArticles = Array.from({ length: 25 }, (_, index) => ({
  id: index + 1,
  symbol: "AAPL",
  sector: "TECH",
  title: `Headline ${String(index + 1).padStart(2, "0")}`,
  link: `https://example.com/news/${index + 1}`,
  source: "Example",
  published_at: `2026-07-${String((index % 25) + 1).padStart(2, "0")}T12:00:00Z`,
}));

const breadthBucket = {
  label: "Exchange",
  source: "direct",
  advancing: 120,
  declining: 80,
  advancing_pct: 60,
  declining_pct: 40,
  volume_advancing: 1_200_000,
  volume_declining: 800_000,
  volume_advancing_pct: 62,
  volume_declining_pct: 38,
  new_highs: 30,
  new_lows: 10,
  new_highs_pct: 75,
  new_lows_pct: 25,
  participation_pct: 88,
  universe_size: 200,
  history: [
    {
      date: "2026-07-28",
      advancing_pct: 58,
      declining_pct: 42,
      ad_rate: 32,
      volume_advancing_pct: 60,
      participation_pct: 86,
    },
    {
      date: "2026-07-29",
      advancing_pct: 60,
      declining_pct: 40,
      ad_rate: 40,
      volume_advancing_pct: 62,
      participation_pct: 88,
    },
  ],
};

describe("site-polish route contracts", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    useApiMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps Market News filters and pagination in the URL while bounding the first view", async () => {
    useApiMock.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/news?")) {
        return { data: newsArticles, loading: false, error: null, refetch: vi.fn() };
      }
      if (endpoint === "/news/tickers") {
        return {
          data: { count: 1, tickers: [{ symbol: "AAPL", sector: "TECH" }] },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: { presets: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    render(
      <MemoryRouter initialEntries={["/news?window=24&sort=oldest&page=2"]}>
        <MarketNews />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Market News" })).not.toBeNull();
    expect(screen.getByText("Showing 13–24 of 25 headlines")).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(12);
    expect(screen.getByRole("button", { name: "24h" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Sort") as HTMLSelectElement).value).toBe("oldest");

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByTestId("location-search").textContent).not.toContain("page="));
    expect(screen.getByText("Showing 1–12 of 25 headlines")).not.toBeNull();
  });

  it("preserves a shared Market News page while articles are still loading", async () => {
    useApiMock.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/news?")) {
        return { data: null, loading: true, error: null, refetch: vi.fn() };
      }
      if (endpoint === "/news/tickers") {
        return { data: null, loading: true, error: null, refetch: vi.fn() };
      }
      return { data: null, loading: true, error: null, refetch: vi.fn() };
    });

    render(
      <MemoryRouter initialEntries={["/news?page=2"]}>
        <MarketNews />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location-search").textContent).toBe("?page=2");
    expect(screen.getByText("Loading cached headlines…")).not.toBeNull();
  });

  it("labels breadth selection and provides a readable equivalent for each chart", async () => {
    apiFetchMock.mockResolvedValue({
      as_of: new Date().toISOString(),
      exchanges: {
        amex: { ...breadthBucket, label: "AMEX" },
        nyse: { ...breadthBucket, label: "NYSE" },
        nsdq: { ...breadthBucket, label: "Nasdaq" },
      },
    });

    render(<VolumeBreadthTools />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "90d" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("3 of 3 exchanges representative")).not.toBeNull();
    expect(screen.getAllByText(/Latest history point:/)).toHaveLength(3);
    expect(
      screen.getByRole("region", { name: "AMEX recent breadth data table" }),
    ).not.toBeNull();
  });

  it("does not describe unavailable breadth placeholders as usable exchange data", async () => {
    const unavailableBucket = {
      ...breadthBucket,
      source: "unavailable",
      advancing: 0,
      declining: 0,
      advancing_pct: 0,
      declining_pct: 0,
      participation_pct: 0,
      history: [],
    };
    apiFetchMock.mockResolvedValue({
      as_of: new Date().toISOString(),
      exchanges: {
        amex: { ...unavailableBucket, label: "AMEX" },
        nyse: { ...unavailableBucket, label: "NYSE" },
        nsdq: { ...unavailableBucket, label: "Nasdaq" },
      },
    });

    render(<VolumeBreadthTools />);

    expect(await screen.findByRole("heading", { name: "No usable exchange snapshots" })).not.toBeNull();
    expect(screen.getByText("0 of 3 exchanges representative")).not.toBeNull();
    expect(screen.getAllByText(/did not return enough fields/)).toHaveLength(3);
    expect(screen.queryByText("3 of 3 exchanges representative")).toBeNull();
  });

  it("labels sparse breadth-symbol aggregates as partial without hiding their directional data", async () => {
    const sparseAggregate = {
      ...breadthBucket,
      source: "breadth-symbols",
      advancing: 25,
      declining: 20,
      participation_pct: 1.5,
      universe_size: 3_003,
    };
    apiFetchMock.mockResolvedValue({
      as_of: new Date().toISOString(),
      exchanges: {
        amex: { ...sparseAggregate, label: "AMEX" },
        nyse: { ...sparseAggregate, label: "NYSE" },
        nsdq: { ...sparseAggregate, label: "Nasdaq" },
      },
    });

    render(<VolumeBreadthTools />);

    expect(await screen.findByText("0 of 3 exchanges representative")).not.toBeNull();
    expect(screen.getByText("3 partial snapshots")).not.toBeNull();
    expect(screen.getAllByText(/Partial aggregate:/)).toHaveLength(3);
    expect(
      screen.getByText(/counts are not being described as full-universe coverage/),
    ).not.toBeNull();
    expect(screen.getAllByText(/Latest history point:/)).toHaveLength(3);
  });

  it("surfaces backend stale-snapshot provenance for breadth data", async () => {
    apiFetchMock.mockResolvedValue({
      as_of: new Date().toISOString(),
      data_quality: {
        status: "stale",
        stale: true,
        reason: "breadth_refresh_incomplete",
        snapshot_cached_at: "2026-07-28T15:00:00Z",
        snapshot_age_seconds: 20_000,
        representative_exchange_coverage: 3,
      },
      exchanges: {
        amex: { ...breadthBucket, label: "AMEX" },
        nyse: { ...breadthBucket, label: "NYSE" },
        nsdq: { ...breadthBucket, label: "Nasdaq" },
      },
    });

    const { container } = render(<VolumeBreadthTools />);

    expect(await screen.findByText("Stale snapshot")).not.toBeNull();
    expect(
      screen.getByText(/Showing last-known-good exchange breadth/),
    ).not.toBeNull();
    expect(screen.getByText(/5.6 hours old/)).not.toBeNull();
    expect(
      container.querySelector('[data-evidence-panel="exchange-breadth"]')?.getAttribute(
        "data-evidence-state",
      ),
    ).toBe("stale");
  });

  it("keeps a recap article first and distinguishes legacy from explicit decorative images", async () => {
    const detail = {
      id: "recap-1",
      created_at: "2026-07-29T12:00:00Z",
      title: "July 29 Market Recap",
      slug: "july-29-market-recap",
      summary: "Conditions remained mixed. Breadth improved late in the session.",
      status: "YELLOW" as const,
      tags: ["market"],
      pinned: false,
      content_markdown:
        "# Repeated markdown title\n\n| Signal | Read |\n| --- | --- |\n| Breadth | Improving |\n\n![](https://example.com/supporting.png)\n\n![decorative](https://example.com/divider.svg)",
      chart_urls: [],
      published: true,
    };
    useApiMock.mockImplementation((endpoint: string) => ({
      data: endpoint.includes("/by-slug/") ? detail : [detail],
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));

    render(
      <MemoryRouter initialEntries={["/tools/recap/july-29-market-recap"]}>
        <Routes>
          <Route path="/tools/recap/:slug" element={<RecapPost />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: detail.title })).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Repeated markdown title" }),
    ).not.toBeNull();
    expect(screen.getByAltText(`Supporting figure for ${detail.title}`)).not.toBeNull();
    const decorativeImage = document.querySelector<HTMLImageElement>(
      'img[src="https://example.com/divider.svg"]',
    );
    expect(decorativeImage).not.toBeNull();
    expect(decorativeImage?.getAttribute("alt")).toBe("");
    expect(decorativeImage?.hasAttribute("title")).toBe(false);
    expect(screen.getByRole("region", { name: `Data table in ${detail.title}` })).not.toBeNull();

    const recentPanel = document.getElementById("recent-recap-posts");
    expect(recentPanel?.className).toContain("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Recent recaps" }));
    expect(recentPanel?.className).not.toContain("hidden");
  });

  it("contains the System Breakdown heatmap in a labeled keyboard-scrollable region", async () => {
    const indicators = [
      {
        code: "VIX",
        name: "VIX",
        state: "GREEN",
        score: 76,
        weight: 1,
      },
    ];
    useApiMock.mockReturnValue({
      data: indicators,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/indicators") return Promise.resolve(indicators);
      return Promise.resolve([
        {
          timestamp: "2026-07-29T12:00:00Z",
          state: "GREEN",
          score: 76,
        },
      ]);
    });

    render(<SystemBreakdown />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "System Breakdown & Methodology",
      }),
    ).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const region = screen.getByRole("region", {
      name: "Historical State Distribution (1 Year)",
    });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("overflow-x-auto");
    expect(screen.getByLabelText("Explain indicator grouping and weights")).not.toBeNull();
  });
});
