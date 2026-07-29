import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
        React.createElement("output", { "data-testid": "route-search" }, location.search),
      );
    },
    getAnalyticsNameForPath: () => "Test route",
    getPageNameForPath: () => "Test route",
  };
});

import { AppWithAnalytics } from "./App";

describe("application route lifecycle", () => {
  afterEach(() => {
    cleanup();
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
});
