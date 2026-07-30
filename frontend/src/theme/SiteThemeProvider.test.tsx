import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SITE_THEMES,
  SITE_THEME_STORAGE_KEY,
  SiteThemeProvider,
  useSiteTheme,
} from "./SiteThemeProvider";

function ThemeHarness() {
  const { theme, activeTheme, setTheme } = useSiteTheme();

  return (
    <div>
      <output data-testid="theme-id">{theme}</output>
      <output data-testid="theme-label">{activeTheme.label}</output>
      <button type="button" onClick={() => setTheme("ledger")}>
        Choose ledger
      </button>
    </div>
  );
}

function renderThemeHarness() {
  return render(
    <SiteThemeProvider>
      <ThemeHarness />
    </SiteThemeProvider>,
  );
}

describe("SiteThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("defaults to Evidence Field and publishes the expected theme metadata", async () => {
    renderThemeHarness();

    expect(SITE_THEMES.map(({ id, label, shortLabel }) => ({ id, label, shortLabel }))).toEqual([
      { id: "evidence", label: "Evidence Field", shortLabel: "Field" },
      { id: "ledger", label: "Midnight Ledger", shortLabel: "Ledger" },
      { id: "observatory", label: "Signal Observatory", shortLabel: "Signal" },
    ]);
    expect(screen.getByTestId("theme-id").textContent).toBe("evidence");
    expect(screen.getByTestId("theme-label").textContent).toBe("Evidence Field");

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("evidence");
      expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("evidence");
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#0e1520");
    });
  });

  it("applies and persists a selected theme", async () => {
    renderThemeHarness();

    fireEvent.click(screen.getByRole("button", { name: "Choose ledger" }));

    expect(screen.getByTestId("theme-id").textContent).toBe("ledger");
    expect(screen.getByTestId("theme-label").textContent).toBe("Midnight Ledger");
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("ledger");
      expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("ledger");
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#0a1420");
    });
  });

  it("falls back to Evidence Field when persisted data is invalid", async () => {
    window.localStorage.setItem(SITE_THEME_STORAGE_KEY, "sepia");
    document.documentElement.dataset.theme = "sepia";

    renderThemeHarness();

    expect(screen.getByTestId("theme-id").textContent).toBe("evidence");
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("evidence");
      expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("evidence");
    });
  });

  it("synchronizes valid cross-tab storage changes and safely handles removal", async () => {
    renderThemeHarness();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SITE_THEME_STORAGE_KEY,
          newValue: "observatory",
        }),
      );
    });

    expect(screen.getByTestId("theme-id").textContent).toBe("observatory");
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("observatory");
      expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("observatory");
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#071619");
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SITE_THEME_STORAGE_KEY,
          newValue: null,
        }),
      );
    });

    expect(screen.getByTestId("theme-id").textContent).toBe("evidence");
  });
});
