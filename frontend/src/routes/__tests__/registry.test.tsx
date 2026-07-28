import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppRoutes, getAnalyticsNameForPath, navRoutes, routeRegistry, toolRoutes } from "../registry";

describe("route registry", () => {
  it("assigns an analytics name to every concrete route", () => {
    const concreteRoutes = routeRegistry.filter((route) => route.path !== "*");
    expect(concreteRoutes.every((route) => route.analyticsName.length > 0)).toBe(true);
  });

  it("ensures every nav item has a matching route", () => {
    const routePaths = new Set(routeRegistry.map((route) => route.path));
    [...navRoutes, ...toolRoutes].forEach((route) => {
      expect(routePaths.has(route.path)).toBe(true);
    });
  });

  it("resolves analytics names from the registry", () => {
    expect(getAnalyticsNameForPath("/")).toBe("Dashboard");
    expect(getAnalyticsNameForPath("/stock-analysis/MSFT")).toBe("Stock Analysis");
    expect(getAnalyticsNameForPath("/market-weather")).toBe("Market Field Language");
  });

  it("renders the catch-all 404 route for unknown paths", () => {
    render(
      <MemoryRouter initialEntries={["/does-not-exist"]}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByText("Page not found")).not.toBeNull();
  });
});
