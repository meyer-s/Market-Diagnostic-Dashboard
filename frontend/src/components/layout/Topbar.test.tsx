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

import { SiteThemeProvider } from "../../theme/SiteThemeProvider";
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

  it("keeps theme previews out of the product navigation", () => {
    renderTopbar();

    expect(screen.queryByRole("button", { name: /View/i })).toBeNull();
    expect(screen.queryByText("Preview view")).toBeNull();
    expect(document.querySelector("[data-theme-value]")).toBeNull();
  });

  it("exposes mobile disclosure state and returns focus on escape", async () => {
    renderTopbar();

    const button = screen.getByRole("button", { name: "Open navigation menu" });
    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    await waitFor(() => {
      expect(
        within(mobileNav).getByRole("link", { name: "Dashboard" }),
      ).toBe(document.activeElement);
    });
    expect(within(mobileNav).queryByRole("radiogroup")).toBeNull();
    expect(within(mobileNav).queryByText("Preview view")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
    expect(button).toBe(document.activeElement);
    expect(button.getAttribute("aria-label")).toBe("Open navigation menu");
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
