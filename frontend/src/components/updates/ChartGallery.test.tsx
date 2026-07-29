import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChartGallery from "./ChartGallery";

function GalleryHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open charts</button>
      <ChartGallery
        isOpen={open}
        urls={["https://example.com/one.png", "https://example.com/two.png"]}
        initialIndex={0}
        title="July market recap"
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function EmptyGalleryHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open empty gallery</button>
      <ChartGallery
        isOpen={open}
        urls={[]}
        initialIndex={0}
        title="July market recap"
        onClose={() => setOpen(false)}
      />
    </>
  );
}

describe("ChartGallery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders populated evidence, advances it, and restores focus after Escape", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<GalleryHarness />);

    const trigger = screen.getByRole("button", { name: "Open charts" });
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "July market recap" })).not.toBeNull();
    expect(screen.getByText("Chart 1 of 2")).not.toBeNull();
    expect(
      screen.getByRole("img", { name: "Chart 1 supporting July market recap" }),
    ).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBe(document.activeElement));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Chart 2 of 2")).not.toBeNull();
    expect(
      screen.getByRole("img", { name: "Chart 2 supporting July market recap" }),
    ).not.toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toBe(document.activeElement));
  });

  it("renders an explicit empty contract instead of an unexplained blank overlay", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<EmptyGalleryHarness />);

    await user.click(screen.getByRole("button", { name: "Open empty gallery" }));

    const dialog = screen.getByRole("dialog", { name: "July market recap" });
    expect(dialog.getAttribute("data-evidence-panel")).toBe("recap-gallery");
    expect(dialog.getAttribute("data-evidence-state")).toBe("empty");
    expect(screen.getByText(/does not include chart snapshots/i)).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
