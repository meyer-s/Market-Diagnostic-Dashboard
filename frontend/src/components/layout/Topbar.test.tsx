import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import Topbar from "./Topbar";

describe("Topbar", () => {
  afterEach(cleanup);

  it("uses the canonical product identity and links it to the dashboard", () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const brand = screen.getByRole("link", {
      name: "Market Diagnostic Dashboard, dashboard",
    });
    expect(brand.getAttribute("href")).toBe("/");
    expect(screen.getByText("Evidence-led macro research")).not.toBeNull();
  });

  it("opens the tools menu with the keyboard and exposes menu items", async () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Tools" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Market Map" })).toBe(document.activeElement);
    });
  });

  it("closes the tools menu on escape", async () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Tools" });
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("marks nested tool routes as active", async () => {
    render(
      <MemoryRouter initialEntries={["/tools/recap/example-post"]}>
        <Topbar />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Tools" });
    expect(button.getAttribute("data-active")).toBe("true");
  });

  it("exposes mobile disclosure state and returns focus on escape", async () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Open navigation menu" });
    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("navigation", { name: "Mobile" })).not.toBeNull();
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Dashboard" })[1]).toBe(document.activeElement);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
    expect(button).toBe(document.activeElement);
    expect(button.getAttribute("aria-label")).toBe("Open navigation menu");
  });

  it("keeps mobile tool groups collapsed until requested", () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const summary = screen.getByText("Asset Classes").closest("summary");
    const group = summary?.closest("details");

    expect(summary).not.toBeNull();
    expect(group?.hasAttribute("open")).toBe(false);

    fireEvent.click(summary as HTMLElement);

    expect(group?.hasAttribute("open")).toBe(true);
  });
});
