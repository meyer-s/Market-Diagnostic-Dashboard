import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import RouteErrorBoundary from "./RouteErrorBoundary";
import RouteExperience from "./RouteExperience";

function BrokenRoute(): ReactElement {
  throw new Error("render failed");
}

describe("route experience", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.title = "";
  });

  it("sets a canonical route title, announces it, and moves focus to main", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    render(
      <MemoryRouter initialEntries={["/crypto-indicators"]}>
        <RouteExperience />
        <main id="main-content" tabIndex={-1}>Crypto content</main>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.title).toBe("Crypto | Market Diagnostic Dashboard");
      expect(document.activeElement?.id).toBe("main-content");
    });
    expect(screen.getByRole("status").textContent).toBe("Crypto page loaded.");
  });

  it("uses the indicator code and stock symbol in parameterized page titles", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { unmount } = render(
      <MemoryRouter initialEntries={["/indicators/BREADTH_HEALTH"]}>
        <RouteExperience />
        <main id="main-content" tabIndex={-1}>Breadth content</main>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.title).toBe(
        "Market Breadth Health Indicator | Market Diagnostic Dashboard",
      );
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Market Breadth Health Indicator page loaded.",
    );

    unmount();
    render(
      <MemoryRouter initialEntries={["/stock-analysis/spy"]}>
        <RouteExperience />
        <main id="main-content" tabIndex={-1}>Stock content</main>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.title).toBe("SPY Stock Analysis | Market Diagnostic Dashboard");
    });
  });

  it("contains route render failures while leaving recovery actions available", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <BrokenRoute />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reload page" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Go to dashboard" }).getAttribute("href")).toBe("/");
  });
});
