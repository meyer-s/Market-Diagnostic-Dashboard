import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { UpdatePostListItem } from "../../types/updates";
import UpdatesList from "./UpdatesList";

const LONG_TITLE =
  "Market diagnostic recap: cross-asset participation, volatility pressure, and the evidence behind the current regime";

const posts: UpdatePostListItem[] = [
  {
    id: "long-title",
    created_at: "2026-07-29T12:00:00Z",
    title: LONG_TITLE,
    slug: "market-diagnostic-2026-07-29",
    summary: "A long recap title used to verify disclosure behavior.",
    status: "YELLOW",
    tags: [],
    pinned: false,
  },
  {
    id: "second-title",
    created_at: "2026-07-28T12:00:00Z",
    title: "Second recap",
    slug: "second-recap",
    summary: "A second focus target.",
    status: "GREEN",
    tags: [],
    pinned: false,
  },
];

function SelectableUpdatesList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <UpdatesList
      posts={posts}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );
}

describe("UpdatesList long titles", () => {
  afterEach(cleanup);

  it("reveals a clamped title on keyboard focus and reclamps it after blur", async () => {
    const user = userEvent.setup();
    render(<UpdatesList posts={posts} selectedId={null} onSelect={() => undefined} />);

    const title = screen.getByText(LONG_TITLE);
    expect(title.classList.contains("line-clamp-2")).toBe(true);
    expect(
      screen.getByRole("button", { name: new RegExp(LONG_TITLE) }),
    ).not.toBeNull();

    await user.tab();
    expect(title.classList.contains("line-clamp-2")).toBe(false);
    expect(title.classList.contains("break-words")).toBe(true);

    await user.tab();
    expect(title.classList.contains("line-clamp-2")).toBe(true);
  });

  it("keeps the full title visible after a touch-equivalent selection", async () => {
    const user = userEvent.setup();
    render(<SelectableUpdatesList />);

    const title = screen.getByText(LONG_TITLE);
    await user.click(screen.getByRole("button", { name: new RegExp(LONG_TITLE) }));

    expect(title.classList.contains("line-clamp-2")).toBe(false);
    expect(title.classList.contains("break-words")).toBe(true);
    expect(
      screen.getByRole("button", { name: new RegExp(LONG_TITLE) }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
