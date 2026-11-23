import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routeLifecycle } = vi.hoisted(() => ({
  routeLifecycle: { mounts: 0, unmounts: 0 },
}));

vi.mock("./components/layout/Topbar", () => ({ default: () => <nav>Navigation</nav> }));
vi.mock("./components/layout/Footer", () => ({ default: () => <footer>Footer</footer> }));
vi.mock("./components/layout/RouteExperience", () => ({ default: () => null }));
vi.mock("./utils/analytics", () => ({ trackPageView: vi.fn() }));
vi.mock("./utils/marketWeatherPairTelemetry", () => ({
  trackSubsequentOptionsOpen: vi.fn(),
}));
vi.mock("./routes/registry", async () => {
  const React = await import("react");
  const { Link, useLocation } = await import("react-router-dom");
  return {
    AppRoutes: () => {
      const location = useLocation();
      React.useEffect(() => {
        routeLifecycle.mounts += 1;
        return () => {
          routeLifecycle.unmounts += 1;
        };
      }, []);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Link, { to: "?position=SPY" }, "Select SPY"),
        React.createElement(Link, { to: "/sectors" }, "Open sectors"),
        React.createElement("output", { "data-testid": "route-search" }, location.search),
      );
    },
    getAnalyticsNameForPath: () => "Test route",
    getPageNameForPath: () => "Test route",
  };
});

import { AppWithAnalytics } from "./App";
import { trackPageView } from "./utils/analytics";

describe("application route lifecycle", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    routeLifecycle.mounts = 0;
    routeLifecycle.unmounts = 0;
  });

  it("preserves healthy route state when only query parameters change", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/secret/options"]}>
        <AppWithAnalytics />
      </MemoryRouter>,
    );

    expect(routeLifecycle.mounts).toBe(1);
    await user.click(screen.getByRole("link", { name: "Select SPY" }));
    await waitFor(() =>
      expect(screen.getByTestId("route-search").textContent).toBe("?position=SPY"),
    );

    expect(routeLifecycle.mounts).toBe(1);
    expect(routeLifecycle.unmounts).toBe(0);
  });

  it("records the discussion anchor without private unlock data", () => {
    const placeholder = "x".repeat(43);
    render(<MemoryRouter initialEntries={[`/news#wsb-unlock=${placeholder}`]}><AppWithAnalytics /></MemoryRouter>);
    expect(trackPageView).toHaveBeenCalledWith("/news#wsb-discussion", "Test route");
  });

  it("keeps alert checks across routes and batches new headlines inside the cooldown", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const headline = (id: string) => ({
      id, title: `Headline ${id}`, source: "Publisher", score: 61,
      url: `https://example.com/${id}`, published_at: new Date().toISOString(),
    });
    let headlines = [headline("baseline")];
    const fetchAlert = vi.fn(async () => Response.json({
      updated_at: new Date().toISOString(),
      alerts: { threshold: 45, window_minutes: 120, headlines },
    }));
    vi.stubGlobal("fetch", fetchAlert);
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    const notice = () => screen.queryByRole("complementary", { name: "Live news alert" });

    render(<MemoryRouter initialEntries={["/"]}><AppWithAnalytics /></MemoryRouter>);
    await advance(2_000);
    expect(notice()).toBeNull();
    expect(fetchAlert).toHaveBeenCalledWith("/live-news/alerts", expect.objectContaining({ method: "POST" }));

    fireEvent.click(screen.getByRole("link", { name: "Open sectors" }));
    headlines = [headline("one"), ...headlines];
    await advance(60_000);
    expect(fetchAlert).toHaveBeenCalledTimes(2);
    expect(notice()?.textContent).toContain("Headline one");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    headlines = [headline("two"), ...headlines];
    await advance(60_000);
    expect(notice()).toBeNull();
    headlines = [headline("three"), ...headlines];
    await advance(239_000);
    expect(notice()).toBeNull();
    await advance(1_000);
    expect(notice()?.textContent).toContain("2 high-relevance headlines");
    expect(notice()?.textContent).toContain("Headline three");
    expect(screen.getByRole("link", { name: "Review alerts" }).getAttribute("href")).toBe("/news#live-news-alerts");
  });

  it("clears disabled raw alerts and establishes a quiet baseline after source changes", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let headlines: { id: string; title: string; source: string; score: number; url: string; published_at: string; report_label: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      updated_at: new Date().toISOString(),
      alerts: { threshold: 45, window_minutes: 120, headlines },
    })));
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    render(<MemoryRouter><AppWithAnalytics /></MemoryRouter>);
    await advance(2_000);
    headlines = [{ id: "raw", title: "A group claims a breach", source: "Raw source", score: 49, url: "https://example.com/raw", published_at: new Date().toISOString(), report_label: "Unverified victim claim" }];
    await advance(60_000);
    expect(screen.getByRole("complementary", { name: "Live news alert" }).textContent).toContain("Gray · Unverified victim claim");
    headlines = [];
    act(() => window.dispatchEvent(new Event("live-news:sources-changed")));
    expect(screen.queryByRole("complementary", { name: "Live news alert" })).toBeNull();
    await advance(2_000);
    expect(JSON.parse(localStorage.getItem("live-news:site-alerts-data") ?? "{}").alerts.headlines).toEqual([]);
    expect(screen.queryByRole("complementary", { name: "Live news alert" })).toBeNull();
  });
});
