import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SITE_THEME_STORAGE_KEY,
  SiteThemeProvider,
  useSiteTheme,
} from "./SiteThemeProvider";

function ThemeHarness() {
  const { theme } = useSiteTheme();
  return <output data-testid="theme-id">{theme}</output>;
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

  it("publishes Evidence as the sole production theme", async () => {
    renderThemeHarness();

    expect(screen.getByTestId("theme-id").textContent).toBe("evidence");
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("evidence");
      expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("evidence");
      expect(
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute("content"),
      ).toBe("#0e1520");
    });
  });

  it("retires a legacy preview preference on startup", async () => {
    window.localStorage.setItem(SITE_THEME_STORAGE_KEY, "observatory");
    document.documentElement.dataset.theme = "observatory";

    renderThemeHarness();

    expect(screen.getByTestId("theme-id").textContent).toBe("evidence");
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("evidence");
      expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("evidence");
    });
  });

  it("ignores legacy cross-tab preview changes", async () => {
    renderThemeHarness();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SITE_THEME_STORAGE_KEY,
          newValue: "ledger",
        }),
      );
    });

    expect(screen.getByTestId("theme-id").textContent).toBe("evidence");
    expect(document.documentElement.dataset.theme).toBe("evidence");
    expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("evidence");
  });
});
