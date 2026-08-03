import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import Vision from "../Vision";

describe("Vision architecture constellation", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a non-interactive lazy preview and mounts the full viewer only on request", async () => {
    const user = userEvent.setup();
    render(<Vision />, { wrapper: MemoryRouter });

    const preview = screen.getByTitle("Preview of the Market Diagnostic Dashboard architecture constellation");
    expect(preview.getAttribute("src")).toBe("/_graphify/constellation.html#preview");
    expect(preview.getAttribute("loading")).toBe("lazy");
    expect(preview.getAttribute("tabindex")).toBe("-1");
    expect(screen.queryByTitle("Interactive architecture constellation")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open interactive constellation" }));

    expect(screen.getByRole("dialog", { name: "Architecture Constellation" })).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Loading the architecture map");
    const frame = screen.getByTitle("Interactive architecture constellation") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/_graphify/constellation.html");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");

    fireEvent.load(frame);
    expect(screen.getByRole("status").textContent).toContain("Loading the architecture map");

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "architecture-constellation-ready", view: "interactive" },
      source: frame.contentWindow,
    }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "architecture-constellation-close" },
      source: frame.contentWindow,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the recovery state when the viewer never completes its ready handshake", () => {
    vi.useFakeTimers();
    render(<Vision />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole("button", { name: "Open interactive constellation" }));

    act(() => vi.advanceTimersByTime(10_001));

    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.getByRole("link", { name: "Open standalone" }).getAttribute("href"))
      .toBe("/_graphify/constellation.html");
  });
});
