import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import {
  AppRoutes,
  getAnalyticsNameForPath,
  getPageNameForPath,
  navRoutes,
  routeRegistry,
  toolRoutes,
} from "../registry";

describe("route registry", () => {
  afterEach(cleanup);

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
    expect(getAnalyticsNameForPath("/aas-breakdown")).toBe("Not Found");
  });

  it("gives parameterized research pages specific reader-facing names", () => {
    expect(getPageNameForPath("/indicators/BREADTH_HEALTH")).toBe(
      "Market Breadth Health Indicator",
    );
    expect(getPageNameForPath("/indicators/AAS")).toBe("Asset Diagnostics Moved");
    expect(getPageNameForPath("/stock-analysis/msft")).toBe("MSFT Stock Analysis");
  });

  it("keeps retired AAS diagnostics out of navigation and points to the split replacements", () => {
    expect(routeRegistry.some((route) => route.path === "/aas-breakdown")).toBe(false);
    expect(routeRegistry.some((route) => route.path === "/indicators/AAS")).toBe(true);
    expect(toolRoutes.map((route) => route.path)).toEqual(
      expect.arrayContaining(["/metals-indicators", "/crypto-indicators"]),
    );
  });

  it("keeps the scheduled full-site audit aligned with supported and retired routes", () => {
    const auditSource = readFileSync(
      path.resolve(process.cwd(), "tests/visual/site-full-audit.spec.ts"),
      "utf8",
    );
    const markerByRoute: Record<string, string> = {
      "/indicators/:code": "path: `/indicators/${code}`",
      "/stock-analysis/:symbol": 'path: "/stock-analysis/SPY"',
      "/tools/recap/:slug": "path: `/tools/recap/${post.slug}`",
      "/tools/updates/:slug": '"/tools/updates/market-diagnostic-2026-07-27"',
      "/market-weather": 'path: "/market-weather?symbol=SPY&timeframe=1D&bars=365"',
      "/why-this-exists": '"/why-this-exists"',
      "/tools/experiments": '"/tools/experiments"',
      "/tools/weather-research": '"/tools/weather-research"',
      "/tools/updates": '"/tools/updates"',
      "/precious-metals": '"/precious-metals"',
    };

    for (const route of routeRegistry.filter((candidate) => candidate.path !== "*")) {
      const marker = markerByRoute[route.path] ?? `path: "${route.path}"`;
      expect(auditSource, `${route.path} is missing from the full-site audit`).toContain(marker);
    }

    expect(auditSource).toContain('id: "legacy-aas-breakdown"');
    expect(auditSource).toContain('id: "legacy-aas-indicator"');
    expect(auditSource.match(/supportStatus: "retired-legacy"/g)).toHaveLength(2);
    expect(auditSource).toContain(
      'replacements: ["/metals-indicators", "/crypto-indicators"]',
    );
    expect(
      existsSync(path.resolve(process.cwd(), "src/pages/AASComponentBreakdown.tsx")),
    ).toBe(false);
  });

  it("renders the catch-all 404 route for unknown paths", () => {
    render(
      <MemoryRouter initialEntries={["/does-not-exist"]}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByText("Page not found")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Metals" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Crypto" })).not.toBeNull();
  });

  it("treats the retired AAS address as unsupported", () => {
    render(
      <MemoryRouter initialEntries={["/aas-breakdown"]}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByText("Page not found")).not.toBeNull();
  });

  it("turns the retired AAS indicator deep link into replacement guidance", () => {
    render(
      <MemoryRouter initialEntries={["/indicators/AAS"]}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Asset diagnostics moved" }),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Metals" }).getAttribute("href")).toBe(
      "/metals-indicators",
    );
    expect(screen.getByRole("link", { name: "Open Crypto" }).getAttribute("href")).toBe(
      "/crypto-indicators",
    );
  });

  it("announces a factual loading state while a route bundle opens", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByRole("status").textContent).toContain("Opening research workspace");
    expect(screen.getByRole("status").textContent).toContain(
      "Current market data will load separately",
    );
  });
});
