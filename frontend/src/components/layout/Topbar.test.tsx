import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import {
  SITE_THEME_STORAGE_KEY,
  SiteThemeProvider,
} from "../../theme/SiteThemeProvider";
import Topbar from "./Topbar";

function renderTopbar(initialEntries = ["/"]) {
  return render(
    <SiteThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Topbar />
      </MemoryRouter>
    </SiteThemeProvider>,
  );
}

describe("Topbar", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("uses the canonical product identity and links it to the dashboard", () => {
    renderTopbar();

    const brand = screen.getByRole("link", {
      name: "Market Diagnostic Dashboard, dashboard",
    });
    expect(brand.getAttribute("href")).toBe("/");
    expect(screen.getByText("Evidence-led macro research")).not.toBeNull();
  });

  it("opens the tools menu with the keyboard and exposes menu items", async () => {
    renderTopbar();

    const button = screen.getByRole("button", { name: "Tools" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Market Map" })).toBe(document.activeElement);
    });
  });

  it("closes the tools menu on escape", async () => {
    renderTopbar();

    const button = screen.getByRole("button", { name: "Tools" });
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("marks nested tool routes as active", async () => {
    renderTopbar(["/tools/recap/example-post"]);

    const button = screen.getByRole("button", { name: "Tools" });
    expect(button.getAttribute("data-active")).toBe("true");
  });

  it("exposes a compact view disclosure with radio menu semantics", () => {
    renderTopbar();

    const button = screen.getByRole("button", { name: /View.*Field/i });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);

    const menu = screen.getByRole("menu", { name: "Preview view" });
    const choices = within(menu).getAllByRole("menuitemradio");
    expect(choices).toHaveLength(3);
    expect(
      within(menu)
        .getByRole("menuitemradio", { name: /Evidence Field/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(menu)
        .getByRole("menuitemradio", { name: /Midnight Ledger/i })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      within(menu)
        .getByRole("menuitemradio", { name: /Signal Observatory/i })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("selects and persists a preview view through the theme provider", async () => {
    renderTopbar();

    fireEvent.click(screen.getByRole("button", { name: /View.*Field/i }));
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Midnight Ledger/i }),
    );

    expect(screen.queryByRole("menu", { name: "Preview view" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /View.*Ledger/i }),
    ).not.toBeNull();
    await waitFor(() => {
      expect(window.localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("ledger");
    });

    fireEvent.click(screen.getByRole("button", { name: /View.*Ledger/i }));
    expect(
      screen
        .getByRole("menuitemradio", { name: /Midnight Ledger/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("supports roving keyboard focus and escape in the view menu", async () => {
    renderTopbar();

    const button = screen.getByRole("button", { name: /View.*Field/i });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });

    const evidence = await screen.findByRole("menuitemradio", {
      name: /Evidence Field/i,
    });
    await waitFor(() => {
      expect(evidence).toBe(document.activeElement);
    });

    fireEvent.keyDown(evidence, { key: "ArrowDown" });
    const ledger = screen.getByRole("menuitemradio", {
      name: /Midnight Ledger/i,
    });
    expect(ledger).toBe(document.activeElement);

    fireEvent.keyDown(ledger, { key: "End" });
    const observatory = screen.getByRole("menuitemradio", {
      name: /Signal Observatory/i,
    });
    expect(observatory).toBe(document.activeElement);

    fireEvent.keyDown(observatory, { key: "Home" });
    expect(evidence).toBe(document.activeElement);

    fireEvent.keyDown(evidence, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Preview view" })).toBeNull();
      expect(button).toBe(document.activeElement);
    });
  });

  it("keeps the view and tools disclosures mutually exclusive", () => {
    renderTopbar();

    const viewButton = screen.getByRole("button", { name: /View.*Field/i });
    const toolsButton = screen.getByRole("button", { name: "Tools" });

    fireEvent.click(viewButton);
    expect(viewButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toolsButton);
    expect(viewButton.getAttribute("aria-expanded")).toBe("false");
    expect(toolsButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(viewButton);
    expect(toolsButton.getAttribute("aria-expanded")).toBe("false");
    expect(viewButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.mouseDown(document.body);
    expect(viewButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("exposes mobile disclosure state and returns focus on escape", async () => {
    renderTopbar();

    const button = screen.getByRole("button", { name: "Open navigation menu" });
    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    await waitFor(() => {
      expect(
        within(mobileNav).getByRole("radio", { name: /Evidence Field/i }),
      ).toBe(document.activeElement);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
    expect(button).toBe(document.activeElement);
    expect(button.getAttribute("aria-label")).toBe("Open navigation menu");
  });

  it("exposes all preview views as a mobile radio group", () => {
    renderTopbar();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));

    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    const previewGroup = within(mobileNav).getByRole("radiogroup", {
      name: "Preview view",
    });
    expect(within(previewGroup).getAllByRole("radio")).toHaveLength(3);

    const signal = within(previewGroup).getByRole("radio", {
      name: /Signal Observatory/i,
    });
    fireEvent.click(signal);

    expect(signal.getAttribute("aria-checked")).toBe("true");
    expect(
      within(previewGroup)
        .getByRole("radio", { name: /Evidence Field/i })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByRole("navigation", { name: "Mobile" })).not.toBeNull();
  });

  it("keeps mobile tool groups collapsed until requested", () => {
    renderTopbar();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const summary = screen.getByText("Asset Classes").closest("summary");
    const group = summary?.closest("details");

    expect(summary).not.toBeNull();
    expect(group?.hasAttribute("open")).toBe(false);

    fireEvent.click(summary as HTMLElement);

    expect(group?.hasAttribute("open")).toBe(true);
  });
});
