import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import Dialog from "./Dialog";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open map</button>
      <Dialog
        open={open}
        title="Architecture map"
        description="Inspect the repository graph."
        onClose={() => setOpen(false)}
      >
        <iframe title="Repository graph" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("root")?.remove();
  });

  it("names the modal, inerts the app, includes an iframe in its focus loop, and restores focus", async () => {
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.appendChild(appRoot);
    render(<DialogHarness />, { container: appRoot });
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Open map" });

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Architecture map" });
    const close = screen.getByRole("button", { name: "Close Architecture map" });
    const frame = screen.getByTitle("Repository graph");
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(appRoot.inert).toBe(true);
    expect(appRoot.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(close).toBe(document.activeElement));

    frame.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toBe(document.activeElement);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toBe(document.activeElement));
    expect(appRoot.inert).toBe(false);
    expect(appRoot.getAttribute("aria-hidden")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
