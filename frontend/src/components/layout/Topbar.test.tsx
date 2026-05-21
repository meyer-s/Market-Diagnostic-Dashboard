import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Topbar from "./Topbar";

describe("Topbar", () => {
  it("opens the tools menu with the keyboard and exposes menu items", async () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const button = screen.getAllByRole("button", { name: "Tools" })[0];
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });

    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the tools menu on escape", async () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const button = screen.getAllByRole("button", { name: "Tools" })[0];
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

    const button = screen.getAllByRole("button", { name: "Tools" })[0];
    expect(button.className.includes("bg-stealth-800")).toBe(true);
  });
});
