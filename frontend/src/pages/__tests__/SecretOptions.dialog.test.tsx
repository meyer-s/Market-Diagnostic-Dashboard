import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SecretOptionsDialog } from "../SecretOptions";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="dialog-background">
      <button type="button" onClick={() => setOpen(true)}>Open trade editor</button>
      {open ? (
        <SecretOptionsDialog label="Edit trade" onClose={() => setOpen(false)}>
          <div>
            <button type="button" data-dialog-initial-focus>First action</button>
            <button type="button">Last action</button>
          </div>
        </SecretOptionsDialog>
      ) : null}
    </div>
  );
}

describe("SecretOptionsDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("names one dialog, traps focus, inerts the page, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open trade editor" });

    await user.click(trigger);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Edit trade" }).className).toContain("z-[300]");
    expect(screen.getByTestId("dialog-background").parentElement?.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(screen.getByRole("button", { name: "First action" })).toBe(document.activeElement));

    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Last action" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toBe(document.activeElement);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toBe(document.activeElement));
    expect(screen.getByTestId("dialog-background").parentElement?.inert).not.toBe(true);
    expect(screen.getByTestId("dialog-background").parentElement?.getAttribute("aria-hidden")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
